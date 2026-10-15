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
import { parseOpts, serverNames, siteConfig, workName } from "../serverctl.mjs";

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

test("원격 스크립트는 gzip+base64 로 보내고 길이가 윈도우 ssh 명령줄 한도 안", async () => {
  const { gzipSync } = await import("node:zlib");
  const src = read(SCTL);
  const script = /const REMOTE = String\.raw`([\s\S]*?)`;/.exec(src)[1];
  // 13.8KB(압축 안 함)에서 원격 셸이 잘린 명령으로 실패했고 4.8KB 는 됐다. 6KB 를 넘기면 스크립트를 나눠야 한다
  assert.ok(gzipSync(Buffer.from(script), { level: 9 }).toString("base64").length < 6000);
  // 앱 업데이트·웹 릴리스 스크립트는 따로 보낸다(REMOTE 가 한도에 가까워서). 각각 같은 한도 안
  for (const name of ["REMOTE_NGX", "REMOTE_APP", "REMOTE_WEB"]) {
    const part = new RegExp("const " + name + " = String\\.raw`([\\s\\S]*?)`;").exec(src)[1];
    assert.ok(gzipSync(Buffer.from(part), { level: 9 }).toString("base64").length < 6000, name);
  }
  assert.match(src, /base64 -d \| gunzip\)/);
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

test("env-set 여러 폴더: --gen-shared 는 같은 값, --gen 은 폴더별·이미 있으면 건너뜀, 값 출력 없음, 실패하면 모두 그대로", { skip }, async () => {
  const ctx = setup();
  try {
    const dev = `${ctx.home}/git-server/work/developWeb/.env.local`;
    const fac = `${ctx.home}/git-server/work/factoryWeb`;
    fs.mkdirSync(fac, { recursive: true });
    fs.writeFileSync(fac + "/.env.local", "A=1\nNEXTAUTH_SECRET=" + SECRET + "\n");
    const devBefore = read(dev);
    const facBefore = read(fac + "/.env.local");
    const val = (p, k) => new RegExp("^" + k + "=(.*)$", "m").exec(read(p))?.[1];
    let r = await run(ctx, ["env-set", "~/git-server/work/developWeb", "~/git-server/work/factoryWeb", "--gen-shared", "CONTROL_HANDOFF_SECRET"]);
    assert.equal(r.code, 0, r.out);
    const shared = val(dev, "CONTROL_HANDOFF_SECRET");
    assert.match(shared, /^[0-9a-f]{64}$/);
    assert.equal(val(fac + "/.env.local", "CONTROL_HANDOFF_SECRET"), shared, "두 폴더에 같은 값");
    assert.ok(!r.out.includes(shared) && !read(ctx.report).includes(shared), "값은 출력·보고에 없다");
    noSecret(ctx, r.out);
    assert.match(r.out, /CONTROL_HANDOFF_SECRET → developWeb/);
    assert.match(r.out, /developWeb=600, factoryWeb=600/);
    assert.match(read(dev), new RegExp("^NEXTAUTH_SECRET=" + SECRET + "$", "m"), "NEXTAUTH_SECRET 그대로");
    for (const n of ["developWeb", "factoryWeb"]) assert.ok(fs.readdirSync(`${ctx.home}/env-backups/${n}`).some((f) => f.startsWith(".env.local.bak-")), "백업 " + n);
    // --gen: 없으면 만들고, 다시 실행하면 건너뜀
    r = await run(ctx, ["env-set", "~/git-server/work/factoryWeb", "--gen", "CONTROL_SESSION_SECRET"]);
    assert.equal(r.code, 0, r.out);
    const sess = val(fac + "/.env.local", "CONTROL_SESSION_SECRET");
    assert.match(sess, /^[0-9a-f]{64}$/);
    assert.ok(!r.out.includes(sess));
    r = await run(ctx, ["env-set", "~/git-server/work/factoryWeb", "--gen", "CONTROL_SESSION_SECRET"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /건너뜀: CONTROL_SESSION_SECRET/);
    assert.equal(val(fac + "/.env.local", "CONTROL_SESSION_SECRET"), sess, "이미 있으면 바꾸지 않는다");
    // developWeb 을 바꿨으니 rebuild 실패 때 되돌릴 기준이 기록된다
    assert.ok(JSON.parse(read(path.join(ctx.root, "state.json"))).envBaseline);
    // 실패(폴더 하나 없음): 아무것도 안 바뀐다
    const devNow = read(dev);
    r = await run(ctx, ["env-set", "~/git-server/work/developWeb", "~/git-server/work/noSuchWeb", "--gen-shared", "OTHER_SECRET"]);
    assert.notEqual(r.code, 0, r.out);
    assert.equal(read(dev), devNow);
    // 값 생성 실패: 모두 그대로, 임시 파일 없음
    fs.writeFileSync(path.join(ctx.bin, "openssl"), "#!/bin/bash\nexit 1\n", { mode: 0o755 });
    r = await run(ctx, ["env-set", "developWeb", "factoryWeb", "--gen-shared", "OTHER_SECRET"]);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /GEN_FAIL/);
    assert.equal(read(dev), devNow);
    assert.ok(!fs.readdirSync(fac).some((f) => f.includes("serverctl-")));
    // 형식이 틀린 인자·보호 키는 서버에 가기 전에 거부
    for (const bad of [["developWeb", "--gen", "lower"], ["developWeb", "--gen", "NEXTAUTH_SECRET"], ["developWeb", "--gen-shared", "AUTH_SECRET"], ["../../etc", "--gen", "X"], ["developWeb", "--host", "evil", "--gen", "X"], ["developWeb"]]) {
      r = await run(ctx, ["env-set", ...bad]);
      assert.notEqual(r.code, 0, bad.join(" ") + " " + r.out);
    }
    assert.equal(read(dev), devNow);
    void devBefore;
    void facBefore;
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

// ───────── .env 폴더·--put·app-update·web-release (2026-10-15) ─────────

test("env-set: .env.local 이 없는 폴더는 .env 를 씀(한 컷), --put 은 받은 값을 그대로, 값 출력 없음", { skip }, async () => {
  const ctx = setup();
  try {
    const otf = `${ctx.home}/git-server/work/one-tiny-frame`;
    fs.mkdirSync(otf, { recursive: true });
    fs.writeFileSync(otf + "/.env", "PIXELLAB_TOKEN=" + SECRET + "\nALLOWED_ORIGINS=https://a.example\n");
    const val = (k) => new RegExp("^" + k + "=(.*)$", "m").exec(read(otf + "/.env"))?.[1];
    let r = await run(ctx, ["env-set", "one-tiny-frame", "--gen", "ADMIN_API_TOKEN", "--host", "serverpc2"]);
    assert.equal(r.code, 0, r.out);
    assert.match(val("ADMIN_API_TOKEN"), /^[0-9a-f]{64}$/);
    assert.ok(!r.out.includes(val("ADMIN_API_TOKEN")) && !read(ctx.report).includes(val("ADMIN_API_TOKEN")));
    assert.ok(!fs.existsSync(otf + "/.env.local"), ".env.local 을 새로 만들지 않는다");
    assert.ok(fs.readdirSync(`${ctx.home}/env-backups/one-tiny-frame`).some((f) => f.startsWith(".env.bak-")));
    assert.match(r.out, /one-tiny-frame=600/);
    assert.match(read(ctx.sshLog), /serverpc2/);
    noSecret(ctx, r.out);
    assert.equal(val("PIXELLAB_TOKEN"), SECRET, "다른 줄은 그대로");
    // --put: 사람이 정한 값을 넣고(이미 있으면 바꿈), 두 종류 폴더에 한 번에
    const PUT = "Put-Value-abc123456789";
    r = await run(ctx, ["env-set", "one-tiny-frame", "developWeb", "--put", "SERVICE_SHARED_TOKEN", "--host", "serverpc2"], { SERVERCTL_VALUE: PUT });
    assert.equal(r.code, 0, r.out);
    assert.equal(val("SERVICE_SHARED_TOKEN"), PUT);
    assert.match(read(`${ctx.home}/git-server/work/developWeb/.env.local`), new RegExp("^SERVICE_SHARED_TOKEN=" + PUT + "$", "m"));
    assert.ok(!r.out.includes(PUT) && !read(ctx.report).includes(PUT), "--put 값은 출력·보고에 없다");
    assert.match(r.out, /SERVICE_SHARED_TOKEN → one-tiny-frame\(넘겨받은 값\)/);
    r = await run(ctx, ["env-set", "one-tiny-frame", "--put", "SERVICE_SHARED_TOKEN"], { SERVERCTL_VALUE: PUT + "2" });
    assert.equal(r.code, 0, r.out);
    assert.equal(val("SERVICE_SHARED_TOKEN"), PUT + "2", "있어도 바꾼다");
    // 형식이 틀린 값·두 번 지정은 서버에 가기 전에 거부, 아무것도 안 바뀜
    const before = read(otf + "/.env");
    for (const [args, v] of [[["one-tiny-frame", "--put", "K_A"], "has space value"], [["one-tiny-frame", "--put", "K_A"], "short"], [["one-tiny-frame", "--put", "K_A", "--put", "K_B"], PUT]]) {
      r = await run(ctx, ["env-set", ...args], { SERVERCTL_VALUE: v });
      assert.notEqual(r.code, 0, args.join(" ") + r.out);
    }
    assert.equal(read(otf + "/.env"), before);
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

// 가짜 docker·curl: 호출을 $HOME/docker.log 에 남기고, 환경변수로 실패를 만든다
function fakeDockerCurl(ctx) {
  // 윈도우 Git Bash 의 ln -s 는 복사라서, 링크는 "가리키는 곳을 적은 파일"로 흉내 낸다(진짜 서버는 리눅스 심볼릭 링크)
  const ln = ['T=""; L=""; for a in "$@"; do case "$a" in -*) ;; *) if [ -z "$T" ]; then T="$a"; else L="$a"; fi ;; esac; done', 'rm -rf "$L"; printf %s "$T" > "$L"'].join("\n");
  fs.writeFileSync(path.join(ctx.bin, "ln"), `#!/bin/bash\n${ln}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(ctx.bin, "readlink"), '#!/bin/bash\n[ -f "$1" ] && cat "$1"; true\n', { mode: 0o755 });
  const sh = (name, body) => fs.writeFileSync(path.join(ctx.bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  sh(
    "docker",
    [
      'echo "docker $*" >> "$HOME/docker.log"',
      'case "$1 $2" in',
      '  "compose ps") echo cid123 ;;',
      '  "compose port") echo "127.0.0.1:5300" ;;',
      '  "compose up") if [ -n "$FAKE_BUILD_FAIL" ] && [[ " $* " == *" --build "* ]]; then echo "Failed to compile"; exit 1; fi',
      '                if [ -n "$FAKE_RESTART_FAIL" ] && [[ " $* " == *" --force-recreate "* ]]; then echo "recreate failed"; exit 1; fi ;;',
      '  "compose exec") if [ -n "$FAKE_RELOAD_FAIL" ]; then exit 1; fi ;;',
      '  "inspect cid123") case "$*" in *Config.Image*) echo one-tiny-frame-api ;; *) echo sha256:oldimage ;; esac ;;',
      '  "port cid123") echo "8080/tcp -> 0.0.0.0:18787" ;;',
      '  "run --rm") if [ -n "$FAKE_NGINX_FAIL" ]; then echo "nginx: [emerg] bad"; exit 1; fi ;;',
      "esac",
      "exit 0",
    ].join("\n"),
  );
  sh(
    "curl",
    [
      'ALL="$*"; URL="${@: -1}"',
      'if [[ " $ALL " == *" -sI "* ]]; then',
      "  printf 'HTTP/1.1 200 OK\\r\\nCache-Control: no-cache\\r\\nContent-Security-Policy: default-src self; frame-ancestors self https://www.example.com https://factory.example.com\\r\\n\\r\\n'; exit 0",
      "fi",
      'case "$URL" in',
      '  */api/admin/health) echo -n "${FAKE_ADMIN:-401}" ;;',
      '  */health) echo -n "${FAKE_HEALTH:-200}" ;;',
      '  */preview/) echo -n "${FAKE_PREVIEW_CODE:-200}" ;;',
      "  *) echo -n 200 ;;",
      "esac",
    ].join("\n"),
  );
}

const git = (cwd, ...a) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

test("app-update: origin main ff-only → compose up --build → 응답 코드 확인, 실패하면 이전 커밋·이미지로 되돌림", { skip }, async () => {
  const ctx = setup();
  try {
    fakeDockerCurl(ctx);
    const bare = `${ctx.home}/git-server/repo/one-tiny-frame.git`;
    const work = `${ctx.home}/git-server/work/one-tiny-frame`;
    git(ctx.root, "init", "-q", "--bare", "-b", "main", bare);
    git(ctx.root, "clone", "-q", bare, work);
    fs.writeFileSync(work + "/docker-compose.yml", "services: {}\n");
    fs.writeFileSync(work + "/.env", "SECRET_X=" + SECRET + "\n");
    fs.writeFileSync(work + "/.gitignore", ".env\n");
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", "v1");
    git(work, "push", "-q", "origin", "HEAD:main");
    const v1 = git(work, "rev-parse", "HEAD");
    // 서버 배포 저장소에 새 커밋이 올라온 상태
    const other = path.join(ctx.root, "other");
    git(ctx.root, "clone", "-q", bare, other);
    fs.writeFileSync(other + "/api.txt", "new api\n");
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", "v2");
    git(other, "push", "-q", "origin", "HEAD:main");
    const v2 = git(other, "rev-parse", "HEAD");
    const A = ["app-update", "one-tiny-frame", "--host", "serverpc2", "--probe", "/health", "--probe", "/api/admin/health"];

    // 빌드 실패 → 되돌림
    let r = await run(ctx, A, { FAKE_BUILD_FAIL: "1" });
    assert.equal(r.code, 5, r.out);
    assert.match(r.out, /빌드 실패/);
    assert.match(r.out, /되돌림\(됨\)/);
    assert.equal(git(work, "rev-parse", "HEAD"), v1, "작업 폴더 커밋이 되돌아감");
    const log1 = read(`${ctx.home}/docker.log`);
    assert.match(log1, /docker tag sha256:oldimage serverctl-rollback\/one-tiny-frame:\d{8}-\d{6}/);
    assert.match(log1, /docker tag serverctl-rollback\/one-tiny-frame:\d{8}-\d{6} one-tiny-frame-api/);
    assert.match(log1, /compose up -d --no-build/);
    noSecret(ctx, r.out);

    // 헬스체크 실패 → 되돌림
    r = await run(ctx, A, { FAKE_HEALTH: "500" });
    assert.equal(r.code, 5, r.out);
    assert.match(r.out, /헬스체크 실패\(\/health 500/);
    assert.equal(git(work, "rev-parse", "HEAD"), v1);

    // 성공
    r = await run(ctx, A);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /완료/);
    assert.match(r.out, /\/health 200, \/api\/admin\/health 401/);
    assert.equal(git(work, "rev-parse", "HEAD"), v2, "작업 폴더가 새 커밋으로");
    assert.match(read(ctx.report), /빌드·실행 성공/);
    noSecret(ctx, r.out);
    assert.ok(!/--force|reset --hard/.test(read(`${ctx.home}/docker.log`)));

    // 형식 검사·대상 서버·없는 폴더
    for (const bad of [["../x"], ["one-tiny-frame", "--host", "evil"], ["one-tiny-frame", "--probe", "health;rm"], ["one-tiny-frame", "--domain", "not a domain"], []]) {
      r = await run(ctx, ["app-update", ...bad]);
      assert.notEqual(r.code, 0, bad.join(" ") + r.out);
    }
    r = await run(ctx, ["app-update", "noSuchApp", "--host", "serverpc2"]);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /NO_WORK/);
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("web-release: 설정 검사 → 백업 → 설정·빌드 올리기 → 링크·reload → 응답·헤더 확인, 실패하면 설정 되돌림", { skip }, async () => {
  const ctx = setup();
  try {
    fakeDockerCurl(ctx);
    const site = `${ctx.home}/git-server/work/saessak-hub-web`;
    fs.mkdirSync(site, { recursive: true });
    const OLD = { "docker-compose.yml": "old compose\n", "default.conf": "old default\n", "headers.conf": "old headers\n" };
    for (const [f, c] of Object.entries(OLD)) fs.writeFileSync(`${site}/${f}`, c);
    const app = path.join(ctx.root, "hub");
    const conf = path.join(app, "tools", "web", "server");
    const build = path.join(app, "build", "preview");
    fs.mkdirSync(conf, { recursive: true });
    fs.mkdirSync(path.join(build, "assets"), { recursive: true });
    for (const f of ["docker-compose.yml", "default.conf", "headers.conf", "preview-headers.conf"]) fs.writeFileSync(`${conf}/${f}`, `new ${f}\n`);
    fs.writeFileSync(`${build}/index.html`, "<html>" + "x".repeat(2000) + "</html>");
    fs.writeFileSync(`${build}/assets/small.txt`, "tiny");
    fs.writeFileSync(`${build}/stale.js.gz`, "stale");
    const A = ["web-release", app, "--host", "serverpc2"];
    const releases = () => fs.readdirSync(`${site}/public/preview-releases`).sort();

    // nginx 검사 실패: 아무것도 안 바뀜
    let r = await run(ctx, A, { FAKE_NGINX_FAIL: "1" });
    assert.equal(r.code, 5, r.out);
    assert.match(r.out, /NGINX_TEST_FAIL/);
    assert.equal(read(`${site}/default.conf`), OLD["default.conf"]);
    assert.ok(!fs.existsSync(`${site}/public/preview-releases`) || releases().length === 0);
    assert.ok(!fs.readdirSync(site).some((f) => f.startsWith(".release-")), "임시 폴더 정리");

    // 성공
    r = await run(ctx, A);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\/preview\/ 200, \/ 200/);
    assert.match(r.out, /XFO absent/);
    assert.match(r.out, /frame-ancestors self https:\/\/www\.example\.com https:\/\/factory\.example\.com/);
    for (const f of ["docker-compose.yml", "default.conf", "headers.conf", "preview-headers.conf"]) assert.equal(read(`${site}/${f}`), `new ${f}\n`, f);
    const [rel1] = releases();
    assert.equal(releases().length, 1);
    const link = `${site}/public/preview-site/preview`;
    assert.equal(read(link), `../preview-releases/${rel1}`, "링크가 새 릴리스를 가리킴");
    assert.ok(fs.existsSync(`${site}/public/preview-releases/${rel1}/index.html.gz`), "큰 파일은 미리 압축");
    assert.ok(!fs.existsSync(`${site}/public/preview-releases/${rel1}/assets/small.txt.gz`));
    assert.ok(!fs.existsSync(`${site}/public/preview-releases/${rel1}/stale.js.gz`), "예전 .gz 는 지우고 새로");
    const bk = fs.readdirSync(`${ctx.home}/web-backups/saessak-hub-web`);
    assert.equal(bk.length, 1);
    assert.equal(read(`${ctx.home}/web-backups/saessak-hub-web/${bk[0]}/default.conf`), "old default\n", "바꾸기 전 설정이 백업에");
    assert.match(read(`${ctx.home}/docker.log`), /compose exec -T web nginx -s reload/);
    assert.match(read(ctx.report), /웹 릴리스/);

    // 확인 단계 실패(/preview/ 404): 설정을 되돌림
    await new Promise((res) => setTimeout(res, 1100)); // 릴리스 이름(초 단위)이 겹치지 않게
    fs.writeFileSync(`${conf}/default.conf`, "newer default\n");
    r = await run(ctx, A, { FAKE_PREVIEW_CODE: "404" });
    assert.equal(r.code, 5, r.out);
    assert.match(r.out, /CHECK_FAIL/);
    assert.match(r.out, /설정·링크 되돌림/);
    assert.equal(read(`${site}/default.conf`), "new default.conf\n", "설정이 직전 것으로 돌아감");
    assert.equal(read(link), `../preview-releases/${rel1}`, "링크가 직전 릴리스로 돌아감");

    // reload 실패도 되돌림
    await new Promise((res) => setTimeout(res, 1100));
    r = await run(ctx, A, { FAKE_RELOAD_FAIL: "1" });
    assert.equal(r.code, 5, r.out);
    assert.match(r.out, /RELOAD_FAIL/);
    assert.equal(read(link), `../preview-releases/${rel1}`);
    assert.equal(read(`${site}/default.conf`), "new default.conf\n");

    // 빌드·설정 파일이 없으면 서버에 가기 전에 멈춤, 대상 서버는 우리 서버만
    for (const bad of [[path.join(ctx.root, "nope")], [app, "--host", "evil"], [app, "--site", "../x"], []]) {
      r = await run(ctx, ["web-release", ...bad]);
      assert.notEqual(r.code, 0, bad.join(" ") + r.out);
    }
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

// 가짜 홈페이지 키 보관함(/api/factory/service-token): 감독 토큰만 받고, 저장·되돌리기를 메모리에 흉내 낸다. 받은 본문을 남겨 시험이 본다
function fakeVault(token) {
  const entries = new Map(); // name → { value, version }
  const prev = new Map(); // name → { version, before }
  const calls = [];
  const state = { fail: false };
  const srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const send = (status, body) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(body));
      };
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { message: "권한이 없습니다." });
      if (req.url !== "/api/factory/service-token" || req.method !== "POST") return send(404, { message: "없음" });
      const b = JSON.parse(raw);
      calls.push(b);
      if (state.fail) return send(500, { message: "처리에 실패했습니다." });
      if (!/^SERVICE_ADMIN_TOKEN_[A-Z0-9_]+$/.test(String(b.name))) return send(400, { message: "이름" });
      if (b.rollback === true) {
        const p = prev.get(b.name);
        const cur = entries.get(b.name);
        if (!p || p.version !== b.version || !cur || cur.version !== b.version) return send(409, { message: "되돌릴 기록 없음" });
        if (p.before) entries.set(b.name, { value: p.before.value, version: cur.version + 1 });
        else entries.delete(b.name);
        prev.delete(b.name);
        return send(200, { ok: true, restored: p.before ? "previous" : "deleted" });
      }
      const cur = entries.get(b.name);
      const next = { value: b.value, version: (cur?.version ?? 0) + 1 };
      prev.set(b.name, { version: next.version, before: cur ?? null });
      entries.set(b.name, next);
      send(200, { ok: true, version: next.version, replaced: !!cur });
    });
  });
  return { srv, entries, calls, state, listen: () => new Promise((r) => srv.listen(0, "127.0.0.1", r)), close: () => new Promise((r) => srv.close(r)) };
}

test("service-token: 값 한 번 생성 → 서버 .env --put → 보관함 저장 → 컨테이너 재시작·401 확인, 한쪽 실패면 둘 다 되돌림, 값은 어디에도 없음", { skip }, async () => {
  const ctx = setup();
  const TOKEN = "fake-supervisor-token-0123456789";
  const vault = fakeVault(TOKEN);
  await vault.listen();
  try {
    fakeDockerCurl(ctx);
    const work = `${ctx.home}/git-server/work/one-tiny-frame`;
    fs.mkdirSync(work + "/.git", { recursive: true });
    fs.writeFileSync(work + "/docker-compose.yml", "services: {}\n");
    const ENV0 = "PIXELLAB_TOKEN=" + SECRET + "\nALLOWED_ORIGINS=https://a.example\n";
    fs.writeFileSync(work + "/.env", ENV0);
    const cfgPath = path.join(ctx.root, "supervisor.config.json");
    fs.writeFileSync(cfgPath, JSON.stringify({ serverUrl: `http://127.0.0.1:${vault.srv.address().port}/`, token: TOKEN }));
    const env = { FACTORY_CONFIG: cfgPath };
    const envTok = () => /^ADMIN_API_TOKEN=(.*)$/m.exec(read(work + "/.env"))?.[1];
    const dockerLog = () => (fs.existsSync(`${ctx.home}/docker.log`) ? read(`${ctx.home}/docker.log`) : "");
    const restarts = () => (dockerLog().match(/compose up -d --force-recreate --no-build/g) ?? []).length;
    const NAME = "SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME";
    const A = ["service-token", "one-tiny-frame", "--host", "serverpc2", "--env-key", "ADMIN_API_TOKEN", "--secret", NAME];

    // 형식·설정 검사는 서버·보관함에 가기 전에 멈춤
    let r;
    for (const bad of [
      ["service-token", "one-tiny-frame", "--env-key", "ADMIN_API_TOKEN", "--secret", "PIXELLAB_TOKEN"],
      ["service-token", "one-tiny-frame", "--env-key", "ADMIN_API_TOKEN"],
      ["service-token", "one-tiny-frame", "--secret", NAME],
      ["service-token", "one-tiny-frame", "--env-key", "NEXTAUTH_SECRET", "--secret", NAME],
      ["service-token", "one-tiny-frame", "--env-key", "bad key", "--secret", NAME],
      [...A, "--host", "evil"],
      [...A, "--probe", "health;rm"],
      ["service-token"],
    ]) {
      r = await run(ctx, bad, env);
      assert.notEqual(r.code, 0, bad.join(" ") + r.out);
    }
    // 감독 설정이 없거나(시험 모드는 진짜 설정으로 되돌아가지 않는다) 주소가 이 PC 밖이면 멈춤
    r = await run(ctx, A, { FACTORY_CONFIG: path.join(ctx.root, "nope.json") });
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /감독 설정/);
    r = await run(ctx, A, { FACTORY_CONFIG: "" });
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /감독 설정/);
    const farCfg = path.join(ctx.root, "far.json");
    fs.writeFileSync(farCfg, JSON.stringify({ serverUrl: "https://www.example.com/", token: TOKEN }));
    r = await run(ctx, A, { FACTORY_CONFIG: farCfg });
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /홈페이지 주소/);
    assert.equal(read(work + "/.env"), ENV0, "검사에서 막히면 .env 그대로");
    assert.equal(vault.calls.length, 0, "보관함에 아무것도 보내지 않음");
    assert.ok(!fs.existsSync(`${ctx.home}/docker.log`));

    // 보관함 저장 실패 → .env 되돌림, 컨테이너는 손대지 않음
    vault.state.fail = true;
    r = await run(ctx, A, env);
    assert.equal(r.code, 5, r.out);
    assert.match(r.out, /보관함 저장 500/);
    assert.match(r.out, /되돌림\(됨\)/);
    assert.equal(read(work + "/.env"), ENV0, ".env 가 원래대로");
    assert.equal(vault.calls.length, 1);
    assert.equal(restarts(), 0, "컨테이너를 다시 만들지 않음");
    assert.ok(!r.out.includes(vault.calls[0].value) && !read(ctx.report).includes(vault.calls[0].value), "만든 값이 출력·보고에 없다");
    noSecret(ctx, r.out);
    vault.state.fail = false;

    // 성공: .env 와 보관함에 같은 값, 컨테이너 재시작, /health 200·/api/admin/health 401
    r = await run(ctx, A, env);
    assert.equal(r.code, 0, r.out);
    const t1 = envTok();
    assert.match(t1, /^[0-9a-f]{64}$/);
    assert.equal(vault.entries.get(NAME)?.value, t1, "보관함과 .env 가 같은 값");
    assert.equal(vault.entries.get(NAME)?.version, 1);
    assert.match(read(work + "/.env"), /^PIXELLAB_TOKEN=/m, "다른 줄은 그대로");
    assert.equal(restarts(), 1);
    assert.match(r.out, /완료/);
    assert.match(r.out, /\/health 200, \/api\/admin\/health 401/);
    assert.match(r.out, /등록\(version 1\)/);
    assert.ok(!r.out.includes(t1) && !read(ctx.report).includes(t1) && !read(ctx.sshLog).includes(t1), "값이 출력·보고·ssh 기록에 없다");
    assert.match(read(ctx.report), /서비스 토큰 짝 넣기/);
    noSecret(ctx, r.out);
    assert.ok(!A.some((a) => a.length >= 64), "명령줄 인자에 값이 없다");

    // 재시작 뒤 응답 확인 실패(관리 API 가 503 = 토큰을 못 읽음) → 보관함 이전 값·.env 되돌림, 컨테이너 다시 시작
    const envAfter = read(work + "/.env");
    r = await run(ctx, A, { ...env, FAKE_ADMIN: "503" });
    assert.equal(r.code, 5, r.out);
    assert.match(r.out, /응답 확인 실패\(\/health 200, \/api\/admin\/health 503\)/);
    assert.match(r.out, /보관함 되돌림\(이전 값으로\)/);
    assert.match(r.out, /\.env 되돌림\(됨\)/);
    assert.equal(read(work + "/.env"), envAfter, ".env 가 성공 직후 상태로");
    assert.equal(vault.entries.get(NAME)?.value, t1, "보관함도 이전 값으로");
    assert.equal(restarts(), 3, "실패 재시작 + 되돌린 뒤 재시작");
    const sent = vault.calls.find((c) => c.rollback === true);
    assert.equal(sent?.version, 2);
    noSecret(ctx, r.out);

    // 컨테이너 재시작 자체가 실패해도 같은 되돌림
    r = await run(ctx, A, { ...env, FAKE_RESTART_FAIL: "1" });
    assert.equal(r.code, 5, r.out);
    assert.match(r.out, /컨테이너 재시작 실패/);
    assert.equal(read(work + "/.env"), envAfter);
    assert.equal(vault.entries.get(NAME)?.value, t1);
    for (const c of vault.calls) if (c.value) assert.ok(!read(ctx.report).includes(c.value) && !dockerLog().includes(c.value));
  } finally {
    await vault.close();
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("대상 사이트 설정: 기본은 developWeb·200, deploy 설정(factory 값)·--site·--host 를 주면 작업 폴더·백업·헬스체크 기준이 바뀐다", { skip }, async () => {
  const ctx = setup();
  try {
    const fw = `${ctx.home}/git-server/work/factoryWeb`;
    fs.mkdirSync(fw, { recursive: true });
    fs.writeFileSync(`${fw}/.env.local`, "FACTORY_ONLY_KEY=1\nFACTORY_PUBLIC_URL=https://factory.example.com\n");
    fs.writeFileSync(`${ctx.ngx}/sites-enabled/default`, "server {\n    listen 443 ssl;\n    server_name factory.example.com;\n}\n");
    const cfgPath = path.join(ctx.root, "factory.config.json");
    const url = `http://127.0.0.1:${server.address().port}/api/factory/next`;
    const deploy = { workName: "factoryWeb", containerName: "factoryWeb", healthUrl: url, healthExpect: [401], nginxDomain: "factory.example.com" };
    const withCfg = (d) => {
      fs.writeFileSync(cfgPath, JSON.stringify({ serverUrl: "http://127.0.0.1:1", token: "tttttttt", deploy: d }));
      return { FACTORY_CONFIG: cfgPath };
    };
    // 기본(설정 없음): 블로그 작업 폴더
    let r = await run(ctx, ["env-keys"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /DATABASE_URL/);
    assert.ok(!r.out.includes("FACTORY_ONLY_KEY"));
    // 설정의 workName
    r = await run(ctx, ["env-keys"], withCfg(deploy));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /FACTORY_ONLY_KEY/);
    assert.ok(!r.out.includes("DATABASE_URL"));
    // --site 가 설정보다 먼저(설정이 없어도 됨), --host 는 우리 서버 두 대만
    r = await run(ctx, ["env-keys", "--site", "factoryWeb", "--host", "serverpc2"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /FACTORY_ONLY_KEY/);
    assert.equal(read(ctx.sshLog).split("\n").filter(Boolean).pop(), "serverpc2");
    r = await run(ctx, ["env-keys", "--site", "developWeb"], withCfg(deploy));
    assert.match(r.out, /DATABASE_URL/, "--site 가 설정의 workName 을 이긴다");
    for (const bad of [["--site", "a b"], ["--site", "../x"], ["--host", "evil.example.com"], ["--nope", "1"]]) {
      r = await run(ctx, ["env-keys", ...bad]);
      assert.notEqual(r.code, 0, bad.join(" ") + r.out);
    }
    // env-set KEY: 값은 환경변수로, 백업 폴더는 그 사이트 이름
    r = await run(ctx, ["env-set", "FACTORY_PUBLIC_URL", "--site", "factoryWeb"], { SERVERCTL_VALUE: "https://f2.example.com" });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /env-backups\/factoryWeb\/\.env\.local\.bak-/);
    assert.match(read(`${fw}/.env.local`), /FACTORY_PUBLIC_URL=https:\/\/f2\.example\.com/);
    assert.ok(!read(`${ctx.home}/git-server/work/developWeb/.env.local`).includes("f2.example.com"), "블로그 .env 는 그대로");
    r = await run(ctx, ["env-set", "KEY", "value", "--site", "factoryWeb"]);
    assert.notEqual(r.code, 0, "값을 인자로 주면 여전히 거절");
    // 잘못된 deploy 설정은 서버에 가기 전에 멈춤
    const before = read(ctx.sshLog);
    r = await run(ctx, ["env-keys"], withCfg({ containerName: "bad name" }));
    assert.notEqual(r.code, 0);
    assert.match(r.out, /deploy 가 올바르지 않아요/);
    assert.equal(read(ctx.sshLog), before);
    // 헬스체크: 설정(401 합격)이면 401 에서 적용됨, 기본(200)이면 같은 응답으로 실패해 되돌림
    healthStatus = 401;
    r = await run(ctx, ["nginx-set-directive", "client_max_body_size", "50m"], withCfg(deploy));
    assert.equal(r.code, 0, r.out);
    assert.match(read(`${ctx.ngx}/sites-enabled/default`), /client_max_body_size 50m;/);
    // 기본 헬스(200)는 401 을 합격으로 보지 않는다(nginxDomain 만 설정해 도메인 검사는 통과)
    r = await run(ctx, ["nginx-set-directive", "client_max_body_size", "60m"], withCfg({ nginxDomain: "factory.example.com" }));
    assert.equal(r.code, 4, r.out);
    assert.match(r.out, /헬스체크 실패\(401\)/);
    assert.match(read(`${ctx.ngx}/sites-enabled/default`), /client_max_body_size 50m;/, "실패하면 백업으로 복원");
    // nginxDomain 기본(buyoungsilcoding.com)이면 factory 설정 파일은 대상 사이트로 보지 않는다
    healthStatus = 200;
    r = await run(ctx, ["nginx-set-directive", "client_max_body_size", "70m"]);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /대상 사이트 설정으로 보이지 않아요/);
  } finally {
    healthStatus = 200;
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("--file: 다른 nginx 사이트 파일(studio)도 같은 안전 경로로 고침 — 백업·적용·응답 확인·실패 시 되돌림, 기본 파일은 그대로", { skip }, async () => {
  const ctx = setup();
  let probeStatus = 401;
  const probe = http.createServer((req, res) => {
    res.statusCode = probeStatus;
    res.end("x");
  });
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const env = { SERVERCTL_PROBE_URL: `http://127.0.0.1:${probe.address().port}/` };
  const STUDIO = `# 앱 스튜디오
server {
    listen 443 ssl;
    server_name studio.example.com;
    location /api/review-status {
        proxy_pass http://192.168.0.46:5400;
    }
    location = /_studio_auth {
        internal;
        proxy_pass http://127.0.0.1:5000/api/studio-auth/verify;
        proxy_set_header X-Studio-App "studio";
    }
    location / {
        auth_request /_studio_auth;
        proxy_pass http://192.168.0.46:5400;
    }
}
server {
    listen 80;
    server_name studio.example.com;
    return 301 https://$host$request_uri;
}
`;
  const DEFAULT = "server {\n    listen 443 ssl;\n    server_name www.buyoungsilcoding.com buyoungsilcoding.com;\n    location / { proxy_pass http://localhost:5000; }\n}\n";
  try {
    fs.writeFileSync(`${ctx.ngx}/sites-enabled/studio`, STUDIO);
    fs.writeFileSync(`${ctx.ngx}/sites-enabled/default`, DEFAULT);
    const AUTH = ["nginx-set-directive", "proxy_pass", "http://127.0.0.1:5100/api/studio-auth/verify", "= /_studio_auth", "--file", "studio"];
    // 보기
    let r = await run(ctx, ["nginx-show", "--file", "studio"], env);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out.replace(/\r/g, ""), STUDIO);
    // 없는 파일은 만들지 않고 멈춤
    r = await run(ctx, ["nginx-show", "--file", "nope"], env);
    assert.notEqual(r.code, 0);
    r = await run(ctx, ["nginx-apply", path.join(ctx.root, "x.conf"), "--file", "nope"], env);
    assert.notEqual(r.code, 0);
    assert.ok(!fs.existsSync(`${ctx.ngx}/sites-enabled/nope`));
    // 잘못된 인자
    for (const bad of [
      ["nginx-show", "--file", "../x"],
      ["nginx-show", "--file", "a.bak-1"],
      ["nginx-show", "--file", "a b"],
      ["env-keys", "--file", "studio"],
      ["nginx-set-directive", "proxy_pass", "http://127.0.0.1:5100/api/studio-auth/verify", "--file", "studio"], // location 없음
      ["nginx-set-directive", "proxy_pass", "http://evil.example.com/x", "= /_studio_auth", "--file", "studio"],
      ["nginx-set-directive", "proxy_pass", "http://127.0.0.1:5100/other", "= /_studio_auth", "--file", "studio"],
    ]) {
      r = await run(ctx, bad, env);
      assert.notEqual(r.code, 0, bad.join(" ") + r.out);
    }
    assert.equal(read(`${ctx.ngx}/sites-enabled/studio`).replace(/\r/g, ""), STUDIO, "거절된 명령은 파일을 바꾸지 않는다");
    // 5000 → 5100: _studio_auth 위치만 바뀜
    r = await run(ctx, AUTH, env);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\[studio\]/);
    assert.match(r.out, /studio 사이트 응답 401/);
    const after = read(`${ctx.ngx}/sites-enabled/studio`).replace(/\r/g, "");
    assert.equal(after, STUDIO.replace("127.0.0.1:5000/api/studio-auth/verify", "127.0.0.1:5100/api/studio-auth/verify"));
    assert.equal((after.match(/5400/g) ?? []).length, 2, "다른 proxy_pass 는 그대로");
    assert.equal(read(`${ctx.ngx}/sites-enabled/default`), DEFAULT, "기본 사이트 파일은 그대로");
    const backups = fs.readdirSync(`${ctx.home}/nginx-backups`).filter((n) => n.startsWith("studio.bak-"));
    assert.equal(backups.length, 1);
    assert.equal(read(`${ctx.home}/nginx-backups/${backups[0]}`).replace(/\r/g, ""), STUDIO);
    assert.match(read(ctx.report), /nginx \[studio\] proxy_pass/);
    // 새 주소가 5xx 로 답하면 백업으로 되돌림
    probeStatus = 502;
    r = await run(ctx, ["nginx-set-directive", "proxy_pass", "http://127.0.0.1:5200/api/studio-auth/verify", "= /_studio_auth", "--file", "studio"], env);
    assert.equal(r.code, 4, r.out);
    assert.match(r.out, /studio 사이트 502/);
    assert.equal(read(`${ctx.ngx}/sites-enabled/studio`).replace(/\r/g, ""), after, "실패하면 직전 내용으로 복원");
    probeStatus = 401;
    // nginx -t 실패면 복원
    r = await run(ctx, ["nginx-set-directive", "proxy_pass", "http://127.0.0.1:5300/api/studio-auth/verify", "= /_studio_auth", "--file", "studio"], { ...env, FAKE_NGINX_FAIL: "1" });
    assert.equal(r.code, 3, r.out);
    assert.equal(read(`${ctx.ngx}/sites-enabled/studio`).replace(/\r/g, ""), after);
    // 통째 교체는 server_name 이 같아야 함
    const other = path.join(ctx.root, "other.conf");
    fs.writeFileSync(other, "server {\n    listen 443 ssl;\n    server_name evil.example.com;\n}\n");
    r = await run(ctx, ["nginx-apply", other, "--file", "studio"], env);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /server_name/);
    assert.equal(read(`${ctx.ngx}/sites-enabled/studio`).replace(/\r/g, ""), after);
    // 백업 목록·복원(--file)
    r = await run(ctx, ["backups", "--file", "studio"]);
    assert.match(r.out, /\[nginx studio\]/);
    assert.match(r.out, new RegExp(backups[0]));
    const ts = /bak-(\d{8}-\d{6})/.exec(backups[0])[1];
    r = await run(ctx, ["restore", ts, "--file", "studio"], env);
    assert.equal(r.code, 0, r.out);
    assert.equal(read(`${ctx.ngx}/sites-enabled/studio`).replace(/\r/g, ""), STUDIO, "처음 백업으로 복원");
    assert.equal(read(`${ctx.ngx}/sites-enabled/default`), DEFAULT);
    // 기본 파일 명령은 그대로(--file 없음)
    r = await run(ctx, ["nginx-set-directive", "client_max_body_size", "50m"]);
    assert.equal(r.code, 0, r.out);
    assert.match(read(`${ctx.ngx}/sites-enabled/default`), /client_max_body_size 50m;/);
    assert.equal(read(`${ctx.ngx}/sites-enabled/studio`).replace(/\r/g, ""), STUDIO);
    assert.ok(fs.readdirSync(`${ctx.home}/nginx-backups`).some((n) => n.startsWith("default.bak-")));
  } finally {
    probe.close();
    healthStatus = 200;
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("nginx-find: nginx -T 출력에서 파일 경계와 일치 줄만, 비밀 파일·줄은 가림, 인자 형식 검사", { skip }, async () => {
  const ctx = setup();
  try {
    const fake = path.join(ctx.bin, "fake-nginx-T");
    fs.writeFileSync(
      fake,
      `#!/bin/bash
if [ "$1" = -T ]; then
  printf '%s\\n' '# configuration file /etc/nginx/sites-enabled/studio:' 'server {' '    server_name studio.example.com;' '    location = /_studio_auth {' '        proxy_pass http://127.0.0.1:5000/api/studio-auth/verify;' '    }' '}' \\
    '# configuration file /etc/nginx/studio-proxy.secret.conf:' 'set $appkit_proxy_secret "TOPSECRETVALUE"; # proxy_pass' \\
    '# configuration file /etc/nginx/sites-enabled/default:' 'location /api/studio-auth/ { proxy_pass http://localhost:5000; }' '    proxy_set_header X-Token "TOKENVALUE"; # studio-auth'
  exit 0
fi
echo "nginx: configuration file test is successful"
`,
      { mode: 0o755 },
    );
    const env = { SERVERCTL_NGINX_BIN: fwd(fake) };
    let r = await run(ctx, ["nginx-find", "studio-auth|proxy_pass", "--host", "serverpc2"], env);
    assert.equal(r.code, 0, r.out);
    const lines = r.out.replace(/\r/g, "").split("\n").filter(Boolean);
    assert.deepEqual(lines, [
      "/etc/nginx/sites-enabled/studio:4:         proxy_pass http://127.0.0.1:5000/api/studio-auth/verify;",
      "/etc/nginx/sites-enabled/default:1: location /api/studio-auth/ { proxy_pass http://localhost:5000; }",
    ]);
    assert.ok(!r.out.includes("TOPSECRETVALUE") && !r.out.includes("TOKENVALUE"));
    assert.equal(read(ctx.sshLog).split("\n").filter(Boolean).pop(), "serverpc2");
    // 일치 없음
    r = await run(ctx, ["nginx-find", "nothing-here"], env);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /일치하는 줄 없음/);
    // 인자 형식
    for (const bad of [["nginx-find"], ["nginx-find", "a b"], ["nginx-find", "x;rm"], ["nginx-find", "$(id)"], ["nginx-find", "a", "b"], ["nginx-find", "a", "--host", "evil.example.com"]]) {
      r = await run(ctx, bad, env);
      assert.notEqual(r.code, 0, bad.join(" ") + r.out);
    }
    // nginx -T 를 못 쓰면(빈 출력) grep 으로 대신하고 비밀 줄은 걸러냄
    fs.writeFileSync(`${ctx.ngx}/sites-enabled/studio`, "server {\n    proxy_pass http://127.0.0.1:5000/api/studio-auth/verify;\n    set $x \"secret\"; # studio-auth\n}\n");
    const empty = path.join(ctx.bin, "fake-nginx-empty");
    fs.writeFileSync(empty, "#!/bin/bash\nexit 1\n", { mode: 0o755 });
    r = await run(ctx, ["nginx-find", "studio-auth"], { SERVERCTL_NGINX_BIN: fwd(empty) });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /studio:2:.*5000\/api\/studio-auth\/verify/);
    assert.ok(!/secret/.test(r.out));
  } finally {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("serverNames: server_name 주소들만(주석·_ 제외)", () => {
  assert.deepEqual(serverNames("# server_name no.example.com;\nserver {\n    server_name a.example.com b.example.com; # x\n}\nserver {\n  server_name _;\n}\n"), ["a.example.com", "b.example.com"]);
});
