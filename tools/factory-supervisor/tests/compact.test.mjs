// 작업 후 컨텍스트 정리(compact.mjs) 시험. 실제 Claude 는 실행하지 않고 node 로 만든 가짜 CLI 를 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { compactDecision, compactEnvEnabled, compactSession } from "../compact.mjs";
import { invocation } from "../ai-runner.mjs";

const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0;
const SESSION = "0076d560-76c7-4d46-8ae6-68bc15cf3da4";
const SECRET_TEXT = "세션 요약 비밀 내용 sk-abcdefghijklmnopqrstuv";

// 가짜 CLI: stdin 을 받아 두고 이벤트를 찍는다. 받은 stdin 은 파일에 남겨 확인한다
function fakeStart(t, events, { exitCode = 0, hang = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-compact-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, "fake.mjs");
  const stdinFile = path.join(dir, "stdin.txt");
  fs.writeFileSync(
    script,
    `import fs from "node:fs"; let s = ""; process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => { fs.writeFileSync(${JSON.stringify(stdinFile)}, s); for (const e of ${JSON.stringify(events)}) console.log(JSON.stringify(e)); ${hang ? "setInterval(() => {}, 1000);" : `process.exitCode = ${exitCode};`} });`,
  );
  const calls = [];
  const start = (engine, cfg, options) => {
    calls.push({ engine, options });
    return spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  };
  return { start, calls, stdin: () => fs.readFileSync(stdinFile, "utf8") };
}
const SUCCESS = [
  { type: "system", subtype: "status", status: "compacting", session_id: SESSION },
  { type: "system", subtype: "status", status: null, compact_result: "success", session_id: SESSION },
  { type: "system", subtype: "compact_boundary", session_id: SESSION, compact_metadata: { trigger: "manual", pre_tokens: 32584, post_tokens: 2679 } },
  { type: "user", message: { role: "user", content: SECRET_TEXT } },
  { type: "result", is_error: false, num_turns: 0, session_id: SESSION },
];

test("성공: /compact 를 stdin 으로 같은 세션에 보내고 완료 한 줄만 남긴다", { skip: !canSpawn && "host sandbox blocks child processes" }, async (t) => {
  const f = fakeStart(t, SUCCESS);
  const r = await compactSession({ engine: "claude", sessionId: SESSION, reusable: true, cwd: os.tmpdir(), env: {}, start: f.start });
  assert.deepEqual(r, { status: "done", line: "컨텍스트 정리(/compact) 완료" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].engine, "claude");
  assert.equal(f.calls[0].options.sessionId, SESSION);
  assert.equal(f.stdin(), "/compact");
  assert.ok(!r.line.includes("비밀"));
});

test("실패: Claude 오류·정리 결과 없음·비정상 종료는 실패로 기록하고 던지지 않는다", { skip: !canSpawn && "host sandbox blocks child processes" }, async (t) => {
  const err = await compactSession({ engine: "claude", sessionId: SESSION, reusable: true, env: {}, start: fakeStart(t, [{ type: "result", subtype: "error_during_execution", is_error: true, result: SECRET_TEXT }], { exitCode: 1 }).start });
  assert.equal(err.status, "failed");
  assert.match(err.line, /^컨텍스트 정리 건너뜀: 실패/);
  assert.ok(!err.line.includes("비밀") && !err.line.includes("sk-"));
  const none = await compactSession({ engine: "claude", sessionId: SESSION, reusable: true, env: {}, start: fakeStart(t, [{ type: "result", is_error: false }]).start });
  assert.equal(none.status, "failed");
  const badResult = await compactSession({ engine: "claude", sessionId: SESSION, reusable: true, env: {}, start: fakeStart(t, [{ type: "system", subtype: "status", compact_result: "failed" }, { type: "result", is_error: false }]).start });
  assert.equal(badResult.status, "failed");
  const badExit = await compactSession({ engine: "claude", sessionId: SESSION, reusable: true, env: {}, start: fakeStart(t, SUCCESS, { exitCode: 3 }).start });
  assert.equal(badExit.status, "failed");
  const throws = await compactSession({ engine: "claude", sessionId: SESSION, reusable: true, env: {}, start: () => { throw new Error("spawn 실패"); } });
  assert.equal(throws.status, "failed");
});

test("시간 초과: 멈춘 프로세스를 정리하고 건너뜀으로 기록한다", { skip: !canSpawn && "host sandbox blocks child processes" }, async (t) => {
  const f = fakeStart(t, [{ type: "system", subtype: "status", status: "compacting" }], { hang: true });
  let stopped = null;
  const r = await compactSession({ engine: "claude", sessionId: SESSION, reusable: true, env: {}, start: f.start, timeoutMs: 300, stop: (c) => { stopped = c; c.kill(); } });
  assert.equal(r.status, "timeout");
  assert.match(r.line, /^컨텍스트 정리 건너뜀: 시간 초과/);
  assert.ok(stopped);
  await new Promise((res) => (stopped.exitCode !== null || stopped.signalCode !== null ? res() : stopped.on("close", res)));
});

test("Codex·새 세션·꺼짐·세션 없음은 CLI 를 실행하지 않고 건너뛴다", async () => {
  const start = () => assert.fail("실행하면 안 돼요");
  const codex = await compactSession({ engine: "codex", sessionId: SESSION, reusable: true, env: {}, start });
  assert.equal(codex.status, "skipped"); assert.match(codex.line, /Codex/);
  const fresh = await compactSession({ engine: "claude", sessionId: SESSION, reusable: false, env: {}, start });
  assert.equal(fresh.status, "skipped"); assert.match(fresh.line, /새 세션/);
  const off = await compactSession({ engine: "claude", sessionId: SESSION, reusable: true, enabled: false, env: {}, start });
  assert.equal(off.status, "skipped"); assert.match(off.line, /통제실/);
  const envOff = await compactSession({ engine: "claude", sessionId: SESSION, reusable: true, env: { FACTORY_COMPACT_AFTER_JOB: "0" }, start });
  assert.equal(envOff.status, "skipped"); assert.match(envOff.line, /FACTORY_COMPACT_AFTER_JOB/);
  const noSession = await compactSession({ engine: "claude", sessionId: null, reusable: true, env: {}, start });
  assert.equal(noSession.status, "skipped");
  const badSession = compactDecision({ engine: "claude", sessionId: "../x; rm", reusable: true, env: {} });
  assert.equal(badSession.run, false);
});

test("환경변수 기본값은 켜짐, 0·false·off·no 는 꺼짐", () => {
  assert.equal(compactEnvEnabled({}), true);
  assert.equal(compactEnvEnabled({ FACTORY_COMPACT_AFTER_JOB: "1" }), true);
  for (const v of ["0", "false", "OFF", "no"]) assert.equal(compactEnvEnabled({ FACTORY_COMPACT_AFTER_JOB: v }), false);
});

test("실제 실행 인자는 기존 Claude 호출과 같고 --resume 으로 그 세션을 이어받는다", () => {
  const { args } = invocation("claude", {}, { sessionId: SESSION, settings: "policy.json" });
  assert.deepEqual(args.slice(0, 4), ["-p", "--output-format", "stream-json", "--verbose"]);
  assert.equal(args[args.indexOf("--resume") + 1], SESSION);
  assert.ok(!args.includes("--dangerously-skip-permissions"));
});
