// 병렬화 단계 C-2(서버 쪽) 시험: 지휘자가 같은 앱의 대기 일감이 겹치는지 판단해 자동으로 '같이 돌리기'로 묶는 규칙.
// 서버 안전 규칙(겹침·낮은 확신도·공용 파일·우선순위 순서), 사람 결정 우선, 캐시와 다시 판단, 판단 실패 시 순서대로, 예상과 실제 비교, 최종 점검 실패 보고.
// 가짜 DB 로만 돌린다(실제 DB·AI·네트워크 없음). 실행: npm run test:conductor
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const match = (r, where = {}) =>
  Object.entries(where).every(([k, v]) => {
    if (k === "OR") return v.some((w) => match(r, w));
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(r[k]);
      if ("not" in v) return r[k] !== v.not;
    }
    return r[k] === v;
  });

function setup() {
  const jobs = [];
  const logs = [];
  const settings = new Map();
  const prisma = {
    factoryJob: {
      findMany: async ({ where }) => jobs.filter((j) => match(j, where)),
      findUnique: async ({ where }) => jobs.find((j) => j.id === where.id) ?? null,
      updateMany: async ({ where, data }) => {
        const hit = jobs.filter((j) => match(j, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
    },
    factoryJobLog: { createMany: async ({ data }) => logs.push(...data) },
    factorySetting: {
      findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      upsert: async ({ where, create, update }) => (settings.set(where.key, settings.has(where.key) ? update.value : create.value), {}),
    },
  };
  const parallel = loadTs("lib/factory/parallel.ts", { "@/lib/prisma": { __esModule: true, default: prisma } });
  const conductor = loadTs("lib/factory/conductor.ts", { "@/lib/prisma": { __esModule: true, default: prisma }, "@/lib/factory/parallel": parallel });
  let n = 0;
  const add = (over = {}) => {
    n++;
    const row = { id: `j${n}`, appSlug: "app-a", title: `일감 ${n}`, kind: "revision", status: "approved", priority: 0, approvedAt: new Date(1000 * n), createdAt: new Date(1000 * n), planHash: `h${n}`, planMarkdown: `지시 ${n}`, aiEngine: "claude", parallelGroup: null, parallelSource: null, conductorInfo: null, parallelInfo: null, finishedAt: null, ...over };
    jobs.push(row);
    return row;
  };
  return { jobs, logs, settings, prisma, parallel, conductor, add };
}

const S = { autoGroup: true, perApp: 2, appSlots: 3 };
const v = (id, files, over = {}) => ({ id, files, areas: ["screen"], confidence: "high", note: "", ...over });
const pj = (r) => ({ id: r.id, title: r.title, priority: r.priority, approvedAt: r.approvedAt, createdAt: r.createdAt });
const SHARED = ["pubspec.yaml", "**/migrations/**", "*router*"];
const apply = (conductor, verdict, key, usage = null) => conductor.applyVerdict(verdict, { appSlug: "app-a", key, settings: S, model: "haiku", shared: SHARED, usage });

// ── 서버 안전 규칙 ──
test("planGroups: 겹치지 않고 확신도 높음이면 묶는다 / 예상 파일이 하나라도 겹치면 묶지 않는다", () => {
  const { conductor, add } = setup();
  const a = add();
  const b = add();
  const ok = conductor.planGroups({ jobs: [a, b].map(pj), verdict: { jobs: [v(a.id, ["lib/a.dart"]), v(b.id, ["lib/b.dart"])], groups: [{ jobIds: [a.id, b.id], reason: "다른 화면" }], sequential: [] }, perApp: 2, shared: SHARED });
  assert.deepEqual(ok.bundles, [[a.id, b.id]]);
  assert.deepEqual(ok.sequential, []);

  const clash = conductor.planGroups({ jobs: [a, b].map(pj), verdict: { jobs: [v(a.id, ["lib/a.dart", "lib/x.dart"]), v(b.id, ["lib/B.dart", "LIB/x.dart"])], groups: [{ jobIds: [a.id, b.id], reason: "?" }], sequential: [] }, perApp: 2, shared: SHARED });
  assert.deepEqual(clash.bundles, []);
  assert.equal(clash.sequential.length, 2);
  assert.match(clash.sequential.find((s) => s.id === a.id).reason, /lib\/x\.dart 겹침/i);
});

test("planGroups: 확신도가 높음이 아니면(중간·낮음·없음) 묶지 않고 이유를 남긴다", () => {
  const { conductor, add } = setup();
  const a = add();
  const b = add();
  const c = add();
  for (const conf of ["medium", "low"]) {
    const r = conductor.planGroups({ jobs: [a, b].map(pj), verdict: { jobs: [v(a.id, ["a"]), v(b.id, ["b"], { confidence: conf })], groups: [{ jobIds: [a.id, b.id], reason: "" }], sequential: [] }, perApp: 2, shared: SHARED });
    assert.deepEqual(r.bundles, [], conf);
    assert.match(r.sequential.map((s) => s.reason).join("|"), /확신도가 (중간|낮음)/);
  }
  const miss = conductor.planGroups({ jobs: [a, c].map(pj), verdict: { jobs: [v(a.id, ["a"])], groups: [], sequential: [] }, perApp: 2, shared: SHARED });
  assert.deepEqual(miss.bundles, []);
  assert.match(miss.sequential.find((s) => s.id === c.id).reason, /판단하지 못했/);
  const none = conductor.planGroups({ jobs: [a, b].map(pj), verdict: { jobs: [v(a.id, []), v(b.id, ["b"])], groups: [{ jobIds: [a.id, b.id], reason: "" }], sequential: [] }, perApp: 2, shared: SHARED });
  assert.deepEqual(none.bundles, []);
});

test("planGroups: 공용 파일(pubspec.yaml·마이그레이션·라우터 등)을 건드리면 묶지 않는다 — 이유에 파일 이름", () => {
  const { conductor, add } = setup();
  const a = add();
  const b = add();
  for (const f of ["pubspec.yaml", "app/pubspec.yaml", "prisma/migrations/2026/migration.sql", "lib/app_router.dart"]) {
    const r = conductor.planGroups({ jobs: [a, b].map(pj), verdict: { jobs: [v(a.id, [f]), v(b.id, ["lib/b.dart"])], groups: [{ jobIds: [a.id, b.id], reason: "" }], sequential: [] }, perApp: 2, shared: SHARED });
    assert.deepEqual(r.bundles, [], f);
    assert.match(r.sequential.find((s) => s.id === a.id).reason, /공통/, f);
  }
  const dep = conductor.planGroups({ jobs: [a, b].map(pj), verdict: { jobs: [v(a.id, ["lib/a.dart"], { areas: ["dependency"] }), v(b.id, ["lib/b.dart"])], groups: [{ jobIds: [a.id, b.id], reason: "" }], sequential: [] }, perApp: 2, shared: SHARED });
  assert.deepEqual(dep.bundles, []);
  const off = conductor.planGroups({ jobs: [a, b].map(pj), verdict: { jobs: [v(a.id, ["pubspec.yaml"]), v(b.id, ["lib/b.dart"])], groups: [{ jobIds: [a.id, b.id], reason: "" }], sequential: [] }, perApp: 2, shared: [] });
  assert.deepEqual(off.bundles, [[a.id, b.id]], "목록을 비우면(설정) 공용 파일 검사는 하지 않는다");
});

test("planGroups: 우선순위가 가장 높은 일감부터 묶고, 높은 순위를 건너뛰어 낮은 일감끼리 먼저 묶지 않는다. 묶음 크기는 perApp 이하", () => {
  const { conductor, add } = setup();
  const low1 = add({ priority: 0 });
  const low2 = add({ priority: 0 });
  const top = add({ priority: 5 });
  const verdict = { jobs: [v(top.id, ["t"]), v(low1.id, ["t"]), v(low2.id, ["l2"])], groups: [{ jobIds: [top.id, low1.id, low2.id], reason: "" }], sequential: [] };
  const r = conductor.planGroups({ jobs: [low1, low2, top].map(pj), verdict, perApp: 3, shared: SHARED });
  assert.deepEqual(r.sequential.map((s) => s.id), [top.id], "최상위 일감은 겹쳐서 순서대로");
  assert.deepEqual(r.bundles, [[low1.id, low2.id]]);
  const mid = add({ priority: 3 });
  const r2 = conductor.planGroups({ jobs: [low2, mid, top].map(pj), verdict: { jobs: [v(top.id, ["t"]), v(mid.id, ["m"], { confidence: "low" }), v(low2.id, ["l2"])], groups: [{ jobIds: [top.id, mid.id, low2.id], reason: "" }], sequential: [] }, perApp: 3, shared: SHARED });
  assert.deepEqual(r2.bundles, [], "top 과 low2 가 mid 를 건너뛰어 묶이면 안 된다");
  const x = add();
  const y = add();
  const z = add();
  const cap = conductor.planGroups({ jobs: [x, y, z].map(pj), verdict: { jobs: [v(x.id, ["x"]), v(y.id, ["y"]), v(z.id, ["z"])], groups: [{ jobIds: [x.id, y.id, z.id], reason: "" }], sequential: [] }, perApp: 2, shared: SHARED });
  assert.deepEqual(cap.bundles, [[x.id, y.id]]);
  assert.deepEqual(cap.sequential.map((s) => s.id), [z.id], "남은 하나는 짝이 없어 순서대로");
  const nop = conductor.planGroups({ jobs: [x, y].map(pj), verdict: { jobs: [v(x.id, ["x"]), v(y.id, ["y"])], groups: [], sequential: [{ jobIds: [x.id, y.id], reason: "같은 화면" }] }, perApp: 2, shared: SHARED });
  assert.deepEqual(nop.bundles, [], "지휘자가 같이 돌리자고 하지 않은 일감은 서버가 마음대로 묶지 않는다");
});

test("공용 파일 패턴: 파일 이름만 쓰면 어느 폴더든, ** 와 * 는 폴더 안팎으로, 대소문자 구분 없음. 기본 목록에 요구한 파일들이 있다", () => {
  const { conductor } = setup();
  const d = conductor.DEFAULT_SHARED_FILES;
  for (const f of ["pubspec.yaml", "pubspec.lock", "package.json", "package-lock.json", "yarn.lock", "app/build.gradle", "android/app/build.gradle.kts", "android/app/src/main/AndroidManifest.xml", "prisma/migrations/x/migration.sql", "prisma/schema.prisma", "lib/l10n/app_ko.arb", "lib/router/app_router.dart", "lib/main.dart"]) {
    assert.ok(conductor.sharedPatternOf(f, d), f);
  }
  assert.equal(conductor.sharedPatternOf("lib/screens/home.dart", d), null);
  assert.equal(conductor.sharedPatternOf("PUBSPEC.YAML", ["pubspec.yaml"]), "pubspec.yaml");
  assert.equal(conductor.sharedPatternOf("a/b/c.txt", ["a/**"]), "a/**");
  assert.equal(conductor.sharedPatternOf("x/a/b.txt", ["a/**"]), null);
  assert.deepEqual(conductor.cleanSharedPatterns("a.txt\n\n  b/**  \na.txt"), ["a.txt", "b/**"]);
  assert.equal(conductor.cleanSharedPatterns(5), null);
  assert.deepEqual(conductor.cleanSharedPatterns("../x\n/abs\nok"), ["ok"]);
});

test("cleanVerdict: 모르는 일감 id·이상한 경로·이상한 확신도는 버리고, 확신도를 모르면 낮음", () => {
  const { conductor } = setup();
  const r = conductor.cleanVerdict({ jobs: [{ id: "j1", files: ["./lib/a.dart", "../etc/passwd", "/abs", "ok/b.dart", 5], areas: ["screen", "Bad Area!"], confidence: "high" }, { id: "zzz", files: ["x"], confidence: "high" }, { id: "j2", files: ["c"], confidence: "아주높음" }], groups: [{ jobIds: ["j1", "j2", "nope"], reason: "r" }], sequential: "x" }, ["j1", "j2"]);
  assert.deepEqual(r.jobs.map((j) => j.id), ["j1", "j2"]);
  assert.deepEqual(r.jobs[0].files, ["lib/a.dart", "ok/b.dart"]);
  assert.deepEqual(r.jobs[0].areas, ["screen"]);
  assert.equal(r.jobs[1].confidence, "low");
  assert.deepEqual(r.groups[0].jobIds, ["j1", "j2"]);
  assert.deepEqual(r.sequential, []);
  assert.equal(conductor.cleanVerdict({ jobs: [] }, ["j1"]), null);
  assert.equal(conductor.cleanVerdict("x", ["j1"]), null);
});

// ── 반영: 묶기·순서대로·출처 ──
test("applyVerdict: 안전한 묶음은 conductor 출처의 같은 그룹으로 묶고, 나머지는 순서대로 이유를 남긴다 — 로그와 비용 기록(지휘자 표시)", async () => {
  const { conductor, add, logs, settings } = setup();
  const a = add();
  const b = add();
  const c = add();
  const key = conductor.judgeKey([a, b, c]);
  const verdict = { jobs: [v(a.id, ["lib/a.dart"]), v(b.id, ["lib/b.dart"]), v(c.id, ["pubspec.yaml"])], groups: [{ jobIds: [a.id, b.id], reason: "서로 다른 화면" }], sequential: [{ jobIds: [c.id], reason: "의존성" }] };
  const res = await apply(conductor, verdict, key, { ms: 4200, costUsd: 0.0123, tokens: { input: 10, output: 5, cacheCreate: 0, cacheRead: 3 } });
  assert.equal(res.ok, true);
  assert.equal(a.parallelGroup, b.parallelGroup);
  assert.match(a.parallelGroup, /^g-/);
  assert.equal(a.parallelSource, "conductor");
  assert.equal(c.parallelGroup, null);
  assert.equal(a.conductorInfo.decision, "grouped");
  assert.deepEqual(a.conductorInfo.files, ["lib/a.dart"]);
  assert.equal(a.conductorInfo.reason, "서로 다른 화면");
  assert.deepEqual(a.conductorInfo.groupWith, [b.id]);
  assert.equal(c.conductorInfo.decision, "sequential");
  assert.match(c.conductorInfo.reason, /pubspec\.yaml 공통/);
  assert.ok(logs.some((l) => l.jobId === a.id && /지휘자: 같이 돌리기/.test(l.message)));
  assert.ok(logs.some((l) => l.jobId === c.id && /순서대로/.test(l.message)));
  const log = await conductor.readConductorLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].role, "conductor", "비용 기록에 지휘자 턴을 따로 표시");
  assert.equal(log[0].costUsd, 0.0123);
  assert.equal(log[0].model, "haiku");
  assert.deepEqual(log[0].tokens, { input: 10, output: 5, cacheCreate: 0, cacheRead: 3 });
  assert.ok(settings.has("conductorLog"));
});

test("applyVerdict: 그 사이 일감이 바뀌었으면(키가 다르면) 반영하지 않는다", async () => {
  const { conductor, add } = setup();
  const a = add();
  const b = add();
  const key = conductor.judgeKey([a, b]);
  add();
  const res = await apply(conductor, { jobs: [v(a.id, ["a"]), v(b.id, ["b"])], groups: [{ jobIds: [a.id, b.id], reason: "" }], sequential: [] }, key);
  assert.equal(res.ok, false);
  assert.equal(res.stale, true);
  assert.equal(a.parallelGroup, null);
});

// ── 사람 결정 우선 ──
test("사람 결정 우선: 사람이 묶은 일감·푼 일감은 지휘자가 바꾸지 않고, 푼 일감은 다시 자동으로 묶지 않는다", async () => {
  const { conductor, parallel, add } = setup();
  const a = add({ status: "pending" });
  const b = add({ status: "pending" });
  const g = await parallel.groupJobs([a.id, b.id]);
  assert.equal(g.ok, true);
  assert.equal(a.parallelSource, "manual");
  assert.equal(b.parallelSource, "manual");
  a.status = "approved";
  b.status = "approved";
  assert.equal(conductor.isCandidate(a), false, "사람이 묶은 일감은 이미 그룹이 있어 판단 대상이 아니다");
  const u = await parallel.ungroupJob(a.id);
  assert.equal(u.ok, true);
  assert.equal(a.parallelGroup, null);
  assert.equal(a.parallelSource, "manual", "푼 일감은 사람 결정으로 기록");
  assert.equal(conductor.isCandidate(a), false, "푼 일감은 자동 묶기 대상이 아니다");
  const c = add();
  const d = add();
  assert.equal(conductor.isCandidate(c), true);
  const task = await conductor.conductorTaskForNext(S);
  assert.deepEqual(task.jobs.map((j) => j.id).sort(), [c.id, d.id].sort());
  const res = await apply(conductor, { jobs: [v(a.id, ["a"]), v(c.id, ["c"]), v(d.id, ["d"])], groups: [{ jobIds: [a.id, c.id, d.id], reason: "" }], sequential: [] }, task.key);
  assert.equal(res.ok, true);
  assert.equal(a.parallelGroup, null, "AI 가 푼 일감을 끼워 넣어도 바뀌지 않는다");
  assert.equal(a.conductorInfo, null);
  assert.equal(c.parallelGroup, d.parallelGroup);
  const e = add({ status: "pending" });
  const j = await parallel.groupJobs([c.id, e.id]);
  assert.equal(j.ok, true);
  assert.equal(c.parallelSource, "manual", "지휘자가 묶은 일감에 사람이 합류시키면 사람 그룹이 된다");
  assert.equal(d.parallelSource, "manual");
});

// ── 캐시·다시 판단·가져가기 보류 ──
test("판단 요청: 승인된 수정 일감이 그룹 없이 2개 이상일 때만, 설정(자동 묶기·같은 앱 동시 수·공장 전체 상한)이 허락할 때만", async () => {
  const { conductor, add } = setup();
  const a = add();
  assert.equal(await conductor.conductorTaskForNext(S), null, "1개뿐");
  add({ kind: "new" });
  add({ status: "pending" });
  add({ kind: "release" });
  assert.equal(await conductor.conductorTaskForNext(S), null, "새 앱·출시·승인 대기는 대상이 아니다");
  const b = add();
  for (const off of [{ autoGroup: false }, { perApp: 1 }, { appSlots: 1 }]) assert.equal(await conductor.conductorTaskForNext({ ...S, ...off }), null, JSON.stringify(off));
  const task = await conductor.conductorTaskForNext(S);
  assert.equal(task.appSlug, "app-a");
  assert.deepEqual(task.jobs.map((j) => j.id), [a.id, b.id]);
  assert.equal(task.model, "haiku", "기본 모델");
  assert.equal(task.perApp, 2);
  assert.ok(task.sharedFiles.includes("pubspec.yaml"));
  assert.match(task.jobs[0].instruction, /지시 1/);
});

test("판단 요청은 공장 전체에서 동시에 1개: 결과가 오기 전에는 다시 내주지 않고, 결과가 오면 풀린다", async () => {
  const { conductor, add } = setup();
  const a = add();
  const b = add();
  add({ appSlug: "app-b" });
  add({ appSlug: "app-b" });
  const t1 = await conductor.conductorTaskForNext(S);
  assert.equal(t1.appSlug, "app-a");
  assert.equal(await conductor.conductorTaskForNext(S), null, "처리 중에는 다른 앱도 내주지 않는다");
  await apply(conductor, { jobs: [v(a.id, ["a"]), v(b.id, ["b"])], groups: [{ jobIds: [a.id, b.id], reason: "" }], sequential: [] }, t1.key);
  const t2 = await conductor.conductorTaskForNext(S);
  assert.equal(t2.appSlug, "app-b");
  await conductor.skipVerdict();
  assert.equal((await conductor.conductorTaskForNext(S)).appSlug, "app-b", "skip 하면 기록 없이 다시 받는다");
});

test("캐시: 같은 일감 조합(id·planHash)은 다시 판단하지 않고, 새 일감이 들어오거나 내용(planHash)이 바뀌면 다시 판단한다", async () => {
  const { conductor, add } = setup();
  const a = add();
  const b = add();
  const t1 = await conductor.conductorTaskForNext(S);
  await apply(conductor, { jobs: [v(a.id, ["x"]), v(b.id, ["x"])], groups: [{ jobIds: [a.id, b.id], reason: "" }], sequential: [] }, t1.key);
  assert.equal(a.conductorInfo.decision, "sequential");
  assert.equal(await conductor.conductorTaskForNext(S), null, "같은 조합은 다시 판단하지 않는다");
  assert.equal(await conductor.conductorTaskForNext(S), null);
  b.planHash = "changed";
  const t2 = await conductor.conductorTaskForNext(S);
  assert.ok(t2, "일감 내용이 바뀌면 다시 판단");
  assert.notEqual(t2.key, t1.key);
  await apply(conductor, { jobs: [v(a.id, ["x"]), v(b.id, ["x"])], groups: [], sequential: [] }, t2.key);
  assert.equal(await conductor.conductorTaskForNext(S), null);
  add();
  const t3 = await conductor.conductorTaskForNext(S);
  assert.ok(t3, "새 일감이 들어오면 다시 판단");
  assert.equal(t3.jobs.length, 3);
});

test("가져가기 보류: 판단을 기다리는 앱만, 지휘자를 쓸 줄 아는 감독 프로그램에게만, 마지막 승인 5분 안에만. 판단이 끝나면 바로 풀림", async () => {
  const { conductor, add } = setup();
  const now = Date.now();
  const a = add({ approvedAt: new Date(now - 1000) });
  const b = add({ approvedAt: new Date(now - 500) });
  add({ appSlug: "app-b", approvedAt: new Date(now - 500) });
  assert.deepEqual([...(await conductor.appsToHold(S, true, now))], ["app-a"], "app-b 는 1개뿐이라 보류 없음");
  assert.deepEqual([...(await conductor.appsToHold(S, false, now))], [], "지휘자를 모르는(예전) 감독 프로그램은 예전 그대로");
  assert.deepEqual([...(await conductor.appsToHold({ ...S, autoGroup: false }, true, now))], [], "자동 묶기를 끄면 C-1 과 똑같이");
  assert.deepEqual([...(await conductor.appsToHold(S, true, now + 6 * 60_000))], [], "5분이 지나면 순서대로 돈다");
  const t = await conductor.conductorTaskForNext(S, now);
  await apply(conductor, { jobs: [v(a.id, ["a"]), v(b.id, ["b"])], groups: [{ jobIds: [a.id, b.id], reason: "" }], sequential: [] }, t.key);
  assert.deepEqual([...(await conductor.appsToHold(S, true, now))], [], "묶음이 정해지면 보류 끝");
});

test("claimJobs: holdApps 에 든 앱의 일감은 가져가지 않는다(순서를 새치기하지 않음), 다른 앱은 그대로", async () => {
  const s = setup();
  s.add({ appSlug: "app-a" });
  s.add({ appSlug: "app-a" });
  s.add({ appSlug: "app-b" });
  const jobsMod = loadTs("lib/factory/jobs.ts", {
    "@/lib/prisma": {
      __esModule: true,
      default: {
        ...s.prisma,
        $queryRaw: async (q) => {
          const ids = q.values.filter((x) => typeof x === "string" && s.jobs.some((j) => j.id === x));
          const hit = s.jobs.filter((j) => ids.includes(j.id));
          for (const j of hit) j.status = "running";
          return hit.map((j) => ({ ...j, attempts: 1 }));
        },
        $executeRaw: async () => 0,
      },
    },
    "@/lib/factory/reviewVideo": { deleteReviewVideo: async () => {} },
    "@/lib/factory/mask": { maskSecrets: (x) => x },
    "@/lib/factory/ai": { AI_LABELS: {}, isAiEngine: (x) => x === "claude" || x === "codex", readModelChoice: () => ({ ok: true, model: null }) },
    "@/lib/factory/settings": { getDefaultClaudeModel: async () => null },
    "@/lib/factory/toolBroker": { cleanToolRequests: () => null },
    "@/lib/factory/handoff": { cleanHandoff: () => null },
    "@/lib/factory/parallel": s.parallel,
  });
  const got = await jobsMod.claimJobs("pc", 4, ["claude"], { perApp: 2, holdApps: new Set(["app-a"]) });
  assert.deepEqual(got.map((r) => r.appSlug), ["app-b"]);
});

// ── 판단 실패 ──
test("판단 실패(AI 오류·읽기 전용 위반·형식 오류): 순서대로 두고 사유를 남기며 공장은 멈추지 않는다. 15분 동안 같은 조합을 다시 판단하지 않는다", async () => {
  const { conductor, add, logs } = setup();
  const a = add();
  const b = add();
  const t = await conductor.conductorTaskForNext(S);
  const res = await conductor.failVerdict("읽기 전용 위반: git status 가 바뀌었어요", { appSlug: "app-a", key: t.key, settings: S, model: "haiku", shared: SHARED, usage: { ms: 1000, costUsd: 0.001 } });
  assert.equal(res.ok, false);
  assert.equal(a.parallelGroup, null);
  assert.equal(b.parallelGroup, null);
  assert.equal(a.conductorInfo.decision, "failed");
  assert.match(a.conductorInfo.reason, /읽기 전용 위반/);
  assert.ok(logs.some((l) => /지휘자 판단 실패/.test(l.message) && /순서대로 실행/.test(l.message)));
  const now = Date.now();
  assert.equal(await conductor.conductorTaskForNext(S, now + 60_000), null, "실패 직후에는 다시 판단하지 않는다");
  assert.deepEqual([...(await conductor.appsToHold(S, true, now))], [], "실패하면 가져가기 보류가 바로 풀려 순서대로 돈다");
  assert.ok(await conductor.conductorTaskForNext(S, now + 16 * 60_000), "15분이 지나면 다시 시도한다");
  const log = await conductor.readConductorLog();
  assert.equal(log[0].ok, false);
  assert.equal(log[0].role, "conductor");
  const c = setup();
  const x = c.add();
  const y = c.add();
  const t2 = await c.conductor.conductorTaskForNext(S);
  const bad = await apply(c.conductor, { nothing: true }, t2.key);
  assert.equal(bad.ok, false);
  assert.equal(x.conductorInfo.decision, "failed");
  assert.equal(y.parallelGroup, null);
});

// ── 예상과 실제 비교 ──
test("compareActual: 예상 밖 파일과 같은 묶음 일감과의 실제 겹침", () => {
  const { conductor } = setup();
  const r = conductor.compareActual({ predicted: ["lib/a.dart"], actual: ["lib/a.dart", "lib/shared.dart"], mateActuals: [["lib/shared.dart", "lib/z.dart"]] });
  assert.deepEqual(r.unexpected, ["lib/shared.dart"]);
  assert.deepEqual(r.overlapFiles, ["lib/shared.dart"]);
  assert.equal(r.overlap, true);
  const clean = conductor.compareActual({ predicted: ["lib/a.dart"], actual: ["lib/a.dart"], mateActuals: [["lib/b.dart"]] });
  assert.deepEqual(clean, { unexpected: [], overlapFiles: [], overlap: false });
});

test("annotateActual + 그룹 요약: 지휘자가 묶은 일감만 비교하고, 예상 밖 파일 때문에 실제로 겹쳤으면 '예상 빗나감'", async () => {
  const { conductor, parallel, add, jobs } = setup();
  const info = (files) => ({ decision: "grouped", reason: "r", key: "k", at: "t", files, areas: [], confidence: "high", groupWith: [], model: "haiku" });
  const a = add({ status: "done", parallelGroup: "g-abc123", parallelSource: "conductor", finishedAt: new Date(5000), conductorInfo: info(["lib/a.dart"]) });
  const b = add({ status: "running", parallelGroup: "g-abc123", parallelSource: "conductor", conductorInfo: info(["lib/b.dart"]) });
  const base = { worktree: true, lockWait: null, merging: false, rebases: 0, mergedAt: "2026-01-01T00:00:00.000Z", checks: "통과" };
  const ia = await conductor.annotateActual(a.id, { ...base, actualFiles: ["lib/a.dart", "lib/shared.dart"] });
  assert.deepEqual(ia.unexpected, ["lib/shared.dart"]);
  assert.equal(ia.overlap, false, "아직 겹칠 상대가 없음");
  a.parallelInfo = ia;
  const ib = await conductor.annotateActual(b.id, { ...base, actualFiles: ["lib/b.dart", "lib/shared.dart"] });
  assert.deepEqual(ib.unexpected, ["lib/shared.dart"]);
  assert.deepEqual(ib.overlapFiles, ["lib/shared.dart"]);
  assert.equal(ib.overlap, true);
  b.parallelInfo = ib;
  b.status = "done";
  b.finishedAt = new Date(6000);
  assert.deepEqual(parallel.readParallelInfo(ib).unexpected, ["lib/shared.dart"], "화면용 정리를 거쳐도 남는다");
  const rep = parallel.summarizeGroup("app-a", "g-abc123", jobs);
  assert.equal(rep.missed, true);
  assert.match(rep.text, /예상 빗나감/);
  assert.equal(rep.source, "conductor");
  a.parallelInfo = { ...base, actualFiles: ["lib/s.dart"], unexpected: [], overlapFiles: [], overlap: false };
  b.parallelInfo = { ...base, actualFiles: ["lib/s.dart"], unexpected: [], overlapFiles: ["lib/s.dart"], overlap: true };
  assert.notEqual(parallel.summarizeGroup("app-a", "g-abc123", jobs).missed, true, "겹쳤어도 예상한 파일이면 빗나감이 아니다");
  const m = add({ status: "running", parallelGroup: "g-man001", parallelSource: "manual" });
  const same = await conductor.annotateActual(m.id, { ...base, actualFiles: ["x"] });
  assert.equal(same.unexpected, undefined, "사람이 묶은 그룹은 비교하지 않는다");
});

// ── 마지막 전체 점검 ──
function groupDone(s, source) {
  const a = s.add({ status: "done", parallelGroup: "g-fin001", parallelSource: source, finishedAt: new Date(1000) });
  const b = s.add({ status: "done", parallelGroup: "g-fin001", parallelSource: source, finishedAt: new Date(2000) });
  return [a, b];
}

test("마지막 전체 점검: 지휘자가 묶은 그룹은 마지막 일감이 합쳐진 뒤 점검 대기 → 통과하면 그룹 완료 요약, 실패하면 '그룹 최종 점검 실패'로 보고(알림 글 포함)", async () => {
  const s = setup();
  const [a, b] = groupDone(s, "conductor");
  a.status = "running";
  assert.deepEqual(await s.parallel.finishGroupIfDone(b.id), { report: null, finalCheck: null }, "아직 한 일감이 남음");
  a.status = "done";
  const end = await s.parallel.finishGroupIfDone(b.id);
  assert.deepEqual(end.finalCheck, { appSlug: "app-a", group: "g-fin001" });
  assert.equal(end.report, null, "점검 전에는 그룹 완료로 남기지 않는다");
  assert.deepEqual(await s.parallel.readGroupReports(), []);
  const fail = await s.parallel.completeFinalCheck({ appSlug: "app-a", group: "g-fin001", ok: false, detail: "flutter test 3개 실패" });
  assert.equal(fail.ok, true);
  assert.match(fail.notify, /그룹 최종 점검 실패/);
  assert.match(fail.notify, /flutter test 3개 실패/);
  assert.match(fail.notify, /되돌리지 않았어요/);
  assert.equal(fail.report.finalCheck.ok, false);
  const saved = await s.parallel.readGroupReports();
  assert.equal(saved.length, 1);
  assert.match(saved[0].text, /그룹 최종 점검 실패/);
  assert.doesNotMatch(saved[0].text, /마지막 전체 점검 통과/);
  assert.equal(a.status, "done", "이미 합친 일감 상태는 되돌리지 않는다");
  assert.equal((await s.parallel.completeFinalCheck({ appSlug: "app-a", group: "g-fin001", ok: true })).ok, false, "같은 점검을 두 번 받지 않는다");
  await s.parallel.finishGroupIfDone(b.id);
  const ok = await s.parallel.completeFinalCheck({ appSlug: "app-a", group: "g-fin001", ok: true, detail: "" });
  assert.equal(ok.notify, null);
  assert.equal(ok.report.finalCheck.ok, true);
  assert.match((await s.parallel.readGroupReports())[0].text, /마지막 전체 점검 통과/);
});

test("마지막 전체 점검: 사람이 묶은 그룹은 C-1 그대로(점검 없이 바로 요약). 점검 결과가 오지 않으면 30분 뒤 '결과가 오지 않음'으로 요약을 남긴다", async () => {
  const s = setup();
  const [, b] = groupDone(s, "manual");
  const r = await s.parallel.finishGroupIfDone(b.id);
  assert.equal(r.finalCheck, null);
  assert.ok(r.report);
  assert.equal((await s.parallel.recordGroupReportIfDone(b.id)).group, "g-fin001", "예전 이름도 그대로");
  const t = setup();
  const [, d] = groupDone(t, null);
  assert.equal((await t.parallel.finishGroupIfDone(d.id)).finalCheck, null, "출처 없음(C-1 이전)도 사람 그룹과 같다");
  const u = setup();
  const [, e] = groupDone(u, "conductor");
  await u.parallel.finishGroupIfDone(e.id);
  assert.equal(await u.parallel.settleStaleFinalChecks(Date.now() + 5 * 60_000), 0);
  assert.equal(await u.parallel.settleStaleFinalChecks(Date.now() + 31 * 60_000), 1);
  const rep = (await u.parallel.readGroupReports())[0];
  assert.equal(rep.finalCheck.ok, null);
  assert.match(rep.text, /결과가 오지 않았어요/);
});

// ── 통제실 표시·설정·연결 ──
test("설정: 자동 묶기 기본 켜기·끄기, 모델 기본 haiku, 공용 파일 기본 목록과 저장", async () => {
  const { conductor } = setup();
  assert.equal(await conductor.isAutoGroupEnabled(), true);
  await conductor.setAutoGroupEnabled(false);
  assert.equal(await conductor.isAutoGroupEnabled(), false);
  await conductor.setAutoGroupEnabled(true);
  assert.deepEqual(await conductor.getConductorModel(), { value: "haiku", isDefault: true });
  await conductor.setConductorModel("sonnet");
  assert.deepEqual(await conductor.getConductorModel(), { value: "sonnet", isDefault: false });
  assert.equal((await conductor.getSharedFiles()).isDefault, true);
  await conductor.setSharedFiles(["a.txt", "b/**"]);
  assert.deepEqual(await conductor.getSharedFiles(), { value: ["a.txt", "b/**"], isDefault: false });
  const snap = await conductor.conductorSnapshot();
  assert.equal(snap.autoGroup, true);
  assert.equal(snap.model, "sonnet");
});

test("대기열 표시: 묶었으면 이유와 예상 파일, 순서대로 뒀으면 이유, 판단 실패면 사유 / 판단한 적 없으면 null", () => {
  const { parallel } = setup();
  const queue = loadTs("lib/factory/queue.ts", { "@/lib/prisma": { __esModule: true, default: {} }, "@/lib/factory/parallel": parallel });
  const info = (decision, reason, files = []) => ({ decision, reason, key: "k", at: "t", files, areas: ["screen"], confidence: "high", groupWith: [], model: "haiku" });
  const row = (id, n, over) => ({ id, title: id.toUpperCase(), kind: "revision", status: "approved", priority: 0, approvedAt: new Date(n), createdAt: new Date(n), ...over });
  const rows = queue.numberQueue([
    row("a", 1, { parallelGroup: "g-x", parallelSource: "conductor", conductorInfo: info("grouped", "다른 화면", ["lib/a.dart"]) }),
    row("b", 2, { conductorInfo: info("sequential", "pubspec.yaml 공통") }),
    row("c", 3, { conductorInfo: info("failed", "시간 초과") }),
    row("z", 4, {}),
  ]);
  assert.equal(rows[0].parallelSource, "conductor");
  assert.equal(rows[0].conductor.decision, "grouped");
  assert.deepEqual(rows[0].conductor.files, ["lib/a.dart"]);
  assert.equal(rows[1].conductor.reason, "pubspec.yaml 공통");
  assert.equal(rows[2].conductor.decision, "failed");
  assert.equal(rows[3].conductor, null);
});

test("연결: /next 는 conductor 파라미터를 보낸 감독 프로그램에만 판단·보류를 적용, 통제실 control API·화면·package.json 에 연결", () => {
  const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");
  const next = read("app/api/factory/next/route.ts");
  assert.match(next, /conductorParam === "1" \|\| conductorParam === "busy"/);
  assert.match(next, /appsToHold\(cs, capable\)/);
  assert.match(next, /conductorParam === "1" && !drain/);
  const control = read("app/api/admin/factory/control/route.ts");
  for (const k of ["conductorAutoGroup", "conductorModel", "conductorSharedFiles"]) assert.match(control, new RegExp(k));
  assert.match(read("components/admin/factory/FactoryConsole.tsx"), /<ConductorSettings \/>/);
  assert.match(read("components/admin/factory/AppQueue.tsx"), /conductorLine/);
  assert.match(read("app/api/factory/conductor/route.ts"), /action === "final"/);
  assert.match(read("app/api/factory/report/route.ts"), /finalCheck/);
  const sql = read("prisma/migrations/20261110090000_job_conductor/migration.sql");
  assert.match(sql, /ADD COLUMN "parallelSource" TEXT/);
  assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE/i);
  assert.match(read("package.json"), /test:conductor/);
});
