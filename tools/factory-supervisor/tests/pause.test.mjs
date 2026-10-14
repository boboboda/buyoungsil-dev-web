// 감독 프로그램 업데이트 때 "잠깐 멈췄다가 이어서"(1-2 D-2)의 순수한 부분과 멈춤 조정자 시험.
// 진짜 AI·감독·홈페이지는 쓰지 않는다(가짜 프로세스 객체와 가짜 시계만).
// 실행: node tools/factory-supervisor/tests/pause.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { invocation } from "../ai-runner.mjs";
import {
  BUNDLE_DEFAULT_MIN,
  LONG_COMMAND_MS,
  RESUME_MESSAGE,
  bundleDecision,
  bundleMinutes,
  clearSavedState,
  createPauser,
  createToolTracker,
  pauseDecision,
  readSavedState,
  resumeFailed,
  writeSavedState,
} from "../pause.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pause-unit-"));
const use = (id, name, input = {}) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const done = (id) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });

test("이어 줄 때 하는 말은 지시한 그대로다", () => {
  assert.equal(RESUME_MESSAGE, "공장 업데이트로 잠시 멈췄다. 파일은 그대로다. 멈추기 직전 명령이 끊겼다면 다시 실행하고 이어서 진행해.");
});

test("도구 호출 추적(Claude): 시작·끝을 짝지어 끝나지 않은 호출만 센다", () => {
  let t = 1000;
  const k = createToolTracker("claude", () => t);
  assert.equal(k.openCount(), 0);
  k.feed(use("a", "Bash", { command: "npm test" }));
  k.feed(use("b", "Read", { file_path: "x" }));
  assert.equal(k.openCount(), 2);
  k.feed(done("a"));
  assert.equal(k.openCount(), 1);
  k.feed({ type: "result", result: "끝" });
  assert.equal(k.openCount(), 0, "결과가 나오면 남은 호출은 없다");
  assert.ok(k.events() >= 2);
});

test("남은 시간 추정: Bash 는 제한(timeout, 기본 2분)에서 지난 시간을 뺀다. 백그라운드는 바로 끝난 것. 모르는 도구는 null", () => {
  let t = 0;
  const k = createToolTracker("claude", () => t);
  k.feed(use("a", "Bash", { command: "x" }));
  k.feed(use("b", "Bash", { command: "y", timeout: 600_000 }));
  k.feed(use("c", "Bash", { command: "z", run_in_background: true }));
  k.feed(use("d", "Task", {}));
  t = 30_000;
  assert.deepEqual(k.remaining(), [90_000, 570_000, 0, null]);
});

test("멈출 때 판단: 호출이 없으면 바로, 남은 명령이 5분을 넘으면 바로 끊고, 모르면 5분 기다린 뒤 끊는다", () => {
  let t = 0;
  const k = createToolTracker("claude", () => t);
  assert.deepEqual(pauseDecision(k, 0), { action: "pause", reason: "safe" });

  k.feed(use("a", "Bash", { command: "git status" }));
  assert.equal(pauseDecision(k, 0).action, "wait", "짧은 명령은 끝나길 기다린다");
  k.feed(done("a"));
  assert.equal(pauseDecision(k, 0).reason, "safe");

  k.feed(use("b", "Bash", { command: "gradle build", timeout: 600_000 }));
  const long = pauseDecision(k, 0);
  assert.equal(long.action, "pause");
  assert.equal(long.reason, "long-command", "남은 명령이 5분을 넘을 것 같으면 그 명령을 끊는다");
  assert.match(long.cut[0], /gradle build/);
  k.feed(done("b"));

  k.feed(use("c", "Task", {}));
  assert.equal(pauseDecision(k, LONG_COMMAND_MS - 1).action, "wait", "얼마나 걸릴지 모르는 호출은 5분까지 기다린다");
  assert.equal(pauseDecision(k, LONG_COMMAND_MS).reason, "waited-too-long");
});

test("도구 호출 추적(Codex): item.started ↔ item.completed", () => {
  const k = createToolTracker("codex", () => 0);
  k.feed({ type: "thread.started", thread_id: "t" });
  k.feed({ type: "item.started", item: { id: "i1", type: "command_execution", command: "npm test" } });
  assert.equal(k.openCount(), 1);
  assert.deepEqual(k.describe(), ["Bash: npm test"]);
  k.feed({ type: "item.completed", item: { id: "i1", type: "command_execution" } });
  assert.equal(k.openCount(), 0);
  k.feed({ type: "item.started", item: { id: "i2", type: "reasoning" } });
  assert.equal(k.openCount(), 0, "생각 중인 항목은 멈추지 못할 호출이 아니다");
});

test("Codex 도 세션을 이어 갈 수 있다: exec resume <세션> 으로 실행 인자가 만들어진다(Claude 는 --resume)", () => {
  const id = "01a13b6d-d676-7013-993a-a080b261a167";
  const c = invocation("codex", {}, { sessionId: id });
  assert.deepEqual(c.args.slice(0, 2), ["exec", "resume"]);
  assert.equal(c.args.at(-1), "-");
  assert.equal(c.args.at(-2), id);
  const cl = invocation("claude", {}, { sessionId: id });
  assert.ok(cl.args.join(" ").includes(`--resume ${id}`));
  assert.throws(() => invocation("claude", {}, { sessionId: "x; rm -rf" }));
});

test("이어서 하기 실패 판정: 이어 준 프로세스가 짧게 살다가 아무 일도 못 하고 오류로 끝났을 때만", () => {
  const base = { resumed: true, events: 0, result: null, code: 1, ms: 3000, stopped: false };
  assert.equal(resumeFailed(base), true, "세션을 못 찾아 바로 종료");
  assert.equal(resumeFailed({ ...base, result: { is_error: true, result: "No conversation found" } }), true);
  assert.equal(resumeFailed({ ...base, resumed: false }), false, "이어 준 게 아니면 일반 실패");
  assert.equal(resumeFailed({ ...base, events: 2 }), false, "일을 시작했다면 이어서 한 것");
  assert.equal(resumeFailed({ ...base, result: { is_error: false, result: "완료" }, code: 0 }), false);
  assert.equal(resumeFailed({ ...base, ms: 5 * 60_000 }), false, "오래 돌았으면 실패가 아니라 중간에 죽은 것");
  assert.equal(resumeFailed({ ...base, stopped: true }), false);
});

test("상태 파일: 저장→읽기, 너무 오래되면 이어 주지 않고 따로 알린다", () => {
  const dir = tmp();
  const file = path.join(dir, "paused.json");
  let now = Date.parse("2026-10-15T00:00:00Z");
  assert.deepEqual(readSavedState(file, () => now), { entries: [], stale: [] });
  const entry = { key: "app:J1", kind: "app", sessionId: "s1", dir: "/w/app", phase: "build", timeLeftMs: 120000, worktree: { wtDir: "/w/.worktrees/app-J1" } };
  writeSavedState(file, [entry], () => now);
  now += 5 * 60_000;
  const r = readSavedState(file, () => now);
  assert.equal(r.entries.length, 1);
  assert.deepEqual(r.entries[0], entry, "세션 id·작업 폴더(worktree 포함)·단계·남은 시간 한도가 저장된다");
  now += 40 * 60_000;
  const old = readSavedState(file, () => now);
  assert.equal(old.entries.length, 0);
  assert.equal(old.stale.length, 1);
  clearSavedState(file);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(readSavedState(file, () => now), { entries: [], stale: [] });
});

test("업데이트 묶기 판단: 공장이 비면 바로, 일감이 돌면 1시간 모음, 0분이면 바로, 지금 업데이트는 기다리지 않음", () => {
  const first = 1_000_000;
  const min = (m) => first + m * 60_000;
  // 비어 있다
  assert.deepEqual(bundleDecision({ firstSeenAt: first, now: first, bundleMin: 60, idle: true, forced: false }), { action: "now", reason: "idle" });
  // 일감이 돌고 있다: 처음 본 순간부터 60분 모은다
  const w = bundleDecision({ firstSeenAt: first, now: first, bundleMin: 60, idle: false, forced: false });
  assert.equal(w.action, "wait");
  assert.equal(w.leftMin, 60);
  assert.equal(bundleDecision({ firstSeenAt: first, now: min(25), bundleMin: 60, idle: false, forced: false }).leftMin, 35);
  assert.equal(bundleDecision({ firstSeenAt: first, now: min(59.5), bundleMin: 60, idle: false, forced: false }).leftMin, 1);
  assert.deepEqual(bundleDecision({ firstSeenAt: first, now: min(60), bundleMin: 60, idle: false, forced: false }), { action: "now", reason: "bundle-elapsed" });
  // 모으는 중에 공장이 비면 그 순간 바로
  assert.equal(bundleDecision({ firstSeenAt: first, now: min(10), bundleMin: 60, idle: true, forced: false }).action, "now");
  // 0분이면 일감이 돌아도 바로
  assert.deepEqual(bundleDecision({ firstSeenAt: first, now: first, bundleMin: 0, idle: false, forced: false }), { action: "now", reason: "no-bundle" });
  // 지금 업데이트는 기다리지 않는다
  assert.deepEqual(bundleDecision({ firstSeenAt: first, now: first, bundleMin: 180, idle: false, forced: true }), { action: "now", reason: "forced" });
  // 설정 범위 0~180, 이상한 값은 기본 60
  assert.equal(bundleMinutes(200), 180);
  assert.equal(bundleMinutes(-5), 0);
  assert.equal(bundleMinutes(undefined), BUNDLE_DEFAULT_MIN);
  assert.equal(bundleMinutes("abc"), BUNDLE_DEFAULT_MIN);
  assert.equal(bundleMinutes("30"), 30);
});

// ───────── 멈춤 조정자 ─────────
function fakeChild() {
  return { killed: false };
}
function setup(over = {}) {
  const dir = tmp();
  let t = 0;
  const logs = [];
  const pauser = createPauser({ now: () => t, log: (m) => logs.push(m), stateFile: path.join(dir, "paused.json") });
  const mk = (key, opts = {}) => {
    const child = fakeChild();
    const unit = pauser.createUnit({ key, kind: "app", label: `[${key}]`, snapshot: () => ({ jobId: key, sessionId: `sess-${key}`, dir: `/w/${key}`, phase: "build", timeLeftMs: 100_000 }), ...opts, ...over });
    unit.attach(child, () => { child.killed = true; });
    return { unit, child };
  };
  return { pauser, mk, logs, setNow: (v) => { t = v; }, dir };
}

test("멈춤: 안전한 지점(명령이 끝난 직후)에서만 AI 를 끊고, 그전에는 기다린다", () => {
  const { pauser, mk } = setup();
  const a = mk("A");
  a.unit.feed(use("t1", "Bash", { command: "npm test" }));
  assert.equal(pauser.softCount(), 1);
  pauser.requestPause();
  assert.equal(a.child.killed, false, "명령이 도는 중이면 끊지 않는다");
  assert.equal(pauser.pausedCount(), 0);
  a.unit.feed(done("t1"));
  pauser.tick();
  assert.equal(a.child.killed, true, "명령이 끝난 직후 멈춘다");
  assert.equal(a.unit.paused, true);
  assert.equal(pauser.pausedCount(), 1);
  assert.equal(pauser.softCount(), 0);
});

test("긴 명령은 끊고 멈춘다(재개 후 다시 실행하게): 남은 시간이 5분을 넘으면 바로, 모르면 5분 뒤", () => {
  const { pauser, mk, setNow, logs } = setup();
  const cuts = [];
  const a = mk("A", { onCut: (c) => cuts.push(...c) });
  const b = mk("B");
  a.unit.feed(use("t1", "Bash", { command: "gradle assembleRelease", timeout: 600_000 }));
  b.unit.feed(use("t2", "Task", {}));
  pauser.requestPause();
  assert.equal(a.child.killed, true, "남은 명령이 5분을 넘을 것 같아 바로 끊었다");
  assert.match(cuts[0], /gradle assembleRelease/);
  assert.ok(logs.some((l) => /끝나지 않은 명령을 끊고 멈췄어요/.test(l)));
  assert.equal(b.child.killed, false, "얼마나 걸릴지 모르는 호출은 기다린다");
  setNow(LONG_COMMAND_MS + 1000);
  pauser.tick();
  assert.equal(b.child.killed, true, "멈추라고 한 지 5분이 지나면 끊는다");
  assert.equal(pauser.pausedCount(), 2);
});

test("합치기 잠금 안(hold)이면 풀릴 때까지 멈추지 않는다", () => {
  let merging = true;
  const { pauser, mk } = setup();
  const a = mk("A", { hold: () => merging });
  assert.equal(pauser.softCount(), 0, "합치는 중인 일감은 멈출 수 있는 것으로 세지 않는다");
  pauser.requestPause();
  assert.equal(a.child.killed, false);
  merging = false;
  assert.equal(pauser.softCount(), 1);
  pauser.tick();
  assert.equal(a.child.killed, true, "잠금이 풀린 뒤 멈춘다");
});

test("멈추는 중에 AI 를 다시 띄우려는 단위는 gate 에서 기다리고, 이어 주면 풀린다", async () => {
  const { pauser, mk } = setup();
  const a = mk("A");
  pauser.requestPause();
  pauser.tick();
  assert.equal(a.unit.paused, true);
  a.unit.detach();
  let passed = false;
  const g = pauser.gate(a.unit).then(() => (passed = true));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(passed, false, "멈추는 동안 gate 는 열리지 않는다");
  assert.equal(a.unit.state, "parked");
  assert.equal(pauser.pausedCount(), 1);
  assert.equal(pauser.resumeAll(), 1);
  await g;
  assert.equal(passed, true);
  assert.equal(pauser.mode(), "running");
  assert.equal(pauser.pausedCount(), 0);
  // 멈춤이 아니면 gate 는 바로 지나간다
  await pauser.gate(a.unit);
});

test("저장: 멈춘 단위만 세션 id·작업 폴더·단계·남은 시간과 함께 파일에 남는다", () => {
  const { pauser, mk, dir } = setup();
  const a = mk("A");
  const b = mk("B");
  b.unit.hold = () => true; // 합치는 중이라 멈추지 못한 일감
  pauser.requestPause();
  pauser.tick();
  const saved = pauser.persist();
  assert.equal(saved.length, 1);
  assert.deepEqual({ key: saved[0].key, sessionId: saved[0].sessionId, dir: saved[0].dir, phase: saved[0].phase, timeLeftMs: saved[0].timeLeftMs }, { key: "A", sessionId: "sess-A", dir: "/w/A", phase: "build", timeLeftMs: 100_000 });
  const file = JSON.parse(fs.readFileSync(path.join(dir, "paused.json"), "utf8"));
  assert.equal(file.entries.length, 1);
  assert.equal(a.child.killed && !b.child.killed, true);
  pauser.resumeAll();
  assert.equal(fs.existsSync(path.join(dir, "paused.json")), false, "이 프로세스에서 이어 주면 저장 기록은 지운다");
});

test("멈추라고 한 순간 이미 결과를 낸 턴은 멈춘 것으로 세지 않는다(resetPaused)", () => {
  const { pauser, mk } = setup();
  const a = mk("A");
  pauser.requestPause();
  pauser.tick();
  assert.equal(pauser.pausedCount(), 1);
  a.unit.resetPaused();
  assert.equal(pauser.pausedCount(), 0);
  assert.equal(a.unit.paused, false);
});
