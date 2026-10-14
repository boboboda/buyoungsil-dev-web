// 병렬화 단계 C-1(서버 쪽) 시험: 같은 앱 일감 병행 실행의 가져가기(claim) 규칙, 그룹 묶기·풀기, 병행 상태 보고, 그룹 완료 요약, 대기열 표시.
// 규칙 요약: 그룹 없음 = 앱당 1개(예전과 같음) / 같은 앱·같은 그룹의 승인된 수정 일감 = '같은 앱에서 같이 돌릴 수'(기본 2)까지 /
//   그룹 없는 일감이 돌거나 끼어 있으면 새치기 없음 / 새 앱·출시·실험은 그룹이 있어도 병행하지 않음.
// 가짜 DB 로만 돌린다(실제 DB·네트워크 없음). 실행: npm run test:parallel-group
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
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

// ── 가짜 DB ──
const match = (r, where = {}) =>
  Object.entries(where).every(([k, v]) => {
    if (k === "OR") return v.some((w) => match(r, w));
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(r[k]);
      if ("not" in v) return r[k] !== v.not;
      if ("gte" in v) return r[k] != null && r[k] >= v.gte;
    }
    return r[k] === v;
  });

function fakeDb() {
  const jobs = [];
  const logs = [];
  const settings = new Map();
  let queryIds = null;
  const factoryJob = {
    findMany: async ({ where }) => jobs.filter((j) => match(j, where)),
    findUnique: async ({ where }) => jobs.find((j) => j.id === where.id) ?? null,
    count: async ({ where }) => jobs.filter((j) => match(j, where)).length,
    update: async ({ where, data }) => Object.assign(jobs.find((j) => j.id === where.id), data),
    updateMany: async ({ where, data }) => {
      const hit = jobs.filter((j) => match(j, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
  };
  const prisma = {
    factoryJob,
    factoryJobLog: { createMany: async ({ data }) => logs.push(...data), findMany: async () => [], deleteMany: async () => ({}) },
    factorySetting: {
      findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      upsert: async ({ where, create, update }) => (settings.set(where.key, settings.has(where.key) ? update.value : create.value), {}),
    },
    // 가져가기 UPDATE: 고른 id 로 상태를 running 으로 바꾸고 돌려준다(SQL 의 IN (...) 값에서 id 를 읽는다)
    $queryRaw: async (q) => {
      const ids = q.values.filter((v) => typeof v === "string" && jobs.some((j) => j.id === v));
      queryIds = ids;
      const hit = jobs.filter((j) => ids.includes(j.id) && j.status === "approved");
      for (const j of hit) j.status = "running";
      return hit.map((j) => ({ ...j, attempts: 1 }));
    },
    $executeRaw: async () => 0,
  };
  return { prisma, jobs, logs, settings, queryIds: () => queryIds };
}

function setup() {
  const db = fakeDb();
  const parallel = loadTs("lib/factory/parallel.ts", { "@/lib/prisma": { __esModule: true, default: db.prisma } });
  const queue = loadTs("lib/factory/queue.ts", { "@/lib/prisma": { __esModule: true, default: db.prisma }, "@/lib/factory/parallel": parallel });
  const jobsMod = loadTs("lib/factory/jobs.ts", {
    "@/lib/prisma": { __esModule: true, default: db.prisma },
    "@/lib/factory/reviewVideo": { deleteReviewVideo: async () => {} },
    "@/lib/factory/mask": { maskSecrets: (v) => v },
    "@/lib/factory/ai": { AI_LABELS: {}, isAiEngine: (v) => v === "claude" || v === "codex", readModelChoice: () => ({ ok: true, model: null }) },
    "@/lib/factory/settings": { getDefaultClaudeModel: async () => null },
    "@/lib/factory/toolBroker": { cleanToolRequests: () => null },
    "@/lib/factory/handoff": { cleanHandoff: () => null },
    "@/lib/factory/parallel": parallel,
  });
  const settingsMod = loadTs("lib/factory/settings.ts", { "@/lib/prisma": { __esModule: true, default: db.prisma }, "@/lib/factory/ai": { isAiEngine: () => true, isClaudeModel: () => true }, "@/lib/factory/toolBroker": { isToolBrokerMode: () => true, normalizeToolBroker: (v) => v, readStoredToolBroker: () => null, TOOL_BROKER_LIMITS_VERSION: 1 } });
  return { ...db, parallel, queue, jobsMod, settingsMod };
}

let seq = 0;
const at = (n) => new Date(n);
const job = (over = {}) => ({ id: `j${++seq}`, appSlug: "alpha-app", title: `일감 ${seq}`, kind: "revision", status: "approved", priority: 0, approvedAt: at(seq), createdAt: at(seq), finishedAt: null, aiEngine: "claude", parallelGroup: null, parallelInfo: null, failStage: null, ...over });

// ── pickClaims: 가져가기 규칙 ──
test("그룹이 없으면 예전과 같다: 앱당 1개, 이미 도는 앱은 건너뜀, 전체 순서는 priority→승인→등록", () => {
  const { parallel } = setup();
  const approved = [job({ id: "a1", appSlug: "app-a", priority: 0 }), job({ id: "a2", appSlug: "app-a", priority: 5 }), job({ id: "b1", appSlug: "app-b", priority: 1 }), job({ id: "c1", appSlug: "app-c", priority: 9 })];

  assert.deepEqual(parallel.pickClaims({ approved, running: [{ appSlug: "app-c", kind: "revision", parallelGroup: null }], slots: 4 }), ["a2", "b1"]);
  assert.deepEqual(parallel.pickClaims({ approved, running: [], slots: 2 }), ["c1", "a2"], "slots 만큼만");
  assert.deepEqual(parallel.pickClaims({ approved, running: [], slots: 0 }), []);
});

test("같은 앱·같은 그룹의 승인된 수정 일감은 같이 가져간다(기본 상한 2), 상한을 넘으면 기다린다", () => {
  const { parallel } = setup();
  const approved = [job({ id: "g1", parallelGroup: "g-x1" }), job({ id: "g2", parallelGroup: "g-x1" }), job({ id: "g3", parallelGroup: "g-x1" })];

  assert.deepEqual(parallel.pickClaims({ approved, running: [], slots: 4 }), ["g1", "g2"], "기본 같은 앱 상한 2");
  assert.deepEqual(parallel.pickClaims({ approved, running: [], slots: 4, perApp: 3 }), ["g1", "g2", "g3"]);
  assert.deepEqual(parallel.pickClaims({ approved, running: [], slots: 4, perApp: 1 }), ["g1"], "상한 1이면 그룹이어도 하나씩");
  // 이미 그룹 일감 1개가 도는 중이면 남은 자리만큼 이어서 가져간다
  const run = [{ appSlug: "alpha-app", kind: "revision", parallelGroup: "g-x1" }];

  assert.deepEqual(parallel.pickClaims({ approved: approved.slice(1), running: run, slots: 4 }), ["g2"]);
  assert.deepEqual(parallel.pickClaims({ approved: approved.slice(2), running: [run[0], run[0]], slots: 4 }), [], "상한(2)만큼 이미 돌고 있으면 더 가져가지 않음");
  // 공장 전체 자리(slots)가 먼저 찬다
  assert.deepEqual(parallel.pickClaims({ approved, running: [], slots: 1 }), ["g1"]);
});

test("그룹이 다르거나 그룹 없는 일감과는 섞이지 않고, 순서를 새치기하지 않는다", () => {
  const { parallel } = setup();
  const g = (id, group, extra = {}) => job({ id, parallelGroup: group, ...extra });

  // 그룹 일감이 돌고 있을 때 그룹 없는 일감·다른 그룹은 기다린다
  const run = [{ appSlug: "alpha-app", kind: "revision", parallelGroup: "g-aaa1" }];

  assert.deepEqual(parallel.pickClaims({ approved: [g("n1", null), g("a2", "g-aaa1")], running: run, slots: 4 }), [], "앞선 그룹 없는 일감이 막고 있으면 뒤의 같은 그룹 일감도 새치기하지 않음");
  assert.deepEqual(parallel.pickClaims({ approved: [g("b1", "g-bbb1")], running: run, slots: 4 }), [], "다른 그룹은 기다림");
  // 그룹 없는 일감이 돌고 있으면 그룹 일감도 기다린다
  assert.deepEqual(parallel.pickClaims({ approved: [g("a1", "g-aaa1")], running: [{ appSlug: "alpha-app", kind: "revision", parallelGroup: null }], slots: 4 }), []);
  // 시작할 때: 가장 앞선 일감이 그룹 없는 것이면 그것 하나만, 그룹이면 같은 그룹이 이어지는 만큼만
  assert.deepEqual(parallel.pickClaims({ approved: [g("n1", null, { priority: 5 }), g("a1", "g-aaa1"), g("a2", "g-aaa1")], running: [], slots: 4 }), ["n1"]);
  assert.deepEqual(parallel.pickClaims({ approved: [g("a1", "g-aaa1", { priority: 5 }), g("n1", null), g("a2", "g-aaa1", { priority: -5 })], running: [], slots: 4 }), ["a1"], "사이에 그룹 없는 일감이 끼면 거기서 멈춤");
  assert.deepEqual(parallel.pickClaims({ approved: [g("a1", "g-aaa1"), g("b1", "g-bbb1")], running: [], slots: 4 }), ["a1"], "다른 그룹이 이어지면 거기서 멈춤");
});

test("새 앱·출시·실험은 그룹이 있어도 병행하지 않고, 다른 앱끼리는 서로 영향이 없다", () => {
  const { parallel } = setup();

  for (const kind of ["new", "release", "lab"]) {
    const approved = [job({ id: "x1", kind, parallelGroup: "g-zzz1" }), job({ id: "x2", kind, parallelGroup: "g-zzz1" })];

    assert.deepEqual(parallel.pickClaims({ approved, running: [], slots: 4 }), ["x1"], `${kind} 는 앱당 1개`);
  }
  const mixed = [job({ id: "a1", appSlug: "app-a", parallelGroup: "g-aaa1" }), job({ id: "a2", appSlug: "app-a", parallelGroup: "g-aaa1" }), job({ id: "b1", appSlug: "app-b" }), job({ id: "b2", appSlug: "app-b" })];

  assert.deepEqual(parallel.pickClaims({ approved: mixed, running: [], slots: 4 }).sort(), ["a1", "a2", "b1"], "app-b 는 그룹 없어 하나만");
});

test("같은 앱에서 같이 돌릴 수 설정: 1~4 정수만, 기본 2, 정한 값은 저장", async () => {
  const ctx = setup();
  const { settingsMod, parallel } = ctx;

  for (const ok of [1, 2, 3, 4, "3"]) assert.equal(settingsMod.cleanPerApp(ok), Number(ok));
  for (const bad of [0, 5, 2.5, "x", "", null, undefined, NaN, true, "1e1"]) assert.equal(settingsMod.cleanPerApp(bad), null, String(bad));
  for (const v of [1, 4, 0, 5, "2", "x", 2.5]) assert.equal(settingsMod.cleanPerApp(v), parallel.cleanPerApp(v), "서버 설정 규칙과 병행 규칙이 같다");
  assert.equal(settingsMod.DEFAULT_PER_APP, 2);
  assert.equal(parallel.DEFAULT_PER_APP, 2);
  assert.deepEqual(await settingsMod.getParallelPerApp(), { value: 2, isDefault: true });
  await settingsMod.setParallelPerApp(3);
  assert.deepEqual(await settingsMod.getParallelPerApp(), { value: 3, isDefault: false });
  ctx.settings.set("parallelPerApp", "9");
  assert.deepEqual(await settingsMod.getParallelPerApp(), { value: 2, isDefault: true }, "이상한 저장 값은 기본값");
});

// ── claimJobs: 가짜 DB ──
test("claimJobs: 그룹 일감 2개를 같이 running 으로, 그룹 없는 일감은 하나만, 상한 설정을 따른다", async () => {
  const ctx = setup();

  ctx.jobs.push(job({ id: "g1", parallelGroup: "g-run11" }), job({ id: "g2", parallelGroup: "g-run11" }), job({ id: "g3", parallelGroup: "g-run11" }), job({ id: "o1", appSlug: "other-app" }), job({ id: "o2", appSlug: "other-app" }));
  const got = await ctx.jobsMod.claimJobs("pc", 4, ["claude"], { perApp: 2 });

  assert.deepEqual(got.map((r) => r.id).sort(), ["g1", "g2", "o1"]);
  assert.deepEqual(ctx.jobs.filter((j) => j.status === "running").map((j) => j.id).sort(), ["g1", "g2", "o1"]);
  assert.ok(got.every((r) => "parallelGroup" in r), "응답에 parallelGroup 이 실린다");
  // 이어서 가져가면 상한(2)이 차 있어 g3 은 기다리고, other-app 은 이미 돌고 있어 o2 도 기다린다
  assert.deepEqual(await ctx.jobsMod.claimJobs("pc", 4, ["claude"], { perApp: 2 }), []);
  // 상한을 3으로 올리면 g3 을 이어서 가져간다
  assert.deepEqual((await ctx.jobsMod.claimJobs("pc", 4, ["claude"], { perApp: 3 })).map((r) => r.id), ["g3"]);
});

test("claimJobs: 기본 동작은 그대로 — 그룹 없는 같은 앱 일감은 하나씩, AI 종류가 다르면 가져가지 않음", async () => {
  const ctx = setup();

  ctx.jobs.push(job({ id: "a1" }), job({ id: "a2" }), job({ id: "cx", appSlug: "codex-app", aiEngine: "codex" }));
  assert.deepEqual((await ctx.jobsMod.claimJobs("pc", 4, ["claude"])).map((r) => r.id), ["a1"]);
  assert.deepEqual(await ctx.jobsMod.claimJobs("pc", 4, ["claude"]), [], "a1 이 도는 동안 a2 는 기다림");
  assert.equal(ctx.jobsMod.MAX_SLOTS, 4);
  assert.deepEqual(await ctx.jobsMod.claimJobs("pc", 4, []), []);
});

// ── 그룹 묶기·풀기 ──
test("같이 돌리기: 같은 앱의 시작 전 수정 일감 2개 이상만 묶고, 이미 있는 그룹에는 합류시킨다", async () => {
  const ctx = setup();
  const { parallel } = ctx;

  ctx.jobs.push(job({ id: "p1", status: "pending" }), job({ id: "p2", status: "approved" }), job({ id: "r1", status: "running" }), job({ id: "n1", kind: "new" }), job({ id: "z1", appSlug: "zeta-app" }), job({ id: "p3" }));
  assert.equal((await parallel.groupJobs(["p1"])).ok, false, "1개는 묶을 수 없음");
  assert.equal((await parallel.groupJobs("p1,p2")).ok, false);
  assert.equal((await parallel.groupJobs(["p1", "p1"])).ok, false, "같은 일감 두 번");
  assert.equal((await parallel.groupJobs(["p1", "nope1"])).status, 404);
  assert.match((await parallel.groupJobs(["p1", "z1"])).message, /같은 앱/);
  assert.match((await parallel.groupJobs(["p1", "n1"])).message, /수정 일감만/);
  assert.equal((await parallel.groupJobs(["p1", "r1"])).status, 409, "이미 실행 중인 일감은 묶을 수 없음");
  assert.ok(ctx.jobs.every((j) => j.parallelGroup === null), "거절된 요청은 아무것도 바꾸지 않음");

  const ok = await parallel.groupJobs(["p1", "p2"]);

  assert.equal(ok.ok, true);
  assert.match(ok.group, /^g-[a-z0-9]{4,20}$/);
  assert.deepEqual(ctx.jobs.filter((j) => j.parallelGroup === ok.group).map((j) => j.id), ["p1", "p2"]);
  // 이미 그룹이 있는 일감과 새 일감을 묶으면 그 그룹에 합류
  const join = await parallel.groupJobs(["p2", "p3"]);

  assert.equal(join.group, ok.group);
  assert.equal(ctx.jobs.find((j) => j.id === "p3").parallelGroup, ok.group);
  // 서로 다른 그룹을 합치려 하면 거절
  ctx.jobs.push(job({ id: "q1", parallelGroup: "g-other1" }));
  assert.equal((await parallel.groupJobs(["p1", "q1"])).status, 409);
});

test("그룹 풀기: 시작 전·멈춘 일감만, 실행 중은 못 뺀다", async () => {
  const ctx = setup();

  ctx.jobs.push(job({ id: "p1", parallelGroup: "g-pull1" }), job({ id: "r1", status: "running", parallelGroup: "g-pull1" }), job({ id: "f1", status: "failed", parallelGroup: "g-pull1" }), job({ id: "x1" }));
  assert.equal((await ctx.parallel.ungroupJob("p1")).ok, true);
  assert.equal(ctx.jobs.find((j) => j.id === "p1").parallelGroup, null);
  assert.equal((await ctx.parallel.ungroupJob("r1")).ok, false);
  assert.equal(ctx.jobs.find((j) => j.id === "r1").parallelGroup, "g-pull1");
  assert.equal((await ctx.parallel.ungroupJob("f1")).ok, true, "합치기 실패로 멈춘 일감도 풀 수 있음");
  assert.equal((await ctx.parallel.ungroupJob("x1")).ok, false, "그룹에 없음");
});

// ── 병행 상태 보고 ──
test("병행 상태: 보고에서 정리해 저장(모양이 이상한 값은 버림), 없으면 그대로 둔다", async () => {
  const ctx = setup();
  const { parallel, jobsMod } = ctx;
  const since = "2026-10-14T07:00:00.000Z";

  assert.equal(parallel.cleanParallelInfo(null), null);
  assert.equal(parallel.cleanParallelInfo([]), null);
  assert.deepEqual(parallel.cleanParallelInfo({ worktree: true, lockWait: { name: "build", since }, merging: true, rebases: 2, mergedAt: since, checks: "통과" }), { worktree: true, lockWait: { name: "build", since }, merging: true, rebases: 2, mergedAt: since, checks: "통과" });
  const odd = parallel.cleanParallelInfo({ worktree: "yes", lockWait: { name: "rm -rf", since }, rebases: -4, mergedAt: "어제", checks: "a\u0000b".repeat(200) });

  assert.deepEqual({ ...odd, checks: odd.checks.length }, { worktree: false, lockWait: null, merging: false, rebases: 0, mergedAt: null, checks: 300 });

  // 보고 파싱 → 저장
  const parsed = jobsMod.parseReport({ jobId: "jobid1", phase: "build", parallel: { worktree: true, merging: true, rebases: 1 } });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.parallel.merging, true);
  assert.equal(jobsMod.parseReport({ jobId: "jobid1" }).value.parallel, null, "예전 감독 프로그램: 없음");
  ctx.jobs.push(job({ id: "jobid1", status: "running", parallelGroup: "g-rep11" }));
  assert.equal((await jobsMod.reportJob(parsed.value)).kind, "ok");
  assert.equal(ctx.jobs[0].parallelInfo.merging, true);
  const noInfo = jobsMod.parseReport({ jobId: "jobid1", phase: "test" });

  await jobsMod.reportJob(noInfo.value);
  assert.equal(ctx.jobs[0].parallelInfo.merging, true, "parallel 을 안 보내면 그대로");
});

test("합치기 실패 → 다시 맞추기 보고 → 실패 보고: failStage=merge 로 저장되고 다른 일감은 그대로", async () => {
  const ctx = setup();
  const { jobsMod } = ctx;
  const stamp = "2026-10-14T07:10:00.000Z";

  ctx.jobs.push(job({ id: "done1", status: "done", parallelGroup: "g-fail1", finishedAt: at(100), parallelInfo: { worktree: true, rebases: 0, mergedAt: stamp, checks: "통과" } }), job({ id: "bad1", status: "running", parallelGroup: "g-fail1" }));
  // 다시 맞추기 두 번이 보고된 뒤
  await jobsMod.reportJob(jobsMod.parseReport({ jobId: "bad1", parallel: { worktree: true, rebases: 1 } }).value);
  await jobsMod.reportJob(jobsMod.parseReport({ jobId: "bad1", parallel: { worktree: true, rebases: 2, merging: true } }).value);
  const failed = jobsMod.parseReport({ jobId: "bad1", status: "failed", failReason: "합치기 실패(다시 맞추기 2회): 글자 충돌: lib/a.dart", failStage: "merge", parallel: { worktree: true, rebases: 2, merging: false, checks: "합치기 실패" } });

  assert.equal(failed.value.failStage, "merge");
  assert.equal((await jobsMod.reportJob(failed.value)).kind, "ok");
  const bad = ctx.jobs.find((j) => j.id === "bad1");

  assert.equal(bad.status, "failed");
  assert.equal(bad.failStage, "merge");
  assert.equal(bad.parallelInfo.rebases, 2);
  assert.equal(ctx.jobs.find((j) => j.id === "done1").status, "done", "이미 합쳐진 일감은 그대로");
  assert.equal(ctx.settings.get("parallelGroupReports"), undefined, "그룹이 끝나지 않았으니 완료 요약은 없음");

  // 대기열에는 합치기 실패로 멈춘 일감이 관리자 확인용으로 보인다(최근 7일)
  bad.finishedAt = new Date();
  const list = await ctx.queue.appQueue("alpha-app");
  const item = list.find((q) => q.id === "bad1");

  assert.equal(item.mergeFailed, true);
  assert.equal(item.position, 0);
  assert.equal(item.parallelGroup, "g-fail1");
  assert.equal(item.parallel.rebases, 2);
  assert.equal(list.some((q) => q.id === "done1"), false, "끝난 일감은 대기열에 없음");
});

// ── 그룹 완료 요약 ──
test("그룹 완료 요약: 모든 일감이 합쳐져 완료되면 합친 순서·다시 맞추기 횟수·검사 결과를 남긴다", async () => {
  const ctx = setup();
  const { jobsMod, parallel } = ctx;
  const t1 = "2026-10-14T07:20:00.000Z";
  const t2 = "2026-10-14T07:30:00.000Z";

  ctx.jobs.push(
    job({ id: "late", title: "나중에 합친 일감", status: "running", parallelGroup: "g-sum11" }),
    job({ id: "early", title: "먼저 합친 일감", status: "done", finishedAt: at(5), parallelGroup: "g-sum11", parallelInfo: { worktree: true, rebases: 0, mergedAt: t1, checks: "통과 (빌드·시험)" } }),
    job({ id: "gone", title: "취소된 일감", status: "cancelled", parallelGroup: "g-sum11" }),
  );
  assert.equal(await parallel.recordGroupReportIfDone("early"), null, "아직 한 일감이 남아 있음");
  const done = jobsMod.parseReport({ jobId: "late", status: "done", summary: "ok", parallel: { worktree: true, rebases: 2, mergedAt: t2, checks: "통과 (빌드·시험)" } });

  assert.equal((await jobsMod.reportJob(done.value)).kind, "ok");
  const reports = await parallel.readGroupReports();

  assert.equal(reports.length, 1);
  assert.equal(reports[0].group, "g-sum11");
  assert.deepEqual(reports[0].order.map((o) => o.id), ["early", "late"], "합친 순서(mergedAt)");
  assert.equal(reports[0].rebases, 2);
  assert.match(reports[0].text, /1\. 먼저 합친 일감 — 다시 맞추기 0회 · 검사: 통과 \(빌드·시험\)/);
  assert.match(reports[0].text, /2\. 나중에 합친 일감 — 다시 맞추기 2회/);
  assert.match(reports[0].text, /다시 맞추기 합계 2회/);
  assert.ok(ctx.logs.some((l) => l.jobId === "late" && /병행 그룹 g-sum11 완료/.test(l.message)), "일감 로그에도 남는다");

  // 그룹이 없는 일감이 끝나도 아무 일 없고, 같은 그룹을 다시 완료하면 요약을 새로 쓴다(중복 없음)
  ctx.jobs.push(job({ id: "solo", status: "done" }));
  assert.equal(await parallel.recordGroupReportIfDone("solo"), null);
  await parallel.recordGroupReportIfDone("late");
  assert.equal((await parallel.readGroupReports()).length, 1);
  // 새 앱 등 병행 대상이 아닌 일감은 그룹 값이 남아 있어도 요약하지 않는다
  ctx.jobs.push(job({ id: "newk", kind: "new", status: "done", parallelGroup: "g-sum22" }));
  assert.equal(await parallel.recordGroupReportIfDone("newk"), null);
});

// ── 대기열 표시 ──
test("대기열: 병행 일감은 실행 중이 여러 개(번호 0), 대기 번호는 1부터, 병행 상태가 붙는다", () => {
  const ctx = setup();
  const since = "2026-10-14T07:00:00.000Z";
  const rows = [
    job({ id: "r1", status: "running", parallelGroup: "g-q1111", parallelInfo: { worktree: true, lockWait: { name: "build", since }, merging: false, rebases: 0, mergedAt: null, checks: null } }),
    job({ id: "r2", status: "running", parallelGroup: "g-q1111", parallelInfo: { worktree: true, lockWait: null, merging: true, rebases: 1, mergedAt: null, checks: null } }),
    job({ id: "w1", status: "approved", priority: 3 }),
    job({ id: "w2", status: "pending" }),
  ];
  const out = ctx.queue.numberQueue(rows);

  assert.deepEqual(out.map((q) => `${q.position}:${q.id}`), ["0:r1", "0:r2", "1:w1", "2:w2"]);
  assert.equal(out[0].parallel.lockWait.name, "build");
  assert.equal(out[1].parallel.merging, true);
  assert.equal(out[2].parallel, null);
  assert.deepEqual(ctx.queue.numberQueue(rows.slice(2)).map((q) => q.position), [1, 2], "실행 중이 없으면 1번부터");
});

test("통제실 AppQueue: 병행 그룹·worktree 실행 중·잠금 대기·합치는 중·합치기 실패 표시와 묶기·풀기 버튼", async () => {
  const src = read("components/admin/factory/AppQueue.tsx");
  const mod = loadTs("components/admin/factory/AppQueue.tsx", { react: require("react"), "react/jsx-runtime": require("react/jsx-runtime") });
  const since = "2026-10-14T07:00:00.000Z";
  const base = { status: "running", parallelGroup: "g-ui111", parallel: { worktree: true, lockWait: null, merging: false, rebases: 0, mergedAt: null, checks: null }, mergeFailed: false };

  assert.deepEqual(mod.parallelBadges(base), ["같이 돌리기 g-ui111", "worktree 실행 중"]);
  assert.ok(mod.parallelBadges({ ...base, parallel: { ...base.parallel, lockWait: { name: "emulator", since } } }).includes("잠금 대기: 에뮬레이터"));
  assert.ok(mod.parallelBadges({ ...base, parallel: { ...base.parallel, merging: true, rebases: 2 } }).includes("합치는 중"));
  assert.ok(mod.parallelBadges({ ...base, parallel: { ...base.parallel, merging: true, rebases: 2 } }).includes("다시 맞추기 2회"));
  assert.deepEqual(mod.parallelBadges({ status: "failed", parallelGroup: "g-ui111", parallel: null, mergeFailed: true }), ["합치기 실패", "같이 돌리기 g-ui111"]);
  assert.deepEqual(mod.parallelBadges({ status: "approved", parallelGroup: null, parallel: null, mergeFailed: false }), []);
  assert.equal(mod.groupable({ status: "approved", kind: "revision" }), true);
  assert.equal(mod.groupable({ status: "running", kind: "revision" }), false);
  assert.equal(mod.groupable({ status: "approved", kind: "new" }), false);
  // 화면 연결: 묶기·풀기 버튼은 대기열 API 로, 합치기 실패 일감에는 [다시 시도]
  assert.match(src, /data-queue-group/);
  assert.match(src, /action: "group"/);
  assert.match(src, /action: "ungroup"/);
  assert.match(src, /data-queue-retry/);
  assert.match(src, /data-group-reports/);
  const route = read("app/api/admin/factory/queue/route.ts");

  assert.match(route, /export async function POST/);
  assert.match(route.split("export async function POST")[1], /requireAdmin\(\)/, "묶기·풀기는 관리자만");
  void h;
  void renderToStaticMarkup;
});

test("마이그레이션은 열과 색인만 추가하고 데이터를 지우지 않는다", () => {
  const dir = fs.readdirSync(path.join(repo, "prisma/migrations")).find((d) => d.endsWith("job_parallel_group"));
  const sql = read(`prisma/migrations/${dir}/migration.sql`).replace(/--.*$/gm, "").trim();

  assert.match(sql, /ALTER TABLE "factory_jobs" ADD COLUMN "parallelGroup" TEXT;/);
  assert.match(sql, /ALTER TABLE "factory_jobs" ADD COLUMN "parallelInfo" JSONB;/);
  assert.match(sql, /CREATE INDEX "factory_jobs_appSlug_parallelGroup_idx"/);
  assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE|UPDATE|NOT NULL/i);
  assert.match(read("prisma/schema.prisma"), /parallelGroup\s+String\?/);
});

test("/next 응답 문서와 통제실 설정: 같은 앱에서 같이 돌릴 수가 서버 설정으로 연결됨", () => {
  const route = read("app/api/factory/next/route.ts");

  assert.match(route, /getParallelPerApp\(\)/);
  assert.match(route, /claimJobs\(worker, slots, engines, \{ \.\.\.\(perApp === undefined \? \{\} : \{ perApp \}\), holdApps \}\)/);
  assert.match(read("app/api/admin/factory/control/route.ts"), /Object\.hasOwn\(body, "parallelPerApp"\)/);
  assert.match(read("lib/factory/supervisor.ts"), /parallelPerApp: parallelPerApp\.value/);
  assert.match(read("components/admin/factory/FactoryConsole.tsx"), /<ParallelPerAppSettings \/>/);
});

test("합치기 실패는 텔레그램에 '합치기 실패'로 알린다", () => {
  const src = read("lib/factory/telegram.ts");

  assert.match(src, /job\.failStage === "merge"/);
  assert.match(src, /합치기 실패/);
});
