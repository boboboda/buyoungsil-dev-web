// 5-2 시험(감독 프로그램 쪽): 실패 단계부터 다시 — 세션 기억·이어서 하기 판단·대체 동작(기존 재실행)
//  - 실패한 일감의 세션을 작업 폴더에 기억하고, 단계부터 다시 요청이 오면 같은 세션으로 짧은 지시를 넣어 이어서 한다
//  - 세션·폴더가 없거나, AI 가 다르거나, 너무 오래됐거나, 병행(작업 사본)이면 처음부터 다시 하는 기존 재실행으로 대신한다
//  - supervisor.mjs 연결: 실패할 때 기억 / 이어서 하기가 바로 실패하면 처음부터 / 출시·업데이트 이어받기와 섞이지 않음
// 진짜 AI·서버는 쓰지 않는다(임시 폴더). 실행: node tools/factory-supervisor/tests/stageresume.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decideStageResume, readSession, saveSession, sessionFile, stageMessage, SESSION_MAX_AGE_MS } from "../stageresume.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(HERE, "..", name), "utf8").replace(/\r\n/g, "\n");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "stageresume-"));
const SESSION = "11111111-2222-3333-4444-555555555555";
const job = (extra = {}) => ({ id: "job1", kind: "revision", aiEngine: "claude", stageResume: { from: "check", label: "검사", note: "필수 검증 실패: 타입 오류" }, ...extra });

test("세션 기억: 저장하고 다시 읽는다. 세션 id 형식이 이상하면 저장하지 않는다(명령 끼워넣기 방지)", () => {
  const dir = tmp();

  assert.equal(saveSession(dir, { jobId: "job1", engine: "claude", sessionId: SESSION, stage: "check" }), true);
  const s = readSession(dir, "job1");

  assert.equal(s.sessionId, SESSION);
  assert.equal(s.engine, "claude");
  assert.equal(s.stage, "check");
  assert.ok(fs.existsSync(sessionFile(dir, "job1")));
  assert.equal(saveSession(dir, { jobId: "job2", engine: "claude", sessionId: "$(rm -rf /)" }), false);
  assert.equal(readSession(dir, "job2"), null);
  assert.equal(saveSession(dir, { jobId: "job3", engine: "claude", sessionId: "" }), false);
  assert.equal(saveSession("", { jobId: "job3", engine: "claude", sessionId: SESSION }), false);
  assert.ok(path.basename(sessionFile(dir, "../../etc/x")).indexOf("..") === -1, "일감 id 로 폴더 밖에 쓰지 못한다");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("단계부터 다시: 같은 세션이 있으면 resume, 지시는 단계 이름·오류를 담은 짧은 문장", () => {
  const dir = tmp();

  saveSession(dir, { jobId: "job1", engine: "claude", sessionId: SESSION, stage: "check" });
  const d = decideStageResume({ job: job(), dir });

  assert.equal(d.mode, "resume");
  assert.equal(d.sessionId, SESSION);
  assert.match(d.message, /'검사' 단계에서 실패/);
  assert.match(d.message, /타입 오류/);
  assert.match(d.message, /이 오류만 고치고/);
  assert.ok(d.message.length < 700, "짧은 지시");
  assert.ok(stageMessage("검사", "x".repeat(2000)).length < 900, "오류가 길어도 잘라서 넣는다");
  assert.equal(decideStageResume({ job: { id: "job1", kind: "revision", aiEngine: "claude" }, dir }), null, "단계부터 다시 요청이 없으면 아무것도 안 한다");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("대체 동작: 폴더·세션 기록이 없거나 맞지 않으면 처음부터(fresh) + 이유", () => {
  const dir = tmp();
  const now = Date.now();

  assert.equal(decideStageResume({ job: job(), dir: path.join(dir, "없는폴더") }).mode, "fresh");
  assert.match(decideStageResume({ job: job(), dir: path.join(dir, "없는폴더") }).reason, /작업 폴더가 이 PC 에 없어서/);
  assert.match(decideStageResume({ job: job(), dir }).reason, /세션 기록이 없어서/);
  saveSession(dir, { jobId: "job1", engine: "codex", sessionId: SESSION, stage: "check" });
  assert.match(decideStageResume({ job: job(), dir }).reason, /codex 것인데 지금은 claude/);
  saveSession(dir, { jobId: "job1", engine: "claude", sessionId: SESSION, stage: "check", now: now - SESSION_MAX_AGE_MS - 1000 });
  assert.match(decideStageResume({ job: job(), dir, now }).reason, /3일보다 오래/);
  saveSession(dir, { jobId: "other", engine: "claude", sessionId: SESSION, stage: "check" });
  fs.copyFileSync(sessionFile(dir, "other"), sessionFile(dir, "job1")); // 다른 일감의 기록이 섞여 들어온 경우
  assert.match(decideStageResume({ job: job(), dir }).reason, /다른 일감/);
  saveSession(dir, { jobId: "job1", engine: "claude", sessionId: SESSION, stage: "check" });
  assert.equal(decideStageResume({ job: job({ worktree: { wtDir: dir } }), dir }).mode, "fresh", "병행(작업 사본)은 사본을 새로 만들어서 처음부터");
  assert.equal(decideStageResume({ job: job({ kind: "tool" }), dir }).mode, "fresh");
  fs.writeFileSync(sessionFile(dir, "job1"), "not json");
  assert.match(decideStageResume({ job: job(), dir }).reason, /세션 기록이 없어서/, "망가진 기록은 없는 것과 같이");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("supervisor.mjs 연결: 실패 때 세션 기억, 단계 재개 때 같은 세션 + 짧은 지시, 바로 실패하면 처음부터, 검사 실패에는 단계 이름", () => {
  const src = read("supervisor.mjs");

  assert.match(src, /import \{ decideStageResume, saveSession \} from "\.\/stageresume\.mjs"/);
  assert.match(src, /status === "failed" && st\.sessionId && st\.dir !== cfg\.workDir && !st\.lab && !st\.tool && \["new", "revision"\]\.includes\(st\.job\.kind\)/);
  assert.match(src, /saveSession\(st\.dir, \{ jobId: st\.job\.id, engine: st\.job\.aiEngine, sessionId: st\.sessionId/);
  assert.match(src, /const stageDecision = !resume && !rel \? decideStageResume\(\{ job, dir \}\) : null/, "업데이트 이어받기·출시 일감과 섞이지 않는다");
  assert.match(src, /st\.resumeSession = stageDecision\.sessionId/);
  assert.match(src, /stageDecision\?\.mode === "resume" \? stageDecision\.message : promptFor\(job\)/);
  // 이어서 하기가 바로 실패하면 실패로 두지 않고 처음부터
  assert.match(src, /if \(st\.stageResumed && st\.resumeProblem && !st\.stopped && !st\.stuck\)/);
  assert.match(src, /code = await runAiTurn\(st, promptFor\(job\)\)/);
  assert.match(src, /필수 검증 실패: \$\{verification\.reason\}`\)\.slice\(-1800\), failStage: "check" \}/, "검사 실패는 단계 'check' 로 기록돼 [실패 단계부터 다시]가 나온다");
  assert.doesNotMatch(src, /saveSession\([^)]*accessToken|saveSession\([^)]*secrets/, "세션 기록에는 키·토큰을 넣지 않는다");
});
