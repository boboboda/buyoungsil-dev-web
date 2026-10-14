// 감독 업데이트 때 "일시 중지 → 업데이트 → 같은 세션으로 이어서"(1-2 D-2) 끝에서 끝까지 시험:
// 진짜 감독 프로그램(supervisor.mjs)을 임시 git 저장소에 복사해 임시 폴더·가짜 홈페이지(127.0.0.1)·가짜 Claude 로 돌리고, 작은 가짜 실행기가 껐다 켜 준다.
//   · 멈춤 → 업데이트(새 커밋 받음) → 새 감독이 같은 세션(--resume)으로 이어 줌
//   · 긴 명령은 끊고, 이어 줄 때 다시 실행하게 함
//   · 일감 시간 한도에서 멈춰 있던 시간은 뺀다
//   · 이어서 하기가 바로 실패하면 실패가 아니라 '다시 시작 필요'(failStage=resume)로 한 번만 보고
// 격리: 홈 폴더·작업 폴더·상태 파일(업데이트·재시작·멈춤)이 모두 임시 폴더이고 FACTORY_TEST_MODE=1 이다. 진짜 감독·AI·서버는 건드리지 않는다.
// 실행: node tools/factory-supervisor/tests/pause-e2e.test.mjs (시나리오마다 40~70초)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RESUME_MESSAGE } from "../pause.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUP = path.resolve(HERE, "..");
const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0 && spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const skip = !canSpawn && "host sandbox blocks child processes";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IS_WIN = process.platform === "win32";
const G = ["-c", "user.name=tester", "-c", "user.email=t@localhost", "-c", "core.autocrlf=false"];
const git = (cwd, ...a) => {
  const r = spawnSync("git", [...G, ...a], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const SESSION = "11111111-2222-3333-4444-555555555555";

/** 앱 저장소(main): 가짜 타입 검사기 포함 */
function makeApp(root, slug, tsc = "process.exit(0);\n") {
  const repo = path.join(root, "work", slug);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  put(repo, ".gitignore", ".factory/\nnode_modules/\n");
  put(repo, "a.txt", "line1\n");
  put(repo, "CLAUDE.md", "# 앱 규칙\n");
  put(repo, "node_modules/typescript/bin/tsc", tsc);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  return repo;
}

/** 감독 폴더 복사본이 든 저장소(work)와 origin, 그리고 새 커밋을 올려 둔 상태 */
function makeSupervisorRepos(root) {
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "sup");
  const other = path.join(root, "sup-other");
  fs.mkdirSync(origin);
  git(origin, "init", "-q", "--bare", "-b", "main");
  const dest = path.join(work, "tools", "factory-supervisor");
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(SUP)) if (f.endsWith(".mjs")) fs.copyFileSync(path.join(SUP, f), path.join(dest, f));
  git(work, "init", "-q", "-b", "main");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "base");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "-q", "origin", "main");
  const base = git(work, "rev-parse", "HEAD");
  git(root, "clone", "-q", origin, other);
  fs.appendFileSync(path.join(other, "tools", "factory-supervisor", "slots.mjs"), "\n// 새 버전 표시(시험)\n");
  git(other, "add", "-A");
  git(other, "commit", "-q", "-m", "새 커밋");
  git(other, "push", "-q", "origin", "main");
  return { dest, work, base, remote: git(other, "rev-parse", "HEAD") };
}

async function startServer(jobs) {
  const state = { reports: [], served: false, requests: 0, updateNow: false, nexts: [] };
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
        state.nexts.push(Object.fromEntries(url.searchParams));
        const updateNow = state.updateNow;

        state.updateNow = false;

        return send(200, { jobs: out, autoUpdate: true, compactAfterJob: false, appSlots: 3, appSlotsDefault: false, updateBundleMin: 60, ...(updateNow ? { updateNow: true } : {}) });
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

const job = (id, title) => ({
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
});

/**
 * 시나리오 하나: 일감을 가짜 홈페이지에 두고 감독 프로그램(복사본)을 가짜 실행기로 띄운다.
 * 첫 AI 실행이 시작되고 triggerAfterMs 가 지나면 "지금 업데이트" 신호를 한 번 보낸다. 일감이 끝나면(done/failed) 끈다.
 */
async function runScenario({ id, scenario, triggerAfterMs = 3000, restartDelayMs = 3000, env: extraEnv = {}, waitMs = 150_000, jobOver = {}, tsc, waitExit = false }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pause-e2e-"));
  const home = path.join(root, "home");
  const fixtures = path.join(root, "fixtures");

  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(fixtures, { recursive: true });
  for (const f of ["fake-claude-pause.mjs", "fake-claude-pause.cmd", "fake-claude-pause.sh"]) fs.copyFileSync(path.join(HERE, "fixtures", f), path.join(fixtures, f));
  if (!IS_WIN) fs.chmodSync(path.join(fixtures, "fake-claude-pause.sh"), 0o755);
  const repo = makeApp(root, "demo-app", tsc);
  const sup = makeSupervisorRepos(root);

  fs.writeFileSync(path.join(root, "secrets.env"), "");
  fs.writeFileSync(path.join(root, "scenario.json"), JSON.stringify(scenario));
  const { server, state, url } = await startServer([{ ...job(id, "시험 일감"), ...jobOver }]);
  const config = {
    serverUrl: url,
    token: "e2e-token-0123456789abcdef",
    worker: "e2e",
    workDir: path.join(root, "work"),
    secretsFile: path.join(root, "secrets.env"),
    pollSec: 5,
    heartbeatSec: 5,
    jobTimeoutMin: 5,
    claudeCmd: path.join(fixtures, IS_WIN ? "fake-claude-pause.cmd" : "fake-claude-pause.sh"),
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
    FACTORY_TEST_MODE: "1",
    FACTORY_LAUNCHER: "1", // 실행기 아래에서 도는 것으로 본다(업데이트 허용). 아래 가짜 실행기가 다시 띄운다
    FACTORY_CONFIG: path.join(root, "supervisor.config.json"),
    FACTORY_UPDATE_STATE: path.join(root, "update.json"),
    FACTORY_RESTART_STATE: path.join(root, "restart.json"),
    FACTORY_LAUNCHER_LOCK: path.join(root, "launcher.pid"),
    FACTORY_PAUSE_STATE: path.join(root, "paused.json"),
    FAKE_SCENARIO: path.join(root, "scenario.json"),
    FAKE_CALLS: path.join(root, "calls.log"),
    ...extraEnv,
  };

  for (const k of ["CLAUDE_STATUS_TOKEN", "CLAUDE_STATUS_URL", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]) delete env[k];

  // 가짜 실행기: 감독이 정상 종료(exit 0)하면 restartDelayMs 뒤 다시 띄운다
  const starts = [];
  const exits = [];
  let out = "";
  let stopping = false;
  let current = null;
  const launcher = (async () => {
    while (!stopping) {
      current = spawn(process.execPath, [path.join(sup.dest, "supervisor.mjs")], { cwd: sup.dest, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      starts.push(Date.now());
      current.stdout.on("data", (d) => (out += d));
      current.stderr.on("data", (d) => (out += d));
      const code = await new Promise((resolve) => current.on("close", resolve));

      exits.push(code);
      if (stopping) break;
      await sleep(restartDelayMs);
    }
  })();

  const callsNow = () => (fs.existsSync(env.FAKE_CALLS) ? fs.readFileSync(env.FAKE_CALLS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const finalOf = () => state.reports.find((r) => r.jobId === id && (r.status === "done" || r.status === "failed"));
  const end = Date.now() + waitMs;
  let triggered = false;
  let firstCallAt = 0;

  while (Date.now() < end && !finalOf()) {
    if (!firstCallAt && callsNow().length > 0) firstCallAt = Date.now();
    if (firstCallAt && !triggered && Date.now() - firstCallAt >= triggerAfterMs) {
      triggered = true;
      state.updateNow = true; // 통제실 [지금 업데이트]
    }
    await sleep(250);
  }
  await sleep(1500); // 완료 보고 뒤 정리
  if (waitExit) {
    // 일감이 끝난 뒤에야 업데이트가 이뤄지는 시나리오: 감독이 새 커밋을 받고 정상 종료(exit 0)할 때까지 기다린다
    const exitEnd = Date.now() + 40_000;

    while (Date.now() < exitEnd && !exits.length) await sleep(250);
  }
  stopping = true;
  if (current && current.exitCode === null) current.kill();
  if (IS_WIN && current?.pid) spawnSync("taskkill", ["/pid", String(current.pid), "/T", "/F"], { stdio: "ignore" });
  await launcher;
  await new Promise((resolve) => server.close(resolve));

  return { root, repo, sup, state, out, starts, exits, calls: callsNow(), final: finalOf(), env, headNow: () => git(sup.work, "rev-parse", "HEAD") };
}

const logsOf = (r) => r.state.reports.filter((x) => x.jobId === r.calls[0]?.id).flatMap((x) => x.logs ?? []).map((l) => l.message);
const reportsOf = (r, id) => r.state.reports.filter((x) => x.jobId === id);

test("멈춤 → 업데이트 → 같은 세션으로 이어짐: 새 커밋을 받고 다시 켜진 감독이 --resume 으로 이어서 끝낸다", { skip, timeout: 200_000 }, async () => {
  const id = "P1";
  let step = 0; // 명령이 매번 달라야 한다(같은 빌드를 결과 변화 없이 계속 돌리면 일감 시간 낭비 막기가 경고한다)
  const bash = (ms, cmd = `npm run build -- --step ${++step}`) => ({ tool: { name: "Bash", input: { command: cmd }, ms } });
  const r = await runScenario({
    id,
    scenario: {
      [id]: {
        calls: [
          [{ say: "작업을 시작합니다" }, bash(1200), bash(1200), bash(1200), bash(1200), bash(1200), bash(1200), bash(1200), bash(1200), bash(1200), bash(1200), bash(1200), bash(1200)],
          [{ say: "이어서 마저 합니다" }, { write: { file: "a.txt", text: "line1\n이어서 한 줄\n" } }],
        ],
      },
    },
  });

  assert.equal(r.final?.status, "done", `일감 완료 ${JSON.stringify(r.final)}\n${r.out.slice(-2500)}`);
  assert.equal(r.calls.length, 2, `AI 는 두 번(처음, 이어서)만 실행: ${JSON.stringify(r.calls.map((c) => c.n))}\n${r.out.slice(-2500)}\n${JSON.stringify(r.state.nexts.slice(-4))}`);
  assert.equal(r.calls[0].resume, null, "처음은 새 세션");
  assert.equal(r.calls[1].resume, SESSION, "이어 줄 때는 같은 세션 id 로 --resume");
  assert.equal(r.calls[1].prompt, RESUME_MESSAGE, "이어 줄 때 하는 말은 지시한 그대로");
  assert.equal(r.calls[0].cwd, r.calls[1].cwd, "같은 작업 폴더에서 이어 간다");
  assert.ok(r.exits.length >= 2 && r.exits[0] === 0, `감독이 정상 종료(exit 0)하고 다시 켜졌다: ${r.exits}`);
  assert.equal(r.headNow(), r.sup.remote, "업데이트로 새 커밋을 받았다");
  assert.equal(fs.existsSync(r.env.FAKE_CALLS), true);
  assert.equal(fs.readFileSync(path.join(r.repo, "a.txt"), "utf8").includes("이어서 한 줄"), true, "이어서 한 작업이 반영됐다");
  const logs = r.state.reports.flatMap((x) => (x.jobId === id ? x.logs ?? [] : [])).map((l) => l.message);
  assert.ok(logs.some((m) => /업데이트 뒤 이어서 시작: 같은 세션으로 이어 줘요/.test(m)), `이어서 시작 로그: ${logs.slice(-6).join(" | ")}`);
  assert.ok(r.out.includes("자동 업데이트 완료") && /멈춘 일감 1개는 새 버전이 켜지면 같은 세션으로 이어 줘요/.test(r.out), "멈춘 일감 1개를 저장하고 업데이트했다");
  assert.ok(r.state.nexts.some((q) => q.pausedJobs === "1"), "통제실에 '업데이트로 일시 중지 1개'를 알렸다");
  assert.equal(reportsOf(r, id).filter((x) => x.status === "failed").length, 0, "실패로 보고되지 않았다");
  assert.equal(fs.existsSync(r.env.FACTORY_PAUSE_STATE), false, "이어 준 뒤 저장 기록은 지운다");
});

test("긴 명령은 끊고 멈춘다: 이어 줄 때 AI 가 다시 실행하게 하고, 일감 로그에 끊었다고 남는다", { skip, timeout: 200_000 }, async () => {
  const id = "P2";
  const r = await runScenario({
    id,
    triggerAfterMs: 2500,
    scenario: {
      [id]: {
        calls: [
          [{ say: "빌드를 시작합니다" }, { hang: { name: "Bash", input: { command: "gradle assembleRelease", timeout: 600000 } } }],
          [{ say: "끊긴 빌드를 다시 실행합니다" }, { tool: { name: "Bash", input: { command: "gradle assembleRelease" }, ms: 300 } }],
        ],
      },
    },
  });

  assert.equal(r.final?.status, "done", `일감 완료 ${JSON.stringify(r.final)}\n${r.out.slice(-2500)}`);
  assert.equal(r.calls.length, 2);
  assert.equal(r.calls[1].resume, SESSION);
  assert.equal(r.calls[1].prompt, RESUME_MESSAGE);
  const logs = r.state.reports.flatMap((x) => (x.jobId === id ? x.logs ?? [] : [])).map((l) => l.message);
  assert.ok(r.out.includes("끝나지 않은 명령을 끊고 멈췄어요(남은 시간이 5분을 넘을 것 같음)") && r.out.includes("gradle assembleRelease"), `끊은 사실이 감독 로그에 남는다\n${r.out.slice(-1500)}`);
  assert.ok(logs.some((m) => /끝나지 않은 명령을 끊었어요/.test(m) && /gradle assembleRelease/.test(m)), `일감 로그에도 끊었다고 남는다: ${logs.slice(-8).join(" | ")}`);
  assert.equal(r.headNow(), r.sup.remote);
});

test("일감 시간 한도: 멈춰 있던 시간은 빼고 센다(남은 시간만큼만 다시 돈다)", { skip, timeout: 400_000 }, async () => {
  // 한도 22초. 처음 ~5~11초 일하고 멈춤 → 재시작 대기 12초 → 이어서 6초: 벽시계로는 22초를 넘지만 일한 시간은 한도 안이라 끝난다
  const ok = "P3";
  const tools = (n) => Array.from({ length: n }, () => ({ tool: { name: "Bash", input: { command: "echo work" }, ms: 1000 } }));
  const r1 = await runScenario({
    id: ok,
    triggerAfterMs: 3000,
    restartDelayMs: 12_000,
    env: { FACTORY_TEST_JOB_TIMEOUT_SEC: "22" },
    scenario: { [ok]: { calls: [[{ say: "시작" }, ...tools(14)], [{ say: "이어서" }, ...tools(6)]] } },
  });

  assert.equal(r1.final?.status, "done", `멈춘 시간을 빼면 한도 안이라 완료\n${r1.out.slice(-2500)}`);
  assert.equal(r1.calls.length, 2);
  const wall = r1.state.reports.length ? Date.parse(new Date().toISOString()) - r1.starts[0] : 0;
  assert.ok(wall > 22_000, "벽시계로는 한도(22초)를 넘겼다");
  const resumeLog = r1.state.reports.flatMap((x) => x.logs ?? []).map((l) => l.message).find((m) => /남은 시간 한도/.test(m));
  assert.match(resumeLog ?? "", /남은 시간 한도 (\d+)초/, "이어 줄 때 남은 시간 한도가 로그에 남는다");
  const left = Number(/남은 시간 한도 (\d+)초/.exec(resumeLog)[1]);
  assert.ok(left >= 8 && left <= 18, `남은 시간 = 22초 - 일한 시간(멈춘 시간 제외): ${left}초`);

  // 같은 조건에서 이어서 하는 일이 남은 시간보다 길면 시간 초과: 한도가 다시 22초로 늘어나지 않았다는 증거
  const bad = "P4";
  const r2 = await runScenario({
    id: bad,
    triggerAfterMs: 3000,
    restartDelayMs: 4000,
    env: { FACTORY_TEST_JOB_TIMEOUT_SEC: "22" },
    scenario: { [bad]: { calls: [[{ say: "시작" }, ...tools(14)], [{ say: "이어서" }, ...tools(20)]] } },
  });

  assert.equal(r2.final?.status, "failed", `남은 시간보다 오래 걸리면 시간 초과\n${r2.out.slice(-2500)}`);
  assert.match(r2.final.failReason ?? "", /시간 초과/);
});

test("이어서 하기가 바로 실패하면 실패가 아니라 '다시 시작 필요'(failStage=resume)로 한 번만 보고한다", { skip, timeout: 200_000 }, async () => {
  const id = "P5";
  const r = await runScenario({
    id,
    scenario: {
      [id]: {
        rejectResume: true, // 이어 달라고 하면 세션을 못 찾는다(No conversation found)
        calls: [[{ say: "시작" }, ...Array.from({ length: 12 }, () => ({ tool: { name: "Bash", input: { command: "echo hi" }, ms: 1000 } }))]],
      },
    },
  });

  assert.ok(r.final, `최종 보고가 왔다\n${r.out.slice(-2500)}`);
  assert.equal(r.final.status, "failed");
  assert.equal(r.final.failStage, "resume", "서버가 '다시 시작 필요'로 구분할 수 있게 failStage=resume");
  assert.match(r.final.failReason, /^다시 시작 필요/);
  assert.match(r.final.failReason, /통제실에서 \[다시 시도\]/);
  assert.equal(reportsOf(r, id).filter((x) => x.status === "failed" || x.status === "done").length, 1, "알림은 한 번만(최종 보고 한 번)");
  assert.equal(r.calls.length, 2, "이어서 하기를 한 번 시도했다");
  assert.ok(r.calls[1].resume);
});

test("합치기 중에는 기다린다: 병행 일감이 합치는(검증하는) 동안 지금 업데이트를 눌러도 멈추지 않고, 일감이 끝난 뒤에 업데이트한다", { skip, timeout: 200_000 }, async () => {
  const id = "P6";
  const r = await runScenario({
    id,
    triggerAfterMs: 2500,
    jobOver: { parallelGroup: "g-e2e001" },
    waitExit: true,
    // 합치기 검사(타입 검사)가 오래 걸리는 앱: 그동안 일감은 합치기 잠금 안에 있다
    tsc: "setTimeout(() => process.exit(0), 14000);\n",
    scenario: { [id]: { calls: [[{ say: "수정합니다" }, { write: { file: "a.txt", text: "line1\n합치기 시험\n" } }, { wait: 1500 }]] } },
  });

  assert.equal(r.final?.status, "done", `일감 완료 ${JSON.stringify(r.final)}\n${r.out.slice(-2500)}`);
  assert.equal(r.calls.length, 1, "합치기 중에는 AI 를 다시 부르지 않는다(멈춘 적 없음)");
  assert.ok(!/끝나지 않은 명령을 끊고 멈췄어요/.test(r.out));
  assert.ok(/멈출 수 없는 단계 \d+개가 끝나길 기다려요/.test(r.out), `합치기 같은 멈출 수 없는 단계를 기다린다고 로그에 남는다\n${r.out.slice(-2500)}`);
  assert.ok(/자동 업데이트 완료/.test(r.out), "일감이 끝난 뒤 업데이트를 받았다");
  assert.equal(r.exits[0], 0);
  assert.equal(r.headNow(), r.sup.remote);
  assert.ok(r.out.indexOf("보고 완료: done") < r.out.indexOf("자동 업데이트 완료"), "완료 보고가 업데이트보다 먼저");
});
