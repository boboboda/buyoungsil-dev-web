// 병렬화 단계 C-1 끝에서 끝까지 시험: 진짜 감독 프로그램(supervisor.mjs)을 임시 폴더·가짜 홈페이지·가짜 Claude 로 돌린다.
//   같은 앱의 병행 그룹 수정 일감 여러 개가 작업 사본(git worktree)에서 동시에 돌고 → 잠금 대기가 보이고 → 끝난 순서대로 기본 브랜치에 합쳐지고 →
//   글자 충돌은 그 일감 AI 에게 다시 맞추기로 되돌려 보내 해결하고 → 끝내 못 고치면 그 일감만 '합치기 실패'(failStage=merge)로 보고하고 →
//   끝나면 사본·임시 브랜치가 정리되고, 감독 프로그램이 켜질 때 남은 사본은 정리된다.
// 격리: 홈 폴더·작업 폴더·상태 파일이 모두 임시 폴더이고 자동 업데이트는 꺼져 있으며(서버가 autoUpdate:false), 진짜 AI·서버·원격 저장소는 쓰지 않는다.
// 실행: node tools/factory-supervisor/tests/worktree-e2e.test.mjs (시나리오마다 15~40초)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listFactoryWorktrees } from "../worktree.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUP = path.resolve(HERE, "..");
const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0 && spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const skip = !canSpawn && "host sandbox blocks child processes";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IS_WIN = process.platform === "win32";
const AUTHOR = ["-c", "user.name=tester", "-c", "user.email=t@localhost"];
const run = (dir, ...args) => {
  const r = spawnSync("git", [...AUTHOR, ...args], { cwd: dir, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

/** 앱 저장소(main): 파일 몇 개 + 가짜 타입 검사기(status.txt 에 BAD 가 있으면 실패) */
function makeApp(root, slug) {
  const repo = path.join(root, "work", slug);
  fs.mkdirSync(repo, { recursive: true });
  run(repo, "init", "-q", "-b", "main");
  run(repo, "config", "core.autocrlf", "false");
  put(repo, ".gitignore", ".factory/\nnode_modules/\n");
  put(repo, "a.txt", "line1\nline2\nline3\n");
  put(repo, "b.txt", "b-base\n");
  put(repo, "status.txt", "OK\n");
  put(repo, "CLAUDE.md", "# 앱 규칙\n");
  put(repo, "CHANGE_REQUEST.md", "# 이전 수정 요청\n");
  put(repo, "node_modules/typescript/bin/tsc", `const fs = require("fs");\nprocess.exit(fs.readFileSync("status.txt", "utf8").includes("BAD") || fs.readFileSync("a.txt", "utf8").includes("<<<<<<<") ? 1 : 0);\n`);
  run(repo, "add", "-A");
  run(repo, "commit", "-q", "-m", "init");
  return repo;
}

/** 가짜 홈페이지: 첫 확인에 일감을 모두 내주고, 보고를 모은다 */
async function startServer(jobs) {
  const state = { reports: [], served: false, requests: 0 };
  const server = http.createServer((req, res) => {
    state.requests++;
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (status, data) => (res.writeHead(status, { "Content-Type": "application/json" }), res.end(JSON.stringify(data)));
      const url = new URL(req.url, "http://x");

      if (url.pathname === "/api/factory/next") {
        const slots = Number(url.searchParams.get("slots") ?? "0");
        const out = !state.served && slots > 0 ? jobs.slice(0, slots) : [];

        if (out.length) state.served = true;

        return send(200, { jobs: out, autoUpdate: false, compactAfterJob: false, appSlots: 3, appSlotsDefault: false });
      }
      if (url.pathname === "/api/factory/report" && req.method === "POST") {
        try {
          state.reports.push(JSON.parse(body));
        } catch {
          /* 무시 */
        }

        return send(200, { ok: true });
      }

      return send(200, {});
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return { server, state, url: `http://127.0.0.1:${server.address().port}` };
}

const job = (id, title, over = {}) => ({
  id,
  appSlug: "demo-app",
  title,
  kind: "revision",
  parentJobId: null,
  stack: "nestjs",
  priority: 0,
  requiredSecrets: [],
  planMarkdown: `${title}: 요청 본문`,
  attempts: 1,
  aiEngine: "claude",
  aiModel: null,
  parallelGroup: "g-e2e001",
  ...over,
});

/** 시나리오 하나: 일감들을 가짜 홈페이지에 두고 감독 프로그램을 띄워, 모두 끝(done/failed)나면 끈다 */
async function runScenario({ jobs, scenario, prepare, expectDone }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wt-e2e-"));
  const home = path.join(root, "home");
  const fixtures = path.join(root, "fixtures");

  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(fixtures, { recursive: true });
  for (const f of ["fake-claude.mjs", "fake-claude.cmd", "fake-claude.sh"]) fs.copyFileSync(path.join(HERE, "fixtures", f), path.join(fixtures, f));
  if (!IS_WIN) fs.chmodSync(path.join(fixtures, "fake-claude.sh"), 0o755);
  const repo = makeApp(root, "demo-app");

  prepare?.({ root, repo });
  fs.writeFileSync(path.join(root, "secrets.env"), "");
  fs.writeFileSync(path.join(root, "scenario.json"), JSON.stringify(scenario));
  const { server, state, url } = await startServer(jobs);
  const config = {
    serverUrl: url,
    token: "e2e-token-0123456789abcdef",
    worker: "e2e",
    workDir: path.join(root, "work"),
    secretsFile: path.join(root, "secrets.env"),
    pollSec: 5,
    heartbeatSec: 5,
    jobTimeoutMin: 5,
    claudeCmd: path.join(fixtures, IS_WIN ? "fake-claude.cmd" : "fake-claude.sh"),
    codexEnabled: false,
    selfdevDir: path.join(root, "selfdev"),
    memoryRemote: "",
    toolkitDir: path.join(root, "toolkit"),
    appKitDir: path.join(root, "app-kit"),
    slots: 3,
  };

  fs.writeFileSync(path.join(root, "supervisor.config.json"), JSON.stringify(config));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    FACTORY_CONFIG: path.join(root, "supervisor.config.json"),
    FACTORY_UPDATE_STATE: path.join(root, "update.json"),
    FACTORY_RESTART_STATE: path.join(root, "restart.json"),
    FACTORY_LAUNCHER_LOCK: path.join(root, "launcher.pid"),
    FAKE_SCENARIO: path.join(root, "scenario.json"),
    FAKE_CALLS: path.join(root, "calls.log"),
    FAKE_APPLOCK: path.join(SUP, "applock.mjs"),
  };

  for (const k of ["FACTORY_LAUNCHER", "CLAUDE_STATUS_TOKEN", "CLAUDE_STATUS_URL", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]) delete env[k];
  const child = spawn(process.execPath, [path.join(SUP, "supervisor.mjs")], { cwd: SUP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let out = "";

  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const finalOf = (id) => state.reports.find((r) => r.jobId === id && (r.status === "done" || r.status === "failed"));
  const end = Date.now() + 120_000;

  while (Date.now() < end && !jobs.every((j) => finalOf(j.id))) await sleep(250);
  // 완료 보고 뒤에 감독 프로그램이 인계 기록을 쓰고 사본을 정리한다: 정리가 끝날 때까지 기다렸다가 끈다
  const cleanEnd = Date.now() + 40_000;

  while (Date.now() < cleanEnd && listFactoryWorktrees(repo).length > 0) await sleep(250);
  await sleep(300);
  child.kill();
  await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.on("close", resolve)));
  await new Promise((resolve) => server.close(resolve));
  void expectDone;

  const calls = fs.existsSync(env.FAKE_CALLS) ? fs.readFileSync(env.FAKE_CALLS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

  return { root, repo, state, out, calls, finalOf };
}

const history = (r, id) => r.state.reports.filter((x) => x.jobId === id);
const logsOf = (r, id) => history(r, id).flatMap((x) => x.logs ?? []).map((l) => l.message);

test("병행 그룹 수정 일감 3개: 작업 사본에서 동시에 돌고, 잠금 대기가 보이고, 끝난 순서대로 합쳐지고, 글자 충돌은 다시 맞추기로 풀리고, 사본은 정리된다", { skip, timeout: 160_000 }, async () => {
  const jobs = [job("J1", "일감 하나: a 줄 바꾸기"), job("J2", "일감 둘: b 파일 바꾸기"), job("J3", "일감 셋: a 줄 바꾸기(충돌)")];
  const scenario = {
    J1: { work: [{ write: { file: "a.txt", text: "line1\nJ1\nline3\n" } }, { lock: { name: "build", ms: 5000 } }] },
    J2: { work: [{ wait: 800 }, { write: { file: "b.txt", text: "b-J2\n" } }, { lock: { name: "build", ms: 300 } }] },
    J3: {
      work: [{ wait: 14000 }, { write: { file: "a.txt", text: "line1\nJ3\nline3\n" } }],
      fix1: [{ write: { file: "a.txt", text: "line1\nJ1\nJ3\nline3\n" } }, { git: ["add", "a.txt"] }, { git: ["commit", "-q", "--no-edit"] }],
    },
  };
  const left = { wt: null };
  const r = await runScenario({
    jobs,
    scenario,
    prepare: ({ repo }) => {
      // 지난 실행이 남긴 사본·임시 브랜치(이어받지 않고 켜질 때 정리돼야 한다)
      run(repo, "worktree", "add", "-q", "-b", "factory/job-oldleft", path.join(path.dirname(repo), ".worktrees", "demo-app-oldleft"), "main");
      left.wt = path.join(path.dirname(repo), ".worktrees", "demo-app-oldleft");
    },
  });

  for (const j of jobs) assert.equal(r.finalOf(j.id)?.status, "done", `${j.id} 완료 (${logsOf(r, j.id).slice(-4).join(" | ")})\n${r.out.slice(-1500)}`);

  // 켜질 때 지난 실행의 사본 정리
  assert.match(r.out, /지난 실행이 남긴 작업 사본 정리: 사본 1개/);
  assert.equal(fs.existsSync(left.wt), false);

  // 일감마다 자기 작업 사본(.worktrees)에서 실행, 규칙에 잠금 명령 안내, 같은 앱이라도 동시에
  const first = r.calls.filter((c) => c.turn === 0);
  assert.equal(first.length, 3);
  for (const c of first) {
    assert.ok(c.cwd.includes(`${path.sep}.worktrees${path.sep}demo-app-${c.id}`), `${c.id} 는 작업 사본에서: ${c.cwd}`);
    assert.ok(c.lockDir?.endsWith(".locks") && c.hasWaitFile, "AI 에 잠금 폴더·대기 표시 파일 환경이 있다");
  }
  assert.ok(r.out.includes("작업 사본 만듦: factory/job-J1") && r.out.includes("작업 사본 만듦: factory/job-J2"));
  const claudeMd = fs.existsSync(path.join(r.repo, "CLAUDE.md")) ? fs.readFileSync(path.join(r.repo, "CLAUDE.md"), "utf8") : "";
  assert.equal(claudeMd, "# 앱 규칙\n", "공장 규칙·요청 파일은 기본 브랜치에 합쳐지지 않는다");
  assert.equal(fs.readFileSync(path.join(r.repo, "CHANGE_REQUEST.md"), "utf8"), "# 이전 수정 요청\n");

  // 병행 상태가 통제실에 보고됨: worktree 실행, 잠금 대기(기다린 쪽), 합치는 중, 합친 시각·검사
  const infos = (id) => history(r, id).map((x) => x.parallel).filter(Boolean);
  assert.ok(infos("J1").every((p) => p.worktree === true) && infos("J1").length > 0);
  const waited = ["J1", "J2"].filter((id) => infos(id).some((p) => p.lockWait?.name === "build"));
  assert.equal(waited.length, 1, "한쪽만 빌드 잠금을 기다렸다");
  const waiter = waited[0];
  assert.ok(logsOf(r, waiter).some((m) => /잠금 대기: 빌드/.test(m)), "일감 로그에 잠금 대기가 남는다");
  assert.ok(logsOf(r, waiter).some((m) => /잠금 얻음: 빌드/.test(m)));
  for (const j of jobs) {
    const fin = infos(j.id).at(-1);
    assert.match(fin.mergedAt, /^\d{4}-\d{2}-\d{2}T/, `${j.id} 합친 시각`);
    assert.match(fin.checks, /^통과/);
  }
  assert.ok(jobs.some((j) => infos(j.id).some((p) => p.merging === true)), "합치는 중이 보고된다");
  assert.equal(infos("J1").at(-1).rebases, 0);
  assert.equal(infos("J2").at(-1).rebases, 0);
  assert.equal(infos("J3").at(-1).rebases, 1, "충돌한 J3 는 다시 맞추기 1회");
  assert.deepEqual(r.calls.filter((c) => c.turn > 0).map((c) => `${c.id}:${c.turn}`), ["J3:1"], "다시 맞추기는 충돌한 일감에게만");
  assert.ok(logsOf(r, "J3").some((m) => /합치기 실패\(글자 충돌: a\.txt\)/.test(m)));
  assert.ok(logsOf(r, "J3").some((m) => /기본 브랜치\(main\)에 합쳤어요 \(다시 맞추기 1회\)/.test(m)));
  const mergedOrder = jobs.map((j) => ({ id: j.id, at: infos(j.id).at(-1).mergedAt })).sort((x, y) => x.at.localeCompare(y.at)).map((x) => x.id);
  assert.equal(mergedOrder.at(-1), "J3", "늦게 끝난 J3 가 마지막에 합쳐졌다");

  // 합친 결과: 세 일감 변경이 모두 기본 브랜치에, 앱 폴더는 깨끗하고 기본 브랜치 그대로
  assert.equal(fs.readFileSync(path.join(r.repo, "a.txt"), "utf8"), "line1\nJ1\nJ3\nline3\n");
  assert.equal(fs.readFileSync(path.join(r.repo, "b.txt"), "utf8"), "b-J2\n");
  assert.equal(run(r.repo, "branch", "--show-current"), "main");
  assert.equal(run(r.repo, "status", "--porcelain"), "");

  // 정리: 사본·임시 브랜치가 하나도 남지 않고, 원본 의존성 폴더도 그대로
  assert.deepEqual(listFactoryWorktrees(r.repo), []);
  assert.equal(run(r.repo, "branch", "--list", "factory/job-*"), "");
  assert.ok(fs.existsSync(path.join(r.repo, "node_modules", "typescript", "bin", "tsc")));
  assert.deepEqual(fs.readdirSync(path.join(r.root, "work", ".worktrees")), [], "사본 폴더가 비었다");
  assert.deepEqual(fs.readdirSync(path.join(r.root, "work", ".locks")), [], "잠금 파일이 남지 않았다");
});

test("끝내 못 맞추는 일감: 다시 맞추기 2회 뒤 그 일감만 '합치기 실패'(failStage=merge)로 보고하고, 이미 합쳐진 일감은 그대로", { skip, timeout: 160_000 }, async () => {
  const jobs = [job("K1", "먼저 끝나는 일감"), job("K2", "충돌만 하는 일감")];
  const scenario = {
    K1: { work: [{ write: { file: "a.txt", text: "line1\nK1\nline3\n" } }] },
    K2: { work: [{ wait: 9000 }, { write: { file: "a.txt", text: "line1\nK2\nline3\n" } }] }, // fix1·fix2 는 비어 있다 = AI 가 충돌을 못 고침
  };
  const r = await runScenario({ jobs, scenario });

  assert.equal(r.finalOf("K1")?.status, "done", r.out.slice(-1500));
  const failed = r.finalOf("K2");
  assert.equal(failed?.status, "failed", r.out.slice(-1500));
  assert.equal(failed.failStage, "merge");
  assert.match(failed.failReason, /^합치기 실패\(다시 맞추기 2회\)/);
  assert.match(failed.failReason, /글자 충돌: a\.txt/);
  assert.match(failed.failReason, /\.factory\/history\/K2\.merge-failed\.patch/);
  assert.equal(failed.parallel.rebases, 2);
  assert.equal(failed.parallel.checks, "합치기 실패");
  assert.deepEqual(r.calls.filter((c) => c.id === "K2" && c.turn > 0).map((c) => c.turn), [1, 2], "다시 맞추기는 최대 2회");
  assert.deepEqual(history(r, "K2").map((x) => x.parallel?.rebases).filter((n) => n !== undefined).filter((n, i, a) => a.indexOf(n) === i && n > 0), [1, 2]);
  assert.ok(logsOf(r, "K2").some((m) => /최신 main 기준으로 다시 맞추라고 되돌려 보내요 \(1\/2\)/.test(m)));
  assert.ok(logsOf(r, "K2").some((m) => /최신 main 기준으로 다시 맞추라고 되돌려 보내요 \(2\/2\)/.test(m)));

  // 이미 합쳐진 K1 은 그대로, K2 의 변경은 기본 브랜치에 없다
  assert.equal(fs.readFileSync(path.join(r.repo, "a.txt"), "utf8"), "line1\nK1\nline3\n");
  assert.equal(run(r.repo, "status", "--porcelain"), "");
  const patch = path.join(r.repo, ".factory", "history", "K2.merge-failed.patch");
  assert.ok(fs.existsSync(patch), "실패한 작업은 패치 파일로 남는다");
  assert.match(fs.readFileSync(patch, "utf8"), /line1\n\+K2|\+K2/);
  // 실패해도 사본·임시 브랜치는 정리된다
  assert.deepEqual(listFactoryWorktrees(r.repo), []);
  assert.equal(run(r.repo, "branch", "--list", "factory/job-*"), "");
});
