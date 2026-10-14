// 감독 프로그램 업데이트(update.mjs)의 "묶기 + 멈췄다가 받기" 시험: 임시 git 저장소(진짜 origin 아님)에 복사한 감독 폴더와 가짜 멈춤 조정자·가짜 시계로 돌린다.
//   공장이 비면 바로 / 일감이 돌면 1시간 모음 / 0분이면 바로 / 지금 업데이트는 기다리지 않음 / 합치기·검증 중에는 기다림 / 받기 실패하면 멈춘 일감을 그대로 이어 줌
// 실행: node tools/factory-supervisor/tests/update.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUP = path.resolve(HERE, "..");
const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0 && spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const skip = !canSpawn && "host sandbox blocks child processes";
const G = ["-c", "user.name=tester", "-c", "user.email=t@localhost", "-c", "core.autocrlf=false"];
const git = (cwd, ...a) => {
  const r = spawnSync("git", [...G, ...a], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

/** 감독 폴더 복사본이 든 저장소(work)와 그 origin(bare), 새 커밋을 올릴 다른 작업 사본(other) */
function makeRepos(newCommit = "ok") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "update-test-"));
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  const other = path.join(root, "other");
  fs.mkdirSync(origin);
  git(origin, "init", "-q", "--bare", "-b", "main");
  fs.mkdirSync(path.join(work, "tools", "factory-supervisor"), { recursive: true });
  for (const f of fs.readdirSync(SUP)) if (f.endsWith(".mjs")) fs.copyFileSync(path.join(SUP, f), path.join(work, "tools", "factory-supervisor", f));
  git(work, "init", "-q", "-b", "main");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "base");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "-q", "origin", "main");
  const base = git(work, "rev-parse", "HEAD");
  git(root, "clone", "-q", origin, other);
  const f = path.join(other, "tools", "factory-supervisor", "slots.mjs");
  fs.appendFileSync(f, newCommit === "ok" ? "\n// 새 버전 표시\n" : "\nexport const = ;\n"); // 문법 오류 커밋이면 받은 뒤 문법 검사에서 실패한다
  git(other, "add", "-A");
  git(other, "commit", "-q", "-m", "새 커밋");
  git(other, "push", "-q", "origin", "main");
  const remote = git(other, "rev-parse", "HEAD");
  return { root, work, base, remote, supDir: path.join(work, "tools", "factory-supervisor") };
}

function drive(repos, script) {
  const r = spawnSync(process.execPath, [path.join(HERE, "fixtures", "update-driver.mjs")], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, SUP_COPY: repos.supDir, FACTORY_LAUNCHER: "1", FACTORY_UPDATE_STATE: path.join(repos.root, "update-state.json"), SCRIPT: JSON.stringify(script) },
  });
  assert.equal(r.status, 0, `운전기 실패: ${r.stderr}\n${r.stdout}`);
  return JSON.parse(r.stdout.trim().split("\n").at(-1));
}
const head = (repos) => git(repos.work, "rev-parse", "HEAD");

test("공장이 비어 있으면 새 버전을 바로 받는다(묶지 않음)", { skip }, () => {
  const repos = makeRepos();
  const out = drive(repos, [{ name: "idle", bundleMin: 60, soft: 0, hard: 0 }]);
  assert.equal(out.at(-1).exited, true, "받고 다시 시작(exit 0)한다");
  assert.equal(out.at(-1).fake.persisted, 1);
  assert.equal(head(repos), repos.remote, "새 커밋을 받았다");
});

test("일감이 돌고 있으면 새 커밋을 1시간 모았다가 한 번에 받는다(모으는 동안 아무것도 막지 않음)", { skip }, () => {
  const repos = makeRepos();
  const out = drive(repos, [
    { name: "처음 봄", bundleMin: 60, soft: 2, hard: 0 },
    { name: "30분 뒤", dt: 30 },
    { name: "59분 뒤", dt: 59 },
    { name: "60분 뒤", dt: 60 },
  ]);
  const [first, mid, late, due] = out;
  assert.equal(first.exited, false);
  assert.equal(first.waiting, false, "모으는 동안은 새 일감 받기를 막지 않는다(드레인 아님)");
  assert.deepEqual(first.bundle, { state: "bundling", leftMin: 60 });
  assert.equal(first.fake.requested, 0, "모으는 동안은 AI 를 멈추지 않는다");
  assert.deepEqual(mid.bundle, { state: "bundling", leftMin: 30 });
  assert.equal(mid.fake.requested, 0);
  assert.deepEqual(late.bundle, { state: "bundling", leftMin: 1 });
  assert.equal(due.fake.requested, 1, "시간이 다 되면 그때 진행 중인 AI 를 멈춘다");
  assert.equal(due.exited, true, "멈춘 뒤 받고 다시 시작한다");
  assert.equal(head(repos), repos.remote);
  assert.ok(due.logs.some((l) => /멈춘 일감 2개는 새 버전이 켜지면 같은 세션으로 이어 줘요/.test(l)));
});

test("모으는 도중 공장이 비면 그 순간 바로 받는다", { skip }, () => {
  const repos = makeRepos();
  const out = drive(repos, [{ name: "모으는 중", bundleMin: 60, soft: 1, hard: 0 }, { name: "일감 끝남", dt: 5, soft: 0 }]);
  assert.equal(out[0].bundle.state, "bundling");
  assert.equal(out.at(-1).exited, true);
  assert.equal(head(repos), repos.remote);
});

test("묶는 시간이 0이면 일감이 돌아도 바로 멈추고 받는다", { skip }, () => {
  const repos = makeRepos();
  const out = drive(repos, [{ name: "0분", bundleMin: 0, soft: 1, hard: 0 }]);
  assert.equal(out[0].fake.requested, 1, "바로 멈추기 시작");
  assert.equal(out[0].exited, true, "멈춘 직후 받고 다시 시작");
  assert.equal(head(repos), repos.remote);
});

test("통제실 [지금 업데이트]는 묶는 시간(180분)을 기다리지 않고 바로 멈추고 받는다", { skip }, () => {
  const repos = makeRepos();
  const out = drive(repos, [{ name: "지금", bundleMin: 180, soft: 3, hard: 0, updateNow: true }]);
  assert.equal(out[0].fake.requested, 1);
  assert.equal(out[0].exited, true);
  assert.equal(out[0].fake.persisted, 1);
  assert.equal(head(repos), repos.remote);
});

test("합치기·검증처럼 멈출 수 없는 단계가 있으면 그것이 끝날 때까지 기다린다(AI 는 계속 일한다)", { skip }, () => {
  const repos = makeRepos();
  const out = drive(repos, [
    { name: "시간 다 됨, 합치는 중", bundleMin: 1, soft: 1, hard: 1, dt: 0 },
    { name: "1분 지남", dt: 2 },
    { name: "합치기 끝남", dt: 3, hard: 0 },
  ]);
  const [a, b, c] = out;
  assert.equal(a.exited, false);
  assert.equal(b.waiting, true, "받기로 정했다(새 일감은 받지 않음)");
  assert.equal(b.fake.requested, 0, "합치는 중에는 다른 AI 도 멈추지 않고 합치기가 끝나길 먼저 기다린다");
  assert.equal(b.exited, false);
  assert.ok(b.logs.concat(a.logs).some((l) => /멈출 수 없는 단계 1개가 끝나길 기다려요/.test(l)));
  assert.equal(c.fake.requested, 1, "합치기가 끝난 뒤 멈춘다");
  assert.equal(c.exited, true);
  assert.equal(head(repos), repos.remote);
});

test("지금 업데이트도 합치는 중에는 받지 않고 기다린다(멈출 수 있는 AI 는 바로 멈춘다)", { skip }, () => {
  const repos = makeRepos();
  const out = drive(repos, [
    { name: "지금 업데이트, 합치는 중", bundleMin: 180, soft: 1, hard: 1, updateNow: true },
    { name: "합치기 끝남", dt: 1, hard: 0 },
  ]);
  assert.equal(out[0].fake.requested, 1, "멈출 수 있는 AI 는 기다리지 않고 멈춘다");
  assert.equal(out[0].exited, false, "합치기가 끝나기 전에는 받지 않는다");
  assert.equal(out[1].exited, true);
});

test("받지 못하면(문법 검사 실패) 멈췄던 일감을 이 프로세스에서 그대로 이어 준다", { skip }, () => {
  const repos = makeRepos("bad");
  const out = drive(repos, [{ name: "깨진 커밋", bundleMin: 0, soft: 2, hard: 0 }]);
  const o = out[0];
  assert.equal(o.exited, false, "다시 시작하지 않는다");
  assert.equal(o.waiting, false);
  assert.equal(o.fake.resumed, 1, "멈췄던 일감을 이어 줬다");
  assert.equal(o.fake.persisted, 0, "저장하기 전에 실패했으므로 저장 기록을 남기지 않는다");
  assert.equal(head(repos), repos.base, "이전 커밋으로 되돌렸다");
  assert.ok(o.logs.some((l) => /문법 검사 통과 못 함/.test(l)));
  assert.ok(o.logs.some((l) => /멈췄던 일감 2개를 이 프로세스에서 그대로 이어 줘요/.test(l)));
});

test("자동 업데이트를 끄면 모으던 것도 멈추던 것도 취소하고 일감을 이어 준다", { skip }, () => {
  const repos = makeRepos();
  const out = drive(repos, [
    { name: "합치는 중이라 대기", bundleMin: 0, soft: 1, hard: 1 },
    { name: "자동 업데이트 끔", dt: 1, autoUpdate: false },
  ]);
  assert.equal(out[0].waiting, true);
  assert.equal(out[1].waiting, false);
  assert.equal(out[1].fake.resumed, 1);
  assert.equal(out[1].exited, false);
  assert.equal(head(repos), repos.base);
});
