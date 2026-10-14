// 같은 앱 일감 쌓기 + 우선순위 대기열(병렬화 단계 B) 시험:
// 같은 앱에 3개 등록(막지 않음·중복/검토 대기만 거절·응답에 대기 순서) · priority→승인→등록 순서 규칙(서버 SQL·화면 계산) ·
// 시작 시점 부모 재지정(직접 적은 parentJobId 는 그대로) · 우선순위 변경·취소·재시도 · 다른 앱 대기열이 서로 영향 없음 · 커넥터 도구.
// 가짜 DB 로만 돌린다(실제 DB·네트워크 없음). 실행: npm run test:app-queue
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
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}


// 병행 실행(lib/factory/parallel.ts): jobs.ts·queue.ts 가 불러오는 모듈을 시험용 가짜 DB 로 실제 코드 그대로 적재한다
const parallelFor = (prisma) => loadTs("lib/factory/parallel.ts", { "@/lib/prisma": { __esModule: true, default: prisma } });

// ── 가짜 DB ──
const match = (r, where = {}) =>
  Object.entries(where).every(([k, v]) => {
    if (k === "OR") return v.some((w) => match(r, w));
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(r[k]);
      if ("not" in v) return r[k] !== v.not;
    }
    return r[k] === v;
  });

function fakeDb() {
  const jobs = [];
  const logs = [];
  let seq = 0;
  let clock = 1_000;
  const factoryJob = {
    count: async ({ where }) => jobs.filter((j) => match(j, where)).length,
    findFirst: async ({ where, orderBy }) => {
      const hit = jobs.filter((j) => match(j, where));
      if (orderBy?.finishedAt === "desc") hit.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
      return hit[0] ?? null;
    },
    findMany: async ({ where }) => jobs.filter((j) => match(j, where)).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)),
    findUnique: async ({ where }) => jobs.find((j) => j.id === where.id) ?? null,
    create: async ({ data }) => {
      const row = { id: `j${++seq}`, status: "pending", priority: 0, approvedAt: null, createdAt: new Date(clock++), finishedAt: null, parentExplicit: false, ...data };
      jobs.push(row);
      return { id: row.id };
    },
    update: async ({ where, data }) => Object.assign(jobs.find((j) => j.id === where.id), data),
    updateMany: async ({ where, data }) => {
      const hit = jobs.filter((j) => match(j, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
  };
  const factoryJobLog = { create: async ({ data }) => logs.push(data), createMany: async ({ data }) => logs.push(...data) };
  const prisma = { factoryJob, factoryJobLog, $transaction: async (fn) => fn(prisma), $executeRaw: async () => 0, $queryRaw: async () => [] };
  return { prisma, jobs, logs };
}

function setup() {
  const db = fakeDb();
  const queue = loadTs("lib/factory/queue.ts", { "@/lib/prisma": { __esModule: true, default: db.prisma }, "@/lib/factory/parallel": parallelFor(db.prisma) });
  const jobsMod = loadTs("lib/factory/jobs.ts", {
    "@/lib/prisma": { __esModule: true, default: db.prisma },
    "@/lib/factory/reviewVideo": { deleteReviewVideo: async () => {} },
    "@/lib/factory/mask": { maskSecrets: (v) => v },
    "@/lib/factory/ai": { AI_LABELS: {}, isAiEngine: (v) => v === "claude" || v === "codex", readModelChoice: () => ({ ok: true, model: null }) },
    "@/lib/factory/settings": { getDefaultClaudeModel: async () => null },
    "@/lib/factory/toolBroker": { cleanToolRequests: () => null },
    "@/lib/factory/handoff": { cleanHandoff: () => null },
    "@/lib/factory/parallel": parallelFor(db.prisma),
  });
  const mcp = loadTs("lib/factory/mcp.ts", {
    "@/lib/prisma": { __esModule: true, default: db.prisma },
    "@/lib/factory/ai": { isAiEngine: (v) => v === "claude" || v === "codex" },
    "@/lib/factory/settings": { getDefaultAiEngine: async () => "claude" },
    "@/lib/factory/secretEntries": { knownSecretNames: async () => [] },
    "@/lib/factory/telegram": { notifyJobEvent: async () => {} },
    "@/lib/factory/projectLinks": {}, "@/lib/factory/projectLinksDb": {}, // get_project_links 는 이 시험에서 쓰지 않는다
    "@/lib/factory/supervisor": { runSupervisorAction: async () => ({}), SUPERVISOR_ACTIONS: [] },
    "@/lib/factory/release": {},
    "@/lib/factory/storeAssets": {},
    "@/lib/factory/storeTarget": {},
    "@/lib/factory/lab": { LAB_KIND: "lab", LAB_SLUG: "lab" },
    "@/lib/factory/queue": queue,
    "@/lib/factory/jobs": jobsMod,
    "@/lib/factory/parallel": parallelFor(db.prisma),
  });
  return { ...db, queue, jobsMod, mcp };
}

const DONE = (extra = {}) => ({ id: "done1", appSlug: "alpha-app", title: "알파", status: "done", kind: "new", stack: "flutter", finishedAt: 100, createdAt: new Date(1), planHash: "d", ...extra });
let planSeq = 0;
const plan = (n) => `# 수정 지시 ${n}\n\n` + "내용을 충분히 길게 적어서 최소 글자 수를 넘깁니다. ".repeat(3);
const send = (ctx, extra = {}) => ctx.mcp.enqueue({ appSlug: "alpha-app", title: "알파", kind: "revision", planMarkdown: plan(++planSeq), ...extra });
const idOf = (res) => /id: ([A-Za-z0-9_-]+)/.exec(res.content[0].text)?.[1];

test("같은 앱에 3개 등록: 막지 않고, 응답에 대기 순서가 나온다", async () => {
  const ctx = setup();
  ctx.jobs.push(DONE());
  const a = await send(ctx);
  const b = await send(ctx);
  const c = await send(ctx, { priority: 5 });

  for (const r of [a, b, c]) assert.ok(!r.isError, r.content[0].text);
  assert.match(a.content[0].text, /대기 순서는 1번째/);
  assert.match(b.content[0].text, /대기 순서는 2번째예요\(앞에 대기 1개/);
  assert.match(c.content[0].text, /대기 순서는 1번째예요\(앞에 대기 0개.*priority 5/, "priority 가 높으면 앞 순서");
  assert.equal(ctx.jobs.filter((j) => j.status === "pending").length, 3);
});

test("실행 중인 일감이 있어도 등록되고, 순서 안내에 지금 실행 중 1개가 붙는다", async () => {
  const ctx = setup();
  ctx.jobs.push(DONE(), { id: "run1", appSlug: "alpha-app", title: "돌고있음", kind: "revision", status: "running", priority: 0, approvedAt: new Date(5), createdAt: new Date(5) });
  const r = await send(ctx);

  assert.ok(!r.isError, r.content[0].text);
  assert.match(r.content[0].text, /대기 순서는 1번째예요\(앞에 대기 0개 \+ 지금 실행 중 1개/);
});

test("거절은 둘뿐: 내용이 똑같은 중복 등록, 검토 대기 출시 일감이 있는 앱", async () => {
  const ctx = setup();
  ctx.jobs.push(DONE());
  const same = plan("같은내용");
  assert.ok(!(await send(ctx, { planMarkdown: same })).isError);
  const dup = await send(ctx, { planMarkdown: same });
  assert.ok(dup.isError);
  assert.match(dup.content[0].text, /내용이 똑같은 지시/);

  ctx.jobs.push({ id: "rv", appSlug: "alpha-app", title: "출시", kind: "release", status: "review", planHash: "x", createdAt: new Date(9) });
  const blocked = await send(ctx);
  assert.ok(blocked.isError);
  assert.match(blocked.content[0].text, /검토 대기/);
  // 다른 앱은 영향 없음
  const other = await ctx.mcp.enqueue({ appSlug: "beta-app", title: "베타", kind: "new", planMarkdown: plan("b") });
  assert.ok(!other.isError, other.content[0].text);
});

test("kind=revision 은 완성(done)된 앱만: 완성 앱은 실행 전 일감이 있어도 계속 등록됨", async () => {
  const ctx = setup();
  const r = await ctx.mcp.enqueue({ appSlug: "gamma-app", title: "감마", kind: "revision", planMarkdown: plan("g") });
  assert.ok(r.isError);
  assert.match(r.content[0].text, /완성된 앱이 없어서/);
  ctx.jobs.push(DONE({ id: "dg", appSlug: "gamma-app" }));
  assert.ok(!(await ctx.mcp.enqueue({ appSlug: "gamma-app", title: "감마", kind: "revision", planMarkdown: plan("g1") })).isError);
  assert.ok(!(await ctx.mcp.enqueue({ appSlug: "gamma-app", title: "감마", kind: "revision", planMarkdown: plan("g2") })).isError, "실행 전 일감이 있어도 등록됨");
});

test("순서 규칙: priority 큰 값 → 먼저 승인 → 먼저 등록, 미승인(pending)은 승인된 것 뒤", () => {
  const { queue } = setup();
  const row = (id, status, priority, approved, created) => ({ id, title: id, kind: "revision", status, priority, approvedAt: approved === null ? null : new Date(approved), createdAt: new Date(created) });
  const rows = [
    row("p0", "pending", 0, null, 1),
    row("a-late", "approved", 0, 50, 2),
    row("a-early", "approved", 0, 10, 3),
    row("hi", "approved", 9, 90, 4),
    row("run", "running", -5, 5, 0),
    row("a-old-created", "approved", 0, 10, 0.5),
  ];
  const out = queue.numberQueue(rows).map((q) => `${q.position}:${q.id}`);
  assert.deepEqual(out, ["0:run", "1:hi", "2:a-old-created", "3:a-early", "4:a-late", "5:p0"]);
  // 실행 중이 없으면 1번부터
  assert.deepEqual(queue.numberQueue(rows.filter((r) => r.id !== "run")).map((q) => q.position), [1, 2, 3, 4, 5]);
});

test("서버 가져가기: 앱마다 하나(실행 중이면 건너뜀), priority DESC → approvedAt → createdAt (병행 그룹이 없으면 예전과 같음)", async () => {
  const ctx = setup();
  const par = parallelFor(ctx.prisma);
  const at = (n) => new Date(n);
  const approved = [
    { id: "low", appSlug: "app-a", kind: "revision", priority: 0, approvedAt: at(1), createdAt: at(1), parallelGroup: null },
    { id: "hi", appSlug: "app-a", kind: "revision", priority: 5, approvedAt: at(9), createdAt: at(9), parallelGroup: null },
    { id: "other", appSlug: "app-b", kind: "new", priority: 1, approvedAt: at(2), createdAt: at(2), parallelGroup: null },
    { id: "busy", appSlug: "app-c", kind: "revision", priority: 9, approvedAt: at(3), createdAt: at(3), parallelGroup: null },
  ];
  const running = [{ appSlug: "app-c", kind: "revision", parallelGroup: null }];
  // 앱마다 하나: app-a 는 priority 높은 hi, app-c 는 이미 돌고 있어 건너뜀. 전체 순서는 priority 큰 값 먼저
  assert.deepEqual(par.pickClaims({ approved, running, slots: 4 }), ["hi", "other"]);
  assert.deepEqual(par.pickClaims({ approved, running, slots: 1 }), ["hi"], "slots 만큼만");
  // 서버 가져가기는 한 문장으로, UPDATE 에서 승인 상태를 다시 확인한다
  const src = fs.readFileSync(path.join(repo, "lib/factory/jobs.ts"), "utf8");
  assert.match(src, /WHERE "status" = 'approved' AND "id" IN \(\$\{Prisma\.join\(ids\)\}\)/);
  assert.match(src, /pickClaims\(/);
});

test("시작 시점 부모 재지정: 가장 최근 완료 지시로, 직접 적은 parentJobId 는 그대로", async () => {
  const ctx = setup();
  ctx.jobs.push(
    DONE({ id: "d1", finishedAt: 100 }),
    { id: "r1", appSlug: "alpha-app", title: "첫 수정", kind: "revision", status: "done", finishedAt: 200, parentJobId: "d1", parentExplicit: false, planHash: "1", createdAt: new Date(2) },
    { id: "r2", appSlug: "alpha-app", title: "둘째 수정(자동)", kind: "revision", status: "running", parentJobId: "d1", parentExplicit: false, planHash: "2", createdAt: new Date(3) },
    { id: "r3", appSlug: "alpha-app", title: "셋째 수정(직접 지정)", kind: "revision", status: "running", parentJobId: "d1", parentExplicit: true, planHash: "3", createdAt: new Date(4) },
  );
  const claim = (id) => {
    // 가져가기 후보 계산(findMany)용 상태: 고른 일감만 승인 상태, 나머지는 끝난 것으로
    for (const j of ctx.jobs) if (j.id === "r2" || j.id === "r3") Object.assign(j, { status: j.id === id ? "approved" : "done", aiEngine: "codex" });
    ctx.prisma.$queryRaw = async () => [{ id, appSlug: "alpha-app", kind: "revision", parentJobId: "d1", aiEngine: "codex", aiModel: null, priority: 0, attempts: 1 }];

    return ctx.jobsMod.claimJobs("pc", 1, ["claude", "codex"]);
  };
  const first = await claim("r2");
  assert.equal(first[0].parentJobId, "r1", "반환 값도 새 부모");
  assert.equal(ctx.jobs.find((j) => j.id === "r2").parentJobId, "r1");
  assert.ok(ctx.logs.some((l) => l.jobId === "r2" && /다시 정했어요/.test(l.message)));

  const second = await claim("r3");
  assert.equal(second[0].parentJobId, "d1");
  assert.equal(ctx.jobs.find((j) => j.id === "r3").parentJobId, "d1", "직접 적은 부모는 그대로");
});

test("등록 요청의 parentJobId 는 parentExplicit 으로 남고, 비우면 false", async () => {
  const ctx = setup();
  ctx.jobs.push(DONE());
  const auto = await send(ctx);
  const explicit = await send(ctx, { parentJobId: "done1" });
  assert.equal(ctx.jobs.find((j) => j.id === idOf(auto)).parentExplicit, false);
  assert.equal(ctx.jobs.find((j) => j.id === idOf(auto)).parentJobId, "done1");
  assert.equal(ctx.jobs.find((j) => j.id === idOf(explicit)).parentExplicit, true);
});

test("우선순위 변경·취소·재시도: 대기 일감만, 같은 앱에 다른 일감이 있어도 재시도됨", async () => {
  const ctx = setup();
  ctx.jobs.push(DONE());
  const id = idOf(await send(ctx));
  assert.equal((await ctx.jobsMod.adminAction(id, { action: "set-priority", priority: 7 })).ok, true);
  assert.equal(ctx.jobs.find((j) => j.id === id).priority, 7);
  assert.equal((await ctx.jobsMod.adminAction(id, { action: "set-priority", priority: 101 })).ok, false);
  assert.equal((await ctx.jobsMod.adminAction(id, { action: "approve" })).ok, true);
  assert.ok(ctx.jobs.find((j) => j.id === id).approvedAt);

  const other = idOf(await send(ctx));
  assert.equal((await ctx.jobsMod.adminAction(other, { action: "cancel" })).ok, true);
  assert.equal(ctx.jobs.find((j) => j.id === other).status, "cancelled");
  assert.equal((await ctx.jobsMod.adminAction(other, { action: "set-priority", priority: 1 })).ok, false, "취소된 건 못 바꿈");

  ctx.jobs.push({ id: "bad", appSlug: "alpha-app", title: "실패", kind: "revision", status: "failed", createdAt: new Date(3) });
  const retry = await ctx.jobsMod.adminAction("bad", { action: "retry" });
  assert.equal(retry.ok, true, retry.message);
  assert.equal(ctx.jobs.find((j) => j.id === "bad").status, "approved");
});

test("커넥터: set_job_priority 는 순서를 돌려주고, list_factory_jobs 는 대기 순서를 붙인다", async () => {
  const ctx = setup();
  ctx.jobs.push(DONE());
  const a = idOf(await send(ctx));
  const b = idOf(await send(ctx));
  await ctx.jobsMod.adminAction(a, { action: "approve" });
  await ctx.jobsMod.adminAction(b, { action: "approve" });
  const set = await ctx.mcp.callFactoryTool("set_job_priority", { id: b, priority: 3 });
  assert.ok(!set.isError, set.content[0].text);
  assert.match(set.content[0].text, /대기 순서는 1번째/);
  const bad = await ctx.mcp.callFactoryTool("set_job_priority", { id: b, priority: 500 });
  assert.ok(bad.isError);
  assert.ok(ctx.mcp.FACTORY_TOOLS.some((t) => t.name === "set_job_priority"));

  const list = JSON.parse((await ctx.mcp.callFactoryTool("list_factory_jobs", { appSlug: "alpha-app", status: "approved" })).content[0].text);
  const byId = Object.fromEntries(list.지시.map((j) => [j.id, j]));
  assert.equal(byId[b].대기순서, 1);
  assert.equal(byId[a].대기순서, 2);
  assert.equal(byId[b].priority, 3);
});

test("다른 앱끼리는 대기열이 따로: 한 앱의 실행·순서가 다른 앱 번호에 영향 없음", async () => {
  const ctx = setup();
  const row = (id, slug, status, priority, t) => ({ id, appSlug: slug, title: id, kind: "revision", status, priority, approvedAt: new Date(t), createdAt: new Date(t) });
  ctx.jobs.push(row("a-run", "app-a", "running", 0, 1), row("a-q", "app-a", "approved", 0, 2), row("b-q1", "app-b", "approved", 0, 3), row("b-q2", "app-b", "approved", 5, 4), { ...row("lab1", "lab", "approved", 0, 5), kind: "lab" });
  const all = await ctx.queue.allAppQueues();
  assert.deepEqual(all["app-a"].map((q) => `${q.position}:${q.id}`), ["0:a-run", "1:a-q"]);
  assert.deepEqual(all["app-b"].map((q) => `${q.position}:${q.id}`), ["1:b-q2", "2:b-q1"]);
  assert.equal(all.lab, undefined, "실험 일감은 앱 대기열이 아님");
  assert.deepEqual((await ctx.queue.appQueue("app-b")).map((q) => q.id), ["b-q2", "b-q1"]);
});

test("화면: 올리기/내리기는 바로 앞(뒤) 일감과 priority 를 1 차이로 바꾸고, 실행 중·한계는 막음", () => {
  const { movedPriority } = loadTs("components/admin/factory/AppQueue.tsx", { react: { useCallback: (f) => f, useEffect: () => {}, useState: () => [null, () => {}] }, "react/jsx-runtime": { jsx: () => null, jsxs: () => null, Fragment: null } });
  const items = [
    { id: "r", status: "running", priority: 0, position: 0 },
    { id: "a", status: "approved", priority: 5, position: 1 },
    { id: "b", status: "approved", priority: 2, position: 2 },
    { id: "c", status: "pending", priority: -100, position: 3 },
  ];
  assert.equal(movedPriority(items, 2, "up"), 6, "b 를 a 앞으로");
  assert.equal(movedPriority(items, 1, "up"), null, "실행 중 앞으로는 못 감");
  assert.equal(movedPriority(items, 1, "down"), 1, "a 를 b 뒤로");
  assert.equal(movedPriority(items, 2, "down"), null, "하한 -100");
  assert.equal(movedPriority(items, 3, "down"), null, "맨 끝은 더 못 내림");
});
