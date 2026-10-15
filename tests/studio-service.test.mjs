// 스튜디오 ↔ 서비스(한 컷) 연결 시험: 권한 하나로 · 연결 상태(10분 캐시) · 인증서 만료 경고 · 서비스 API 없음 대체 · 검수(후보 승인·반려·다시) · 그림 자체 보관(복사) · 고정 그림 실패 처리.
// 실행: npm run test:studio-service   (가짜 DB·가짜 서비스·가짜 텔레그램. 실제 DB·키·외부 네트워크 없음)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");

const cache = new Map();
function resolveSource(name) {
  const base = name.startsWith("@/") ? name.slice(2) : name;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (fs.existsSync(path.join(repo, base + ext))) return base + ext;
  throw new Error(`못 찾음: ${name}`);
}
function load(rel, overrides = {}) {
  const useCache = Object.keys(overrides).length === 0;
  if (useCache && cache.has(rel)) return cache.get(rel);
  const output = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const req = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith("@/")) return load(resolveSource(name), overrides);
    return require(name);
  };
  new Function("require", "module", "exports", output)(req, module, module.exports);
  if (useCache) cache.set(rel, module.exports);
  return module.exports;
}

const SECRET = "tok-super-secret-value-1234567890";
const NOW = Date.parse("2026-10-15T00:00:00Z");
const DAY = 24 * 3600 * 1000;
const noPrisma = { "@/lib/prisma": { __esModule: true, default: {} }, "@/lib/factory/secretEntries": { readServerSecret: async () => null } };
const reviewStatus = load("lib/factory/reviewStatus.ts", noPrisma);
const baseOv = { "@/lib/factory/reviewStatus": reviewStatus };
const service = load("lib/studio/service.ts", baseOv);

// 가짜 DB: factorySetting(상태 저장) · factoryServiceAction(기록) · factorySecretEntry(키 등록 여부)
function fakeDb(secrets = []) {
  const settings = new Map();
  const actions = [];

  return {
    settings,
    actions,
    prisma: {
      factorySetting: {
        findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
        upsert: async ({ where, create, update }) => settings.set(where.key, settings.has(where.key) ? update.value : create.value),
      },
      factoryServiceAction: { create: async ({ data }) => (actions.push({ ...data, id: `a${actions.length + 1}`, createdAt: new Date("2026-10-15T02:00:00Z") }), data), findMany: async () => [...actions].reverse() },
      factorySecretEntry: { findMany: async ({ where }) => secrets.filter((n) => where.name.in.includes(n)).map((name) => ({ name })) },
    },
  };
}
function loadHealth(db, extra = {}) {
  return load("lib/studio/serviceHealth.ts", { ...baseOv, "@/lib/studio/service": service, "@/lib/prisma": { __esModule: true, default: db.prisma }, ...extra });
}
const okRes = (status = 200, body = "{}") => ({ status, body: null, text: async () => body });
const tlsOk = (days) => async () => ({ validTo: new Date(NOW + days * DAY + DAY / 2).toISOString(), authorized: true, error: null }); // 하루의 절반 여유(확인하는 데 걸린 시간에 흔들리지 않게)
const hdeps = (over = {}) => ({ base: "https://hancut.example.com", lookupImpl: async () => ["93.184.216.34"], tlsProbe: tlsOk(60), readSecret: async () => SECRET, keysReady: async () => new Set(["REVIEW_STATUS_TOKEN_ONE_TINY_FRAME", "SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME"]), fetchImpl: async () => okRes(), now: () => NOW, ...over });
const certExpired = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" }) });

// ───────── 권한 하나로 ─────────

test("권한: 서비스 호출은 관리자 세션만(라우트 첫 줄), 쓰기는 같은 출처 + 확인, 키는 서버 안에서만", () => {
  const route = read("app/api/studio/service/route.ts");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  const post = route.slice(route.indexOf("export async function POST"));

  for (const body of [get, post]) assert.match(body.slice(0, 160), /requireAdmin\(\)/, "관리자 확인이 맨 앞");
  assert.match(post, /isSameOriginRequest/, "다른 사이트에서 쿠키로 보낸 요청은 거절");
  assert.match(post, /confirmed: body\.confirmed/, "확인 여부를 서버가 다시 본다");
  // 키 값은 서버 파일에서만 읽고, 화면 코드·응답에는 없다
  for (const f of fs.readdirSync(path.join(repo, "components/studio"))) {
    const src = read(`components/studio/${f}`);

    assert.doesNotMatch(src, /SERVICE_ADMIN_TOKEN_[A-Z_]+["'`]\s*\)/, `${f}: 키 값을 읽지 않음`);
    assert.doesNotMatch(src, /readServerSecret|secretEntries|process\.env/, `${f}: 키 보관소·환경변수를 읽지 않음`);
  }
  assert.match(read("lib/studio/serviceOps.ts"), /callServiceApi/, "서비스 호출기는 서버 쪽 서비스 모듈만 쓴다");
});

test("권한: 관리자 세션이면 연결 설정 스위치와 상관없이 서비스 운영 메뉴가 열리고, 접근 키 사용자는 스위치를 따른다", () => {
  const page = read("app/studio/[app]/page.tsx");

  assert.match(page, /const adminService = viewer\.kind === "admin" && !!serviceProfileOf\(app\)/);
  assert.match(page, /studioService: flags\.studioService \|\| adminService/);
  assert.match(page, /includeService: adminService/);
  const dash = load("lib/studio/dashboard.ts");

  assert.equal(dash.visibleOpsMenu({ studioBatch: false, studioService: false }).some((m) => m.key === "service"), false, "스위치가 꺼져 있으면 보통은 숨김");
  assert.equal(dash.visibleOpsMenu({ studioBatch: false, studioService: true }).some((m) => m.key === "service"), true);
  // 앱별 Studio 접근 키 사용자는 지금처럼 읽기 전용(고치는 API 는 관리자만)
  assert.match(read("lib/studio/pageAccess.ts"), /읽기 전용\(고치는 API 는 관리자만\)/);
  assert.match(read("app/api/studio/ops/route.ts"), /requireAdmin/);
});

// ───────── 연결 상태 ─────────

test("연결 상태: 도메인 응답 시간·인증서 만료일·키 등록·health API·마지막 확인 시각을 모은다", async () => {
  const db = fakeDb();
  const mod = loadHealth(db);
  let t = NOW;
  const calls = [];
  const h = await mod.probeServiceHealth("one-tiny-frame", "https://hancut.example.com", hdeps({
    now: () => (t += 40),
    fetchImpl: async (u, init) => {
      calls.push([u, init?.headers?.Authorization]);

      return u.endsWith("/api/admin/health") ? okRes(200, JSON.stringify({ ok: true, version: "1.4.0", db: "up", secretToken: "x".repeat(10) })) : okRes(200);
    },
  }));

  assert.equal(h.base, "hancut.example.com");
  assert.equal(h.domain.state, "ok");
  assert.equal(typeof h.domain.ms, "number");
  assert.equal(h.cert.state, "ok");
  assert.equal(h.cert.daysLeft, 60);
  assert.equal(h.keys.review.ready, true);
  assert.equal(h.keys.admin.name, "SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME");
  assert.equal(h.api.state, "ok");
  assert.deepEqual(h.api.info, { ok: true, version: "1.4.0", db: "up" }, "화면에 줄 짧은 값만(그 밖의 필드는 버림)");
  assert.ok(h.checkedAt.startsWith("2026-10-15"));
  assert.deepEqual(calls.map((c) => c[0]), ["https://hancut.example.com/", "https://hancut.example.com/api/admin/health"]);
  assert.equal(calls[1][1], `Bearer ${SECRET}`, "health 는 서비스 관리자 키로 서버가 부른다");
  assert.equal(JSON.stringify(h).includes(SECRET), false, "키 값은 결과에 없다");
});

test("연결 상태: 키가 없으면 '키 등록 필요', 도메인이 안 뜨면 건너뛰고 이유, 사설망·주소 없음은 부르지 않는다", async () => {
  const mod = loadHealth(fakeDb());
  const nokey = await mod.probeServiceHealth("one-tiny-frame", "https://hancut.example.com", hdeps({ readSecret: async () => null, keysReady: async () => new Set() }));

  assert.equal(nokey.api.state, "need-key");
  assert.match(nokey.api.text, /키 등록 필요: SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME/);
  assert.equal(nokey.keys.admin.ready, false);
  const down = await mod.probeServiceHealth("one-tiny-frame", "https://hancut.example.com", hdeps({ fetchImpl: async () => { throw new TypeError("fetch failed"); } }));

  assert.equal(down.domain.state, "down");
  assert.match(down.domain.text, /응답 없음/);
  assert.equal(down.api.state, "skipped");
  const priv = await mod.probeServiceHealth("one-tiny-frame", "https://hancut.example.com", hdeps({ lookupImpl: async () => ["10.0.0.4"], fetchImpl: async () => assert.fail("부르면 안 된다") }));

  assert.equal(priv.domain.state, "blocked");
  const none = await mod.probeServiceHealth("one-tiny-frame", null, hdeps({ fetchImpl: async () => assert.fail("부르면 안 된다") }));

  assert.equal(none.domain.state, "no-base");
  const five = await mod.probeServiceHealth("one-tiny-frame", "https://hancut.example.com", hdeps({ fetchImpl: async (u) => (u.endsWith("/") ? okRes(503) : okRes(200)) }));

  assert.equal(five.domain.state, "error");
});

test("서비스 API 없음: health 가 404 면 '서비스 API 없음', 오류로 화면이 깨지지 않고 읽기·쓰기 모두 no-api", async () => {
  const mod = loadHealth(fakeDb());
  const h = await mod.probeServiceHealth("one-tiny-frame", "https://hancut.example.com", hdeps({ fetchImpl: async (u) => (u.includes("/api/admin/") ? okRes(404) : okRes(200)) }));

  assert.equal(h.api.state, "no-api");
  assert.equal(h.api.text, "서비스 API 없음");
  assert.equal(h.domain.state, "ok", "도메인이 응답하는 것과 API 없음은 따로 보여 준다");
  const ops = load("lib/studio/serviceOps.ts", { ...baseOv, "@/lib/studio/service": service });
  const deps = { readSecret: async () => SECRET, fetchImpl: async () => okRes(404) };
  const ctx = { appSlug: "one-tiny-frame", base: "https://hancut.example.com", deps };

  assert.deepEqual(await ops.readPipeline(ctx), { state: "no-api" });
  assert.deepEqual(await ops.readGenLog(ctx), { state: "no-api" });
  assert.deepEqual(await ops.readCandidates(ctx, "review"), { state: "no-api" });
  const rec = [];
  const w = await ops.runServiceWrite(ctx, { action: "schedule-on", confirmed: true, who: "관리자A" }, { record: async (r) => void rec.push(r) });

  assert.equal(w.ok, false);
  assert.equal(w.noApi, true);
  assert.match(w.message, /서비스 API 없음/);
  assert.equal(rec.length, 1, "못 했어도 시도는 기록한다");
  assert.equal(rec[0].ok, false);
});

// ───────── 10분 캐시 ─────────

test("상태 캐시: 10분 안에는 서비스를 다시 부르지 않고, [지금 확인](force)이나 10분이 지나면 새로 확인, 마지막 결과는 저장된다", async () => {
  const db = fakeDb();
  const mod = loadHealth(db);
  let probes = 0;
  const deps = (now) => hdeps({ now: () => now, fetchImpl: async (u) => (u.endsWith("/") && ++probes ? okRes() : okRes()) });

  mod.resetHealthCache();
  const a = await mod.getServiceHealth("one-tiny-frame", { deps: deps(NOW) });

  assert.equal(probes, 1);
  const b = await mod.getServiceHealth("one-tiny-frame", { deps: deps(NOW + 9 * 60_000) });

  assert.equal(probes, 1, "9분 뒤에는 저장된 결과");
  assert.equal(b.checkedAt, a.checkedAt);
  await mod.getServiceHealth("one-tiny-frame", { force: true, deps: deps(NOW + 9 * 60_000) });
  assert.equal(probes, 2, "[지금 확인]은 캐시를 건너뜀");
  await mod.getServiceHealth("one-tiny-frame", { deps: deps(NOW + 9 * 60_000 + 11 * 60_000) });
  assert.equal(probes, 3, "10분이 지나면 새로 확인");
  assert.ok(db.settings.has("serviceHealth:one-tiny-frame"), "마지막 결과를 저장");
  assert.equal(db.settings.get("serviceHealth:one-tiny-frame").includes(SECRET), false);
  // 서버가 다시 떠도(메모리 비움) 10분 안이면 저장된 결과를 쓴다
  mod.resetHealthCache();
  const c = await mod.getServiceHealth("one-tiny-frame", { deps: deps(NOW + 9 * 60_000 + 11 * 60_000 + 60_000) });

  assert.equal(probes, 3);
  assert.equal(c.appSlug, "one-tiny-frame");
  assert.equal(await mod.getServiceHealth("other-app"), null, "서비스 확인표가 없는 프로젝트는 확인하지 않는다");
  assert.equal((await mod.peekServiceHealth("one-tiny-frame")).appSlug, "one-tiny-frame");
});

// ───────── 인증서 만료 ─────────

test("인증서: 14일 이하 경고, 만료는 빨강, 15일 이상 정상, 모르면 unknown", () => {
  const mod = loadHealth(fakeDb());

  assert.equal(mod.certState(15), "ok");
  assert.equal(mod.certState(14), "warn");
  assert.equal(mod.certState(0), "warn");
  assert.equal(mod.certState(-1), "expired");
  assert.equal(mod.certState(null), "unknown");
  assert.equal(mod.daysUntil("2026-10-25T00:00:00Z", NOW), 10);
  assert.equal(mod.daysUntil("2026-10-01T00:00:00Z", NOW), -14);
  assert.match(mod.certText(10, "2026-10-25T00:00:00.000Z"), /남은 10일/);
  assert.match(mod.certText(-3, "2026-10-12T00:00:00.000Z"), /만료됨/);
});

test("인증서: 도메인 접속이 인증서 만료로 실패하면 도메인 '응답 없음 — 인증서 만료' + 인증서 빨강(만료일을 못 읽어도)", async () => {
  const mod = loadHealth(fakeDb());
  const h = await mod.probeServiceHealth("one-tiny-frame", "https://hancut.example.com", hdeps({ tlsProbe: tlsOk(-5), fetchImpl: async () => { throw certExpired(); } }));

  assert.equal(h.domain.state, "down");
  assert.match(h.domain.text, /인증서 만료/);
  assert.equal(h.cert.state, "expired");
  assert.equal(h.cert.daysLeft, -5);
  const unread = await mod.probeServiceHealth("one-tiny-frame", "https://hancut.example.com", hdeps({ tlsProbe: async () => ({ validTo: null, authorized: false, error: "시간 초과" }), fetchImpl: async () => { throw certExpired(); } }));

  assert.equal(unread.cert.state, "expired");
});

test("인증서 경고: 7일 이하(만료 포함)면 텔레그램에 한 번(같은 만료일이면 같은 이름), 8일 이상이면 알리지 않음, 갱신하면 새로 알림", async () => {
  const db = fakeDb();
  const sent = [];
  const claimed = new Set();
  const tg = { notifyOnce: async (key, text, p) => { if (claimed.has(key)) return false; claimed.add(key); sent.push({ key, text, path: p }); return true; } };
  const mod = loadHealth(db, { "@/lib/factory/telegram": tg });

  mod.resetHealthCache();
  await mod.tickServiceHealth(NOW, true, hdeps({ tlsProbe: tlsOk(8) }));
  assert.equal(sent.length, 0, "8일 남으면 알리지 않는다(화면 경고만)");
  await mod.tickServiceHealth(NOW + 11 * 60_000, true, hdeps({ tlsProbe: tlsOk(8), now: () => NOW + 11 * 60_000 }));
  assert.equal(sent.length, 0);
  const near = (offset) => async () => ({ validTo: new Date(NOW + 5 * DAY).toISOString(), authorized: true, error: null });

  await mod.tickServiceHealth(NOW + 1 * DAY, true, hdeps({ tlsProbe: near(), now: () => NOW + 1 * DAY }));
  await mod.tickServiceHealth(NOW + 1 * DAY + 11 * 60_000, true, hdeps({ tlsProbe: near(), now: () => NOW + 1 * DAY + 11 * 60_000 }));
  assert.equal(sent.length, 1, "같은 인증서는 몇 번 확인해도 한 번만");
  assert.equal(sent[0].key, "servicecert:one-tiny-frame:2026-10-20");
  assert.match(sent[0].text, /4일 뒤/);
  assert.match(sent[0].path, /\/studio\/one-tiny-frame\?tab=ops&sub=service/);
  await mod.tickServiceHealth(NOW + 20 * DAY, true, hdeps({ tlsProbe: async () => ({ validTo: new Date(NOW + 19 * DAY).toISOString(), authorized: true, error: null }), now: () => NOW + 20 * DAY }));
  assert.equal(sent.length, 2, "만료됐으면 만료 알림");
  assert.match(sent[1].text, /만료됐어요/);
  assert.equal(JSON.stringify(sent).includes(SECRET), false);
  // 10분 안에 또 부르면 확인하지 않는다
  const before = db.settings.get("serviceHealth:one-tiny-frame");

  await mod.tickServiceHealth(NOW + 20 * DAY + 60_000, false, hdeps({ fetchImpl: async () => assert.fail("10분 안에는 다시 확인하지 않는다") }));
  assert.equal(db.settings.get("serviceHealth:one-tiny-frame"), before);
});

test("통제실 할 일: 인증서 7일 이하·만료가 막힘 항목으로, 8일 이상은 항목 없음, 텔레그램 이름은 만료일 기준", () => {
  const mod = loadHealth(fakeDb());
  const inbox = load("lib/factory/inbox.ts", { ...baseOv, "@/lib/studio/service": service, "@/lib/studio/serviceHealth": mod, "@/lib/prisma": { __esModule: true, default: {} }, "@/lib/factory/cards": {}, "@/lib/factory/parallel": {}, "@/lib/factory/secretEntries": {}, "@/lib/factory/toolManifestDb": {}, "@/lib/factory/toolManifest": {}, "@/lib/factory/telegram": {}, "@/lib/factory/inboxNotice": {} });
  const facts = (serviceCerts) => ({ failedJobs: [], jobsWithKeys: [], cardsWithKeys: [], registered: new Set(), groupJobs: [], studioReview: [], serviceCerts });
  const items = inbox.buildInboxItems(facts([{ appSlug: "one-tiny-frame", name: "하찮은 한 컷 서버", daysLeft: 5, validTo: "2026-10-20T00:00:00.000Z" }, { appSlug: "x-app", name: "엑스", daysLeft: -2, validTo: "2026-10-13T00:00:00.000Z" }]));

  assert.deepEqual(items.map((i) => i.kind), ["service_cert", "service_cert"]);
  const near = items.find((i) => i.appSlug === "one-tiny-frame");
  const gone = items.find((i) => i.appSlug === "x-app");

  assert.equal(near.tier, "blocked");
  assert.match(near.title, /인증서 만료 임박.*5일/);
  assert.match(gone.title, /인증서 만료:/);
  assert.equal(items[0].appSlug, "x-app", "더 급한(만료된) 것이 먼저");
  assert.equal(near.noticeKey, "servicecert:one-tiny-frame:2026-10-20");
  assert.match(near.actions[0].href, /\/studio\/one-tiny-frame\?tab=ops&sub=service/);
  assert.deepEqual(inbox.buildInboxItems(facts([])), []);
  assert.deepEqual(inbox.buildInboxItems(facts(undefined)), [], "옛 호출 모양도 그대로 동작");
  assert.match(read("lib/factory/inbox.ts"), /"servicecert:"\]\)/, "사라진 할 일의 알림 기록은 지운다");
  assert.match(read("app/api/factory/next/route.ts"), /void tickServiceHealth\(\)/);
});

// ───────── 검수(서비스 후보) ─────────

test("검수: 후보 목록을 그림 주소와 함께 읽고(https 만), 승인·반려·다시는 확인이 있어야 하고 서비스 관리자 키로 불러 기록한다", async () => {
  const ops = load("lib/studio/serviceOps.ts", { ...baseOv, "@/lib/studio/service": service });
  const calls = [];
  const deps = {
    readSecret: async () => SECRET,
    fetchImpl: async (u, init) => {
      calls.push({ u, method: init.method, auth: init.headers.Authorization, body: init.body });
      if (u.includes("/api/admin/candidates")) return okRes(200, JSON.stringify({ items: [{ id: "cut1", line: "오늘도 한 컷", image: "p/1.png", imageUrl: "/files/cut1.png", status: "review", days: 2 }, { id: "cut2", line: "http 그림", imageUrl: "http://x.example/a.png", status: "review" }, { id: "bad id!", line: "나쁜 id" }] }));

      return okRes(200, JSON.stringify({ ok: true }));
    },
  };
  const ctx = { appSlug: "one-tiny-frame", base: "https://hancut.example.com", deps };
  const list = await ops.readCandidates(ctx, "review");

  assert.equal(list.state, "ok");
  assert.deepEqual(list.value.map((c) => [c.id, c.imageUrl]), [["cut1", "https://hancut.example.com/files/cut1.png"], ["cut2", null]], "서비스 주소 기준으로 풀고 https 만, 이상한 id 는 버림");
  assert.equal((await ops.readCandidates(ctx, "nope")).state, "error");
  const rec = [];
  const audit = { record: async (r) => void rec.push(r) };
  const noConfirm = await ops.runServiceWrite(ctx, { action: "approve", id: "cut1", who: "관리자A" }, audit);

  assert.equal(noConfirm.ok, false);
  assert.equal(noConfirm.status, 400);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0, "확인 없이는 서비스를 부르지 않는다");
  assert.equal(rec.length, 0);
  for (const action of ["approve", "reject", "retry"]) {
    const r = await ops.runServiceWrite(ctx, { action, id: "cut1", confirmed: true, who: "관리자A" }, audit);

    assert.equal(r.ok, true, action);
  }
  const posts = calls.filter((c) => c.method === "POST");

  assert.deepEqual(posts.map((c) => c.u), ["approve", "reject", "retry"].map((a) => `https://hancut.example.com/api/admin/cuts/cut1/${a}`));
  assert.ok(posts.every((c) => c.auth === `Bearer ${SECRET}`));
  assert.deepEqual(rec.map((r) => [r.action, r.target, r.who, r.ok]), [["approve", "cut1", "관리자A", true], ["reject", "cut1", "관리자A", true], ["retry", "cut1", "관리자A", true]], "누가 무엇을 했는지 기록");
  assert.equal(JSON.stringify(rec).includes(SECRET), false);
  // 입력 검사
  assert.equal((await ops.runServiceWrite(ctx, { action: "approve", id: "../x", confirmed: true, who: "a" }, audit)).status, 400);
  assert.equal((await ops.runServiceWrite(ctx, { action: "run", kind: "evil", confirmed: true, who: "a" }, audit)).status, 400);
  assert.equal((await ops.runServiceWrite(ctx, { action: "run", kind: "draw", lines: 9999, confirmed: true, who: "a" }, audit)).status, 400);
  const run = await ops.runServiceWrite(ctx, { action: "run", kind: "draw", lines: 5, confirmed: true, who: "관리자A" }, audit);

  assert.equal(run.ok, true);
  assert.deepEqual(JSON.parse(calls.at(-1).body), { kind: "draw", lines: 5 });
  await ops.runServiceWrite(ctx, { action: "schedule-off", confirmed: true, who: "관리자A" }, audit);
  assert.equal(calls.at(-1).u, "https://hancut.example.com/api/admin/pipeline/auto");
  assert.deepEqual(JSON.parse(calls.at(-1).body), { on: false });
  // 키가 없으면 멈춘다
  const nokey = await ops.runServiceWrite({ ...ctx, deps: { ...deps, readSecret: async () => null } }, { action: "approve", id: "cut1", confirmed: true, who: "a" }, audit);

  assert.equal(nokey.ok, false);
  assert.match(nokey.message, /키 등록 필요: SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME/);
  // 인증서 만료는 이유가 보인다
  const expired = await ops.runServiceWrite({ ...ctx, deps: { ...deps, fetchImpl: async () => { throw certExpired(); } } }, { action: "approve", id: "cut1", confirmed: true, who: "a" }, audit);

  assert.match(expired.message, /인증서 만료/);
});

// ───────── 마이그레이션 ─────────

test("마이그레이션: 서비스 동작 기록 표만 추가하고 기존 데이터를 지우지 않는다(그림 저장소는 바꾸지 않는다)", () => {
  const sql = read("prisma/migrations/20261120090000_studio_service_link/migration.sql");

  assert.equal(/(DROP|DELETE|TRUNCATE|UPDATE)/i.test(sql), false, "기존 데이터를 지우거나 바꾸지 않는다");
  assert.match(sql, /CREATE TABLE "factory_service_actions"/);
  assert.equal(/factory_arts/.test(sql), false, "그림 저장소는 바꾸지 않는다");
});

// ───────── 연결·안전 ─────────

test("안전: nginx·.env·인증서 파일·서비스 DB 를 건드리지 않고, 새 서버 코드는 파일·프로세스를 쓰지 않는다", () => {
  for (const f of ["lib/studio/serviceHealth.ts", "lib/studio/serviceOps.ts", "app/api/studio/service/route.ts"]) {
    const src = read(f).replace(/\/\/.*$/gm, "");

    assert.equal(/from "node:fs"|from "fs"|child_process|writeFile|nginx|\.env\.local|certbot/.test(src), false, `${f}: 파일·프로세스·nginx 를 건드리지 않는다`);
  }
  // 인증서는 읽기만(만료일 조회), 검증을 끄는 곳은 이 한 곳뿐이고 데이터를 보내지 않는다
  const health = read("lib/studio/serviceHealth.ts");

  assert.equal((health.match(/rejectUnauthorized: false/g) ?? []).length, 1);
  assert.match(health, /읽기만 하고 데이터는 보내지 않는다/);
  assert.match(read("docs/studio-service-api.md"), /키 등록 순서/);
});
