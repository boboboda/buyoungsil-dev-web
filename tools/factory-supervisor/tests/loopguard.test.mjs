// 일감 시간 낭비 막기(1-3) 순수 부분 시험: 명령 분류·반복 판정(경고 → 막힘)·설정 정리·스크린샷 시간 상한·원본 이벤트에서 명령 뽑기.
// 실행: node tools/factory-supervisor/tests/loopguard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { LOOPGUARD_DEFAULTS, changedCount, classifyCommand, cleanLoopGuard, commandEvents, createLoopGuard, normalizeCommand, resultSignature, screenshotBudget, snapshotWorkdir } from "../loopguard.mjs";

const snap = (o) => new Map(Object.entries(o));
const E2E = "npx playwright test e2e/stone-tower.spec.ts --reporter=line";

test("설정 정리: 기본값 · 범위 안으로 · 이상한 값은 기본값", () => {
  assert.deepEqual(cleanLoopGuard(undefined), { ...LOOPGUARD_DEFAULTS });
  assert.deepEqual(LOOPGUARD_DEFAULTS, { enabled: true, repeatMax: 3, judge: "any", minChangedFiles: 2, screenshotMaxMin: 15 });
  assert.equal(cleanLoopGuard({ repeatMax: 100 }).repeatMax, 20);
  assert.equal(cleanLoopGuard({ repeatMax: 0 }).repeatMax, 2);
  assert.equal(cleanLoopGuard({ screenshotMaxMin: "30" }).screenshotMaxMin, 30);
  assert.equal(cleanLoopGuard({ screenshotMaxMin: "abc" }).screenshotMaxMin, 15);
  assert.equal(cleanLoopGuard({ judge: "nope" }).judge, "any");
  assert.equal(cleanLoopGuard({ judge: "count" }).judge, "count");
  assert.equal(cleanLoopGuard({ enabled: false }).enabled, false);
  assert.equal(cleanLoopGuard({ enabled: "no" }).enabled, true);
});

test("명령 분류: e2e·스크린샷·측정은 heavy, 빌드·린트·시험은 light, 나머지는 감시 안 함", () => {
  assert.equal(classifyCommand(E2E).kind, "e2e");
  assert.equal(classifyCommand("node scripts/screenshots.mjs --all").kind, "screenshot");
  assert.equal(classifyCommand("node scripts/measure-seed.mjs --seeds 30 --len 60").kind, "measure");
  assert.equal(classifyCommand("python simulate_distribution.py").kind, "measure");
  assert.equal(classifyCommand("npm run test:e2e").kind, "e2e");
  assert.equal(classifyCommand("npm run build").heavy, false);
  assert.equal(classifyCommand("flutter analyze").kind, "build");
  assert.equal(classifyCommand("./gradlew assembleDebug").kind, "build");
  for (const c of ["ls -la", "git status", "cat package.json", "node scripts/fix-data.mjs", "echo hi"]) assert.equal(classifyCommand(c), null, c);
});

test("명령 정리: cd·환경변수 앞부분, 파이프 뒤, 리다이렉션을 빼서 같은 명령을 같게 본다", () => {
  const a = classifyCommand(`cd /app && ${E2E} 2>&1 | tail -n 30`);
  const b = classifyCommand(`CI=1 ${E2E}`);
  const c = classifyCommand(`${E2E}   > out.log 2>&1`);
  assert.equal(a.key, E2E);
  assert.equal(b.key, E2E);
  assert.equal(c.key, E2E);
  assert.equal(normalizeCommand("  npm   run   build  "), "npm run build");
  assert.notEqual(classifyCommand("node scripts/measure.mjs --seed 1").key, classifyCommand("node scripts/measure.mjs --seed 2").key, "인자가 다르면 다른 명령");
});

test("결과 서명: 시간·색깔 코드만 다른 결과는 같다고 본다", () => {
  assert.equal(resultSignature("30 passed (41.2s)"), resultSignature("30 passed (39.8s)"));
  assert.equal(resultSignature("\x1b[32m30 passed\x1b[0m (12s)"), resultSignature("30 passed (3s)"));
  assert.notEqual(resultSignature("30 passed"), resultSignature("2 failed, 28 passed"));
});

test("바뀐 파일 수: 서명이 달라졌거나 생기거나 사라진 파일을 센다", () => {
  assert.equal(changedCount(snap({ a: "1", b: "1" }), snap({ a: "1", b: "1" })), 0);
  assert.equal(changedCount(snap({ a: "1", b: "1" }), snap({ a: "2", b: "1", c: "9" })), 2);
  assert.equal(changedCount(snap({ a: "1", b: "1" }), snap({ a: "1" })), 1);
  assert.equal(changedCount(null, snap({ a: "1" })), Infinity, "비교할 수 없으면 많이 바뀐 것으로(경고하지 않는 쪽)");
});

function runs(g, n, { command = E2E, out = () => "30 passed", snapAt = () => snap({ a: "1" }) } = {}) {
  const verdicts = [];
  for (let i = 1; i <= n; i++) {
    verdicts.push(g.start(`id${i}`, command, () => snapAt(i)));
    g.end(`id${i}`, out(i));
  }
  return verdicts;
}

test("반복 감지: 같은 e2e 가 3번까지는 괜찮고 4번째에 결과가 같으면 경고, 그 뒤 또 반복하면 막힘", () => {
  const g = createLoopGuard({});
  const v = runs(g, 4);
  assert.deepEqual(v.slice(0, 3).map((x) => x.action), ["ok", "ok", "ok"]);
  assert.equal(v[3].action, "warn");
  assert.match(v[3].why, /e2e/);
  assert.equal(g.warned(), true);
  assert.equal(g.start("id5", E2E, () => snap({ a: "1" })).action, "block", "경고 뒤에도 같은 시험 → 막힘");
});

test("반복 감지: 그 사이 바뀐 파일이 많고 결과도 다르면 경고하지 않는다", () => {
  const g = createLoopGuard({});
  const v = runs(g, 6, { out: (i) => `${i} failed`, snapAt: (i) => snap({ a: `s${i}`, b: `s${i}`, c: `s${i}`, d: `s${i}` }) });
  assert.deepEqual(v.map((x) => x.action), Array(6).fill("ok"));
});

test("반복 감지: 결과는 다른데 바뀐 파일이 적으면 경고(기본 판정), '결과가 같을 때만' 판정이면 경고 안 함", () => {
  const out = (i) => `${i} failed`;
  const few = (i) => snap({ a: `s${i}` });
  assert.equal(runs(createLoopGuard({}), 4, { out, snapAt: few })[3].action, "warn");
  assert.equal(runs(createLoopGuard({ judge: "result" }), 4, { out, snapAt: few })[3].action, "ok");
  assert.equal(runs(createLoopGuard({ judge: "result" }), 4)[3].action, "warn", "결과가 같으면 경고");
  assert.equal(runs(createLoopGuard({ judge: "count" }), 4, { out, snapAt: (i) => snap({ a: `s${i}`, b: `s${i}`, c: `s${i}`, d: `s${i}` }) })[3].action, "warn", "횟수만 보는 판정");
});

test("반복 감지: 횟수 기준을 바꾸면(5회) 5번째까지 괜찮고 6번째에 경고, 끄면 아무 일 없다", () => {
  assert.deepEqual(runs(createLoopGuard({ repeatMax: 5 }), 6).map((x) => x.action), ["ok", "ok", "ok", "ok", "ok", "warn"]);
  assert.deepEqual(runs(createLoopGuard({ enabled: false }), 8).map((x) => x.action), Array(8).fill("ok"));
});

test("반복 감지: 빌드·린트 같은 가벼운 명령은 기준이 두 배(7번째)이고 결과가 같을 때만 본다", () => {
  const few = (i) => snap({ a: `s${i}` });
  const v = runs(createLoopGuard({}), 7, { command: "npm run build", out: (i) => `error ${i}`, snapAt: few });
  assert.deepEqual(v.map((x) => x.action), Array(7).fill("ok"), "고치면서 다시 빌드하는 건 정상(결과가 매번 다름)");
  const w = runs(createLoopGuard({}), 7, { command: "npm run build" });
  assert.equal(w[6].action, "warn");
  assert.deepEqual(w.slice(0, 6).map((x) => x.action), Array(6).fill("ok"));
});

test("반복 감지: 다른 명령끼리는 횟수를 따로 센다", () => {
  const g = createLoopGuard({});
  const verdicts = [];
  for (let i = 1; i <= 3; i++) {
    verdicts.push(g.start(`a${i}`, E2E, () => snap({ a: "1" })).action, g.start(`b${i}`, "node scripts/screenshots.mjs", () => snap({ a: "1" })).action);
    g.end(`a${i}`, "ok");
    g.end(`b${i}`, "ok");
  }
  assert.deepEqual(verdicts, Array(6).fill("ok"));
});

test("원본 이벤트에서 명령 뽑기: Claude(tool_use ↔ tool_result) / Codex(command_execution)", () => {
  const claudeStart = { type: "assistant", message: { content: [{ type: "text", text: "x" }, { type: "tool_use", id: "t1", name: "Bash", input: { command: E2E } }, { type: "tool_use", id: "t2", name: "Read", input: {} }] } };
  assert.deepEqual(commandEvents("claude", claudeStart), [{ type: "start", id: "t1", command: E2E }]);
  assert.deepEqual(commandEvents("claude", { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "30 passed" }] } }), [{ type: "end", id: "t1", output: "30 passed" }]);
  assert.deepEqual(commandEvents("claude", { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }] } }), [{ type: "end", id: "t1", output: "a\nb" }]);
  assert.deepEqual(commandEvents("codex", { type: "item.started", item: { id: "c1", type: "command_execution", command: E2E } }), [{ type: "start", id: "c1", command: E2E }]);
  assert.deepEqual(commandEvents("codex", { type: "item.completed", item: { id: "c1", type: "command_execution", aggregated_output: "ok" } }), [{ type: "end", id: "c1", output: "ok" }]);
  assert.deepEqual(commandEvents("codex", { type: "item.completed", item: { id: "m", type: "agent_message", text: "hi" } }), []);
  assert.deepEqual(commandEvents("claude", null), []);
});

test("스크린샷 시간 상한: 단계에 들어간 때부터 15분, 넘으면 한 번만", () => {
  const t0 = 1_000_000;
  const base = { phase: "screenshots", enteredAt: t0, maxMin: 15, done: false };
  assert.equal(screenshotBudget({ ...base, now: t0 + 14 * 60_000 }).state, "within");
  assert.equal(screenshotBudget({ ...base, now: t0 + 15 * 60_000 }).state, "over");
  assert.equal(screenshotBudget({ ...base, now: t0 + 20 * 60_000, done: true }).state, "done", "이미 넘겼으면 다시 알리지 않는다");
  assert.equal(screenshotBudget({ ...base, phase: "code", now: t0 + 99 * 60_000 }).state, "idle", "다른 단계는 대상 아님");
  assert.equal(screenshotBudget({ ...base, enteredAt: null, now: t0 + 99 * 60_000 }).state, "idle");
  assert.equal(screenshotBudget({ ...base, maxMin: 30, now: t0 + 20 * 60_000 }).state, "within", "상한은 설정으로 바꾼다");
});

test("작업 폴더 스냅샷: 바뀐 파일만 보고 .factory/ 는 뺀다", { skip: spawnSync("git", ["--version"]).status !== 0 && "git 없음" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lg-snap-"));
  const g = (...a) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@l", ...a], { cwd: dir, encoding: "utf8" });
  g("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), "1");
  g("add", "-A");
  g("commit", "-q", "-m", "i");
  const s0 = snapshotWorkdir(dir);
  assert.equal(s0.size, 0);
  fs.writeFileSync(path.join(dir, "a.txt"), "22");
  fs.writeFileSync(path.join(dir, "b.txt"), "x");
  fs.mkdirSync(path.join(dir, ".factory"));
  fs.writeFileSync(path.join(dir, ".factory", "phase.txt"), "code");
  const s1 = snapshotWorkdir(dir);
  assert.deepEqual([...s1.keys()].sort(), ["a.txt", "b.txt"]);
  assert.equal(changedCount(s0, s1), 2);
  assert.equal(snapshotWorkdir(path.join(dir, "nope")), null);
});
