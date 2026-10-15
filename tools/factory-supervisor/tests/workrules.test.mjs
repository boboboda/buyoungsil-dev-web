// 일감 효율 규칙 시험: 규칙 문구가 일감·정비·재개 프롬프트에 들어가는지, 횟수 집계(가짜 세션 기록)가 맞는지.
// 실행: node tools/factory-supervisor/tests/workrules.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { WORK_LIMITS, WORK_RULES, classifyWork, createWorkCounter, overLimitReason } from "../workrules.mjs";
import { handoffPrompt } from "../ai-runner.mjs";
import { RESUME_MESSAGE } from "../pause.mjs";
import { commandEvents } from "../loopguard.mjs";

test("규칙 문구: 스크린샷·정적 검사·전체 시험·같은 실패·상한 초과 기록이 모두 있다", () => {
  for (const w of ["변경 전 1장·변경 후 1장", "0장", "최대 4회", "마지막 1회는 생략", "각각 최대 2회", "최대 8회", "한 명령에 묶지", "2번 실패", "상한 초과: 이유"]) assert.ok(WORK_RULES.includes(w), w);
});

test("프롬프트: 일감(앱)·정비 첫 프롬프트와 재개 메시지에 규칙이 들어간다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wr-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir });
    for (const appScope of [false, true]) {
      const p = handoffPrompt(dir, "지시문", { appScope });
      assert.ok(p.includes(WORK_RULES), `appScope=${appScope}`);
      assert.ok(p.indexOf(WORK_RULES) < p.indexOf("아래 이전 결과는"));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.ok(RESUME_MESSAGE.includes("정적 검사 최대 4회") && RESUME_MESSAGE.includes("같은 실패 2번"));
});

test("명령 분류", () => {
  assert.deepEqual(classifyWork("cd app && npx tsc --noEmit -p ."), ["static"]);
  assert.deepEqual(classifyWork("npm run lint"), ["static"]);
  assert.deepEqual(classifyWork("flutter analyze"), ["static"]);
  assert.deepEqual(classifyWork("npm run build"), ["build"]);
  assert.deepEqual(classifyWork("flutter build apk"), ["build"]);
  assert.deepEqual(classifyWork("npm test"), ["fullTest"]);
  assert.deepEqual(classifyWork("flutter test"), ["fullTest"]);
  assert.deepEqual(classifyWork("flutter test test/a_test.dart"), ["partialTest"]);
  assert.deepEqual(classifyWork("node --test tests/a.test.mjs"), ["partialTest"]);
  assert.deepEqual(classifyWork("npx vitest run src/a.test.ts"), ["partialTest"]);
  assert.deepEqual(classifyWork("npx playwright test e2e/a.spec.ts"), ["screenshot"]);
  assert.deepEqual(classifyWork("node scripts/screenshots.mjs"), ["screenshot"]);
  assert.deepEqual(classifyWork("npm run build && npm test"), ["build", "fullTest"]);
  for (const c of ["ls", "git status", "cat tsc.log", "grep tsc a.txt", "node --check a.mjs", "echo 상한 초과: 이유"]) assert.deepEqual(classifyWork(c), [], c);
});

const bash = (id, command) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });

test("횟수 집계(가짜 세션 기록): 상한 안이면 횟수만, 넘으면 '상한 초과' + 이유", () => {
  const c = createWorkCounter();
  assert.equal(c.summary(), null);
  const cmds = ["npx tsc --noEmit", "npm run build", "npm test", "node --test tests/a.test.mjs", "node --test tests/a.test.mjs", "ls"];
  cmds.forEach((cmd, i) => c.feed(commandEvents("claude", bash(`t${i}`, cmd))));
  assert.deepEqual(c.counts, { static: 1, build: 1, fullTest: 1, partialTest: 2, screenshot: 0 });
  assert.equal(c.summary(), "작업 횟수: 정적 검사 1 · 빌드 1 · 전체 시험 1 · 부분 시험 2 · 스크린샷 0");
  assert.deepEqual(c.over(), []);
  for (let i = 0; i < WORK_LIMITS.static; i++) c.feed(commandEvents("claude", bash(`s${i}`, "npx tsc")));
  assert.deepEqual(c.over(), ["static"]);
  assert.match(c.summary(), /\n상한 초과: 정적 검사 5회\(상한 4\) — 이유 기록 없음$/);
  c.feed(commandEvents("claude", bash("r", 'echo "상한 초과: 타입 오류가 계속 남아서"')));
  assert.match(c.summary(), /상한 초과: 정적 검사 5회\(상한 4\) — 이유: 타입 오류가 계속 남아서$/);
});

test("Codex 이벤트도 같은 방식으로 센다 · 상한 초과 이유 파싱", () => {
  const c = createWorkCounter();
  c.feed(commandEvents("codex", { type: "item.started", item: { id: "1", type: "command_execution", command: "npm run build" } }));
  c.feed(commandEvents("codex", { type: "item.completed", item: { id: "1", type: "command_execution", aggregated_output: "ok" } }));
  assert.equal(c.counts.build, 1);
  assert.equal(overLimitReason("echo '상한 초과: 이유 하나'"), "이유 하나");
  assert.equal(overLimitReason("npm test"), null);
});
