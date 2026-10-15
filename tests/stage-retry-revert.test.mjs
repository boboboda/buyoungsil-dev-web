// 5-2 시험(서버 쪽): 실패 단계부터 다시 + 배포 되돌리기
//  - 단계부터 다시: 줄 수 있는 조건, 일감 값(승인됨·resumeFrom·마스킹된 resumeNote), 관리자 동작 retry-stage, /next 에 붙는 stageResume, 일반 retry 는 처음부터
//  - 배포 되돌리기: 되돌릴 수 있는 조건(진행 중·대기열·배포 안 된 변경·마이그레이션이 든 배포 사이), 요청 기록(조건부 갱신), 되돌리기 커밋 알림, 시작·결과 텔레그램, 배포 기록 화면의 [이전 버전으로]
// 가짜 DB·가짜 텔레그램으로만 돌린다. 실행: node tests/stage-retry-revert.test.mjs
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

const anything = () => new Proxy(function () {}, { get: (t, k) => (k === "__esModule" ? true : k === "then" ? undefined : anything()), apply: () => anything() });
function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const req = (name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : name.startsWith("@/") ? anything() : require(name));
  new Function("require", "module", "exports", output)(req, module, module.exports);
  return module.exports;
}

const mask = loadTs("lib/factory/mask.ts");
const sr = loadTs("lib/factory/stageRetry.ts", { "@/lib/factory/mask": mask });

// ───────── 실패 단계부터 다시 ─────────
test("단계부터 다시를 줄 수 있는 조건: 실패한 새 앱·수정 일감에 단계가 기록돼 있을 때만", () => {
  assert.deepEqual(sr.stageRetryCheck({ kind: "revision", status: "failed", failStage: "check" }), { ok: true, stage: "check" });
  assert.deepEqual(sr.stageRetryCheck({ kind: "new", status: "failed", failStage: "screenshots" }), { ok: true, stage: "screenshots" });
  assert.equal(sr.stageRetryCheck({ kind: "revision", status: "failed", failStage: null }).ok, false, "단계가 없으면 못 준다");
  assert.equal(sr.stageRetryCheck({ kind: "revision", status: "failed", failStage: "  " }).ok, false);
  assert.equal(sr.stageRetryCheck({ kind: "revision", status: "running", failStage: "check" }).ok, false, "실패한 일감만");
  assert.match(sr.stageRetryCheck({ kind: "release", status: "failed", failStage: "upload" }).reason, /출시/, "출시 일감은 출시 화면의 재시도");
  assert.equal(sr.stageRetryCheck({ kind: "tool", status: "failed", failStage: "tool" }).ok, false);
  assert.equal(sr.stageRetryCheck({ kind: "revision", status: "failed", failStage: "resume" }).ok, false, "이어받기 자체가 실패한 일감은 처음부터");
  assert.equal(sr.stageLabel("check"), "검사");
  assert.equal(sr.stageLabel("screenshots"), "스크린샷");
  assert.equal(sr.stageLabel("merge"), "합치기");
  assert.equal(sr.stageLabel("whatever"), "whatever");
});

test("단계 재시도 값: 승인됨으로 되돌리고 resumeFrom·마스킹된 resumeNote 를 남긴다. 시도 횟수·작업 기록은 초기화", () => {
  const now = new Date();
  const d = sr.stageRetryData({ kind: "revision", status: "failed", failStage: "check", failReason: "필수 검증 실패: tsc 오류 storePassword=hunter2 " + "x".repeat(900) }, now);

  assert.equal(d.status, "approved");
  assert.equal(d.resumeFrom, "check");
  assert.doesNotMatch(d.resumeNote, /hunter2/, "키·비밀번호는 resumeNote 에 남지 않는다");
  assert.ok(d.resumeNote.length <= 500);
  assert.equal(d.attempts, 0);
  assert.equal(d.failReason, null);
  assert.equal(d.failStage, null);
  assert.equal(d.workerId, null);
  assert.equal(d.leaseUntil, null);
  assert.equal(sr.stageRetryData({ kind: "revision", status: "failed", failStage: null }, now), null);
});

function fakeJobsDb(job) {
  const logs = [];
  const prisma = {
    factoryJob: {
      findUnique: async ({ where }) => (where.id === job.id ? { ...job } : null),
      updateMany: async ({ where, data }) => {
        if (where.id !== job.id || (where.status && job.status !== where.status)) return { count: 0 };
        Object.assign(job, data);
        return { count: 1 };
      },
    },
    factoryJobLog: { create: async ({ data }) => void logs.push(data) },
  };
  const jobsMod = loadTs("lib/factory/jobs.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/mask": mask,
    "@/lib/factory/ai": { AI_LABELS: {}, isAiEngine: (v) => v === "claude" || v === "codex", readModelChoice: () => ({ ok: true, model: null }) },
    "@/lib/factory/stageRetry": sr,
  });
  return { jobsMod, logs, prisma };
}

test("관리자 동작 retry-stage: 실패한 일감을 같은 단계부터 다시 승인한다. 일반 retry 는 단계를 지우고 처음부터", async () => {
  const job = { id: "j1", kind: "revision", status: "failed", failStage: "check", failReason: "필수 검증 실패: 타입 오류", attempts: 2, resumeFrom: null };
  const { jobsMod, logs } = fakeJobsDb(job);
  const r = await jobsMod.adminAction("j1", { action: "retry-stage" });

  assert.equal(r.ok, true, r.message);
  assert.match(r.message, /검사/);
  assert.equal(job.status, "approved");
  assert.equal(job.resumeFrom, "check");
  assert.match(job.resumeNote, /타입 오류/);
  assert.equal(job.attempts, 0);
  assert.ok(logs.some((l) => /단계부터 다시 승인/.test(l.message)), "일감 로그에 남긴다");

  // 같은 일감이 다시 실패 → 일반 [다시 시도]는 처음부터(resumeFrom 을 지운다)
  Object.assign(job, { status: "failed", failStage: "check", failReason: "또 실패" });
  const plain = await jobsMod.adminAction("j1", { action: "retry" });

  assert.equal(plain.ok, true);
  assert.equal(job.resumeFrom, null, "일반 재시도는 처음부터");
  assert.equal(job.resumeNote, null);
});

test("retry-stage 거절: 단계가 없는 일감·출시 일감·실패가 아닌 일감·없는 일감", async () => {
  const mk = (extra) => ({ id: "j2", kind: "revision", status: "failed", failStage: "check", failReason: "x", ...extra });

  for (const [extra, re] of [[{ failStage: null }, /기록되지 않았/], [{ kind: "release" }, /출시/], [{ status: "running" }, /상태/]]) {
    const job = mk(extra);
    const r = await fakeJobsDb(job).jobsMod.adminAction("j2", { action: "retry-stage" });

    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.match(r.message, re);
    assert.notEqual(job.status, "approved", "거절하면 일감은 그대로");
  }
  assert.equal((await fakeJobsDb(mk({})).jobsMod.adminAction("nope", { action: "retry-stage" })).status, 404);
});

test("/next 에 붙는 stageResume: 단계부터 다시 승인된 새 앱·수정 일감만", async () => {
  const db = { factoryJob: { findMany: async ({ where }) => [{ id: "a", resumeFrom: "check", resumeNote: "타입 오류" }, { id: "b", resumeFrom: null, resumeNote: null }].filter((r) => where.id.in.includes(r.id) && r.resumeFrom) } };
  const m = await sr.stageResumeForJobs(db, [{ id: "a", kind: "revision" }, { id: "b", kind: "revision" }, { id: "c", kind: "release" }]);

  assert.deepEqual([...m.keys()], ["a"]);
  assert.deepEqual(m.get("a"), { from: "check", note: "타입 오류", label: "검사" });
  assert.equal((await sr.stageResumeForJobs(db, [{ id: "a", kind: "release" }])).size, 0, "출시 일감은 이 경로로 안 간다");
  assert.match(read("app/api/factory/next/route.ts"), /stageResumeForJobs\(prisma as never, claimed\)/);
  assert.match(read("app/api/factory/next/route.ts"), /\.\.\.\(stageResume \? \{ stageResume \} : \{\}\)/);
});

test("화면: 실패한 일감 상세에 [실패 단계부터 다시] 버튼(단계가 있을 때만), 목록 API 가 failStage 를 준다", () => {
  const ui = read("components/admin/factory/FactoryControl.tsx");

  assert.match(ui, /stageRetryCheck\(job\)\.ok/);
  assert.match(ui, /action: "retry-stage"/);
  assert.match(ui, /실패 단계부터 다시/);
  assert.match(read("app/api/admin/factory/jobs/route.ts"), /failStage: true/);
});

// ───────── 배포 되돌리기 ─────────
const dr = (db, extra = {}) =>
  loadTs("lib/factory/deployRevert.ts", {
    "@/lib/prisma": { __esModule: true, default: db },
    "@/lib/factory/telegram": { notifyText: async (text, path) => void (extra.sent ?? []).push({ text, path }) },
    "@/lib/factory/maintenance": { deployBundle: async () => extra.bundle ?? { inProgress: null, queueLeft: 0, items: [] } },
  });
const T = (n) => new Date(Date.UTC(2026, 9, 15, 0, n));
const D = (id, commit, n, extra = {}) => ({ id, commit, ok: true, kind: "deploy", requestedAt: T(n), migrations: false, maintenanceId: "th1", ...extra });
const NO_BLOCK = { inProgress: false, queueLeft: 0, pending: 0 };

test("revertCheck: 지금 버전·실패한 배포·진행 중·대기열·배포 안 된 변경은 막는다", () => {
  const a = D("a", "aaaaaaa1", 1), b = D("b", "bbbbbbb2", 2), c = D("c", "ccccccc3", 3);
  const all = [a, b, c];

  assert.deepEqual(dr({}).revertCheck(a, all, NO_BLOCK), { allowed: true, reason: null });
  assert.deepEqual(dr({}).revertCheck(b, all, NO_BLOCK), { allowed: true, reason: null });
  assert.match(dr({}).revertCheck(c, all, NO_BLOCK).reason, /지금 서버에 올라가 있는/);
  assert.match(dr({}).revertCheck({ ...a, ok: false }, all, NO_BLOCK).reason, /성공한 배포/);
  assert.match(dr({}).revertCheck({ ...a, ok: null }, all, NO_BLOCK).reason, /성공한 배포/);
  assert.match(dr({}).revertCheck(a, all, { ...NO_BLOCK, inProgress: true }).reason, /진행 중/);
  assert.match(dr({}).revertCheck(a, all, { ...NO_BLOCK, queueLeft: 2 }).reason, /대기열 2개/);
  assert.match(dr({}).revertCheck(a, all, { ...NO_BLOCK, pending: 1 }).reason, /배포하지 않은 정비 변경 1개/);
});

test("revertCheck 마이그레이션 차단: 대상과 지금 사이의 배포에 마이그레이션이 있으면 막고 이유(커밋)를 보여 준다. 모름(null)은 통과(감독 프로그램이 한 번 더 검사)", () => {
  const a = D("a", "aaaaaaa1", 1), b = D("b", "bbbbbbb2", 2, { migrations: true }), c = D("c", "ccccccc3", 3), d = D("d", "ddddddd4", 4);
  const all = [a, b, c, d];
  const blocked = dr({}).revertCheck(a, all, NO_BLOCK);

  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /마이그레이션/);
  assert.match(blocked.reason, /bbbbbbb/, "막은 배포 커밋을 보여 준다");
  assert.match(blocked.reason, /되돌리지 않아요/);
  assert.equal(dr({}).revertCheck(b, all, NO_BLOCK).allowed, true, "마이그레이션이 든 배포 자체로는 되돌릴 수 있다(그 뒤 마이그레이션이 없으면)");
  assert.equal(dr({}).revertCheck(c, all, NO_BLOCK).allowed, true);
  const unknown = dr({}).revertCheck(a, [a, { ...b, migrations: null }, c], NO_BLOCK);

  assert.equal(unknown.allowed, true, "예전 배포(null)는 서버가 모르니 막지 않는다");
});

function fakeRevertDb({ deploys, thread = {} }) {
  const th = { id: "th1", deployRequestedAt: null, deployStartedAt: null, deployedAt: null, deployResult: null, deployCommit: null, deployRevertTo: null, ...thread };
  const messages = [];
  const rows = deploys.map((d) => ({ ...d }));
  const prisma = {
    factoryDeploy: {
      findUnique: async ({ where }) => rows.find((d) => d.id === where.id) ?? null,
      findMany: async ({ where }) => rows.filter((d) => where.ok === undefined || d.ok === where.ok),
      findFirst: async ({ where }) => rows.filter((d) => d.maintenanceId === where.maintenanceId && d.ok === null && d.kind === where.kind && d.commit === where.commit).pop() ?? null,
      create: async ({ data }) => (rows.push({ id: `n${rows.length}`, ok: null, startedAt: null, migrations: null, ...data }), data),
      update: async ({ where, data }) => Object.assign(rows.find((d) => d.id === where.id), data),
    },
    factoryMaintenance: {
      findUnique: async () => ({ ...th }),
      updateMany: async ({ where, data }) => {
        const idle = th.deployRequestedAt === null || th.deployedAt !== null || th.deployResult !== null;
        if (where.OR && !idle) return { count: 0 };
        if (where.deployRevertTo !== undefined && th.deployRevertTo !== where.deployRevertTo) return { count: 0 };
        Object.assign(th, data);
        return { count: 1 };
      },
    },
    factoryMaintenanceMessage: { create: async ({ data }) => void messages.push(data) },
  };
  return { prisma, th, rows, messages };
}

test("requestRevert: 되돌리기 요청을 기록(deployCommit=대상, deployRevertTo=대상)하고 시작을 텔레그램에 알린다. 두 번째 요청은 막는다", async () => {
  const sent = [];
  const { prisma, th, rows, messages } = fakeRevertDb({ deploys: [D("a", "aaaaaaa1", 1), D("b", "bbbbbbb2", 2)], thread: { deployedAt: T(2), deployRequestedAt: T(2) } });
  const m = dr(prisma, { sent });
  const r = await m.requestRevert("a", "통제실");

  assert.equal(r.ok, true, r.message);
  assert.equal(th.deployCommit, "aaaaaaa1");
  assert.equal(th.deployRevertTo, "aaaaaaa1");
  assert.equal(th.deployStartedAt, null);
  assert.ok(th.deployRequestedAt && !th.deployedAt && !th.deployResult, "배포 진행 중 상태가 된다 → /next 가 maintenanceDeploy 로 내려 준다");
  const added = rows.find((d) => d.kind === "revert");

  assert.equal(added.commit, "aaaaaaa1");
  assert.equal(added.revertTo, "aaaaaaa1");
  assert.equal(added.ok, null);
  assert.equal(sent.length, 1, "시작할 때 텔레그램");
  assert.match(sent[0].text, /되돌리기를 시작/);
  assert.match(sent[0].text, /aaaaaaa/);
  assert.match(sent[0].text, /마이그레이션은 되돌리지 않아요/);
  assert.ok(messages.some((x) => /배포 되돌리기/.test(x.text)));
  const again = await m.requestRevert("a", "통제실");

  assert.equal(again.ok, false, "진행 중에는 다시 못 누른다(조건부 갱신)");
  assert.equal(again.status, 409);
  assert.equal(sent.length, 1);
});

test("requestRevert 거절: 없는 기록·막힌 조건이면 아무것도 바꾸지 않고 텔레그램도 보내지 않는다", async () => {
  const sent = [];
  const base = () => fakeRevertDb({ deploys: [D("a", "aaaaaaa1", 1), D("b", "bbbbbbb2", 2, { migrations: true }), D("c", "ccccccc3", 3)] });
  const one = base();

  assert.equal((await dr(one.prisma, { sent }).requestRevert("zzz")).status, 404);
  const blocked = await dr(one.prisma, { sent }).requestRevert("a");

  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 409);
  assert.match(blocked.message, /마이그레이션/);
  assert.equal(one.th.deployRevertTo, null);
  assert.equal(one.rows.filter((d) => d.kind === "revert").length, 0);
  const queued = await dr(base().prisma, { sent, bundle: { inProgress: null, queueLeft: 3, items: [] } }).requestRevert("b");

  assert.match(queued.message, /대기열 3개/);
  const pending = await dr(base().prisma, { sent, bundle: { inProgress: null, queueLeft: 0, items: [{}, {}] } }).requestRevert("b");

  assert.match(pending.message, /배포하지 않은 정비 변경 2개/);
  const running = await dr(base().prisma, { sent, bundle: { inProgress: { threadId: "th1" }, queueLeft: 0, items: [] } }).requestRevert("b");

  assert.match(running.message, /진행 중/);
  assert.equal(sent.length, 0);
});

test("revertCommitMade: 감독 프로그램이 되돌리기 커밋을 올렸다고 알리면 배포 커밋을 그 커밋으로 바꾸고 요청 표시를 지운다", async () => {
  const { prisma, th, rows } = fakeRevertDb({
    deploys: [D("a", "aaaaaaa1", 1), D("r", "aaaaaaa1", 5, { kind: "revert", ok: null, revertTo: "aaaaaaa1", migrations: null })],
    thread: { deployRequestedAt: T(5), deployStartedAt: T(5), deployCommit: "aaaaaaa1", deployRevertTo: "aaaaaaa1" },
  });
  const m = dr(prisma);
  const r = await m.revertCommitMade("th1", "aaaaaaa1", "eeeeeee9");

  assert.equal(r.ok, true, r.message);
  assert.equal(th.deployCommit, "eeeeeee9");
  assert.equal(th.deployRevertTo, null);
  assert.equal(rows.find((d) => d.id === "r").commit, "eeeeeee9");
  assert.equal(rows.find((d) => d.id === "r").migrations, false);
  assert.equal((await m.revertCommitMade("th1", "aaaaaaa1", "eeeeeee9")).status, 409, "이미 처리된 요청은 다시 받지 않는다");
  assert.equal((await dr(fakeRevertDb({ deploys: [], thread: {} }).prisma).revertCommitMade("th1", "aaaaaaa1", "eeeeeee9")).status, 409, "시작하지 않은 배포에는 못 보낸다");
});

test("배포 결과: 되돌리기는 되돌리기 문구로 텔레그램에 알리고(성공·실패), 일반 배포는 기존 알림 그대로", async () => {
  async function run(kind, ok) {
    const notes = [];
    const maint = [];
    const row = { id: "r", maintenanceId: "th1", commit: "eeeeeee9", kind, revertTo: kind === "revert" ? "aaaaaaa1" : null, ok: null, items: null, via: "통제실" };
    const prisma = {
      factoryMaintenance: {
        findUnique: async () => ({ id: "th1", title: "정비", deployStartedAt: T(5), deployCommit: "eeeeeee9" }),
        update: async () => ({}),
      },
      factoryDeploy: { findFirst: async () => row, update: async ({ data }) => Object.assign(row, data) },
      factoryMaintenanceMessage: { create: async ({ data }) => void notes.push(data.text), updateMany: async () => ({ count: 0 }), count: async () => 0 },
    };
    const m = loadTs("lib/factory/maintenance.ts", {
      "@/lib/prisma": { __esModule: true, default: prisma },
      "@/lib/factory/telegram": { notifyMaintenance: async (e) => void maint.push(e), notifyDeployReady: async () => {}, notifyText: async (t) => void maint.push(`text:${t}`) },
      "@/lib/factory/settings": { setSettingValue: async () => {} },
    });

    await m.deployFinished("th1", ok, ok ? "빌드 성공" : "빌드 실패");

    return { notes, maint, row };
  }
  const good = await run("revert", true);

  assert.match(good.notes[0], /배포 되돌리기 완료/);
  assert.match(good.maint[0], /^text:↩️ 배포 되돌리기 완료/);
  assert.match(good.maint[0], /aaaaaaa/);
  assert.equal(good.maint.filter((x) => x === "deployed").length, 0, "일반 '배포 완료' 알림은 보내지 않는다");
  const bad = await run("revert", false);

  assert.match(bad.maint[0], /^text:↩️ 배포 되돌리기 실패/);
  assert.match(bad.notes[0], /배포 되돌리기 실패/);
  const plain = await run("deploy", true);

  assert.deepEqual(plain.maint, ["deployed"], "일반 배포는 기존 알림 그대로");
});

test("deployStarted: 감독 프로그램이 알려 준 migrations 를 배포 기록에 남긴다(없으면 그대로)", async () => {
  async function start(extra) {
    const row = { id: "d1", migrations: null, startedAt: null };
    const prisma = {
      factoryMaintenance: { updateMany: async () => ({ count: 1 }) },
      factoryDeploy: { findFirst: async () => row, update: async ({ data }) => Object.assign(row, data) },
    };
    const m = loadTs("lib/factory/maintenance.ts", { "@/lib/prisma": { __esModule: true, default: prisma } });

    await m.deployStarted("th1", "aaaaaaa1", extra);

    return row;
  }

  assert.equal((await start({ migrations: true })).migrations, true);
  assert.equal((await start({ migrations: false })).migrations, false);
  assert.equal((await start({})).migrations, null, "모르면 null 그대로(예전 감독 프로그램)");
});

test("연결: /next 의 maintenanceDeploy 에 revertTo·prevCommit, 감독 보고 주소·관리자 주소·배포 기록 화면, 마이그레이션(데이터를 지우지 않음)", () => {
  assert.match(read("lib/factory/maintenance.ts"), /\.\.\.\(dep\.deployRevertTo \? \{ revertTo: dep\.deployRevertTo \} : \{\}\), \.\.\.\(prev\?\.commit \? \{ prevCommit: prev\.commit \} : \{\}\)/);
  const worker = read("app/api/factory/maintenance/route.ts");

  assert.match(worker, /body\.action === "deploy_revert_commit"/);
  assert.match(worker, /revertCommitMade\(body\.threadId, body\.from, body\.commit\)/);
  assert.match(worker, /migrations: typeof body\.migrations === "boolean"/);
  const admin = read("app/api/admin/factory/maintenance/route.ts");

  assert.match(admin, /case "revert":/);
  assert.match(admin, /requestRevert\(deployId, "통제실"\)/);
  assert.doesNotMatch(read("lib/factory/telegram.ts"), /requestRevert/, "텔레그램에는 되돌리기 버튼이 없다(통제실에서만)");
  const hist = read("lib/factory/approvals.ts");

  assert.match(hist, /revertInfoFor/);
  const view = read("components/admin/factory/FactoryOverview.tsx");

  assert.match(view, /data-deploy-revert-button/);
  assert.match(view, /action: "revert", deployId: d\.id/);
  assert.match(view, /DB 마이그레이션은 되돌리지 않아요/);
  const sql = read("prisma/migrations/20261118110000_deploy_revert/migration.sql");

  assert.match(sql, /ADD COLUMN "deployRevertTo"/);
  assert.match(sql, /ADD COLUMN "migrations" BOOLEAN/);
  assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE)\b/i, "기존 데이터를 지우지 않는다");
  const schema = read("prisma/schema.prisma");

  assert.match(schema, /deployRevertTo\s+String\?/);
  assert.match(schema, /revertTo\s+String\?/);
});

test("배포 기록 줄: 되돌릴 수 있으면 버튼, 막혔으면 이유, 되돌리기 배포는 표시", () => {
  const src = read("components/admin/factory/FactoryOverview.tsx");

  assert.match(src, /d\.revert\.allowed \?/);
  assert.match(src, /되돌릴 수 없어요: \{d\.revert\.reason\}/);
  assert.match(src, /d\.kind === "revert"/);
  assert.match(src, /↩ 되돌리기/);
});
