// 5-1 시험: 계획 먼저 승인 + 변경 내용(diff) 보기
//  - 계획 단계 흐름: 승인 방식 고르기(기본 바로 시작), 계획 만들 차례 내주기(한 번에 하나, 멈춘 것 다시), 계획 저장, 이대로 진행/수정 지시/취소, 계획 선택 대기 일감은 가져가지 않고 뒤 일감도 막기, 승인된 계획을 지시문에 붙이기
//  - 읽기 전용 계획 턴: 열린 도구·막힌 도구, 읽기 전용 위반 감지, 새 앱(앱 폴더 없음), 동시에 1개
//  - diff 크기 제한: 파일 수·파일별·전체 크기, 큰 파일·바이너리는 요약만, 서버가 한 번 더 자름
//  - 비밀 파일 숨김: 이름 패턴(감독 프로그램과 서버가 같은 판정), 내용 안 읽음, 보고 어디에도 값이 없음, 서버가 위조된 내용도 지움, 본문 안 키·비밀번호 줄 가림
//  - 연결: /next·텔레그램·커넥터·화면·마이그레이션(데이터를 지우지 않음)
// 실제 DB·AI·네트워크는 쓰지 않는다(가짜 DB, 가짜 claude, 임시 git 저장소). 실행: node tests/plan-first.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");
const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0;
const skip = !canSpawn && "host sandbox blocks child processes";

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}
const sup = (name) => import(pathToFileURL(path.join(repo, "tools/factory-supervisor", name)).href);

const mask = loadTs("lib/factory/mask.ts");
const labels = loadTs("lib/factory/planLabels.ts");
const diffLib = loadTs("lib/factory/diffReport.ts", { "@/lib/factory/mask": mask });
const { collectDiff, isSecretPath: supIsSecret, maskDiffText: supMask, DIFF_LIMITS: supLimits } = await sup("diffreport.mjs");
const { planPrompt, parsePlan, runPlanTurn, planBusy } = await sup("planturn.mjs");

// ───────── 가짜 DB ─────────
const match = (r, where = {}) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(r[k]);
      if ("not" in v) return r[k] !== v.not;
    }
    return r[k] === v;
  });

function fakeDb() {
  const jobs = [];
  const settings = new Map();
  const prisma = {
    factoryJob: {
      findMany: async ({ where }) => jobs.filter((j) => match(j, where)).map((j) => ({ ...j })),
      findUnique: async ({ where }) => {
        const j = jobs.find((x) => x.id === where.id);

        return j ? { ...j } : null;
      },
      updateMany: async ({ where, data }) => {
        const hit = jobs.filter((j) => match(j, where));

        for (const r of hit) Object.assign(r, data);

        return { count: hit.length };
      },
      update: async ({ where, data }) => Object.assign(jobs.find((x) => x.id === where.id), data),
      count: async () => 0,
    },
    factoryJobLog: { createMany: async () => ({}) },
    factorySetting: {
      findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      upsert: async ({ where, create, update }) => (settings.set(where.key, settings.has(where.key) ? update.value : create.value), {}),
    },
  };
  let n = 0;
  const add = (over = {}) => {
    n++;
    const row = { id: `j${n}`, appSlug: "app-a", title: `일감 ${n}`, kind: "revision", stack: "flutter", aiEngine: "claude", aiModel: null, status: "approved", priority: 0, approvedAt: new Date(1000 * n), createdAt: new Date(1000 * n), updatedAt: new Date(1000 * n), planMarkdown: `지시 ${n}: 로그인 화면을 고쳐 주세요`, planFirst: false, planStatus: null, planText: null, planNote: null, planInfo: null, parallelGroup: null, ...over };
    jobs.push(row);

    return row;
  };

  return { jobs, settings, prisma, add };
}

const planWith = (db) => loadTs("lib/factory/planFirst.ts", { "@/lib/prisma": { __esModule: true, default: db.prisma }, "@/lib/factory/mask": mask, "@/lib/factory/planLabels": labels });
const NOW = Date.parse("2026-10-15T05:00:00Z");

// ═════════ 계획 단계 흐름 ═════════

test("승인 방식: 기본은 바로 시작, 일감별 선택이 설정보다 우선, 출시·실험·도구는 늘 바로 시작", () => {
  const p = planWith(fakeDb());
  assert.deepEqual(p.approveData("revision", undefined, false), { planFirst: false, planStatus: null, planText: null, planNote: null, planInfo: null });
  assert.equal(p.approveData("new", undefined, true).planStatus, "requested", "설정 기본값이 켜져 있으면 계획 먼저");
  assert.equal(p.approveData("revision", true, false).planFirst, true, "일감별 체크가 설정보다 우선");
  assert.equal(p.approveData("revision", false, true).planFirst, false, "체크를 끄면 설정이 켜져 있어도 바로 시작");
  for (const kind of ["release", "lab", "tool"]) assert.equal(p.approveData(kind, true, true).planFirst, false, kind);
  assert.equal(p.approveData("new", "yes", false).planFirst, false, "true/false 가 아닌 값은 설정 기본값");
});

test("설정 기본값: 정한 적 없으면 꺼짐, 저장하면 따라간다", async () => {
  const db = fakeDb();
  const p = planWith(db);
  assert.deepEqual(await p.getPlanFirstDefault(), { value: false, isDefault: true });
  await p.setPlanFirstDefault(true);
  assert.deepEqual(await p.getPlanFirstDefault(), { value: true, isDefault: false });
  await p.setPlanFirstDefault(false);
  assert.equal((await p.getPlanFirstDefault()).value, false);
});

test("계획 흐름: 만들 차례 → 만드는 중 → 사람 선택 대기 → 수정 지시 → 이대로 진행", async () => {
  const db = fakeDb();
  const p = planWith(db);
  const job = db.add({ planFirst: true, planStatus: "requested" });

  const t1 = await p.planTaskForNext("haiku", NOW);
  assert.equal(t1.jobId, job.id);
  assert.equal(t1.model, "haiku");
  assert.match(t1.instruction, /로그인 화면/);
  assert.equal(t1.round, 1);
  assert.equal(t1.previousPlan, null);
  assert.equal(job.planStatus, "running");
  assert.equal(await p.planTaskForNext("haiku", NOW + 1000), null, "만드는 중인 계획은 다시 내주지 않는다");
  assert.equal((await p.planTaskForNext("haiku", NOW + 9 * 60_000))?.jobId, job.id, "8분 넘게 결과가 없으면(감독 프로그램이 꺼짐 등) 다시 내준다");

  const r = await p.recordPlan(job.id, { ok: true, plan: "- 고칠 파일: lib/login.dart\n- 순서: 화면 → 검사\n- 위험: 없음\n- 예상 시간: 10분", usage: { ms: 5000, costUsd: 0.01, tokens: { input: 10, output: 5 } }, model: "haiku" }, new Date(NOW));
  assert.equal(r.ok, true);
  assert.equal(r.notify, true);
  assert.equal(job.planStatus, "ready");
  assert.equal(job.status, "approved", "일감 status 는 늘리지 않는다");
  assert.equal(job.planInfo.model, "haiku");
  assert.equal(job.planInfo.costUsd, 0.01);
  assert.equal(await p.planTaskForNext("haiku", NOW + 20 * 60_000), null, "사람 선택을 기다리는 동안은 내주지 않는다");
  assert.equal((await p.planReviews()).length, 1, "할 일 목록에 오른다");

  // 말 없는 수정 지시는 거절
  const bad = await p.choosePlan(job.id, "revise", "   ");
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
  assert.equal(job.planStatus, "ready");
  const rev = await p.choosePlan(job.id, "revise", "서버는 건드리지 말고 화면만");
  assert.equal(rev.ok, true);
  assert.equal(job.planStatus, "requested");
  assert.equal(job.planNote, "서버는 건드리지 말고 화면만");
  assert.equal(job.planInfo.rounds, 2);
  const t2 = await p.planTaskForNext("haiku", NOW + 30 * 60_000);
  assert.equal(t2.round, 2);
  assert.match(t2.previousPlan, /lib\/login\.dart/, "이전 계획과 수정 지시를 같이 내준다");
  assert.equal(t2.note, "서버는 건드리지 말고 화면만");
  await p.recordPlan(job.id, { ok: true, plan: "- 고칠 파일: lib/login_view.dart\n- 순서: 화면만\n- 위험: 낮음\n- 예상 시간: 8분" }, new Date(NOW));

  const go = await p.choosePlan(job.id, "go");
  assert.equal(go.ok, true);
  assert.equal(job.planStatus, "approved");
  assert.equal((await p.choosePlan(job.id, "go")).status, 409, "두 번 눌러도 한 번만");
  const late = await p.recordPlan(job.id, { ok: true, plan: "- 늦게 온 계획 늦게 온 계획" });
  assert.equal(late.status, 409, "늦게 온 계획이 사람의 선택을 덮지 못한다");
  assert.match(job.planText, /login_view/);
});

test("계획을 못 만들면 사람이 고른다: 계획 없이 진행 / 다시 계획. 수정 지시는 5번까지", async () => {
  const db = fakeDb();
  const p = planWith(db);
  const a = db.add({ planFirst: true, planStatus: "running", planInfo: { startedAt: new Date(NOW).toISOString(), rounds: 1 } });
  assert.equal((await p.recordPlan(a.id, { ok: false, reason: "시간 초과(4분)" })).ok, true);
  assert.equal(a.planStatus, "failed");
  assert.equal((await p.planReviews())[0].reason, "시간 초과(4분)");
  assert.match(p.planNoticeText({ title: "t", appSlug: "app-a", status: "failed", plan: null, reason: "시간 초과", round: 1 }), /계획을 못 만들었어요/);
  const redo = await p.choosePlan(a.id, "revise"); // 실패에서는 말 없이도 다시 계획
  assert.equal(redo.ok, true);
  assert.equal(a.planStatus, "requested");

  const b = db.add({ planFirst: true, planStatus: "failed", planInfo: { rounds: 1 } });
  const go = await p.choosePlan(b.id, "go");
  assert.match(go.message, /계획 없이/);
  assert.equal(b.planStatus, "approved");
  assert.equal(b.planText, null);

  const c = db.add({ planFirst: true, planStatus: "ready", planText: "- 계획 계획 계획", planInfo: { rounds: p.MAX_PLAN_ROUNDS } });
  const over = await p.choosePlan(c.id, "revise", "또 고쳐 주세요");
  assert.equal(over.status, 409);
  assert.match(over.message, /5번/);

  const none = db.add({ planFirst: true, planStatus: "running" });
  assert.equal((await p.choosePlan(none.id, "go")).status, 409, "만드는 중에는 고를 수 없다");
  assert.equal((await p.choosePlan("nope", "go")).status, 404);
});

test("계획 선택을 기다리는 일감은 가져가지 않고, 같은 앱의 뒤 일감도 새치기하지 못한다", () => {
  const db = fakeDb();
  const par = loadTs("lib/factory/parallel.ts", { "@/lib/prisma": { __esModule: true, default: db.prisma } });
  const p = planWith(db);
  const row = (id, app, n, over = {}) => ({ id, appSlug: app, kind: "revision", priority: 0, approvedAt: new Date(1000 * n), createdAt: new Date(1000 * n), parallelGroup: null, ...over });
  const withBlock = (r, planFirst, planStatus) => ({ ...r, blocked: p.waitsForPlan({ kind: r.kind, planFirst, planStatus }) });

  const approved = [withBlock(row("first", "app-a", 1), true, "ready"), withBlock(row("second", "app-a", 2), false, null), withBlock(row("other", "app-b", 3), false, null)];
  assert.deepEqual(par.pickClaims({ approved, running: [], slots: 4 }), ["other"], "계획 대기 일감도, 그 뒤의 같은 앱 일감도 못 가져가고 다른 앱은 그대로");
  const ok = [withBlock(row("first", "app-a", 1), true, "approved"), withBlock(row("second", "app-a", 2), false, null)];
  assert.deepEqual(par.pickClaims({ approved: ok, running: [], slots: 4 }), ["first"], "계획이 승인되면 평소 순서로");
  assert.deepEqual(par.pickClaims({ approved: [row("x", "app-a", 1)], running: [], slots: 1 }), ["x"], "blocked 가 없으면 예전과 같다");
  for (const kind of ["release", "lab", "tool"]) assert.equal(p.waitsForPlan({ kind, planFirst: true, planStatus: "ready" }), false, kind);
});

test("승인된 계획은 작업자 지시문 끝에 붙고 DB 의 기획서는 그대로", async () => {
  const db = fakeDb();
  const p = planWith(db);
  const j = db.add({ planFirst: true, planStatus: "approved", planText: "- 고칠 파일: lib/a.dart" });
  const plain = db.add({ appSlug: "app-b" });
  const rows = [{ id: j.id, planMarkdown: j.planMarkdown }, { id: plain.id, planMarkdown: plain.planMarkdown }];
  await p.attachApprovedPlans(rows);
  assert.match(rows[0].planMarkdown, /^지시 1: 로그인 화면/);
  assert.match(rows[0].planMarkdown, /## 승인된 작업 계획 \(사람이 확인함\)\n- 고칠 파일: lib\/a\.dart/);
  assert.equal(rows[1].planMarkdown, plain.planMarkdown, "계획 먼저를 안 쓴 일감은 그대로");
  assert.match(j.planMarkdown, /^지시 1/);
  assert.equal(j.planMarkdown.includes("승인된 작업 계획"), false);
  assert.equal(p.withPlan("지시", ""), "지시");
  assert.equal(p.cleanPlanText("  비밀번호: keyPassword=abc123  \u0000"), "비밀번호: keyPassword=***", "계획에 섞인 비밀번호는 가린다");
  assert.equal(p.cleanPlanText("x".repeat(5000)).length, p.MAX_PLAN_TEXT);
  assert.equal(p.cleanPlanText("   "), null);
});

test("jobs.ts: 승인 때 계획 먼저를 고르고, 가져가기에서 계획 대기는 빼고 승인된 계획은 붙인다", async () => {
  const db = fakeDb();
  const p = planWith(db);
  const ai = loadTs("lib/factory/ai.ts");
  const par = loadTs("lib/factory/parallel.ts", { "@/lib/prisma": { __esModule: true, default: db.prisma } });
  let queried = [];
  db.prisma.$queryRaw = async () => queried.map((id) => ({ ...db.jobs.find((j) => j.id === id), attempts: 1, aiEngine: "claude", aiModel: null, requiredSecrets: [] }));
  const jobsMod = loadTs("lib/factory/jobs.ts", {
    "@/lib/prisma": { __esModule: true, default: db.prisma },
    "@/lib/factory/parallel": par,
    "@/lib/factory/planFirst": p,
    "@/lib/factory/ai": ai,
    "@/lib/factory/settings": { getDefaultClaudeModel: async () => null },
    "@/lib/factory/reviewVideo": { deleteReviewVideo: async () => {} },
    "@/lib/factory/mask": mask,
    "@/lib/factory/toolBroker": { cleanToolRequests: () => null },
    "@/lib/factory/handoff": { cleanHandoff: () => null },
  });

  const a = db.add({ status: "pending" });
  const r1 = await jobsMod.adminAction(a.id, { action: "approve", planFirst: true });
  assert.equal(r1.ok, true);
  assert.match(r1.message, /계획을 만들어/);
  assert.equal(a.status, "approved");
  assert.equal(a.planFirst, true);
  assert.equal(a.planStatus, "requested");

  const b = db.add({ status: "pending", appSlug: "app-b" });
  await jobsMod.adminAction(b.id, { action: "approve" });
  assert.equal(b.planFirst, false, "기본은 바로 시작");
  await p.setPlanFirstDefault(true);
  const c = db.add({ status: "pending", appSlug: "app-c" });
  await jobsMod.adminAction(c.id, { action: "approve" });
  assert.equal(c.planFirst, true, "설정 기본값이 켜져 있으면 계획 먼저");
  const d = db.add({ status: "pending", appSlug: "app-d" });
  await jobsMod.adminAction(d.id, { action: "approve", planFirst: false });
  assert.equal(d.planFirst, false, "일감별 체크가 설정을 이긴다");
  const rel = db.add({ status: "pending", appSlug: "app-e", kind: "release" });
  await jobsMod.adminAction(rel.id, { action: "approve", planFirst: true });
  assert.equal(rel.planFirst, false, "출시 일감은 계획 단계가 없다");

  // 가져가기: a(계획 대기)·c(계획 대기)는 빼고 b·d·release 만. 계획 승인 뒤에는 a 도 나가고 지시문에 계획이 붙는다
  queried = [];
  const first = await jobsMod.claimJobs("pc", 4, ["claude"]);
  assert.deepEqual(first, [], "$queryRaw 가 빈 목록을 돌려주도록 해 둔 상태에서도 계획 대기 일감 id 는 후보에 없다");
  const picked = [];
  db.prisma.$queryRaw = async (q) => {
    const ids = q.values.filter((v) => typeof v === "string" && db.jobs.some((j) => j.id === v));
    picked.push(...ids);

    return ids.map((id) => ({ ...db.jobs.find((j) => j.id === id), attempts: 1, aiEngine: "claude", aiModel: null, requiredSecrets: [] }));
  };
  await jobsMod.claimJobs("pc", 4, ["claude"]);
  assert.equal(picked.includes(a.id) || picked.includes(c.id), false, "계획 선택을 기다리는 일감은 가져가지 않는다");
  assert.ok(picked.includes(b.id) && picked.includes(d.id));

  a.planStatus = "approved";
  a.planText = "- 고칠 파일: lib/login.dart";
  picked.length = 0;
  db.jobs.filter((j) => j.id !== a.id).forEach((j) => (j.status = "done"));
  const claimed = await jobsMod.claimJobs("pc", 4, ["claude"]);
  assert.deepEqual(picked, [a.id]);
  assert.match(claimed[0].planMarkdown, /승인된 작업 계획/);
  assert.match(claimed[0].planMarkdown, /lib\/login\.dart/);
});

// ═════════ 읽기 전용 계획 턴 ═════════

function fakeClaude({ onRun, result = "- 고칠 파일: lib/a.dart\n- 순서: 화면 → 검사\n- 위험: 낮음\n- 예상 시간: 10분", code = 0, raw = null }) {
  const seen = { args: null, opts: null, prompt: "" };
  const impl = (command, args, opts) => {
    seen.args = args;
    seen.opts = opts;
    const child = new EventEmitter();

    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 0;
    child.stdin = new Writable({
      write(chunk, _e, cb) {
        seen.prompt += chunk.toString();
        cb();
      },
      final(cb) {
        cb();
        setImmediate(async () => {
          await onRun?.(opts.cwd);
          child.stdout.write(raw ?? JSON.stringify({ is_error: false, result, total_cost_usd: 0.002, usage: { input_tokens: 100, output_tokens: 40 } }));
          child.emit("close", code);
        });
      },
    });

    return child;
  };

  return { impl, seen };
}

function appRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-plan-test-"));

  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => spawnSync("git", a, { cwd: dir, encoding: "utf8", windowsHide: true });

  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.mkdirSync(path.join(dir, "lib"));
  fs.writeFileSync(path.join(dir, "lib", "a.dart"), "void main() {}\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");

  return { dir, git };
}
const TASK = { jobId: "j1", appSlug: "app-a", title: "로그인 고치기", kind: "revision", stack: "flutter", model: "haiku", instruction: "로그인 화면의 오류를 고쳐 주세요", previousPlan: null, note: null, round: 1 };

test("계획 턴: 읽기 도구만 열고 쓰기·셸·네트워크는 막고, 가벼운 모델로 한 번 돈다", { skip }, async (t) => {
  const { dir } = appRepo(t);
  const fake = fakeClaude({});
  const res = await runPlanTurn(TASK, dir, { spawnImpl: fake.impl });

  assert.equal(res.ok, true, res.reason);
  assert.match(res.plan, /고칠 파일/);
  assert.equal(res.model, "haiku");
  assert.equal(res.usage.costUsd, 0.002);
  const args = fake.seen.args;
  const val = (flag) => args[args.indexOf(flag) + 1];

  assert.equal(val("--tools"), "Read,Glob,Grep");
  assert.equal(val("--allowedTools"), "Read,Glob,Grep");
  for (const blocked of ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"]) assert.match(val("--disallowedTools"), new RegExp(blocked));
  assert.equal(val("--model"), "haiku");
  assert.ok(args.includes("--no-session-persistence"));
  assert.equal(fake.seen.opts.cwd, dir, "앱 폴더에서 읽는다");
  assert.match(fake.seen.prompt, /로그인 화면의 오류/);
  assert.match(fake.seen.prompt, /lib\/a\.dart/, "저장소 파일 목록을 준다");
  assert.equal(planBusy(), false, "끝나면 busy 표시가 풀린다");
});

test("계획 턴: 수정 지시를 받으면 이전 계획과 사람의 말을 프롬프트에 넣는다", () => {
  const prompt = planPrompt({ ...TASK, previousPlan: "- 고칠 파일: lib/a.dart", note: "화면만 고쳐 주세요", round: 2 }, ["lib/a.dart"], false, true);
  assert.match(prompt, /이전 계획/);
  assert.match(prompt, /lib\/a\.dart/);
  assert.match(prompt, /사람의 수정 지시\n화면만 고쳐 주세요/);
  assert.match(prompt, /3~6줄/);
  assert.match(prompt, /고칠 파일.*순서.*위험.*예상 시간/s);
  assert.match(planPrompt({ ...TASK, kind: "new" }, [], false, false), /아직 앱 폴더가 없어요/);
});

test("계획 턴: 계획 줄만 꺼내고(코드 블록 표시·빈 줄 제거, 8줄·2000자 제한), 비면 실패", () => {
  assert.equal(parsePlan("```\n- 하나 하나 하나\n\n- 둘 둘 둘\n```"), "- 하나 하나 하나\n- 둘 둘 둘");
  assert.equal(parsePlan(Array.from({ length: 20 }, (_, i) => `- 줄 ${i} 줄 줄 줄`).join("\n")).split("\n").length, 8);
  assert.equal(parsePlan("x".repeat(5000)).length, 2000);
  assert.equal(parsePlan(""), null);
  assert.equal(parsePlan("네"), null);
});

test("계획 턴: AI 가 파일을 건드리면 읽기 전용 위반으로 계획을 쓰지 않는다", { skip }, async (t) => {
  const { dir } = appRepo(t);
  const fake = fakeClaude({ onRun: (cwd) => fs.writeFileSync(path.join(cwd, "lib", "a.dart"), "// 몰래 고침\n") });
  const res = await runPlanTurn(TASK, dir, { spawnImpl: fake.impl });

  assert.equal(res.ok, false);
  assert.match(res.reason, /읽기 전용 위반/);
  assert.equal(res.plan, undefined);
});

test("계획 턴: 새 앱(앱 폴더 없음)은 빈 임시 폴더에서 돌리고 끝나면 지운다", { skip }, async () => {
  const fake = fakeClaude({});
  const missing = path.join(os.tmpdir(), "factory-plan-no-such-app");
  const res = await runPlanTurn({ ...TASK, kind: "new" }, missing, { spawnImpl: fake.impl });

  assert.equal(res.ok, true, res.reason);
  assert.notEqual(fake.seen.opts.cwd, missing);
  assert.equal(fs.existsSync(fake.seen.opts.cwd), false, "임시 폴더는 지운다");
  assert.match(fake.seen.prompt, /아직 앱 폴더가 없어요/);
});

test("계획 턴: 실패는 사유와 함께 돌려주고 던지지 않는다(모델 목록 밖·비정상 종료·JSON 아님·시간 초과·동시 실행)", { skip }, async (t) => {
  const { dir } = appRepo(t);
  assert.match((await runPlanTurn({ ...TASK, model: "opus; calc" }, dir, { spawnImpl: fakeClaude({}).impl })).reason, /허용하지 않는 지휘자 모델/);
  assert.match((await runPlanTurn(TASK, dir, { spawnImpl: fakeClaude({ code: 1 }).impl })).reason, /비정상 종료/);
  assert.match((await runPlanTurn(TASK, dir, { spawnImpl: fakeClaude({ raw: "not json" }).impl })).reason, /비정상 종료/);
  assert.match((await runPlanTurn(TASK, dir, { spawnImpl: fakeClaude({ result: "네" }).impl })).reason, /계획을 쓰지 않았어요/);
  const slow = { impl: () => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: 0, kill() {}, stdin: new Writable({ write(_c, _e, cb) { cb(); } }) }) };
  assert.match((await runPlanTurn(TASK, dir, { spawnImpl: slow.impl, timeoutMs: 30 })).reason, /시간 초과/);

  let release;
  const gate = new Promise((r) => (release = r));
  const first = runPlanTurn(TASK, dir, { spawnImpl: fakeClaude({ onRun: () => gate }).impl });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(planBusy(), true);
  assert.match((await runPlanTurn(TASK, dir, { spawnImpl: fakeClaude({}).impl })).reason, /이미 돌고 있어요/);
  release();
  assert.equal((await first).ok, true);
});

// ═════════ diff 크기 제한 · 비밀 파일 숨김 ═════════

function changeRepo(t, make) {
  const { dir, git } = appRepo(t);
  const from = git("rev-parse", "HEAD").stdout.trim();

  make(dir, (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  });
  git("add", "-A");
  git("commit", "-q", "-m", "work");

  return { dir, from };
}
const lines = (n, width = 30) => Array.from({ length: n }, (_, i) => `line ${i} `.padEnd(width, "x")).join("\n") + "\n";

test("diff 보고: 커밋 범위의 파일 목록·추가/삭제 줄 수·파일별 diff", { skip }, (t) => {
  const { dir, from } = changeRepo(t, (_d, w) => {
    w("lib/a.dart", "void main() {}\nvoid more() {}\n");
    w("lib/b.dart", "class B {}\n");
    w("README.md", "# 안내\n");
  });
  const rep = collectDiff(dir, from);

  assert.equal(rep.totalFiles, 3);
  assert.equal(rep.totalAdd, 3);
  assert.equal(rep.totalDel, 0);
  const a = rep.files.find((f) => f.path === "lib/a.dart");
  assert.equal(a.status, "M");
  assert.equal(a.add, 1);
  assert.match(a.diff, /^@@/, "diff 머리(index 줄 등)는 줄이고 @@ 부터");
  assert.match(a.diff, /\+void more\(\) \{\}/);
  assert.equal(rep.files.find((f) => f.path === "lib/b.dart").status, "A");
  assert.equal(rep.truncated, false);
  assert.equal(collectDiff(dir, "zzzz"), null, "시작 커밋이 이상하면 보고하지 않는다");
  assert.equal(collectDiff(os.tmpdir(), from), null, "git 저장소가 아니면 null");
  const same = collectDiff(dir, spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim());
  assert.equal(same.totalFiles, 0, "바뀐 게 없으면 빈 보고");
});

test("diff 크기 제한: 파일별 잘림, 큰 파일·바이너리는 줄 수만, 파일 수·전체 크기 한도", { skip }, (t) => {
  const { dir, from } = changeRepo(t, (_d, w) => {
    w("src/medium.txt", lines(1200)); // 한도(20000자)보다 큼, 큰 파일 기준(2000줄)보다 작음
    w("src/medium2.txt", lines(1200));
    w("src/huge.txt", lines(3000)); // 큰 파일: 요약만
    w("src/pic.bin", Buffer.from([0, 1, 2, 0, 255, 0, 3, 0])); // 바이너리
    w("src/small.txt", "작음\n");
  });
  const rep = collectDiff(dir, from);
  const by = (p) => rep.files.find((f) => f.path === p);

  assert.equal(by("src/medium.txt").truncated, true);
  assert.equal(by("src/medium.txt").diff.length <= supLimits.perFileChars, true, "파일마다 일정 크기까지만");
  assert.equal(by("src/medium.txt").add, 1200, "잘려도 줄 수는 전체");
  assert.equal(by("src/huge.txt").skipped, "large");
  assert.equal(by("src/huge.txt").diff, undefined);
  assert.equal(by("src/huge.txt").add, 3000);
  assert.equal(by("src/pic.bin").skipped, "binary");
  assert.equal(by("src/pic.bin").diff, undefined);
  assert.equal(by("src/small.txt").diff.includes("작음"), true);
  assert.equal(rep.truncated, true);

  // 파일 수 한도·전체 크기 예산(시험용으로 낮춤)
  const few = collectDiff(dir, from, { limits: { files: 2 } });
  assert.equal(few.files.length, 2);
  assert.equal(few.moreFiles, 3);
  assert.equal(few.totalFiles, 5, "전체 개수는 그대로");
  assert.equal(few.truncated, true);
  const budget = collectDiff(dir, from, { limits: { totalChars: 15_000, perFileChars: 12_000 } });
  const used = budget.files.reduce((n, f) => n + (f.diff?.length ?? 0), 0);

  assert.ok(used <= 15_000, `전체 예산 안: ${used}`);
  assert.ok(budget.files.some((f) => f.skipped === "budget"), "예산이 다 차면 뒤쪽 파일은 줄 수만");
});

test("diff 크기 제한(서버): 감독 프로그램이 큰 값을 보내도 서버가 한 번 더 자른다", () => {
  const big = "@@ -1 +1 @@\n" + "+x".repeat(40_000);
  const report = {
    from: "a".repeat(40),
    to: "b".repeat(40),
    totalFiles: 300,
    totalAdd: 10,
    totalDel: 2,
    files: Array.from({ length: 150 }, (_, i) => ({ path: `src/f${i}.txt`, status: "M", add: 1, del: 0, binary: false, diff: big })),
  };
  const clean = diffLib.cleanDiffReport(report);

  assert.equal(clean.files.length, diffLib.DIFF_LIMITS.files);
  assert.equal(clean.moreFiles >= 50, true);
  assert.equal(clean.truncated, true);
  assert.ok(clean.files.every((f) => (f.diff?.length ?? 0) <= diffLib.DIFF_LIMITS.perFileChars));
  assert.ok(clean.files.reduce((n, f) => n + (f.diff?.length ?? 0), 0) <= diffLib.DIFF_LIMITS.totalChars, "전체 크기 예산");
  assert.ok(clean.files.some((f) => f.skipped === "budget"));
  assert.deepEqual(diffLib.DIFF_LIMITS, { files: supLimits.files, perFileChars: supLimits.perFileChars, totalChars: supLimits.totalChars, largeLines: supLimits.largeLines, pathChars: supLimits.pathChars }, "서버와 감독 프로그램의 한도가 같다");
  assert.equal(diffLib.cleanDiffReport("x"), null);
  assert.equal(diffLib.cleanDiffReport({ files: "x" }), null);
  assert.deepEqual(diffLib.cleanDiffReport(clean), clean, "다시 정리해도 같다");
  assert.equal(diffLib.cleanDiffReport({ files: [{ path: "a\nb.txt\u0000", diff: "x" }] }).files[0].path, "ab.txt", "경로의 제어문자는 지운다");
});

const SECRET_PATHS = [".env", ".env.local", "app/.env.production", "android/key.properties", "android/app/upload.jks", "release.keystore", "certs/server.pem", "secrets.env", "config/secrets.json", "id_rsa", "home/.ssh/config", "keys/google-services.json", "svc/service-account-prod.json", "credentials.json", ".npmrc", "token.json", "ios/Runner/GoogleService-Info.plist", "android/local.properties", "deploy/secrets/db.yml", "a/b/.aws/credentials", "x.p12", "vault.secret"];
const PLAIN_PATHS = ["src/env.ts", "lib/keyboard.dart", "README.md", "docs/secrets-guide.md", "lib/token_parser.dart", "src/keystore_helper.ts", "android/app/build.gradle", "pubspec.yaml", ".gitignore", "lib/auth.dart"];

test("비밀 파일 판정: 감독 프로그램과 서버가 같은 결과, 평범한 파일은 보여 준다", () => {
  for (const p of SECRET_PATHS) {
    assert.equal(supIsSecret(p), true, `감독: ${p}`);
    assert.equal(diffLib.isSecretPath(p), true, `서버: ${p}`);
  }
  for (const p of PLAIN_PATHS) {
    assert.equal(supIsSecret(p), false, `감독: ${p}`);
    assert.equal(diffLib.isSecretPath(p), false, `서버: ${p}`);
  }
  assert.equal(supIsSecret("A\\B\\.ENV"), true, "대소문자·역슬래시도 같은 판정");
  assert.equal(diffLib.isSecretPath("A\\B\\.ENV"), true);
});

test("비밀 파일 숨김: 내용을 읽지 않고, 보고 어디에도 값이 없다. 평범한 파일의 키·비밀번호 줄도 값을 가린다", { skip }, (t) => {
  const { dir, from } = changeRepo(t, (_d, w) => {
    w(".env", "API_TOKEN=supersecretvalue1234567890\n");
    w("android/key.properties", "storePassword=hunter2hunter2\nkeyAlias=upload\n");
    w("android/app/upload.jks", Buffer.alloc(2048, 7));
    w("lib/config.dart", 'const apiKey = "abcdefghijklmnop1234";\nconst name = "ok";\nfinal password = "tops3cretpassw0rd";\n');
    w("lib/main.dart", "void main() { print('hi'); }\n");
  });
  const rep = collectDiff(dir, from);
  const by = (p) => rep.files.find((f) => f.path === p);

  for (const p of [".env", "android/key.properties", "android/app/upload.jks"]) {
    assert.equal(by(p).skipped, "secret", p);
    assert.equal(by(p).diff, undefined, `${p}: 내용 없음`);
  }
  assert.equal(by(".env").add, 1, "줄 수는 알려 준다");
  const json = JSON.stringify(rep);

  for (const leak of ["supersecretvalue", "hunter2hunter2", "abcdefghijklmnop1234", "tops3cretpassw0rd"]) assert.equal(json.includes(leak), false, `보고에 ${leak} 이 없어야 해요`);
  assert.match(by("lib/config.dart").diff, /apiKey = "\*\*\*"/, "평범한 파일의 키 줄은 값만 가림");
  assert.match(by("lib/config.dart").diff, /const name = "ok"/, "나머지는 그대로");
  assert.match(by("lib/main.dart").diff, /print\('hi'\)/);

  // 서버: 감독 프로그램이 내용을 실어 보내도(위조·버그) 비밀 파일 본문은 지운다
  const forged = { ...rep, files: rep.files.map((f) => (f.skipped === "secret" ? { ...f, skipped: undefined, diff: "+API_TOKEN=supersecretvalue1234567890" } : f)) };
  const clean = diffLib.cleanDiffReport(forged);

  assert.equal(JSON.stringify(clean).includes("supersecretvalue"), false);
  assert.equal(clean.files.find((f) => f.path === ".env").skipped, "secret");
  assert.equal(clean.files.find((f) => f.path === ".env").diff, undefined);
  // 본문 속 값은 서버도 다시 가린다
  const raw = diffLib.cleanDiffReport({ files: [{ path: "lib/x.dart", status: "M", add: 1, del: 0, diff: '+const token = "ghp_abcdefghijklmnop12345";\n+storePassword=zzzzzzzz' }] });
  assert.equal(/ghp_abcdefghijklmnop12345|zzzzzzzz/.test(raw.files[0].diff), false);
  // 채팅 커넥터 요약에는 본문이 없다
  const summary = diffLib.diffSummary(rep);
  assert.equal(summary.files, 5);
  assert.equal(JSON.stringify(summary).includes("@@"), false, "요약에는 diff 본문이 없다");
  assert.equal(summary.list.find((f) => f.path === ".env").note, "내용 숨김(키·비밀 파일)");
  assert.equal(supMask('password = "abcdef123456"'), 'password = "***"');
  assert.equal(diffLib.maskDiffText("-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----").includes("MIIEabc"), false);
});

test("변경 내용 화면: 파일 트리·색칠된 diff, 큰 파일·바이너리는 요약만, 비밀 파일은 내용 숨김", () => {
  const view = loadTs("components/admin/factory/DiffView.tsx", { "@/lib/factory/diffReport": diffLib });
  const files = [
    { path: "lib/a.dart", status: "M", add: 2, del: 1, binary: false, diff: "@@ -1,2 +1,3 @@\n ctx\n-old\n+new\n+newer" },
    { path: "lib/ui/b.dart", status: "A", add: 5, del: 0, binary: false, skipped: "large" },
    { path: "assets/logo.png", status: "A", add: 0, del: 0, binary: true },
    { path: ".env", status: "A", add: 1, del: 0, binary: false, diff: "+API_TOKEN=supersecretvalue1234567890" },
    { path: "README.md", status: "M", add: 1, del: 0, binary: false, diff: "@@ -1 +1,2 @@\n+x" },
  ];
  const tree = view.buildTree(diffLib.cleanDiffReport({ totalFiles: 5, files }).files);

  assert.deepEqual(tree.slice(0, 2).map((n) => n.name), ["assets", "lib"], "폴더 먼저, 이름순");
  assert.deepEqual(tree.slice(2).map((n) => n.name).sort(), [".env", "README.md"].sort());
  const lib = tree.find((n) => n.name === "lib");

  assert.equal(lib.add, 7, "폴더에는 아래 파일의 줄 수 합계");
  assert.equal(lib.children.find((n) => n.name === "ui").dir, true);
  assert.deepEqual(["@@ -1 +1 @@", "+a", "-b", " c"].map(view.diffLineKind), ["hunk", "add", "del", "ctx"]);

  const html = renderToStaticMarkup(h(view.default, { value: { totalFiles: 5, totalAdd: 9, totalDel: 1, files } }));

  assert.match(html, /변경 내용/);
  assert.match(html, /파일 5개/);
  assert.match(html, /data-diff-file="lib\/a\.dart"/);
  assert.match(html, /🔒/, "비밀 파일에는 잠금 표시");
  assert.equal(html.includes("supersecretvalue"), false, "비밀 파일 내용은 화면에도 없다");
  assert.equal(renderToStaticMarkup(h(view.default, { value: null })), "", "변경 내용이 없는 예전 일감은 칸을 보이지 않는다");

  const body = (f) => renderToStaticMarkup(h(view.DiffBody, { file: f }));

  assert.match(body(files[0]), /data-diff-line="add"[^>]*>\+new</);
  assert.match(body(files[0]), /data-diff-line="del"/);
  assert.match(body(files[0]), /data-diff-line="hunk"/);
  assert.match(body({ ...files[1] }), /큰 파일 — 요약만/);
  assert.match(body({ ...files[2], skipped: "binary" }), /바이너리/);
  assert.match(body({ ...files[3], skipped: "secret", diff: undefined }), /내용 숨김/);
});

// ═════════ 연결 ═════════

test("연결: /next 가 계획 차례를 내주고, 감독 프로그램이 계획 턴·diff 를 보내고, 텔레그램·커넥터·할 일에 나온다", () => {
  const next = read("app/api/factory/next/route.ts");
  assert.match(next, /param\("plan", 8\) === "1" && !drain/);
  assert.match(next, /\.\.\.\(planTask \? \{ planTask \} : \{\}\)/);

  const route = read("app/api/factory/plan/route.ts");
  assert.match(route, /guardWorker/);
  assert.match(route, /recordPlan\(jobId/);
  assert.match(route, /action === "skip"/);
  const diffRoute = read("app/api/factory/diff/route.ts");
  assert.match(diffRoute, /guardWorker/);
  assert.match(diffRoute, /readJson\(req, MAX_DIFF_BODY_BYTES\)/);
  assert.match(diffRoute, /cleanDiffReport\(b\.diff\)/, "서버가 한 번 더 정리해서 저장");
  assert.match(diffRoute, /job\.status !== "running" && !recentDone/);
  assert.match(read("lib/factory/http.ts"), /maxBytes: number = MAX_JSON_BYTES/, "완료 보고(64KB)는 그대로, diff 만 더 크게");

  const sv = read("tools/factory-supervisor/supervisor.mjs");
  assert.match(sv, /plan: planBusy\(\)/);
  assert.match(sv, /r\.data\?\.planTask && !planBusy\(\)\) void runPlanTask/);
  assert.match(sv, /\/api\/factory\/plan/);
  assert.match(sv, /collectDiff\(st\.home \?\? st\.dir, st\.job\.aiOutcome\?\.handoff\?\.startHead/);
  assert.match(sv, /path: "\/api\/factory\/diff"/);
  assert.match(sv, /status === "done" && st\.dir !== cfg\.workDir && !st\.lab && !st\.tool/, "앱 일감이 끝났을 때만 diff 를 보낸다");

  const tg = read("lib/factory/telegram.ts");
  assert.match(tg, /callback_data: `pg:\$\{jobId\}`/);
  assert.match(tg, /callback_data: `px:\$\{jobId\}`/);
  assert.match(tg, /\^\(pg\|px\|ap\):/);
  assert.match(tg, /계획 먼저/);
  const ap = read("lib/factory/approvals.ts");
  for (const a of ["plan_go", "plan_revise", "plan_cancel"]) assert.match(ap, new RegExp(`"${a}"`));
  assert.match(ap, /planReviews: plans/);
  assert.match(read("lib/factory/inbox.ts"), /kind: "plan_review"/);

  const mcp = read("lib/factory/mcp.ts");
  assert.match(mcp, /변경_내용: diff/);
  assert.match(mcp, /diffSummary\(job\.diffInfo\)/);
  assert.match(mcp, /계획_단계/);
  assert.match(mcp, /annotations: READ_ONLY/);

  const overview = read("components/admin/factory/FactoryOverview.tsx");
  assert.match(overview, /<PlanReviewRow/);
  assert.match(overview, /data-plan-first-pick=/);
  assert.match(read("components/admin/factory/FactoryControl.tsx"), /<DiffView value=\{job\.diffInfo\} \/>/);
  assert.match(read("components/admin/factory/FactoryConsole.tsx"), /<PlanFirstSettings \/>/);
});

test("계획 승인 줄: 계획과 [이대로 진행]·[수정 지시]·[취소], 못 만들면 [계획 없이 진행]·[다시 계획]", () => {
  const row = loadTs("components/admin/factory/PlanReviewRow.tsx").default;
  const ready = renderToStaticMarkup(h(row, { review: { id: "j1", appSlug: "app-a", title: "로그인 고치기", kind: "revision", status: "ready", plan: "- 고칠 파일: lib/a.dart\n- 위험: 낮음", reason: null, round: 2, at: null }, busy: false, order: 1, onGo() {}, onRevise() {}, onCancel() {} }));

  assert.match(ready, /계획 승인 대기/);
  assert.match(ready, /2번째 계획/);
  assert.match(ready, /lib\/a\.dart/);
  assert.match(ready, /data-plan-go/);
  assert.match(ready, /이대로 진행/);
  assert.match(ready, /수정 지시/);
  assert.match(ready, /data-plan-cancel/);
  const failed = renderToStaticMarkup(h(row, { review: { id: "j2", appSlug: "app-a", title: "t", kind: "new", status: "failed", plan: null, reason: "시간 초과(4분)", round: 1, at: null }, busy: false, order: 1, onGo() {}, onRevise() {}, onCancel() {} }));

  assert.match(failed, /계획을 못 만듦/);
  assert.match(failed, /시간 초과\(4분\)/);
  assert.match(failed, /계획 없이 진행/);
  assert.match(failed, /다시 계획/);
  assert.equal(labels.PLAN_LABELS.ready, "계획 승인 대기");
});

test("마이그레이션: 칸만 추가하고 기존 데이터를 지우지 않는다. 스키마와 같은 칸", () => {
  const sql = read("prisma/migrations/20261118100000_plan_first_diff/migration.sql");
  assert.equal(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i.test(sql), false);
  const cols = [...sql.matchAll(/ADD COLUMN "(\w+)"/g)].map((m) => m[1]);

  assert.deepEqual(cols, ["planFirst", "planStatus", "planText", "planNote", "planInfo", "diffInfo"]);
  assert.match(sql, /"planFirst" BOOLEAN NOT NULL DEFAULT false/, "기존 일감은 바로 시작 그대로");
  const schema = read("prisma/schema.prisma");

  for (const c of cols) assert.match(schema, new RegExp(`\\n  ${c}\\s`));
});

test("대기열: 계획을 기다리는 일감에 '📝 계획 …' 표시가 붙고, 계획을 안 쓴 일감은 예전 그대로", () => {
  const queue = loadTs("lib/factory/queue.ts", { "@/lib/prisma": { __esModule: true, default: {} }, "@/lib/factory/parallel": loadTs("lib/factory/parallel.ts", { "@/lib/prisma": { __esModule: true, default: {} } }) });
  const mod = loadTs("components/admin/factory/AppQueue.tsx", { "./TemplateSender": { TemplateSendButton: () => null }, react: require("react"), "react/jsx-runtime": require("react/jsx-runtime") });
  const row = (id, over = {}) => ({ id, title: id, kind: "revision", status: "approved", priority: 0, approvedAt: new Date(1000), createdAt: new Date(1000), parallelGroup: null, ...over });
  const items = queue.numberQueue([row("a", { planFirst: true, planStatus: "ready" }), row("b"), row("c", { planFirst: true, planStatus: "approved" })]);
  const by = (id) => items.find((i) => i.id === id);

  assert.equal(by("a").planStatus, "ready");
  assert.equal(by("b").planStatus, null);
  assert.deepEqual(mod.parallelBadges(by("a")), ["📝 계획 승인 대기"]);
  assert.deepEqual(mod.parallelBadges(by("b")), []);
  assert.deepEqual(mod.parallelBadges(by("c")), [], "계획이 승인된 뒤에는 평소 대기열");
});
