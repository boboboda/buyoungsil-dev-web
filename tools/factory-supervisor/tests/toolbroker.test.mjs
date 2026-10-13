// 도구 요청 중계(toolbroker.mjs·toolreq.mjs)와 서버 쪽 정리(lib/factory/toolBroker.ts) 시험.
// 실제 외부 서비스·키는 쓰지 않는다. toolkit.run 은 파이썬 대신 node 로 가짜 진입점(cli.py 이름의 JS)을 실행한다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { brokerRules, brokerSettings, createBroker, loadToolkitManifest, readRequest, safeAppPath, TOOLREQ_PATH, validateRequest } from "../toolbroker.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0;
function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}
const serverBroker = loadTs("lib/factory/toolBroker.ts", { "@/lib/factory/mask": { maskSecrets: (v) => v } });

const SECRET = "supersecretvalue-PIXEL-123";
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-broker-test-"));
  t.after(() => {
    assert.ok(path.basename(dir).startsWith("factory-broker-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const app = path.join(dir, "app");
  fs.mkdirSync(path.join(app, ".factory", "requests"), { recursive: true });
  return { dir, app, toolkit: path.join(dir, "game-toolkit") };
}
function request(app, id, tool, args) {
  fs.writeFileSync(path.join(app, ".factory", "requests", `${id}.json`), JSON.stringify({ id, tool, args }));
}
const response = (app, id) => JSON.parse(fs.readFileSync(path.join(app, ".factory", "responses", `${id}.json`), "utf8"));
const hasResponse = (app, id) => fs.existsSync(path.join(app, ".factory", "responses", `${id}.json`));
function broker(f, settings, extra = {}) {
  const logs = [];
  const b = createBroker({
    appDir: f.app,
    jobId: "job1",
    engine: "codex",
    getSettings: () => brokerSettings(settings),
    toolkitDir: f.toolkit,
    pythonCmd: process.execPath, // 가짜 진입점은 JS
    requiredSecrets: [],
    secrets: {},
    log: (m) => logs.push(m),
    ...extra,
  });
  return { b, logs };
}
function toolkit(f, tools, entrySource = "") {
  fs.mkdirSync(f.toolkit, { recursive: true });
  fs.writeFileSync(path.join(f.toolkit, "tools.json"), JSON.stringify({ version: 1, tools }));
  fs.writeFileSync(path.join(f.toolkit, "cli.py"), entrySource);
}
function trySymlink(target, link, type) {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch {
    return false; // 윈도우 일반 권한에서는 심볼릭 링크를 못 만들 수 있다
  }
}

// ───────── 요청 검증 ─────────
test("request validation: allow list, exact keys, id must match file name", () => {
  assert.equal(validateRequest({ id: "a1", tool: "echo", args: {} }, "a1").ok, true);
  assert.match(validateRequest({ id: "a1", tool: "shell", args: {} }, "a1").reason, /허용 목록에 없는 도구/);
  assert.match(validateRequest({ id: "a1", tool: "Bash; rm -rf /", args: {} }, "a1").reason, /형식/);
  assert.match(validateRequest({ id: "a1", tool: "echo", args: {}, cmd: "x" }, "a1").reason, /모르는 항목/);
  assert.match(validateRequest({ id: "a2", tool: "echo", args: {} }, "a1").reason, /파일 이름/);
  assert.match(validateRequest({ id: "a1", tool: "echo", args: [] }, "a1").reason, /객체/);
  assert.equal(validateRequest([], "a1").ok, false);
});

test("request file: size limit, non-JSON and symlinked requests are refused", (t) => {
  const f = fixture(t);
  const big = path.join(f.app, ".factory", "requests", "big.json");
  fs.writeFileSync(big, JSON.stringify({ id: "big", tool: "echo", args: { x: "a".repeat(20_000) } }));
  assert.match(readRequest(big, "big").reason, /너무 커요/);
  const bad = path.join(f.app, ".factory", "requests", "bad.json");
  fs.writeFileSync(bad, "{not json");
  assert.match(readRequest(bad, "bad").reason, /JSON/);
  const target = path.join(f.dir, "outside.json");
  fs.writeFileSync(target, JSON.stringify({ id: "ln", tool: "echo", args: {} }));
  const link = path.join(f.app, ".factory", "requests", "ln.json");
  if (!trySymlink(target, link, "file")) return t.skip("이 환경은 심볼릭 링크를 만들 수 없어요");
  assert.match(readRequest(link, "ln").reason, /심볼릭 링크/);
});

test("path arguments stay inside the app folder", (t) => {
  const f = fixture(t);
  assert.equal(safeAppPath(f.app, "assets/out.png").ok, true);
  assert.equal(safeAppPath(f.app, "assets\\sub\\out.png").rel, "assets/sub/out.png");
  for (const bad of ["../x.png", "a/../../x", "/etc/passwd", "C:\\Windows\\x", "C:x", "\\\\server\\share", ".git/config", "./a", "", "a\nb"]) {
    assert.equal(safeAppPath(f.app, bad).ok, false, bad);
  }
  fs.mkdirSync(path.join(f.dir, "elsewhere"));
  if (!trySymlink(path.join(f.dir, "elsewhere"), path.join(f.app, "linked"), "junction")) return t.skip("이 환경은 링크를 만들 수 없어요");
  assert.match(safeAppPath(f.app, "linked/x.png").reason, /심볼릭 링크/);
});

// ───────── 모드 ─────────
test("off mode reads nothing and writes no response (existing jobs unchanged)", async (t) => {
  const f = fixture(t);
  request(f.app, "r1", "echo", { hello: 1 });
  const { b } = broker(f, null); // 설정이 없으면(예전 서버) 꺼짐
  await b.tick();
  assert.equal(hasResponse(f.app, "r1"), false);
  assert.equal(fs.existsSync(path.join(f.app, ".factory", "responses")), false);
  assert.deepEqual(b.list(), []);
  assert.equal(brokerRules("off"), "");
  assert.match(brokerRules("allow"), /toolreq\.mjs/);
});

test("report mode validates and records but never executes", async (t) => {
  const f = fixture(t);
  request(f.app, "r1", "echo", { hello: 1 });
  request(f.app, "r2", "nope", {});
  const { b } = broker(f, { mode: "report" });
  await b.tick();
  assert.equal(response(f.app, "r1").status, "denied");
  assert.match(response(f.app, "r1").message, /보고만 모드/);
  assert.equal(response(f.app, "r1").result, undefined);
  assert.match(response(f.app, "r2").message, /허용 목록/);
  assert.deepEqual(b.list().map((r) => [r.id, r.status]), [["r1", "denied"], ["r2", "denied"]]);
  const events = fs.readFileSync(path.join(f.app, ".factory", "ai-events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(Object.keys(events[0]).sort(), ["at", "engine", "ms", "phase", "requestId", "status", "taskId", "tool"]);
});

test("allow mode: echo round trip, each request answered once", async (t) => {
  const f = fixture(t);
  request(f.app, "r1", "echo", { hello: "world", n: 3 });
  let changes = 0;
  const { b } = broker(f, { mode: "allow" }, { onChange: () => changes++ });
  await b.tick();
  await b.tick();
  const r = response(f.app, "r1");
  assert.equal(r.status, "ok");
  assert.deepEqual(r.result, { hello: "world", n: 3 });
  assert.deepEqual(r.files, []);
  assert.equal(changes, 1);
  // 응답이 이미 있는 요청은 새 중계기(다음 실행)에서도 다시 처리하지 않는다
  const again = broker(f, { mode: "allow" }).b;
  await again.tick();
  assert.deepEqual(again.list(), []);
});

test("per-job request limit denies the overflow", async (t) => {
  const f = fixture(t);
  for (const id of ["a1", "a2", "a3"]) request(f.app, id, "echo", {});
  const { b } = broker(f, { mode: "allow", maxRequests: 2 });
  await b.tick();
  assert.deepEqual(["a1", "a2", "a3"].map((id) => response(f.app, id).status), ["ok", "ok", "denied"]);
  assert.match(response(f.app, "a3").message, /상한\(2개\)/);
});

test("no per-job request limit by default: old limit(30) + 3 requests are all answered", async (t) => {
  const f = fixture(t);
  const ids = Array.from({ length: 33 }, (_, i) => `n${String(i).padStart(2, "0")}`);
  for (const id of ids) request(f.app, id, "echo", {});
  for (const settings of [{ mode: "allow" }, { mode: "allow", maxRequests: 0 }, { mode: "allow", maxRequests: null }]) {
    fs.rmSync(path.join(f.app, ".factory", "responses"), { recursive: true, force: true });
    const { b } = broker(f, settings);
    await b.tick();
    assert.deepEqual(new Set(ids.map((id) => response(f.app, id).status)), new Set(["ok"]), JSON.stringify(settings));
  }
});

test("stopped broker no longer answers", async (t) => {
  const f = fixture(t);
  const { b } = broker(f, { mode: "allow" });
  b.stop();
  request(f.app, "r1", "echo", {});
  await b.tick();
  assert.equal(hasResponse(f.app, "r1"), false);
});

// ───────── toolkit.run ─────────
test("toolkit.run without a toolkit fails softly", async (t) => {
  const f = fixture(t);
  request(f.app, "k1", "toolkit.run", { command: "sprite", args: {} });
  const { b } = broker(f, { mode: "allow" });
  await b.tick();
  assert.equal(response(f.app, "k1").status, "failed");
  assert.match(response(f.app, "k1").message, /툴킷이 없어요/);
});

test("tools.json validation rejects bad manifests", (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.toolkit);
  const write = (m) => fs.writeFileSync(path.join(f.toolkit, "tools.json"), JSON.stringify(m));
  write({ version: 2, tools: {} });
  assert.equal(loadToolkitManifest(f.toolkit).ok, false);
  write({ version: 1, tools: { x: { entry: "../evil.py" } } });
  assert.match(loadToolkitManifest(f.toolkit).reason, /entry/);
  write({ version: 1, tools: { x: { entry: "cli.sh" } } });
  assert.match(loadToolkitManifest(f.toolkit).reason, /entry/);
  write({ version: 1, tools: { x: { entry: "cli.py", args: [{ name: "a", type: "shell" }] } } });
  assert.match(loadToolkitManifest(f.toolkit).reason, /type/);
  write({ version: 1, tools: { x: { entry: "cli.py", secrets: ["lower"] } } });
  assert.match(loadToolkitManifest(f.toolkit).reason, /secrets/);
  write({ version: 1, tools: { "Bad Name": { entry: "cli.py" } } });
  assert.equal(loadToolkitManifest(f.toolkit).ok, false);
  write({ version: 1, tools: { sprite: { entry: "cli.py", args: [{ name: "size", type: "int", required: true }], timeoutSec: 30 } } });
  const ok = loadToolkitManifest(f.toolkit);
  assert.equal(ok.ok, true);
  assert.equal(ok.tools.sprite.network, false);
});

test("toolkit.run refuses undeclared commands, bad args, path escapes and secret tools without permission", async (t) => {
  const f = fixture(t);
  toolkit(f, {
    sprite: { entry: "cli.py", args: [{ name: "size", type: "int", required: true }, { name: "out", type: "path" }, { name: "prompt", type: "string" }] },
    pixel: { entry: "cli.py", args: [], network: true, secrets: ["PIXEL_TOKEN"] },
  });
  const cases = {
    c1: [{ command: "rm" }, /없는 하위 명령/],
    c2: [{ command: "sprite", args: {} }, /필수 인자/],
    c3: [{ command: "sprite", args: { size: "64" } }, /정수/],
    c4: [{ command: "sprite", args: { size: 64, extra: 1 } }, /선언되지 않은 인자/],
    c5: [{ command: "sprite", args: { size: 64, out: "../../outside.png" } }, /\.\./],
    c6: [{ command: "sprite", args: { size: 64, out: "C:\\x.png" } }, /절대 경로/],
    c7: [{ command: "sprite", args: { size: 64, prompt: "a\nb" } }, /줄바꿈/],
    c8: [{ command: "sprite", shell: "x" }, /command/],
    c9: [{ command: "pixel" }, /허용되지 않은 키/], // 이 일감의 requiredSecrets 에 없음
  };
  for (const [id, [args]] of Object.entries(cases)) request(f.app, id, "toolkit.run", args);
  const { b } = broker(f, { mode: "allow" });
  await b.tick();
  for (const [id, [, re]] of Object.entries(cases)) {
    const r = response(f.app, id);
    assert.equal(r.status, "denied", id);
    assert.match(r.message, re, id);
  }
  // 보고만 모드에서는 키가 있어도 네트워크·키 도구는 거부
  request(f.app, "c10", "toolkit.run", { command: "pixel" });
  await broker(f, { mode: "report" }, { requiredSecrets: ["PIXEL_TOKEN"], secrets: { PIXEL_TOKEN: SECRET } }).b.tick();
  assert.match(response(f.app, "c10").message, /허용' 모드/);
});

const FAKE_CLI = `
const fs = require("node:fs"), path = require("node:path");
const [cmd, ...args] = process.argv.slice(2);
if (cmd === "slow") {
  fs.writeFileSync(path.join(process.env.FACTORY_ASSETS_DIR, "slow.pid"), String(process.pid));
  setTimeout(() => {}, Number(args.find((a) => a.startsWith("--sec="))?.slice(6) || 60) * 1000);
} else {
  fs.writeFileSync(path.join(process.env.FACTORY_ASSETS_DIR, "sprite.png"), "png");
  console.log("cmd=" + cmd + " args=" + args.join(" ") + " cwd=" + path.basename(process.cwd()));
  console.log("token=" + process.env.PIXEL_TOKEN + " leak=" + process.env.FACTORY_TEST_LEAK);
}
`;

test("toolkit.run executes a declared command with a fixed argv, passes only declared secrets, and masks them", { skip: !canSpawn && "자식 프로세스를 띄울 수 없는 환경" }, async (t) => {
  const f = fixture(t);
  toolkit(f, { pixel: { entry: "cli.py", args: [{ name: "size", type: "int", required: true }, { name: "out", type: "path" }], network: true, secrets: ["PIXEL_TOKEN"], timeoutSec: 30 } }, FAKE_CLI);
  process.env.FACTORY_TEST_LEAK = "parent-env-should-not-pass";
  t.after(() => delete process.env.FACTORY_TEST_LEAK);
  request(f.app, "p1", "toolkit.run", { command: "pixel", args: { size: 64, out: ".factory/assets/x.png" } });
  const { b, logs } = broker(f, { mode: "allow" }, { requiredSecrets: ["PIXEL_TOKEN"], secrets: { PIXEL_TOKEN: SECRET } });
  await b.tick();
  const r = response(f.app, "p1");
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.deepEqual(r.files, [".factory/assets/sprite.png"]);
  assert.match(r.output, /cmd=pixel args=--size=64 --out=\.factory\/assets\/x\.png cwd=app/);
  assert.match(r.output, /token=\*\*\* leak=undefined/);
  const everything = [
    fs.readFileSync(path.join(f.app, ".factory", "responses", "p1.json"), "utf8"),
    fs.readFileSync(path.join(f.app, ".factory", "ai-events.jsonl"), "utf8"),
    JSON.stringify(b.list()),
    logs.join("\n"),
  ].join("\n");
  assert.equal(everything.includes(SECRET), false);
});

test("toolkit.run stops a tool at its time limit", { skip: !canSpawn && "자식 프로세스를 띄울 수 없는 환경" }, async (t) => {
  const f = fixture(t);
  toolkit(f, { slow: { entry: "cli.py", timeoutSec: 1 } }, FAKE_CLI);
  request(f.app, "s1", "toolkit.run", { command: "slow" });
  const { b } = broker(f, { mode: "allow" });
  const started = Date.now();
  await b.tick();
  assert.equal(response(f.app, "s1").status, "timeout");
  assert.ok(Date.now() - started < 20_000);
});

// 가짜 자식 프로세스(spawnImpl)와 가짜 시계로 305초짜리 도구를 흉내 낸다
function fakeSpawn() {
  const children = [];
  const spawnImpl = () => {
    const c = new EventEmitter();
    c.exitCode = null;
    children.push(c);
    return c;
  };
  return { children, spawnImpl };
}
async function until(cond, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("기다림 초과");
    await new Promise((r) => setImmediate(r));
  }
}

test("no tool time limit by default: a 305s tool runs to the end (old 180s setting would stop it)", async (t) => {
  const f = fixture(t);
  toolkit(f, { codex: { entry: "cli.py", timeoutSec: 900 } }, "");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const run = async (settings, id) => {
    request(f.app, id, "toolkit.run", { command: "codex" });
    const { children, spawnImpl } = fakeSpawn();
    const done = broker(f, settings, { spawnImpl }).b.tick();
    await until(() => children.length === 1);
    t.mock.timers.tick(305_000); // 305초 지남
    children[0].exitCode = 0;
    children[0].emit("close", 0);
    await done;
    return response(f.app, id);
  };
  assert.equal((await run({ mode: "allow" }, "long1")).status, "ok");
  assert.equal((await run({ mode: "allow", toolTimeoutSec: 0 }, "long2")).status, "ok");
  assert.equal((await run({ mode: "allow", toolTimeoutSec: null }, "long3")).status, "ok");
  // 값을 직접 넣으면 그 제한은 지금까지처럼 지킨다
  const limited = await run({ mode: "allow", toolTimeoutSec: 180 }, "long4");
  assert.equal(limited.status, "timeout");
  assert.match(limited.message, /180초/);
});

// 실제 300초 이상 sleep 하는 가짜 도구(느려서 FACTORY_SLOW_TESTS=1 일 때만)
test("real 310s fake tool runs to the end without a time limit", { skip: (!canSpawn && "자식 프로세스를 띄울 수 없는 환경") || (process.env.FACTORY_SLOW_TESTS !== "1" && "FACTORY_SLOW_TESTS=1 일 때만"), timeout: 400_000 }, async (t) => {
  const f = fixture(t);
  toolkit(f, { slow: { entry: "cli.py", args: [{ name: "sec", type: "int" }], timeoutSec: 900 } }, FAKE_CLI.replace("setTimeout(() => {}", "setTimeout(() => console.log('slept')"));
  request(f.app, "real1", "toolkit.run", { command: "slow", args: { sec: 310 } });
  const started = Date.now();
  await broker(f, { mode: "allow" }).b.tick();
  const r = response(f.app, "real1");
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.match(r.output, /slept/);
  assert.ok(Date.now() - started >= 310_000);
});

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("stopping the broker (job done, cancelled or supervisor shutdown) kills the running tool process", { skip: !canSpawn && "자식 프로세스를 띄울 수 없는 환경" }, async (t) => {
  const f = fixture(t);
  toolkit(f, { slow: { entry: "cli.py", args: [{ name: "sec", type: "int" }], timeoutSec: 900 } }, FAKE_CLI);
  request(f.app, "k1", "toolkit.run", { command: "slow", args: { sec: 600 } });
  request(f.app, "k2", "echo", {});
  const { b } = broker(f, { mode: "allow" });
  const pidFile = path.join(f.app, ".factory", "assets", "slow.pid");
  const started = Date.now();
  const done = b.tick();
  await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8").length > 0, 15_000);
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  assert.equal(alive(pid), true);
  b.stop();
  await done;
  assert.ok(Date.now() - started < 30_000);
  await until(() => !alive(pid), 10_000);
  assert.notEqual(response(f.app, "k1").status, "ok");
  // 멈춘 뒤에는 다음 요청을 처리하지 않고, 다른 일감의 중계기는 바로 도구를 돌릴 수 있다(한 번에 하나 잠금이 풀림)
  assert.equal(hasResponse(f.app, "k2"), false);
  await broker(f, { mode: "allow" }).b.tick();
  assert.equal(response(f.app, "k2").status, "ok");
});

test("toolreq submit waits in one command and prints the response", { skip: !canSpawn && "자식 프로세스를 띄울 수 없는 환경" }, async (t) => {
  const f = fixture(t);
  const argsFile = path.join(f.dir, "args.json");
  fs.writeFileSync(argsFile, JSON.stringify({ ping: "pong" }));
  const { b } = broker(f, { mode: "allow" });
  b.start(200);
  t.after(() => b.stop());
  const child = spawn(process.execPath, [TOOLREQ_PATH, "submit", "--tool", "echo", "--args-file", argsFile, "--id", "cli1", "--timeout-sec", "20"], { cwd: f.app, windowsHide: true });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0, out);
  const last = JSON.parse(out.trim().split("\n").pop().replace(/^TOOLREQ /, ""));
  assert.equal(last.status, "ok");
  assert.deepEqual(response(f.app, "cli1").result, { ping: "pong" });
  // 기다림이 끝나면 timeout 으로 끝난다(응답 없는 id)
  const waited = spawnSync(process.execPath, [TOOLREQ_PATH, "status", "--id", "missing"], { cwd: f.app, encoding: "utf8", windowsHide: true });
  assert.equal(waited.status, 2);
  assert.match(waited.stdout, /"status":"pending"/);
});

// ───────── 서버 쪽 ─────────
test("server settings default to off and clamp limits; reports keep only names, status and time", () => {
  // 기본은 요청 수·제한 시간 모두 제한 없음(0). 값을 넣으면 지금까지처럼 범위로 맞춘다
  assert.deepEqual(serverBroker.normalizeToolBroker(null), { mode: "off", maxRequests: 0, toolTimeoutSec: 0 });
  assert.deepEqual(serverBroker.normalizeToolBroker({ mode: "allow", maxRequests: 9999, toolTimeoutSec: 1 }), { mode: "allow", maxRequests: 200, toolTimeoutSec: 5 });
  assert.deepEqual(serverBroker.normalizeToolBroker({ mode: "allow", maxRequests: 0, toolTimeoutSec: -5 }), { mode: "allow", maxRequests: 0, toolTimeoutSec: 0 });
  assert.equal(serverBroker.normalizeToolBroker({ mode: "all" }).mode, "off");
  assert.deepEqual(brokerSettings(null), { mode: "off", maxRequests: 0, toolTimeoutSec: 0 });
  assert.deepEqual(brokerSettings({ mode: "allow", maxRequests: 9999 }), { mode: "allow", maxRequests: 200, toolTimeoutSec: 0 });
  assert.deepEqual(brokerSettings({ mode: "allow", maxRequests: 0, toolTimeoutSec: null }), { mode: "allow", maxRequests: 0, toolTimeoutSec: 0 });
  assert.deepEqual(brokerSettings({ mode: "allow", maxRequests: 30, toolTimeoutSec: 180 }), { mode: "allow", maxRequests: 30, toolTimeoutSec: 180 });
  // 감독 프로그램에는 제한 없음을 null 로 보낸다. 예전 감독 프로그램(0 은 하한 1·5 로 올림)은 null 이면 자기 기본값 30·180 을 쓴다
  const wire = serverBroker.toolBrokerForSupervisor({ mode: "allow", maxRequests: 0, toolTimeoutSec: 0 });
  assert.deepEqual(wire, { mode: "allow", maxRequests: null, toolTimeoutSec: null });
  const oldInt = (x, d, lo, hi) => (Number.isInteger(x) ? Math.min(hi, Math.max(lo, x)) : d);
  assert.deepEqual([oldInt(wire.maxRequests, 30, 1, 200), oldInt(wire.toolTimeoutSec, 180, 5, 900)], [30, 180]);
  assert.deepEqual(brokerSettings(wire), { mode: "allow", maxRequests: 0, toolTimeoutSec: 0 });
  assert.deepEqual(serverBroker.toolBrokerForSupervisor({ mode: "allow", maxRequests: 7, toolTimeoutSec: 60 }), { mode: "allow", maxRequests: 7, toolTimeoutSec: 60 });
  assert.equal(serverBroker.toolBrokerLimitLabel(0, "초"), "제한 없음");
  assert.equal(serverBroker.toolBrokerLimitLabel(60, "초"), "60초");
  assert.equal(serverBroker.cleanToolRequests("x"), null);
  const at = new Date().toISOString();
  const rows = serverBroker.cleanToolRequests([
    { id: "r1", tool: "echo", status: "ok", at, ms: 12, message: "fine", args: { secret: 1 } },
    { id: "../x", tool: "echo", status: "ok", at },
    { id: "r2", tool: "echo", status: "running", at },
    { id: "r3", tool: "?", status: "denied", at, message: "x".repeat(500) },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["r1", "r3"]);
  assert.equal(Object.hasOwn(rows[0], "args"), false);
  assert.equal(rows[1].message.length, 200);
});

test("server stores the broker setting as JSON and survives corrupt values", async () => {
  let row = null;
  const settings = loadTs("lib/factory/settings.ts", {
    "@/lib/prisma": { __esModule: true, default: { factorySetting: { findUnique: async () => row, upsert: async (q) => { row = { value: q.update.value }; } } } },
    "@/lib/factory/ai": loadTs("lib/factory/ai.ts"),
    "@/lib/factory/toolBroker": serverBroker,
    "@/lib/factory/handoff": { cleanHandoff: () => null },
  });
  assert.equal((await settings.getToolBrokerSettings()).mode, "off");
  await settings.setToolBrokerSettings({ mode: "report" });
  assert.deepEqual(await settings.getToolBrokerSettings(), { mode: "report", maxRequests: 0, toolTimeoutSec: 0 });
  await settings.setToolBrokerSettings({ maxRequests: 5 });
  assert.equal((await settings.getToolBrokerSettings()).mode, "report");
  assert.equal((await settings.getToolBrokerSettings()).maxRequests, 5); // 새로 저장한 값은 지킨다
  assert.equal(JSON.parse(row.value).limitsVersion, 2);
  // 예전 코드가 저장한 값(버전 표시 없음, 30개·180초)은 모드만 살리고 제한 없음으로 읽는다. 저장값은 그대로 둔다
  const legacy = JSON.stringify({ mode: "allow", maxRequests: 30, toolTimeoutSec: 180 });
  row = { value: legacy };
  assert.deepEqual(await settings.getToolBrokerSettings(), { mode: "allow", maxRequests: 0, toolTimeoutSec: 0 });
  assert.equal(row.value, legacy);
  await settings.setToolBrokerSettings({ mode: "allow" });
  assert.deepEqual(JSON.parse(row.value), { mode: "allow", maxRequests: 0, toolTimeoutSec: 0, limitsVersion: 2 });
  await assert.rejects(settings.setToolBrokerSettings({ mode: "root" }));
  row = { value: "{broken" };
  assert.equal((await settings.getToolBrokerSettings()).mode, "off");
});

test("report parsing carries the cleaned tool list and ignores it when absent", () => {
  const jobs = loadTs("lib/factory/jobs.ts", {
    "@/lib/prisma": { __esModule: true, default: {} },
    "@/lib/factory/ai": loadTs("lib/factory/ai.ts"),
    "@/lib/factory/project": { ensureProjectForJob: async () => {} },
    "@/lib/factory/reviewVideo": { deleteReviewVideo: async () => {} },
    "@/lib/factory/mask": { maskSecrets: (v) => v },
    "@/lib/factory/toolBroker": serverBroker,
    "@/lib/factory/handoff": { cleanHandoff: () => null },
    "@/lib/factory/settings": { getDefaultClaudeModel: async () => null },
  });
  const at = new Date().toISOString();
  const withTools = jobs.parseReport({ jobId: "job1", toolRequests: [{ id: "r1", tool: "echo", status: "ok", at, ms: 1 }] });
  assert.equal(withTools.value.toolRequests.length, 1);
  assert.equal(jobs.parseReport({ jobId: "job1" }).value.toolRequests, null);
});
