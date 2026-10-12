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
    "@/lib/factory/settings": { getSettingValue: async () => null, isAutoDeployEnabled: async () => false, setSettingValue: async () => {} },
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
