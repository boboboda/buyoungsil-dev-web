// 병렬화 C 보완(감독 프로그램 쪽) 시험: 앱별 합치기·최종 점검 검사 명령.
//   - 서버가 내려 준 checkCommands("python -m unittest discover -s tests -q" 같은 한 줄)를 셸 없이 실행할 명령으로 읽는다(셸 글자·너무 긴 줄은 버림)
//   - verifyWorkspace: stack 기본 검사 뒤에 추가 명령을 돌리고, 돌린 명령 이름(ran)을 돌려준다. 추가 명령이 없으면 예전과 똑같다
//   - 추가 명령이 실패하면 그 이유로 실패, stack 기본 검사를 못 쓰는 stack 이어도 추가 명령은 돈다
//   - mergeJob: 합친 뒤 검사 결과 한 줄(checks)에 돌린 명령이 들어간다
// 진짜 git 은 합치기 시험에만, 검사 실행은 가짜 spawn 으로 한다. 실행: node tools/factory-supervisor/tests/checks.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import { customChecks, parseCheckCommand, verifyWorkspace } from "../ai-runner.mjs";
import { branchName, createWorktree, worktreePath } from "../worktree.mjs";
import { mergeJob } from "../merge.mjs";

const canSpawn = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const skip = !canSpawn && "host sandbox blocks child processes";
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** tsc 가 있는 가짜 nestjs 앱 폴더 */
function nestApp() {
  const dir = tmp("chk-app-");
  const tsc = path.join(dir, "node_modules", "typescript", "bin", "tsc");

  fs.mkdirSync(path.dirname(tsc), { recursive: true });
  fs.writeFileSync(tsc, "fixture");

  return dir;
}

/** 부른 명령을 기록하고 exitFor(command, args) 코드로 끝나는 가짜 spawn */
function recorder(exitFor = () => 0) {
  const calls = [];
  const transport = {
    spawn: (command, args, opts) => {
      calls.push({ command, args, cwd: opts?.cwd, shell: opts?.shell });
      const child = new EventEmitter();
      const code = exitFor(command, args);

      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.pid = 7;
      setTimeout(() => {
        if (code) child.stderr.write(`failed: ${args.join(" ")}`);
        child.exitCode = code;
        child.emit("close", code);
      }, 1);

      return child;
    },
    stop: () => {},
  };

  return { calls, transport };
}

test("parseCheckCommand: 공백으로 나누고 큰따옴표로 묶으며, 셸 글자·빈 줄·너무 긴 줄은 버린다", () => {
  assert.deepEqual(parseCheckCommand("python -m unittest discover -s tests -q"), { command: "python", args: ["-m", "unittest", "discover", "-s", "tests", "-q"], label: "python -m unittest discover -s tests -q" });
  assert.deepEqual(parseCheckCommand('node scripts/check.mjs "a b" c').args, ["scripts/check.mjs", "a b", "c"]);
  for (const bad of ["", "   ", "python -m pytest && rm -rf .", "a | b", "a; b", "a > out.txt", "echo `x`", "echo $HOME", "echo %PATH%", "x".repeat(201), 'node ""']) assert.equal(parseCheckCommand(bad), null, JSON.stringify(bad));
  assert.equal(parseCheckCommand(undefined), null);
  assert.equal(parseCheckCommand(42), null);
});

test("customChecks: 읽을 수 있는 줄만 남기고 최대 8개, 배열이 아니면 빈 목록", () => {
  assert.deepEqual(customChecks(undefined), []);
  assert.deepEqual(customChecks("python -m pytest"), []);
  assert.deepEqual(customChecks(["python -m pytest -q", "a && b", ""]).map((c) => c.label), ["python -m pytest -q"]);
  assert.equal(customChecks(Array.from({ length: 12 }, (_, i) => `node check${i}.mjs`)).length, 8);
});

test("추가 검사 명령이 없으면 예전과 똑같다: stack 기본 검사(tsc)만 돌고 ran 에 그 이름만 나온다", async () => {
  const dir = nestApp();
  const r = recorder();
  const v = await verifyWorkspace(dir, "nestjs", () => {}, 1000, () => {}, r.transport);

  assert.equal(v.ok, true);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].command, process.execPath);
  assert.deepEqual(v.ran, ["tsc --noEmit"]);
  for (const empty of [undefined, {}, { checks: [] }, { checks: null }]) {
    const rr = recorder();

    assert.deepEqual((await verifyWorkspace(dir, "nestjs", () => {}, 1000, () => {}, rr.transport, empty)).ran, ["tsc --noEmit"]);
    assert.equal(rr.calls.length, 1);
  }
});

test("앱별 검사 명령은 stack 기본 검사 뒤에 앱 폴더에서 셸 없이 돌고, 돌린 명령이 ran 에 나온다", async () => {
  const dir = nestApp();
  const r = recorder();
  const logs = [];
  const v = await verifyWorkspace(dir, "nestjs", (m) => logs.push(m), 1000, () => {}, r.transport, { checks: ["python -m unittest discover -s tests -q", "node scripts/lint.mjs"] });

  assert.equal(v.ok, true);
  assert.deepEqual(v.ran, ["tsc --noEmit", "python -m unittest discover -s tests -q", "node scripts/lint.mjs"]);
  assert.equal(r.calls.length, 3);
  assert.equal(r.calls[1].command, "python");
  assert.deepEqual(r.calls[1].args, ["-m", "unittest", "discover", "-s", "tests", "-q"]);
  assert.equal(r.calls[1].cwd, dir);
  assert.ok(!r.calls[1].shell, "셸을 쓰지 않는다");
  assert.ok(logs.some((l) => l.includes("python -m unittest discover -s tests -q")));
});

test("추가 검사가 실패하면 그 이유로 실패하고, 앞에서 실패하면 뒤 명령은 돌지 않는다", async () => {
  const dir = nestApp();
  const r = recorder((command) => (command === "python" ? 1 : 0));
  const v = await verifyWorkspace(dir, "nestjs", () => {}, 1000, () => {}, r.transport, { checks: ["python -m unittest -q", "node never.mjs"] });

  assert.equal(v.ok, false);
  assert.match(v.reason, /failed: -m unittest -q/);
  assert.deepEqual(v.ran, ["tsc --noEmit", "python -m unittest -q"]);
  assert.equal(r.calls.length, 2, "실패 뒤 명령은 돌리지 않음");
  // 기본 검사(tsc)가 실패하면 추가 명령까지 가지 않는다
  const r2 = recorder((command) => (command === process.execPath ? 2 : 0));
  const v2 = await verifyWorkspace(dir, "nestjs", () => {}, 1000, () => {}, r2.transport, { checks: ["python -m unittest -q"] });

  assert.equal(v2.ok, false);
  assert.equal(r2.calls.length, 1);
});

test("stack 기본 검사를 쓸 수 없는 stack 이어도 추가 명령이 있으면 그것만 돈다(없으면 예전처럼 실패)", async () => {
  const dir = tmp("chk-none-");
  const r = recorder();

  assert.equal((await verifyWorkspace(dir, "unsupported", () => {}, 1000, () => {}, r.transport)).ok, false);
  const v = await verifyWorkspace(dir, "unsupported", () => {}, 1000, () => {}, r.transport, { checks: ["node check.mjs"] });

  assert.equal(v.ok, true);
  assert.deepEqual(v.ran, ["node check.mjs"]);
});

test("합친 뒤 검사 결과 한 줄(checks)에 돌린 명령이 들어가고, 검사를 안 알려 주는 예전 verify 는 예전 문구 그대로", { skip }, async () => {
  const run = (dir, ...args) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@localhost", ...args], { cwd: dir, encoding: "utf8", windowsHide: true });

    assert.equal(r.status, 0, r.stderr);
  };
  const makeJob = (id) => {
    const workDir = tmp("chk-merge-");
    const repo = path.join(workDir, "demo-app");

    fs.mkdirSync(repo, { recursive: true });
    run(repo, "init", "-q", "-b", "main");
    run(repo, "config", "core.autocrlf", "false");
    fs.writeFileSync(path.join(repo, ".gitignore"), ".factory/\n");
    fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
    run(repo, "add", "-A");
    run(repo, "commit", "-q", "-m", "init");
    const wtDir = worktreePath(workDir, "demo-app", id);

    createWorktree({ repoDir: repo, wtDir, branch: branchName(id), base: "main" });
    fs.writeFileSync(path.join(wtDir, "a.txt"), `a-${id}\n`);

    return { workDir, repo, wtDir, branch: branchName(id), id };
  };
  const ctx = (j, verify) => ({ job: { id: j.id, title: j.id }, repoDir: j.repo, wtDir: j.wtDir, branch: j.branch, base: "main", request: "", log: () => {}, report: () => {}, withLock: (_n, fn) => fn(), verify, commit: undefined, askFix: async () => ({ ok: false, reason: "x" }) });
  const a = makeJob("jobA");
  const withRan = await mergeJob(ctx(a, async () => ({ ok: true, ran: ["tsc --noEmit", "python -m unittest discover -s tests -q"] })));

  assert.equal(withRan.ok, true);
  assert.match(withRan.checks, /^통과 \(최신 기본 브랜치와 합친 상태에서 빌드·시험: tsc --noEmit · python -m unittest discover -s tests -q\)$/);
  const b = makeJob("jobB");
  const plain = await mergeJob(ctx(b, async () => ({ ok: true })));

  assert.equal(plain.checks, "통과 (최신 기본 브랜치와 합친 상태에서 빌드·시험)");
});

test("연결: 합치기 검사·마지막 전체 점검이 job.checkCommands 를 넘기고, 최종 점검 보고에 돌린 검사가 들어간다", () => {
  const src = fs.readFileSync(new URL("../supervisor.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

  assert.equal((src.match(/\{ checks: job\.checkCommands \}/g) ?? []).length, 2, "합치기 검사와 최종 점검 두 곳");
  assert.match(src, /돌린 검사: /);
});
