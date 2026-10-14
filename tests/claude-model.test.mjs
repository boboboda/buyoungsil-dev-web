// 승인할 때 Claude Code 모델 고르기 시험:
// 허용 목록(lib/factory/ai.ts ↔ 감독 프로그램 ai-runner.mjs) · 인자 배열 전달(--model 한 칸) · 미지정이면 예전 그대로(--model 없음) ·
// 승인·보내기·재시도에 모델 저장(Codex 거부) · 시작 때 기본 모델 채우기 · 이력 표시('모델: ○○', Codex 숨김) ·
// 관리자 API(비관리자 차단·목록 밖 400) · 설정 탭 기본 모델 · 텔레그램 [🧠 모델 골라 승인] 한 단계.
// 가짜 DB(메모리)·가짜 텔레그램으로 돌린다. 실제 DB·네트워크·Claude 는 쓰지 않는다.
// 실행: npm run test:claude-model
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

function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : name === "./useFactoryControl" ? loadTs("components/admin/factory/useFactoryControl.ts") : require(name)), module, module.exports);
  return module.exports;
}

const ai = loadTs("lib/factory/ai.ts");
const runner = await import(pathToFileURL(path.join(repo, "tools/factory-supervisor/ai-runner.mjs")).href);
const mask = { maskSecrets: (v) => v };
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

// ── 허용 목록 ──
test("허용 목록: 홈페이지와 감독 프로그램이 같은 목록, 목록 밖·대소문자·셸 문자는 거부", () => {
  assert.deepEqual([...ai.CLAUDE_MODELS], runner.CLAUDE_MODELS);
  for (const m of ["fable", "opus", "sonnet", "haiku", "best", "opusplan", "fable[1m]", "opus[1m]", "sonnet[1m]"]) {
    assert.equal(ai.isClaudeModel(m), true, m);
    assert.deepEqual(ai.readModelChoice(m), { ok: true, model: m, message: "" });
    assert.equal(runner.claudeModelOf(m), m);
  }
  // 기본 설정 사용: 없음·null·"default"
  for (const v of [undefined, null, "default"]) assert.deepEqual(ai.readModelChoice(v), { ok: true, model: null, message: "" });
  for (const v of ["OPUS", "gpt-5", "opus; rm -rf /", "opus && calc", "opus\n", " opus", "claude-opus-5-5", "", 1, {}, ["opus"], true]) {
    const r = ai.readModelChoice(v);
    assert.equal(r.ok, false, JSON.stringify(v));
    assert.equal(r.model, null);
    assert.match(r.message, /모델은 기본 설정 또는/);
  }
  for (const v of ["OPUS", "opus; rm -rf /", "x", 1, {}]) assert.throws(() => runner.claudeModelOf(v), /허용하지 않는 Claude Code 모델/);
  assert.equal(runner.claudeModelOf(undefined), null);
  assert.equal(runner.claudeModelOf(""), null);
});

// ── 감독 프로그램 실행 인자 ──
test("인자 배열: 고른 모델은 --model 다음 한 칸으로만, 미지정이면 --model 없음(예전 그대로)", () => {
  const plain = runner.invocation("claude", {}, {});
  assert.equal(plain.command, "claude");
  assert.equal(plain.args.includes("--model"), false, "미지정이면 --model 을 붙이지 않음");

  for (const m of ["opus", "sonnet[1m]", "opusplan"]) {
    const { args } = runner.invocation("claude", {}, { model: m, sessionId: "0123abcd-0000-1111-2222-333344445555" });
    const i = args.indexOf("--model");
    assert.ok(i > 0);
    assert.equal(args[i + 1], m, "값은 다음 한 칸 그대로");
    assert.equal(args.filter((a) => a === "--model").length, 1);
    assert.ok(args.every((a) => typeof a === "string"));
    assert.equal(args.some((a) => a.includes(" --model") || a.includes(`--model ${m}`)), false, "문자열로 잇지 않음");
    assert.ok(args.includes("--resume"), "정비는 같은 세션을 이어서도 모델을 바꿀 수 있음");
  }
  // 설정 파일 cfg.model 은 일감 모델이 없을 때만(예전 동작 유지), 일감 모델이 우선
  assert.equal(runner.invocation("claude", { model: "haiku" }, {}).args.at(-1), "haiku");
  const both = runner.invocation("claude", { model: "haiku" }, { model: "opus" }).args;
  assert.equal(both[both.indexOf("--model") + 1], "opus");
  // 목록 밖이면 던진다 → 감독 프로그램이 일감을 실패로 보고(다른 모델로 바꿔 돌리지 않음)
  assert.throws(() => runner.invocation("claude", {}, { model: "opus & calc" }), /허용하지 않는/);
  // Codex 에는 적용하지 않음
  const codex = runner.invocation("codex", {}, { model: "opus" }).args;
  assert.equal(codex.includes("opus"), false);
});

test("감독 프로그램 코드: 일감·정비 지시의 모델을 startAi 로 넘기고, 실패 사유에 모델을 남긴다", () => {
  const sup = fs.readFileSync(path.join(repo, "tools/factory-supervisor/supervisor.mjs"), "utf8");
  const maint = fs.readFileSync(path.join(repo, "tools/factory-supervisor/maintenance.mjs"), "utf8");
  assert.match(sup, /const model = job\.aiEngine === "claude" \? job\.aiModel \|\| null : null;/);
  assert.match(sup, /startAi\(job\.aiEngine, cfg, \{\s*model,/);
  assert.match(sup, /modelNote/);
  assert.match(maint, /const model = m\.aiEngine === "claude" \? m\.aiModel \|\| null : null;/);
  assert.match(maint, /startAi\(m\.aiEngine, cfg, \{[^}]*\bmodel,/);
  assert.match(maint, /모델 \$\{model\}/);
  // 셸 문자열 이어붙이기 없이(spawn 인자 배열) — Windows 셸 문자 검사는 그대로
  assert.match(fs.readFileSync(path.join(repo, "tools/factory-supervisor/ai-runner.mjs"), "utf8"), /args\.push\("--model", picked\)/);
});

// ── 일감 승인·재시도(lib/factory/jobs.ts) ──
function jobsWith(state, { defaultModel = null } = {}) {
  const calls = { updates: [], logs: [] };
  const prisma = {
    factoryJob: {
      findUnique: async () => ({ ...state }),
      updateMany: async ({ where, data }) => {
        calls.updates.push({ where, data });
        if (where.status && typeof where.status === "string" && where.status !== state.status) return { count: 0 };
        if (where.aiModel === null && state.aiModel !== null) return { count: 0 };
        Object.assign(state, data);
        return { count: 1 };
      },
      count: async () => 0,
    },
    factoryJobLog: { createMany: async ({ data }) => calls.logs.push(...data) },
    $queryRaw: async () => [{ ...state, id: "job1", attempts: 1, priority: 0 }],
  };
  prisma.factoryJob.findMany = async ({ where }) => (where.status === "approved" ? [{ id: "job1", appSlug: "x-app", kind: "new", priority: 0, approvedAt: null, createdAt: new Date(1), parallelGroup: null }] : []);
  const jobs = loadTs("lib/factory/jobs.ts", {
    "@/lib/factory/parallel": loadTs("lib/factory/parallel.ts", { "@/lib/prisma": { __esModule: true, default: prisma } }),
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/ai": ai,
    "@/lib/factory/settings": { getDefaultClaudeModel: async () => defaultModel },
    "@/lib/factory/reviewVideo": { deleteReviewVideo: async () => {} },
    "@/lib/factory/mask": mask,
    "@/lib/factory/toolBroker": { cleanToolRequests: () => null },
    "@/lib/factory/handoff": { cleanHandoff: () => null },
  });
  return { jobs, calls };
}

test("일감 승인: 고른 모델을 저장, 기본 설정은 NULL, 목록 밖·Codex 일감은 400", async () => {
  let s = { status: "pending", aiEngine: "claude", aiModel: null };
  let { jobs, calls } = jobsWith(s);
  const r = await jobs.adminAction("job1", { action: "approve", aiModel: "opus" });
  assert.equal(r.ok, true);
  assert.match(r.message, /모델: opus/);
  assert.equal(s.status, "approved");
  assert.equal(s.aiModel, "opus");

  s = { status: "pending", aiEngine: "claude", aiModel: null };
  ({ jobs } = jobsWith(s));
  assert.equal((await jobs.adminAction("job1", { action: "approve" })).ok, true, "모델 없이 승인(텔레그램 기본 버튼·예전 화면)");
  assert.equal(s.aiModel, null);

  s = { status: "pending", aiEngine: "claude", aiModel: null };
  ({ jobs, calls } = jobsWith(s));
  const bad = await jobs.adminAction("job1", { action: "approve", aiModel: "gpt-5" });
  assert.equal(bad.status, 400);
  assert.equal(calls.updates.length, 0, "거부하면 아무것도 바꾸지 않음");
  assert.equal(s.status, "pending");

  // Codex 일감에는 모델을 고를 수 없다(저장된 엔진·요청의 엔진 모두)
  s = { status: "pending", aiEngine: "codex", aiModel: null };
  ({ jobs } = jobsWith(s));
  assert.equal((await jobs.adminAction("job1", { action: "approve", aiModel: "opus" })).status, 400);
  s = { status: "pending", aiEngine: "claude", aiModel: null };
  ({ jobs } = jobsWith(s));
  assert.equal((await jobs.adminAction("job1", { action: "approve", aiEngine: "codex", aiModel: "opus" })).status, 400);
  // Codex 로 승인(모델 없음)은 그대로 되고, 모델은 비운다
  s = { status: "pending", aiEngine: "claude", aiModel: "opus" };
  ({ jobs } = jobsWith(s));
  assert.equal((await jobs.adminAction("job1", { action: "approve", aiEngine: "codex" })).ok, true);
  assert.deepEqual([s.aiEngine, s.aiModel], ["codex", null]);
});

test("재시도: 모델을 주면 바꾸고, 안 주면 지난 모델 그대로 · AI 를 Codex 로 바꾸면 모델을 비운다", async () => {
  let s = { status: "failed", aiEngine: "claude", aiModel: "opus", appSlug: "app" };
  let { jobs } = jobsWith(s);
  assert.equal((await jobs.adminAction("job1", { action: "retry" })).ok, true);
  assert.equal(s.aiModel, "opus");
  s = { status: "failed", aiEngine: "claude", aiModel: "opus", appSlug: "app" };
  ({ jobs } = jobsWith(s));
  assert.equal((await jobs.adminAction("job1", { action: "retry", aiModel: "sonnet" })).ok, true);
  assert.equal(s.aiModel, "sonnet");
  s = { status: "failed", aiEngine: "claude", aiModel: "opus", appSlug: "app" };
  ({ jobs } = jobsWith(s));
  assert.equal((await jobs.adminAction("job1", { action: "retry", aiModel: null })).ok, true);
  assert.equal(s.aiModel, null, "기본 설정 사용으로 되돌림");
  s = { status: "pending", aiEngine: "claude", aiModel: "opus" };
  ({ jobs } = jobsWith(s));
  assert.equal((await jobs.adminAction("job1", { action: "set-ai", aiEngine: "codex" })).ok, true);
  assert.deepEqual([s.aiEngine, s.aiModel], ["codex", null]);
});

test("일감 시작: '기본 설정 사용'이면 기본 모델로 채워 기록, 기본 모델이 없으면 NULL(예전 그대로), Codex 는 그대로", async () => {
  let s = { status: "approved", aiEngine: "claude", aiModel: null };
  let { jobs, calls } = jobsWith(s, { defaultModel: "sonnet" });
  let [row] = await jobs.claimJobs("pc", 1, ["claude"]);
  assert.equal(row.aiModel, "sonnet");
  assert.equal(s.aiModel, "sonnet", "DB 에도 남김(이력 표시)");
  assert.match(calls.logs[0].message, /모델: sonnet/);

  s = { status: "approved", aiEngine: "claude", aiModel: "opus" };
  ({ jobs, calls } = jobsWith(s, { defaultModel: "sonnet" }));
  [row] = await jobs.claimJobs("pc", 1, ["claude"]);
  assert.equal(row.aiModel, "opus", "승인 때 고른 모델이 우선");

  s = { status: "approved", aiEngine: "claude", aiModel: null };
  ({ jobs, calls } = jobsWith(s, { defaultModel: null }));
  [row] = await jobs.claimJobs("pc", 1, ["claude"]);
  assert.equal(row.aiModel, null, "기본 모델이 없으면 --model 없이");
  assert.match(calls.logs[0].message, /모델: Claude Code 기본/);

  s = { status: "approved", aiEngine: "codex", aiModel: null };
  ({ jobs, calls } = jobsWith(s, { defaultModel: "sonnet" }));
  [row] = await jobs.claimJobs("pc", 1, ["codex"]);
  assert.equal(row.aiModel, null);
  assert.doesNotMatch(calls.logs[0].message, /모델/);
});

// ── 정비 지시(lib/factory/maintenance.ts) ──
function maintWith(turns, { defaultModel = null, defaultEngine = "claude" } = {}) {
  const created = [];
  const prisma = {
    factoryMaintenanceMessage: {
      findUnique: async ({ where }) => turns.find((t) => t.id === where.id) ?? null,
      findFirst: async ({ where }) => {
        if (where.status === "running") return null;
        if (where.role === "assistant") return null;
        return turns.filter((t) => where.status.in.includes(t.status)).map((t) => ({ ...t, maintenance: { title: "정비", sessionId: "s1", codexSessionId: null } }))[0] ?? null;
      },
      findMany: async () => [],
      updateMany: async ({ where, data }) => {
        const t = turns.find((x) => x.id === where.id);
        if (!t || (where.status && where.status !== t.status) || (where.aiModel === null && t.aiModel !== null)) return { count: 0 };
        Object.assign(t, data);
        return { count: 1 };
      },
      create: async ({ data }) => (created.push(data), { id: "new-turn", createdAt: new Date(), ...data }),
      count: async () => 0,
    },
    factoryMaintenance: {
      findUnique: async () => ({ id: "th", status: "open" }),
      findFirst: async () => null,
      findMany: async () => [],
      create: async ({ data }) => ({ id: "th", ...data }),
      update: async () => ({ id: "th" }),
    },
  };
  const maint = loadTs("lib/factory/maintenance.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/ai": ai,
    "@/lib/factory/mask": mask,
    "@/lib/factory/telegram": { notifyDeployReady: async () => {}, notifyMaintenance: async () => {}, notifyText: async () => {} },
    "@/lib/factory/settings": { getDefaultAiEngine: async () => defaultEngine, getDefaultClaudeModel: async () => defaultModel, getSettingValue: async () => null, isAutoDeployEnabled: async () => false, setSettingValue: async () => {} },
    "@/lib/factory/jobs": { MAX_LOGS_PER_JOB: 500, MAX_LOG_MESSAGE: 2000 }, "@/lib/factory/supervisorDrain": loadTs("lib/factory/supervisorDrain.ts"), "@/lib/factory/handoff": { cleanHandoff: () => null },
  });
  return { maint, created };
}

test("정비 미리 승인: 승인 대기 지시에 모델을 골라 승인, Codex 지시·목록 밖은 거부", async () => {
  const turns = [{ id: "t1", role: "user", status: "awaiting_approval", aiEngine: "claude", aiModel: null, createdAt: new Date() }];
  let { maint } = maintWith(turns);
  const r = await maint.approveTurn("t1", "opus");
  assert.equal(r.ok, true);
  assert.match(r.message, /모델: opus/);
  assert.deepEqual([turns[0].status, turns[0].aiModel], ["queued", "opus"]);

  const codex = [{ id: "t2", role: "user", status: "awaiting_approval", aiEngine: "codex", aiModel: null, createdAt: new Date() }];
  ({ maint } = maintWith(codex));
  assert.equal((await maint.approveTurn("t2", "opus")).status, 400);
  assert.equal(codex[0].status, "awaiting_approval");
  assert.equal((await maint.approveTurn("t2", null)).ok, true, "Codex 는 기본 승인만");
});

test("정비 보내기(통제실 = 보내는 순간 승인): 모델 저장, Codex·목록 밖 거부", async () => {
  let { maint, created } = maintWith([]);
  assert.equal((await maint.sendMaintenance({ text: "통제실에서 보낸 지시", aiEngine: "claude", aiModel: "haiku", source: "통제실" })).ok, true);
  assert.equal(created[0].aiModel, "haiku");
  ({ maint, created } = maintWith([]));
  assert.equal((await maint.sendMaintenance({ text: "모델 없이 보낸 지시", source: "통제실" })).ok, true);
  assert.equal(created[0].aiModel, null);
  ({ maint, created } = maintWith([]));
  assert.equal((await maint.sendMaintenance({ text: "목록 밖 모델 지시", aiModel: "opus;rm", source: "통제실" })).status, 400);
  assert.equal((await maint.sendMaintenance({ text: "Codex 에 모델 지시", aiEngine: "codex", aiModel: "opus", source: "통제실" })).status, 400);
  ({ maint, created } = maintWith([], { defaultEngine: "codex" }));
  assert.equal((await maint.sendMaintenance({ text: "주사용 AI 가 Codex", aiModel: "opus", source: "통제실" })).status, 400);
  assert.equal(created.length, 0);
});

test("정비 시작: 감독 프로그램에 모델을 넘기고, 기본 설정이면 기본 모델로 채운다(Codex 는 null)", async () => {
  let turns = [{ id: "t1", role: "user", status: "queued", aiEngine: "claude", aiModel: null, maintenanceId: "th", text: "x", createdAt: new Date() }];
  let { maint } = maintWith(turns, { defaultModel: "fable" });
  let out = await maint.maintenanceForNext(["claude"]);
  assert.equal(out.maintenance.aiModel, "fable");
  assert.equal(turns[0].aiModel, "fable", "이력에 실제 모델 기록");

  turns = [{ id: "t1", role: "user", status: "queued", aiEngine: "claude", aiModel: null, maintenanceId: "th", text: "x", createdAt: new Date() }];
  ({ maint } = maintWith(turns, { defaultModel: null }));
  out = await maint.maintenanceForNext(["claude"]);
  assert.equal(out.maintenance.aiModel, null, "기본 모델이 없으면 예전처럼 --model 없이");

  turns = [{ id: "t1", role: "user", status: "queued", aiEngine: "codex", aiModel: "opus", maintenanceId: "th", text: "x", createdAt: new Date() }];
  ({ maint } = maintWith(turns, { defaultModel: "fable" }));
  out = await maint.maintenanceForNext(["claude", "codex"]);
  assert.equal(out.maintenance.aiModel, null);
});

// ── 관리자 API ──
let admin = true;
const requireAdmin = async () => (admin ? null : NextResponse.json({ message: "관리자만" }, { status: 403 }));
const approvalCalls = [];
const approvals = {
  APPROVAL_ACTIONS: ["job_approve", "maintenance_approve", "deploy", "deploy_now", "queue_skip", "queue_retry", "queue_clear"],
  runApproval: async (...args) => (approvalCalls.push(args), { ok: true, status: 200, message: "승인했어요." }),
  approvalInbox: async () => ({ jobs: [], turns: [], deploys: [] }),
  deployHistory: async () => [],
  historyTotals: async () => ({ deploys: 0, updates: 0, threads: 0 }),
  maintenanceSummary: async () => [],
  activeNow: async () => ({ running: [], queued: 0, next: null }),
  supervisorUpdateHistory: async () => [],
};
const savedDefault = [];
const supervisor = { supervisorSnapshot: async () => ({ defaultAiEngine: "claude", defaultClaudeModel: savedDefault.at(-1) ?? null }), runSupervisorAction: async () => ({ message: "", snapshot: {} }) };
const overviewRoute = loadTs("app/api/admin/factory/overview/route.ts", {
  "@/lib/factory/admin": { requireAdmin },
  "@/lib/factory/ai": ai,
  "@/lib/factory/approvals": approvals,
  "@/lib/factory/supervisor": supervisor,
});
const jobRoute = loadTs("app/api/admin/factory/jobs/[id]/route.ts", {
  "@/lib/prisma": { __esModule: true, default: {} },
  "@/lib/factory/admin": { requireAdmin },
  "@/lib/factory/lab": { LAB_KIND: "lab", labResultView: () => null },
  "@/lib/factory/jobs": { ID_RE, adminAction: async () => ({ ok: true, status: 200, message: "" }), claudeUsageFor: async () => null },
  "@/lib/factory/approvals": approvals,
  "@/lib/factory/ai": ai,
});
const maintRoute = loadTs("app/api/admin/factory/maintenance/route.ts", {
  "@/lib/factory/admin": { requireAdmin },
  "@/lib/factory/ai": ai,
  "@/lib/factory/approvals": approvals,
  "@/lib/factory/maintenance": { maintenanceOverview: async () => ({}), sendMaintenance: async (i) => (approvalCalls.push(["send", i]), { ok: true, status: 200, message: "" }), setTurnEngine: async () => ({}), cancelTurn: async () => ({}), closeThread: async () => ({}), queueAction: async () => ({}) },
});
const controlRoute = loadTs("app/api/admin/factory/control/route.ts", {
  "@/lib/prisma": {},
  "@/lib/factory/appChecks": {},
  "@/lib/factory/conductor": {},
  "@/lib/factory/toolkit": {},
  "@/lib/factory/appRoles": {},
  "@/lib/factory/studioProjects": {},
  "@/lib/factory/arts": {},
  "@/lib/studio/requests": {},
  "@/lib/factory/supervisorLog": {},
  "@/lib/factory/admin": { requireAdmin },
  "@/lib/factory/ai": ai,
  "@/lib/factory/settings": { setDefaultClaudeModel: async (m) => savedDefault.push(m), setDefaultAiEngine: async () => {}, setCompactAfterJobEnabled: async () => {}, setToolBrokerSettings: async () => ({}) },
  "@/lib/factory/toolBroker": { isToolBrokerMode: () => false, TOOL_BROKER_MODE_LABELS: {}, toolBrokerLimitLabel: () => "" },
  "@/lib/factory/supervisor": supervisor,
});
const post = (url, body) => new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = { params: Promise.resolve({ id: "job1" }) };

test("관리자 API: 비관리자는 승인·모델 설정 모두 막히고 아무것도 실행하지 않음", async () => {
  admin = false;
  approvalCalls.length = 0;
  savedDefault.length = 0;
  assert.equal((await overviewRoute.POST(post("http://x/api/admin/factory/overview", { action: "job_approve", id: "job1", aiModel: "opus" }))).status, 403);
  assert.equal((await jobRoute.POST(post("http://x/api/admin/factory/jobs/job1", { action: "approve", aiModel: "opus" }), ctx)).status, 403);
  assert.equal((await maintRoute.POST(post("http://x/api/admin/factory/maintenance", { action: "approve", turnId: "t1", aiModel: "opus" }))).status, 403);
  assert.equal((await controlRoute.POST(post("http://x/api/admin/factory/control", { defaultClaudeModel: "opus" }))).status, 403);
  assert.equal(approvalCalls.length, 0);
  assert.equal(savedDefault.length, 0);
  admin = true;
});

test("관리자 API: 고른 모델을 승인 입구로 넘기고, 목록 밖은 400(실행 안 함)", async () => {
  approvalCalls.length = 0;
  let res = await overviewRoute.POST(post("http://x/api/admin/factory/overview", { action: "job_approve", id: "job1", aiModel: "opus[1m]" }));
  assert.equal(res.status, 200);
  assert.deepEqual(approvalCalls[0], ["job_approve", "job1", "통제실", undefined, "opus[1m]"]);
  res = await overviewRoute.POST(post("http://x/api/admin/factory/overview", { action: "maintenance_approve", id: "t1" }));
  assert.deepEqual(approvalCalls[1], ["maintenance_approve", "t1", "통제실", undefined, null], "모델 없음 = 기본 설정 사용");
  res = await overviewRoute.POST(post("http://x/api/admin/factory/overview", { action: "job_approve", id: "job1", aiModel: "opus; rm -rf /" }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /모델은/);
  assert.equal(approvalCalls.length, 2);

  res = await jobRoute.POST(post("http://x/api/admin/factory/jobs/job1", { action: "approve", aiEngine: "claude", aiModel: "haiku" }), ctx);
  assert.equal(res.status, 200);
  assert.deepEqual(approvalCalls[2], ["job_approve", "job1", "통제실", "claude", "haiku"]);
  assert.equal((await jobRoute.POST(post("http://x/api/admin/factory/jobs/job1", { action: "approve", aiModel: "gpt" }), ctx)).status, 400);

  res = await maintRoute.POST(post("http://x/api/admin/factory/maintenance", { action: "approve", turnId: "t1", aiModel: "sonnet" }));
  assert.deepEqual(approvalCalls[3], ["maintenance_approve", "t1", "통제실", undefined, "sonnet"]);
  await maintRoute.POST(post("http://x/api/admin/factory/maintenance", { action: "send", text: "지시입니다", aiModel: "best" }));
  assert.equal(approvalCalls[4][1].aiModel, "best");
  assert.equal((await maintRoute.POST(post("http://x/api/admin/factory/maintenance", { action: "send", text: "지시입니다", aiModel: "Opus" }))).status, 400);
  assert.equal(approvalCalls.length, 5);
});

test("설정 탭 기본 모델: 허용 목록만 저장, null·default 는 지정 안 함", async () => {
  savedDefault.length = 0;
  let res = await controlRoute.POST(post("http://x/api/admin/factory/control", { defaultClaudeModel: "sonnet" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.defaultClaudeModel, "sonnet");
  assert.match(body.message, /기본 모델을 sonnet/);
  res = await controlRoute.POST(post("http://x/api/admin/factory/control", { defaultClaudeModel: null }));
  assert.match((await res.json()).message, /지정하지 않았어요/);
  assert.equal((await controlRoute.POST(post("http://x/api/admin/factory/control", { defaultClaudeModel: "gpt-5" }))).status, 400);
  assert.deepEqual(savedDefault, ["sonnet", null]);
});

// ── 이력 표시·승인 화면 ──
const select = loadTs("components/admin/factory/ClaudeModelSelect.tsx", { "@/lib/factory/ai": ai });

test("이력 표시: Claude 는 '모델: ○○'(없으면 기본 설정), Codex 는 표시 안 함", () => {
  assert.equal(ai.modelText("claude", "opus"), "모델: opus");
  assert.equal(ai.modelText("claude", null), "모델: 기본 설정");
  assert.equal(ai.modelText("claude", "evil<script>"), "모델: 기본 설정", "목록 밖 값은 그대로 보이지 않음");
  assert.equal(ai.modelText("codex", "opus"), null);
  assert.equal(renderToStaticMarkup(h(select.ModelTag, { engine: "claude", model: "sonnet[1m]" })), '<span data-model="sonnet[1m]">모델: sonnet[1m]</span>');
  assert.equal(renderToStaticMarkup(h(select.ModelTag, { engine: "codex", model: "opus" })), "");
  // 이력·목록 화면이 ModelTag 를 쓴다(일감 목록·상세, 정비 지시·결과·대기열, 출시 일감)
  for (const f of ["FactoryControl.tsx", "MaintenancePanel.tsx", "ReleasePanel.tsx"]) {
    assert.match(fs.readFileSync(path.join(repo, "components/admin/factory", f), "utf8"), /<ModelTag /, f);
  }
});

test("승인 화면: '기본 설정 사용' + 허용 목록 9개, Codex 일감은 숨김", () => {
  const html = renderToStaticMarkup(h(select.ClaudeModelSelectView, { value: "default", onChange: () => {}, defaultModel: "sonnet" }));
  assert.match(html, /기본 설정 사용 \(sonnet\)/);
  assert.equal((html.match(/<option /g) ?? []).length, 1 + ai.CLAUDE_MODELS.length);
  for (const m of ai.CLAUDE_MODELS) assert.ok(html.includes(`value="${m}"`), m);
  assert.match(renderToStaticMarkup(h(select.ClaudeModelSelectView, { value: "default", onChange: () => {}, defaultModel: null })), /기본 설정 사용 \(Claude Code 기본\)/);
  const defaults = { model: null, engine: "claude" };
  assert.match(renderToStaticMarkup(h(select.default, { engine: "claude", value: "default", onChange: () => {}, defaults })), /data-model-select/);
  assert.equal(renderToStaticMarkup(h(select.default, { engine: "codex", value: "default", onChange: () => {}, defaults })), "");
  assert.equal(renderToStaticMarkup(h(select.default, { engine: "default", value: "default", onChange: () => {}, defaults: { model: null, engine: "codex" } })), "", "주사용 AI 가 Codex 면 숨김");
  assert.equal(select.modelSelectHidden("default", "claude"), false);
});

// ── 텔레그램 ──
test("텔레그램: [🧠 모델 골라 승인] → 같은 알림의 버튼이 모델 목록으로, 고르면 그 모델로 승인 · Codex 일감은 버튼 없음", async () => {
  Object.assign(process.env, { TELEGRAM_BOT_TOKEN: "test-bot", TELEGRAM_CHAT_ID: "42", TELEGRAM_WEBHOOK_SECRET: "hook", TELEGRAM_APPROVE_BUTTONS: "true" });
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ method: String(url).split("/").pop(), body: JSON.parse(init.body) });
    return { json: async () => ({ ok: true }) };
  };
  const calls = [];
  let job = { id: "job1", appSlug: "app-one", title: "앱", kind: "new", status: "pending", aiEngine: "claude" };
  try {
    const tg = loadTs("lib/factory/telegram.ts", {
      "@/lib/prisma": { __esModule: true, default: { factoryJob: { findUnique: async () => job }, factoryMaintenance: { findUnique: async () => ({ id: "th", title: "정비" }) }, factoryMaintenanceMessage: { findFirst: async () => ({ text: "지시", aiEngine: "claude" }) } } },
      "@/lib/factory/jobs": { ID_RE, KIND_LABELS: { new: "새 앱" } },
      "@/lib/factory/approvals": { runApproval: async (...a) => (calls.push(a), { ok: true, status: 200, message: "승인했어요." }) },
      "@/lib/factory/mask": mask,
      "@/lib/factory/appName": { releaseAppName: async (_s, t) => t },
      "@/lib/factory/ai": ai,
    });
    // 승인 대기 알림: 기본 승인 + 모델 골라 승인
    await tg.notifyJobEvent("job1", "pending");
    const row = sent.at(-1).body.reply_markup.inline_keyboard[0];
    assert.deepEqual(row.slice(0, 2).map((b) => b.callback_data), ["a:job1", "ao:job1"]);
    job = { ...job, aiEngine: "codex" };
    await tg.notifyJobEvent("job1", "pending");
    assert.deepEqual(sent.at(-1).body.reply_markup.inline_keyboard[0].filter((b) => b.callback_data).map((b) => b.callback_data), ["a:job1"], "Codex 는 모델 버튼 없음");

    const now = Math.floor(Date.now() / 1000);
    const press = (data) => tg.handleUpdate({ callback_query: { id: "cq", from: { id: 42 }, data, message: { message_id: 7, date: now, chat: { id: 42 } } } });
    // 모델 목록 열기: 승인하지 않고 버튼만 바꾼다
    await press("ao:job1");
    assert.equal(calls.length, 0);
    const edit = sent.find((s) => s.method === "editMessageReplyMarkup");
    const buttons = edit.body.reply_markup.inline_keyboard.flat();
    assert.deepEqual(buttons.filter((b) => /^a:job1:\d+$/.test(b.callback_data ?? "")).map((b) => b.text), [...ai.CLAUDE_MODELS]);
    assert.ok(buttons.every((b) => !b.callback_data || b.callback_data.length <= 64), "텔레그램 버튼 값 64바이트 제한");
    // 모델 번호로 승인 → 허용 목록의 그 모델
    await press(`a:job1:${ai.CLAUDE_MODELS.indexOf("opus")}`);
    assert.deepEqual(calls[0], ["job_approve", "job1", "텔레그램", undefined, "opus"]);
    await press("a:job1");
    assert.deepEqual(calls[1], ["job_approve", "job1", "텔레그램", undefined, null], "기본 버튼 = 기본 설정 사용");
    // 정비 지시도 같은 방식
    await press("mo:t1");
    assert.ok(sent.filter((s) => s.method === "editMessageReplyMarkup").at(-1).body.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === "ma:t1:0"));
    await press("ma:t1:2");
    assert.deepEqual(calls[2], ["maintenance_approve", "t1", "텔레그램", undefined, ai.CLAUDE_MODELS[2]]);
    // 목록 밖 번호·배포 버튼에 붙인 번호는 거절(실행 안 함)
    await press("a:job1:99");
    await press("ma:t1:99");
    await press("md:th:1");
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});
