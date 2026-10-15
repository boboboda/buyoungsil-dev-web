// 5-2 시험(감독 프로그램 쪽): 배포 되돌리기 — 되돌리기 커밋 만들기
// 진짜 git 으로 임시 저장소(원격 bare + 정비 폴더)를 만들어 돌린다. 진짜 정비 폴더·GitHub·서버는 건드리지 않는다.
//  - 되돌리기 커밋: 부모=지금 main, 내용=대상 커밋의 내용, 감독 프로그램 코드는 지금 것 유지, 기록이 지워지지 않고 force push 가 아님
//  - 마이그레이션이 대상과 지금 사이에 바뀌었으면 만들지 않고 막는다 / 정비 폴더 변경·올리지 못한 커밋·없는 커밋이면 만들지 않는다
//  - 두 번 눌러도 같은 결과(이미 같은 내용이면 새 커밋 없이 지금 main) / push 가 거절되면 아무것도 바꾸지 않고 실패
//  - maintenance.mjs 연결: 되돌리기 요청이면 커밋을 만든 뒤 알리고 배포, 만들지 못하면 서버에 실패를 보고(배포 안 함)
// 실행: node tools/factory-supervisor/tests/revert.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildRevertCommit, gitRunner, migrationsChanged } from "../revert.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const canSpawn = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const skip = !canSpawn && "host sandbox blocks child processes";
const G = ["-c", "user.name=tester", "-c", "user.email=t@localhost", "-c", "core.autocrlf=false"];
const git = (cwd, ...a) => {
  const r = spawnSync("git", [...G, ...a], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const text = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"); // Windows 줄바꿈 변환과 상관없이 비교
const commit = (dir, msg) => {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", msg);
  return git(dir, "rev-parse", "HEAD");
};

/** c1(배포 A) → c2(배포 B: 파일 수정·추가·삭제, 감독 프로그램 코드 바뀜) 까지 올라간 저장소 */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "revert-"));
  const origin = path.join(root, "origin.git");
  const dir = path.join(root, "selfdev");

  fs.mkdirSync(origin);
  git(origin, "init", "-q", "--bare", "-b", "main");
  fs.mkdirSync(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "remote", "add", "origin", origin);
  write(dir, ".gitignore", ".factory/\n");
  write(dir, "app.txt", "v1\n");
  write(dir, "gone.txt", "will be removed later\n");
  write(dir, "tools/factory-supervisor/sup.mjs", "export const v = 1;\n");
  write(dir, "prisma/migrations/20260101_a/migration.sql", "-- a\n");
  const c1 = commit(dir, "c1: 배포 A");

  write(dir, "app.txt", "v2\n");
  write(dir, "added.txt", "new in B\n");
  fs.rmSync(path.join(dir, "gone.txt"));
  write(dir, "tools/factory-supervisor/sup.mjs", "export const v = 2;\n");
  const c2 = commit(dir, "c2: 배포 B");

  git(dir, "push", "-q", "origin", "main");

  return { root, origin, dir, c1, c2, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("되돌리기 커밋: 내용은 대상(A) 그대로, 감독 프로그램 코드는 지금 것, 기록은 지워지지 않고 force push 가 아니다", { skip }, () => {
  const r = makeRepo();

  try {
    const logs = [];
    const res = buildRevertCommit({ dir: r.dir, target: r.c1, log: (m) => logs.push(m) });

    assert.equal(res.ok, true, res.reason);
    assert.equal(res.reused, false);
    assert.match(res.commit, /^[0-9a-f]{40}$/);
    // 부모 = 되돌리기 전 main(B) → 기록이 이어진다
    assert.equal(git(r.dir, "rev-parse", `${res.commit}^`), r.c2);
    // GitHub main = 되돌리기 커밋, 보통 push 라서 B 와 A 가 모두 조상에 있다
    assert.equal(git(r.origin, "rev-parse", "main"), res.commit);
    assert.doesNotThrow(() => git(r.origin, "merge-base", "--is-ancestor", r.c2, res.commit));
    assert.doesNotThrow(() => git(r.origin, "merge-base", "--is-ancestor", r.c1, res.commit));
    // 로컬 main 도 따라갔고 작업 폴더 내용이 A 와 같다
    assert.equal(git(r.dir, "rev-parse", "HEAD"), res.commit);
    assert.equal(text(path.join(r.dir, "app.txt")), "v1\n");
    assert.ok(fs.existsSync(path.join(r.dir, "gone.txt")), "B 에서 지운 파일이 돌아온다");
    assert.ok(!fs.existsSync(path.join(r.dir, "added.txt")), "B 에서 추가한 파일이 사라진다");
    // 감독 프로그램 코드(tools/factory-supervisor)는 지금(B) 것을 그대로
    assert.equal(text(path.join(r.dir, "tools/factory-supervisor/sup.mjs")), "export const v = 2;\n");
    // A 와 비교하면 감독 프로그램 코드 말고는 차이가 없다
    assert.equal(git(r.dir, "diff", "--name-only", r.c1, res.commit, "--", ".", ":(exclude)tools/factory-supervisor"), "");
    assert.match(git(r.dir, "log", "-1", "--format=%s", res.commit), /^되돌리기: [0-9a-f]{7} 버전 상태로/);
    assert.ok(logs.some((l) => /GitHub main 에 올렸어요/.test(l)));
    assert.equal(gitRunner(r.dir)(["status", "--porcelain", "--untracked-files=no"]).stdout.trim(), "", "정비 폴더가 깨끗하다"); // 감독 프로그램과 같은 git 설정으로 본다
    assert.deepEqual(fs.readdirSync(path.join(r.dir, ".git")).filter((n) => n.startsWith("factory-revert-index")), [], "임시 index 를 지운다");
  } finally {
    r.cleanup();
  }
});

test("마이그레이션이 대상과 지금 사이에 바뀌었으면 만들지 않는다(GitHub main 은 그대로)", { skip }, () => {
  const r = makeRepo();

  try {
    write(r.dir, "prisma/migrations/20260202_b/migration.sql", "-- b\n");
    const c3 = commit(r.dir, "c3: 마이그레이션 추가");

    git(r.dir, "push", "-q", "origin", "main");
    const res = buildRevertCommit({ dir: r.dir, target: r.c1 });

    assert.equal(res.ok, false);
    assert.equal(res.blocked, "migrations");
    assert.match(res.reason, /마이그레이션/);
    assert.match(res.reason, /20260202_b/);
    assert.match(res.reason, /되돌리지 않아서/);
    assert.equal(git(r.origin, "rev-parse", "main"), c3, "아무것도 올리지 않았다");
    assert.equal(git(r.dir, "rev-parse", "HEAD"), c3);
    // 마이그레이션 이후 시점(c2 는 c3 보다 앞이라 c3 의 마이그레이션이 사이에 있음 → 막힘 / c3 로는 이미 지금)
    assert.equal(buildRevertCommit({ dir: r.dir, target: r.c2 }).blocked, "migrations");
    // migrationsChanged: 서버에 보고하는 값
    const g = gitRunner(r.dir);

    assert.equal(migrationsChanged(g, r.c1, r.c2), false);
    assert.equal(migrationsChanged(g, r.c2, c3), true);
    assert.equal(migrationsChanged(g, "zzzz", c3), null, "비교 못 하면 모름(null)");
    assert.equal(migrationsChanged(g, undefined, c3), null);
  } finally {
    r.cleanup();
  }
});

test("만들지 않는 경우: 커밋 안 된 변경 / 올리지 못한 로컬 커밋 / 없는 커밋 / main 이 아님", { skip }, () => {
  const r = makeRepo();

  try {
    write(r.dir, "app.txt", "손으로 고치는 중\n");
    const dirty = buildRevertCommit({ dir: r.dir, target: r.c1 });

    assert.equal(dirty.ok, false);
    assert.match(dirty.reason, /커밋 안 된 변경/);
    git(r.dir, "checkout", "-q", "--", "app.txt");
    write(r.dir, "local.txt", "x\n");
    const local = commit(r.dir, "로컬에만 있는 커밋");
    const ahead = buildRevertCommit({ dir: r.dir, target: r.c1 });

    assert.equal(ahead.ok, false);
    assert.match(ahead.reason, /올리지 못한 로컬 커밋/);
    assert.equal(git(r.origin, "rev-parse", "main"), r.c2, "GitHub 는 그대로");
    git(r.dir, "reset", "-q", "--hard", r.c2);
    assert.match(buildRevertCommit({ dir: r.dir, target: "0123456789abcdef0123456789abcdef01234567" }).reason, /GitHub main 에 없는 커밋/);
    assert.match(buildRevertCommit({ dir: r.dir, target: "not-a-commit" }).reason, /형식/);
    assert.match(buildRevertCommit({ dir: path.join(r.root, "nowhere"), target: r.c1 }).reason, /정비 폴더가 없어요/);
    git(r.dir, "checkout", "-q", "-b", "other");
    assert.match(buildRevertCommit({ dir: r.dir, target: r.c1 }).reason, /main 브랜치가 아니에요/);
    void local;
  } finally {
    r.cleanup();
  }
});

test("로컬이 GitHub main 보다 뒤처졌을 뿐이면 따라간 뒤 만든다", { skip }, () => {
  const r = makeRepo();

  try {
    // 다른 곳에서 올린 c3 를 이 폴더는 아직 모른다
    const other = path.join(r.root, "other");

    git(r.root, "clone", "-q", r.origin, other);
    write(other, "later.txt", "later\n");
    const c3 = commit(other, "c3: 다른 곳에서");

    git(other, "push", "-q", "origin", "main");
    const res = buildRevertCommit({ dir: r.dir, target: r.c1 });

    assert.equal(res.ok, true, res.reason);
    assert.equal(git(r.dir, "rev-parse", `${res.commit}^`), c3, "부모는 GitHub 의 지금 main");
    assert.ok(!fs.existsSync(path.join(r.dir, "later.txt")), "c3 의 파일도 A 상태로 돌아간다");
  } finally {
    r.cleanup();
  }
});

test("두 번 눌러도 같은 결과: 이미 같은 내용이면 새 커밋 없이 지금 main 을 쓴다", { skip }, () => {
  const r = makeRepo();

  try {
    const first = buildRevertCommit({ dir: r.dir, target: r.c1 });
    const second = buildRevertCommit({ dir: r.dir, target: r.c1 });

    assert.equal(first.ok && second.ok, true);
    assert.equal(second.reused, true);
    assert.equal(second.commit, first.commit);
    assert.equal(git(r.origin, "rev-parse", "main"), first.commit, "새 커밋을 더 올리지 않았다");
  } finally {
    r.cleanup();
  }
});

test("GitHub 가 push 를 거절하면(force push 는 하지 않음) 실패로 끝내고 정비 폴더는 그대로", { skip: skip || (process.platform === "win32" ? false : false) }, () => {
  const r = makeRepo();

  try {
    const hook = path.join(r.origin, "hooks", "pre-receive");

    fs.writeFileSync(hook, "#!/bin/sh\necho 'rejected by test' >&2\nexit 1\n", { mode: 0o755 });
    const res = buildRevertCommit({ dir: r.dir, target: r.c1 });

    assert.equal(res.ok, false);
    assert.match(res.reason, /GitHub main 에 올리지 못했어요/);
    assert.match(res.reason, /force push 는 하지 않아요/);
    assert.equal(git(r.dir, "rev-parse", "HEAD"), r.c2, "로컬 main 은 움직이지 않았다");
    assert.equal(git(r.origin, "rev-parse", "main"), r.c2);
    assert.equal(text(path.join(r.dir, "app.txt")), "v2\n");
  } finally {
    r.cleanup();
  }
});

test("maintenance.mjs 연결: 되돌리기 요청이면 시작을 알리고 커밋을 만든 뒤 알려서 그 커밋을 배포, 못 만들면 실패 보고(배포 안 함), 일반 배포는 마이그레이션 여부 보고", () => {
  const src = fs.readFileSync(path.join(HERE, "..", "maintenance.mjs"), "utf8").replace(/\r\n/g, "\n");

  assert.match(src, /import \{ buildRevertCommit, migrationsChanged \} from "\.\/revert\.mjs"/);
  assert.match(src, /const revertTo = typeof d\?\.revertTo === "string" && COMMIT_RE\.test\(d\.revertTo\) \? d\.revertTo : ""/);
  assert.match(src, /const made = buildRevertCommit\(\{ dir, target: revertTo, log, remoteName: mr \}\)/);
  assert.match(src, /if \(!made\.ok\) \{[\s\S]*?sendDeployDone\(ctx, threadId, false, `되돌리기를 하지 않았어요\. 서버는 그대로예요\./, "못 만들면 배포하지 않고 실패 보고");
  assert.match(src, /action: "deploy_revert_commit", threadId, from: revertTo, commit: made\.commit/);
  assert.match(src, /commit = made\.commit;/, "이후 평소 배포 경로로 그 커밋을 push 한다");
  assert.match(src, /migrationsChanged\(git, d\.prevCommit, commit\)/);
  assert.match(src, /\.\.\.\(typeof migrations === "boolean" \? \{ migrations \} : \{\}\)/);
  // force push 는 어디에도 없다: push 를 부르는 줄에 --force·-f·+refspec·force-with-lease 가 없고, 되돌리기 파일에는 reset 도 없다
  const revertSrc = fs.readFileSync(path.join(HERE, "..", "revert.mjs"), "utf8");
  const pushLines = (src + revertSrc).split("\n").filter((l) => /\["push"/.test(l));

  assert.ok(pushLines.length >= 2, "push 를 부르는 줄을 찾았다");
  for (const l of pushLines) assert.doesNotMatch(l, /--force|"-f"|force-with-lease|"\+|\+refs/, l);
  assert.doesNotMatch(revertSrc, /"reset"/);
});

// ───────── 연결 시험: onNext → deploy() → 되돌리기 커밋 → 배포 저장소 push ─────────
// 서버(홈페이지)는 호출을 기록하는 가짜, 배포 저장소는 임시 bare 저장소(훅이 "컨테이너 교체 완료" 문구를 찍는다), 건강 확인은 가짜 fetch(200)다.
const { onNext } = await import("../maintenance.mjs");

function deployRig(r, { hookText = "Recreating developWeb ... done", cfg = {} } = {}) {
  const deployRepo = path.join(r.root, "deploy.git");

  fs.mkdirSync(deployRepo);
  git(deployRepo, "init", "-q", "--bare", "-b", "main");
  fs.writeFileSync(path.join(deployRepo, "hooks", "pre-receive"), `#!/bin/sh\necho '${hookText}' >&2\nexit 0\n`, { mode: 0o755 });
  const calls = [];
  const logs = [];
  const ctx = {
    cfg: { selfdevDir: r.dir, deployRemote: deployRepo, ...cfg },
    log: (m) => logs.push(m),
    uploadBusy: () => 0,
    api: async (method, url, body) => {
      calls.push(body);

      return { status: 200, data: { ok: true } };
    },
  };
  const done = async () => {
    for (let i = 0; i < 400; i++) {
      const d = calls.find((c) => c.action === "deploy_done");

      if (d) return d;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error(`deploy_done 이 오지 않았어요: ${JSON.stringify(calls)} ${logs.join(" | ")}`);
  };

  return { deployRepo, calls, logs, ctx, done };
}

test("연결: 되돌리기 요청 → 시작 알림 → 되돌리기 커밋 → 서버에 알림 → 그 커밋을 배포 저장소에 push → 성공 보고", { skip }, async () => {
  const r = makeRepo();
  const realFetch = globalThis.fetch;

  globalThis.fetch = async () => ({ status: 200 });
  try {
    const rig = deployRig(r);

    onNext({ maintenanceDeploy: { threadId: "th1", commit: r.c1, revertTo: r.c1, prevCommit: r.c2 } }, rig.ctx);
    const done = await rig.done();
    const actions = rig.calls.map((c) => c.action);

    assert.deepEqual(actions, ["deploy_start", "deploy_revert_commit", "deploy_done"], rig.logs.join(" | "));
    assert.equal(rig.calls[0].commit, r.c1);
    assert.equal(rig.calls[1].from, r.c1);
    const made = rig.calls[1].commit;

    assert.match(made, /^[0-9a-f]{40}$/);
    assert.notEqual(made, r.c1);
    assert.equal(done.ok, true, done.output);
    assert.equal(git(rig.deployRepo, "rev-parse", "main"), made, "배포 저장소에는 되돌리기 커밋이 올라갔다");
    assert.equal(git(r.origin, "rev-parse", "main"), made, "GitHub main 에도 그 커밋(보통 push)");
    assert.equal(git(r.dir, "diff", "--name-only", r.c1, made, "--", ".", ":(exclude)tools/factory-supervisor"), "");
  } finally {
    globalThis.fetch = realFetch;
    r.cleanup();
  }
});

test("연결: 마이그레이션이 사이에 있으면 커밋도 push 도 하지 않고 서버에 실패(이유)만 보고한다", { skip }, async () => {
  const r = makeRepo();
  const realFetch = globalThis.fetch;

  globalThis.fetch = async () => ({ status: 200 });
  try {
    write(r.dir, "prisma/migrations/20260202_b/migration.sql", "-- b\n");
    const c3 = commit(r.dir, "c3: 마이그레이션");

    git(r.dir, "push", "-q", "origin", "main");
    const rig = deployRig(r);

    onNext({ maintenanceDeploy: { threadId: "th1", commit: r.c1, revertTo: r.c1, prevCommit: c3 } }, rig.ctx);
    const done = await rig.done();

    assert.deepEqual(rig.calls.map((c) => c.action), ["deploy_start", "deploy_done"], "되돌리기 커밋을 만들었다고 알리지 않는다");
    assert.equal(done.ok, false);
    assert.match(done.output, /마이그레이션/);
    assert.match(done.output, /서버는 그대로예요/);
    assert.equal(git(r.origin, "rev-parse", "main"), c3, "GitHub main 은 그대로");
    assert.equal(spawnSync("git", ["rev-parse", "--verify", "-q", "main"], { cwd: rig.deployRepo, windowsHide: true }).status, 1, "배포 저장소에는 아무것도 올라가지 않았다");
  } finally {
    globalThis.fetch = realFetch;
    r.cleanup();
  }
});

test("연결: 일반 배포는 앞선 배포(prevCommit) 대비 마이그레이션 여부를 시작 보고에 싣는다(되돌리기 판단용)", { skip }, async () => {
  for (const [withMigration, prevOf] of [[false, (r) => r.c1], [true, (r) => r.c1]]) {
    const r = makeRepo();
    const realFetch = globalThis.fetch;

    globalThis.fetch = async () => ({ status: 200 });
    try {
      let target = r.c2;

      if (withMigration) {
        write(r.dir, "prisma/migrations/20260303_c/migration.sql", "-- c\n");
        target = commit(r.dir, "c3: 마이그레이션");
        git(r.dir, "push", "-q", "origin", "main");
      }
      const rig = deployRig(r);

      onNext({ maintenanceDeploy: { threadId: "th1", commit: target, prevCommit: prevOf(r) } }, rig.ctx);
      const done = await rig.done();
      const start = rig.calls.find((c) => c.action === "deploy_start");

      assert.equal(done.ok, true, done.output);
      assert.equal(start.migrations, withMigration);
      assert.equal(git(rig.deployRepo, "rev-parse", "main"), target);
      assert.ok(!rig.calls.some((c) => c.action === "deploy_revert_commit"), "일반 배포는 되돌리기 커밋을 만들지 않는다");
    } finally {
      globalThis.fetch = realFetch;
      r.cleanup();
    }
  }
  // 예전 서버(prevCommit 없음): migrations 를 보내지 않는다(모름)
  const r = makeRepo();
  const realFetch = globalThis.fetch;

  globalThis.fetch = async () => ({ status: 200 });
  try {
    const rig = deployRig(r);

    onNext({ maintenanceDeploy: { threadId: "th1", commit: r.c2 } }, rig.ctx);
    await rig.done();
    assert.equal(Object.hasOwn(rig.calls.find((c) => c.action === "deploy_start"), "migrations"), false);
  } finally {
    globalThis.fetch = realFetch;
    r.cleanup();
  }
});

test("연결: deploy 설정(factory 값)이면 성공 문구·헬스 주소·합격 코드가 설정을 따른다(기본값은 위 시험들이 그대로 통과)", { skip }, async () => {
  const dep = { containerName: "factoryWeb", healthUrl: "https://factory.example.com/api/factory/next", healthExpect: [401] };
  const realFetch = globalThis.fetch;
  try {
    // 설정한 컨테이너 문구 + 설정한 주소가 401 → 성공
    let r = makeRepo();
    const urls = [];
    globalThis.fetch = async (u, o) => (urls.push([String(u), o?.redirect]), { status: 401 });
    let rig = deployRig(r, { hookText: "Recreating factoryWeb ... done", cfg: { deploy: dep } });
    onNext({ maintenanceDeploy: { threadId: "th1", commit: r.c2 } }, rig.ctx);
    let done = await rig.done();
    assert.equal(done.ok, true, done.output);
    assert.match(done.output, /헬스체크 401/);
    assert.deepEqual(urls[0], ["https://factory.example.com/api/factory/next", "follow"]);
    assert.ok(!urls.some(([u]) => u.includes("buyoungsilcoding")), "블로그 주소로 확인하지 않는다");
    r.cleanup();
    // 기본 문구(developWeb)만 찍는 훅은 factory 설정에서는 교체 표시로 인정하지 않는다
    r = makeRepo();
    rig = deployRig(r, { hookText: "Recreating developWeb ... done", cfg: { deploy: dep } });
    onNext({ maintenanceDeploy: { threadId: "th1", commit: r.c2 } }, rig.ctx);
    done = await rig.done();
    assert.equal(done.ok, false);
    assert.match(done.output, /교체 표시가 없음/);
    r.cleanup();
    // 3xx 를 합격으로 두면 리다이렉트를 따라가지 않고 그 코드를 본다(factory 의 미로그인 / 는 307)
    r = makeRepo();
    urls.length = 0;
    globalThis.fetch = async (u, o) => (urls.push([String(u), o?.redirect]), { status: 307 });
    rig = deployRig(r, { hookText: "Recreating factoryWeb ... done", cfg: { deploy: { ...dep, healthUrl: "https://factory.example.com/", healthExpect: [307] } } });
    onNext({ maintenanceDeploy: { threadId: "th1", commit: r.c2 } }, rig.ctx);
    done = await rig.done();
    assert.equal(done.ok, true, done.output);
    assert.equal(urls[0][1], "manual");
    r.cleanup();
    // 설정이 잘못되면 push 하지 않고 실패로 알린다
    r = makeRepo();
    rig = deployRig(r, { cfg: { deploy: { containerName: "bad name;x" } } });
    onNext({ maintenanceDeploy: { threadId: "th1", commit: r.c2 } }, rig.ctx);
    done = await rig.done();
    assert.equal(done.ok, false);
    assert.match(done.output, /deploy.containerName/);
    assert.equal(spawnSync("git", ["rev-parse", "--verify", "-q", "main"], { cwd: rig.deployRepo, windowsHide: true }).status, 1, "배포 저장소에 올리지 않았다");
    r.cleanup();
  } finally {
    globalThis.fetch = realFetch;
  }
});
