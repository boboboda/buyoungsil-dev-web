// 실험(lab) 일감 시험: 폴더 경로 보호, 쓰기 제한 설정(Claude)·Codex 옵션, 사후 검사(git status 비교), 결과 파일 고르기·올리기, 폴더 지우기.
// 진짜 git 저장소(임시 폴더)로 확인한다: 다른 앱 폴더의 파일을 실험 폴더로 복사하는 것은 통과, 그 앱 폴더에 쓰면 사후 검사가 잡는다.
// 실행: node tools/factory-supervisor/tests/lab.test.mjs (npm run test:lab)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  LAB_CHUNK,
  LAB_FILE_COUNT_MAX,
  LAB_FILE_MAX,
  LAB_JOB_MAX,
  compareSnapshots,
  createLabGuard,
  deleteLabFolder,
  discoverRepos,
  labCodexOptions,
  labDirOf,
  labPrompt,
  listLabOutputs,
  pathsFromPlan,
  pickUploads,
  prepareLab,
  snapshotRepos,
  uploadLabOutputs,
  writeLabClaudeSettings,
} from "../lab.mjs";
import { invocation } from "../ai-runner.mjs";

const gitOk = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
};

// 가짜 공장 폴더: 앱 저장소 두 개(app-a, app-b) + lab
function factory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "factory-lab-test-"));
  t.after(() => {
    assert.ok(path.basename(root).startsWith("factory-lab-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const name of ["app-a", "app-b"]) {
    const d = path.join(root, name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "main.txt"), `${name} main\n`);
    fs.writeFileSync(path.join(d, "notes.txt"), "keep\n");
    git(d, "init", "-q");
    git(d, "-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
    git(d, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  }
  fs.writeFileSync(path.join(root, "supervisor.config.json"), "{}");
  fs.writeFileSync(path.join(root, "secrets.env"), "X=1");
  return root;
}

const job = (extra = {}) => ({ id: "cmlabtest0001", title: "실험", planMarkdown: "outputs/result.png 와 outputs/clip.mp4 를 만들어 보세요. 설명 설명 설명 설명 설명 설명 설명.", ...extra });

test("실험 폴더 경로: 일감 id 형식·shared·lab 밖은 거절", (t) => {
  const root = factory(t);
  assert.equal(labDirOf(root, "cmlabtest0001"), path.join(root, "lab", "cmlabtest0001"));
  for (const bad of ["shared", "..", "../x", "a/b", "a\\b", "", "x".repeat(41), null, undefined, 5]) assert.throws(() => labDirOf(root, bad), /id|경로/);
  const paths = prepareLab(root, job());
  assert.ok(fs.statSync(paths.outputs).isDirectory());
  assert.ok(fs.statSync(paths.shared).isDirectory());
  assert.match(fs.readFileSync(path.join(paths.dir, "PLAN.md"), "utf8"), /outputs\/result\.png/);
});

test("Claude 쓰기 제한: 실험 폴더만 허용, 다른 폴더·설정·비밀 파일은 금지", (t) => {
  const root = factory(t);
  const { dir, shared } = prepareLab(root, job());
  const file = writeLabClaudeSettings({ workDir: root, dir, shared, jobId: "cmlabtest0001", extraProtected: [path.join(root, "selfdev")] });
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  const abs = (p) => path.resolve(p).replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase()).replace(/^\/+/, "");
  // 쓰기 허용은 실험 폴더 둘뿐
  const editAllow = s.permissions.allow.filter((r) => r.startsWith("Edit("));
  assert.deepEqual(editAllow.sort(), [`Edit(//${abs(dir)}/**)`, `Edit(//${abs(shared)}/**)`].sort());
  assert.ok(s.permissions.allow.includes("Bash"));
  assert.ok(s.permissions.allow.includes(`Read(//${abs(root)}/**)`));
  assert.deepEqual(s.permissions.additionalDirectories, [path.resolve(shared).replace(/\\/g, "/")]);
  // 공장 폴더 안 다른 항목은 쓰기 금지, lab 은 금지하지 않는다
  for (const name of ["app-a", "app-b"]) assert.ok(s.permissions.deny.includes(`Edit(//${abs(root)}/${name}/**)`), name);
  assert.ok(s.permissions.deny.includes(`Edit(//${abs(root)}/secrets.env)`));
  assert.ok(s.permissions.deny.includes(`Read(//${abs(root)}/secrets.env*)`));
  assert.ok(s.permissions.deny.includes(`Read(//${abs(root)}/supervisor.config.json)`));
  assert.ok(!s.permissions.deny.some((r) => r.includes("/lab/")));
  // 설정 파일은 쓰기 허용 폴더 밖에 있다
  assert.ok(!path.resolve(file).startsWith(path.resolve(dir)) && !path.resolve(file).startsWith(path.resolve(shared)));
});

test("Codex 옵션: 실험일 때만 네트워크 허용·쓰기 루트 추가, 앱 일감은 예전 그대로", () => {
  const app = invocation("codex", {}).args.join(" ");
  assert.match(app, /network_access=false/);
  assert.doesNotMatch(app, /writable_roots/);
  const lab = invocation("codex", {}, { lab: labCodexOptions("C:\\factory\\lab\\shared") }).args;
  assert.ok(lab.includes("sandbox_workspace_write.network_access=true"));
  assert.ok(lab.includes('sandbox_workspace_write.writable_roots=["C:/factory/lab/shared"]'));
  assert.ok(lab.includes('sandbox_mode="workspace-write"'));
  assert.ok(lab.includes('approval_policy="never"'));
  // Claude 인자는 lab 옵션을 무시한다(앱 일감과 같음)
  assert.deepEqual(invocation("claude", {}, { lab: { network: true } }).args, invocation("claude", {}).args);
});

test("지시문 머리말: 폴더·금지·결과 위치·받은 파일 기록을 담는다", () => {
  const text = labPrompt({ job: job(), dir: "D:/f/lab/cmlabtest0001", shared: "D:/f/lab/shared", workDir: "D:/f" });
  for (const part of ["D:/f/lab/cmlabtest0001", "D:/f/lab/shared", "읽기와 작업 폴더로 복사만", "commit / push", "outputs", "report.md", "받은 파일", "50MB", "실험 내용"]) assert.ok(text.includes(part), part);
  assert.ok(text.includes(job().planMarkdown));
});

test("사후 검사: 다른 앱 폴더 파일을 실험 폴더로 복사는 통과", { skip: !gitOk }, (t) => {
  const root = factory(t);
  const { dir } = prepareLab(root, job());
  const repos = discoverRepos(root);
  assert.deepEqual(repos.map((r) => path.basename(r)).sort(), ["app-a", "app-b"]);
  const before = snapshotRepos(repos);
  fs.copyFileSync(path.join(root, "app-a", "main.txt"), path.join(dir, "copied-main.txt")); // 읽기 + 실험 폴더로 복사
  const cmp = compareSnapshots(before, snapshotRepos(repos));
  assert.equal(cmp.ok, true);
  assert.deepEqual(cmp.changes, []);
  assert.equal(cmp.repos, 2);
});

test("사후 검사: 앱 폴더에 파일을 쓰면(새 파일·수정·삭제) 어느 저장소·파일인지 잡는다", { skip: !gitOk }, (t) => {
  const root = factory(t);
  prepareLab(root, job());
  const repos = discoverRepos(root);
  const before = snapshotRepos(repos);
  fs.writeFileSync(path.join(root, "app-a", "new-file.txt"), "x"); // 새 파일
  fs.appendFileSync(path.join(root, "app-b", "main.txt"), "changed\n"); // 추적 중인 파일 수정
  const cmp = compareSnapshots(before, snapshotRepos(repos));
  assert.equal(cmp.ok, false);
  const byRepo = Object.fromEntries(cmp.changes.map((c) => [c.repo, c.files]));
  assert.deepEqual(byRepo["app-a"], ["new-file.txt"]);
  assert.deepEqual(byRepo["app-b"], ["main.txt"]);
  // 삭제도 잡는다
  const before2 = snapshotRepos(repos);
  fs.rmSync(path.join(root, "app-b", "notes.txt"));
  const cmp2 = compareSnapshots(before2, snapshotRepos(repos));
  assert.deepEqual(cmp2.changes.map((c) => [c.repo, c.files]), [["app-b", ["notes.txt"]]]);
});

test("사후 검사: 이미 바뀌어 있던 파일을 더 고쳐도 잡는다(상태 줄이 같아도 크기·시각이 달라짐)", { skip: !gitOk }, (t) => {
  const root = factory(t);
  fs.appendFileSync(path.join(root, "app-a", "main.txt"), "dirty before\n"); // 실험 전부터 바뀐 상태
  const repos = discoverRepos(root);
  const before = snapshotRepos(repos);
  assert.equal(compareSnapshots(before, snapshotRepos(repos)).ok, true); // 아무것도 안 하면 통과
  fs.appendFileSync(path.join(root, "app-a", "main.txt"), "dirty more\n");
  const cmp = compareSnapshots(before, snapshotRepos(repos));
  assert.equal(cmp.ok, false);
  assert.deepEqual(cmp.changes[0].files, ["main.txt"]);
});

test("사후 검사: 실험 동안 다른 앱 일감이 만진 저장소는 비교에서 빼고 이유를 적는다", { skip: !gitOk }, (t) => {
  const root = factory(t);
  const repos = discoverRepos(root);
  const before = snapshotRepos(repos);
  const guard = createLabGuard();
  const startedAt = Date.now() - 1000;
  guard.touch(path.join(root, "app-a")); // 앱 일감이 시작·끝남
  fs.writeFileSync(path.join(root, "app-a", "by-app-job.txt"), "x");
  const cmp = compareSnapshots(before, snapshotRepos(repos), { isBusy: (d) => guard.isBusy(d, startedAt, []) });
  assert.equal(cmp.ok, true);
  assert.equal(cmp.repos, 1); // app-b 만 비교
  assert.ok(cmp.notes.some((n) => n.startsWith("app-a:")));
  // 지금 돌고 있는 일감의 폴더도 뺀다. 실험 시작 전에 끝난 일감은 빼지 않는다
  assert.equal(guard.isBusy(path.join(root, "app-b"), startedAt, [path.join(root, "app-b")]), true);
  assert.equal(guard.isBusy(path.join(root, "app-b"), Date.now() + 5000, []), false);
});

test("결과 고르기: outputs 의 이미지·mp4·report.md, 지시문이 지정한 파일만(링크·폴더 밖 제외)", (t) => {
  const root = factory(t);
  const { dir, outputs } = prepareLab(root, job());
  const w = (rel, size = 4) => {
    const full = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.alloc(size, 1));
  };
  w("outputs/a.png"); w("outputs/sub/b.webp"); w("outputs/c.gif"); w("outputs/d.mp4"); w("outputs/ignore.txt"); w("outputs/ignore.exe"); w("report.md"); w("work/planned.png"); w("work/unplanned.png");
  const plan = "결과는 work/planned.png 에 저장하고 `../escape.png` 와 C:/abs.png 는 무시.";
  assert.deepEqual(pathsFromPlan(plan), ["work/planned.png"]);
  const names = listLabOutputs(dir, plan).map((f) => f.name);
  assert.deepEqual(names, ["outputs/a.png", "outputs/c.gif", "outputs/d.mp4", "outputs/sub/b.webp", "report.md", "work/planned.png"]);
  // 폴더 밖을 가리키는 링크는 올리지 않는다(만들 수 없는 환경이면 건너뜀)
  const outside = path.join(root, "app-a", "main.txt");
  try {
    fs.symlinkSync(outside, path.join(outputs, "link.png"));
    assert.ok(!listLabOutputs(dir, plan).some((f) => f.name === "outputs/link.png"));
  } catch (e) {
    if (e.code !== "EPERM" && e.code !== "EACCES") throw e;
  }
});

test("용량 상한: 파일 50MB·실험 200MB·40개 넘으면 올리지 않고 목록에 이유를 남긴다", () => {
  const f = (name, size) => ({ name, full: name, size, mtimeMs: 0 });
  const MB = 1024 * 1024;
  const r1 = pickUploads([f("outputs/big.mp4", LAB_FILE_MAX + 1), f("outputs/ok.png", 5 * MB), f("outputs/empty.png", 0), f("report.md", 100)]);
  assert.deepEqual(r1.pick.map((x) => x.name), ["report.md", "outputs/ok.png"]); // report.md 먼저
  assert.deepEqual(r1.skipped.map((x) => [x.name, x.reason]), [["outputs/big.mp4", "파일 50MB 초과"]]);
  // 일감 200MB: 50MB 파일 4개는 되고 5번째부터 건너뜀
  const many = Array.from({ length: 6 }, (_, i) => f(`outputs/v${i}.mp4`, 49 * MB));
  const r2 = pickUploads(many);
  assert.equal(r2.pick.length, 4);
  assert.equal(r2.skipped.length, 2);
  assert.ok(r2.skipped.every((s) => s.reason.includes("200MB")));
  assert.ok(r2.bytes <= LAB_JOB_MAX);
  // 개수 40
  const lots = Array.from({ length: LAB_FILE_COUNT_MAX + 3 }, (_, i) => f(`outputs/i${i}.png`, 10));
  const r3 = pickUploads(lots);
  assert.equal(r3.pick.length, LAB_FILE_COUNT_MAX);
  assert.equal(r3.skipped.length, 3);
  // 이름 규칙 위반(공백 제어문자·상위 경로)은 건너뜀
  assert.equal(pickUploads([f("outputs/../x.png", 5)]).skipped.length, 1);
});

test("올리기: 8MB 조각으로 순서대로 보내고, 실패한 파일은 목록에 남기고 나머지는 계속한다", async (t) => {
  const root = factory(t);
  const { dir, outputs } = prepareLab(root, job());
  const big = Buffer.alloc(LAB_CHUNK * 2 + 10, 7); // 조각 3개
  fs.writeFileSync(path.join(outputs, "clip.mp4"), big);
  fs.writeFileSync(path.join(outputs, "bad.png"), Buffer.alloc(8, 1));
  fs.writeFileSync(path.join(outputs, "good.png"), Buffer.alloc(8, 2));
  fs.writeFileSync(path.join(dir, "report.md"), "# 보고\n");
  const sent = [];
  const logs = [];
  const put = async ({ name, idx, count, size, bytes }) => {
    if (name === "outputs/bad.png") return { status: 400, data: { message: "싫어요" } };
    sent.push({ name, idx, count, size, len: bytes.length });
    return { status: 200, data: { ok: true } };
  };
  const r = await uploadLabOutputs({ labDir: dir, plan: "", put, log: (l, m) => logs.push([l, m]) });
  assert.deepEqual(r.uploaded.map((u) => u.name), ["report.md", "outputs/clip.mp4", "outputs/good.png"]);
  assert.deepEqual(sent.filter((s) => s.name === "outputs/clip.mp4").map((s) => [s.idx, s.count, s.len]), [[0, 3, LAB_CHUNK], [1, 3, LAB_CHUNK], [2, 3, 10]]);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].name, "outputs/bad.png");
  assert.match(r.skipped[0].reason, /400/);
  assert.equal(r.bytes, big.length + 8 + Buffer.byteLength("# 보고\n"));
  assert.ok(logs.some(([l]) => l === "warn"));
});

test("올리기: 서버가 409(실행 중 아님)를 주면 멈추고 남은 파일은 목록에 남긴다", async (t) => {
  const root = factory(t);
  const { dir, outputs } = prepareLab(root, job());
  fs.writeFileSync(path.join(outputs, "a.png"), Buffer.alloc(8, 1));
  fs.writeFileSync(path.join(outputs, "b.png"), Buffer.alloc(8, 2));
  let calls = 0;
  const r = await uploadLabOutputs({ labDir: dir, plan: "", put: async () => { calls++; return { status: 409, data: {} }; } });
  assert.equal(r.stopped, true);
  assert.equal(calls, 1);
  assert.equal(r.uploaded.length, 0);
  assert.equal(r.skipped.length, 2);
});

test("폴더 지우기: 해당 lab/<id> 만 지우고 shared·다른 폴더·잘못된 id 는 거절", (t) => {
  const root = factory(t);
  const a = prepareLab(root, job());
  const b = prepareLab(root, job({ id: "cmlabtest0002" }));
  fs.writeFileSync(path.join(a.shared, "model.bin"), "x");
  fs.writeFileSync(path.join(a.dir, "outputs", "r.png"), "x");
  assert.equal(deleteLabFolder(root, "cmlabtest0001"), "deleted");
  assert.ok(!fs.existsSync(a.dir));
  assert.ok(fs.existsSync(b.dir), "다른 실험은 그대로");
  assert.ok(fs.existsSync(path.join(a.shared, "model.bin")), "shared 는 그대로");
  assert.equal(deleteLabFolder(root, "cmlabtest0001"), "missing");
  for (const bad of ["shared", "..", "../app-a", "app-a/x", ""]) assert.throws(() => deleteLabFolder(root, bad));
  assert.ok(fs.existsSync(path.join(root, "app-a", "main.txt")));
});
