// 정비 턴(maintenance.mjs)의 업데이트 멈춤/이어서 하기 시험: 가짜 Claude·가짜 홈페이지 응답(고정 함수)·임시 정비 저장소만 쓴다. 진짜 정비 폴더·감독은 건드리지 않는다.
//   · 정비 턴이 도구를 부르는 중에 멈추라고 하면 안전한 지점에서 멈추고 세션·폴더·시작 커밋·남은 시간을 저장한다
//   · 새 감독(다른 프로세스)이 저장된 정비 턴을 같은 세션으로 이어 준다. 정비 폴더를 다시 준비(fetch·보관)하지 않고, 서버에 '시작'을 다시 알리지 않는다
//   · 업데이트를 못 하면 같은 프로세스에서 이어 준다
//   · 이어서 하기가 바로 실패하면 정비 결과에 '다시 시작 필요'로 남긴다
// 실행: node tools/factory-supervisor/tests/pause-maint.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BACKGROUND_FAIL_REASON, RESUME_MESSAGE } from "../pause.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUP = path.resolve(HERE, "..");
const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0 && spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const skip = !canSpawn && "host sandbox blocks child processes";
const IS_WIN = process.platform === "win32";
const G = ["-c", "user.name=tester", "-c", "user.email=t@localhost", "-c", "core.autocrlf=false"];
const git = (cwd, ...a) => {
  const r = spawnSync("git", [...G, ...a], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const SESSION = "11111111-2222-3333-4444-555555555555";

/** 정비 저장소(main): origin(bare)과 복제본. 감독 폴더(tools/factory-supervisor)에 *.mjs 가 있어야 문법 검사가 돈다(여기서는 새 커밋이 없어 검사까지 가지 않는다) */
function makeSelfdev(root) {
  const origin = path.join(root, "origin.git");
  const dir = path.join(root, "selfdev");
  fs.mkdirSync(origin);
  git(origin, "init", "-q", "--bare", "-b", "main");
  fs.mkdirSync(path.join(dir, "tools", "factory-supervisor"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tools", "factory-supervisor", "x.mjs"), "export const x = 1;\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n.factory/\n");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "remote", "add", "origin", origin);
  git(dir, "push", "-q", "origin", "main");
  return dir;
}

function setup(scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pause-maint-"));
  const home = path.join(root, "home");
  const fixtures = path.join(root, "fixtures");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(fixtures, { recursive: true });
  for (const f of ["fake-claude-pause.mjs", "fake-claude-pause.cmd", "fake-claude-pause.sh"]) fs.copyFileSync(path.join(HERE, "fixtures", f), path.join(fixtures, f));
  if (!IS_WIN) fs.chmodSync(path.join(fixtures, "fake-claude-pause.sh"), 0o755);
  fs.writeFileSync(path.join(root, "scenario.json"), JSON.stringify(scenario));
  const selfdev = makeSelfdev(root);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home, // 작업 폴더 잠금(.ai-locks)이 임시 홈에 생기게
    SUP_DIR: SUP,
    SELFDEV: selfdev,
    CLAUDE_CMD: path.join(fixtures, IS_WIN ? "fake-claude-pause.cmd" : "fake-claude-pause.sh"),
    PAUSE_STATE: path.join(root, "paused.json"),
    FAKE_SCENARIO: path.join(root, "scenario.json"),
    FAKE_CALLS: path.join(root, "calls.log"),
    FACTORY_MAINTENANCE_TURN: "M1",
  };
  for (const k of ["CLAUDE_STATUS_TOKEN", "CLAUDE_STATUS_URL", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]) delete env[k];
  const turn = { turnId: "M1", threadId: "T1", title: "시험 정비", text: "시험 지시", aiEngine: "claude", aiModel: null, sessionId: null, previousResult: "없음", deployBundling: true, queueLeft: 0 };
  const drive = (mode, extra = {}) => {
    const r = spawnSync(process.execPath, [path.join(HERE, "fixtures", "maint-driver.mjs")], { cwd: root, env: { ...env, MODE: mode, TURN: JSON.stringify(turn), ...extra }, encoding: "utf8", windowsHide: true, timeout: 120_000 });
    const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
    assert.ok(line, `운전기 결과 없음(코드 ${r.status}): ${r.stderr}\n${r.stdout}`);
    return JSON.parse(line.slice(7));
  };
  const calls = () => (fs.existsSync(env.FAKE_CALLS) ? fs.readFileSync(env.FAKE_CALLS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { root, selfdev, env, drive, calls };
}
const busy = (n) => Array.from({ length: n }, () => ({ tool: { name: "Bash", input: { command: "echo work" }, ms: 700 } }));
const doneOf = (posts) => posts.filter((p) => p.done).map((p) => p.done);

test("정비 턴: 멈춤 → (다른 프로세스가) 같은 세션으로 이어 줌. 폴더를 다시 준비하지 않고 시작도 다시 알리지 않는다", { skip, timeout: 200_000 }, () => {
  const s = setup({ M1: { calls: [[{ say: "정비를 시작합니다" }, ...busy(30)], [{ say: "이어서 마칩니다" }]] } });
  const first = s.drive("first");
  assert.equal(first.saved.length, 1, "멈춘 정비 턴 하나가 저장됐다");
  const e = first.saved[0];
  assert.equal(e.kind, "maint");
  assert.equal(e.sessionId, SESSION, "세션 id 저장");
  assert.equal(path.resolve(e.dir), path.resolve(s.selfdev), "작업 폴더 저장");
  assert.ok(e.startHead && e.timeLeftMs > 0 && e.timeLeftMs <= 90 * 60_000, `시작 커밋·남은 시간 한도 저장: ${e.startHead} ${e.timeLeftMs}`);
  assert.equal(e.turn.turnId, "M1");
  assert.equal(doneOf(first.posts).length, 0, "멈춘 것은 완료·실패로 보고하지 않는다");
  assert.equal(first.posts.filter((p) => p.action === "start").length, 1);
  assert.equal(s.calls().length, 1);

  // 멈춰 있는 동안 정비 폴더에는 AI 가 고치던 커밋 안 된 파일이 있다. 정비 폴더를 다시 준비(fetch·확인)했다면 "커밋 안 된 변경이 있어요"로 실패한다
  fs.appendFileSync(path.join(s.selfdev, "tools", "factory-supervisor", "x.mjs"), "export const wip = 2;\n");
  const second = s.drive("second");
  assert.equal(s.calls().length, 2, "AI 는 처음 한 번, 이어서 한 번");
  assert.equal(s.calls()[1].resume, SESSION, "같은 세션으로 --resume");
  assert.equal(s.calls()[1].prompt, RESUME_MESSAGE);
  assert.equal(second.posts.filter((p) => p.action === "start").length, 0, "서버에는 시작을 다시 알리지 않는다");
  const done = doneOf(second.posts);
  assert.equal(done.length, 1);
  // 커밋 없이 끝났는데 폴더에 변경이 남아 있으면 '완료'가 아니라 미완료(이어서 필요)로 보고하고, 파일은 숨기지 않고 그대로 둔다
  assert.equal(done[0].ok, false, `커밋 안 된 변경이 남았으니 완료가 아니다: ${done[0].text}`);
  assert.match(done[0].text, /미완료\(이어서 필요\)/);
  assert.equal(git(s.selfdev, "stash", "list"), "", "stash 로 숨기지 않는다");
  assert.match(git(s.selfdev, "status", "--porcelain"), /x.mjs/, "변경 파일이 폴더에 그대로 있다");
  assert.ok(second.logs.some((l) => /업데이트 뒤 이어서/.test(l)), second.logs.join("\n"));
});

test("정비 턴: 업데이트를 못 하면 같은 프로세스에서 이어 준다(resumeAll)", { skip, timeout: 200_000 }, () => {
  const s = setup({ M1: { calls: [[{ say: "시작" }, ...busy(30)], [{ say: "이어서 마칩니다" }]] } });
  const r = s.drive("inproc");

  assert.equal(r.resumedCount, 1);
  assert.equal(s.calls().length, 2);
  assert.equal(s.calls()[1].resume, SESSION);
  assert.equal(s.calls()[1].prompt, RESUME_MESSAGE);
  const done = doneOf(r.posts);
  assert.equal(done.length, 1);
  assert.equal(done[0].ok, true);
  assert.equal(r.posts.filter((p) => p.action === "start").length, 1, "시작은 한 번만 알렸다");
});

test("정비 턴: 이어서 하기가 바로 실패하면 결과에 '다시 시작 필요'로 남긴다(한 번만 보고)", { skip, timeout: 200_000 }, () => {
  const s = setup({ M1: { rejectResume: true, calls: [[{ say: "시작" }, ...busy(30)]] } });
  s.drive("first");
  const second = s.drive("second");
  const done = doneOf(second.posts);

  assert.equal(done.length, 1, "최종 보고는 한 번");
  assert.equal(done[0].ok, false);
  assert.match(done[0].text, /^다시 시작 필요/);
  assert.equal(s.calls().length, 2);
});

test("정비 턴: 결과 글이 '백그라운드에서 돌고 있어요 / 끝나면 이어서'면 done 이 아니라 실패(백그라운드 대기 중 종료)", { skip, timeout: 200_000 }, () => {
  const s = setup({ M1: { resultText: "시험이 백그라운드에서 돌고 있어요. 끝나면 이어서 할게요.", calls: [[{ say: "시험을 띄웠어요" }]] } });
  const r = s.drive("plain");
  const done = doneOf(r.posts);
  assert.equal(done.length, 1);
  assert.equal(done[0].ok, false);
  assert.ok(done[0].text.startsWith(BACKGROUND_FAIL_REASON), done[0].text);
});

test("정비 턴: 정상 결과는 그대로 완료", { skip, timeout: 200_000 }, () => {
  const s = setup({ M1: { calls: [[{ say: "바꾼 것 없이 확인만 했어요. 검사 통과." }]] } });
  const done = doneOf(s.drive("plain").posts);
  assert.equal(done.length, 1);
  assert.equal(done[0].ok, true, done[0].text);
});
