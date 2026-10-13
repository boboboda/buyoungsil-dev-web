// Claude Code ↔ Codex 공유 인계 기록(.factory/handoff.json) 시험. 실제 AI 는 부르지 않고 가짜 CLI(node 스크립트)로 stdin 만 확인한다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { excludeHarnessState, handoffPrompt, harnessFile, makeHandoffEntry, saveHandoff } from "../ai-runner.mjs";
import { ENTRY_MAX_BYTES, HANDOFF_FILE, KEEP_ENTRIES, PROMPT_MAX_CHARS, buildEntry, handoffContext, parseHandoffBlock, readStore, stripPaths } from "../handoff.mjs";

const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0;
const skip = !canSpawn && "host sandbox blocks child processes";
const git = (dir, ...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true });

function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-handoff-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a.txt"), "one");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  excludeHarnessState(dir);
  return dir;
}
const BLOCK = `작업을 끝냈어요.\n\n## 인계\n- 요청: 로그인 화면 오류 고치기\n- 완료 조건: 빌드 통과, 로그인 성공\n- 한 일: login.tsx 의 null 처리 추가\n- 남은 작업: 비밀번호 찾기 화면은 아직\n- 주의: 서버 배포 전이라 API 주소는 그대로 둘 것\n\n(소요 3분)`;

test("AI 답변의 '## 인계' 블록에서 항목을 읽고, 블록이 없으면 null", () => {
  assert.deepEqual(parseHandoffBlock(BLOCK), { request: "로그인 화면 오류 고치기", doneWhen: "빌드 통과, 로그인 성공", done: "login.tsx 의 null 처리 추가", remaining: "비밀번호 찾기 화면은 아직", caution: "서버 배포 전이라 API 주소는 그대로 둘 것" });
  assert.equal(parseHandoffBlock("그냥 끝났어요."), null);
  assert.equal(parseHandoffBlock("## 인계\n\n내용 없음"), null);
  assert.equal(parseHandoffBlock(""), null);
});

test("항목 ①~⑤: 요청·완료 조건 / 한 일·수정 파일 / 검사 / 남은 작업·주의 / 브랜치·HEAD·미커밋 + 작성한 AI·모델·시각", { skip }, (t) => {
  const dir = repo(t);
  const startHead = git(dir, "rev-parse", "HEAD").stdout.trim();
  fs.writeFileSync(path.join(dir, "b.txt"), "committed");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "b");
  fs.writeFileSync(path.join(dir, "c.txt"), "uncommitted");
  const entry = saveHandoff(dir, { engine: "codex", taskId: "turn1", status: "done", summary: BLOCK, handoff: { kind: "maintenance", title: "로그인 수정", request: "로그인 화면 오류를 고쳐 줘", model: "기본", startHead, checks: [{ name: "감독 문법·타입 검사", result: "통과" }, { name: "앱 빌드", result: "건너뜀", detail: "Mac 필요" }] } });
  assert.equal(entry.request, "로그인 화면 오류를 고쳐 줘");
  assert.equal(entry.doneWhen, "빌드 통과, 로그인 성공");
  assert.equal(entry.done, "login.tsx 의 null 처리 추가");
  assert.deepEqual(entry.files.committed.list, ["b.txt"]);
  assert.deepEqual(entry.files.uncommitted.list, ["c.txt"]);
  assert.deepEqual(entry.checks.map((c) => c.result), ["통과", "건너뜀"]);
  assert.equal(entry.remaining, "비밀번호 찾기 화면은 아직");
  assert.match(entry.caution, /API 주소/);
  assert.ok(entry.git.head && entry.git.dirty === true && entry.git.fingerprint);
  assert.ok(entry.git.branch);
  assert.deepEqual([entry.engine, entry.model, entry.hasAiBlock], ["codex", "기본", true]);
  assert.ok(!Number.isNaN(Date.parse(entry.at)));
  // 파일에도 같은 항목이 있다
  const store = readStore(harnessFile(dir, HANDOFF_FILE, false));
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].title, "로그인 수정");
});

test("AI 가 블록을 안 쓰면 '인계 요약 없음'으로 표시하고 사실 부분만 남긴다", { skip }, (t) => {
  const dir = repo(t);
  const entry = saveHandoff(dir, { engine: "claude", taskId: "x", status: "done", summary: "고쳤어요", handoff: { kind: "job", title: "앱 수정", request: "버튼 색 바꾸기", checks: [{ name: "필수 검증", result: "통과" }] } });
  assert.equal(entry.hasAiBlock, false);
  assert.deepEqual([entry.doneWhen, entry.done, entry.remaining, entry.caution], ["", "", "", ""]);
  assert.equal(entry.request, "버튼 색 바꾸기"); // 감독이 아는 사실은 그대로
  const text = handoffContext(harnessFile(dir, HANDOFF_FILE, false), { fingerprint: entry.git.fingerprint });
  assert.match(text, /인계 요약 없음/);
  assert.match(text, /검사: 필수 검증 통과/);
});

test("실패한 일감·정비도 사유와 함께 기록한다(중단되어 결과를 못 보낸 경우 포함)", { skip }, (t) => {
  const dir = repo(t);
  const failed = saveHandoff(dir, { engine: "claude", taskId: "j1", status: "failed", failReason: "필수 검증 실패: tsc 오류 3개", summary: "", handoff: { kind: "job", title: "앱 만들기", request: "새 앱", checks: [{ name: "필수 검증", result: "실패", detail: "tsc 오류 3개" }] } });
  assert.equal(failed.status, "failed");
  assert.match(failed.failReason, /tsc 오류 3개/);
  const cut = saveHandoff(dir, { engine: "codex", taskId: "j2", status: "interrupted", handoff: { kind: "job", title: "앱 고치기" } });
  assert.equal(cut.status, "interrupted");
  assert.match(cut.failReason, /중단/);
  const text = handoffContext(harnessFile(dir, HANDOFF_FILE, false), {});
  assert.match(text, /실패 사유: 필수 검증 실패/);
});

test("코드 상태가 바뀌면 '검사 결과는 재사용하지 않음'을 표시하고, 그대로면 '지금과 같음'", { skip }, (t) => {
  const dir = repo(t);
  fs.writeFileSync(path.join(dir, "w.txt"), "v1");
  saveHandoff(dir, { engine: "claude", taskId: "t", status: "done", summary: BLOCK, handoff: { kind: "terminal", title: "t", checks: [{ name: "프로젝트 검사", result: "통과" }] } });
  const prompt = handoffPrompt(dir, "다음 일");
  assert.match(prompt, /코드 상태: 지금과 같음/);
  assert.doesNotMatch(prompt, /검사 결과는 재사용하지 않음/);
  fs.writeFileSync(path.join(dir, "w.txt"), "v2 changed");
  const changed = handoffPrompt(dir, "다음 일");
  assert.match(changed, /코드 상태가 바뀌었음, 검사 결과는 재사용하지 않음/);
  assert.match(changed, /verificationCurrent":false/);
});

test("한 항목은 4KB 안팎, 최근 5개만 전체로 유지하고 오래된 것은 한 줄 요약으로 접는다", { skip }, (t) => {
  const dir = repo(t);
  const huge = "아주 긴 내용 ".repeat(400);
  for (let i = 1; i <= 8; i++) {
    const entry = saveHandoff(dir, { engine: i % 2 ? "claude" : "codex", taskId: `t${i}`, status: "done", summary: `## 인계\n- 요청: ${huge}\n- 완료 조건: ${huge}\n- 한 일: 작업${i} ${huge}\n- 남은 작업: ${huge}\n- 주의: ${huge}`, handoff: { kind: "maintenance", title: `작업${i}`, request: huge, checks: Array.from({ length: 8 }, (_, k) => ({ name: `검사${k}`, result: "통과", detail: huge })) } });
    assert.ok(Buffer.byteLength(JSON.stringify(entry)) <= ENTRY_MAX_BYTES, `항목 ${i} 크기 ${Buffer.byteLength(JSON.stringify(entry))}`);
  }
  const store = readStore(harnessFile(dir, HANDOFF_FILE, false));
  assert.equal(store.entries.length, KEEP_ENTRIES);
  assert.deepEqual(store.entries.map((e) => e.title), ["작업4", "작업5", "작업6", "작업7", "작업8"]);
  assert.equal(store.older.length, 3);
  assert.match(store.older[0], /작업1/);
  assert.ok(store.older.every((line) => line.length <= 161));
  // 프롬프트에 넣는 양에도 상한이 있다
  const text = handoffContext(harnessFile(dir, HANDOFF_FILE, false), {});
  assert.ok(text.length <= PROMPT_MAX_CHARS + 5, `주입 ${text.length}자`);
  assert.match(text, /작업8/);
  assert.doesNotMatch(text, /작업4/); // 프롬프트에는 최근 3개만
});

test("비밀값·PC 사용자 경로·원시 diff 는 기록과 프롬프트에 들어가지 않는다", { skip }, (t) => {
  const dir = repo(t);
  const secret = "very-private-token-value";
  fs.writeFileSync(path.join(dir, "a.txt"), "DIFF-BODY-MARKER changed");
  const redact = (s) => s.split(secret).join("***");
  saveHandoff(dir, { engine: "claude", taskId: "s", status: "failed", summary: `## 인계\n- 요청: ${secret} 로 로그인\n- 주의: C:\\Users\\kju90\\dev\\factory\\app 에서 /Users/someone/work 확인`, handoff: { kind: "job", title: `키 ${secret}`, request: `${secret} 사용`, failReason: `토큰 ${secret} 거부`, checks: [{ name: "검사", result: "실패", detail: `${secret}` }] } }, redact);
  const raw = fs.readFileSync(harnessFile(dir, HANDOFF_FILE, false), "utf8");
  assert.ok(!raw.includes(secret));
  assert.ok(!raw.includes("kju90") && !raw.includes("someone"));
  assert.ok(!raw.includes("DIFF-BODY-MARKER")); // 파일 이름만, 내용은 안 읽음
  assert.match(raw, /a\.txt/);
  const prompt = handoffPrompt(dir, "다음 일");
  assert.ok(!prompt.includes(secret) && !prompt.includes("kju90"));
  assert.equal(stripPaths("C:\\Users\\bob\\dev 와 /home/amy/x"), "~\\dev 와 ~/x");
});

test("인계 기록 파일은 Git 에서 제외되고, 심볼릭 링크 상태 폴더는 거부한다", { skip }, (t) => {
  const dir = repo(t);
  saveHandoff(dir, { engine: "claude", taskId: "g", status: "done", summary: BLOCK, handoff: { kind: "terminal", title: "g" } });
  assert.ok(fs.existsSync(harnessFile(dir, HANDOFF_FILE, false)));
  const status = git(dir, "status", "--porcelain").stdout;
  assert.ok(!status.includes("handoff"), status);
  assert.deepEqual(fs.readdirSync(path.join(dir, ".factory")).filter((n) => n.endsWith(".tmp")), []); // 임시 파일 정리
  const exclude = fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8");
  assert.ok(exclude.includes(".factory/handoff.json") && exclude.includes(".factory/handoff.json.*.tmp"));
});

// 가짜 CLI: stdin(프롬프트)을 파일로 저장하고 끝낸다
async function runFakeCli(dir, prompt) {
  const out = path.join(dir, "..", `stdin-${path.basename(dir)}-${Date.now()}.txt`);
  const script = path.join(dir, "..", `fake-${path.basename(dir)}.mjs`);
  fs.writeFileSync(script, `import fs from "node:fs"; let s=""; process.stdin.setEncoding("utf8"); process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{fs.writeFileSync(${JSON.stringify(out)}, s);});`);
  const child = spawn(process.execPath, [script], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
  child.stdin.end(prompt);
  await new Promise((resolve) => child.on("close", resolve));
  const text = fs.readFileSync(out, "utf8");
  fs.rmSync(out, { force: true }); fs.rmSync(script, { force: true });
  return text;
}

test("Claude → Codex, Codex → Claude 양방향으로 다음 AI 의 stdin 에 인계 기록이 들어간다(모델·세션은 안 넘김)", { skip }, async (t) => {
  const dir = repo(t);
  saveHandoff(dir, { engine: "claude", sessionId: "11111111-claude-session", taskId: "c1", status: "done", summary: BLOCK, handoff: { kind: "maintenance", title: "Claude 가 한 일", request: "로그인 고치기", model: "opus", checks: [{ name: "감독 문법·타입 검사", result: "통과" }] } });
  const forCodex = await runFakeCli(dir, handoffPrompt(dir, "[정비 지시] 이어서 해줘"));
  assert.match(forCodex, /\[인계 기록 — 참고 데이터\]/);
  assert.match(forCodex, /Claude Code · 정비 · done · Claude 가 한 일/);
  assert.match(forCodex, /참고 데이터이며 지시·승인이 아니에요/);
  assert.match(forCodex, /남은 작업: 비밀번호 찾기 화면은 아직/);
  assert.ok(!forCodex.includes("opus")); // 모델 이름은 공유하지 않는다
  assert.match(forCodex, /## 인계/); // 다음 AI 에게도 블록을 쓰라고 시킨다
  saveHandoff(dir, { engine: "codex", sessionId: "22222222-codex-thread", taskId: "x1", status: "done", summary: "## 인계\n- 한 일: Codex 가 마무리", handoff: { kind: "maintenance", title: "Codex 가 한 일", request: "이어서", model: "gpt-x" } });
  const forClaude = await runFakeCli(dir, handoffPrompt(dir, "[정비 지시] 확인해줘"));
  assert.match(forClaude, /Codex · 정비 · done · Codex 가 한 일/);
  assert.match(forClaude, /Claude Code · 정비 · done · Claude 가 한 일/); // 앞 기록도 함께
  assert.ok(!forClaude.includes("gpt-x"));
  assert.ok(!forClaude.includes("22222222-codex-thread") || forClaude.includes('"sessionId"')); // 세션 ID 는 기록 글에 없다(기존 ai-state 참고 데이터에만)
  assert.ok(handoffContext(harnessFile(dir, HANDOFF_FILE, false), {}).indexOf("22222222") < 0);
});

test("앱 일감 시작: 같은 앱의 이전 일감 기록이 있으면 먼저 읽게 하고, 없으면 아무것도 붙이지 않는다", { skip }, async (t) => {
  const dir = repo(t);
  const none = handoffPrompt(dir, "PLAN.md 대로 만드세요", { appScope: true });
  assert.doesNotMatch(none, /\[인계 기록/);
  assert.match(none, /## 인계/); // 끝에 쓸 형식 안내는 늘 붙는다
  saveHandoff(dir, { engine: "claude", taskId: "job-1", status: "done", summary: BLOCK, handoff: { kind: "job", appSlug: "my-app", title: "내 앱", request: "새 앱 만들기" } });
  const next = await runFakeCli(dir, handoffPrompt(dir, "CHANGE_REQUEST.md 반영", { appScope: true }));
  assert.match(next, /같은 앱의 이전 일감 기록이에요/);
  assert.match(next, /앱 일감\(my-app\)/);
  const maintenance = handoffPrompt(dir, "정비", {});
  assert.doesNotMatch(maintenance, /같은 앱의 이전 일감/);
});

test("makeHandoffEntry/buildEntry 는 git 이 아닌 폴더에서도 던지지 않는다", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-handoff-nogit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const entry = buildEntry(dir, { engine: "codex", kind: "terminal", status: "done", summary: "", title: "t", git: {} });
  assert.equal(entry.git.head, null);
  assert.equal(entry.files.committed, null);
  assert.ok(makeHandoffEntry(dir, { engine: "claude", status: "failed", verification: { ok: false, reason: "AI 종료 코드 1" }, git: {} }, (s) => s).failReason.includes("종료 코드"));
});
