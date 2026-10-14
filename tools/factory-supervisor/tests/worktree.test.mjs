// 병렬화 단계 C-1(감독 프로그램 쪽) 시험: 같은 앱 일감을 작업 사본(git worktree)에서 동시에 실행하고, 끝난 순서대로 합치며 충돌을 점검하는 장치.
//   - 앱 단위 잠금(applock.mjs): 같은 앱 안에서 한 번에 하나만, 낡은 잠금 치우기, 잠금 대기 표시, AI 명령 감싸기
//   - 작업 사본(worktree.mjs): 만들기·정리(git worktree remove + git branch -D, 원격 push 없음)·재시작 때 남은 것 정리
//   - 합치기(merge.mjs): 서로 다른 파일은 그대로 합침 / 글자 충돌·검사 실패 → 다시 맞추기(최대 2회) → 그래도 안 되면 그 일감만 합치기 실패(이미 합쳐진 것은 그대로)
// 진짜 git 으로 임시 저장소를 만들어 돌린다. AI·서버·네트워크는 쓰지 않는다(AI 는 가짜 함수). 실행: node tools/factory-supervisor/tests/worktree.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquireLock, clearLocks, clearWait, lockFile, lockHolder, lockRules, LOCK_NAMES, readWait, withLock, writeWait } from "../applock.mjs";
import { branchName, cleanupLeftovers, commitAll, createWorktree, currentBranch, defaultBranch, git, listFactoryWorktrees, removeWorktree, savePatch, stripFactoryFiles, worktreePath } from "../worktree.mjs";
import { fixPrompt, MAX_REBASES, mergeJob } from "../merge.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUP = path.resolve(HERE, "..");
const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0 && spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const skip = !canSpawn && "host sandbox blocks child processes";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const AUTHOR = ["-c", "user.name=tester", "-c", "user.email=t@localhost"];
const run = (dir, ...args) => {
  const r = spawnSync("git", [...AUTHOR, ...args], { cwd: dir, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");

/** 앱 저장소(main 브랜치, 파일 몇 개, node_modules 는 무시)를 workDir/<slug> 에 만든다 */
function makeApp(slug = "demo-app") {
  const workDir = tmp("wt-work-");
  const repo = path.join(workDir, slug);
  fs.mkdirSync(repo, { recursive: true });
  run(repo, "init", "-q", "-b", "main");
  run(repo, "config", "core.autocrlf", "false"); // 줄바꿈 변환 없이(시험 결과가 PC 설정에 안 흔들리게)
  write(repo, ".gitignore", ".factory/\nnode_modules/\nlocal.properties\n");
  write(repo, "a.txt", "line1\nline2\nline3\n");
  write(repo, "b.txt", "b-base\n");
  write(repo, "status.txt", "OK\n");
  write(repo, "CHANGE_REQUEST.md", "# 처음 요청\n");
  write(repo, "CLAUDE.md", "# 규칙\n");
  write(repo, "node_modules/dep/index.js", "module.exports = 1;\n");
  write(repo, "local.properties", "sdk.dir=/sdk\n");
  run(repo, "add", "-A");
  run(repo, "commit", "-q", "-m", "init");
  return { workDir, repo, slug };
}

/** 일감 하나의 작업 사본을 만든다 */
function startJob(app, id) {
  const wtDir = worktreePath(app.workDir, app.slug, id);
  const branch = branchName(id);
  createWorktree({ repoDir: app.repo, wtDir, branch, base: "main" });
  // 감독 프로그램이 일감 시작 때 사본에 쓰는 공장 파일
  write(wtDir, "CHANGE_REQUEST.md", `# 수정 요청 ${id}\n`);
  write(wtDir, "PLAN.md", `plan ${id}\n`);
  write(wtDir, "CLAUDE.md", `# 규칙 ${id}\n`);
  return { id, wtDir, branch };
}

/** mergeJob 에 넘길 문맥(가짜 AI·가짜 검사). reports 에 보고된 병행 상태 조각이 쌓인다 */
function ctxFor(app, j, over = {}) {
  const lockDir = path.join(app.workDir, ".locks");
  const reports = [];
  const logs = [];
  const calls = { verify: 0, askFix: [] };
  const ctx = {
    job: { id: j.id, title: `일감 ${j.id}` },
    repoDir: app.repo,
    wtDir: j.wtDir,
    branch: j.branch,
    base: "main",
    request: `요청 ${j.id}`,
    log: (level, m) => logs.push(`${level}: ${m}`),
    report: (patch) => reports.push(patch),
    withLock: (name, fn) => withLock({ dir: lockDir, app: app.slug, name, owner: j.id, pollMs: 20 }, fn),
    verify: async (dir) => {
      calls.verify++;
      const text = read(dir, "status.txt");
      return text.includes("BAD") ? { ok: false, reason: "시험 실패: status.txt 에 BAD" } : { ok: true };
    },
    askFix: async (prompt, n) => {
      calls.askFix.push({ prompt, n });
      return { ok: true };
    },
    ...over,
  };
  return { ctx, reports, logs, calls };
}

// ───────────── 앱 단위 잠금 ─────────────
test("잠금: 같은 앱·같은 이름은 한 번에 하나, 다른 앱·다른 이름은 서로 기다리지 않는다", async () => {
  const dir = tmp("wt-lock-");
  const order = [];
  const waits = [];
  const a = await acquireLock({ dir, app: "demo-app", name: "build", owner: "A", pollMs: 10 });

  // 다른 앱, 다른 이름은 바로 얻는다
  const other = await acquireLock({ dir, app: "other-app", name: "build", owner: "X", pollMs: 10 });
  const emu = await acquireLock({ dir, app: "demo-app", name: "emulator", owner: "E", pollMs: 10 });
  other.release();
  emu.release();

  const second = acquireLock({ dir, app: "demo-app", name: "build", owner: "B", pollMs: 10, onWait: (h) => waits.push(h.owner), onAcquired: () => order.push("B 얻음") }).then((l) => {
    order.push("B 시작");
    return l;
  });
  await sleep(80);
  assert.deepEqual(order, [], "A 가 쥐고 있는 동안 B 는 기다린다");
  assert.deepEqual(waits, ["A"], "기다릴 때 누가 쥐고 있는지 알려 준다");
  assert.equal(lockHolder(dir, "demo-app", "build").owner, "A");
  order.push("A 놓음");
  a.release();
  a.release(); // 두 번 놓아도 괜찮다
  const b = await second;
  assert.deepEqual(order, ["A 놓음", "B 얻음", "B 시작"]);
  b.release();
  assert.equal(lockHolder(dir, "demo-app", "build"), null);
  assert.throws(() => lockFile(dir, "demo-app", "rm"), /알 수 없는 잠금/);
  assert.throws(() => lockFile(dir, "../evil", "build"), /앱 이름/);
  assert.deepEqual(LOCK_NAMES, ["build", "emulator", "port", "merge"]);
});

test("잠금: 쥔 프로세스가 죽었으면 낡은 잠금으로 보고 치운다(남의 새 잠금은 건드리지 않음), 기다림은 중단할 수 있다", async () => {
  const dir = tmp("wt-stale-");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lockFile(dir, "demo-app", "merge"), JSON.stringify({ token: "old", pid: 999999, owner: "dead", name: "merge", since: "2026-10-14T00:00:00.000Z" }));
  assert.equal(lockHolder(dir, "demo-app", "merge", () => false), null, "죽은 프로세스의 잠금은 없는 것");
  const lock = await acquireLock({ dir, app: "demo-app", name: "merge", owner: "new", pollMs: 10, alive: (pid) => pid !== 999999 });
  assert.equal(JSON.parse(fs.readFileSync(lock.file, "utf8")).owner, "new");

  // 기다리는 중 중단
  const ac = new AbortController();
  const waiting = acquireLock({ dir, app: "demo-app", name: "merge", owner: "w", pollMs: 10, signal: ac.signal });
  await sleep(40);
  ac.abort();
  await assert.rejects(waiting, /중단/);
  lock.release();

  // 감독 프로그램 시작 때 지난 실행의 잠금 파일을 치운다
  fs.writeFileSync(lockFile(dir, "demo-app", "build"), "{}");
  fs.writeFileSync(path.join(dir, "keep.txt"), "x");
  assert.equal(clearLocks(dir), 1);
  assert.ok(fs.existsSync(path.join(dir, "keep.txt")), "잠금 파일이 아닌 것은 건드리지 않음");
});

test("잠금 대기 표시: 일감 폴더의 표시 파일을 읽고(죽은 명령의 표시는 무시), AI 규칙 안내문에 사용법이 있다", () => {
  const dir = tmp("wt-wait-");
  const file = path.join(dir, ".factory", "lock-wait.json");
  assert.equal(readWait(file), null);
  writeWait(file, { name: "build", since: "2026-10-14T07:00:00.000Z", holder: "j1", pid: process.pid });
  assert.equal(readWait(file).name, "build");
  writeWait(file, { name: "build", since: "2026-10-14T07:00:00.000Z", pid: 999999 });
  assert.equal(readWait(file), null, "기다리던 명령이 이미 죽었으면 낡은 표시");
  writeWait(file, { name: "rm", since: "2026-10-14T07:00:00.000Z" });
  assert.equal(readWait(file), null, "알 수 없는 이름");
  clearWait(file);
  assert.equal(fs.existsSync(file), false);
  const rules = lockRules("/sup/applock.mjs");
  for (const name of ["build", "emulator", "port"]) assert.match(rules, new RegExp(`applock\\.mjs" ${name} -- <명령>`));
  assert.match(rules, /push 하지 마세요/);
});

test("잠금 명령줄: 두 번째 명령은 첫 번째가 끝날 때까지 기다리고, 기다리는 동안 표시 파일을 남긴다", { skip }, async () => {
  const dir = tmp("wt-cli-");
  const lockDir = path.join(dir, "locks");
  const waitFile = path.join(dir, "wait.json");
  const marks = path.join(dir, "marks.txt");
  const env = (id) => ({ ...process.env, FACTORY_LOCK_DIR: lockDir, FACTORY_APP_SLUG: "demo-app", FACTORY_JOB_ID: id, FACTORY_WAIT_FILE: id === "B" ? waitFile : path.join(dir, `wait-${id}.json`) });
  const script = (id, ms) => `require("fs").appendFileSync(${JSON.stringify(marks)}, "${id}-start\\n"); setTimeout(() => { require("fs").appendFileSync(${JSON.stringify(marks)}, "${id}-end\\n"); }, ${ms});`;
  const wrapper = (id, ms) => spawn(process.execPath, [path.join(SUP, "applock.mjs"), "build", "--", process.execPath, "-e", script(id, ms)], { env: env(id), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const done = (child) => new Promise((resolve) => child.on("close", resolve));

  const a = wrapper("A", 700);
  const aDone = done(a);
  const t0 = Date.now();
  while (!fs.existsSync(marks) && Date.now() - t0 < 5000) await sleep(20);
  const b = wrapper("B", 50);
  const bDone = done(b);
  let sawWait = false;
  const t1 = Date.now();
  while (Date.now() - t1 < 4000 && !sawWait) {
    sawWait = readWait(waitFile)?.name === "build";
    if (!sawWait) await sleep(20);
  }
  assert.equal(await aDone, 0);
  assert.equal(await bDone, 0);
  assert.ok(sawWait, "B 가 기다리는 동안 lock-wait 표시 파일이 있었다");
  assert.equal(readWait(waitFile), null, "잠금을 얻으면 표시를 지운다");
  assert.deepEqual(fs.readFileSync(marks, "utf8").trim().split("\n"), ["A-start", "A-end", "B-start", "B-end"], "A 가 끝난 뒤에 B 가 시작");
  // 감싼 명령의 종료 코드를 그대로 돌려준다
  const bad = spawnSync(process.execPath, [path.join(SUP, "applock.mjs"), "port", "--", process.execPath, "-e", "process.exit(7)"], { env: env("C"), windowsHide: true });
  assert.equal(bad.status, 7);
  // 잠금 이름이 틀리거나 명령이 없으면 사용법
  assert.equal(spawnSync(process.execPath, [path.join(SUP, "applock.mjs"), "merge", "--", "x"], { windowsHide: true }).status, 2, "merge 는 감독 프로그램 전용");
});

// ───────────── 작업 사본 ─────────────
test("작업 사본: 기본 브랜치에서 로컬 임시 브랜치로 만들고, 의존성은 연결·로컬 설정은 복사한다", { skip }, () => {
  const app = makeApp();
  assert.equal(defaultBranch(app.repo), "main");
  const j = startJob(app, "cjob001");

  assert.equal(branchName("cjob001"), "factory/job-cjob001");
  assert.equal(currentBranch(j.wtDir), "factory/job-cjob001");
  assert.ok(j.wtDir.includes(`${path.sep}.worktrees${path.sep}`));
  assert.equal(read(j.wtDir, "a.txt"), "line1\nline2\nline3\n");
  assert.ok(fs.lstatSync(path.join(j.wtDir, "node_modules")).isSymbolicLink(), "node_modules 는 앱 폴더와 연결");
  assert.equal(read(j.wtDir, "node_modules/dep/index.js"), "module.exports = 1;\n");
  assert.equal(read(j.wtDir, "local.properties"), "sdk.dir=/sdk\n", "git 에 없는 로컬 설정은 복사");
  assert.deepEqual(listFactoryWorktrees(app.repo).map((w) => w.branch), ["factory/job-cjob001"]);
  assert.equal(currentBranch(app.repo), "main", "앱 폴더는 기본 브랜치 그대로");
  // 이름 검사
  assert.throws(() => branchName("../x"), /형식/);
  assert.throws(() => worktreePath(app.workDir, "Bad Slug", "j1"), /앱 폴더 이름/);
  // 같은 일감 사본을 다시 만들면 낡은 것을 먼저 치운다
  const again = startJob(app, "cjob001");
  assert.equal(listFactoryWorktrees(app.repo).length, 1);
  assert.equal(again.wtDir, j.wtDir);
});

test("작업 사본 정리: git worktree remove + git branch -D 로 사본·임시 브랜치를 지우고, 원본(node_modules·기본 브랜치)은 그대로, 원격에는 아무것도 안 보낸다", { skip }, () => {
  const app = makeApp();
  // 원격(bare)을 달아 두고, 정리·합치기 어디에서도 push 가 없음을 확인한다
  const remote = tmp("wt-remote-");
  run(remote, "init", "-q", "--bare");
  run(app.repo, "remote", "add", "origin", remote);
  run(app.repo, "push", "-q", "origin", "main");
  const before = run(remote, "for-each-ref", "--format=%(refname)");

  const j = startJob(app, "cjob002");
  write(j.wtDir, "a.txt", "line1\nCHANGED\nline3\n");
  run(j.wtDir, "add", "-A");
  run(j.wtDir, "commit", "-q", "-m", "작업");
  const r = removeWorktree({ repoDir: app.repo, wtDir: j.wtDir, branch: j.branch });

  assert.equal(r.dirRemoved, true);
  assert.equal(r.branchRemoved, true);
  assert.equal(fs.existsSync(j.wtDir), false);
  assert.equal(git(app.repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${j.branch}`]).ok, false, "임시 브랜치도 지움");
  assert.deepEqual(listFactoryWorktrees(app.repo), []);
  assert.equal(read(app.repo, "node_modules/dep/index.js"), "module.exports = 1;\n", "연결된 원본 폴더 내용은 그대로");
  assert.equal(read(app.repo, "a.txt"), "line1\nline2\nline3\n", "합치지 않은 작업은 기본 브랜치에 없다");
  assert.equal(run(remote, "for-each-ref", "--format=%(refname)"), before, "원격에는 임시 브랜치가 올라가지 않았다");
  // 이미 정리된 것을 또 정리해도 괜찮다
  assert.equal(removeWorktree({ repoDir: app.repo, wtDir: j.wtDir, branch: j.branch }).dirRemoved, true);
});

test("작업 사본 정리 방식은 rm -rf 가 아니고, 어디에도 push 가 없다", () => {
  for (const file of ["worktree.mjs", "merge.mjs", "applock.mjs"]) {
    const src = fs.readFileSync(path.join(SUP, file), "utf8").replace(/\/\/.*$/gm, "");

    assert.doesNotMatch(src, /"push"|'push'|git push/, `${file}: push 없음`);
    assert.doesNotMatch(src, /rmSync\(|rm -rf|recursive: true, force/, `${file}: 재귀 삭제 없음`);
  }
  const sup = fs.readFileSync(path.join(SUP, "supervisor.mjs"), "utf8").replace(/\r\n/g, "\n");
  const body = sup.slice(sup.indexOf("function cleanupWorktree"), sup.indexOf("async function withAppLock"));

  assert.match(body, /removeWorktree\(/);
  assert.doesNotMatch(body, /rmSync/);
  assert.match(sup, /cleanupWorktree\(job\); \/\/ 병행 일감: 사본·임시 브랜치 정리\(성공·실패 모두\)/);
});

test("재시작 정리: 지난 실행이 남긴 사본·임시 브랜치를 이어받지 않고 정리한다(돌고 있는 것은 skip 으로 보호)", { skip }, () => {
  const app = makeApp();
  const j1 = startJob(app, "cjob003");
  const j2 = startJob(app, "cjob004");
  // 사본 폴더는 이미 없는데 브랜치만 남은 경우
  run(app.repo, "branch", "factory/job-orphan1");
  const logs = [];
  const protectedRun = cleanupLeftovers({ workDir: app.workDir, log: (m) => logs.push(m), skip: (b) => b === j2.branch });

  assert.equal(fs.existsSync(j1.wtDir), false);
  assert.equal(fs.existsSync(j2.wtDir), true, "skip 한 사본은 그대로");
  assert.equal(git(app.repo, ["rev-parse", "--verify", "--quiet", "refs/heads/factory/job-orphan1"]).ok, false, "사본 없이 남은 브랜치도 지움");
  assert.equal(protectedRun.worktrees, 1);
  assert.ok(protectedRun.branches >= 2);
  assert.match(logs.join("\n"), /지난 실행이 남긴 작업 사본 정리/);
  const all = cleanupLeftovers({ workDir: app.workDir, log: () => {} });

  assert.equal(all.worktrees, 1);
  assert.deepEqual(listFactoryWorktrees(app.repo), []);
  assert.equal(currentBranch(app.repo), "main");
  assert.deepEqual(cleanupLeftovers({ workDir: path.join(app.workDir, "없는폴더"), log: () => {} }), { worktrees: 0, branches: 0, kept: 0 }, "작업 폴더가 없어도 던지지 않음");
});

test("결과 커밋: 공장 파일(PLAN.md·CHANGE_REQUEST.md·CLAUDE.md)은 빼서 일감끼리 충돌하지 않게 한다", { skip }, () => {
  const app = makeApp();
  const j = startJob(app, "cjob005");

  write(j.wtDir, "b.txt", "b-new\n");
  assert.equal(commitAll(j.wtDir, "수정: b"), true);
  const files = run(j.wtDir, "show", "--name-only", "--format=", "HEAD").split("\n");

  assert.deepEqual(files, ["b.txt"], "기능 파일만 커밋");
  assert.equal(read(j.wtDir, "CHANGE_REQUEST.md"), "# 처음 요청\n", "추적 중이던 공장 파일은 기본 상태로 되돌림");
  assert.equal(fs.existsSync(path.join(j.wtDir, "PLAN.md")), false, "새로 생긴 PLAN.md 는 지움");
  assert.equal(commitAll(j.wtDir, "또"), false, "바뀐 게 없으면 커밋하지 않음");
  stripFactoryFiles(j.wtDir);
});

// ───────────── 합치기 ─────────────
test("합치기: 서로 다른 파일을 고친 일감 둘이 동시에 끝나도 끝난 순서대로 하나씩 합치고, 합칠 때마다 검사한다", { skip }, async () => {
  const app = makeApp();
  const A = startJob(app, "jobA");
  const B = startJob(app, "jobB");

  write(A.wtDir, "a.txt", "line1\nline2-A\nline3\n");
  write(B.wtDir, "b.txt", "b-from-B\n");
  const order = [];
  const ca = ctxFor(app, A, { verify: async (dir) => (order.push(`A검사:${read(dir, "b.txt").trim()}`), { ok: true }) });
  const cb = ctxFor(app, B, { verify: async (dir) => (order.push(`B검사:${read(dir, "a.txt").split("\n")[1]}`), { ok: true }) });
  // 동시에 시작: A 가 먼저 잠금을 얻고, B 는 기다렸다가 A 가 합친 결과를 받아 검사한다
  const [ra, rb] = await Promise.all([mergeJob(ca.ctx), (async () => (await sleep(30), mergeJob(cb.ctx)))()]);

  assert.equal(ra.ok, true);
  assert.equal(rb.ok, true);
  assert.equal(ra.rebases, 0);
  assert.equal(rb.rebases, 0);
  assert.deepEqual(order, ["A검사:b-base", "B검사:line2-A"], "B 는 A 가 먼저 합친 내용을 포함한 상태에서 검사");
  assert.equal(read(app.repo, "a.txt"), "line1\nline2-A\nline3\n");
  assert.equal(read(app.repo, "b.txt"), "b-from-B\n");
  assert.equal(currentBranch(app.repo), "main");
  assert.equal(run(app.repo, "status", "--porcelain"), "", "앱 폴더는 깨끗하다");
  const subjects = run(app.repo, "log", "--format=%s", "-n", "4").split("\n");
  assert.ok(subjects.includes("수정: 일감 jobA") && subjects.includes("수정: 일감 jobB"), "두 일감의 결과가 모두 기본 브랜치에 있다");
  // 공장 파일이 합쳐지지 않았다
  assert.equal(read(app.repo, "CHANGE_REQUEST.md"), "# 처음 요청\n");
  assert.equal(fs.existsSync(path.join(app.repo, "PLAN.md")), false);
  // 병행 상태 보고: 합치는 중 켜고 끄기, 합친 시각·검사 결과
  assert.ok(ca.reports.some((p) => p.merging === true) && ca.reports.some((p) => p.merging === false));
  const done = ca.reports.find((p) => p.mergedAt);
  assert.match(done.mergedAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  assert.match(done.checks, /^통과/);
  assert.equal(order.length, 2, "합칠 때마다 한 번씩 검사(일감 둘 = 검사 둘)");
  assert.equal(ca.calls.askFix.length + cb.calls.askFix.length, 0, "충돌이 없으면 AI 에게 되돌려 보내지 않음");
});

test("글자 충돌: 이 일감 AI 에게 다시 맞추기를 되돌려 보내고, 해결하면 합친다(1회)", { skip }, async () => {
  const app = makeApp();
  const A = startJob(app, "jobC");
  const B = startJob(app, "jobD");

  write(A.wtDir, "a.txt", "line1\nline2-from-A\nline3\n");
  write(B.wtDir, "a.txt", "line1\nline2-from-B\nline3\n");
  assert.equal((await mergeJob(ctxFor(app, A).ctx)).ok, true);
  assert.equal(read(app.repo, "a.txt").split("\n")[1], "line2-from-A");

  const fixes = [];
  const cb = ctxFor(app, B, {
    askFix: async (prompt, n) => {
      fixes.push({ prompt, n, markers: read(B.wtDir, "a.txt").includes("<<<<<<<") });
      // 가짜 AI: 두 쪽 변경을 모두 살려 충돌을 해결하고 합치기를 끝낸다
      write(B.wtDir, "a.txt", "line1\nline2-from-A\nline2-from-B\nline3\n");
      run(B.wtDir, "add", "a.txt");
      run(B.wtDir, "commit", "-q", "--no-edit");
      return { ok: true };
    },
  });
  const r = await mergeJob(cb.ctx);

  assert.equal(r.ok, true);
  assert.equal(r.rebases, 1);
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].n, 1);
  assert.equal(fixes[0].markers, true, "AI 가 받은 사본에는 충돌 표시가 남아 있다");
  assert.match(fixes[0].prompt, /다시 맞추기 1\/2/);
  assert.match(fixes[0].prompt, /글자 충돌/);
  assert.match(fixes[0].prompt, /- a\.txt/);
  assert.match(fixes[0].prompt, /최신 기본 브랜치\(main\)/);
  assert.match(fixes[0].prompt, /요청 jobD/);
  assert.equal(read(app.repo, "a.txt"), "line1\nline2-from-A\nline2-from-B\nline3\n");
  assert.deepEqual(cb.reports.filter((p) => "rebases" in p && !("mergedAt" in p)).map((p) => p.rebases), [1], "다시 맞추기 횟수를 보고");
  assert.equal(cb.reports.find((p) => p.mergedAt).rebases, 1);
  assert.match(cb.logs.join("\n"), /합치기 실패\(글자 충돌: a\.txt\)/);
  assert.equal(cb.calls.verify, 1, "충돌을 푼 뒤에 검사");
});

test("검사 실패: 합친 상태에서 검사가 실패하면 다시 맞추기를 요청하고, 고치면 합친다", { skip }, async () => {
  const app = makeApp();
  const A = startJob(app, "jobE");

  write(A.wtDir, "status.txt", "BAD\n"); // 이 일감 자체가 검사를 깨뜨림
  const fixes = [];
  const ca = ctxFor(app, A, {
    askFix: async (prompt, n) => {
      fixes.push({ prompt, n });
      write(A.wtDir, "status.txt", "FIXED\n");
      run(A.wtDir, "add", "-A");
      run(A.wtDir, "commit", "-q", "-m", "검사 통과하도록 고침");
      return { ok: true };
    },
  });
  const r = await mergeJob(ca.ctx);

  assert.equal(r.ok, true);
  assert.equal(r.rebases, 1);
  assert.match(fixes[0].prompt, /검사 실패/);
  assert.match(fixes[0].prompt, /시험 실패: status\.txt 에 BAD/);
  assert.equal(ca.calls.verify, 2, "실패 한 번, 통과 한 번");
  assert.equal(read(app.repo, "status.txt"), "FIXED\n");
  assert.equal(run(app.repo, "log", "--format=%s", "-n", "1"), "검사 통과하도록 고침");
});

test("합치기 실패 → 다시 맞추기 2회 → 보고: 그 일감만 멈추고, 이미 합쳐진 일감은 그대로, 작업 내용은 패치 파일로 남긴 뒤 사본을 정리한다", { skip }, async () => {
  const app = makeApp();
  const A = startJob(app, "jobF");
  const B = startJob(app, "jobG");

  write(A.wtDir, "a.txt", "line1\nline2-A\nline3\n");
  assert.equal((await mergeJob(ctxFor(app, A).ctx)).ok, true);
  const mainAfterA = run(app.repo, "rev-parse", "main");

  // B 는 같은 줄을 고쳐 충돌하고, AI 가 두 번 다시 맞춰도 고치지 못한다
  write(B.wtDir, "a.txt", "line1\nline2-B\nline3\n");
  const cb = ctxFor(app, B, { askFix: async (prompt, n) => (cb.calls.askFix.push({ prompt, n }), { ok: true }) });
  const r = await mergeJob(cb.ctx);

  assert.equal(MAX_REBASES, 2);
  assert.equal(r.ok, false);
  assert.equal(r.rebases, 2, "다시 맞추기는 최대 2회");
  assert.equal(cb.calls.askFix.length, 2);
  assert.deepEqual(cb.calls.askFix.map((c) => c.n), [1, 2]);
  assert.match(r.reason, /2번 다시 맞춰도 합치지 못했어요/);
  assert.match(r.reason, /글자 충돌: a\.txt/);
  assert.equal(run(app.repo, "rev-parse", "main"), mainAfterA, "실패한 일감은 기본 브랜치를 건드리지 않았고, 먼저 합쳐진 A 는 그대로");
  assert.equal(read(app.repo, "a.txt").split("\n")[1], "line2-A");
  assert.equal(run(app.repo, "status", "--porcelain"), "", "앱 폴더는 깨끗하다");
  assert.deepEqual(cb.reports.filter((p) => "rebases" in p).map((p) => p.rebases), [1, 2], "보고된 다시 맞추기 횟수");
  assert.equal(cb.reports.some((p) => p.mergedAt), false, "합쳐지지 않았다");

  // 실패 보고 전에: 작업 내용을 패치로 남기고(.factory/history), 사본·임시 브랜치를 정리
  run(B.wtDir, "merge", "--abort"); // 충돌이 남은 합치기를 접으면 B 의 작업 커밋만 남는다
  const patch = savePatch({ repoDir: app.repo, base: "main", branch: B.branch, jobId: "jobG" });

  assert.ok(patch && fs.existsSync(patch));
  assert.match(fs.readFileSync(patch, "utf8"), /line2-B/);
  assert.equal(path.relative(app.repo, patch).split(path.sep).join("/"), ".factory/history/jobG.merge-failed.patch");
  removeWorktree({ repoDir: app.repo, wtDir: B.wtDir, branch: B.branch });
  assert.equal(fs.existsSync(B.wtDir), false);
  assert.equal(run(app.repo, "status", "--porcelain"), "", "패치 파일은 .factory 아래라 git 에 잡히지 않음");
  // 풀어 주면 같은 일감을 처음부터 다시 실행할 수 있다(새 사본, 최신 기본 브랜치 기준)
  const retry = startJob(app, "jobG");

  assert.equal(read(retry.wtDir, "a.txt").split("\n")[1], "line2-A");
});

test("다시 맞추기 중 AI 가 실패하면 거기서 멈춘다 / 앱 폴더가 더럽거나 기본 브랜치가 아니면 AI 에게 보내지 않고 바로 실패", { skip }, async () => {
  const app = makeApp();
  const A = startJob(app, "jobH");

  write(A.wtDir, "status.txt", "BAD\n");
  const failing = ctxFor(app, A, { askFix: async () => ({ ok: false, reason: "AI 가 비정상 종료" }) });
  const r = await mergeJob(failing.ctx);

  assert.equal(r.ok, false);
  assert.equal(r.rebases, 1);
  assert.match(r.reason, /다시 맞추기 중 작업이 끝나지 않았어요: AI 가 비정상 종료/);

  // 앱 폴더에 커밋 안 된 변경 → 치명적(사람이 정리)
  const B = startJob(app, "jobI");

  write(B.wtDir, "b.txt", "b-I\n");
  write(app.repo, "b.txt", "사람이 손댄 변경\n");
  const dirty = ctxFor(app, B);
  const d = await mergeJob(dirty.ctx);

  assert.equal(d.ok, false);
  assert.match(d.reason, /커밋 안 된 변경 1개가 있어 합칠 수 없어요/);
  assert.equal(dirty.calls.askFix.length, 0);
  assert.equal(dirty.calls.verify, 0, "더러운 앱 폴더에는 합치지도 검사하지도 않음");
  run(app.repo, "checkout", "--", "b.txt");

  // 앱 폴더가 다른 브랜치에 있음
  run(app.repo, "checkout", "-q", "-b", "side");
  const e = await mergeJob(ctxFor(app, B).ctx);

  assert.equal(e.ok, false);
  assert.match(e.reason, /기본 브랜치\(main\)에 있지 않아요/);
});

test("다시 맞추기 지시문: 충돌 파일·검사 로그·원래 요청을 담고, 새 기능·push 는 하지 말라고 한다", () => {
  const conflict = fixPrompt({ problem: { kind: "conflict", files: ["lib/a.dart", "lib/b.dart"] }, base: "master", request: "로그인 버튼 색 바꾸기", attempt: 2, max: 2 });

  assert.match(conflict, /다시 맞추기 2\/2/);
  assert.match(conflict, /master/);
  assert.match(conflict, /- lib\/a\.dart\n- lib\/b\.dart/);
  assert.match(conflict, /로그인 버튼 색 바꾸기/);
  assert.match(conflict, /push 하지 마세요/);
  const checks = fixPrompt({ problem: { kind: "checks", reason: "x".repeat(5000) + "끝줄" }, base: "main", request: "", attempt: 1, max: 2 });

  assert.match(checks, /검사 실패/);
  assert.match(checks, /끝줄/, "로그는 뒷부분을 남긴다");
  assert.ok(checks.length < 3000, "너무 길지 않다");
  assert.doesNotMatch(checks, /## 이 일감의 원래 요청/);
});

// ───────────── 감독 프로그램 연결(원문 확인) ─────────────
test("감독 프로그램 연결: 병행 그룹 수정 일감만 사본에서 돌고, 끝난 뒤 합치기·정리·재시작 정리·드레인이 이어져 있다", () => {
  const sup = fs.readFileSync(path.join(SUP, "supervisor.mjs"), "utf8").replace(/\r\n/g, "\n");

  assert.match(sup, /const isWorktreeJob = \(job\) => job\.kind === "revision" && typeof job\.parallelGroup === "string"/);
  assert.match(sup, /job\.worktree = await setupWorktree\(job, home\)/);
  assert.match(sup, /else if \(job\.worktree && st\.result && !st\.result\.is_error/);
  assert.match(sup, /await finishWorktree\(st\)/);
  assert.match(sup, /failStage: "merge"/, "합치기 실패는 failStage=merge 로 보고");
  assert.match(sup, /cleanupLeftovers\(\{ workDir: cfg\.workDir, log \}\)/, "시작 때 남은 사본 정리");
  assert.match(sup, /clearLocks\(lockDir\(\)\)/);
  // 같은 앱 이름 검사는 병행 일감끼리만 통과
  assert.match(sup, /!\(isWorktreeJob\(job\) && sameApp\.every\(\(s\) => isWorktreeJob\(s\.job\)\)\)/);
  // 업데이트·재시작은 병행 일감까지 다 끝난 뒤(running 이 병행 일감을 모두 센다)
  assert.match(sup, /maybeUpdate\(\{ running: running\.size \+/);
  assert.match(sup, /maybeRestart\(\{ busy: running\.size > 0/);
  // 인계 기록·작업 메모리는 사본이 아니라 앱 폴더에
  assert.match(sup, /saveHandoff\(home,/);
  // 잠금 대기가 일감 로그와 통제실 보고에 실린다
  assert.match(sup, /⏳ 잠금 대기/);
  assert.match(sup, /sentParallel/);
  // 규칙 안내(AI 가 잠금 명령을 쓰게)
  assert.match(sup, /lockRules\(path\.join\(SUPERVISOR_DIR, "applock\.mjs"\)\)/);
  // 정비 폴더는 앱 폴더를 건드리지 않는다: 이 기능의 코드는 일감 실행 안에서만 앱 폴더·사본을 쓴다
  assert.doesNotMatch(fs.readFileSync(path.join(SUP, "maintenance.mjs"), "utf8"), /worktree|applock/);
});
