// 감독 홈페이지 주소 전환 안전장치 시험(serverswitch.mjs): 주소·셸 설정 줄 다루기, server-switch 명령(통과·실패·--dry-run), 감독 쪽 자동 되돌림.
// 진짜 홈페이지·진짜 설정은 쓰지 않는다. 가짜 홈페이지(127.0.0.1)와 임시 HOME 만. 실행: node tools/factory-supervisor/tests/serverswitch.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkLocalCommand, isTrustedServerctlCall } from "../pcguard.mjs";
import { SUBCOMMANDS } from "../serverctl.mjs";
import {
  markSwitchReported,
  noteSwitchOk,
  normalizeServerUrl,
  probeServer,
  readStatusToken,
  readStatusUrl,
  readSwitchState,
  refreshStatusUrlEnv,
  replaceStatusUrl,
  startSwitchGuard,
  statusUrlOf,
  switchPaths,
  switchReportNote,
  switchRestartWanted,
} from "../serverswitch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUP = path.resolve(HERE, "..");
const SCTL = path.join(SUP, "serverctl.mjs");
const WORKER_TOKEN = "worker-token-0123456789abcdef";
const STATUS_TOKEN = "status-token-fedcba9876543210";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => fs.readFileSync(p, "utf8");
const fwd = (p) => p.replace(/\\/g, "/");

// ───────── 가짜 홈페이지 ─────────
// mode: ok | next401 | status401 | down(연결 거부는 따로) . calls 에 요청 기록
function fakeSite(opts = {}) {
  const state = { calls: [], next: opts.next ?? 200, status: opts.status ?? 200, notes: [] };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    state.calls.push(`${req.method} ${u.pathname}`);
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const auth = req.headers.authorization;
      const send = (code, obj = {}) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (u.pathname === "/api/factory/next") {
        if (u.searchParams.get("note")) state.notes.push(u.searchParams.get("note"));
        if (auth !== `Bearer ${WORKER_TOKEN}`) return send(401, { message: "no" });
        if (state.next !== 200) return send(state.next);
        state.lastQuery = u.search;
        return send(200, { jobs: [] });
      }
      if (u.pathname === "/api/claude-status") {
        if (auth !== `Bearer ${STATUS_TOKEN}`) return send(401);
        state.lastStatusBody = body;
        return send(state.status);
      }
      return send(200);
    });
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({ srv, state, url: `http://127.0.0.1:${srv.address().port}` })));
}
const closed = (s) => new Promise((r) => s.srv.close(r));
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

// ───────── 순수 함수 ─────────
test("주소 다듬기: 운영은 https 도메인만, 시험은 이 PC 안(http 127.0.0.1)만", () => {
  assert.equal(normalizeServerUrl("https://Factory.Example.com/"), "https://factory.example.com");
  assert.equal(normalizeServerUrl(" https://factory.example.com:8443 "), "https://factory.example.com:8443");
  for (const bad of ["", "factory.example.com", "http://factory.example.com", "https://factory.example.com/path", "https://factory.example.com?x=1", "https://u:p@factory.example.com", "https://localhost", "https://127.0.0.1", "ftp://factory.example.com", "https://a b.com"]) {
    assert.throws(() => normalizeServerUrl(bad), undefined, `거부: ${bad}`);
  }
  assert.equal(normalizeServerUrl("http://127.0.0.1:5000/", { test: true }), "http://127.0.0.1:5000");
  assert.equal(normalizeServerUrl("http://localhost:5000", { test: true }), "http://localhost:5000");
  assert.throws(() => normalizeServerUrl("https://www.buyoungsilcoding.com", { test: true }));
  assert.throws(() => normalizeServerUrl("http://example.com", { test: true }));
  assert.equal(statusUrlOf("https://a.example.com"), "https://a.example.com/api/claude-status");
});

test("셸 설정 줄: 따옴표·export·줄 끝 설명·CRLF 를 그대로 두고 값만 바꾼다", () => {
  const url = "https://old.example.com/api/claude-status";
  const next = "https://new.example.com/api/claude-status";
  const text = `export A=1\r\nexport CLAUDE_STATUS_TOKEN=${STATUS_TOKEN}\r\nexport CLAUDE_STATUS_URL='${url}'  # 상태\r\nCLAUDE_DEVICE_NAME=main\r\n`;
  assert.equal(readStatusUrl(text), url);
  assert.equal(readStatusToken(text), STATUS_TOKEN);
  const r = replaceStatusUrl(text, next);
  assert.equal(r.changed, 1);
  assert.equal(r.text, text.replace(url, next), "다른 줄·따옴표·설명·줄바꿈은 그대로");
  assert.equal(readStatusUrl(r.text), next);
  // 따옴표 없음 / 큰따옴표 / export 없음
  assert.equal(replaceStatusUrl(`CLAUDE_STATUS_URL=${url}\n`, next).text, `CLAUDE_STATUS_URL=${next}\n`);
  assert.equal(replaceStatusUrl(`export CLAUDE_STATUS_URL="${url}"\n`, next).text, `export CLAUDE_STATUS_URL="${next}"\n`);
  // 줄이 없으면 null, 읽을 수 없는 꼴이면 던진다(고치지 않는다)
  assert.equal(readStatusUrl("export B=2\n"), null);
  assert.equal(replaceStatusUrl("export B=2\n", next).changed, 0);
  assert.throws(() => readStatusUrl('export CLAUDE_STATUS_URL="$BASE/api"\n'));
  assert.equal(readStatusToken("export B=2\n"), null);
});

test("시험 호출: 두 응답이 모두 200 이어야 통과, 코드만 돌려준다", async () => {
  const site = await fakeSite();
  try {
    const args = { url: site.url, workerToken: WORKER_TOKEN, worker: "w1", statusToken: STATUS_TOKEN, device: "pc1" };
    const ok = await probeServer(args);
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.next, { code: 200, ok: true });
    assert.match(site.state.lastQuery, /worker=w1/);
    assert.match(site.state.lastQuery, /hold=1/, "hold=1: 일감·신호를 가져가지 않는다");
    assert.match(site.state.lastQuery, /slots=0/);
    assert.equal(JSON.parse(site.state.lastStatusBody).sessionId, "server-switch-probe");
    assert.equal((await probeServer({ ...args, workerToken: "wrong-token-0123456789" })).next.code, 401);
    assert.equal((await probeServer({ ...args, statusToken: "wrong-token-0123456789" })).status.code, 401);
    site.state.status = 500;
    assert.equal((await probeServer(args)).ok, false);
  } finally {
    await closed(site);
  }
  const port = await freePort();
  const down = await probeServer({ url: `http://127.0.0.1:${port}`, workerToken: WORKER_TOKEN, worker: "w1", statusToken: STATUS_TOKEN, timeoutMs: 3000 });
  assert.equal(down.ok, false);
  assert.equal(down.next.code, 0, "연결 실패는 코드 0");
});

// ───────── 보호 훅 ─────────
test("정비 보호 훅: 신뢰된 사본의 server-switch 는 통과, 상태·백업 파일 수정은 막는다", () => {
  assert.ok(SUBCOMMANDS.includes("server-switch"));
  const sctl = 'node "C:/Users/kju90/dev/factory/supervisor-src/tools/factory-supervisor/serverctl.mjs"';
  assert.equal(isTrustedServerctlCall(`${sctl} server-switch https://factory.example.com --dry-run`), true);
  assert.equal(isTrustedServerctlCall(`${sctl} server-switch --status`), true);
  assert.equal(isTrustedServerctlCall(`${sctl} server-switch https://factory.example.com | cat`), false, "파이프가 섞이면 신뢰하지 않는다");
  assert.equal(checkLocalCommand(`${sctl} server-switch https://factory.example.com`).decision, "allow");
  for (const cmd of ["rm ~/dev/factory/supervisor-switch.json", "echo x > ~/dev/factory/supervisor-switch.json", "rm -rf ~/dev/factory/switch-backups", "cp x ~/dev/factory/switch-backups/a/supervisor.config.json"]) {
    assert.equal(checkLocalCommand(cmd).decision, "deny", cmd);
  }
  assert.equal(checkLocalCommand("cat ~/dev/factory/supervisor-switch.json").decision, "allow", "읽기는 괜찮다");
});

// ───────── server-switch 명령 ─────────
function setupHome(fromUrl, { bashrc = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "serverswitch-"));
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  const cfgPath = path.join(root, "supervisor.config.json");
  const cfgObj = { serverUrl: fromUrl, token: WORKER_TOKEN, worker: "pc1", workDir: path.join(root, "work"), pollSec: 7, deploy: {} };
  fs.writeFileSync(cfgPath, JSON.stringify(cfgObj, null, 2) + "\n");
  const rc = path.join(home, ".bashrc");
  const rcText = `# 내 설정\nexport PATH=$PATH:/x\nexport CLAUDE_STATUS_TOKEN=${STATUS_TOKEN}\nexport CLAUDE_STATUS_URL='${fromUrl}/api/claude-status'\nexport CLAUDE_DEVICE_NAME=pc1\n`;
  if (bashrc) fs.writeFileSync(rc, rcText);
  return { root, home, cfgPath, cfgObj, rc, rcText, report: path.join(root, "report.txt"), stateFile: path.join(root, "switch-state.json") };
}
function runSwitch(ctx, args, extraEnv = {}) {
  const base = { ...process.env };
  delete base.CLAUDE_STATUS_TOKEN;
  delete base.CLAUDE_STATUS_URL;
  const env = {
    ...base,
    HOME: ctx.home,
    USERPROFILE: ctx.home,
    FACTORY_TEST_MODE: "1",
    FACTORY_CONFIG: ctx.cfgPath,
    FACTORY_SWITCH_STATE: ctx.stateFile,
    SERVERCTL_REPORT_FILE: ctx.report,
    SERVERCTL_STATE: path.join(ctx.root, "serverctl-state.json"),
    ...extraEnv,
  };
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [SCTL, "server-switch", ...args], { env, windowsHide: true });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => resolve({ code, out }));
  });
}
const noTokens = (ctx, out) => {
  for (const t of [WORKER_TOKEN, STATUS_TOKEN]) {
    assert.ok(!out.includes(t), "출력에 토큰이 없다");
    if (fs.existsSync(ctx.report)) assert.ok(!read(ctx.report).includes(t), "보고에 토큰이 없다");
  }
};

test("server-switch --dry-run: 시험 호출만 하고 설정·셸 설정·상태 파일은 그대로", async () => {
  const newSite = await fakeSite();
  const oldSite = await fakeSite();
  const ctx = setupHome(oldSite.url);
  try {
    const before = { cfg: read(ctx.cfgPath), rc: read(ctx.rc) };
    const r = await runSwitch(ctx, [newSite.url, "--dry-run"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /시험 호출 통과/);
    assert.deepEqual(newSite.state.calls.sort(), ["GET /api/factory/next", "POST /api/claude-status"]);
    assert.equal(read(ctx.cfgPath), before.cfg);
    assert.equal(read(ctx.rc), before.rc);
    assert.ok(!fs.existsSync(ctx.stateFile), "상태 파일 없음");
    assert.ok(!fs.existsSync(path.join(ctx.home, "dev", "factory", "switch-backups")), "백업도 만들지 않음");
    noTokens(ctx, r.out);
  } finally {
    await closed(newSite);
    await closed(oldSite);
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("server-switch: 새 주소 시험이 하나라도 실패하면 아무것도 바꾸지 않는다(일감 확인 401·상태 401·연결 안 됨)", async () => {
  const oldSite = await fakeSite();
  const ctx = setupHome(oldSite.url);
  try {
    const before = { cfg: read(ctx.cfgPath), rc: read(ctx.rc) };
    for (const [label, site] of [
      ["일감 확인 401", await fakeSite({ next: 401 })],
      ["상태 500", await fakeSite({ status: 500 })],
    ]) {
      const r = await runSwitch(ctx, [site.url]);
      assert.equal(r.code, 5, `${label}: ${r.out}`);
      assert.match(r.out, /아무것도 바꾸지 않았어요/);
      await closed(site);
    }
    const port = await freePort();
    let r = await runSwitch(ctx, [`http://127.0.0.1:${port}`]);
    assert.equal(r.code, 5, r.out);
    assert.match(r.out, /일감 확인 (ECONNREFUSED|연결 실패|fetch failed|\w+)/);
    assert.equal(read(ctx.cfgPath), before.cfg);
    assert.equal(read(ctx.rc), before.rc);
    assert.ok(!fs.existsSync(ctx.stateFile));
    assert.match(read(ctx.report), /주소 전환 시험 실패/);
    noTokens(ctx, r.out);

    // 입력 오류: 운영 주소(https)는 시험 모드에서 거부, 같은 주소, 인자 없음
    for (const bad of [["https://www.buyoungsilcoding.com"], [oldSite.url], [], ["a", "b"], ["--nope", oldSite.url]]) {
      r = await runSwitch(ctx, bad);
      assert.notEqual(r.code, 0, bad.join(" ") + r.out);
    }
    assert.equal(read(ctx.cfgPath), before.cfg);
  } finally {
    await closed(oldSite);
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("server-switch: 통과하면 백업 후 설정·CLAUDE_STATUS_URL 줄만 바꾸고 armed 상태를 남긴다(다른 키·줄은 그대로)", async () => {
  const newSite = await fakeSite();
  const oldSite = await fakeSite();
  const ctx = setupHome(oldSite.url);
  try {
    const r = await runSwitch(ctx, [newSite.url]);
    assert.equal(r.code, 0, r.out);
    noTokens(ctx, r.out);
    const cfg = JSON.parse(read(ctx.cfgPath));
    assert.equal(cfg.serverUrl, newSite.url);
    assert.deepEqual({ ...cfg, serverUrl: ctx.cfgObj.serverUrl }, ctx.cfgObj, "serverUrl 말고는 그대로");
    assert.equal(read(ctx.rc), ctx.rcText.replace(`${oldSite.url}/api/claude-status`, `${newSite.url}/api/claude-status`), "CLAUDE_STATUS_URL 줄만 바뀜");
    const st = JSON.parse(read(ctx.stateFile));
    assert.equal(st.status, "armed");
    assert.equal(st.from.serverUrl, oldSite.url);
    assert.equal(st.to.serverUrl, newSite.url);
    assert.equal(st.from.statusUrl, `${oldSite.url}/api/claude-status`);
    assert.equal(read(path.join(st.backupDir, "supervisor.config.json")), JSON.stringify(ctx.cfgObj, null, 2) + "\n", "설정 백업은 바꾸기 전 내용");
    assert.equal(read(path.join(st.backupDir, ".bashrc")), ctx.rcText, "셸 설정 백업은 바꾸기 전 내용");
    assert.match(read(ctx.report), /감독 주소 전환 준비/);
    // 진행 중에는 다시 전환할 수 없고, --status 로 볼 수 있다
    const again = await runSwitch(ctx, [oldSite.url.replace(/:\d+$/, ":9")]);
    assert.notEqual(again.code, 0);
    const s = await runSwitch(ctx, ["--status"]);
    assert.equal(s.code, 0, s.out);
    assert.match(s.out, /armed/);
    noTokens(ctx, s.out);
  } finally {
    await closed(newSite);
    await closed(oldSite);
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("server-switch: 상태 토큰을 찾을 수 없으면 시험할 수 없어 전환하지 않는다", async () => {
  const newSite = await fakeSite();
  const oldSite = await fakeSite();
  const ctx = setupHome(oldSite.url, { bashrc: false });
  try {
    const before = read(ctx.cfgPath);
    const r = await runSwitch(ctx, [newSite.url]);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /상태 토큰/);
    assert.equal(read(ctx.cfgPath), before);
    assert.equal(newSite.state.calls.length, 0, "시험 호출도 하지 않음");
    // 환경변수로 주면 셸 설정 파일 없이도 시험은 되고, CLAUDE_STATUS_URL 줄이 없으면 건드릴 곳 없이 설정만 바꾼다
    const ok = await runSwitch(ctx, [newSite.url], { CLAUDE_STATUS_TOKEN: STATUS_TOKEN });
    assert.equal(ok.code, 0, ok.out);
    assert.equal(JSON.parse(read(ctx.cfgPath)).serverUrl, newSite.url);
    const st = JSON.parse(read(ctx.stateFile));
    assert.deepEqual(st.profiles, []);
    assert.equal(st.from.statusUrl, `${oldSite.url}/api/claude-status`, "줄이 없으면 이전 주소에서 만든 값");
  } finally {
    await closed(newSite);
    await closed(oldSite);
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

// ───────── 감독 쪽 자동 되돌림(함수) ─────────
function guardCtx({ trialSec = "0.3", launcher = false, toUrl = "http://127.0.0.1:2", fromUrl = "http://127.0.0.1:1", status = "armed", deadlineAt } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "switchguard-"));
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  const cfgPath = path.join(root, "supervisor.config.json");
  const stateFile = path.join(root, "switch.json");
  const env = { FACTORY_TEST_MODE: "1", FACTORY_SWITCH_STATE: stateFile, FACTORY_SWITCH_TRIAL_SEC: trialSec, ...(launcher ? { FACTORY_LAUNCHER: "1" } : {}), CLAUDE_STATUS_URL: `${toUrl}/api/claude-status` };
  const paths = switchPaths({ env, home });
  const rc = path.join(home, ".bashrc");
  fs.writeFileSync(rc, `export CLAUDE_STATUS_TOKEN=${STATUS_TOKEN}\nexport CLAUDE_STATUS_URL='${toUrl}/api/claude-status'\n`);
  const cfgObj = { serverUrl: toUrl, token: WORKER_TOKEN, worker: "pc1", keep: "me" };
  fs.writeFileSync(cfgPath, JSON.stringify(cfgObj, null, 2) + "\n");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ v: 1, status, from: { serverUrl: fromUrl, statusUrl: `${fromUrl}/api/claude-status` }, to: { serverUrl: toUrl, statusUrl: `${toUrl}/api/claude-status` }, profiles: [rc], backupDir: path.join(root, "bk"), ...(deadlineAt ? { deadlineAt } : {}) }),
  );
  const logs = [];
  let shut = 0;
  const cfg = { ...cfgObj };
  const start = () => startSwitchGuard({ cfg, configPath: cfgPath, log: (m) => logs.push(m), shutdown: () => shut++, env, paths });
  return { root, cfgPath, stateFile, paths, rc, env, cfg, logs, start, shutCount: () => shut, fromUrl, toUrl, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("자동 되돌림: 새 주소로 켜진 뒤 마감까지 연결 성공이 없으면 설정·CLAUDE_STATUS_URL 줄을 되돌리고 재시작(실행기 밑)", async () => {
  const g = guardCtx({ launcher: true });
  try {
    assert.equal(g.start(), "trial");
    assert.equal(readSwitchState(g.paths).status, "trial");
    assert.ok(readSwitchState(g.paths).deadlineAt, "마감이 상태 파일에 남는다");
    assert.equal(g.shutCount(), 0);
    await sleep(700);
    assert.equal(g.shutCount(), 1, "재시작(shutdown) 한 번");
    const cfg = JSON.parse(read(g.cfgPath));
    assert.equal(cfg.serverUrl, g.fromUrl, "설정 되돌림");
    assert.equal(cfg.keep, "me", "다른 키 유지");
    assert.match(read(g.rc), new RegExp(`CLAUDE_STATUS_URL='${g.fromUrl}/api/claude-status'`), "셸 설정 줄 되돌림");
    assert.match(read(g.rc), new RegExp(`CLAUDE_STATUS_TOKEN=${STATUS_TOKEN}`));
    const st = readSwitchState(g.paths);
    assert.equal(st.status, "rolledBack");
    assert.equal(st.reported, false);
    assert.ok(g.logs.some((l) => /주소 전환 되돌림/.test(l)));
    // 다음 연결 때 보고: note 문구 → 보고 표시
    assert.match(switchReportNote(g.paths), /주소 전환 되돌림: 127\.0\.0\.1:2 연결 실패 → 127\.0\.0\.1:1/);
    assert.ok(switchReportNote(g.paths).length <= 150);
    assert.equal(markSwitchReported(g.paths), true);
    assert.equal(switchReportNote(g.paths), "");
    assert.equal(markSwitchReported(g.paths), false, "두 번 표시하지 않음");
    assert.equal(readSwitchState(g.paths).reported, true);
  } finally {
    g.cleanup();
  }
});

test("자동 되돌림: 실행기 밖이면 재시작 대신 이 프로세스의 주소를 이전 것으로 바꿔 계속 돈다", async () => {
  const g = guardCtx({ launcher: false });
  try {
    assert.equal(g.start(), "trial");
    await sleep(700);
    assert.equal(g.shutCount(), 0, "끄지 않는다(다시 띄울 장치가 없음)");
    assert.equal(g.cfg.serverUrl, g.fromUrl, "메모리 주소도 이전 것");
    assert.equal(g.env.CLAUDE_STATUS_URL, `${g.fromUrl}/api/claude-status`);
    assert.equal(JSON.parse(read(g.cfgPath)).serverUrl, g.fromUrl);
    assert.equal(readSwitchState(g.paths).status, "rolledBack");
  } finally {
    g.cleanup();
  }
});

test("자동 되돌림: 마감 안에 연결 성공(noteSwitchOk)이 오면 안전장치를 풀고 아무것도 되돌리지 않는다", async () => {
  const g = guardCtx({ trialSec: "0.5" });
  try {
    assert.equal(g.start(), "trial");
    await sleep(100);
    assert.equal(noteSwitchOk(g.paths), true);
    assert.equal(readSwitchState(g.paths), null, "상태 파일 지움");
    await sleep(700);
    assert.equal(JSON.parse(read(g.cfgPath)).serverUrl, g.toUrl, "새 주소 유지");
    assert.equal(g.shutCount(), 0);
    assert.ok(g.logs.some((l) => /주소 전환 확인/.test(l)));
    assert.equal(noteSwitchOk(g.paths), false, "시험이 아닐 때는 아무 일도 안 한다");
  } finally {
    g.cleanup();
  }
});

test("자동 되돌림: 시험 중 다시 켜졌는데 마감이 이미 지났으면 시작하자마자 되돌린다(기다리지 않음)", () => {
  const g = guardCtx({ status: "trial", launcher: true, deadlineAt: new Date(Date.now() - 1000).toISOString() });
  try {
    assert.equal(g.start(), "rolledBack");
    assert.equal(g.shutCount(), 1);
    assert.equal(JSON.parse(read(g.cfgPath)).serverUrl, g.fromUrl);
  } finally {
    g.cleanup();
  }
});

test("자동 되돌림: 시험 중 다시 켜졌는데 마감이 남았으면 그 마감을 이어서 쓴다", async () => {
  const deadlineAt = new Date(Date.now() + 400).toISOString();
  const g = guardCtx({ status: "trial", launcher: true, trialSec: "100", deadlineAt });
  try {
    assert.equal(g.start(), "trial");
    assert.equal(readSwitchState(g.paths).deadlineAt, deadlineAt, "마감을 새로 늘리지 않는다");
    await sleep(900);
    assert.equal(g.shutCount(), 1);
  } finally {
    g.cleanup();
  }
});

test("감독 시작 판정: 아직 이전 주소면 재시작을 부탁하고, 설정과 안 맞는 기록은 지운다", () => {
  const g = guardCtx({ toUrl: "http://127.0.0.1:2", fromUrl: "http://127.0.0.1:1" });
  try {
    g.cfg.serverUrl = g.fromUrl; // 아직 이전 주소로 도는 감독
    assert.equal(switchRestartWanted(g.fromUrl, g.paths), true);
    assert.equal(switchRestartWanted(g.toUrl, g.paths), false, "이미 새 주소면 부탁하지 않는다");
    assert.equal(g.start(), "armed", "재시작 전이라 시험도 시작하지 않는다");
    assert.equal(readSwitchState(g.paths).status, "armed");
    g.cfg.serverUrl = "http://127.0.0.1:9"; // 사람이 손으로 제3의 주소로 바꾼 경우
    assert.equal(g.start(), "none");
    assert.equal(readSwitchState(g.paths), null);
    assert.equal(g.start(), "none", "기록이 없으면 아무것도 안 한다");
    assert.equal(switchRestartWanted(g.fromUrl, g.paths), false);
  } finally {
    g.cleanup();
  }
});

test("실행기가 쥔 옛 CLAUDE_STATUS_URL: 셸 설정의 줄과 다르면 환경변수를 새로 읽는다(없으면 건드리지 않음)", () => {
  const g = guardCtx({ toUrl: "http://127.0.0.1:2" });
  try {
    const env = { CLAUDE_STATUS_URL: "http://127.0.0.1:1/api/claude-status" };
    assert.equal(refreshStatusUrlEnv({ env, paths: g.paths }), true);
    assert.equal(env.CLAUDE_STATUS_URL, "http://127.0.0.1:2/api/claude-status");
    assert.equal(refreshStatusUrlEnv({ env, paths: g.paths }), false, "이미 같으면 그대로");
    const none = {};
    assert.equal(refreshStatusUrlEnv({ env: none, paths: g.paths }), false);
    assert.deepEqual(none, {}, "환경변수가 없으면 만들지 않는다");
  } finally {
    g.cleanup();
  }
});

// ───────── 감독 프로그램 e2e(가짜 홈페이지) ─────────
const IS_WIN = process.platform === "win32";
function startSupervisor(ctx, extraEnv = {}) {
  const env = {
    ...process.env,
    HOME: ctx.home,
    USERPROFILE: ctx.home,
    FACTORY_TEST_MODE: "1",
    FACTORY_CONFIG: ctx.cfgPath,
    FACTORY_SWITCH_STATE: ctx.stateFile,
    FACTORY_UPDATE_STATE: path.join(ctx.root, "update.json"),
    FACTORY_RESTART_STATE: path.join(ctx.root, "restart.json"),
    FACTORY_LAUNCHER_LOCK: path.join(ctx.root, "launcher.pid"),
    FACTORY_PAUSE_STATE: path.join(ctx.root, "paused.json"),
    ...extraEnv,
  };
  for (const k of ["FACTORY_LAUNCHER", "CLAUDE_STATUS_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]) delete env[k];
  let out = "";
  const sup = spawn(process.execPath, [path.join(SUP, "supervisor.mjs")], { cwd: SUP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  sup.stdout.on("data", (d) => (out += d));
  sup.stderr.on("data", (d) => (out += d));
  const stop = () => {
    if (sup.exitCode === null) sup.kill();
    if (IS_WIN && sup.pid) spawn("taskkill", ["/pid", String(sup.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  };
  return { sup, stop, out: () => out };
}
function e2eHome(serverUrl) {
  const ctx = setupHome(serverUrl, { bashrc: false });
  fs.writeFileSync(ctx.cfgPath, JSON.stringify({ serverUrl, token: WORKER_TOKEN, worker: "pc1", workDir: path.join(ctx.root, "work"), secretsFile: path.join(ctx.root, "secrets.env"), memoryRemote: "", selfdevDir: path.join(ctx.root, "selfdev"), toolkitDir: path.join(ctx.root, "toolkit"), appKitDir: path.join(ctx.root, "app-kit"), codexEnabled: false, pollSec: 5, heartbeatSec: 5 }, null, 2) + "\n");
  fs.writeFileSync(path.join(ctx.root, "secrets.env"), "");
  return ctx;
}
const armedState = (from, to, profiles = []) => ({ v: 1, status: "armed", from: { serverUrl: from, statusUrl: `${from}/api/claude-status` }, to: { serverUrl: to, statusUrl: `${to}/api/claude-status` }, profiles, backupDir: "-", armedAt: new Date().toISOString() });
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(200);
  }
  return fn();
}

test("감독 e2e: 새 주소로 켜져 대기열 확인이 200 이면 안전장치가 풀리고 새 주소를 유지한다", { timeout: 60_000 }, async () => {
  const newSite = await fakeSite();
  const oldSite = await fakeSite();
  const ctx = e2eHome(newSite.url);
  fs.writeFileSync(ctx.stateFile, JSON.stringify(armedState(oldSite.url, newSite.url)));
  const run = startSupervisor(ctx, { FACTORY_SWITCH_TRIAL_SEC: "30" });
  try {
    assert.ok(await waitFor(() => !fs.existsSync(ctx.stateFile), 20_000), `상태 파일이 지워져야 해요\n${run.out().slice(-1500)}`);
    assert.match(run.out(), /주소 전환 시험 시작/);
    assert.match(run.out(), /주소 전환 확인/);
    assert.equal(JSON.parse(read(ctx.cfgPath)).serverUrl, newSite.url);
    assert.ok(newSite.state.calls.includes("GET /api/factory/next"));
    assert.equal(oldSite.state.calls.length, 0, "이전 주소는 부르지 않음");
  } finally {
    run.stop();
    await closed(newSite);
    await closed(oldSite);
    await sleep(300);
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("감독 e2e: 새 주소가 응답하지 않으면 마감 뒤 서버 연결 없이 이전 주소로 되돌리고, 이전 주소 대기열 확인에 되돌림을 알린다", { timeout: 90_000 }, async () => {
  const oldSite = await fakeSite();
  const deadUrl = `http://127.0.0.1:${await freePort()}`;
  const ctx = e2eHome(deadUrl);
  fs.writeFileSync(ctx.stateFile, JSON.stringify(armedState(oldSite.url, deadUrl)));
  const run = startSupervisor(ctx, { FACTORY_SWITCH_TRIAL_SEC: "3" });
  try {
    assert.ok(await waitFor(() => fs.existsSync(ctx.stateFile) && JSON.parse(read(ctx.stateFile)).status === "rolledBack", 30_000), `되돌려야 해요\n${run.out().slice(-1500)}`);
    assert.equal(JSON.parse(read(ctx.cfgPath)).serverUrl, oldSite.url, "설정이 이전 주소로");
    // 실행기 밖이라 재시작 대신 이 프로세스가 이전 주소로 다시 연결한다 → 대기열 확인에 되돌림 note 가 실린다
    assert.ok(await waitFor(() => oldSite.state.notes.some((n) => /주소 전환 되돌림/.test(n)), 40_000), `이전 주소에 알려야 해요\n${run.out().slice(-1500)}`);
    assert.ok(await waitFor(() => JSON.parse(read(ctx.stateFile)).reported === true, 10_000), "200 을 받으면 보고함으로 표시");
    assert.match(run.out(), /주소 전환 되돌림/);
    assert.ok(!oldSite.state.notes.at(-1)?.includes("undefined"));
  } finally {
    run.stop();
    await closed(oldSite);
    await sleep(300);
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("감독 e2e: 새 주소가 200 이 아닌 오류(401)만 줘도 마감 뒤 되돌린다", { timeout: 60_000 }, async () => {
  const badSite = await fakeSite({ next: 500 });
  const oldSite = await fakeSite();
  const ctx = e2eHome(badSite.url);
  fs.writeFileSync(ctx.stateFile, JSON.stringify(armedState(oldSite.url, badSite.url)));
  const run = startSupervisor(ctx, { FACTORY_SWITCH_TRIAL_SEC: "3" });
  try {
    assert.ok(await waitFor(() => fs.existsSync(ctx.stateFile) && JSON.parse(read(ctx.stateFile)).status === "rolledBack", 30_000), `되돌려야 해요\n${run.out().slice(-1500)}`);
    assert.equal(JSON.parse(read(ctx.cfgPath)).serverUrl, oldSite.url);
    assert.ok(badSite.state.calls.includes("GET /api/factory/next"), "새 주소에 시도는 했음");
  } finally {
    run.stop();
    await closed(badSite);
    await closed(oldSite);
    await sleep(300);
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("감독 e2e: 이전 주소로 도는 감독은 전환이 준비되면 재시작을 부탁한다(실행기 밖이라 이유를 알리고 계속 돈다)", { timeout: 60_000 }, async () => {
  const oldSite = await fakeSite();
  const newSite = await fakeSite();
  const ctx = e2eHome(oldSite.url);
  const run = startSupervisor(ctx);
  try {
    assert.ok(await waitFor(() => oldSite.state.calls.includes("GET /api/factory/next"), 20_000), "처음엔 이전 주소로 정상 연결");
    fs.writeFileSync(ctx.stateFile, JSON.stringify(armedState(oldSite.url, newSite.url)));
    assert.ok(await waitFor(() => /주소 전환이 준비됐어요/.test(run.out()), 30_000), `재시작을 부탁해야 해요\n${run.out().slice(-1500)}`);
    assert.ok(await waitFor(() => /실행기\(run-supervisor\.sh\) 밖에서 돌고 있어/.test(run.out()), 5000), "실행기 밖이면 이유를 남기고 끄지 않는다");
    assert.equal(run.sup.exitCode, null, "끄지 않았다");
  } finally {
    run.stop();
    await closed(oldSite);
    await closed(newSite);
    await sleep(300);
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
});
