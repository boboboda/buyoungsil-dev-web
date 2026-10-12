// 홈페이지 프로젝트 연결 시험: 새 앱 승인 때 자동 생성 안 함, 출시 패키지에 추가할 때 프로젝트 고르기/새로 만들기/건너뛰기,
// 출시 카드 연결 상태(release overview·get_release_status), [홈페이지만 반영](미리보기·덮어쓰기·건너뜀, 방침·상태 그대로),
// 기존 출시 일감의 빈 칸 채우기. DB 는 메모리 가짜. 실제 DB·서버는 쓰지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.startsWith("@/")) throw new Error(`시험에 없는 모듈: ${name}`);
    return require(name);
  }, module, module.exports);
  return module.exports;
}

const storeAssets = { readStoreAssets: (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null), savePromoVideoUrl: async () => ({ ok: true }) };
const storeTarget = loadTs("lib/factory/storeTarget.ts");
// 시험용 APK: 준비 조건은 실제 함수, 목록은 비움(이 시험은 APK 를 보지 않는다)
const testApk = { ...loadTs("lib/factory/testApk.ts", { "@/lib/prisma": {} }), listTestApks: async () => new Map() };

// ───── 가짜 DB ─────
const d = (s) => new Date(s);
function fakeDb({ apps = [], jobs = [], projects = [] } = {}) {
  const state = {
    apps: apps.map((a) => ({ ...a })),
    jobs: jobs.map((j, i) => ({ id: `job${i}`, title: j.appSlug, planMarkdown: "기획서 첫 문단입니다. 이 앱은 무엇을 합니다.", ...j })),
    projects: projects.map((p) => ({ description: "", coverImage: null, appLink: null, techStack: [], privacyPolicy: null, status: "in-progress", platform: "mobile", updatedAt: d("2026-01-01"), ...p })),
    created: [],
  };
  const appRow = (a) => ({
    appSlug: a.appSlug,
    projectId: null,
    releaseAccountId: null,
    releaseStatus: "preparing",
    packageName: null,
    firstUploadDone: false,
    releaseRemovedAt: null,
    storeTarget: false,
    appName: null,
    key: null,
    keyId: null,
    storeAssets: null,
    releasePackage: null,
    ...a,
  });
  const jobRow = (j) => ({ kind: "new", stack: "flutter", status: "done", createdAt: d("2026-01-01"), reviewRequired: false, reviewApprovedAt: null, ...j });
  const whereOk = (row, where = {}) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "in" in v ? v.in.includes(row[k]) : row[k] === v));
  const sortJobs = (rows, orderBy) => (orderBy?.createdAt === "desc" || !orderBy ? rows.sort((a, b) => b.createdAt - a.createdAt) : rows);
  const prisma = {
    state,
    factoryReleaseAccount: { findMany: async () => [], findUnique: async () => null },
    factoryApp: {
      findMany: async () => state.apps.map(appRow),
      findUnique: async ({ where }) => {
        const a = state.apps.find((x) => (where.appSlug ? x.appSlug === where.appSlug : x.projectId === where.projectId));
        return a ? appRow(a) : null;
      },
      upsert: async ({ where, create, update }) => {
        const a = state.apps.find((x) => x.appSlug === where.appSlug);
        if (a) Object.assign(a, update);
        else state.apps.push({ ...create });
        return {};
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const a of state.apps) if (whereOk(a, where)) (Object.assign(a, data), count++);
        return { count };
      },
    },
    factoryJob: {
      findMany: async ({ where, orderBy } = {}) => sortJobs(state.jobs.map(jobRow).filter((j) => whereOk(j, where)), orderBy),
      findFirst: async ({ where, orderBy } = {}) => sortJobs(state.jobs.map(jobRow).filter((j) => whereOk(j, where)), orderBy)[0] ?? null,
    },
    factoryJobLog: { findMany: async () => [] },
    factorySecretName: { findMany: async () => [] },
    factorySetting: { findUnique: async () => null },
    project: {
      findMany: async ({ where } = {}) => state.projects.filter((p) => !where?.id || where.id.in.includes(p.id)),
      findUnique: async ({ where }) => state.projects.find((p) => p.id === where.id) ?? null,
      update: async ({ where, data }) => {
        const p = state.projects.find((x) => x.id === where.id);
        Object.assign(p, data);
        return p;
      },
    },
    $transaction: async (ops) => Promise.all(ops),
  };
  return prisma;
}

function loadProject(prisma) {
  const appName = loadTs("lib/factory/appName.ts", { "@/lib/prisma": prisma, "@/lib/factory/storeAssets": storeAssets });
  return loadTs("lib/factory/project.ts", {
    "@/lib/prisma": prisma,
    "@/serverActions/projects": {
      createProject: async (data) => {
        const id = `p-new-${prisma.state.created.length + 1}`;
        prisma.state.created.push(data);
        prisma.state.projects.push({ id, name: id, coverImage: null, appLink: null, privacyPolicy: null, ...data });
        return { success: true, data: { id } };
      },
    },
    "@/lib/privacy/template": { hasUnfilledPlaceholder: (s) => /\[\[.*?\]\]/.test(s) },
    "@/lib/factory/storeAssets": storeAssets,
    "@/lib/factory/appName": appName,
  });
}

function loadRelease(prisma) {
  const appName = loadTs("lib/factory/appName.ts", { "@/lib/prisma": prisma, "@/lib/factory/storeAssets": storeAssets });
  return loadTs("lib/factory/release.ts", {
    "@prisma/client": { Prisma: { DbNull: null } },
    "@/lib/prisma": prisma,
    "@/lib/factory/telegram": { notifyText: async () => {} },
    "@/lib/factory/jobs": { ACTIVE_STATUSES: ["pending", "approved", "running"] },
    "@/lib/factory/keyPasswords": { DEFAULT_KEY_ALIAS: "upload", keyPasswordStatuses: async () => [], keyRefOf: () => "", keySecretNames: () => ({}) },
    "@/lib/factory/mask": { maskSecrets: (s) => s },
    "@/lib/factory/keyVault": { KEY_KINDS: {}, listVault: async () => [] },
    "@/lib/factory/reviewVideo": { deleteReviewVideo: async () => {}, reviewVideoInfo: async () => new Map() },
    "@/lib/factory/storeAssets": storeAssets,
    "@/lib/factory/uploadTest": { uploadTestState: async () => null },
    "@/lib/factory/appName": appName,
    "@/lib/factory/storeTarget": storeTarget,
    "@/lib/factory/testApk": testApk,
  });
}

function loadMcp(prisma, release) {
  return loadTs("lib/factory/mcp.ts", {
    "@/lib/prisma": prisma,
    "@/lib/factory/ai": { isAiEngine: (v) => v === "claude" || v === "codex" },
    "@/lib/factory/settings": { getDefaultAiEngine: async () => "claude" },
    "@/lib/factory/secretEntries": { knownSecretNames: async () => [] },
    "@/lib/factory/telegram": { notifyJobEvent: async () => {} },
    "@/lib/factory/supervisor": { runSupervisorAction: async () => ({}), SUPERVISOR_ACTIONS: ["status"] },
    "@/lib/factory/release": release,
    "@/lib/factory/storeAssets": storeAssets,
    "@/lib/factory/storeTarget": storeTarget,
    "@/lib/factory/testApk": testApk,
    "@/lib/factory/jobs": {
      ACTIVE_STATUSES: ["pending", "approved", "running"],
      APP_SLUG_RE: /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/,
      ID_RE: /^[A-Za-z0-9_-]{1,40}$/,
      JOB_STATUSES: ["pending", "approved", "running", "done", "failed", "cancelled"],
      MAX_PENDING_JOBS: 20,
      MAX_PLAN: 60000,
      MIN_PLAN: 20,
      STACK_LABELS: { flutter: "Flutter", nextjs: "Next.js", nestjs: "NestJS" },
      STACKS: ["flutter", "nextjs", "nestjs"],
    },
  });
}

test("새 앱 일감 승인은 홈페이지 프로젝트를 만들지 않는다(jobs.ts 가 ensureProjectForJob 을 부르지 않음)", () => {
  const src = fs.readFileSync(path.join(repo, "lib/factory/jobs.ts"), "utf8").replace(/\/\/.*$/gm, "");

  assert.doesNotMatch(src, /ensureProjectForJob/);
  assert.doesNotMatch(src, /@\/lib\/factory\/project/);
  // 함수 자체는 남아 있다(출시 패키지에 추가할 때 '새 프로젝트 만들기'로 쓴다)
  assert.equal(typeof loadProject(fakeDb()).ensureProjectForJob, "function");
});

test("출시 패키지에 추가할 때: 새 프로젝트 만들기 / 기존 프로젝트 / 건너뛰기 / 이미 연결된 앱", async () => {
  const db = fakeDb({
    apps: [{ appSlug: "linked-app", projectId: "p-old" }, { appSlug: "taken-app", projectId: "p-taken" }],
    jobs: [
      { appSlug: "new-app", kind: "new", title: "새 앱", stack: "flutter", createdAt: d("2026-01-01") },
      { appSlug: "new-app", kind: "revision", title: "새 앱 (버튼 고침)", stack: "flutter", createdAt: d("2026-02-01") },
      { appSlug: "pick-app", kind: "new" },
      { appSlug: "skip-app", kind: "new" },
      { appSlug: "linked-app", kind: "new" },
      { appSlug: "steal-app", kind: "new" },
      { appSlug: "taken-app", kind: "new" },
    ],
    projects: [
      { id: "p-free", title: "빈 프로젝트" },
      { id: "p-old", title: "예전 연결" },
      { id: "p-taken", title: "남의 프로젝트" },
    ],
  });
  const project = loadProject(db);
  const app = (slug) => db.state.apps.find((a) => a.appSlug === slug);

  // 새로 만들기: 새 앱 일감의 제목·기획서로, 개발 중 상태
  let r = await project.linkProjectOnAdd("new-app", { newProject: true });
  assert.equal(r.ok, true);
  assert.equal(db.state.created.length, 1);
  assert.equal(db.state.created[0].title, "새 앱");
  assert.equal(db.state.created[0].status, "in-progress");
  assert.deepEqual(db.state.created[0].techStack, ["flutter"]);
  assert.equal(app("new-app").projectId, "p-new-1");

  // 기존 프로젝트 고르기
  r = await project.linkProjectOnAdd("pick-app", { projectId: "p-free" });
  assert.equal(r.ok, true);
  assert.equal(app("pick-app").projectId, "p-free");

  // 건너뛰기: 연결 없이 끝(추가는 호출 쪽에서 이미 됨)
  r = await project.linkProjectOnAdd("skip-app", {});
  assert.equal(r.ok, true);
  assert.match(r.message, /나중에/);
  assert.equal(app("skip-app"), undefined);

  // 이미 연결된 앱: 기존 연결을 그대로(새로 만들기를 골라도)
  r = await project.linkProjectOnAdd("linked-app", { newProject: true });
  assert.equal(app("linked-app").projectId, "p-old");
  assert.equal(db.state.created.length, 1);

  // 다른 앱에 연결된 프로젝트는 거부(기존 연결 그대로)
  r = await project.linkProjectOnAdd("steal-app", { projectId: "p-taken" });
  assert.equal(r.ok, false);
  assert.match(r.message, /taken-app/);
  assert.equal(app("taken-app").projectId, "p-taken");
  assert.equal(app("steal-app")?.projectId ?? null, null);

  // 프로젝트는 하나도 지우지 않았다
  assert.deepEqual(db.state.projects.map((p) => p.id).sort(), ["p-free", "p-new-1", "p-old", "p-taken"]);
});

test("출시 카드 연결 상태: release overview 와 get_release_status 에 홈페이지 프로젝트", async () => {
  const db = fakeDb({
    apps: [
      { appSlug: "store-app", storeTarget: true, projectId: "p1" },
      { appSlug: "bare-app", storeTarget: true },
      { appSlug: "gone-app", storeTarget: true, projectId: "p-deleted" },
      { appSlug: "plain-app", projectId: "p2" },
    ],
    jobs: ["store-app", "bare-app", "gone-app", "plain-app"].map((appSlug) => ({ appSlug, kind: "new" })),
    projects: [
      { id: "p1", title: "스토어 앱 프로젝트" },
      { id: "p2", title: "출시 안 할 앱 프로젝트" },
      { id: "p3", title: "빈 프로젝트" },
    ],
  });
  const release = loadRelease(db);
  const o = await release.releaseOverview();
  const row = Object.fromEntries(o.apps.map((a) => [a.appSlug, a]));

  assert.equal(row["store-app"].projectId, "p1");
  assert.equal(row["store-app"].projectTitle, "스토어 앱 프로젝트");
  assert.equal(row["bare-app"].projectId, null);
  assert.equal(row["bare-app"].projectTitle, null);
  assert.equal(row["gone-app"].projectTitle, "(삭제된 프로젝트)");
  // 출시 대상이 아닌 앱도 연결 상태를 싣는다(추가할 때 이미 연결됐는지 보여 줌)
  assert.equal(o.otherApps.find((a) => a.appSlug === "plain-app").projectTitle, "출시 안 할 앱 프로젝트");
  // 고를 수 있는 목록: 다른 앱에 연결된 건 linkedApp 으로 표시
  const linked = Object.fromEntries(o.projects.map((p) => [p.id, p.linkedApp]));
  assert.deepEqual(linked, { p1: "store-app", p2: "plain-app", p3: null });

  const mcp = loadMcp(db, release);
  const body = JSON.parse((await mcp.callFactoryTool("get_release_status", {})).content[0].text);
  const st = Object.fromEntries(body.앱.map((a) => [a.appSlug, a.홈페이지프로젝트]));
  assert.deepEqual(st["store-app"], { 연결: true, 제목: "스토어 앱 프로젝트" });
  assert.deepEqual(st["bare-app"], { 연결: false, 제목: null });
});

test("통제실 연결 카드 목록에 출시 대상 표시가 실린다", async () => {
  const db = fakeDb({
    apps: [{ appSlug: "store-app", storeTarget: true, projectId: "p1" }, { appSlug: "plain-app", projectId: "p2" }],
    jobs: [{ appSlug: "store-app" }, { appSlug: "plain-app" }, { appSlug: "no-row-app" }],
    projects: [{ id: "p1", title: "A" }, { id: "p2", title: "B" }],
  });
  const { apps } = await loadProject(db).listAppProjectLinks();
  const bySlug = Object.fromEntries(apps.map((a) => [a.appSlug, a]));

  assert.equal(bySlug["store-app"].storeTarget, true);
  assert.equal(bySlug["plain-app"].storeTarget, false);
  assert.equal(bySlug["plain-app"].projectTitle, "B");
  assert.equal(bySlug["no-row-app"].storeTarget, false);
});

const FULL_APP = {
  appSlug: "invest-app",
  storeTarget: true,
  projectId: "p1",
  appName: "환테크 기록",
  packageName: "com.factory.invest",
  releaseStatus: "released",
  storeAssets: {
    images: { feature: { url: "https://img.example/feature.png" } },
    listing: { "en-US": { title: "FX", shortDescription: "English short", fullDescription: "" }, "ko-KR": { title: "환테크", shortDescription: "환율 기록 앱이에요.", fullDescription: "길게" } },
  },
};

test("[홈페이지만 반영] 미리보기는 저장하지 않고, 반영은 덮어쓰되 방침·상태는 그대로", async () => {
  const db = fakeDb({
    apps: [FULL_APP],
    jobs: [{ appSlug: "invest-app", kind: "new", stack: "flutter" }],
    projects: [
      {
        id: "p1",
        title: "investcalculator",
        description: "개발 중인 앱입니다.",
        coverImage: "https://img.example/old.png",
        appLink: null,
        techStack: ["flutter"],
        privacyPolicy: "기존 방침",
        status: "in-progress",
      },
    ],
  });
  const project = loadProject(db);
  const before = JSON.stringify(db.state.projects[0]);

  const preview = await project.syncProjectFromPackage("invest-app", { dryRun: true });
  assert.equal(preview.ok, true);
  assert.equal(JSON.stringify(db.state.projects[0]), before, "미리보기는 저장하지 않는다");
  assert.deepEqual(preview.filled.sort(), ["소개", "앱 링크"].sort()); // 빈 칸(자리표시 소개 포함)
  assert.deepEqual(preview.overwritten.sort(), ["대표 이미지", "제목"].sort());
  assert.deepEqual(preview.unchanged, ["기술 스택"]);
  assert.deepEqual(preview.skipped, []);
  assert.equal(preview.values["제목"], "환테크 기록");
  assert.equal(preview.values["소개"], "환율 기록 앱이에요."); // 한국어 짧은 설명 먼저

  const r = await project.syncProjectFromPackage("invest-app");
  assert.equal(r.ok, true);
  assert.match(r.message, /채움: .*소개/);
  assert.match(r.message, /덮어씀: .*제목/);
  const p = db.state.projects[0];
  assert.equal(p.title, "환테크 기록");
  assert.equal(p.description, "환율 기록 앱이에요.");
  assert.equal(p.coverImage, "https://img.example/feature.png");
  assert.equal(p.appLink, "https://play.google.com/store/apps/details?id=com.factory.invest");
  assert.equal(p.privacyPolicy, "기존 방침");
  assert.equal(p.status, "in-progress");
  assert.equal(p.privacyUpdatedAt, undefined);
});

test("[홈페이지만 반영] 서버에 없는 값은 건너뛰고 알려 준다, 출시 패키지 storeListing 도 쓴다", async () => {
  const db = fakeDb({
    apps: [{ appSlug: "half-app", storeTarget: true, projectId: "p1", releaseStatus: "testing", packageName: "com.x.y", releasePackage: { storeListing: { ko: { title: "반쪽", shortDescription: "패키지 설명" } } } }],
    jobs: [{ appSlug: "half-app", kind: "new", stack: "kotlin-compose" }],
    projects: [{ id: "p1", title: "반쪽", description: "", techStack: [] }],
  });
  const r = await loadProject(db).syncProjectFromPackage("half-app");
  const p = db.state.projects[0];

  assert.equal(r.ok, true);
  assert.equal(p.description, "패키지 설명");
  assert.deepEqual(p.techStack, ["kotlin-compose"]);
  assert.equal(p.coverImage, null);
  assert.equal(p.appLink, null);
  assert.equal(r.skipped.length, 2);
  assert.match(r.skipped.join(" "), /대표 이미지/);
  assert.match(r.skipped.join(" "), /앱 링크/);
  assert.deepEqual(r.unchanged, ["제목"]);
  assert.match(r.message, /건너뜀/);
});

test("[홈페이지만 반영] 연결된 프로젝트가 없으면 거절(먼저 프로젝트를 연결)", async () => {
  const db = fakeDb({
    apps: [{ ...FULL_APP, projectId: null }, { ...FULL_APP, appSlug: "lost-app", projectId: "p-gone" }],
    jobs: [{ appSlug: "invest-app" }, { appSlug: "lost-app" }],
  });
  const project = loadProject(db);
  const r = await project.syncProjectFromPackage("invest-app", { dryRun: true });

  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.match(r.message, /먼저 출시 패키지 카드에서 프로젝트를 연결하세요/);
  assert.equal((await project.syncProjectFromPackage("lost-app")).status, 404);
  assert.equal((await project.syncProjectFromPackage("no-such-app")).status, 404);
});

test("기존 출시 일감의 홈페이지 반영(fillProjectIfEmpty)은 그대로: 빈 칸만, 덮어쓰기 일감은 바꿈", async () => {
  const db = fakeDb({
    apps: [{ appSlug: "store-app", storeTarget: true, projectId: "p1" }],
    projects: [{ id: "p1", title: "앱", description: "사람이 쓴 소개", coverImage: null, privacyPolicy: null }],
  });
  const project = loadProject(db);
  let r = await project.fillProjectIfEmpty("store-app", { description: "새 소개", coverImage: "https://img/c.png", privacyPolicy: "방침" });

  assert.equal(r.ok, true);
  assert.deepEqual(r.filled.sort(), ["coverImage", "privacyPolicy"]);
  assert.deepEqual(r.skipped, ["description"]);
  assert.equal(db.state.projects[0].description, "사람이 쓴 소개");
  assert.ok(db.state.projects[0].privacyUpdatedAt instanceof Date);

  r = await project.fillProjectIfEmpty("store-app", { description: "새 소개", privacyPolicy: "다른 방침" }, { overwrite: true });
  assert.equal(db.state.projects[0].description, "새 소개");
  assert.equal(db.state.projects[0].privacyPolicy, "방침");
  assert.deepEqual(r.overwritten, ["description"]);

  // 연결이 없으면 404(감독 프로그램은 project.json 404 를 실패로 보지 않는다)
  r = await project.fillProjectIfEmpty("other-app", { description: "x" });
  assert.equal(r.status, 404);
});
