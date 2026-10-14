// 실험(lab) 일감 서버 쪽 시험: lib/factory/lab.ts(파일 받기·상한·서명 주소·결과 정리) + jobs.ts(보고 파싱·폴더 지우기 동작) + 연결 지점 확인.
// 가짜 DB(메모리)만 쓴다. 실행: npm run test:lab
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

// ── 가짜 DB ──
function fakePrisma() {
  const db = { jobs: new Map(), files: new Map(), chunks: new Map() };
  let seq = 0;
  const prisma = {
    factoryJob: {
      findUnique: async ({ where }) => db.jobs.get(where.id) ?? null,
      update: async ({ where, data }) => { const j = db.jobs.get(where.id); Object.assign(j, data); return j; },
      count: async ({ where }) => [...db.jobs.values()].filter((j) => j.id === where.id && (!where.kind || j.kind === where.kind)).length,
    },
    factoryLabFile: {
      findMany: async ({ where }) => [...db.files.values()].filter((f) => f.jobId === where.jobId && (!where.NOT || f.name !== where.NOT.name) && (where.complete === undefined || f.complete === where.complete)),
      deleteMany: async ({ where }) => { for (const [id, f] of db.files) if (f.jobId === where.jobId && f.name === where.name) { db.files.delete(id); for (const k of [...db.chunks.keys()]) if (k.startsWith(`${id}:`)) db.chunks.delete(k); } },
      create: async ({ data }) => { const f = { id: `f${++seq}`, received: 0, complete: false, ...data }; db.files.set(f.id, f); return f; },
      findUnique: async ({ where }) => (where.jobId_name ? [...db.files.values()].find((f) => f.jobId === where.jobId_name.jobId && f.name === where.jobId_name.name) : db.files.get(where.id)) ?? null,
      update: async ({ where, data }) => Object.assign(db.files.get(where.id), data),
    },
    factoryLabFileChunk: {
      upsert: async ({ where, create }) => { db.chunks.set(`${where.fileId_idx.fileId}:${where.fileId_idx.idx}`, create.data); },
      count: async ({ where }) => [...db.chunks.keys()].filter((k) => k.startsWith(`${where.fileId}:`)).length,
      findMany: async ({ where }) => [...db.chunks.entries()].filter(([k]) => k.startsWith(`${where.fileId}:`)).map(([k, data]) => ({ idx: Number(k.split(":")[1]), data })).filter((c) => (where.idx?.gte === undefined || c.idx >= where.idx.gte) && (where.idx?.lte === undefined || c.idx <= where.idx.lte)).sort((a, b) => a.idx - b.idx),
    },
  };
  return { db, prisma };
}

const mask = loadTs("lib/factory/mask.ts");
function load() {
  const { db, prisma } = fakePrisma();
  const lab = loadTs("lib/factory/lab.ts", { "@/lib/prisma": { __esModule: true, default: prisma }, "@/lib/factory/mask": mask });
  return { db, prisma, lab };
}
const addJob = (db, extra = {}) => db.jobs.set("job1", { id: "job1", kind: "lab", status: "running", labResult: null, ...extra }) && db.jobs.get("job1");
const bytes = (n, v = 1) => new Uint8Array(n).fill(v);

test("파일 이름·종류: png·webp·gif·mp4 와 report.md 만, 이상한 경로는 거절", () => {
  const { lab } = load();
  for (const ok of ["a.png", "outputs/a.webp", "outputs/sub/clip.mp4", "report.md", "outputs/report.md", "결과 1.gif"]) assert.equal(lab.isLabName(ok), true, ok);
  for (const bad of ["a.exe", "notes.md", "../a.png", "outputs/../a.png", "/abs/a.png", "C:/a.png", "a\\b.png", "a/b/c/d/e/f/g.png", "", ".png/x", "a.PNG.sh", 5, null]) assert.equal(lab.isLabName(bad), false, String(bad));
  assert.deepEqual(lab.labFileType("A.MP4"), { mime: "video/mp4", kind: "video" });
  assert.equal(lab.labFileType("other.md"), null);
});

test("파일 받기: 512KB 조각으로 받아 다 모이면 complete, 실험·실행 중인 일감만", async () => {
  const { db, lab } = load();
  addJob(db);
  const size = lab.LAB_CHUNK + 5;
  let r = await lab.receiveLabChunk("job1", "outputs/clip.mp4", 0, 2, size, bytes(lab.LAB_CHUNK));
  assert.equal(r.ok, true);
  assert.equal([...db.files.values()][0].complete, false);
  r = await lab.receiveLabChunk("job1", "outputs/clip.mp4", 1, 2, size, bytes(5, 9));
  assert.equal(r.ok, true);
  const f = [...db.files.values()][0];
  assert.equal(f.complete, true);
  assert.equal(f.kind, "video");
  assert.equal(f.mime, "video/mp4");
  // 범위 읽기(Range): 조각 경계를 넘는 구간
  const part = await lab.readLabRange(f.id, lab.LAB_CHUNK - 2, lab.LAB_CHUNK + 1);
  assert.deepEqual([...part.data], [1, 1, 9, 9]);
  assert.equal(part.size, size);
  // 처음 조각 전에 중간 조각을 보내면 거절
  r = await lab.receiveLabChunk("job1", "outputs/other.png", 1, 2, size, bytes(5));
  assert.equal(r.ok, false);
  // 실험이 아닌 일감·실행 중이 아닌 일감
  db.jobs.set("job2", { id: "job2", kind: "revision", status: "running" });
  assert.equal((await lab.receiveLabChunk("job2", "a.png", 0, 1, 4, bytes(4))).status, 404);
  addJob(db, { status: "done" });
  assert.equal((await lab.receiveLabChunk("job1", "a.png", 0, 1, 4, bytes(4))).status, 409);
});

test("파일 받기 상한: 파일 50MB·일감 200MB·40개·조각 크기 불일치", async () => {
  const { db, lab } = load();
  addJob(db);
  assert.equal((await lab.receiveLabChunk("job1", "a.mp4", 0, 7, lab.LAB_FILE_MAX + 1, bytes(10))).status, 413);
  assert.equal((await lab.receiveLabChunk("job1", "a.png", 0, 1, 10, bytes(9))).status, 400); // 크기 불일치
  assert.equal((await lab.receiveLabChunk("job1", "a.exe", 0, 1, 10, bytes(10))).status, 400);
  // 일감 200MB: 49MB 파일(조각 7개 중 첫 조각만 보내도 '시작' 때 합계를 본다)
  const big = 49 * 1024 * 1024;
  const count = Math.ceil(big / lab.LAB_CHUNK);
  for (let i = 0; i < 4; i++) {
    const r = await lab.receiveLabChunk("job1", `outputs/v${i}.mp4`, 0, count, big, bytes(lab.LAB_CHUNK));
    assert.equal(r.ok, true, `v${i}`);
  }
  assert.equal((await lab.receiveLabChunk("job1", "outputs/v4.mp4", 0, count, big, bytes(lab.LAB_CHUNK))).status, 413);
  // 같은 이름을 다시 올리면 새로 시작(예전 것을 대체)해서 합계에 두 번 세지 않는다
  assert.equal((await lab.receiveLabChunk("job1", "outputs/v0.mp4", 0, count, big, bytes(lab.LAB_CHUNK))).ok, true);
  // 개수 40
  const { db: db2, lab: lab2 } = load();
  addJob(db2);
  for (let i = 0; i < lab2.LAB_FILE_COUNT_MAX; i++) assert.equal((await lab2.receiveLabChunk("job1", `outputs/i${i}.png`, 0, 1, 4, bytes(4))).ok, true);
  assert.equal((await lab2.receiveLabChunk("job1", "outputs/extra.png", 0, 1, 4, bytes(4))).status, 400);
});

test("서명 주소: 맞는 서명만 열리고, 위조·만료·다른 파일은 거절", () => {
  process.env.NEXTAUTH_SECRET = "test-secret-value";
  const { lab } = load();
  const q = new URLSearchParams(lab.labFileQuery("file1", 1_000_000));
  assert.equal(lab.verifyLabLink("file1", q.get("exp"), q.get("sig"), 1_000_000 + 1000), true);
  assert.equal(lab.verifyLabLink("file2", q.get("exp"), q.get("sig"), 1_000_000 + 1000), false); // 다른 파일
  assert.equal(lab.verifyLabLink("file1", q.get("exp"), "0".repeat(32), 1_000_000 + 1000), false); // 위조
  assert.equal(lab.verifyLabLink("file1", String(Number(q.get("exp")) + 100), q.get("sig"), 1_000_000 + 1000), false); // 만료 시각 조작
  assert.equal(lab.verifyLabLink("file1", q.get("exp"), q.get("sig"), 1_000_000 + 7 * 3600 * 1000), false); // 만료
  assert.equal(lab.verifyLabLink("file1", null, null), false);
  delete process.env.NEXTAUTH_SECRET;
  delete process.env.AUTH_SECRET;
  delete process.env.FACTORY_SECRET_KEY;
  assert.equal(lab.labFileQuery("file1"), null, "서명 키가 없으면 주소를 만들지 않는다");
  assert.equal(lab.verifyLabLink("file1", "9999999999", "a".repeat(32)), false);
});

test("결과 보기: 파일 주소(커넥터=서명 전체 주소, 통제실=상대 주소)·report.md 본문·건너뜀·사후 검사", async () => {
  process.env.NEXTAUTH_SECRET = "test-secret-value";
  const { db, lab } = load();
  addJob(db);
  await lab.receiveLabChunk("job1", "outputs/a.png", 0, 1, 4, bytes(4));
  const report = new TextEncoder().encode("# 결과\n되는 걸 확인했어요");
  await lab.receiveLabChunk("job1", "report.md", 0, 1, report.length, report);
  const labResult = { keep: false, skipped: [{ name: "outputs/big.mp4", size: 60e6, reason: "파일 50MB 초과" }], check: { ok: true, at: "t", repos: 2, changes: [], notes: [] } };
  const signed = await lab.labResultView("job1", labResult, { signed: true });
  assert.equal(signed.files.length, 2);
  const png = signed.files.find((f) => f.name === "outputs/a.png");
  assert.match(png.url, /^https:\/\/www\.buyoungsilcoding\.com\/api\/factory\/lab-file\/f\d+\?exp=\d+&sig=[0-9a-f]{32}$/);
  assert.equal(signed.reportText, "# 결과\n되는 걸 확인했어요");
  assert.equal(signed.keep, false);
  assert.equal(signed.skipped[0].reason, "파일 50MB 초과");
  assert.equal(signed.check.ok, true);
  const admin = await lab.labResultView("job1", labResult, { signed: false });
  assert.match(admin.files[0].url, /^\/api\/factory\/lab-file\/f\d+$/);
  delete process.env.NEXTAUTH_SECRET;
});

test("결과 정리: 감독 프로그램이 보낸 lab 값은 모양을 맞추고 비밀값을 가린다", () => {
  const { lab } = load();
  assert.equal(lab.cleanLabResult(null), null);
  assert.equal(lab.cleanLabResult([]), null);
  const c = lab.cleanLabResult({
    skipped: [{ name: "a.mp4", size: 5, reason: "x" }, { name: "", size: 1, reason: "빈 이름" }, "이상한 것"],
    uploadedBytes: 12.9,
    check: { ok: false, at: "2026-10-14T00:00:00Z", repos: 3, notes: ["메모"], changes: [{ repo: "app-a", files: ["x.txt", 5], more: 2 }, { repo: "" }] },
    folderDeleted: "조작해도 무시",
    keep: false,
  });
  assert.deepEqual(c.skipped, [{ name: "a.mp4", size: 5, reason: "x" }]);
  assert.equal(c.uploadedBytes, 12);
  assert.equal(c.check.ok, false);
  assert.deepEqual(c.check.changes, [{ repo: "app-a", files: ["x.txt"], more: 2 }]);
  assert.equal(c.folderDeleted, undefined, "폴더 지움 표시는 감독 프로그램 보고로 바꿀 수 없다");
  assert.equal(c.keep, undefined);
});

// ── jobs.ts: 보고 파싱, 폴더 지우기 동작 ──
function loadJobs() {
  const { db, prisma, lab } = load();
  const stubs = {
    "@prisma/client": { Prisma: { sql: () => ({}), join: () => ({}) } },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/reviewVideo": { deleteReviewVideo: async () => {} },
    "@/lib/factory/settings": { getDefaultClaudeModel: async () => null },
    "@/lib/factory/toolBroker": { cleanToolRequests: () => null },
    "@/lib/factory/handoff": { cleanHandoff: () => null },
    "@/lib/factory/mask": mask,
    "@/lib/factory/lab": lab,
    "@/lib/factory/parallel": loadTs("lib/factory/parallel.ts", { "@/lib/prisma": { __esModule: true, default: prisma } }),
  };
  stubs["@/lib/factory/ai"] = loadTs("lib/factory/ai.ts");
  return { db, prisma, jobs: loadTs("lib/factory/jobs.ts", stubs) };
}

test("일감 종류: lab 은 '실험', 기존 종류 이름은 그대로", () => {
  const { jobs } = loadJobs();
  assert.deepEqual(jobs.JOB_KINDS, ["new", "revision", "release", "lab", "tool"]);
  assert.deepEqual(jobs.KIND_LABELS, { new: "새 앱", revision: "수정", release: "출시 준비", lab: "실험", tool: "도구" });
});

test("보고: lab 필드를 읽고 정리한다(없으면 null)", () => {
  const { jobs } = loadJobs();
  const base = { jobId: "job1", logs: [] };
  const a = jobs.parseReport({ ...base });
  assert.equal(a.ok, true);
  assert.equal(a.value.lab, null);
  const b = jobs.parseReport({ ...base, status: "failed", lab: { check: { ok: false, repos: 1, changes: [{ repo: "app-a", files: ["f.txt"], more: 0 }] } } });
  assert.equal(b.value.lab.check.ok, false); // 저장할 때 cleanLabResult 가 정리한다(아래 시험)
  assert.equal(jobs.parseReport({ ...base, lab: "문자열" }).value.lab, null);
  assert.equal(jobs.parseReport({ ...base, lab: [1] }).value.lab, null);
});

test("[폴더 지우기]: 끝난 실험만 요청 가능, 진행 중·앱 일감은 거절", async () => {
  const { db, jobs } = loadJobs();
  db.jobs.set("lab-done", { id: "lab-done", kind: "lab", status: "done" });
  db.jobs.set("lab-run", { id: "lab-run", kind: "lab", status: "running" });
  db.jobs.set("lab-pend", { id: "lab-pend", kind: "lab", status: "pending" });
  db.jobs.set("app-done", { id: "app-done", kind: "revision", status: "done" });
  const ok = await jobs.adminAction("lab-done", { action: "lab-delete-folder" });
  assert.equal(ok.ok, true);
  assert.ok(db.jobs.get("lab-done").labCleanupAt instanceof Date);
  for (const id of ["lab-run", "lab-pend"]) assert.equal((await jobs.adminAction(id, { action: "lab-delete-folder" })).status, 409, id);
  assert.equal((await jobs.adminAction("app-done", { action: "lab-delete-folder" })).status, 409);
  assert.equal(db.jobs.get("app-done").labCleanupAt, undefined, "앱 일감에는 아무 표시도 남기지 않는다");
  assert.equal((await jobs.adminAction("nope", { action: "lab-delete-folder" })).status, 404);
});

// ── 연결 지점(소스 확인): 앱 일감에 실험이 새지 않고, 실험은 앱 목록·앱 이름에 섞이지 않는다 ──
test("연결 지점: 커넥터 도구·앱 이름 보호·앱 목록 제외·감독 프로그램 분기", () => {
  const mcp = read("lib/factory/mcp.ts");
  assert.match(mcp, /name: "enqueue_lab_job"/);
  assert.match(mcp, /case "enqueue_lab_job":\s*return enqueueLabJob\(args\)/);
  assert.match(mcp, /if \(appSlug === LAB_SLUG\) return text/, "앱 이름 lab 은 앱 등록에서 막는다");
  assert.match(mcp, /kind !== "new" && kind !== "revision" && kind !== "release"/, "enqueue_app_job 은 lab 종류를 받지 않는다");
  assert.match(mcp, /실험_결과: await labResultView\(job\.id, job\.labResult, \{ signed: true \}\)/);
  assert.match(mcp, /kind: \{ not: LAB_KIND \}/, "수정할 앱 안내 목록에서 실험 제외");
  assert.match(read("lib/factory/project.ts"), /kind: \{ not: "lab" \}/);
  assert.match(read("lib/factory/release.ts"), /kind: \{ not: "lab" \}/);
  assert.match(read("components/admin/factory/StudioPanel.tsx"), /kind: \{ not: "lab" \}/);
  const next = read("app/api/factory/next/route.ts");
  assert.match(next, /if \(j\.kind === LAB_KIND\) return \{ \.\.\.j, \.\.\.card, \.\.\.\(cardRun \? \{ projectToolSettings \} : \{\}\) \};/); // 실험은 앱 규칙을 붙이지 않고, 카드를 불렀을 때만 카드 정보와 설정
  assert.match(next, /labCleanup/);
  const sup = read("tools/factory-supervisor/supervisor.mjs");
  assert.match(sup, /job\.kind === "lab" \? runLabJob\(job\) : runJob\(job\)/);
  // 앱 일감 실행 경로(runJobUnlocked)에는 실험 권한 코드가 없다
  const appPath = sup.slice(sup.indexOf("async function runJobUnlocked"), sup.indexOf("const MARK = "));
  assert.doesNotMatch(appPath, /writeLabClaudeSettings|labCodexOptions|labPrompt/);
  assert.match(appPath, /appPermissionSettings\(\)/);
  // 실험 실행 경로
  const labPath = sup.slice(sup.indexOf("async function runLabUnlocked"), sup.indexOf("async function runLabCleanups"));
  assert.match(labPath, /writeLabClaudeSettings/);
  assert.match(labPath, /labCodexOptions\(shared\)/);
  assert.match(labPath, /allowedTools: "Bash,Read,Glob,Grep,WebFetch,WebSearch"/, "아무 곳이나 쓰는 Edit·Write 허용을 뺀다");
  assert.match(labPath, /compareSnapshots/);
  assert.match(labPath, /failStage: "lab-check"/);
});
