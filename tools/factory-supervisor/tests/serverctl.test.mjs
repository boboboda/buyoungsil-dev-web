// serverctl 새 사이트 명령 시험(site-init·env-clone·nginx-site·cert·deploy-push). 진짜 서버·ssh 는 쓰지 않는다.
// 가짜 ssh(fixtures/fake-ssh.mjs)가 임시 폴더를 서버 홈으로 삼아 원격 스크립트를 bash 로 돌리고, sudo·nginx·systemctl·certbot·docker 는 가짜를 쓴다.
// 헬스체크는 이 PC 안(127.0.0.1)의 가짜 홈페이지. 실행: node tools/factory-supervisor/tests/serverctl.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseOpts, siteConfig, workName } from "../serverctl.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCTL = path.resolve(HERE, "..", "serverctl.mjs");
const FAKE_SSH = path.join(HERE, "fixtures", "fake-ssh.mjs");
const fwd = (p) => p.replace(/\\/g, "/");

// bash 찾기(윈도우는 Git Bash, 그 밖은 PATH 의 bash)
const BASH = [process.env.FAKE_BASH, "C:/Program Files/Git/bin/bash.exe", "C:/Program Files/Git/usr/bin/bash.exe", "/bin/bash", "/usr/bin/bash"].find((p) => p && fs.existsSync(p));
const skip = !BASH && "bash 가 없어요";

const ORIGINAL_HOOK = (home) => `#!/bin/bash
set -o pipefail
REPO_DIR="${home}/git-server/repo/developWeb.git"
WORK_DIR="${home}/git-server/work/developWeb"
LOG_FILE="${home}/deploy-developweb.log"
BRANCH="main"
unset GIT_DIR
log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"; }
log "=== deploy start ==="
if [ ! -d "$WORK_DIR/.git" ]; then git clone "$REPO_DIR" "$WORK_DIR"; fi
cd "$WORK_DIR" || exit 1
git fetch origin 2>&1 | tee -a "$LOG_FILE"
git reset --hard "origin/$BRANCH" 2>&1 | tee -a "$LOG_FILE"
[ -f .env.local ] || { log "no .env.local"; exit 1; }
if [ -n "$FAKE_BUILD_FAIL" ]; then log "Failed to compile"; else log "container up"; docker logs developWeb --tail 10 2>&1 | tee -a "$LOG_FILE"; fi
log "=== deploy end (\${SECONDS}s) ==="
`;

const SECRET = "SuperSecretValue-9f8e7d6c5b4a";

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "serverctl-"));
  const home = fwd(path.join(root, "home"));
  const bin = path.join(root, "bin");
  const ngx = fwd(path.join(root, "nginx"));
  for (const d of [`${home}/git-server/repo/developWeb.git/hooks`, `${home}/git-server/work/developWeb`, bin, `${ngx}/sites-available`, `${ngx}/sites-enabled`]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(`${home}/git-server/repo/developWeb.git/hooks/post-receive`, ORIGINAL_HOOK(home));
  fs.writeFileSync(`${home}/git-server/work/developWeb/.env.local`, `DATABASE_URL=postgres://u:${SECRET}@db/x\nNEXTAUTH_SECRET=${SECRET}\nFACTORY_PUBLIC_URL=https://old.example.com\n`);
  fs.writeFileSync(`${ngx}/sites-available/cosysoft`, "server {\n    server_name cosysoft.example.com;\n}\n");
  fs.copyFileSync(`${ngx}/sites-available/cosysoft`, `${ngx}/sites-enabled/cosysoft`);
  const sh = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  sh("sudo", '[ "$1" = -n ] && shift; exec "$@"');
  sh("systemctl", '[ -n "$FAKE_RELOAD_FAIL" ] && exit 1; echo "systemctl $*" >> "$HOME/systemctl.log"; exit 0');
  sh("fake-nginx", 'if [ -n "$FAKE_NGINX_FAIL" ] || grep -Rqs BROKEN "$SERVERCTL_NGINX_ETC/sites-enabled/"; then echo "nginx: [emerg] test failed"; exit 1; fi; echo "nginx: configuration file test is successful"');
  sh(
    "certbot",
    'D=""; while [ $# -gt 0 ]; do [ "$1" = -d ] && D="$2"; shift; done\n' +
      'F=$(grep -Rls "server_name $D;" "$SERVERCTL_NGINX_ETC/sites-enabled/" | head -1)\n' +
      'echo "-----BEGIN PRIVATE KEY-----"; echo "MIIfakekeymaterial"; echo "-----END PRIVATE KEY-----"\n' +
      'if [ -n "$FAKE_CERT_FAIL" ]; then echo "BROKEN half-written" >> "$F"; echo "Challenge failed"; exit 1; fi\n' +
      'echo "    listen 443 ssl; # managed by Certbot" >> "$F"; echo "Successfully deployed certificate"',
  );
  sh("docker", 'if [ "$1" = ps ] && [ -n "$FAKE_CONTAINER" ]; then echo "RUNNING $FAKE_CONTAINER Up 5 seconds"; fi; exit 0');
  sh("openssl", 'head -c 32 /dev/urandom | od -An -tx1 | tr -d " \\n"; echo');
  return { root, home, bin, ngx, report: path.join(root, "report.txt"), sshLog: path.join(root, "ssh.log") };
}

let healthStatus = 200;
const server = http.createServer((req, res) => {
  res.statusCode = healthStatus;
  res.end("ok");
});

function run(ctx, args, extraEnv = {}) {
  const env = {
    ...process.env,
    FACTORY_TEST_MODE: "1",
    SERVERCTL_SSH: FAKE_SSH,
    SERVERCTL_SITE_URL: `http://127.0.0.1:${server.address().port}/`,
    SERVERCTL_STATE: path.join(ctx.root, "state.json"),
    SERVERCTL_REPORT_FILE: ctx.report,
    SERVERCTL_NGINX_ETC: ctx.ngx,
    SERVERCTL_NGINX_BIN: fwd(path.join(ctx.bin, "fake-nginx")),
    FAKE_HOME: ctx.home,
    FAKE_BIN: ctx.bin,
    FAKE_BASH: BASH,
    FAKE_SSH_LOG: ctx.sshLog,
    ...extraEnv,
  };
  // 헬스체크용 가짜 홈페이지가 이 프로세스에 있어서 spawnSync 를 쓰면 응답하지 못한다 → 비동기로 띄우고 기다린다
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [SCTL, ...args], { env, windowsHide: true });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => resolve({ code, out }));
  });
}

const read = (p) => fs.readFileSync(p, "utf8");
const noSecret = (ctx, out) => {
  assert.ok(!out.includes(SECRET), "출력에 원본 비밀값이 없다");
  if (fs.existsSync(ctx.report)) assert.ok(!read(ctx.report).includes(SECRET), "보고에 원본 비밀값이 없다");
};

test.before(() => new Promise((r) => server.listen(0, "127.0.0.1", r)));
test.after(() => server.close());

test("인자 읽기: --옵션, 작업 폴더 이름, nginx 설정 본문", () => {
  const { pos, opts } = parseOpts(["a", "b", "--set", "K=1", "--set=L=2", "--gen", "T", "--port", "5100"]);
  assert.deepEqual(pos, ["a", "b"]);
  assert.deepEqual(opts.set, ["K=1", "L=2"]);
  assert.deepEqual(opts.gen, ["T"]);
  assert.equal(opts.port, "5100");
  assert.equal(workName("~/git-server/work/developWeb"), "developWeb");
  assert.equal(workName("C:/Users/x/git-server/work/factoryWeb"), "factoryWeb", "이 PC 셸이 ~ 를 풀어 버린 경로도 이름만 쓴다");
  assert.equal(workName("factoryWeb"), "factoryWeb");
  const conf = siteConfig("factory-web", "factory.example.com", 5100, "300m", "T");
  assert.match(conf, /^# serverctl nginx-site factory-web T/);
  assert.match(conf, /server_name factory\.example\.com;/);
  assert.match(conf, /client_max_body_size 300m;/);
  assert.match(conf, /proxy_pass http:\/\/127\.0\.0\.1:5100;/);
});

test("site-init: 훅 이름 4곳 치환, clone, 이미 있으면 멈춤, 대상은 우리 서버만", { skip }, async () => {
  const ctx = setup();
  try {
    let r = await run(ctx, ["site-init", "factoryWeb", "--from", "developWeb"]);
    assert.equal(r.code, 0, r.out);
    const hook = read(`${ctx.home}/git-server/repo/factoryWeb.git/hooks/post-receive`);
    assert.ok(!/developweb/i.test(hook), "원본 이름이 남지 않았다");
    assert.match(hook, new RegExp(`REPO_DIR="${ctx.home}/git-server/repo/factoryWeb\\.git"`));
    assert.match(hook, new RegExp(`WORK_DIR="${ctx.home}/git-server/work/factoryWeb"`));
    assert.match(hook, /LOG_FILE=".*\/deploy-factoryweb\.log"/);
    assert.match(hook, /docker logs factoryWeb --tail/);
    assert.ok(fs.existsSync(`${ctx.home}/git-server/work/factoryWeb/.git`), "작업 폴더 clone");
    assert.equal(read(`${ctx.home}/git-server/repo/developWeb.git/hooks/post-receive`), ORIGINAL_HOOK(ctx.home), "원본 훅은 그대로");
    assert.match(read(`${ctx.home}/serverctl-actions.log`), /site-init factoryWeb from developWeb/);
    // 다시: 이미 있으니 아무것도 바꾸지 않고 멈춤
    fs.writeFileSync(`${ctx.home}/git-server/repo/factoryWeb.git/hooks/post-receive`, "# 사람이 고친 훅\n");
    r = await run(ctx, ["site-init", "factoryWeb", "--from", "developWeb"]);
    assert.equal(r.code, 6, r.out);
    assert.match(r.out, /이미 있어서 아무것도 바꾸지 않았어요/);
    assert.equal(read(`${ctx.home}/git-server/repo/factoryWeb.git/hooks/post-receive`), "# 사람이 고친 훅\n");
    // 원본 훅이 예상과 달라 4곳을 다 바꾸지 못하면 아무것도 만들지 않는다
    fs.writeFileSync(`${ctx.home}/git-server/repo/developWeb.git/hooks/post-receive`, ORIGINAL_HOOK(ctx.home).replace(/docker logs developWeb/, "docker logs other"));
    r = await run(ctx, ["site-init", "otherWeb", "--from", "developWeb"]);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /RENAME_FAIL/);
    assert.ok(!fs.existsSync(`${ctx.home}/git-server/repo/otherWeb.git`) && !fs.existsSync(`${ctx.home}/git-server/work/otherWeb`), "실패하면 만든 것이 없다");
    // 우리 서버 두 대 밖은 거부(ssh 를 부르지도 않는다)
    const before = fs.existsSync(ctx.sshLog) ? read(ctx.sshLog) : "";
    r = await run(ctx, ["site-init", "x", "--from", "developWeb", "--host", "evil.example.com"]);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /serverpc·serverpc2 만/);
    assert.equal(fs.existsSync(ctx.sshLog) ? read(ctx.sshLog) : "", before);
    assert.ok(read(ctx.sshLog).split("\n").filter(Boolean).every((h) => h === "serverpc"), "기본 대상은 serverpc");
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("env-clone: 서버 안에서만 복사, --set·--gen, 값은 출력하지 않음, 대상 있으면 백업, 실패하면 대상 그대로", { skip }, async () => {
  const ctx = setup();
  try {
    const dst = `${ctx.home}/git-server/work/factoryWeb`;
    fs.mkdirSync(dst, { recursive: true });
    let r = await run(ctx, ["env-clone", "~/git-server/work/developWeb", "~/git-server/work/factoryWeb", "--set", "FACTORY_PUBLIC_URL=https://factory.example.com", "--gen", "FACTORY_MCP_TOKEN"]);
    assert.equal(r.code, 0, r.out);
    const env = read(`${dst}/.env.local`);
    const token = /^FACTORY_MCP_TOKEN=(.*)$/m.exec(env)?.[1] ?? "";
    assert.match(token, /^[0-9a-f]{64}$/, "openssl rand -hex 32 값");
    assert.equal(env.match(/^FACTORY_PUBLIC_URL=/gm).length, 1, "같은 이름 줄은 지우고 하나만");
    assert.match(env, /^FACTORY_PUBLIC_URL=https:\/\/factory\.example\.com$/m);
    assert.match(env, new RegExp(`^NEXTAUTH_SECRET=${SECRET}$`, "m"), "나머지는 원본 그대로");
    assert.ok(!r.out.includes(token), "만든 토큰 값은 출력하지 않는다");
    assert.ok(!read(ctx.report).includes(token), "보고에도 없다");
    noSecret(ctx, r.out);
    assert.match(r.out, /변수 이름 4개: DATABASE_URL, NEXTAUTH_SECRET, FACTORY_PUBLIC_URL, FACTORY_MCP_TOKEN/);
    assert.match(r.out, /원래 \.env\.local 이 없었어요/);
    assert.match(read(`${ctx.home}/git-server/work/developWeb/.env.local`), /FACTORY_PUBLIC_URL=https:\/\/old\.example\.com/, "원본은 읽기만");
    assert.ok(!fs.readdirSync(dst).some((f) => f.includes("serverctl-")), "임시 파일이 남지 않았다");
    // 다시: 대상이 있으면 백업한 뒤 진행
    r = await run(ctx, ["env-clone", "developWeb", "factoryWeb", "--gen", "FACTORY_MCP_TOKEN"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /백업: \S+\.env\.local\.bak-\d{8}-\d{6}/);
    const bdir = `${ctx.home}/env-backups/factoryWeb`;
    const bak = path.join(bdir, fs.readdirSync(bdir).find((f) => f.startsWith(".env.local.bak-")));
    assert.equal(read(bak), env, "백업은 바꾸기 전 내용");
    assert.notEqual(/^FACTORY_MCP_TOKEN=(.*)$/m.exec(read(`${dst}/.env.local`))[1], token);
    // 실패(원본 없음): 대상은 그대로
    const now = read(`${dst}/.env.local`);
    r = await run(ctx, ["env-clone", "noSuchWeb", "factoryWeb", "--set", "A=1"]);
    assert.notEqual(r.code, 0, `L196 ${r.out}`);
    assert.equal(read(`${dst}/.env.local`), now);
    // 값 생성 실패: 대상 그대로, 임시 파일 정리
    fs.writeFileSync(path.join(ctx.bin, "openssl"), "#!/bin/bash\nexit 1\n", { mode: 0o755 });
    r = await run(ctx, ["env-clone", "developWeb", "factoryWeb", "--gen", "FACTORY_MCP_TOKEN"]);
    assert.notEqual(r.code, 0, `L201 ${r.out}`);
    assert.match(r.out, /GEN_FAIL/);
    assert.equal(read(`${dst}/.env.local`), now);
    assert.ok(!fs.readdirSync(dst).some((f) => f.includes("serverctl-")));
    // 형식이 틀린 인자는 서버에 가기 전에 거부
    r = await run(ctx, ["env-clone", "developWeb", "factoryWeb", "--set", "lower=1"]);
    assert.notEqual(r.code, 0, `L207 ${r.out}`);
    r = await run(ctx, ["env-clone", "developWeb", "../../etc", "--gen", "X"]);
    assert.notEqual(r.code, 0, `L209 ${r.out}`);
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("nginx-site: 새 파일·링크 → nginx -t → reload → 헬스체크, 있으면 멈춤, 실패하면 지움", { skip }, async () => {
  const ctx = setup();
  try {
    const A = `${ctx.ngx}/sites-available/factory-web`;
    const E = `${ctx.ngx}/sites-enabled/factory-web`;
    let r = await run(ctx, ["nginx-site", "factory-web", "--domain", "factory.example.com", "--port", "5100", "--body", "300m"]);
    assert.equal(r.code, 0, r.out);
    assert.ok(fs.existsSync(A) && fs.existsSync(E));
    assert.match(read(A), /server_name factory\.example\.com;/);
    assert.match(read(`${ctx.home}/systemctl.log`), /reload nginx/);
    assert.equal(read(`${ctx.ngx}/sites-available/cosysoft`), "server {\n    server_name cosysoft.example.com;\n}\n", "기존 사이트 파일은 그대로");
    // 이미 있으면 멈춤(이름이 같거나, 다른 이름이라도 도메인이 같으면)
    fs.appendFileSync(A, "# 사람이 고친 줄\n");
    r = await run(ctx, ["nginx-site", "factory-web", "--domain", "factory.example.com", "--port", "5200"]);
    assert.equal(r.code, 6, r.out);
    assert.match(read(A), /사람이 고친 줄/);
    r = await run(ctx, ["nginx-site", "other", "--domain", "cosysoft.example.com", "--port", "5200"]);
    assert.equal(r.code, 6, r.out);
    assert.ok(!fs.existsSync(`${ctx.ngx}/sites-available/other`));
    // nginx -t 실패 → 새 파일 지움
    r = await run(ctx, ["nginx-site", "bad", "--domain", "bad.example.com", "--port", "5300"], { FAKE_NGINX_FAIL: "1" });
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /nginx -t 실패 → 새 파일 지움/);
    assert.ok(!fs.existsSync(`${ctx.ngx}/sites-available/bad`) && !fs.existsSync(`${ctx.ngx}/sites-enabled/bad`));
    // reload 후 헬스체크 실패 → 지우고 reload
    healthStatus = 502;
    r = await run(ctx, ["nginx-site", "late", "--domain", "late.example.com", "--port", "5400"]);
    healthStatus = 200;
    assert.equal(r.code, 4, r.out);
    assert.match(r.out, /새 사이트 지우고 reload\(됨\)/);
    assert.ok(!fs.existsSync(`${ctx.ngx}/sites-available/late`) && !fs.existsSync(`${ctx.ngx}/sites-enabled/late`));
    // 형식 검사
    for (const bad of [["x", "--domain", "a b", "--port", "5100"], ["x", "--domain", "a.com", "--port", "80"], ["default", "--domain", "a.com", "--port", "5100"], ["x", "--domain", "a.com", "--port", "5100", "--body", "1m;evil"]]) {
      r = await run(ctx, ["nginx-site", ...bad]);
      assert.notEqual(r.code, 0, bad.join(" "));
    }
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("cert: 사이트 파일 백업 → certbot, 인증서 내용은 출력하지 않음, 실패하면 복원", { skip }, async () => {
  const ctx = setup();
  try {
    let r = await run(ctx, ["nginx-site", "factory-web", "--domain", "factory.example.com", "--port", "5100"]);
    assert.equal(r.code, 0, r.out);
    const E = `${ctx.ngx}/sites-enabled/factory-web`;
    const before = read(E);
    // 실패: certbot 이 파일을 반쯤 고치고 실패 → 백업으로 복원
    r = await run(ctx, ["cert", "factory.example.com"], { FAKE_CERT_FAIL: "1" });
    assert.equal(r.code, 5, r.out);
    assert.match(r.out, /백업으로 복원\(됨\)/);
    assert.equal(read(E), before);
    assert.ok(!/PRIVATE|MIIfake/.test(r.out), "인증서·키 내용 없음");
    // 성공
    r = await run(ctx, ["cert", "factory.example.com"]);
    assert.equal(r.code, 0, r.out);
    assert.match(read(E), /managed by Certbot/);
    assert.ok(!/PRIVATE|MIIfake|-----/.test(r.out), "인증서·키 내용 없음");
    assert.ok(!/PRIVATE|MIIfake/.test(read(ctx.report)));
    const nb = `${ctx.home}/nginx-backups`;
    const baks = fs.readdirSync(nb).filter((f) => f.startsWith("factory-web.bak-")).sort();
    assert.ok(baks.length >= 1 && new RegExp(`백업: \\S+${baks.at(-1)}`).test(r.out), r.out);
    assert.equal(read(path.join(nb, baks.at(-1))), before, "바꾸기 전 사이트 파일 백업");
    // 사이트가 없는 도메인
    r = await run(ctx, ["cert", "none.example.com"]);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /nginx 사이트가 없어요/);
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("deploy-push: 원격 추가 → main push(강제 없음) → 배포 로그 끝·컨테이너 확인", { skip }, async () => {
  const ctx = setup();
  try {
    let r = await run(ctx, ["site-init", "factoryWeb", "--from", "developWeb"]);
    assert.equal(r.code, 0, r.out);
    fs.writeFileSync(`${ctx.home}/git-server/work/factoryWeb/.env.local`, "A=1\n");
    const app = path.join(ctx.root, "app");
    fs.mkdirSync(app);
    const g = (...a) => spawnSync("git", a, { cwd: app, encoding: "utf8" });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@t");
    g("config", "user.name", "t");
    fs.writeFileSync(path.join(app, "a.txt"), "1\n");
    g("add", ".");
    g("commit", "-qm", "first");
    const url = "serverpc:git-server/repo/factoryWeb.git";
    // 컨테이너가 안 떠 있으면 실패
    r = await run(ctx, ["deploy-push", app, "prod", url]);
    assert.equal(r.code, 5, r.out);
    assert.match(r.out, /컨테이너 factoryWeb 가 실행 중이 아니에요/);
    // 성공
    fs.writeFileSync(path.join(app, "a.txt"), "2\n");
    g("commit", "-qam", "second");
    r = await run(ctx, ["deploy-push", app, "prod", url], { FAKE_CONTAINER: "factoryWeb" });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /배포 완료: push 성공, 배포 로그 끝, 컨테이너 factoryWeb 실행 중/);
    assert.equal(g("remote", "get-url", "prod").stdout.trim(), url);
    assert.equal(read(`${ctx.home}/git-server/work/factoryWeb/a.txt`).trim(), "2", "서버 작업 폴더가 main 으로");
    assert.match(read(`${ctx.home}/deploy-factoryweb.log`), /=== deploy end \(\d+s\) ===/);
    // 빌드 실패 로그
    fs.writeFileSync(path.join(app, "a.txt"), "3\n");
    g("commit", "-qam", "third");
    r = await run(ctx, ["deploy-push", app, "prod", url], { FAKE_CONTAINER: "factoryWeb", FAKE_BUILD_FAIL: "1" });
    assert.equal(r.code, 5, r.out);
    // 원격 이름이 이미 다른 주소면 바꾸지 않고 멈춤
    r = await run(ctx, ["deploy-push", app, "prod", "serverpc:git-server/repo/otherWeb.git"]);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /이미 다른 주소/);
    assert.equal(g("remote", "get-url", "prod").stdout.trim(), url);
    // 우리 서버 배포 저장소 꼴이 아니면 거부
    for (const bad of ["evil:git-server/repo/x.git", "serverpc:git-server/claude-work/x.git", "+serverpc:git-server/repo/x.git"]) {
      r = await run(ctx, ["deploy-push", app, "prod2", bad]);
      assert.notEqual(r.code, 0, bad);
    }
    assert.ok(!/--force|\+main/.test(read(SCTL).match(/gitIn\(dir, \["push"[^\n]*/)[0]), "강제 push 없음");
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});
