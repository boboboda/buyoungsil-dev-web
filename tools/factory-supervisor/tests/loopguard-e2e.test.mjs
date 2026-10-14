// 일감 시간 낭비 막기(1-3) 끝에서 끝까지 시험: 진짜 감독 프로그램(supervisor.mjs)을 임시 폴더·가짜 홈페이지(127.0.0.1)·가짜 Claude 로 돌린다.
//   · 같은 e2e 가 반복되면 4번째 명령을 돌리지 않고 같은 세션에 "같은 시험을 반복 중이다…"를 한 번 보낸다(경고)
//   · 경고 뒤에도 또 반복하면 일감을 '막힘'(failStage=stuck)으로 끝낸다
//   · 경고를 받고 정리하면 정상 완료 / 바뀐 파일이 많고 결과가 다르면 경고하지 않음
//   · 스크린샷 단계가 상한을 넘으면 찍힌 것까지만 올리고 넘어가라고 한 번 말한다
// 격리: 홈 폴더·작업 폴더·상태 파일이 모두 임시 폴더이고 FACTORY_TEST_MODE=1, 자동 업데이트 끔. 진짜 감독·AI·서버는 건드리지 않는다.
// 실행: node tools/factory-supervisor/tests/loopguard-e2e.test.mjs (시나리오마다 10~40초)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WARN_MESSAGE } from "../loopguard.mjs";

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
const SESSION = "11111111-2222-3333-4444-555555555555";
const E2E = "npx playwright test e2e/stone-tower.spec.ts";
const e2e = (out = "30 passed", ms = 200) => ({ tool: { name: "Bash", input: { command: E2E }, ms, out } });

function makeApp(root, slug) {
  const repo = path.join(root, "work", slug);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, ".gitignore"), ".factory/\nnode_modules/\n");
  fs.writeFileSync(path.join(repo, "a.txt"), "line1\n");
  fs.writeFileSync(path.join(repo, "CLAUDE.md"), "# 앱 규칙\n");
  fs.mkdirSync(path.join(repo, "node_modules", "typescript", "bin"), { recursive: true });
  fs.writeFileSync(path.join(repo, "node_modules", "typescript", "bin", "tsc"), "process.exit(0);\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");

  return repo;
}

async function startServer(jobs, nextExtra) {
  const state = { reports: [], served: false, shots: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];

    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const send = (status, data) => (res.writeHead(status, { "Content-Type": "application/json" }), res.end(JSON.stringify(data)));
      const url = new URL(req.url, "http://x");

      if (url.pathname === "/api/factory/next") {
        const slots = Number(url.searchParams.get("slots") ?? "0");
        const out = !state.served && slots > 0 ? jobs.slice(0, slots) : [];

        if (out.length) state.served = true;

        return send(200, { jobs: out, autoUpdate: false, compactAfterJob: false, appSlots: 3, appSlotsDefault: false, updateBundleMin: 60, ...nextExtra });
      }
      if (url.pathname === "/api/factory/report" && req.method === "POST") {
        try {
          state.reports.push(JSON.parse(body.toString("utf8")));
        } catch {
          /* 무시 */
        }

        return send(200, { ok: true });
      }
      if (url.pathname === "/api/factory/screenshot") {
        state.shots.push(body.toString("latin1").match(/name="label"\r\n\r\n([^\r]+)/)?.[1] ?? "?");

        return send(200, { ok: true });
      }

      return send(200, {});
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return { server, state, url: `http://127.0.0.1:${server.address().port}` };
}

const job = (id) => ({ id, appSlug: "demo-app", title: "소원 돌탑 수정", kind: "revision", parentJobId: null, stack: "nestjs", priority: 0, requiredSecrets: [], planMarkdown: "돌탑 수정", attempts: 1, aiEngine: "claude", aiModel: null });

async function runScenario({ id, calls: scripted, nextExtra = {}, env: extraEnv = {}, waitMs = 90_000 }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loopguard-e2e-"));
  const home = path.join(root, "home");
  const fixtures = path.join(root, "fixtures");

  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(fixtures, { recursive: true });
  for (const f of ["fake-claude-pause.mjs", "fake-claude-pause.cmd", "fake-claude-pause.sh"]) fs.copyFileSync(path.join(HERE, "fixtures", f), path.join(fixtures, f));
  if (!IS_WIN) fs.chmodSync(path.join(fixtures, "fake-claude-pause.sh"), 0o755);
  const repo = makeApp(root, "demo-app");

  fs.writeFileSync(path.join(root, "secrets.env"), "");
  fs.writeFileSync(path.join(root, "scenario.json"), JSON.stringify({ [id]: { calls: scripted } }));
  const { server, state, url } = await startServer([job(id)], nextExtra);
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
  let out = "";
  const sup = spawn(process.execPath, [path.join(SUP, "supervisor.mjs")], { cwd: SUP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

  sup.stdout.on("data", (d) => (out += d));
  sup.stderr.on("data", (d) => (out += d));
  const finalOf = () => state.reports.find((r) => r.jobId === id && (r.status === "done" || r.status === "failed"));
  const end = Date.now() + waitMs;

  while (Date.now() < end && !finalOf()) await sleep(250);
  await sleep(1000);
  if (sup.exitCode === null) sup.kill();
  if (IS_WIN && sup.pid) spawnSync("taskkill", ["/pid", String(sup.pid), "/T", "/F"], { stdio: "ignore" });
  await new Promise((resolve) => server.close(resolve));
  const calls = fs.existsSync(env.FAKE_CALLS) ? fs.readFileSync(env.FAKE_CALLS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const logs = state.reports.filter((r) => r.jobId === id).flatMap((r) => r.logs ?? []).map((l) => l.message);

  return { repo, state, out, calls, logs, final: finalOf() };
}

test("같은 e2e 반복 → 4번째는 돌리지 않고 같은 세션에 경고 한 번 → 정리하고 끝내면 정상 완료", { skip, timeout: 120_000 }, async () => {
  const id = "L1";
  const r = await runScenario({
    id,
    calls: [
      [{ say: "수정 시작" }, e2e(), e2e(), e2e(), e2e("30 passed", 5000), { say: "여기는 실행되지 않아야 해요" }], // 4번째는 오래 걸리는 척: 감독이 먼저 끊는다
      [{ say: "같은 시험을 반복했어요. 지금 상태로 정리하고 막힌 점을 보고합니다." }],
    ],
  });

  assert.equal(r.final?.status, "done", `완료 ${JSON.stringify(r.final)}\n${r.out.slice(-2000)}`);
  assert.equal(r.calls.length, 2, `AI 는 두 번(처음, 경고 이어서)만: ${JSON.stringify(r.calls)}`);
  assert.equal(r.calls[1].resume, SESSION, "같은 세션으로 이어 감");
  assert.equal(r.calls[1].prompt, WARN_MESSAGE, "경고 문구는 지시한 그대로");
  assert.equal(r.logs.filter((m) => /같은 시험을 반복 중이라/.test(m)).length, 1, "경고는 한 번만");
  assert.equal(r.logs.filter((m) => /^\$ npx playwright/.test(m)).length, 4, "4번째 명령은 로그에는 보이지만 AI 가 끊겨 결과는 없다");
  assert.equal(r.logs.some((m) => /여기는 실행되지 않아야/.test(m)), false, "경고 뒤 이전 흐름은 끊겼다");
});

test("경고 뒤에도 같은 시험을 또 돌리면 '막힘'으로 끝낸다(failStage=stuck, 작업 파일은 그대로)", { skip, timeout: 120_000 }, async () => {
  const id = "L2";
  const r = await runScenario({
    id,
    calls: [
      [{ say: "수정 시작" }, { write: { file: "a.txt", text: "line1\n수정함\n" } }, e2e(), e2e(), e2e(), e2e()],
      [{ say: "다시 해 봅니다" }, e2e()],
    ],
  });

  assert.equal(r.final?.status, "failed", `막힘으로 끝 ${JSON.stringify(r.final)}\n${r.out.slice(-2000)}`);
  assert.equal(r.final.failStage, "stuck");
  assert.match(r.final.failReason, /^막힘: /);
  assert.match(r.final.failReason, /e2e 시험/);
  assert.equal(r.calls.length, 2);
  assert.equal(fs.readFileSync(path.join(r.repo, "a.txt"), "utf8").includes("수정함"), true, "작업 파일은 그대로");
});

test("바뀐 파일이 많고 결과가 다르면(진짜로 고치며 시험하는 중) 경고하지 않는다", { skip, timeout: 120_000 }, async () => {
  const id = "L3";
  const files = (n) => [1, 2, 3, 4].map((k) => ({ write: { file: `f${k}.txt`, text: `run ${n} file ${k}\n` } }));
  const r = await runScenario({
    id,
    calls: [[{ say: "고치면서 시험" }, ...files(1), e2e("5 failed"), ...files(2), e2e("3 failed"), ...files(3), e2e("2 failed"), ...files(4), e2e("1 failed"), ...files(5), e2e("0 failed")]],
  });

  assert.equal(r.final?.status, "done", `${JSON.stringify(r.final)}\n${r.out.slice(-2000)}`);
  assert.equal(r.calls.length, 1, "경고로 끊기지 않았다");
  assert.equal(r.logs.some((m) => /같은 시험을 반복 중/.test(m)), false);
});

test("설정에서 끄면 같은 시험을 몇 번 돌려도 그대로 둔다(서버가 /next 로 loopGuard 를 내려 줌)", { skip, timeout: 120_000 }, async () => {
  const id = "L4";
  const r = await runScenario({
    id,
    nextExtra: { loopGuard: { enabled: false, repeatMax: 3, judge: "any", minChangedFiles: 2, screenshotMaxMin: 15 } },
    calls: [[{ say: "시작" }, e2e(), e2e(), e2e(), e2e(), e2e()]],
  });

  assert.equal(r.final?.status, "done", `${JSON.stringify(r.final)}\n${r.out.slice(-2000)}`);
  assert.equal(r.calls.length, 1);
});

test("스크린샷 단계 시간 상한: 넘으면 찍힌 것까지만 올리고, 같은 세션에 넘어가라고 한 번 말한다", { skip, timeout: 120_000 }, async () => {
  const id = "L5";
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64").toString("latin1");
  const r = await runScenario({
    id,
    env: { FACTORY_TEST_SCREENSHOT_SEC: "4" },
    calls: [
      [{ say: "스크린샷 단계" }, { write: { file: ".factory/phase.txt", text: "screenshots\n" } }, { write: { file: ".factory/screenshots/home.png", text: png, binary: true } }, { wait: 60_000 }],
      [{ say: "찍힌 것까지만 두고 마무리합니다" }],
    ],
  });

  assert.equal(r.final?.status, "done", `${JSON.stringify(r.final)}\n${r.out.slice(-2000)}`);
  assert.equal(r.calls.length, 2, `두 번만 실행: ${JSON.stringify(r.calls)}`);
  assert.equal(r.calls[1].resume, SESSION);
  assert.match(r.calls[1].prompt, /^스크린샷 단계가 .*분을 넘어서 지금 찍힌 것까지만 올리고 넘어간다/);
  assert.equal(r.logs.filter((m) => /스크린샷 단계가 .*분을 넘어서 찍힌 것까지만 올리고 넘어가요/.test(m)).length, 1, "한 번만");
  assert.ok(r.state.shots.includes("home"), `찍힌 것은 올렸다: ${JSON.stringify(r.state.shots)}`);
});
