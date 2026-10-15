// 정비 보호 규칙 시험: (1) 정비 훅이 실행기·진짜 감독 파일 수정·프로세스 종료를 거부하는지, (2) 정비 권한 설정에 금지가 들어갔는지,
// (3) 시험 모드 감독이 진짜 주소·토큰·상태 파일이면 시작을 거부하는지, (4) 감독을 띄우는 시험이 시험 모드를 켜는지.
// 실제 감독·ssh·서버는 쓰지 않는다(훅에 JSON 을 넣어 판정만 보고, 감독은 임시 설정으로 띄우자마자 거부되는 것만 본다). 실행: node tools/factory-supervisor/tests/pcguard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkLocalCommand, isProtectedPath, isTrustedServerctlCall } from "../pcguard.mjs";
import { enforceTestMode, isFakeServerUrl, testModeProblems } from "../testmode.mjs";
import { guardHookSettings } from "../serveraccess.mjs";
import { maintenanceSettings } from "../maintenance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUP = path.resolve(HERE, "..");
const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0;
const skip = !canSpawn && "host sandbox blocks child processes";

const denied = (cmd, part) => {
  const r = checkLocalCommand(cmd);
  assert.equal(r.decision, "deny", cmd);
  assert.match(r.reason, /사람이 로컬에서 적용/, "필요하면 바꿀 내용만 적고 멈추라는 안내가 붙는다");
  if (part) assert.match(r.reason, part, cmd);
};
const ok = (cmd) => assert.equal(checkLocalCommand(cmd).decision, "allow", cmd);

test("실행기·작업 스케줄러 실행은 거부", () => {
  denied("bash run-supervisor.sh", /실행기/);
  denied("bash -l ~/dev/factory/supervisor-src/tools/factory-supervisor/run-supervisor.sh", /실행기/);
  denied("./run-supervisor.sh &", /실행기/);
  denied("nohup bash C:/Users/x/dev/factory/run-supervisor.sh > /dev/null 2>&1 &", /실행기/);
  denied('powershell -Command "& C:\\x\\run-supervisor.ps1"', /실행기/);
  denied("cmd /c run-supervisor.cmd", /실행기/);
  denied('bash -c "cd ~/dev/factory && sh run-supervisor.sh"', /실행기/);
  denied("sed -i 's/30/5/' tools/factory-supervisor/run-supervisor.sh", /실행기|잠금·상태/);
  denied("schtasks /run /tn AppFactorySupervisor", /스케줄러/);
  denied("powershell -Command \"Start-ScheduledTask -TaskName AppFactorySupervisor\"", /스케줄러/);
});

test("실행기는 읽기만 하면 괜찮다", () => {
  ok("cat tools/factory-supervisor/run-supervisor.sh");
  ok("grep -n LOCK ~/dev/factory/supervisor-src/tools/factory-supervisor/run-supervisor.sh");
  ok("git log --oneline -3 -- tools/factory-supervisor/run-supervisor.sh");
  ok("bash -n tools/factory-supervisor/other.sh");
});

test("진짜 감독의 잠금·상태·설정 파일 수정·삭제는 거부", () => {
  denied("rm ~/dev/factory/run-supervisor.pid", /잠금·상태/);
  denied("rm -f run-supervisor.pid", /잠금·상태/);
  denied('echo {} > ~/dev/factory/supervisor-update.json', /잠금·상태/);
  denied("echo '{}' >> C:/Users/x/dev/factory/serverctl-state.json", /잠금·상태/);
  denied("cp /tmp/x.json ~/dev/factory/supervisor-update.json", /잠금·상태/);
  denied("mv ../supervisor-update.json /tmp/", /잠금·상태/);
  denied("rm -rf ~/dev/factory/supervisor-src/tools", /잠금·상태/);
  denied("rm -rf ../.locks", /잠금·상태/);
  denied("rm ~/dev/factory/.ai-locks/abc.json", /잠금·상태/);
  denied("sed -i 's/a/b/' ~/dev/factory/supervisor-src/tools/factory-supervisor/supervisor.mjs", /잠금·상태/);
  denied("truncate -s 0 ~/dev/factory/supervisor.log", /잠금·상태/);
  denied('powershell -Command "Remove-Item C:\\Users\\x\\dev\\factory\\supervisor-update.json"', /잠금·상태/);
  denied(`node -e "require('fs').rmSync(process.env.HOME+'/dev/factory/supervisor-update.json')"`, /잠금·상태/);
  denied("find ~/dev/factory/.locks -delete", /잠금·상태/);
});

test("진짜 감독 파일이 아닌 같은 이름의 임시 파일·읽기는 괜찮다", () => {
  ok("cat ~/dev/factory/supervisor-update.json");
  ok("ls -la ~/dev/factory/.locks ~/dev/factory/.ai-locks");
  ok("tail -50 ~/dev/factory/supervisor.log");
  ok("rm -rf /tmp/handover-e2e-abc");
  ok("rm /tmp/wk/supervisor.log");
  ok("cp tools/factory-supervisor/update.mjs /tmp/wk/update-backup.mjs");
  ok("node --check tools/factory-supervisor/supervisor.mjs");
  ok("node tools/factory-supervisor/tests/parallel.test.mjs");
  assert.equal(isProtectedPath("C:\\Users\\x\\dev\\factory\\selfdev\\tools\\a.mjs"), false);
  assert.equal(isProtectedPath("tools/factory-supervisor/update.mjs"), false);
});

test("프로세스 종료는 거부", () => {
  for (const cmd of ["taskkill //F //IM node.exe", "taskkill /F /PID 1234", "kill 1234", "kill -9 1234", "pkill node", "pkill -f claude", "killall node", "Stop-Process -Name node -Force", "tskill 12"]) denied(cmd, /프로세스/);
  denied('powershell -Command "Get-Process node | Stop-Process -Force"', /프로세스/);
  denied('powershell -NoProfile -Command "Stop-Process -Id 1234"', /프로세스/);
  denied('bash -c "taskkill /F /IM claude.exe"', /프로세스/);
  denied("cd tools && taskkill //F //IM node.exe >/dev/null 2>&1; sleep 1", /프로세스/);
  denied(`node -e "process.kill(1234)"`, /프로세스/);
  denied(`python -c "import os; os.kill(1, 9)"`, /프로세스/);
  denied("wmic process where name='node.exe' call terminate", /프로세스/);
  denied("echo $(pkill codex)", /프로세스/);
});

test("프로세스 종료가 아닌 비슷한 명령은 괜찮다", () => {
  ok("kill -0 1234");
  ok("grep -rn taskkill tools/");
  ok("git commit -m 'taskkill 막기'");
  ok("tasklist | grep -i node");
  ok("ps aux | grep node");
  ok("timeout 250 node --test --test-name-pattern='^교대:' tools/factory-supervisor/tests/x.test.mjs");
});

test("감독 프로그램을 직접 띄우려면 시험 모드와 임시 설정이 있어야 한다", () => {
  denied("node tools/factory-supervisor/supervisor.mjs", /FACTORY_TEST_MODE/);
  denied("node supervisor.mjs check", /FACTORY_TEST_MODE/);
  denied("FACTORY_TEST_MODE=1 node supervisor.mjs", /FACTORY_CONFIG/);
  ok("FACTORY_TEST_MODE=1 FACTORY_CONFIG=/tmp/t/supervisor.config.json node supervisor.mjs");
  ok("node --check supervisor.mjs");
});

function hook(command, script = "maintenance-guard.mjs") {
  const r = spawnSync(process.execPath, [path.join(SUP, script)], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
}

test("정비 훅 스크립트: 금지 명령은 deny, 평범한 명령과 서버 규칙은 그대로", { skip }, () => {
  for (const cmd of ["bash run-supervisor.sh", "taskkill //F //IM node.exe", "rm ~/dev/factory/supervisor-update.json", "pkill claude"]) {
    const out = hook(cmd);
    assert.equal(out?.permissionDecision, "deny", cmd);
    assert.match(out.permissionDecisionReason, /정비 보호 규칙/);
  }
  assert.equal(hook("npx tsc --noEmit -p ."), null);
  assert.equal(hook("git status && git log --oneline -3"), null);
  assert.equal(hook('ssh serverpc2 "echo ok"'), null);
  const server = hook("ssh evil.example.com ls");
  assert.equal(server?.permissionDecision, "deny");
  assert.match(server.permissionDecisionReason, /서버 접근 규칙/);
  // 앱·실험 일감용 훅은 이번 규칙의 영향을 받지 않는다(권한 변경 범위는 정비뿐)
  assert.equal(hook("taskkill //F //IM node.exe", "ssh-guard.mjs"), null);
});

// ───────── 서버 작업은 신뢰된 serverctl 로만 ─────────
const SCTL = "C:/Users/x/dev/factory/supervisor-src/tools/factory-supervisor/serverctl.mjs";
const SERVER_CALLS = [
  `node "${SCTL}" site-init factoryWeb --from developWeb`,
  `node "${SCTL}" env-clone "~/git-server/work/developWeb" "~/git-server/work/factoryWeb" --set FACTORY_PUBLIC_URL=https://factory.buyoungsilcoding.com --gen FACTORY_MCP_TOKEN`,
  `node "${SCTL}" nginx-site factory-web --domain factory.buyoungsilcoding.com --port 5100 --body 300m`,
  `node "${SCTL}" cert factory.buyoungsilcoding.com`,
  `node "${SCTL}" deploy-push C:/Users/x/dev/factory/factory-web prod serverpc:git-server/repo/factoryWeb.git`,
  `SERVERCTL_VALUE=x node ${SCTL} env-set FOO`,
  `node "${SCTL}" env-set ~/git-server/work/developWeb ~/git-server/work/factoryWeb --gen-shared CONTROL_HANDOFF_SECRET --host serverpc`,
  `node "${SCTL}" env-set ~/git-server/work/factoryWeb --gen CONTROL_SESSION_SECRET`,
];

test("신뢰된 serverctl 호출 판정: 감독 실행 폴더 사본·정해진 서브커맨드·단일 명령만", () => {
  for (const c of SERVER_CALLS) assert.equal(isTrustedServerctlCall(c), true, c);
  for (const c of [
    `node "C:/Users/x/dev/factory/selfdev/tools/factory-supervisor/serverctl.mjs" cert a.example.com`, // 정비 폴더 사본(고칠 수 있음)
    `node "${SCTL}" shell-exec ls`, // 없는 서브커맨드
    `node "${SCTL}" cert a.com; ssh serverpc "cat ~/git-server/work/developWeb/.env.local"`,
    `node "${SCTL}" cert a.com && rm -rf ~/x`,
    `node "${SCTL}" cert $(cat x)`,
    `node "${SCTL}" env-keys > keys.txt`,
    `echo hi | node "${SCTL}" env-set FOO`,
    `python "${SCTL}" cert a.com`,
  ])
    assert.equal(isTrustedServerctlCall(c), false, c);
});

test("정비 훅: serverctl 서버 작업 명령은 통과, 같은 일을 직접 하면 계속 막힘", { skip }, () => {
  for (const c of SERVER_CALLS) assert.equal(hook(c), null, c);
  for (const c of [
    'ssh serverpc "cat ~/git-server/work/developWeb/.env.local"',
    'ssh serverpc "cp ~/git-server/work/developWeb/.env.local ~/git-server/work/factoryWeb/.env.local"',
    'ssh serverpc "sudo tee /etc/nginx/sites-available/factory-web"',
    'ssh serverpc "sudo ln -s /etc/nginx/sites-available/x /etc/nginx/sites-enabled/x"',
    'ssh serverpc "sudo certbot --nginx -d factory.buyoungsilcoding.com"',
    'ssh serverpc "cat /etc/letsencrypt/live/x/privkey.pem"',
    "git push serverpc:git-server/repo/factoryWeb.git main",
    'ssh serverpc "rm -rf ~/git-server/work/factoryWeb"',
    'ssh serverpc "cd ~/git-server/work/developWeb && docker compose down"',
    "git push --force claude-backup main",
    `node "${SCTL}" cert a.com; ssh serverpc "cat ~/git-server/work/developWeb/.env.local"`,
  ]) {
    const out = hook(c);
    assert.equal(out?.permissionDecision, "deny", c);
  }
});

test("정비 권한 설정: 금지가 들어갔고 훅이 정비 훅이며 앱·실험 훅은 그대로", () => {
  const m = maintenanceSettings("C:/x/serverctl.mjs");
  for (const d of ["Bash(kill:*)", "Bash(pkill:*)", "Bash(killall:*)", "Bash(taskkill:*)", "Bash(Stop-Process:*)", "Bash(schtasks:*)", "Bash(bash run-supervisor.sh:*)", "Bash(./run-supervisor.sh:*)", "Edit(~/dev/factory/run-supervisor*)", "Write(~/dev/factory/run-supervisor*)", "Edit(~/dev/factory/*.pid)", "Write(~/dev/factory/.locks/**)", "Edit(~/dev/factory/supervisor-src/**)", "Write(~/dev/factory/*.json)"])
    assert.ok(m.permissions.deny.includes(d), d);
  assert.match(m.hooks.PreToolUse[0].hooks[0].command, /maintenance-guard\.mjs"$/);
  assert.equal(m.permissions.allow.length, 2, "서버 설정 도구 허용은 그대로");
  assert.ok(m.permissions.deny.includes("Bash(docker:*)"), "기존 금지도 그대로");
  assert.match(guardHookSettings().PreToolUse[0].hooks[0].command, /ssh-guard\.mjs"$/, "앱·실험 훅은 ssh-guard.mjs");
  assert.match(fs.readFileSync(path.join(SUP, "maintenance.mjs"), "utf8"), /실행기\(\\`run-supervisor\.sh\\`, 작업 스케줄러\) 변경은 정비에서 하지 않는다/);
});

// ───────── 시험 모드 ─────────
const REAL_HOME = "C:/Users/real";
const REAL_CFG = { serverUrl: "https://www.buyoungsilcoding.com", token: "REAL-TOKEN-0123456789abcdef" };
const goodEnv = { FACTORY_CONFIG: "C:/tmp/t/supervisor.config.json", FACTORY_UPDATE_STATE: "C:/tmp/t/update.json", FACTORY_RESTART_STATE: "C:/tmp/t/restart.json", FACTORY_LAUNCHER_LOCK: "C:/tmp/t/launcher.pid" };
const goodCfg = { serverUrl: "http://127.0.0.1:5555", token: "e2e-token-0123456789abcdef", workDir: "C:/tmp/t/work", secretsFile: "C:/tmp/t/secrets.env", selfdevDir: "C:/tmp/t/selfdev", appKitDir: "C:/tmp/t/app-kit" };
const problems = (over = {}) =>
  testModeProblems({ env: { ...goodEnv, ...(over.env ?? {}) }, config: over.config === null ? null : { ...goodCfg, ...(over.config ?? {}) }, configPath: over.configPath ?? goodEnv.FACTORY_CONFIG, homedir: "C:/tmp/t/home", realHome: REAL_HOME, realConfig: REAL_CFG });

test("시험 모드: 임시 폴더·가짜 주소·가짜 토큰이면 통과", () => {
  assert.deepEqual(problems(), []);
  for (const u of ["http://127.0.0.1:1", "http://localhost:3000", "http://[::1]:80", "https://fake.invalid", "http://hp.test"]) assert.equal(isFakeServerUrl(u), true, u);
});

test("시험 모드: 진짜 홈페이지 주소·진짜 토큰·진짜 상태 파일이면 거부 사유가 나온다", () => {
  assert.match(problems({ config: { serverUrl: "https://www.buyoungsilcoding.com" } }).join("\n"), /가짜 홈페이지 주소가 아니에요/);
  assert.match(problems({ config: { serverUrl: "https://buyoungsilcoding.com" } }).join("\n"), /가짜 홈페이지 주소가 아니에요/);
  assert.equal(isFakeServerUrl("https://evil-localhost.example.com"), false);
  assert.equal(isFakeServerUrl("not a url"), false);
  assert.match(problems({ config: { token: REAL_CFG.token } }).join("\n"), /진짜 PC 토큰/);
  assert.match(problems({ env: { FACTORY_UPDATE_STATE: `${REAL_HOME}/dev/factory/supervisor-update.json` } }).join("\n"), /FACTORY_UPDATE_STATE.*진짜 공장 폴더/);
  assert.match(problems({ env: { FACTORY_LAUNCHER_LOCK: `${REAL_HOME}/dev/factory/run-supervisor.pid` } }).join("\n"), /FACTORY_LAUNCHER_LOCK.*진짜 공장 폴더/);
  assert.match(problems({ config: { workDir: `${REAL_HOME}/dev/factory` } }).join("\n"), /workDir.*진짜 공장 폴더/);
  assert.match(problems({ config: { secretsFile: `${REAL_HOME}/dev/factory/secrets.env` } }).join("\n"), /secretsFile/);
  assert.match(problems({ configPath: `${REAL_HOME}/dev/factory/supervisor.config.json` }).join("\n"), /설정 파일이 진짜 공장 폴더/);
  assert.match(problems({ env: { FACTORY_CONFIG: "" } }).join("\n"), /FACTORY_CONFIG 가 없어요/);
  assert.match(problems({ config: null }).join("\n"), /설정 파일을 읽지 못했어요/);
  // 상태 파일을 지정하지 않으면 기본 경로(홈 폴더 기준)가 쓰인다: 홈이 진짜 홈이면 거부, 임시 홈이면 통과
  const noUpdate = { ...goodEnv, FACTORY_UPDATE_STATE: "" };
  assert.deepEqual(testModeProblems({ env: noUpdate, config: goodCfg, configPath: goodEnv.FACTORY_CONFIG, homedir: "C:/tmp/t/home", realHome: REAL_HOME, realConfig: REAL_CFG }), []);
  assert.match(testModeProblems({ env: noUpdate, config: goodCfg, configPath: goodEnv.FACTORY_CONFIG, homedir: REAL_HOME, realHome: REAL_HOME, realConfig: REAL_CFG }).join("\n"), /FACTORY_UPDATE_STATE/);
});

test("시험 모드가 아니면 아무것도 막지 않는다", () => {
  let exited = null;
  assert.deepEqual(enforceTestMode({}, (c) => (exited = c), () => {}), []);
  assert.equal(exited, null);
});

test("시험 모드: 진짜 주소가 든 설정으로 supervisor.mjs 를 띄우면 아무것도 하기 전에 거부(종료 코드 2)", { skip }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pcguard-"));
  try {
    const home = path.join(root, "home");
    fs.mkdirSync(home, { recursive: true });
    const cfg = path.join(root, "supervisor.config.json");
    // 서버 주소는 진짜지만 토큰은 가짜: 거부되지 않으면 진짜 홈페이지로 요청이 나가므로 반드시 시작 전에 거부돼야 한다
    fs.writeFileSync(cfg, JSON.stringify({ serverUrl: "https://www.buyoungsilcoding.com", token: "fake-token-0123456789abcdef", workDir: path.join(root, "work"), secretsFile: path.join(root, "secrets.env"), memoryRemote: "" }));
    const env = { ...process.env, HOME: home, USERPROFILE: home, FACTORY_TEST_MODE: "1", FACTORY_CONFIG: cfg, FACTORY_UPDATE_STATE: path.join(root, "update.json"), FACTORY_RESTART_STATE: path.join(root, "restart.json"), FACTORY_LAUNCHER_LOCK: path.join(root, "launcher.pid") };
    delete env.FACTORY_LAUNCHER;
    const r = spawnSync(process.execPath, [path.join(SUP, "supervisor.mjs")], { cwd: SUP, env, encoding: "utf8", timeout: 20_000, windowsHide: true });
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /시작을 거부해요/);
    assert.match(r.stderr, /가짜 홈페이지 주소가 아니에요/);
    assert.ok(!r.stdout.includes("감독 프로그램 시작"), "시작 로그가 없어야 한다");
    assert.ok(!fs.existsSync(path.join(root, "update.json")), "상태 파일도 건드리지 않았다");
    assert.ok(!fs.existsSync(path.join(root, "work")), "작업 폴더도 만들지 않았다");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("시험 모드: 설정 파일(FACTORY_CONFIG) 없이 띄워도 거부", { skip }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pcguard-"));
  try {
    const env = { ...process.env, HOME: root, USERPROFILE: root, FACTORY_TEST_MODE: "1" };
    delete env.FACTORY_CONFIG;
    delete env.FACTORY_LAUNCHER;
    const r = spawnSync(process.execPath, [path.join(SUP, "supervisor.mjs")], { cwd: SUP, env, encoding: "utf8", timeout: 20_000, windowsHide: true });
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /시작을 거부해요|설정 파일을 읽지 못했어요/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("감독 프로그램(supervisor.mjs)을 띄우는 시험 파일은 모두 FACTORY_TEST_MODE 를 켠다", () => {
  const bad = [];
  for (const f of fs.readdirSync(HERE).filter((n) => n.endsWith(".test.mjs") && n !== "pcguard.test.mjs")) {
    const src = fs.readFileSync(path.join(HERE, f), "utf8");
    const launches = /spawn(?:Sync)?\(\s*process\.execPath,\s*\[[^\]]*supervisor\.mjs/.test(src);
    if (launches && !/FACTORY_TEST_MODE/.test(src)) bad.push(f);
  }
  assert.deepEqual(bad, [], "supervisor.mjs 를 띄우는 시험은 env 에 FACTORY_TEST_MODE: \"1\" 이 있어야 해요");
  assert.match(fs.readFileSync(path.join(HERE, "worktree-e2e.test.mjs"), "utf8"), /FACTORY_TEST_MODE: "1"/);
});
