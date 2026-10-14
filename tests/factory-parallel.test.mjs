// 공장 병렬화 단계 A 시험(서버 쪽): 정비가 대기·진행 중이어도 /next 가 앱·실험 일감을 내주고,
// 감독 프로그램이 업데이트·배포를 기다리는 동안(drain=update|deploy)만 일감이 멈추며 그 상태가 통제실에 보이는지.
// 가짜 DB·가짜 요청으로만 돌린다. 실행: node tests/factory-parallel.test.mjs
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

function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

// ── /next ──
const claimCalls = [];
const runtimeCalls = [];
let maintActive = true; // 정비가 대기·진행 중인 척(예전에는 이것만으로 일감이 멈췄다)
const nextRoute = loadTs("app/api/factory/next/route.ts", {
  "@/lib/factory/jobs": {
    MAX_SLOTS: 4,
    WORKER_RE: /^[A-Za-z0-9._-]{1,60}$/,
    releaseExpiredLeases: async () => {},
    claimJobs: async (worker, n) => (claimCalls.push(n), Array.from({ length: n }, (_, i) => ({ id: `j${i}`, appSlug: `app-${i}`, priority: 0, kind: i === 0 ? "lab" : "new" }))),
  },
  "@/lib/factory/conductor": { appsToHold: async () => new Set(), conductorTaskForNext: async () => null, isAutoGroupEnabled: async () => false }, // 지휘자(C-2): 자동 묶기 꺼짐과 같은 동작
  "@/lib/prisma": { __esModule: true, default: {} },
  "@/lib/factory/http": { fail: (status, message) => NextResponse.json({ message }, { status }), guardWorker: async () => null },
  "@/lib/factory/release": { consumeKeyScan: async () => false, notifyTestingDue: async () => {}, pcPathsToCheck: async () => [], releaseJobExtras: async () => new Map() },
  "@/lib/factory/keyPasswords": { keyPasswordsPending: async () => false },
  "@/lib/factory/provision": {},
  "@/lib/factory/keyProvision": { provisionPending: async () => false },
  "@/lib/factory/secretEntries": { secretEntriesPending: async () => false },
  "@/lib/factory/keyVault": { keyTasksForNext: async () => [] },
  "@/lib/factory/reviewVideo": { sweepReviewVideos: async () => {} },
  "@/lib/factory/uploadTest": { consumeUploadTest: async () => null },
  // 정비가 진행 중이어도(maintActive) 서버는 일감을 막지 않는다: maintenanceHold 는 더 이상 /next 가 쓰지 않는다
  "@/lib/factory/maintenance": { maintenanceForNext: async () => (maintActive ? { maintenance: { turnId: "t1", threadId: "m1" } } : {}) },
  "@/lib/factory/rules": { getRuleOverrides: async () => ({}), renderRules: () => ({}) },
  "@/lib/factory/settings": {
    getParallelPerApp: async () => ({ value: 2, isDefault: true }),
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
  "@/lib/factory/toolBroker": { toolBrokerForSupervisor: (v) => v },
  "@/lib/factory/lab": { labCleanupForNext: async () => [], LAB_KIND: "lab" },
  "@/lib/factory/projectToolSettingsDb": { projectSettingsForNext: async () => new Map() },
  "@/lib/factory/arts": { approvedForNext: async () => new Map(), pickedForJobs: async () => new Map() },
});
const next = (q) => nextRoute.GET(new NextRequest(`http://x/api/factory/next?worker=mainpc&${q}`));

test("/next: 정비 지시가 대기·진행 중이어도 앱·실험 일감을 내준다(maintenance 신호도 같이)", async () => {
  claimCalls.length = 0;
  const body = await (await next("slots=3")).json();
  assert.equal(body.jobs.length, 3);
  assert.deepEqual(body.jobs.map((j) => j.kind), ["lab", "new", "new"], "실험(lab)과 앱 일감 모두");
  assert.equal(body.maintenance?.turnId, "t1", "정비 지시 신호는 그대로");
  assert.equal("maintenanceHold" in body, false);
  assert.deepEqual(claimCalls, [3]);
});

test("/next: 감독 프로그램이 slots=0 으로 요청하면(드레인) 일감 없이 신호만, drain 표시는 통제실용으로 저장", async () => {
  claimCalls.length = 0;
  runtimeCalls.length = 0;
  const body = await (await next("slots=0&started=2026-10-14T05:00:00.000Z&drain=update&drainJobs=2")).json();
  assert.deepEqual(body.jobs, []);
  assert.equal(body.maintenance?.turnId, "t1", "드레인 중에도 정비 신호·설정은 받아 감");
  assert.deepEqual(claimCalls, []);
  assert.equal(runtimeCalls.at(-1).drain, "update");
  assert.equal(runtimeCalls.at(-1).drainJobs, 2);
  await next("slots=0&started=2026-10-14T05:00:00.000Z&drain=deploy&drainJobs=500");
  assert.equal(runtimeCalls.at(-1).drain, "deploy");
  assert.equal(runtimeCalls.at(-1).drainJobs, 99, "99 로 자른다");
  await next("slots=3&started=2026-10-14T05:00:00.000Z&drain=<script>&drainJobs=x");
  assert.equal(runtimeCalls.at(-1).drain, undefined, "이상한 값은 버림");
  assert.equal(runtimeCalls.at(-1).drainJobs, undefined);
  await next("slots=3&started=2026-10-14T05:00:00.000Z");
  assert.equal(runtimeCalls.at(-1).drain, undefined, "드레인이 끝나면 표시도 지워짐");
});

// ── 표시 문구·화면 ──
test("드레인 문구: 업데이트 대기·배포 대기(진행 중 일감 N개 끝나면)", () => {
  const { drainNote } = loadTs("lib/factory/supervisorDrain.ts");
  assert.match(drainNote("update", 2), /업데이트 대기\(진행 중 일감 2개 끝나면/);
  assert.match(drainNote("deploy", 1), /배포 대기\(진행 중 일감 1개 끝나면/);
  assert.match(drainNote("deploy", 0), /배포 대기\(곧/);
});

test("통제실·커넥터: '정비 중에는 새 앱 일감이 멈춘다'는 문구가 남아 있지 않고, 대기 상태가 보임", () => {
  for (const f of ["components/admin/factory/MaintenancePanel.tsx", "components/admin/factory/AppSlotsSettings.tsx", "lib/factory/maintenance-mcp.ts", "app/api/factory/next/route.ts"]) {
    assert.doesNotMatch(read(f), /정비가 대기·진행 중이면 새 앱 일감은 (멈춰요|내주지 않는다)/, f);
  }
  const panel = read("components/admin/factory/MaintenancePanel.tsx");
  assert.match(panel, /정비가 진행 중이어도 앱·실험 일감은 계속 돌아요/);
  assert.match(panel, /data\?\.drainNote/);
  const sup = read("components/admin/factory/SupervisorControl.tsx");
  assert.match(sup, /s\?\.drainNote/);
  const route = read("app/api/factory/next/route.ts");
  assert.doesNotMatch(route, /maintenanceHold\(\)/);
  const ov = read("lib/factory/maintenance.ts");
  assert.match(ov, /hold: !!drain/);
  assert.match(ov, /active, \/\/ 정비 지시가 대기·진행 중/);
});
