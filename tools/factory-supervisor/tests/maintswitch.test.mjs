// 정비 대상 전환(maint-switch) 시험: 점검·--dry-run·실행·내용이 다를 때 거부·감독 쪽 5분 시험(성공·되돌림)·--revert·정비 보호 규칙.
// 진짜 설정·진짜 실행 폴더·진짜 bare 는 쓰지 않는다. 임시 HOME 안에 가짜 GitHub(bare)·감독 전용 bare·실행 폴더·정비 clone 을 만든다.
// 실행: node tools/factory-supervisor/tests/maintswitch.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkLocalCommand, isProtectedPath, isTrustedServerctlCall } from "../pcguard.mjs";
import { SUBCOMMANDS } from "../serverctl.mjs";
import { maintSwitchPaths, maintSwitchReportNote, markMaintSwitchReported, noteMaintSwitchOk, readMaintSwitchState, runMaintSwitch, sameRemote, startMaintSwitchGuard, maintSwitchRestartWanted } from "../maintswitch.mjs";

const canSpawn = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const skip = !canSpawn && "git 을 실행할 수 없는 환경";
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_TERMINAL_PROMPT: "0" };
const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const read = (p) => fs.readFileSync(p, "utf8");

/** 임시 HOME 에 전체 환경을 만든다 */
function fixture({ crlfBare = true, bareDiffers = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "maintsw-"));
  const root = path.join(home, "dev", "factory");
  const ghBare = path.join(home, "gh.git");
  const bare = path.join(home, "dev", "git", "factory-supervisor.git");
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  // 가짜 GitHub: 웹 앱 파일 + 감독 파일
  const w = path.join(home, "w");
  fs.mkdirSync(w);
  git(w, "init", "-q", "-b", "main");
  git(w, "config", "core.autocrlf", "false");
  put(w, "app/page.tsx", "export default 1;\n");
  put(w, "tools/factory-supervisor/a.mjs", "export const a = 1;\n");
  put(w, "tools/factory-supervisor/b.mjs", "export const b = 2;\n");
  git(w, "add", "-A");
  git(w, "commit", "-q", "-m", "init");
  git(home, "init", "-q", "--bare", "-b", "main", ghBare);
  git(w, "push", "-q", ghBare, "main");
  // 감독 전용 bare: 감독 파일만(b.mjs 는 CRLF 로 저장 — 내용은 줄바꿈 빼고 같다)
  const x = path.join(home, "x");
  fs.mkdirSync(x);
  git(x, "init", "-q", "-b", "main");
  git(x, "config", "core.autocrlf", "false");
  put(x, "tools/factory-supervisor/a.mjs", "export const a = 1;\n");
  put(x, "tools/factory-supervisor/b.mjs", crlfBare ? "export const b = 2;\r\n" : "export const b = 2;\n");
  if (bareDiffers) put(x, "tools/factory-supervisor/a.mjs", "export const a = 99;\n");
  git(x, "add", "-A");
  git(x, "commit", "-q", "-m", "bare init");
  git(home, "init", "-q", "--bare", "-b", "main", bare);
  git(x, "push", "-q", bare, "main");
  // 실행 폴더(GitHub clone)와 정비 clone(bare clone)
  const src = path.join(root, "supervisor-src");
  git(home, "clone", "-q", "-c", "core.autocrlf=false", ghBare, src);
  git(src, "config", "core.autocrlf", "false");
  const maint = path.join(root, "factory-supervisor");
  git(home, "clone", "-q", "-c", "core.autocrlf=false", bare, maint);
  const configPath = path.join(root, "supervisor.config.json");
  fs.writeFileSync(configPath, JSON.stringify({ serverUrl: "http://127.0.0.1:1", token: "t0k3n-fake-0123456789", worker: "w" }, null, 2) + "\n");
  const env = { FACTORY_TEST_MODE: "1", FACTORY_MAINT_SWITCH_STATE: path.join(root, "state.json"), FACTORY_MAINT_TRIAL_SEC: "1" };
  const paths = maintSwitchPaths({ env, home });
  const out = [];
  const reports = [];
  const deps = (args) => ({
    args,
    configPath,
    srcDir: src,
    say: (s) => out.push(s),
    die: (s) => {
      throw new Error(`DIE: ${s}`);
    },
    report: async (s) => void reports.push(s),
    env,
    home,
    paths,
  });
  return { home, root, bare, ghBare, src, maint, configPath, env, paths, out, reports, deps, cfg: () => JSON.parse(read(configPath)) };
}

test("sameRemote: 역슬래시·/c/ 꼴·대소문자·끝 슬래시를 같게 본다", () => {
  assert.ok(sameRemote("C:\\Users\\X\\dev\\git\\a.git", "c:/users/x/dev/git/a.git/"));
  assert.ok(sameRemote("/c/Users/x/dev/git/a.git", "C:/Users/x/dev/git/a.git"));
  assert.ok(!sameRemote("C:/a.git", "C:/b.git"));
});

test("--dry-run: 바뀔 값만 보여 주고 아무것도 바꾸지 않는다", { skip }, async () => {
  const f = fixture();
  const before = read(f.configPath);
  const head = git(f.src, "rev-parse", "HEAD");
  const origin = git(f.src, "remote", "get-url", "origin");
  await runMaintSwitch(f.deps(["--dry-run"]));
  assert.match(f.out.join("\n"), /dry-run.*통과/s);
  assert.match(f.out.join("\n"), /maintDir: \(없음\) → /);
  assert.match(f.out.join("\n"), /maintPushRemote: \(없음\) → "origin"/);
  assert.equal(read(f.configPath), before);
  assert.equal(git(f.src, "rev-parse", "HEAD"), head);
  assert.equal(git(f.src, "remote", "get-url", "origin"), origin);
  assert.equal(readMaintSwitchState(f.paths), null);
  assert.ok(!fs.existsSync(path.join(f.root, "switch-backups")));
});

test("실행: 백업 → 설정 → origin → 커밋 맞춤 → 새 버전 없음 확인, 상태 armed·재시작 요청", { skip }, async () => {
  const f = fixture();
  const oldHead = git(f.src, "rev-parse", "HEAD");
  const oldOrigin = git(f.src, "remote", "get-url", "origin");
  const bareMain = git(f.bare, "rev-parse", "refs/heads/main");
  await runMaintSwitch(f.deps([]));
  const cfg = f.cfg();
  assert.equal(cfg.maintDir, path.resolve(f.maint));
  assert.equal(cfg.maintPushRemote, "origin");
  assert.equal(cfg.token, "t0k3n-fake-0123456789", "다른 키는 그대로");
  assert.ok(sameRemote(git(f.src, "remote", "get-url", "origin"), f.bare));
  assert.equal(git(f.src, "rev-parse", "HEAD"), bareMain);
  // update.mjs 와 같은 판정: origin/main == HEAD → 새 버전 없음
  git(f.src, "fetch", "-q", "origin", "main");
  assert.equal(git(f.src, "rev-parse", "origin/main"), git(f.src, "rev-parse", "HEAD"));
  assert.ok(!fs.existsSync(path.join(f.src, "app", "page.tsx")), "감독 밖 파일은 실행 폴더에서 빠진다");
  assert.ok(fs.existsSync(path.join(f.src, "tools", "factory-supervisor", "a.mjs")));
  const st = readMaintSwitchState(f.paths);
  assert.equal(st.status, "armed");
  assert.equal(st.from.head, oldHead);
  assert.equal(st.from.origin, oldOrigin);
  assert.ok(fs.existsSync(path.join(st.backupDir, "supervisor.config.json")));
  assert.match(read(path.join(st.backupDir, "src-git.txt")), new RegExp(oldHead));
  assert.deepEqual(JSON.parse(read(path.join(st.backupDir, "supervisor.config.json"))).maintDir, undefined);
  // 돌고 있는 감독(옛 설정)은 재시작을 부탁한다. 새 설정으로 켠 감독은 부탁하지 않는다
  assert.equal(maintSwitchRestartWanted({}, f.paths), true);
  assert.equal(maintSwitchRestartWanted({ maintDir: cfg.maintDir }, f.paths), false);
  // 같은 상태에서 다시 실행하면 거부
  await assert.rejects(runMaintSwitch(f.deps([])), /진행 중/);
  assert.ok(f.reports.some((r) => /정비 전환 준비/.test(r)));
});

test("bare 와 실행 폴더의 감독 파일 내용이 다르면 아무것도 바꾸지 않는다(CRLF 차이는 같은 것으로 본다)", { skip }, async () => {
  const f = fixture({ bareDiffers: true });
  const before = read(f.configPath);
  const head = git(f.src, "rev-parse", "HEAD");
  const origin = git(f.src, "remote", "get-url", "origin");
  await assert.rejects(runMaintSwitch(f.deps([])), /내용이 달라요.*a\.mjs/s);
  assert.equal(read(f.configPath), before);
  assert.equal(git(f.src, "rev-parse", "HEAD"), head);
  assert.equal(git(f.src, "remote", "get-url", "origin"), origin);
  assert.equal(readMaintSwitchState(f.paths), null);
  const g = fixture({ crlfBare: false });
  await runMaintSwitch(g.deps(["--dry-run"]));
});

test("정비 clone 이 더럽거나 bare main 과 다르면 거부", { skip }, async () => {
  const f = fixture();
  put(f.maint, "tools/factory-supervisor/a.mjs", "export const a = 5;\n");
  await assert.rejects(runMaintSwitch(f.deps([])), /커밋하지 않은 변경/);
  git(f.maint, "checkout", "--", ".");
  put(f.maint, "tools/factory-supervisor/c.mjs", "x\n");
  git(f.maint, "add", "-A");
  git(f.maint, "commit", "-q", "-m", "local only");
  await assert.rejects(runMaintSwitch(f.deps([])), /bare main.*달라요/);
  assert.equal(readMaintSwitchState(f.paths), null);
});

test("실행 폴더에 커밋하지 않은 변경이 있으면 거부", { skip }, async () => {
  const f = fixture();
  put(f.src, "tools/factory-supervisor/a.mjs", "export const a = 7;\n");
  await assert.rejects(runMaintSwitch(f.deps([])), /실행 폴더에 커밋하지 않은 변경/);
});

test("감독 쪽 시험: 새 설정으로 켜지면 trial, 대기열 확인 성공이면 done(안전장치 해제), --status 에 보임", { skip }, async () => {
  const f = fixture();
  await runMaintSwitch(f.deps([]));
  const newCfg = { maintDir: f.cfg().maintDir };
  const logs = [];
  let shut = 0;
  // 재시작 전(옛 설정)은 armed
  assert.equal(startMaintSwitchGuard({ cfg: {}, configPath: f.configPath, srcDir: f.src, log: (m) => logs.push(m), shutdown: () => shut++, env: f.env, paths: f.paths }), "armed");
  assert.equal(startMaintSwitchGuard({ cfg: newCfg, configPath: f.configPath, srcDir: f.src, log: (m) => logs.push(m), shutdown: () => shut++, env: f.env, paths: f.paths }), "trial");
  assert.equal(readMaintSwitchState(f.paths).status, "trial");
  assert.ok(readMaintSwitchState(f.paths).deadlineAt);
  assert.equal(noteMaintSwitchOk(f.paths), true);
  assert.equal(readMaintSwitchState(f.paths).status, "done");
  assert.equal(shut, 0);
  assert.equal(f.cfg().maintPushRemote, "origin", "성공하면 설정은 그대로");
  f.out.length = 0;
  await runMaintSwitch(f.deps(["--status"]));
  assert.match(f.out.join(""), /done/);
  // 이미 전환돼 있으면 다시 하지 않는다
  await assert.rejects(runMaintSwitch(f.deps([])), /이미 전환/);
});

test("감독 쪽 시험: 마감까지 확인이 없으면 설정·origin·커밋을 되돌리고 재시작을 부탁, 다음 확인 note 로 알림", { skip }, async () => {
  const f = fixture();
  const oldHead = git(f.src, "rev-parse", "HEAD");
  const oldOrigin = git(f.src, "remote", "get-url", "origin");
  await runMaintSwitch(f.deps([]));
  const newCfg = { maintDir: f.cfg().maintDir };
  const logs = [];
  let shut = 0;
  const env = { ...f.env, FACTORY_LAUNCHER: "1" };
  assert.equal(startMaintSwitchGuard({ cfg: newCfg, configPath: f.configPath, srcDir: f.src, log: (m) => logs.push(m), shutdown: () => shut++, env, paths: f.paths }), "trial");
  await new Promise((r) => setTimeout(r, 1400)); // FACTORY_MAINT_TRIAL_SEC=1
  assert.equal(shut, 1);
  const st = readMaintSwitchState(f.paths);
  assert.equal(st.status, "rolledBack");
  const cfg = f.cfg();
  assert.equal(cfg.maintDir, undefined);
  assert.equal(cfg.maintPushRemote, undefined);
  assert.equal(cfg.token, "t0k3n-fake-0123456789");
  assert.equal(git(f.src, "remote", "get-url", "origin"), oldOrigin);
  assert.equal(git(f.src, "rev-parse", "HEAD"), oldHead);
  assert.ok(fs.existsSync(path.join(f.src, "app", "page.tsx")), "감독 밖 파일도 돌아온다");
  assert.match(maintSwitchReportNote(f.paths), /정비 전환 되돌림/);
  assert.ok(maintSwitchReportNote(f.paths).length <= 150);
  assert.equal(markMaintSwitchReported(f.paths), true);
  assert.equal(maintSwitchReportNote(f.paths), "");
  // 되돌린 뒤에는 다시 전환할 수 있다
  await runMaintSwitch(f.deps(["--dry-run"]));
});

test("--revert: 이전 값으로 되돌리고 재시작을 부탁, 이전 설정으로 켜지면 reverted", { skip }, async () => {
  const f = fixture();
  const oldHead = git(f.src, "rev-parse", "HEAD");
  const oldOrigin = git(f.src, "remote", "get-url", "origin");
  await assert.rejects(runMaintSwitch(f.deps(["--revert"])), /되돌릴 전환이 없어요/);
  await runMaintSwitch(f.deps([]));
  const newCfg = { maintDir: f.cfg().maintDir };
  startMaintSwitchGuard({ cfg: newCfg, configPath: f.configPath, srcDir: f.src, log: () => {}, shutdown: () => {}, env: f.env, paths: f.paths });
  noteMaintSwitchOk(f.paths); // done
  await runMaintSwitch(f.deps(["--revert"]));
  assert.equal(f.cfg().maintDir, undefined);
  assert.equal(f.cfg().maintPushRemote, undefined);
  assert.equal(git(f.src, "remote", "get-url", "origin"), oldOrigin);
  assert.equal(git(f.src, "rev-parse", "HEAD"), oldHead);
  assert.equal(readMaintSwitchState(f.paths).status, "reverting");
  assert.equal(maintSwitchRestartWanted(newCfg, f.paths), true, "아직 새 설정으로 도는 감독은 재시작을 부탁한다");
  assert.equal(maintSwitchRestartWanted({}, f.paths), false);
  assert.equal(startMaintSwitchGuard({ cfg: {}, configPath: f.configPath, srcDir: f.src, log: () => {}, shutdown: () => {}, env: f.env, paths: f.paths }), "reverted");
  assert.equal(readMaintSwitchState(f.paths).status, "reverted");
  assert.ok(f.reports.some((r) => /--revert/.test(r)));
});

test("사용법 오류: 알 수 없는 옵션·여러 옵션·남는 인자", { skip }, async () => {
  const f = fixture();
  for (const a of [["--now"], ["--dry-run", "--revert"], ["x"]]) await assert.rejects(runMaintSwitch(f.deps(a)), /maint-switch/);
});

test("정비 보호: maint-switch 는 신뢰된 serverctl 한 줄만 통과, 상태 파일·백업은 정비가 못 고친다", () => {
  assert.ok(SUBCOMMANDS.includes("maint-switch"));
  const ctl = "C:/Users/x/dev/factory/supervisor-src/tools/factory-supervisor/serverctl.mjs";
  assert.equal(isTrustedServerctlCall(`node "${ctl}" maint-switch --dry-run`), true);
  assert.equal(isTrustedServerctlCall(`node "${ctl}" maint-switch --revert`), true);
  assert.equal(isTrustedServerctlCall(`node "${ctl}" maint-switch && rm -rf x`), false);
  assert.equal(isTrustedServerctlCall(`node ./tools/factory-supervisor/serverctl.mjs maint-switch`), false, "정비 폴더 사본은 신뢰하지 않는다");
  assert.ok(isProtectedPath("~/dev/factory/supervisor-maint-switch.json"));
  assert.equal(checkLocalCommand("rm ~/dev/factory/supervisor-maint-switch.json").decision, "deny");
  assert.equal(checkLocalCommand("echo {} > ~/dev/factory/switch-backups/maint-1/x").decision, "deny");
});
