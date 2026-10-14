// '동시에 만들 앱 수'(통제실 [설정], 기본 3) 시험:
// 서버 값 검증(1~4 정수만) · 관리자 전용 · /next 응답에 값 포함 · /next 가 요청한 수까지만 내줌(최대 4) · 정비 중 새 일감 멈춤 유지 ·
// 감독 프로그램 규칙(서버 값 우선, 없으면 PC 값, PC 에 따로 정한 값은 기본값에 덮이지 않음, 줄이면 돌던 일감 유지·늘리면 더 가져감) ·
// 같은 앱 동시 실행 금지(서버 SQL·감독 프로그램) · 화면 문구(주의·[사용량] 링크·지금 진행 중 N / 최대 M).
// 가짜 DB·가짜 요청으로만 돌린다(실제 DB·네트워크·Claude 사용 안 함). 실행: npm run test:app-slots
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { NextRequest, NextResponse } = require("next/server");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");

function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const slots = await import(pathToFileURL(path.join(repo, "tools/factory-supervisor/slots.mjs")).href);

// ── 가짜 설정 저장소(FactorySetting) ──
const store = new Map();
const prisma = {
  factorySetting: {
    findUnique: async ({ where }) => (store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null),
    upsert: async ({ where, create, update }) => (store.set(where.key, store.has(where.key) ? update.value : create.value), {}),
    deleteMany: async () => ({ count: 0 }),
  },
};
const settings = loadTs("lib/factory/settings.ts", { "@/lib/prisma": { __esModule: true, default: prisma }, "@/lib/factory/ai": { isAiEngine: () => true, isClaudeModel: () => true }, "@/lib/factory/toolBroker": { isToolBrokerMode: () => true, normalizeToolBroker: (v) => v, readStoredToolBroker: () => null, TOOL_BROKER_LIMITS_VERSION: 1 } });

test("서버 값 검증: 1~4 정수만 받고 나머지는 버림", () => {
  for (const ok of [1, 2, 3, 4, "3"]) assert.equal(settings.cleanAppSlots(ok), Number(ok), String(ok));
  for (const bad of [0, 5, -1, 2.5, "2.5", "abc", "", " ", NaN, Infinity, null, undefined, true, [], {}, "1e1", "03x"]) assert.equal(settings.cleanAppSlots(bad), null, String(bad));
  // 감독 프로그램 쪽 규칙도 서버와 똑같다
  for (const v of [1, 2, 3, 4, 0, 5, 2.5, "3", "x", null, undefined, NaN]) assert.equal(slots.cleanSlots(v), settings.cleanAppSlots(v), String(v));
  assert.equal(settings.MIN_APP_SLOTS, 1);
  assert.equal(settings.MAX_APP_SLOTS, 4);
  assert.equal(settings.DEFAULT_APP_SLOTS, 3);
});

test("서버 설정: 정한 적 없으면 기본 3(isDefault), 저장하면 그 값, 저장된 값이 이상하면 기본 3", async () => {
  store.clear();
  assert.deepEqual(await settings.getAppSlots(), { value: 3, isDefault: true });
  await settings.setAppSlots(2);
  assert.equal(store.get("appSlots"), "2");
  assert.deepEqual(await settings.getAppSlots(), { value: 2, isDefault: false });
  store.set("appSlots", "9");
  assert.deepEqual(await settings.getAppSlots(), { value: 3, isDefault: true });
  store.set("appSlots", "abc");
  assert.deepEqual(await settings.getAppSlots(), { value: 3, isDefault: true });
  store.clear();
});

// ── 관리자 API ──
let admin = true;
const requireAdmin = async () => (admin ? null : NextResponse.json({ message: "관리자만" }, { status: 403 }));
const snapshot = async () => ({ running: 1, appSlots: (await settings.getAppSlots()).value, appSlotsDefault: (await settings.getAppSlots()).isDefault });
const controlRoute = loadTs("app/api/admin/factory/control/route.ts", {
  "@/lib/factory/admin": { requireAdmin },
  "@/lib/factory/ai": { isAiEngine: () => false, AI_LABELS: {}, readModelChoice: () => ({ ok: false, message: "" }) },
  "@/lib/factory/settings": settings,
  "@/lib/factory/toolBroker": { isToolBrokerMode: () => false, TOOL_BROKER_MODE_LABELS: {}, toolBrokerLimitLabel: () => "" },
  "@/lib/factory/supervisor": { supervisorSnapshot: snapshot, runSupervisorAction: async () => ({ message: "", snapshot: {} }) },
});
const post = (body) => new NextRequest("http://x/api/admin/factory/control", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

test("관리자 API: 비관리자는 막히고 저장 안 됨, 관리자는 1~4 만 저장(범위 밖·소수·문자열은 400)", async () => {
  store.clear();
  admin = false;
  assert.equal((await controlRoute.POST(post({ appSlots: 3 }))).status, 403);
  assert.equal(store.has("appSlots"), false);
  admin = true;

  const res = await controlRoute.POST(post({ appSlots: 2 }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.appSlots, 2);
  assert.equal(body.appSlotsDefault, false);
  assert.match(body.message, /2개로 저장/);
  assert.match(body.message, /다음 확인 때 받아 가요/);
  assert.match(body.message, /끊지 않고/);
  assert.equal(store.get("appSlots"), "2");

  for (const bad of [0, 5, -3, 2.5, "3", null, true, [3]]) {
    const r = await controlRoute.POST(post({ appSlots: bad }));
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.match((await r.json()).message, /1~4 사이 정수/);
  }
  assert.equal(store.get("appSlots"), "2", "잘못된 값은 저장 안 함");
  store.clear();
});

test("관리자 API: GET 은 관리자 전용·캐시 안 함(force-dynamic), 값에 appSlots 포함", async () => {
  assert.equal(controlRoute.dynamic, "force-dynamic");
  admin = false;
  assert.equal((await controlRoute.GET()).status, 403);
  admin = true;
  const body = await (await controlRoute.GET()).json();
  assert.equal(body.appSlots, 3);
  assert.equal(body.appSlotsDefault, true);
});

// ── /api/factory/next ──
const claimCalls = [];
let maintHold = false;
let appSlotsFail = false;
const jobsStub = {
  MAX_SLOTS: 4,
  WORKER_RE: /^[A-Za-z0-9._-]{1,60}$/,
  releaseExpiredLeases: async () => {},
  claimJobs: async (worker, n, engines) => (claimCalls.push({ worker, n, engines }), Array.from({ length: n }, (_, i) => ({ id: `j${i}`, appSlug: `app-${i}`, priority: 0 }))),
};
const nextRoute = loadTs("app/api/factory/next/route.ts", {
  "@/lib/factory/jobs": jobsStub,
  "@/lib/factory/http": { fail: (status, message) => NextResponse.json({ message }, { status }), guardWorker: async () => null },
  "@/lib/factory/release": { consumeKeyScan: async () => false, notifyTestingDue: async () => {}, pcPathsToCheck: async () => [], releaseJobExtras: async () => new Map() },
  "@/lib/factory/keyPasswords": { keyPasswordsPending: async () => false },
  "@/lib/factory/secretEntries": { secretEntriesPending: async () => false },
  "@/lib/factory/keyVault": { keyTasksForNext: async () => [] },
  "@/lib/factory/reviewVideo": { sweepReviewVideos: async () => {} },
  "@/lib/factory/uploadTest": { consumeUploadTest: async () => null },
  "@/lib/factory/maintenance": { maintenanceForNext: async () => ({}), maintenanceHold: async () => maintHold },
  "@/lib/factory/rules": { getRuleOverrides: async () => ({}), renderRules: () => ({}) },
  "@/lib/factory/settings": {
    consumeRestart: async () => false,
    consumeUpdateNow: async () => false,
    getDefaultAiEngine: async () => "claude",
    getToolBrokerSettings: async () => undefined,
    isAutoUpdateEnabled: async () => true,
    isCompactAfterJobEnabled: async () => true,
    isSupervisorEnabled: async () => true,
    saveSupervisorInfo: async () => {},
    getAppSlots: async () => {
      if (appSlotsFail) throw new Error("읽기 실패");
      return settings.getAppSlots();
    },
  },
  "@/lib/factory/supervisor": { noteSupervisorRuntime: async () => {} },
  "@/lib/factory/ai": { workerEngines: () => ["claude"] },
  "@/lib/factory/toolBroker": { toolBrokerForSupervisor: (v) => v },
});
const next = (q) => nextRoute.GET(new NextRequest(`http://x/api/factory/next?worker=mainpc&${q}`));

test("/next: 응답에 appSlots(기본 3·appSlotsDefault)가 들어가고, 저장하면 그 값으로 바뀜", async () => {
  store.clear();
  let body = await (await next("slots=3")).json();
  assert.equal(body.appSlots, 3);
  assert.equal(body.appSlotsDefault, true);
  await settings.setAppSlots(1);
  body = await (await next("slots=1")).json();
  assert.equal(body.appSlots, 1);
  assert.equal(body.appSlotsDefault, false);
  store.clear();
});

test("/next: 설정을 못 읽어도 일감 내주기는 그대로(appSlots 만 빠짐)", async () => {
  appSlotsFail = true;
  const res = await next("slots=2");
  const body = await res.json();
  appSlotsFail = false;
  assert.equal(res.status, 200);
  assert.equal(body.jobs.length, 2);
  assert.equal("appSlots" in body, false);
});

test("/next: 슬롯 3 이면 3개까지만, 요청이 4 보다 커도 4개까지, 0 이면 신호만(일감 없음)", async () => {
  claimCalls.length = 0;
  assert.equal((await (await next("slots=3")).json()).jobs.length, 3);
  assert.equal((await (await next("slots=99")).json()).jobs.length, 4);
  const zero = await (await next("slots=0")).json();
  assert.deepEqual(zero.jobs, []);
  assert.deepEqual(claimCalls.map((c) => c.n), [3, 4], "slots=0 은 일감을 가져가지 않음");
});

test("/next: 정비가 대기·진행 중이어도 앱 일감을 내준다(병렬화 단계 A). 멈추는 건 감독 프로그램이 slots=0 으로 요청할 때뿐", async () => {
  claimCalls.length = 0;
  maintHold = true;
  const body = await (await next("slots=3")).json();
  const drained = await (await next("slots=0&drain=update&drainJobs=2")).json();
  maintHold = false;
  assert.equal(body.jobs.length, 3, "정비 중에도 일감을 가져감");
  assert.equal("maintenanceHold" in body, false);
  assert.equal(body.appSlots, 3);
  assert.deepEqual(claimCalls.map((c) => c.n), [3]);
  assert.deepEqual(drained.jobs, [], "드레인(slots=0)이면 일감 없음, 신호·설정은 계속");
});

// ── 같은 앱 동시 실행 금지(서버 SQL) ──
test("claimJobs: 같은 앱은 앱마다 하나만, 이미 running 인 앱은 건너뜀, 가져가는 수는 slots", async () => {
  const { Prisma } = require("@prisma/client");
  const queries = [];
  const fakePrisma = {
    $queryRaw: async (q) => (queries.push(q), []),
    factoryJobLog: { createMany: async () => {} },
    factoryJob: { updateMany: async () => {} },
  };
  const jobs = loadTs("lib/factory/jobs.ts", {
    "@/lib/prisma": { __esModule: true, default: fakePrisma },
    "@/lib/factory/reviewVideo": { deleteReviewVideo: async () => {} },
    "@/lib/factory/mask": { maskSecrets: (v) => v },
    "@/lib/factory/ai": { AI_LABELS: {}, isAiEngine: () => true, readModelChoice: () => ({ ok: true, model: null }) },
    "@/lib/factory/settings": { getDefaultClaudeModel: async () => null },
    "@/lib/factory/toolBroker": { cleanToolRequests: () => [] },
    "@/lib/factory/handoff": { cleanHandoff: () => null },
  });
  await jobs.claimJobs("pc", 3, ["claude"]);
  assert.equal(queries.length, 1, "한 문장으로 가져감");
  const sql = queries[0].sql.replace(/\s+/g, " ");
  assert.match(sql, /PARTITION BY j\."appSlug"/, "앱마다 하나");
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM "factory_jobs" r WHERE r\."appSlug" = j\."appSlug" AND r\."status" = 'running'\)/, "이미 도는 앱은 건너뜀");
  assert.match(sql, /c\."rn" = 1/);
  assert.match(sql, /WHERE "status" = 'approved' AND "id" IN/, "UPDATE 에서 승인 상태를 다시 확인(같은 일감 두 번 가져가기 방지)");
  assert.match(sql, /ORDER BY c\."priority" DESC, c\."createdAt" ASC LIMIT/);
  assert.ok(queries[0].values.includes(3), "LIMIT 은 slots");
  assert.equal(Prisma.sql`x`.sql, "x");
});

// ── 감독 프로그램 규칙 ──
test("감독 프로그램: 서버 값이 우선, 범위 밖·없음이면 PC 값", () => {
  const pc = slots.pcSlots({ slots: 1 });
  assert.equal(slots.effectiveSlots({ server: 3, pc }), 3, "통제실에서 정한 값(기본 아님)은 PC 값을 이김");
  assert.equal(slots.effectiveSlots({ server: 4, serverIsDefault: false, pc: slots.pcSlots({ slots: 1 }) }), 4);
  for (const bad of [0, 5, 2.5, "x", null, undefined, NaN]) assert.equal(slots.effectiveSlots({ server: bad, pc: slots.pcSlots({ slots: 1 }) }), 1, `서버 ${bad} → PC`);
  assert.equal(slots.effectiveSlots({ server: undefined, pc: slots.pcSlots({}) }), 3, "예전 서버 + PC 설정 없음 = 기본 3");
});

test("감독 프로그램: 서버가 '정한 적 없음(기본 3)'이면 PC 에 따로 정한 값은 덮어쓰지 않음, init 이 적어 둔 예전 기본 2 는 3 으로", () => {
  const eff = (raw) => slots.effectiveSlots({ server: 3, serverIsDefault: true, pc: slots.pcSlots(raw) });
  assert.equal(eff({ slots: 1 }), 1, "PC 에 1 로 정함 → 유지");
  assert.equal(eff({ slots: 4 }), 4, "PC 에 4 로 정함 → 유지");
  assert.equal(eff({ slots: 3 }), 3);
  assert.equal(eff({ slots: 2 }), 3, "예전 기본값 2(init 이 적어 둠) → 새 기본 3");
  assert.equal(eff({}), 3, "PC 설정 없음 → 3");
  assert.equal(eff({ slots: 9 }), 3, "PC 값이 이상함 → 3");
  assert.equal(eff({ slots: "abc" }), 3);
  // 통제실에서 한 번이라도 저장하면(기본 아님) PC 에 따로 정한 값도 서버 값이 이긴다
  assert.equal(slots.effectiveSlots({ server: 2, serverIsDefault: false, pc: slots.pcSlots({ slots: 4 }) }), 2);
});

test("감독 프로그램: 요청할 자리 수 — 3개까지만, 줄이면 돌던 일감 유지(0), 늘리면 더 가져감, 정비 중 0", () => {
  const take = (limit, running, draining = false) => slots.planTake({ limit, running, draining });
  assert.equal(take(3, 0), 3);
  assert.equal(take(3, 1), 2);
  assert.equal(take(3, 3), 0, "꽉 참 → 일감은 안 받고 확인만");
  assert.equal(take(2, 3), 0, "3→2 로 줄였는데 3개 도는 중 → 음수 없이 0, 돌던 3개는 그대로");
  assert.equal(take(2, 2), 0);
  assert.equal(take(2, 1), 1, "끝나면서 줄어든 뒤에는 2개 한도에 맞게");
  assert.equal(take(3, 2), 1, "2→3 으로 늘리면 다음 확인에 1개 더");
  assert.equal(take(4, 1), 3);
  assert.equal(take(3, 0, true), 0, "업데이트·배포 대기(드레인) 중에는 자리가 남아도 0");
  assert.equal(slots.planTake({ limit: 3, running: 1, maintenanceBusy: true }), 2, "정비 중이라는 이유만으로는 줄이지 않음(예전 인자는 무시)");
  assert.equal(take(3, 5), 0);
});

test("감독 프로그램: 가짜 서버로 여러 번 확인 — 자리 3개를 넘지 않고, 값이 바뀌면 다음 확인부터 따라감", () => {
  // 서버 모델: 요청 수만큼 approved 에서 내주는 가짜 서버
  let approved = 6;
  let limit = 3;
  let running = 0;
  const poll = (serverAppSlots) => {
    limit = slots.effectiveSlots({ server: serverAppSlots, serverIsDefault: false, pc: slots.pcSlots({}) });
    const n = slots.planTake({ limit, running });
    const given = Math.min(n, approved);
    approved -= given;
    running += given;
    return given;
  };
  assert.equal(poll(3), 3);
  assert.equal(running, 3);
  assert.equal(poll(3), 0, "꽉 참");
  running -= 1; // 하나 끝남
  assert.equal(poll(3), 1);
  assert.equal(running, 3);
  assert.equal(poll(2), 0, "3→2: 돌던 3개 유지");
  assert.equal(running, 3);
  running -= 1;
  assert.equal(poll(2), 0, "아직 2개 도는 중 = 한도 2");
  running -= 1;
  assert.equal(poll(2), 1, "끝나면서 2개 한도에 맞춰짐");
  assert.equal(poll(4), 1, "2→4 로 늘리면 한 번 더 가져감");
  assert.equal(running, 3);
});

test("감독 프로그램 연결: 서버 값 적용·꽉 차도 확인·같은 앱 거부가 소스에 이어져 있음", () => {
  const src = read("tools/factory-supervisor/supervisor.mjs");
  assert.match(src, /import \{ DEFAULT_APP_SLOTS, effectiveSlots, pcSlots, planTake \} from "\.\/slots\.mjs"/);
  assert.match(src, /effectiveSlots\(\{ server: r\.data\?\.appSlots, serverIsDefault: r\.data\?\.appSlotsDefault === true, pc: cfg\.pcSlots \}\)/);
  assert.match(src, /planTake\(\{ limit: appLimit\(\), running: running\.size, draining: !!drain \|\| deployHold\(\) \}\)/);
  assert.doesNotMatch(src, /if \(free > 0\) \{/, "꽉 차면 확인을 건너뛰던 예전 코드가 남아 있지 않음");
  assert.doesNotMatch(src, /cfg\.slots - running\.size/);
  assert.match(src, /slots=\$\{take\}/);
  assert.match(src, /offered\.slice\(0, Math\.max\(0, free\)\)/, "서버가 자리보다 많이 줘도 자리만큼만 시작");
  assert.match(src, /some\(\(s\) => s\.job\.appSlug === job\.appSlug\)/, "같은 앱 이름이 이미 돌면 시작하지 않음");
  assert.match(src, /acquireWorkspace\(dir/, "앱 폴더 잠금");
});

// ── 화면 ──
const cards = loadTs("components/admin/factory/AppSlotsSettings.tsx", { "@heroui/react": { Button: ({ children, ...p }) => h("button", { type: "button", "aria-pressed": p["aria-pressed"], disabled: p.isDisabled, "data-slot-choice": p["data-slot-choice"], "data-slots-save": p["data-slots-save"] }, children) } });

test("설정 카드: 1~4 선택·저장·주의 한 줄·[사용량] 링크·감독 프로그램이 받아 가는 안내", () => {
  const html = renderToStaticMarkup(h(cards.default));
  for (const n of [1, 2, 3, 4]) assert.match(html, new RegExp(`data-slot-choice="${n}"`));
  assert.match(html, /data-slots-save/);
  assert.match(html, /동시에 만들 앱 수/);
  assert.match(html, /이 값은 감독 프로그램이 다음 확인 때 받아 가요/);
  assert.match(html, /동시에 많이 돌릴수록 PC 메모리·CPU 와 Claude\/Codex 한도를 빨리 써요/);
  assert.match(html, /한도가 돌리는 개수만큼\(3개면 3배 속도로\) 줄 수 있어요/);
  assert.match(html, /<a [^>]*data-slots-usage-link[^>]*href="\/admin\/factory\?tab=usage"/);
  assert.match(html, /한도 게이지와 장비 상태\(RAM\)/);
  assert.match(html, /같은 앱의 일감은 개수가 남아도 하나씩만/);
  assert.match(html, /정비가 대기·진행 중이면 새 앱 일감은 멈춰요/);
});

test("설정 카드 문구: 지금 진행 중 N / 최대 M, 값을 줄여 넘칠 때 안내, 예전 서버", () => {
  assert.equal(cards.slotsSummary({ appSlots: 3, appSlotsDefault: true, running: 2 }).live, "지금 진행 중 2 / 최대 3");
  assert.match(cards.slotsSummary({ appSlots: 3, appSlotsDefault: true, running: 2 }).current, /현재 3개 \(정한 적 없어서 기본값\)/);
  assert.equal(cards.slotsSummary({ appSlots: 2, appSlotsDefault: false, running: 0 }).current, "현재 2개");
  assert.equal(cards.slotsSummary({ appSlots: 3, running: 3 }).live, "지금 진행 중 3 / 최대 3");
  assert.match(cards.slotsSummary({ appSlots: 2, running: 3 }).over, /1개가 넘치지만 돌던 일감은 끊지 않고/);
  assert.equal(cards.slotsSummary({ appSlots: 3, running: 3 }).over, "");
  assert.equal(cards.slotsSummary({ running: 1 }).live, "지금 진행 중 1");
});

test("화면 연결: [설정] 탭에 카드, 감독 프로그램 카드에 '진행 중 / 최대'", () => {
  assert.match(read("components/admin/factory/FactoryConsole.tsx"), /<DefaultAiSettings \/>\n\s+<AppSlotsSettings \/>/);
  const sc = read("components/admin/factory/SupervisorControl.tsx");
  assert.match(sc, /<Count label="진행 중" max=\{s\.appSlots\}/);
  assert.match(sc, /data-count-max>\/ 최대 \{max\}/);
});

test("동시에 3개가 돌 때도 [현황] 띠에 3개 모두 보이고 '외 N개'는 안 나옴", () => {
  const fx = loadTs("components/admin/factory/fx.tsx");
  const aiLib = loadTs("lib/factory/ai.ts");
  const overview = loadTs("components/admin/factory/FactoryOverview.tsx", {
    "./fx": fx,
    "@/lib/factory/ai": aiLib,
    "./ClaudeModelSelect": loadTs("components/admin/factory/ClaudeModelSelect.tsx", { "@/lib/factory/ai": aiLib }),
  });
  const now = Date.parse("2026-10-13T12:00:00Z");
  const running = [1, 2, 3].map((n) => ({ type: "job", id: `cjob${n}`, title: `앱 일감 ${n}`, sub: `app-${n}`, kindLabel: "새 앱", startedAt: new Date(now - n * 60_000).toISOString(), aiEngine: "claude", aiModel: "opus" }));
  const html = renderToStaticMarkup(h(overview.ActiveStrip, { now, active: { running, queued: 2, next: { type: "job", title: "다음 일감" } } }));
  assert.equal((html.match(/data-active-item="job"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /data-active-more/);
  assert.match(html, /대기 2개 · 다음 차례: 다음 일감/);
  const four = renderToStaticMarkup(h(overview.ActiveStrip, { now, active: { running: [...running, { ...running[0], id: "cjob4", title: "넷째" }], queued: 0, next: null } }));
  assert.equal((four.match(/data-active-item="job"/g) ?? []).length, 3);
  assert.match(four, /외 1개 진행 중/);
});

test("문서: 동시에 2개까지 → 통제실에서 정하는 값(기본 3)으로 고침", () => {
  const readme = read("tools/factory-supervisor/README.md");
  assert.doesNotMatch(readme, /동시에 2개까지/);
  assert.match(readme, /동시에 3개까지/);
  assert.match(readme, /동시에 만들 앱 수/);
  const harness = read("docs/ai-harness.md");
  assert.doesNotMatch(harness, /동시에 2개까지/);
});
