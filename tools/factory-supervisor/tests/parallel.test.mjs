// 공장 병렬화 단계 A 시험(감독 프로그램 쪽): 정비와 앱·실험 일감이 같이 돌고, 위험한 순간(감독 프로그램 업데이트·서버 배포)만 진행 중 일감이 끝나길 기다리는지.
// 실제 AI·서버는 쓰지 않는다: 가짜 홈페이지(api 함수)와 임시 git 저장소만 쓴다. 실행: node tools/factory-supervisor/tests/parallel.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { planTake } from "../slots.mjs";
import { deployHold, deployWaiting, maintenanceBusy, onNext } from "../maintenance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUP = path.resolve(HERE, "..");
const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0;
const skip = !canSpawn && "host sandbox blocks child processes";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(10);
  }
  return fn();
};

test("자리 계산: 정비 중이라는 이유만으로는 줄이지 않고, 드레인(업데이트·배포 대기)일 때만 0", () => {
  assert.equal(planTake({ limit: 3, running: 1 }), 2);
  assert.equal(planTake({ limit: 3, running: 1, maintenanceBusy: true }), 2, "예전 인자는 무시");
  assert.equal(planTake({ limit: 3, running: 1, draining: true }), 0);
  assert.equal(planTake({ limit: 3, running: 3, draining: false }), 0);
});

// ── 정비 지시·배포 (가짜 홈페이지) ──
function fakeCtx(running = { n: 0 }, extra = {}) {
  const calls = [];
  const logs = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "factory-parallel-"));
  return {
    calls,
    logs,
    tmp,
    ctx: {
      api: async (method, pathname, body) => (calls.push(body), { status: 200, data: {} }),
      log: (m) => logs.push(m),
      cfg: { selfdevDir: path.join(tmp, "selfdev"), deployRemote: "none:none.git" },
      runningApps: () => running.n,
      requestUpdateNow() {},
      compactEnabled: () => false,
      redact: (s) => s,
      ...extra,
    },
  };
}
const MAINT = { turnId: "turn1", threadId: "th1", title: "시험 정비", text: "x", aiEngine: "claude", sessionId: null, previousResult: null, deployBundling: true, queueLeft: 0 };
const DEPLOY = { threadId: "th1", commit: "abcdef1234567" };

test("정비 지시: 앱·실험 일감이 돌고 있어도 시작한다(예전에는 일감이 없을 때만)", async (t) => {
  const running = { n: 2 };
  const { ctx, calls, tmp } = fakeCtx(running);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  onNext({ maintenance: MAINT }, ctx);
  assert.equal(maintenanceBusy(), true, "정비가 바로 시작됨");
  assert.equal(await until(() => calls.some((c) => c.action === "start" && c.turnId === "turn1")), true, "서버에 시작을 알림");
  assert.equal(await until(() => !maintenanceBusy(), 5000), true, "정비 폴더가 없어 실패로 끝남(시험용)");
});

test("정비 지시: 업데이트·재시작 대기(드레인) 중에는 새로 시작하지 않는다", async (t) => {
  const { ctx, calls, tmp } = fakeCtx({ n: 0 }, { updateDraining: () => true });
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  onNext({ maintenance: { ...MAINT, turnId: "turn2" } }, ctx);
  assert.equal(maintenanceBusy(), false);
  await sleep(50);
  assert.equal(calls.length, 0, "서버 호출도 없음(대기열에 그대로 남음)");
});

test("서버 배포: 진행 중 일감이 있으면 기다리고(배포 대기=드레인), 다 끝난 다음 응답에서 시작한다", async (t) => {
  const running = { n: 1 };
  const { ctx, calls, logs, tmp } = fakeCtx(running);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  onNext({ maintenanceDeploy: DEPLOY }, ctx);
  assert.equal(deployWaiting(), true, "배포 대기");
  assert.equal(deployHold(), true);
  assert.equal(maintenanceBusy(), false, "아직 배포하지 않음");
  assert.equal(calls.length, 0, "서버에 배포 시작을 알리지 않음");
  assert.ok(logs.some((l) => /배포\] 대기: 진행 중인 일감 1개/.test(l)));
  // 정비 지시도 배포 대기 중에는 새로 시작하지 않는다
  onNext({ maintenanceDeploy: DEPLOY, maintenance: { ...MAINT, turnId: "turn3" } }, ctx);
  assert.equal(calls.length, 0);
  // 일감이 끝나면 다음 /next 응답(maintenanceDeploy 는 시작 전까지 계속 온다)에서 시작
  running.n = 0;
  onNext({ maintenanceDeploy: DEPLOY }, ctx);
  assert.equal(deployWaiting(), false);
  assert.equal(maintenanceBusy(), true, "배포 시작");
  assert.equal(await until(() => calls.some((c) => c.action === "deploy_start")), true);
  assert.equal(await until(() => calls.some((c) => c.action === "deploy_done")), true, "결과도 보고(가짜 홈페이지는 바로 받음)");
  assert.equal(await until(() => !maintenanceBusy()), true);
  assert.equal(deployHold(), false);
});

test("서버 배포: 기다리던 배포 요청이 사라지면(취소) 대기를 풀고 새 일감을 다시 받는다", async (t) => {
  const running = { n: 1 };
  const { ctx, tmp } = fakeCtx(running);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  onNext({ maintenanceDeploy: DEPLOY }, ctx);
  assert.equal(deployWaiting(), true);
  onNext({}, ctx);
  assert.equal(deployWaiting(), false);
  assert.equal(deployHold(), false);
});

test("서버 배포: 이번 응답에 방금 받은 일감이 있으면 그것도 진행 중으로 세어 배포가 겹쳐 시작하지 않는다", (t) => {
  const { ctx, calls, tmp } = fakeCtx({ n: 0 }, { runningApps: () => 0 + 2 /* running.size 0 + 방금 받은 2개 */ });
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  onNext({ maintenanceDeploy: DEPLOY }, ctx);
  assert.equal(deployWaiting(), true);
  assert.equal(calls.length, 0);
  onNext({}, ctx); // 정리
});

// ── 감독 프로그램 업데이트 (임시 git 저장소, 진짜 update.mjs) ──
test("감독 프로그램 업데이트: 일감이 돌면 받지 않고 대기(새 일감 안 받음), 모두 끝나면 받고 종료", { skip }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "factory-update-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", GIT_TERMINAL_PROMPT: "0" };
  const git = (cwd, ...args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", env, windowsHide: true });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const origin = path.join(root, "origin.git");
  const host = path.join(root, "host");
  const other = path.join(root, "other");
  fs.mkdirSync(origin);
  git(origin, "init", "-q", "--bare", "-b", "main");
  git(root, "clone", "-q", origin, host);
  const dir = path.join(host, "tools", "factory-supervisor");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(SUP, "update.mjs"), path.join(dir, "update.mjs"));
  fs.writeFileSync(path.join(dir, "supervisor.mjs"), 'import "./update.mjs";\nexport const v = 1;\n');
  git(host, "checkout", "-q", "-b", "main");
  git(host, "add", "-A");
  git(host, "commit", "-q", "-m", "init");
  git(host, "push", "-q", "origin", "main");
  const before = git(host, "rev-parse", "HEAD");
  // 정비가 감독 프로그램 코드를 바꿔 push 한 척
  git(root, "clone", "-q", origin, other);
  fs.writeFileSync(path.join(other, "tools", "factory-supervisor", "supervisor.mjs"), 'import "./update.mjs";\nexport const v = 2;\n');
  git(other, "commit", "-q", "-am", "새 버전");
  git(other, "push", "-q", "origin", "HEAD:main");
  const after = git(other, "rev-parse", "HEAD");
  assert.notEqual(before, after);

  const driver = path.join(root, "driver.mjs");
  fs.writeFileSync(
    driver,
    `import { spawnSync } from "node:child_process";
const u = await import(${JSON.stringify(pathToFileURL(path.join(dir, "update.mjs")).href)});
const head = () => spawnSync("git", ["rev-parse", "HEAD"], { cwd: ${JSON.stringify(dir)}, encoding: "utf8" }).stdout.trim();
const say = (o) => console.log("@@" + JSON.stringify(o));
u.requestUpdateNow(); // 정비가 push 한 뒤 부르는 것과 같다
u.maybeUpdate({ running: 2, autoUpdate: true });
say({ step: "busy2", waiting: u.updateWaiting(), head: head() });
u.maybeUpdate({ running: 1, autoUpdate: true });
say({ step: "busy1", waiting: u.updateWaiting(), head: head() });
u.maybeUpdate({ running: 0, autoUpdate: true });
say({ step: "NOT-EXITED" });
`,
  );
  const r = spawnSync(process.execPath, [driver], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    env: { ...env, FACTORY_LAUNCHER: "1", FACTORY_UPDATE_STATE: path.join(root, "state.json"), FACTORY_UPDATE_EVERY_SEC: "100000" },
  });
  const steps = [...r.stdout.matchAll(/^@@(.*)$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(steps.map((s) => s.step), ["busy2", "busy1"], "마지막은 종료(exit 0)라서 NOT-EXITED 가 없어야 함\n" + r.stdout);
  assert.equal(steps[0].waiting, true, "일감 2개 → 업데이트 대기(드레인)");
  assert.equal(steps[0].head, before, "대기 중에는 받지 않음");
  assert.equal(steps[1].waiting, true, "일감 1개 남아도 대기");
  assert.equal(steps[1].head, before);
  assert.match(r.stdout, /자동 업데이트 대기: 새 버전/);
  assert.match(r.stdout, /자동 업데이트 완료/);
  assert.equal(git(host, "rev-parse", "HEAD"), after, "일감이 모두 끝난 뒤 새 버전을 받음");
});

test("감독 프로그램 업데이트: 직접 요청한(지금 업데이트) 대기는 자동 업데이트 스위치를 꺼도 유지", { skip }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "factory-update-test2-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", GIT_TERMINAL_PROMPT: "0" };
  const git = (cwd, ...args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", env, windowsHide: true });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const origin = path.join(root, "origin.git");
  const host = path.join(root, "host");
  const other = path.join(root, "other");
  fs.mkdirSync(origin);
  git(origin, "init", "-q", "--bare", "-b", "main");
  git(root, "clone", "-q", origin, host);
  const dir = path.join(host, "tools", "factory-supervisor");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(SUP, "update.mjs"), path.join(dir, "update.mjs"));
  fs.writeFileSync(path.join(dir, "supervisor.mjs"), 'import "./update.mjs";\nexport const v = 1;\n');
  git(host, "checkout", "-q", "-b", "main");
  git(host, "add", "-A");
  git(host, "commit", "-q", "-m", "init");
  git(host, "push", "-q", "origin", "main");
  git(root, "clone", "-q", origin, other);
  fs.writeFileSync(path.join(other, "tools", "factory-supervisor", "supervisor.mjs"), 'import "./update.mjs";\nexport const v = 2;\n');
  git(other, "commit", "-q", "-am", "새 버전");
  git(other, "push", "-q", "origin", "HEAD:main");
  const driver = path.join(root, "driver.mjs");
  fs.writeFileSync(
    driver,
    `const u = await import(${JSON.stringify(pathToFileURL(path.join(dir, "update.mjs")).href)});
const say = (o) => console.log("@@" + JSON.stringify(o));
u.requestUpdateNow();
u.maybeUpdate({ running: 1, autoUpdate: true });
say({ step: "wait", waiting: u.updateWaiting() });
u.maybeUpdate({ running: 1, autoUpdate: false });
say({ step: "off", waiting: u.updateWaiting() });
`,
  );
  const r = spawnSync(process.execPath, [driver], { cwd: root, encoding: "utf8", windowsHide: true, env: { ...env, FACTORY_LAUNCHER: "1", FACTORY_UPDATE_STATE: path.join(root, "state.json"), FACTORY_UPDATE_EVERY_SEC: "100000" } });
  const steps = [...r.stdout.matchAll(/^@@(.*)$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  // 직접 요청(지금 업데이트)으로 걸린 대기는 자동 업데이트 스위치와 상관없이 유지된다
  assert.deepEqual(steps.map((s) => [s.step, s.waiting]), [["wait", true], ["off", true]]);
});

test("연결: 감독 루프가 업데이트·배포 대기를 새 일감 멈춤과 통제실 표시로 이어 줌", () => {
  const src = fs.readFileSync(path.join(SUP, "supervisor.mjs"), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /updateWaiting\(\) \? "update" : deployWaiting\(\) \? "deploy" : ""/);
  assert.match(src, /draining: !!drain \|\| deployHold\(\)/);
  assert.match(src, /drain, drainJobs: String\(running\.size \+ \(maintenanceBusy\(\) \? 1 : 0\)\)/);
  assert.match(src, /updateDraining: \(\) => updateWaiting\(\) \|\| restartPending\(\)/);
  assert.doesNotMatch(src, /maintenanceBusy: maintenanceBusy\(\) \}\)/, "정비 중이라서 새 일감을 멈추던 예전 코드가 없음");
  const maint = fs.readFileSync(path.join(SUP, "maintenance.mjs"), "utf8");
  assert.doesNotMatch(maint, /ctx\.runningApps\(\) === 0\) \{/, "앱 일감이 없을 때만 정비를 시작하던 조건이 없음");
});
