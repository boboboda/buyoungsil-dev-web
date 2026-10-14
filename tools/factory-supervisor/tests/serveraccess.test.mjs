// 서버 접근 규칙 시험: 명령 판정(serveraccess.mjs), 훅 스크립트(ssh-guard.mjs) 입출력, 정비·실험 설정에 훅이 붙는지.
// 실제 ssh 는 쓰지 않는다(훅에 JSON 을 넣어 판정만 본다).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkCommand, commandForLog, GUARD_PATH, guardHookSettings, RM_RF_ALLOWED_PARENTS, SERVER_ACCESS_RULES, SERVER_HOSTS } from "../serveraccess.mjs";
import { maintenanceSettings } from "../maintenance.mjs";
import { writeLabClaudeSettings } from "../lab.mjs";

const allow = (cmd) => assert.equal(checkCommand(cmd).decision, "allow", cmd);
const deny = (cmd, part) => {
  const r = checkCommand(cmd);
  assert.equal(r.decision, "deny", cmd);
  if (part) assert.match(r.reason, part, cmd);
  assert.match(r.reason, /멈추세요/, "꼭 필요할 때 멈추고 보고하라는 안내가 붙는다");
};

test("우리 서버 두 대로 가는 ssh·scp·git 은 허용", () => {
  assert.deepEqual(SERVER_HOSTS, ["serverpc", "serverpc2"]);
  allow('ssh serverpc2 "echo ok"');
  allow('ssh -o BatchMode=yes -o ConnectTimeout=8 serverpc "docker ps"');
  allow("ssh kju@serverpc2 uptime");
  allow('ssh serverpc2 "test -d git-server/memory/factory-memory.git || (mkdir -p git-server/memory && git init --bare git-server/memory/factory-memory.git)"');
  allow("git ls-remote serverpc2:git-server/memory/factory-memory.git");
  allow("git push claude-backup main");
  allow("scp -P 22 -r out serverpc2:/tmp/out");
  allow("scp C:/work/a.txt serverpc:/tmp/a.txt");
  allow('ssh serverpc "cd app && docker compose up -d --build"');
  allow('ssh serverpc "cat /etc/nginx/nginx.conf"');
  allow('ssh serverpc "crontab -l"');
  allow('cat local.txt | ssh serverpc2 "cat > /tmp/x.txt"');
});

test("상관없는 명령은 판단하지 않는다", () => {
  allow("grep -rn ssh tools/");
  allow("git status && git log --oneline -3");
  allow("npx tsc --noEmit -p .");
});

test("다른 호스트·우회 옵션은 막는다", () => {
  deny('ssh evil.example.com "echo ok"', /허용하지 않은 호스트/);
  deny("ssh git@github.com", /허용하지 않은 호스트/);
  deny("scp a.txt other:/tmp/a.txt", /허용하지 않은 호스트/);
  deny("ssh -J evil serverpc2 ls", /-J/);
  deny("ssh -vJevil serverpc2 ls", /-J/);
  deny('ssh -o ProxyCommand="nc evil 22" serverpc2 ls', /ProxyCommand/);
  deny("ssh -oHostName=evil serverpc2 ls", /HostName/);
  deny("ssh -L 8080:evil:80 serverpc2 ls", /-L/);
  deny("ssh -F other.cfg serverpc2 ls", /-F/);
  deny("sftp serverpc2", /sftp/);
  deny("rsync -av out/ serverpc2:/tmp/out", /rsync/);
  // 감싼 명령도 본다
  deny("echo $(ssh evil.example.com id)", /허용하지 않은 호스트/);
  deny("echo `ssh evil id`", /허용하지 않은 호스트/);
  deny('bash -c "ssh evil id"', /허용하지 않은 호스트/);
  deny("FOO=1 timeout 10 ssh evil id", /허용하지 않은 호스트/);
  deny("true && ssh evil id", /허용하지 않은 호스트/);
});

test("검사할 수 없는 원격 명령(표준입력 스크립트·인코딩·셸만 열기)은 막는다", () => {
  deny("ssh serverpc2", /원격 명령 없이/);
  deny("ssh serverpc2 < script.sh", /표준입력/);
  deny("cat script.sh | ssh serverpc2 bash", /표준입력/);
  deny("ssh serverpc2 bash -s < script.sh", /표준입력/);
  deny('ssh serverpc2 "echo cm0gLXJmIC8= | base64 -d | sh"', /인코딩/);
  deny('ssh serverpc2 "eval $CMD"', /eval/);
});

test("서버에서 지우기·강제 덮어쓰기는 막는다", () => {
  deny('ssh serverpc2 "rm -rf /tmp/nonexistent-test"', /rm -rf/);
  deny('ssh serverpc2 "rm -r -f /tmp/x"', /rm -rf/);
  deny('ssh serverpc2 "rm --recursive --force /tmp/x"', /rm -rf/);
  deny("ssh serverpc2 \"bash -c 'rm -rf /x'\"", /rm -rf/);
  deny('ssh serverpc2 "rm git-server/claude-work/a.git/HEAD"', /git-server/);
  deny('ssh serverpc2 "mv git-server/claude-work/a.git git-server/claude-work/b.git"', /git-server/);
  deny('ssh serverpc2 "find /tmp/x -delete"', /find -delete/);
  deny('ssh serverpc2 "cd git-server/repo/x.git && git reset --hard HEAD~1"', /reset --hard/);
  deny("git push --force origin main", /강제 push/);
  deny("git push -f claude-backup main", /강제 push/);
  deny("git push --force-with-lease claude-backup main", /강제 push/);
  deny("git push origin +main", /\+refspec/);
  deny("git push origin :old-branch", /브랜치 삭제/);
  deny("git push origin --delete old-branch", /브랜치 삭제/);
  deny("git push serverpc:git-server/repo/developWeb.git main", /배포/);
});

test("rm -rf 는 ~/studio-upload/<이름> 한 단계 폴더만 허용", () => {
  assert.deepEqual(RM_RF_ALLOWED_PARENTS, ["~/studio-upload"]);
  allow('ssh serverpc2 "rm -rf ~/studio-upload/hub"');
  allow('ssh serverpc "rm -rf ~/studio-upload/hub-split"');
  allow('ssh serverpc2 "rm -fr ~/studio-upload/hub-layout"');
  for (const p of [
    "~/git-server", "~/studio-upload/../x", "~/studio-upload/*", "~/studio-upload", "~/studio-upload/",
    "~/studio-upload/hub/sub", "~/studio-upload/hub ~/git-server", "~/studio-upload/$X", "~/studio-upload/$(id)",
    "~/studio-upload/..", "/studio-upload/hub", "~/git-server/work/app-kit/data/studio/hub", "~/studio-upload/hub/../../git-server",
  ]) deny(`ssh serverpc2 "rm -rf ${p}"`, /허용 경로는 ~\/studio-upload\/<이름> 뿐이에요/);
  deny('ssh serverpc2 "rm -rf ~/studio-upload/hub; rm -rf ~/data"', /rm -rf/);
  deny('ssh serverpc2 "rm -rf ~/studio-upload/.env"', /\.env/);
});

test("서비스 중단은 막는다", () => {
  deny('ssh serverpc "docker compose down"', /서비스 중단/);
  deny('ssh serverpc "cd app && docker-compose down"', /서비스 중단/);
  deny('ssh serverpc "docker rm -f web"', /docker/);
  deny('ssh serverpc "docker container rm web"', /docker/);
  deny('ssh serverpc "docker system prune -af"', /prune/);
  deny('ssh serverpc "docker volume prune"', /prune/);
  deny('ssh serverpc "sudo systemctl stop nginx"', /systemctl/);
  deny('ssh serverpc "systemctl disable docker"', /systemctl/);
  deny('ssh serverpc "sudo reboot"', /끄거나/);
  deny('ssh serverpc "shutdown -h now"', /끄거나/);
});

test("서버 설정·비밀 파일은 막는다", () => {
  deny('ssh serverpc "cat app/.env"', /\.env/);
  deny('ssh serverpc "cat app/.env.local"', /\.env/);
  deny("scp serverpc2:~/app/.env .", /\.env/);
  deny("scp new.env serverpc2:~/app/.env", /\.env/);
  deny("ssh serverpc \"sed -i 's/a/b/' /etc/nginx/sites-enabled/site\"", /nginx/);
  deny('ssh serverpc "echo x | sudo tee /etc/nginx/conf.d/x.conf"', /nginx/);
  deny("scp site.conf serverpc:/etc/nginx/sites-available/site", /nginx/);
  deny('ssh serverpc "ls ~/.ssh"', /\.ssh/);
  deny('ssh serverpc "cat >> ~/.ssh/authorized_keys"', /\.ssh/);
  deny('ssh serverpc "sudo cat /etc/letsencrypt/live/x/privkey.pem"', /인증서/);
  deny('ssh serverpc "crontab -r"', /crontab/);
  deny('ssh serverpc "crontab /tmp/cron.txt"', /crontab/);
});

test("로그용 명령: 서버 접속은 그대로, 나머지는 줄임", () => {
  const long = `ssh serverpc2 "${"echo a; ".repeat(60)}"`;
  assert.equal(commandForLog(long), long.replace(/\s+/g, " ").trim());
  assert.equal(commandForLog(`npm run ${"x".repeat(300)}`).length, 140);
  assert.equal(commandForLog(`npm run ${"x".repeat(300)}`, 200).length, 200);
});

test("규칙 문서에 허용 호스트·금지 명령·멈추고 보고가 있다", () => {
  for (const s of ["## 서버 접근 규칙", "serverpc", "serverpc2", "rm -rf", "git push --force", "docker compose down", "systemctl stop", ".env", "crontab", "결과에 적고 멈춘다"]) {
    assert.ok(SERVER_ACCESS_RULES.includes(s), s);
  }
});

function runGuard(input) {
  const r = spawnSync(process.execPath, [GUARD_PATH], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

test("훅 스크립트: 막을 때만 deny 를 낸다", () => {
  assert.equal(runGuard({ tool_name: "Bash", tool_input: { command: 'ssh serverpc2 "echo ok"' } }), null);
  assert.equal(runGuard({ tool_name: "Bash", tool_input: { command: "npm test" } }), null);
  const out = runGuard({ tool_name: "Bash", tool_input: { command: 'ssh serverpc2 "rm -rf /tmp/nonexistent-test"' } });
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /서버 접근 규칙/);
  // 읽을 수 없는 입력: 서버 접속 명령처럼 보이면 막고, 아니면 판단하지 않는다
  assert.equal(runGuard('{"tool_name":"Bash","tool_input":{"command":"ssh serverpc2 x"').hookSpecificOutput.permissionDecision, "deny");
  assert.equal(runGuard("not json ssh evil").hookSpecificOutput.permissionDecision, "deny");
  assert.equal(runGuard("not json at all"), null);
});

test("정비·실험 Claude 설정에 훅이 붙고, 정비는 ssh·scp 를 더 이상 deny 하지 않는다", () => {
  const hooks = guardHookSettings("C:/x/ssh-guard.mjs");
  assert.deepEqual(hooks.PreToolUse[0].matcher, "Bash");
  assert.equal(hooks.PreToolUse[0].hooks[0].command, 'node "C:/x/ssh-guard.mjs"');

  const m = maintenanceSettings("C:/x/serverctl.mjs", "C:/x/ssh-guard.mjs");
  assert.deepEqual(m.hooks, hooks);
  assert.ok(!m.permissions.deny.includes("Bash(ssh:*)") && !m.permissions.deny.includes("Bash(scp:*)"));
  for (const c of ["sftp", "rsync", "docker", "sudo", "nginx", "systemctl"]) assert.ok(m.permissions.deny.includes(`Bash(${c}:*)`), c);
  assert.ok(m.permissions.deny.includes("Read(~/.ssh/**)"));

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-lab-"));
  try {
    const dir = path.join(workDir, "lab", "j1");
    const shared = path.join(workDir, "lab", "shared");
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(shared, { recursive: true });
    const file = writeLabClaudeSettings({ workDir, dir, shared, jobId: "j1" });
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(s.hooks.PreToolUse[0].hooks[0].command, `node "${GUARD_PATH}"`);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
