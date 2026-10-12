import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { acquireWorkspace, engineOf, eventDecoder, excludeHarnessState, handoffPrompt, harnessFile, invocation, lockPath, pendingChangesPolicy, recoverWorkspace, redactAiText, saveHandoff, verificationCommands, verifyWorkspace } from "../ai-runner.mjs";
import { checkSwiftSources } from "../swift-source-check.mjs";
import { bridgeRequest, hookRequestId, parseFactoryPrompt, runBridge } from "../factory-hook.mjs";
import { installFactoryHooks, mergeFactoryHooks } from "../install-factory-hooks.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0;
function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), module, module.exports);
  return module.exports;
}
const ai = loadTs("lib/factory/ai.ts");
function fixture(t, git = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-ai-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("factory-ai-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  if (git) assert.equal(spawnSync("git", ["init", "-q", dir], { windowsHide: true }).status, 0);
  return dir;
}
function jobModule(prisma) {
  return loadTs("lib/factory/jobs.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/ai": ai,
    "@/lib/factory/project": { ensureProjectForJob: async () => {} },
    "@/lib/factory/reviewVideo": { deleteReviewVideo: async () => {} },
    "@/lib/factory/mask": { maskSecrets: (v) => v },
  });
}
function maintenanceModule(prisma) {
  return loadTs("lib/factory/maintenance.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/ai": ai,
    "@/lib/factory/mask": { maskSecrets: (v) => v },
    "@/lib/factory/telegram": { notifyDeployReady: async () => {}, notifyMaintenance: async () => {}, notifyText: async () => {} },
    "@/lib/factory/settings": { getDefaultAiEngine: async () => "codex", getSettingValue: async () => null, isAutoDeployEnabled: async () => false, setSettingValue: async () => {} },
  });
}

test("legacy workers only claim Claude jobs; malformed capabilities never grant Codex", () => {
  assert.deepEqual(ai.workerEngines(null), ["claude"]);
  assert.deepEqual(ai.workerEngines("claude,codex"), ["claude", "codex"]);
  assert.deepEqual(ai.workerEngines("codex;DROP TABLE jobs"), []);
  assert.deepEqual(ai.workerEngines(""), []);
});
test("claim SQL filters capabilities and binds values", async () => {
  let query;
  const jobs = jobModule({ $queryRaw: async (q) => { query = q; return []; } });
  await jobs.claimJobs("worker", 2);
  assert.ok(query.sql.includes('"aiEngine" IN'));
  assert.ok(query.values.includes("claude"));
  assert.ok(!query.values.includes("codex"));
  await jobs.claimJobs("worker", 2, ["codex"]);
  assert.ok(query.values.includes("codex"));
  query = null;
  assert.deepEqual(await jobs.claimJobs("worker", 2, []), []);
  assert.equal(query, null);
});
test("approval keeps legacy AI, validates selection, and updates selection atomically", async () => {
  let update;
  const jobs = jobModule({ factoryJob: { updateMany: async (q) => { update = q; return { count: 1 }; }, findUnique: async () => ({ kind: "revision" }) } });
  assert.equal((await jobs.adminAction("job", { action: "approve" })).ok, true);
  assert.equal(Object.hasOwn(update.data, "aiEngine"), false);
  assert.equal((await jobs.adminAction("job", { action: "approve", aiEngine: "codex" })).ok, true);
  assert.equal(update.where.status, "pending");
  assert.equal(update.data.aiEngine, "codex");
  update = null;
  assert.equal((await jobs.adminAction("job", { action: "approve", aiEngine: "bad" })).status, 400);
  assert.equal(update, null);
});
test("AI changes cannot mutate a running job", async () => {
  const state = { status: "running", aiEngine: "claude" };
  const jobs = jobModule({ factoryJob: {
    updateMany: async ({ where, data }) => { if (!where.status.in.includes(state.status)) return { count: 0 }; Object.assign(state, data); return { count: 1 }; },
    findUnique: async () => state,
  } });
  assert.equal((await jobs.adminAction("job", { action: "set-ai", aiEngine: "codex" })).ok, false);
  assert.equal(state.aiEngine, "claude");
});
test("maintenance start rejects a stale engine payload after a selection change", async () => {
  const state = { status: "queued", aiEngine: "codex" };
  const maint = maintenanceModule({ factoryMaintenanceMessage: { updateMany: async ({ where, data }) => {
    if (where.status !== state.status || where.aiEngine !== state.aiEngine) return { count: 0 };
    Object.assign(state, data); return { count: 1 };
  } } });
  assert.equal((await maint.startTurn("turn")).status, 409);
  assert.equal(state.status, "queued");
  assert.equal((await maint.startTurn("turn", "codex")).ok, true);
  assert.equal(state.status, "running");
});
test("maintenance AI changes are limited to unstarted or failed user turns", async () => {
  let where;
  const maint = maintenanceModule({ factoryMaintenanceMessage: { updateMany: async (q) => { where = q.where; return { count: 1 }; } } });
  assert.equal((await maint.setTurnEngine("turn", "codex")).ok, true);
  assert.equal(where.role, "user");
  assert.ok(!where.status.in.includes("running"));
  assert.ok(!where.status.in.includes("done"));
  assert.equal((await maint.setTurnEngine("turn", "bad")).status, 400);
});
test("failed new files are resumed only by their owning maintenance thread even across an AI switch", () => {
  assert.deepEqual(pendingChangesPolicy("codex", "first", "first"), { includeUntracked: true, resumeOwnChanges: true });
  assert.deepEqual(pendingChangesPolicy("claude", "first", "first"), { includeUntracked: true, resumeOwnChanges: true });
  assert.deepEqual(pendingChangesPolicy("claude", "first", "other"), { includeUntracked: true, resumeOwnChanges: false });
  assert.deepEqual(pendingChangesPolicy("claude", null, "new"), { includeUntracked: false, resumeOwnChanges: false });
});
test("maintenance reports preserve independent provider sessions", async () => {
  let engine = "claude";
  const thread = { id: "thread", sessionId: "old-claude", codexSessionId: "old-codex", deployRequestedAt: null };
  const empty = { findMany: async () => [], findFirst: async () => null, count: async () => 0 };
  const maint = maintenanceModule({
    factoryMaintenanceMessage: { ...empty, findUnique: async () => ({ id: "turn", role: "user", status: "running", maintenanceId: "thread", aiEngine: engine }), update: async () => ({}), create: async () => ({}) },
    factoryMaintenance: { ...empty, findUnique: async () => thread, update: async ({ data }) => Object.assign(thread, data) },
    factoryDeploy: empty,
  });
  await maint.reportTurn({ turnId: "turn", done: { ok: true, text: "done", sessionId: "12345678-abcd" } });
  assert.equal(thread.sessionId, "12345678-abcd"); assert.equal(thread.codexSessionId, "old-codex");
  engine = "codex";
  await maint.reportTurn({ turnId: "turn", done: { ok: true, text: "done", sessionId: "abcdef12-abcd" } });
  assert.equal(thread.codexSessionId, "abcdef12-abcd"); assert.equal(thread.sessionId, "12345678-abcd");
});
test("Claude invocation retains flags and model; Codex never inherits Claude permissions/model", () => {
  const cfg = { model: "claude-model", permissionMode: "acceptEdits", allowedTools: "Read,Edit" };
  const claude = invocation(undefined, cfg, { settings: "policy.json", sessionId: "12345678-abcd" });
  assert.ok(claude.args.includes("--allowedTools"));
  assert.ok(claude.args.includes("claude-model"));
  const codex = invocation("codex", cfg);
  assert.equal(codex.args[0], "exec");
  assert.ok(codex.args.includes('sandbox_mode="workspace-write"'));
  assert.ok(!codex.args.includes("claude-model"));
  assert.ok(!codex.args.includes("--dangerously-bypass-approvals-and-sandbox"));
  const resumed = invocation("codex", {}, { sessionId: "12345678-abcd" });
  assert.deepEqual(resumed.args.slice(0, 2), ["exec", "resume"]);
  assert.equal(resumed.args.at(-2), "12345678-abcd");
  assert.throws(() => invocation("codex", {}, { sessionId: "$(bad)" }));
  assert.throws(() => engineOf("unknown"));
});
test("Claude events pass through without changing their contract", () => {
  const ev = { type: "result", is_error: false, result: "done", session_id: "old-id" };
  assert.equal(eventDecoder("claude")(ev), ev);
});
test("Codex events distinguish success, transient errors and terminal failure", () => {
  const decode = eventDecoder("codex");
  assert.equal(decode({ type: "thread.started", thread_id: "thread-id" }).session_id, "thread-id");
  assert.equal(decode({ type: "error", message: "retrying" }).type, "assistant");
  decode({ type: "item.completed", item: { type: "agent_message", text: "한국어 결과" } });
  assert.deepEqual(decode({ type: "turn.completed", usage: { input_tokens: 10 } }), { type: "result", result: "한국어 결과", is_error: false, session_id: "thread-id", usage: { input_tokens: 10 } });
  assert.equal(decode({ type: "turn.failed", error: { message: "login failed" } }).is_error, true);
  assert.equal(decode({ type: "future.event" }), null);
});
test("fake streaming CLI is consumed incrementally and a failed exit cannot be mistaken for completion", { skip: !canSpawn && "host sandbox blocks child processes" }, async (t) => {
  const dir = fixture(t);
  const script = path.join(dir, "fake.mjs");
  fs.writeFileSync(script, `process.stdin.resume(); process.stdin.on('end', () => { for (const e of [{type:'thread.started',thread_id:'test-id'}, {type:'item.completed',item:{type:'agent_message',text:'result'}}, {type:'turn.failed',error:{message:'fixture failure'}}]) console.log(JSON.stringify(e)); process.exitCode=7; });`);
  const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const decode = eventDecoder("codex");
  let result;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => { const ev = decode(JSON.parse(line)); if (ev?.type === "result") result = ev; });
  child.stdin.end("fake prompt");
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 7);
  assert.equal(result.is_error, true);
});
test("writer lock blocks the other AI and does not block another project", (t) => {
  const dir = fixture(t);
  const root = path.join(dir, "locks");
  const project = path.join(dir, "project");
  const first = acquireWorkspace(project, { root, engine: "claude" });
  fs.mkdirSync(project);
  assert.equal(first.file, lockPath(project, root));
  assert.throws(() => acquireWorkspace(project, { root, engine: "codex" }), /다른 AI/);
  assert.throws(() => recoverWorkspace(project, root), /살아/);
  const other = acquireWorkspace(path.join(dir, "other"), { root, engine: "codex" });
  other.release(); first.release();
  acquireWorkspace(project, { root, engine: "codex" }).release();
});
test("lock recovery refuses a live child and preserves a replaced owner's lock", (t) => {
  const dir = fixture(t), root = path.join(dir, "locks");
  const lock = acquireWorkspace(dir, { root });
  const data = JSON.parse(fs.readFileSync(lock.file));
  data.pid = null; data.childPid = process.pid;
  fs.writeFileSync(lock.file, JSON.stringify(data));
  assert.throws(() => recoverWorkspace(dir, root), /살아/);
  data.token = "different-owner"; data.childPid = null;
  fs.writeFileSync(lock.file, JSON.stringify(data));
  lock.release();
  assert.equal(fs.existsSync(lock.file), true);
  assert.match(recoverWorkspace(dir, root), /해제/);
});
test("state redaction preserves JSON validity and handoff includes current edits", { skip: !canSpawn && "host sandbox blocks Git subprocess" }, (t) => {
  const dir = fixture(t, true);
  excludeHarnessState(dir);
  fs.writeFileSync(path.join(dir, "current.txt"), "current code");
  const secret = 'secret"with\\quotes';
  saveHandoff(dir, { engine: "codex", summary: `token ${secret}`, sessionId: "codex-session" }, (v) => v.split(secret).join("***"));
  const state = JSON.parse(fs.readFileSync(harnessFile(dir, "ai-state.json"), "utf8"));
  assert.equal(state.summary, "token ***");
  assert.ok(state.git.changes.includes("current.txt"));
  const prompt = handoffPrompt(dir, "next task");
  assert.ok(prompt.includes("codex-session"));
  assert.ok(prompt.includes("참고 데이터"));
  assert.ok(!prompt.includes(secret));
  assert.ok(!spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout.includes("ai-state"));
});
test("state writes reject an external directory junction", (t) => {
  const dir = fixture(t), external = fixture(t);
  fs.symlinkSync(external, path.join(dir, ".factory"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => saveHandoff(dir, { engine: "codex" }), /실제 프로젝트/);
  assert.equal(fs.readdirSync(external).length, 0);
});
test("verification uses installed compiler, succeeds on success, fails on errors or missing checks", { skip: !canSpawn && "host sandbox blocks compiler subprocess" }, async (t) => {
  const dir = fixture(t);
  const compiler = path.join(dir, "node_modules", "typescript", "bin", "tsc");
  fs.mkdirSync(path.dirname(compiler), { recursive: true });
  fs.writeFileSync(compiler, "process.exitCode = 0;");
  const commands = verificationCommands(dir, "nextjs");
  assert.equal(commands[0].command, process.execPath);
  assert.equal((await verifyWorkspace(dir, "nextjs")).ok, true);
  fs.writeFileSync(compiler, "console.error('fixture type failure'); process.exitCode = 2;");
  const failed = await verifyWorkspace(dir, "nextjs");
  assert.equal(failed.ok, false);
  assert.ok(failed.reason.includes("fixture type failure"));
  assert.equal((await verifyWorkspace(dir, "unsupported")).ok, false);
});
test("verification timeout waits for the child to close before returning", { skip: !canSpawn && "host sandbox blocks compiler subprocess" }, async (t) => {
  const dir = fixture(t);
  const compiler = path.join(dir, "node_modules", "typescript", "bin", "tsc");
  fs.mkdirSync(path.dirname(compiler), { recursive: true });
  fs.writeFileSync(compiler, "setInterval(() => {}, 1000);");
  let child;
  const result = await verifyWorkspace(dir, "nextjs", () => {}, 100, (c) => { child = c; });
  assert.equal(result.ok, false);
  assert.match(result.reason, /시간 초과/);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});
test("known environment secrets are removed from outputs", () => {
  assert.equal(redactAiText("key=very-private", { SOME_API_KEY: "very-private" }), "key=***");
});
test("AI selector exposes both providers and a disabled state", () => {
  const Selector = loadTs("components/admin/factory/AiEngineSelect.tsx", { "@/lib/factory/ai": ai }).default;
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const html = renderToStaticMarkup(React.createElement(Selector, { value: "codex", disabled: true, onChange() {} }));
  assert.ok(html.includes("Claude Code"));
  assert.ok(html.includes("Codex"));
  assert.ok(html.includes("disabled"));
  assert.match(html, /value="codex" selected/);
});

test("handoff JSON masks quoted secrets and preserves provider session IDs without executing a process", (t) => {
  const dir = fixture(t);
  const secret = 'secret"with\\quotes';
  saveHandoff(dir, { engine: "codex", sessionId: "codex-session", summary: `token ${secret}` }, (value) => value.split(secret).join("***"));
  const state = JSON.parse(fs.readFileSync(harnessFile(dir, "ai-state.json"), "utf8"));
  assert.equal(state.summary, "token ***");
  assert.equal(state.sessionId, "codex-session");
  assert.ok(handoffPrompt(dir, "next task").includes("참고 데이터"));
});
test("JSONL chunks retain UTF-8 messages and terminal failure", async () => {
  const stream = new PassThrough();
  const lines = readline.createInterface({ input: stream });
  const decode = eventDecoder("codex");
  const events = [];
  lines.on("line", (line) => { const ev = decode(JSON.parse(line)); if (ev) events.push(ev); });
  const done = new Promise((resolve) => lines.on("close", resolve));
  const bytes = Buffer.from([JSON.stringify({ type: "thread.started", thread_id: "thread-id" }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "한국어 작업 결과" } }), JSON.stringify({ type: "turn.failed", error: { message: "실패" } })].join("\n") + "\n");
  for (let i = 0; i < bytes.length; i += 7) stream.write(bytes.subarray(i, i + 7));
  stream.end(); await done;
  assert.equal(events[1].message.content[0].text, "한국어 작업 결과");
  assert.equal(events.at(-1).is_error, true);
});
function fakeCompiler(exitCode, delay = 0) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 42;
  if (exitCode !== null) setTimeout(() => { if (exitCode) child.stderr.write("fixture failed"); child.exitCode = exitCode; child.emit("close", exitCode); }, delay);
  return child;
}
test("verification gate accepts only successful exit and fails closed when spawn is denied", async (t) => {
  const dir = fixture(t);
  const compiler = path.join(dir, "node_modules/typescript/bin/tsc");
  fs.mkdirSync(path.dirname(compiler), { recursive: true }); fs.writeFileSync(compiler, "fixture");
  const transport = (code) => ({ spawn: () => fakeCompiler(code), stop: () => {} });
  assert.equal((await verifyWorkspace(dir, "nextjs", () => {}, 1000, () => {}, transport(0))).ok, true);
  assert.equal((await verifyWorkspace(dir, "nextjs", () => {}, 1000, () => {}, transport(2))).ok, false);
  const denied = await verifyWorkspace(dir, "nextjs", () => {}, 1000, () => {}, { spawn: () => { throw new Error("EPERM"); }, stop: () => {} });
  assert.equal(denied.ok, false); assert.ok(denied.reason.includes("EPERM"));
});
test("timeout cannot release the gate before the verifier has closed", async (t) => {
  const dir = fixture(t);
  const compiler = path.join(dir, "node_modules/typescript/bin/tsc");
  fs.mkdirSync(path.dirname(compiler), { recursive: true }); fs.writeFileSync(compiler, "fixture");
  const child = fakeCompiler(null);
  let closed = false;
  const transport = { spawn: () => child, stop: () => { setTimeout(() => { closed = true; child.emit("close", 1); }, 20); } };
  const result = await verifyWorkspace(dir, "nextjs", () => {}, 10, () => {}, transport);
  assert.equal(closed, true); assert.equal(result.ok, false); assert.match(result.reason, /시간 초과/);
});
test("Windows Swift source delivery is checked without claiming compilation", (t) => {
  const dir = fixture(t);
  assert.equal(checkSwiftSources(dir).ok, false);
  fs.writeFileSync(path.join(dir, "project.yml"), "name: Example");
  fs.writeFileSync(path.join(dir, "App.swift"), "import SwiftUI");
  assert.deepEqual(checkSwiftSources(dir), { ok: true, scope: "source-only", note: "Swift 소스와 XcodeGen 구성 확인. 컴파일·앱 실행은 Mac에서 별도 검증해야 합니다." });
});

test("primary AI persists, defaults to Claude, and rejects invalid values without writing", async () => {
  let row = null;
  const settings = loadTs("lib/factory/settings.ts", {
    "@/lib/prisma": { __esModule: true, default: { factorySetting: { findUnique: async () => row, upsert: async q => { row = q.create; } } } },
    "@/lib/factory/ai": ai,
  });
  assert.equal(await settings.getDefaultAiEngine(), "claude");
  await settings.setDefaultAiEngine("codex");
  assert.equal(await settings.getDefaultAiEngine(), "codex");
  await assert.rejects(settings.setDefaultAiEngine("invalid"));
  assert.equal(row.value, "codex");
  row = { value: "corrupt" };
  assert.equal(await settings.getDefaultAiEngine(), "claude");
});

test("new maintenance uses primary AI; explicit Claude overrides Codex without changing existing turns", async () => {
  const messages = [];
  const maint = maintenanceModule({
    factoryMaintenance: { create: async () => ({ id: "thread" }) },
    factoryMaintenanceMessage: { create: async q => { messages.push(q.data); return { id: "turn", createdAt: new Date() }; }, count: async () => 0 },
  });
  assert.equal((await maint.sendMaintenance({ text: "새 정비 지시입니다", source: "통제실" })).ok, true);
  assert.equal(messages[0].aiEngine, "codex");
  assert.equal((await maint.sendMaintenance({ text: "Claude 지시입니다", aiEngine: "claude", source: "채팅" })).ok, true);
  assert.equal(messages[1].aiEngine, "claude");
  assert.equal(messages[1].status, "awaiting_approval");
  assert.equal(messages[0].aiEngine, "codex");
});

function hookFixture(defaultEngine = "codex") {
  const messages = new Map();
  const threads = new Map();
  let notifications = 0;
  const createMessage = async ({ data }) => {
    if (messages.has(data.id)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
    messages.set(data.id, { ...data }); return data;
  };
  const db = {
    factoryMaintenanceMessage: { findUnique: async q => messages.get(q.where.id) || null, create: createMessage },
    factoryMaintenance: {
      findUnique: async q => threads.get(q.where.id) || null,
      update: async q => ({ ...threads.get(q.where.id), ...q.data }),
      create: async ({ data }) => {
        if (threads.has(data.id)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
        const { messages: nested, ...thread } = data;
        threads.set(data.id, { ...thread, status: "open" });
        await createMessage({ data: { ...nested.create, maintenanceId: data.id } });
        return thread;
      },
    },
    $transaction: fn => fn(db),
  };
  const hooks = loadTs("lib/factory/hook-tasks.ts", {
    "@/lib/prisma": { __esModule: true, default: db },
    "@/lib/factory/ai": ai,
    "@/lib/factory/settings": { getDefaultAiEngine: async () => defaultEngine },
    "@/lib/factory/mask": { maskSecrets: value => value.replaceAll("secret-fixture", "***") },
    "@/lib/factory/telegram": { notifyMaintenance: async () => { notifications++; } },
  });
  return { hooks, messages, threads, notifications: () => notifications };
}

test("hook boundary rejects invalid AI, extra approval/deploy flags, oversized text and bad identities", () => {
  const { hooks } = hookFixture();
  const valid = { requestId: "request-identity-123456", provider: "claude", text: "정비 지시를 보내세요" };
  assert.ok(hooks.parseHookSubmission(valid));
  for (const patch of [{ aiEngine: "default" }, { approved: true }, { deploy: true }, { requestId: "short" }, { text: "x".repeat(8001) }, { threadId: "../../secret" }, { provider: "other" }]) assert.equal(hooks.parseHookSubmission({ ...valid, ...patch }), null);
});

test("hook queue uses primary AI, preserves approval gate, masks text and deduplicates concurrent retry", async () => {
  const f = hookFixture();
  const request = { requestId: "request-identity-123456", provider: "claude", text: "지시 secret-fixture 테스트" };
  const [a, b] = await Promise.all([f.hooks.submitHookTask(request), f.hooks.submitHookTask(request)]);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.equal(a.turnId, b.turnId);
  assert.equal(f.messages.size, 1); assert.equal(f.threads.size, 1); assert.equal(f.notifications(), 1);
  const turn = f.messages.get(a.turnId);
  assert.equal(turn.aiEngine, "codex"); assert.equal(turn.status, "awaiting_approval"); assert.equal(turn.source, "Claude 훅");
  assert.ok(!turn.text.includes("secret-fixture"));
  assert.equal((await f.hooks.submitHookTask({ ...request, text: "다른 지시를 보내요" })).status, 409);
});

test("hook explicit engine and continuation retain existing thread and reject closed threads", async () => {
  const f = hookFixture();
  f.threads.set("existing", { status: "open" });
  const body = { requestId: "request-identity-123456", provider: "codex", aiEngine: "claude", threadId: "existing", text: "기존 정비를 이어서 해요" };
  const r = await f.hooks.submitHookTask(body);
  assert.equal(r.aiEngine, "claude"); assert.equal(r.threadId, "existing");
  f.threads.set("closed", { status: "closed" });
  assert.equal((await f.hooks.submitHookTask({ ...body, requestId: "request-identity-999999", threadId: "closed" })).status, 409);
  assert.equal(f.messages.size, 1);
});

test("factory command parses literal instructions without executing shell content; ordinary prompts are untouched", () => {
  assert.equal(parseFactoryPrompt("일반 지시를 실행해 주세요"), null);
  assert.equal(parseFactoryPrompt("/factory-other codex 지시"), null);
  assert.deepEqual(parseFactoryPrompt("/factory codex --thread abc 고칠 내용 $(echo secret); `command`"), { action: "submit", aiEngine: "codex", threadId: "abc", text: "고칠 내용 $(echo secret); `command`" });
  assert.deepEqual(parseFactoryPrompt("/factory 기본 설정을 이용하세요"), { action: "submit", text: "기본 설정을 이용하세요" });
  assert.deepEqual(parseFactoryPrompt("공장: codex 기능을 수정해 주세요"), { action: "submit", aiEngine: "codex", text: "기능을 수정해 주세요" });
  assert.deepEqual(parseFactoryPrompt("/factory status abc"), { action: "status", threadId: "abc" });
  assert.throws(() => parseFactoryPrompt("/factory codex"));
  const event = { session_id: "session", turn_id: "turn", prompt: "instruction" };
  assert.equal(hookRequestId("codex", event), hookRequestId("codex", event));
  assert.notEqual(hookRequestId("claude", event), hookRequestId("codex", event));
});

test("bridge puts credentials only in headers, refuses redirects and preserves request ID across retry", async () => {
  const seen = [];
  const transport = async (url, opts) => { seen.push({ url, opts }); return { ok: true, json: async () => ({ ok: true }) }; };
  const cfg = { origin: "https://example.test", token: "header-only-secret" };
  const body = { requestId: "request-identity-123456", text: "지시를 등록하세요", provider: "codex" };
  await bridgeRequest(cfg, "submit", body, transport); await bridgeRequest(cfg, "submit", body, transport);
  assert.equal(seen[0].opts.redirect, "error");
  assert.equal(seen[0].opts.headers.Authorization, "Bearer header-only-secret");
  assert.ok(!String(seen[0].url).includes(cfg.token)); assert.ok(!seen[0].opts.body.includes(cfg.token));
  assert.equal(seen[0].opts.body, seen[1].opts.body);
});

test("ordinary and supervisor-owned hook prompts never read credentials or contact the server", async () => {
  const out = [];
  assert.equal(await runBridge(["--hook", "--provider", "codex"], [JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "일반 대화입니다" })], v => out.push(v), () => {}, { FACTORY_CONFIG: "missing-file" }), 0);
  assert.equal(await runBridge(["--hook", "--provider", "codex"], [JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "/factory codex 지시를 실행하세요" })], v => out.push(v), () => {}, { FACTORY_LAUNCHER: "1", FACTORY_CONFIG: "missing-file" }), 0);
  assert.deepEqual(out, []);
});

test("native bridge blocks duplicate local execution after submit and after failure, while SessionStart remains advisory", async t => {
  const dir = fixture(t);
  const file = path.join(dir, "config.json");
  const token = "private-fixture-worker-token";
  fs.writeFileSync(file, JSON.stringify({ serverUrl: "https://example.test", token }));
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  let submitted;
  globalThis.fetch = async (url, opts) => {
    submitted = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ message: "승인 대기", aiEngine: "codex", threadId: "thread", turnId: "turn" }) };
  };
  const output = [];
  const event = { hook_event_name: "UserPromptSubmit", session_id: "session", turn_id: "turn", prompt: `공장: codex 지시 ${token} 테스트` };
  await runBridge(["--hook", "--provider", "claude"], [JSON.stringify(event)], v => output.push(JSON.parse(v)), () => {}, { FACTORY_CONFIG: file });
  assert.equal(output[0].decision, "block"); assert.equal(submitted.provider, "claude"); assert.equal(submitted.aiEngine, "codex");
  assert.ok(!submitted.text.includes(token));
  globalThis.fetch = async () => { throw new Error(token); };
  output.length = 0;
  await runBridge(["--hook", "--provider", "codex"], [JSON.stringify(event)], v => output.push(JSON.parse(v)), () => {}, { FACTORY_CONFIG: file });
  assert.equal(output[0].decision, "block"); assert.ok(!output[0].reason.includes(token));
  output.length = 0;
  await runBridge(["--hook"], [JSON.stringify({ hook_event_name: "SessionStart" })], v => output.push(JSON.parse(v)), () => {}, { FACTORY_CONFIG: file });
  assert.ok(output[0].systemMessage); assert.equal(output[0].decision, undefined);
});

test("hook installation preserves existing Claude and Codex hooks, is idempotent, and dry run does not write", t => {
  const home = fixture(t);
  const bridge = path.join(home, "bridge.mjs"); fs.writeFileSync(bridge, "// fixture");
  fs.mkdirSync(path.join(home, ".claude"));
  const file = path.join(home, ".claude/settings.json");
  const before = { env: { EXISTING: "unchanged" }, hooks: { Stop: [{ hooks: [{ command: "keep-backup" }] }], SessionStart: [{ hooks: [{ command: "keep-status" }] }] } };
  fs.writeFileSync(file, JSON.stringify(before));
  installFactoryHooks({ home, bridge, dryRun: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), before);
  assert.equal(fs.existsSync(path.join(home, ".codex/hooks.json")), false);
  assert.ok(installFactoryHooks({ home, bridge }).every(x => x.changed));
  assert.ok(installFactoryHooks({ home, bridge }).every(x => !x.changed));
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(after.env, before.env); assert.deepEqual(after.hooks.Stop, before.hooks.Stop);
  assert.equal(after.hooks.SessionStart[0].hooks[0].command, "keep-status");
  assert.equal(after.hooks.UserPromptSubmit[0].hooks[0].timeout, 20);
  assert.deepEqual(mergeFactoryHooks(after, after.hooks.UserPromptSubmit[0].hooks[0].command), after);
});
