// 1-2 D-2 시험(서버 쪽): 감독 업데이트 때 "일시 중지 → 업데이트 → 이어서"를 위한 홈페이지 쪽 장치.
//  - 설정 '업데이트 묶는 시간'(0~180분, 기본 60): 검증·저장·관리자 API(범위 밖은 400)
//  - /next: 묶는 시간을 내려 주고, 감독이 알린 '일시 중지 N개'·'묶는 중 남은 n분'을 걸러 받는다
//  - 통제실·정비·커넥터 표시: '업데이트로 일시 중지 N개', '업데이트 대기(묶는 중, 남은 n분)'
//  - '다시 시작 필요'(failStage=resume): 텔레그램 문구와 통제실 카드 표시
// 가짜 DB·가짜 요청으로만 돌린다. 실행: node tests/update-pause.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { NextRequest, NextResponse } = require("next/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");

const anything = () => new Proxy(function () {}, { get: (t, k) => (k === "__esModule" ? true : k === "then" ? undefined : anything()), apply: () => anything() });
function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const req = (name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : name.startsWith("@/") ? anything() : require(name));
  new Function("require", "module", "exports", output)(req, module, module.exports);
  return module.exports;
}

// ── 가짜 설정 저장소 ──
const store = new Map();
const prisma = {
  factorySetting: {
    findUnique: async ({ where }) => (store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null),
    upsert: async ({ where, create, update }) => (store.set(where.key, store.has(where.key) ? update.value : create.value), {}),
    deleteMany: async () => ({ count: 0 }),
  },
};
const settings = loadTs("lib/factory/settings.ts", {
  "@/lib/prisma": { __esModule: true, default: prisma },
  "@/lib/factory/ai": { isAiEngine: () => true, isClaudeModel: () => true },
  "@/lib/factory/toolBroker": { isToolBrokerMode: () => true, normalizeToolBroker: (v) => v, readStoredToolBroker: () => null, TOOL_BROKER_LIMITS_VERSION: 1 },
});

test("업데이트 묶는 시간 값 검증: 0~180 정수만(숫자 또는 정수 문자열), 나머지는 버림", () => {
  for (const ok of [0, 1, 60, 180, "45", " 7 "]) assert.notEqual(settings.cleanUpdateBundle(ok), null, String(ok));
  assert.equal(settings.cleanUpdateBundle("45"), 45);
  for (const bad of [-1, 181, 1.5, "", "abc", "1e2", null, undefined, true, NaN, [], {}]) assert.equal(settings.cleanUpdateBundle(bad), null, String(bad));
  assert.equal(settings.MIN_UPDATE_BUNDLE, 0);
  assert.equal(settings.MAX_UPDATE_BUNDLE, 180);
  assert.equal(settings.DEFAULT_UPDATE_BUNDLE, 60);
});

test("업데이트 묶는 시간 설정: 기본 60분(isDefault), 저장하면 그 값, 0도 값, 이상한 저장값은 기본값", async () => {
  store.clear();
  assert.deepEqual(await settings.getUpdateBundleMin(), { value: 60, isDefault: true });
  await settings.setUpdateBundleMin(0);
  assert.deepEqual(await settings.getUpdateBundleMin(), { value: 0, isDefault: false });
  await settings.setUpdateBundleMin(180);
  assert.equal((await settings.getUpdateBundleMin()).value, 180);
  store.set("updateBundleMin", "999");
  assert.deepEqual(await settings.getUpdateBundleMin(), { value: 60, isDefault: true });
  store.clear();
});

// ── 관리자 API ──
let admin = true;
const snapshot = async () => ({ running: 0, updateBundleMin: (await settings.getUpdateBundleMin()).value });
const controlRoute = loadTs("app/api/admin/factory/control/route.ts", {
  "@/lib/factory/admin": { requireAdmin: async () => (admin ? null : NextResponse.json({ message: "관리자만" }, { status: 403 })) },
  "@/lib/factory/ai": { isAiEngine: () => false, AI_LABELS: {}, readModelChoice: () => ({ ok: false, message: "" }) },
  "@/lib/factory/settings": settings,
  "@/lib/factory/toolBroker": { isToolBrokerMode: () => false, TOOL_BROKER_MODE_LABELS: {}, toolBrokerLimitLabel: () => "" },
  "@/lib/factory/supervisor": { supervisorSnapshot: snapshot, runSupervisorAction: async () => ({ message: "", snapshot: {} }) },
});
const post = (body) => new NextRequest("http://x/api/admin/factory/control", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

test("관리자 API: 비관리자는 막히고, 관리자는 0~180 정수만 저장(범위 밖은 400)", async () => {
  store.clear();
  admin = false;
  assert.equal((await controlRoute.POST(post({ updateBundleMin: 30 }))).status, 403);
  assert.equal(store.has("updateBundleMin"), false);
  admin = true;
  const res = await controlRoute.POST(post({ updateBundleMin: 30 }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.updateBundleMin, 30);
  assert.match(body.message, /최대 30분 모았다가 한 번에 받도록 저장/);
  assert.match(body.message, /공장이 비어 있으면 바로/);
  assert.equal(store.get("updateBundleMin"), "30");
  const zero = await (await controlRoute.POST(post({ updateBundleMin: 0 }))).json();
  assert.match(zero.message, /묶지 않고 바로 받도록/);
  assert.equal(store.get("updateBundleMin"), "0");
  for (const bad of [-1, 181, 2.5, null, true, "abc"]) {
    const r = await controlRoute.POST(post({ updateBundleMin: bad }));
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.match((await r.json()).message, /0~180분 사이 정수/);
  }
  assert.equal(store.get("updateBundleMin"), "0", "잘못된 값은 저장 안 함");
  store.clear();
});

// ── /next ──
const runtimeCalls = [];
let bundleSetting = { value: 60, isDefault: true };
const nextRoute = loadTs("app/api/factory/next/route.ts", {
  "@/lib/factory/toolJobsDb": { claimToolJobs: async () => [], getToolSettings: async () => ({ autoApprove: false, concurrency: 2 }) },
  "@/lib/factory/toolJobs": { TOOL_KIND: "tool" },
  "@/lib/factory/jobs": { MAX_SLOTS: 4, WORKER_RE: /^[A-Za-z0-9._-]{1,60}$/, releaseExpiredLeases: async () => {}, claimJobs: async () => [] },
  "@/lib/factory/http": { fail: (status, message) => NextResponse.json({ message }, { status }), guardWorker: async () => null },
  "@/lib/factory/settings": {
    getParallelPerApp: async () => ({ value: 2, isDefault: true }),
    getApprovalWaitSec: async () => ({ value: 0, isDefault: false }),
    getUpdateBundleMin: async () => bundleSetting,
    consumeRestart: async () => false,
    consumeUpdateNow: async () => false,
    getDefaultAiEngine: async () => "claude",
    getToolBrokerSettings: async () => undefined,
    isAutoUpdateEnabled: async () => true,
    isCompactAfterJobEnabled: async () => true,
    isSupervisorEnabled: async () => true,
    saveSupervisorInfo: async () => {},
    getAppSlots: async () => ({ value: 3, isDefault: true }),
  },
  "@/lib/factory/supervisor": { noteSupervisorRuntime: async (pc) => void runtimeCalls.push(pc) },
  "@/lib/factory/ai": { workerEngines: () => ["claude"] },
  "@/lib/factory/maintenance": { maintenanceForNext: async () => ({}) },
  "@/lib/factory/conductor": { appsToHold: async () => new Set(), appsWaitingForApproval: async () => new Map(), conductorTaskForNext: async () => null, isAutoGroupEnabled: async () => false },
  "@/lib/factory/appChecks": { getAppChecks: async () => ({}) },
  "@/lib/factory/rules": { getRuleOverrides: async () => ({}), renderRules: () => ({}) },
  "@/lib/factory/lab": { labCleanupForNext: async () => [], LAB_KIND: "lab" },
  "@/lib/factory/toolBroker": { toolBrokerForSupervisor: (v) => v },
  "@/lib/factory/release": { consumeKeyScan: async () => false, notifyTestingDue: async () => {}, pcPathsToCheck: async () => [], releaseJobExtras: async () => new Map() },
  "@/lib/factory/keyPasswords": { keyPasswordsPending: async () => false },
  "@/lib/factory/keyProvision": { provisionPending: async () => false },
  "@/lib/factory/secretEntries": { secretEntriesPending: async () => false },
  "@/lib/factory/keyVault": { keyTasksForNext: async () => [] },
  "@/lib/factory/reviewVideo": { sweepReviewVideos: async () => {} },
  "@/lib/factory/uploadTest": { consumeUploadTest: async () => null },
  "@/lib/studio/opsData": { tickSchedules: async () => {} },
  "@/lib/factory/projectToolSettingsDb": { projectSettingsForNext: async () => new Map() },
  "@/lib/factory/arts": { approvedForNext: async () => new Map(), pickedForJobs: async () => new Map() },
});
const next = (q) => nextRoute.GET(new NextRequest(`http://x/api/factory/next?worker=mainpc&started=2026-10-15T00:00:00.000Z&${q}`));

test("/next: 묶는 시간(updateBundleMin)을 내려 주고, 0도 그대로 내려 준다", async () => {
  bundleSetting = { value: 60, isDefault: true };
  assert.equal((await (await next("slots=1")).json()).updateBundleMin, 60);
  bundleSetting = { value: 0, isDefault: false };
  assert.equal((await (await next("slots=1")).json()).updateBundleMin, 0, "0 = 묶지 않고 바로 받기");
  bundleSetting = { value: 180, isDefault: false };
  assert.equal((await (await next("slots=1")).json()).updateBundleMin, 180);
});

test("/next: 일시 중지 N개·묶는 중 남은 분을 걸러 받는다(양의 정수만, 99·180 상한), 없으면 지운다", async () => {
  await next("slots=0&pausedJobs=2&bundleLeft=35");
  assert.equal(runtimeCalls.at(-1).pausedJobs, 2);
  assert.equal(runtimeCalls.at(-1).bundleLeft, 35);
  await next("slots=0&pausedJobs=500&bundleLeft=9999");
  assert.equal(runtimeCalls.at(-1).pausedJobs, 99);
  assert.equal(runtimeCalls.at(-1).bundleLeft, 180);
  await next("slots=0&pausedJobs=-1&bundleLeft=abc");
  assert.equal(runtimeCalls.at(-1).pausedJobs, undefined);
  assert.equal(runtimeCalls.at(-1).bundleLeft, undefined);
  await next("slots=3");
  assert.equal(runtimeCalls.at(-1).pausedJobs, undefined, "다시 켜져 이어 주고 나면 표시가 지워진다");
  assert.equal(runtimeCalls.at(-1).bundleLeft, undefined);
});

// ── 표시 문구 ──
test("표시 문구: 업데이트로 일시 중지 N개 / 업데이트 대기(묶는 중, 남은 n분) / 업데이트 중", () => {
  const { bundleNote, pausedNote, drainNote } = loadTs("lib/factory/supervisorDrain.ts");
  assert.match(pausedNote(3), /^업데이트로 일시 중지 3개/);
  assert.equal(pausedNote(0), null);
  assert.equal(pausedNote(-2), null);
  assert.match(bundleNote(25), /^업데이트 대기\(묶는 중, 남은 25분/);
  assert.equal(bundleNote(0), null);
  assert.equal(bundleNote(null), null);
  assert.equal(bundleNote(undefined), null);
  assert.match(drainNote("update", 2), /^업데이트 중\(진행 중인 AI 일감 2개를 안전한 지점에서 잠깐 멈추고/);
});

test("연결: 현황·정비·커넥터·화면에 일시 중지·묶는 중 표시가 이어진다", () => {
  const sup = read("lib/factory/supervisor.ts");
  assert.match(sup, /pausedNote: online \? pausedNote\(rt\.pausedJobs \?\? 0\) : null/);
  assert.match(sup, /bundleNote: online \? bundleNote\(rt\.bundleLeft\) : null/);
  assert.match(sup, /updateBundleMin: updateBundle\.value/);
  assert.match(sup, /"pausedJobs" \| "bundleLeft"/);
  assert.match(read("lib/factory/maintenance.ts"), /pausedNote: pausedNote\(rt\.pausedJobs \?\? 0\)/);
  assert.match(read("lib/factory/mcp.ts"), /업데이트일시중지: s\.pausedNote/);
  assert.match(read("components/admin/factory/SupervisorControl.tsx"), /s\?\.pausedNote/);
  assert.match(read("components/admin/factory/SupervisorControl.tsx"), /s\?\.bundleNote/);
  assert.match(read("components/admin/factory/MaintenancePanel.tsx"), /data\?\.pausedNote/);
  assert.match(read("components/admin/factory/MaintenancePanel.tsx"), /data\?\.bundleNote/);
  assert.match(read("components/admin/factory/FactoryConsole.tsx"), /<UpdateBundleSettings \/>/);
  assert.match(read("components/admin/factory/AppSlotsSettings.tsx"), /postControl\(\{ updateBundleMin: n \}\)/);
});

test("'다시 시작 필요'(failStage=resume): 텔레그램은 실패가 아니라 다시 시작 필요로 알리고, 통제실 카드는 경고 색으로 보여 준다", () => {
  const tg = read("lib/factory/telegram.ts");
  assert.match(tg, /job\.failStage === "resume"/);
  assert.match(tg, /⏸ 다시 시작 필요/);
  assert.match(tg, /\[다시 시도\]를 눌러 주세요/);
  const card = read("components/admin/factory/FactoryControl.tsx");
  assert.match(card, /job\.failReason\.startsWith\("다시 시작 필요"\)/);
  assert.match(card, /⏸ 다시 시작 필요/);
});
