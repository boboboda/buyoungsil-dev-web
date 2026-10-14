// 1-1 D-1 시험(서버 쪽): 서버 배포 중 일감이 멈추지 않게 하는 홈페이지 쪽 장치.
//  - 배포 구간(시작~끝)을 뺀 "N분 보고 없음" 판정: 정비 지시 20분 판정, 앱 일감 임대(10분) 만료
//  - 재전송 대기열의 같은 요청 번호(X-Request-Id)를 두 번 처리하지 않는 보고 주소
//  - 통제실 "배포 중 · 재전송 대기 N개" 표시 문구
// 가짜 DB·가짜 요청으로만 돌린다. 실행: node tests/deploy-continuity.test.mjs
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

// 준 것 말고 "@/..." 로 오는 모듈은 아무 호출이나 받아 주는 가짜로 대신한다(이 시험이 보는 함수만 진짜)
const anything = () => new Proxy(function () {}, { get: (t, k) => (k === "__esModule" ? true : k === "then" ? undefined : anything()), apply: () => anything() });
function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const req = (name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : name.startsWith("@/") ? anything() : require(name));
  new Function("require", "module", "exports", output)(req, module, module.exports);
  return module.exports;
}

const MIN = 60_000;
const T0 = Date.parse("2026-10-15T00:00:00.000Z");

// ── 배포 구간 계산(순수 함수) ──
const win = loadTs("lib/factory/deployWindow.ts", { "@/lib/prisma": { __esModule: true, default: {} } });

test("deployOverlapMs: 구간과 겹친 시간만, 겹치는 배포 구간은 한 번만 센다", () => {
  const w = [{ start: T0 + 10 * MIN, end: T0 + 15 * MIN }];
  assert.equal(win.deployOverlapMs(w, T0, T0 + 30 * MIN), 5 * MIN);
  assert.equal(win.deployOverlapMs(w, T0 + 12 * MIN, T0 + 30 * MIN), 3 * MIN, "중간부터 보면 남은 만큼");
  assert.equal(win.deployOverlapMs(w, T0 + 20 * MIN, T0 + 30 * MIN), 0);
  assert.equal(win.deployOverlapMs([...w, { start: T0 + 12 * MIN, end: T0 + 18 * MIN }], T0, T0 + 30 * MIN), 8 * MIN, "겹친 두 구간(10~15, 12~18) = 8분");
  assert.equal(win.deployOverlapMs(w, T0 + 5 * MIN, T0 + 5 * MIN), 0);
});

test("idleMsExcludingDeploy: 배포 5분을 낀 25분 침묵은 20분으로 센다(실패 아님), 배포 없이 25분은 그대로", () => {
  const w = [{ start: T0 + 10 * MIN, end: T0 + 15 * MIN }];
  assert.equal(win.idleMsExcludingDeploy(w, T0, T0 + 25 * MIN), 20 * MIN);
  assert.ok(win.idleMsExcludingDeploy(w, T0, T0 + 25 * MIN) <= 20 * MIN, "20분을 넘지 않으니 정리 대상이 아님");
  assert.equal(win.idleMsExcludingDeploy([], T0, T0 + 25 * MIN), 25 * MIN);
  assert.ok(win.idleMsExcludingDeploy(w, T0, T0 + 26 * MIN) > 20 * MIN, "배포를 빼고도 20분을 넘으면 정리 대상");
});

test("loadDeployWindows: 끝이 안 찍힌 배포는 30분까지만 구간으로 본다(멈춘 배포가 판정을 영원히 미루지 않게)", async () => {
  const start = new Date(T0);
  const prisma = { factoryDeploy: { findMany: async () => [{ startedAt: start, finishedAt: null }, { startedAt: new Date(T0 - 60 * MIN), finishedAt: new Date(T0 - 55 * MIN) }, { startedAt: null, finishedAt: null }] } };
  const w = loadTs("lib/factory/deployWindow.ts", { "@/lib/prisma": { __esModule: true, default: prisma } });
  const got = await w.loadDeployWindows(new Date(T0 - 2 * 60 * MIN), T0 + 2 * 60 * MIN);
  assert.deepEqual(got, [{ start: T0, end: T0 + 30 * MIN }, { start: T0 - 60 * MIN, end: T0 - 55 * MIN }]);
  const broken = loadTs("lib/factory/deployWindow.ts", { "@/lib/prisma": { __esModule: true, default: { factoryDeploy: { findMany: async () => { throw new Error("db"); } } } } });
  assert.deepEqual(await broken.loadDeployWindows(new Date(T0)), [], "DB 오류면 예전 판정 그대로");
});

// ── 앱 일감 임대 만료 ──
function jobsWith({ windows, late }) {
  const sqls = [];
  const prisma = {
    $queryRaw: async () => late,
    $executeRaw: async (q) => void sqls.push({ sql: q.strings.join("?"), values: q.values }),
  };
  const jobs = loadTs("lib/factory/jobs.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/deployWindow": { loadDeployWindows: async () => windows, idleMsExcludingDeploy: win.idleMsExcludingDeploy },
  });
  return { jobs, sqls };
}
const LEASE = 10 * MIN;

test("임대 만료: 배포 구간이 없으면 예전 SQL 그대로(만료 두 번 UPDATE)", async () => {
  const { jobs, sqls } = jobsWith({ windows: [], late: [] });
  await jobs.releaseExpiredLeases(new Date(T0));
  assert.equal(sqls.length, 2);
  assert.match(sqls[0].sql, /"leaseUntil" </);
});

test("임대 만료: 배포 5분을 끼고 10분 임대가 지난 일감은 정리하지 않고, 배포를 빼고도 넘은 일감만 정리한다", async () => {
  const now = T0 + 20 * MIN;
  const w = [{ start: T0 + 6 * MIN, end: T0 + 11 * MIN }];
  const late = [
    // 마지막 보고 T0+4분 → 임대 T0+14분. 4분~20분 = 16분 중 배포 5분 제외 = 11분 > 10분 → 정리 대상
    { id: "dead", leaseUntil: new Date(T0 + 14 * MIN), attempts: 1, maxAttempts: 3 },
    // 마지막 보고 T0+8분 → 임대 T0+18분. 8분~20분 = 12분 중 배포 3분 제외 = 9분 → 살림
    { id: "alive", leaseUntil: new Date(T0 + 18 * MIN), attempts: 1, maxAttempts: 3 },
    // 시도 횟수 소진 + 정리 대상
    { id: "spent", leaseUntil: new Date(T0 + 12 * MIN), attempts: 3, maxAttempts: 3 },
  ];
  assert.ok(win.idleMsExcludingDeploy(w, T0 + 4 * MIN, now) > LEASE);
  assert.ok(win.idleMsExcludingDeploy(w, T0 + 8 * MIN, now) <= LEASE);
  const { jobs, sqls } = jobsWith({ windows: w, late });
  await jobs.releaseExpiredLeases(new Date(now));
  const flat = JSON.stringify(sqls.map((s) => s.values));
  assert.equal(sqls.length, 2);
  assert.match(sqls[0].sql, /'approved'/);
  assert.match(flat, /dead/);
  assert.match(flat, /spent/);
  assert.doesNotMatch(flat, /alive/, "배포 때문에 늦은 일감은 살려 둔다");
  assert.match(sqls[1].sql, /'failed'/);
});

// ── 정비 지시 20분 판정 ──
test("정비 지시 20분 판정: 소스에서 배포 구간을 빼고 세고(배포 중 보고 끊김), 배포 결과 보고 20분 판정은 그대로", () => {
  const src = read("lib/factory/maintenance.ts");
  assert.match(src, /dw\.loadDeployWindows\(cut\)/);
  assert.match(src, /dw\.idleMsExcludingDeploy\(windows, s\.heartbeatAt\.getTime\(\), nowMs\) > STALE_MS/);
  assert.match(src, /where: \{ deployStartedAt: \{ lt: cut \}, deployedAt: null, deployResult: null \}/, "배포 자체가 20분 넘게 결과가 없으면 정리(구간 계산 대상 아님)");
});

function maintenanceWith({ windows, late, nowMs }) {
  const updated = [];
  const prisma = {
    factoryMaintenanceMessage: {
      findMany: async () => late,
      update: async ({ where, data }) => void updated.push([where.id, data.status]),
      create: async () => ({}),
      count: async () => 0,
    },
    factoryMaintenance: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    factoryDeploy: { updateMany: async () => ({ count: 0 }) },
  };
  const realNow = Date.now;
  Date.now = () => nowMs;
  const m = loadTs("lib/factory/maintenance.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/deployWindow": { loadDeployWindows: async () => windows, idleMsExcludingDeploy: win.idleMsExcludingDeploy, isDeployingNow: async () => false },
    "@/lib/factory/telegram": { notifyMaintenance: async () => {}, notifyDeployReady: async () => {}, notifyText: async () => {} },
  });
  return { m, updated, restore: () => (Date.now = realNow), prisma };
}

test("정비 지시 20분 판정(진짜 함수): 배포 5분을 낀 22분 침묵은 실패로 정리하지 않고, 배포를 빼고 20분을 넘으면 정리한다", async () => {
  const w = [{ start: T0 + 5 * MIN, end: T0 + 10 * MIN }];
  const hb = new Date(T0);
  // maintenanceForNext 가 releaseStale 을 부른다. 진행 중 지시를 찾는 쿼리는 비어 있게 둔다
  for (const [elapsedMin, expectDead] of [[22, false], [26, true]]) {
    const { m, updated, restore } = maintenanceWith({ windows: w, late: [{ id: "turn1", maintenanceId: "m1", heartbeatAt: hb }], nowMs: T0 + elapsedMin * MIN });
    try {
      await m.maintenanceForNext(["claude"]).catch(() => undefined);
    } finally {
      restore();
    }
    assert.equal(updated.some(([id, status]) => id === "turn1" && status === "failed"), expectDead, `${elapsedMin}분 침묵 → 정리 ${expectDead}`);
  }
});

// ── 보고 주소 중복 방지 ──
function reportRoute(seenIds) {
  const reported = [];
  const route = loadTs("app/api/factory/report/route.ts", {
    "@/lib/factory/http": { fail: (status, message, extra) => NextResponse.json({ message, ...extra }, { status }), guardWorker: async () => null, readJson: async (req) => ({ ok: true, body: await req.json() }) },
    "@/lib/factory/jobs": { parseReport: (b) => ({ ok: true, value: b }), reportJob: async (v) => (reported.push(v.n), { kind: "ok", status: "running", leaseUntil: null }) },
    "@/lib/factory/telegram": { notifyJobEvent: async () => {} },
    "@/lib/factory/requestSeen": loadTs("lib/factory/requestSeen.ts", {
      "@/lib/prisma": {
        __esModule: true,
        default: { factoryRequestSeen: { findUnique: async ({ where }) => (seenIds.has(where.id) ? { id: where.id } : null), upsert: async ({ where }) => void seenIds.add(where.id), deleteMany: async () => ({}) } },
      },
    }),
  });
  const post = (n, id) => route.POST(new NextRequest("http://x/api/factory/report", { method: "POST", headers: { "content-type": "application/json", ...(id ? { "x-request-id": id } : {}) }, body: JSON.stringify({ jobId: "j1", n }) }));
  return { post, reported };
}

test("/report: 같은 X-Request-Id 는 한 번만 처리하고 200 duplicate 로 답한다(응답이 사라져 다시 보낸 경우)", async () => {
  const { post, reported } = reportRoute(new Set());
  const a = await post(1, "11111111-aaaa-bbbb-cccc-000000000001");
  assert.equal((await a.json()).duplicate, undefined);
  const again = await post(1, "11111111-aaaa-bbbb-cccc-000000000001");
  assert.equal(again.status, 200);
  assert.equal((await again.json()).duplicate, true);
  await post(2, "11111111-aaaa-bbbb-cccc-000000000002");
  assert.deepEqual(reported, [1, 2], "같은 번호는 두 번 처리되지 않음, 다른 번호는 처리");
});

test("/report: 요청 번호가 없거나 모양이 이상하면(예전 감독 프로그램) 예전처럼 매번 처리한다", async () => {
  const { post, reported } = reportRoute(new Set());
  await post(1);
  await post(1);
  await post(2, "bad id!");
  await post(2, "bad id!");
  assert.deepEqual(reported, [1, 1, 2, 2]);
});

test("/maintenance 보고도 같은 요청 번호 검사를 한다(소스 연결)", () => {
  const src = read("app/api/factory/maintenance/route.ts");
  assert.match(src, /if \(await seenRequest\(requestId\)\) return NextResponse\.json\(\{ ok: true, duplicate: true \}\)/);
  assert.match(src, /if \(r\.ok\) await markRequest\(requestId\)/);
});

// ── 표시 문구와 연결 ──
test("통제실 표시: 배포 중이면 '배포 중 · 재전송 대기 N개', 아니면 대기 보고가 있을 때만", () => {
  const { deployNote } = loadTs("lib/factory/supervisorDrain.ts");
  assert.equal(deployNote(true, 3), "배포 중 · 재전송 대기 3개");
  assert.equal(deployNote(true, 0), "배포 중 · 재전송 대기 0개");
  assert.match(deployNote(false, 2), /^재전송 대기 2개/);
  assert.equal(deployNote(false, 0), null);
  assert.equal(deployNote(true, -4), "배포 중 · 재전송 대기 0개");
});

test("연결: /next 가 outbox·deploying 을 받아 저장하고, 현황·정비·커넥터·화면에 deployNote 가 이어진다", () => {
  const next = read("app/api/factory/next/route.ts");
  assert.match(next, /param\("outbox", 6\)/);
  assert.match(next, /deployingPc/);
  assert.match(next, /outbox,\n\s+deployingPc,/);
  const sup = read("lib/factory/supervisor.ts");
  assert.match(sup, /deployNote: deployNote\(deploying, outbox\)/);
  assert.match(sup, /"outbox" \| "deployingPc"/);
  assert.match(read("lib/factory/maintenance.ts"), /deployNote: deployNote\(!!rt\.deployingPc/);
  assert.match(read("components/admin/factory/SupervisorControl.tsx"), /s\?\.deployNote/);
  assert.match(read("components/admin/factory/MaintenancePanel.tsx"), /data\?\.deployNote/);
  assert.match(read("lib/factory/mcp.ts"), /배포상태: s\.deployNote/);
});

test("/next 는 outbox·deploying 값을 걸러 받는다(양의 정수만, 9999 상한, deploying 은 1 만)", async () => {
  const runtimeCalls = [];
  const nextRoute = loadTs("app/api/factory/next/route.ts", {
    "@/lib/factory/jobs": { MAX_SLOTS: 4, WORKER_RE: /^[A-Za-z0-9._-]{1,60}$/, releaseExpiredLeases: async () => {}, claimJobs: async () => [] },
    "@/lib/factory/http": { fail: (status, message) => NextResponse.json({ message }, { status }), guardWorker: async () => null },
    "@/lib/factory/settings": {
      getParallelPerApp: async () => ({ value: 2, isDefault: true }),
      getApprovalWaitSec: async () => ({ value: 0, isDefault: false }),
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
  await next("slots=3&outbox=7&deploying=1");
  assert.equal(runtimeCalls.at(-1).outbox, 7);
  assert.equal(runtimeCalls.at(-1).deployingPc, true);
  await next("slots=3&outbox=99999&deploying=yes");
  assert.equal(runtimeCalls.at(-1).outbox, 9999);
  assert.equal(runtimeCalls.at(-1).deployingPc, undefined);
  await next("slots=3&outbox=-3");
  assert.equal(runtimeCalls.at(-1).outbox, undefined);
  await next("slots=3");
  assert.equal(runtimeCalls.at(-1).outbox, undefined, "대기열이 비면 표시도 지워진다");
});
