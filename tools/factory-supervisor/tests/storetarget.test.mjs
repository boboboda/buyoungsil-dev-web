// 출시 대상(storeTarget) 시험: 출시 패키지 목록 필터, nextjs·nestjs 거부, 대상 아닌 앱의 출시 일감 등록 거부,
// 커넥터 get_release_status, 마이그레이션 백필 조건. DB 는 메모리 가짜. 실제 DB·서버는 쓰지 않는다.
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

const storeTarget = loadTs("lib/factory/storeTarget.ts");
const { NOT_TARGET_MESSAGE, NON_STORE_REASON, shouldBackfillStoreTarget, storeTargetBlockReason } = storeTarget;

// ───── 가짜 DB ─────
const d = (s) => new Date(s);
function fakeDb({ apps = [], jobs = [] } = {}) {
  const state = { apps: apps.map((a) => ({ ...a })), jobs: jobs.map((j, i) => ({ id: `job${i}`, title: j.appSlug, ...j })) };
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
    ...a,
  });
  const jobRow = (j) => ({ kind: "new", stack: "flutter", status: "done", createdAt: d("2026-01-01"), reviewRequired: false, reviewApprovedAt: null, ...j });
  const whereOk = (row, where = {}) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "in" in v ? v.in.includes(row[k]) : row[k] === v));
  const prisma = {
    state,
    factoryReleaseAccount: { findMany: async () => [], findUnique: async () => null },
    factoryApp: {
      findMany: async () => state.apps.map(appRow),
      findUnique: async ({ where }) => {
        const a = state.apps.find((x) => x.appSlug === where.appSlug);
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
      findMany: async ({ where, orderBy } = {}) => {
        const rows = state.jobs.map(jobRow).filter((j) => whereOk(j, where));
        if (orderBy?.createdAt === "desc" || !orderBy) rows.sort((a, b) => b.createdAt - a.createdAt);
        return rows;
      },
      findFirst: async ({ where }) => state.jobs.map(jobRow).find((j) => whereOk(j, where)) ?? null,
    },
    factoryJobLog: { findMany: async () => [] },
    factorySecretName: { findMany: async () => [] },
    factorySetting: { findUnique: async () => null },
    project: { findMany: async () => [] },
    $transaction: async (ops) => Promise.all(ops),
  };
  return prisma;
}

function loadRelease(prisma) {
  const storeAssets = { readStoreAssets: () => null, savePromoVideoUrl: async () => ({ ok: true }) };
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
    "@/lib/factory/storeAssets": { readStoreAssets: () => null, savePromoVideoUrl: async () => ({ ok: true }) },
    "@/lib/factory/storeTarget": storeTarget,
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

// 대상 앱 1개(flutter), 대상 아닌 flutter 앱, 웹사이트(nextjs), 서버(nestjs), 앱 행 없는 앱
const SAMPLE = {
  apps: [
    { appSlug: "store-app", storeTarget: true },
    { appSlug: "plain-app" },
    { appSlug: "web-site" },
  ],
  jobs: [
    { appSlug: "store-app", kind: "new", stack: "flutter" },
    { appSlug: "plain-app", kind: "new", stack: "flutter" },
    { appSlug: "web-site", kind: "new", stack: "nextjs" },
    { appSlug: "api-server", kind: "new", stack: "nestjs" },
    { appSlug: "no-row-app", kind: "new", stack: "flutter", status: "failed" },
  ],
};

test("출시 패키지 목록에는 출시 대상인 앱만 나오고, 나머지는 otherApps 로", async () => {
  const release = loadRelease(fakeDb(SAMPLE));
  const o = await release.releaseOverview();

  assert.deepEqual(o.apps.map((a) => a.appSlug), ["store-app"]);
  const others = Object.fromEntries(o.otherApps.map((a) => [a.appSlug, a]));
  assert.deepEqual(Object.keys(others).sort(), ["api-server", "no-row-app", "plain-app", "web-site"]);
  assert.equal(others["web-site"].blockReason, NON_STORE_REASON);
  assert.equal(others["api-server"].blockReason, NON_STORE_REASON);
  assert.equal(others["plain-app"].blockReason, null);
  assert.equal(others["no-row-app"].lastJob.status, "failed");
  assert.equal(others["no-row-app"].done, false);
});

test("새 일감이 생겨도 저절로 목록에 들어오지 않는다(삭제한 앱 포함)", async () => {
  const db = fakeDb({
    apps: [{ appSlug: "plain-app", releaseRemovedAt: d("2026-02-01") }],
    jobs: [
      { appSlug: "plain-app", kind: "new", stack: "flutter", createdAt: d("2026-01-01") },
      { appSlug: "plain-app", kind: "revision", stack: "flutter", createdAt: d("2026-03-01") },
    ],
  });
  const o = await loadRelease(db).releaseOverview();

  assert.equal(o.apps.length, 0);
  assert.deepEqual(o.otherApps.map((a) => a.appSlug), ["plain-app"]);
});

test("nextjs·nestjs 는 출시 대상으로 만들 수 없다(이유 문구 포함), flutter 는 추가·빼기 가능", async () => {
  assert.equal(storeTargetBlockReason("nextjs"), NON_STORE_REASON);
  assert.equal(storeTargetBlockReason("nestjs"), NON_STORE_REASON);
  assert.equal(storeTargetBlockReason("flutter"), null);

  const db = fakeDb(SAMPLE);
  const release = loadRelease(db);
  for (const slug of ["web-site", "api-server"]) {
    const r = await release.setStoreTarget(slug, true);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.match(r.message, /웹\/서버 앱은 스토어에 올릴 수 없어요/);
  }
  assert.equal(db.state.apps.find((a) => a.appSlug === "web-site").storeTarget, undefined);
  assert.equal(db.state.apps.some((a) => a.appSlug === "api-server"), false);

  // 앱 행이 없는 앱은 추가할 때 행을 만든다
  assert.equal((await release.setStoreTarget("no-row-app", true)).ok, true);
  assert.equal(db.state.apps.find((a) => a.appSlug === "no-row-app").storeTarget, true);
  assert.equal((await release.setStoreTarget("plain-app", true)).ok, true);
  let o = await release.releaseOverview();
  assert.deepEqual(o.apps.map((a) => a.appSlug).sort(), ["no-row-app", "plain-app", "store-app"]);

  // 빼기: 목록에서만 빠지고 출시 데이터는 남는다
  db.state.apps.find((a) => a.appSlug === "plain-app").packageName = "com.example.plain";
  assert.equal((await release.setStoreTarget("plain-app", false)).ok, true);
  const plain = db.state.apps.find((a) => a.appSlug === "plain-app");
  assert.equal(plain.storeTarget, false);
  assert.equal(plain.packageName, "com.example.plain");
  o = await release.releaseOverview();
  assert.equal(o.apps.some((a) => a.appSlug === "plain-app"), false);

  assert.equal((await release.setStoreTarget("nothing-here", true)).status, 404);
});

test("진행 중 일감이 있는 앱은 빼기를 막고, [삭제]는 출시 대상 표시도 푼다", async () => {
  const db = fakeDb({
    apps: [{ appSlug: "busy-app", storeTarget: true }, { appSlug: "store-app", storeTarget: true, packageName: "com.example.s" }],
    jobs: [
      { appSlug: "busy-app", kind: "release", stack: "flutter", status: "running" },
      { appSlug: "store-app", kind: "new", stack: "flutter" },
    ],
  });
  const release = loadRelease(db);
  const r = await release.setStoreTarget("busy-app", false);

  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(db.state.apps.find((a) => a.appSlug === "busy-app").storeTarget, true);

  assert.equal((await release.removeAppRelease(["store-app"])).ok, true);
  const s = db.state.apps.find((a) => a.appSlug === "store-app");
  assert.equal(s.storeTarget, false);
  assert.equal(s.packageName, null);
  assert.ok(s.releaseRemovedAt instanceof Date);

  // 다시 추가하면 목록에 보인다(지운 시각 이전의 출시 일감 결과는 숨김 그대로)
  assert.equal((await release.setStoreTarget("store-app", true)).ok, true);
  const o = await release.releaseOverview();
  assert.ok(o.apps.some((a) => a.appSlug === "store-app"));
});

test("출시 일감 등록은 출시 대상이 아닌 앱에서 거부된다", async () => {
  const db = fakeDb(SAMPLE);
  const mcp = loadMcp(db, loadRelease(db));

  for (const slug of ["plain-app", "web-site", "no-row-app"]) {
    const r = await mcp.enqueueReleaseJob({ appSlug: slug, kind: "first" });
    assert.equal(r.isError, true, slug);
    assert.match(r.content[0].text, /먼저 출시 패키지에 추가하세요/);
  }
  // 대상 앱은 이 확인을 지나 다음 확인(준비 부족)으로 간다
  const ok = await mcp.enqueueReleaseJob({ appSlug: "store-app", kind: "first" });
  assert.equal(ok.isError, true);
  assert.doesNotMatch(ok.content[0].text, /먼저 출시 패키지에 추가하세요/);
  assert.match(ok.content[0].text, /준비가 부족해요/);
  // 커넥터 도구 이름으로 불러도 같다
  const viaTool = await mcp.callFactoryTool("enqueue_release_job", { appSlug: "plain-app" });
  assert.match(viaTool.content[0].text, new RegExp(NOT_TARGET_MESSAGE.slice(0, 20)));
});

test("커넥터 get_release_status 는 출시 대상 앱만, 대상아님 에는 이름·종류만", async () => {
  const db = fakeDb(SAMPLE);
  const mcp = loadMcp(db, loadRelease(db));
  const r = await mcp.callFactoryTool("get_release_status", {});
  const body = JSON.parse(r.content[0].text);

  assert.deepEqual(body.앱.map((a) => a.appSlug), ["store-app"]);
  assert.equal("출시대상" in body.앱[0], false);
  assert.deepEqual(body.대상아님.map((a) => a.appSlug).sort(), ["api-server", "no-row-app", "plain-app", "web-site"]);
  for (const a of body.대상아님) assert.deepEqual(Object.keys(a).sort(), ["appSlug", "이름", "종류"].sort());
  assert.equal(body.대상아님.find((a) => a.appSlug === "web-site").종류, "nextjs");

  const one = await mcp.callFactoryTool("get_release_status", { appSlug: "plain-app" });
  assert.equal(one.isError, true);
  assert.match(one.content[0].text, /먼저 출시 패키지에 추가하세요/);
});

test("백필 조건: 출시 작업이 진행된 앱만, nextjs·nestjs·삭제로 숨긴 앱은 제외", () => {
  const base = { releaseAccountId: null, packageName: null, firstUploadDone: false, releaseStatus: "preparing", releaseRemovedAt: null };
  const jobs = (stack = "flutter", kinds = ["new"]) => kinds.map((kind, i) => ({ kind, stack, createdAt: d(`2026-0${i + 1}-01`) }));

  assert.equal(shouldBackfillStoreTarget(base, jobs()), false, "아무 진행 없음");
  assert.equal(shouldBackfillStoreTarget({ ...base, releaseAccountId: "acc" }, jobs()), true, "배포 계정");
  assert.equal(shouldBackfillStoreTarget({ ...base, packageName: "com.x.y" }, jobs()), true, "패키지 이름");
  assert.equal(shouldBackfillStoreTarget({ ...base, firstUploadDone: true }, jobs()), true, "최초 업로드");
  assert.equal(shouldBackfillStoreTarget({ ...base, releaseStatus: "testing" }, jobs()), true, "출시 상태");
  assert.equal(shouldBackfillStoreTarget(base, jobs("flutter", ["new", "release"])), true, "출시 일감");
  assert.equal(shouldBackfillStoreTarget({ ...base, packageName: "com.x.y" }, jobs("nextjs")), false, "nextjs 제외");
  assert.equal(shouldBackfillStoreTarget({ ...base, releaseAccountId: "acc" }, jobs("nestjs", ["new", "release"])), false, "nestjs 제외");
  assert.equal(shouldBackfillStoreTarget({ ...base, packageName: "com.x.y" }, []), false, "일감 없음");
  // 마지막 일감의 종류로 본다
  assert.equal(
    shouldBackfillStoreTarget({ ...base, packageName: "com.x.y" }, [
      { kind: "new", stack: "nextjs", createdAt: d("2026-01-01") },
      { kind: "revision", stack: "flutter", createdAt: d("2026-02-01") },
    ]),
    true,
  );
  // 예전 [삭제]로 숨긴 앱(지운 뒤 새 일감 없음)은 출시 일감이 있어도 제외, 지운 뒤 새 일감이 있으면 포함
  const removed = { ...base, releaseRemovedAt: d("2026-02-15") };
  assert.equal(shouldBackfillStoreTarget(removed, jobs("flutter", ["new", "release"])), false);
  assert.equal(shouldBackfillStoreTarget(removed, jobs("flutter", ["new", "release", "revision"])), true);
});

test("마이그레이션: 열 추가와 백필 UPDATE 하나뿐(삭제 없음), 같은 조건", () => {
  const dir = path.join(repo, "prisma/migrations/20261019090000_add_factory_store_target");
  const sql = fs.readFileSync(path.join(dir, "migration.sql"), "utf8");
  const code = sql.replace(/--.*$/gm, "");

  assert.match(code, /ALTER TABLE "factory_apps" ADD COLUMN "storeTarget" BOOLEAN NOT NULL DEFAULT false;/);
  assert.equal((code.match(/\bUPDATE\b/g) ?? []).length, 1);
  assert.doesNotMatch(code, /\b(DELETE|DROP|TRUNCATE|INSERT)\b/i);
  for (const part of ['"releaseAccountId" IS NOT NULL', '"packageName" IS NOT NULL', '"firstUploadDone" = true', "\"releaseStatus\" <> 'preparing'", "j.\"kind\" = 'release'", "NOT IN ('nextjs', 'nestjs')", '"releaseRemovedAt" IS NULL']) {
    assert.ok(code.includes(part), part);
  }
  const schema = fs.readFileSync(path.join(repo, "prisma/schema.prisma"), "utf8");
  assert.match(schema, /storeTarget\s+Boolean\s+@default\(false\)/);
});
