// 공개 API(app/api/public/projects/route.ts) 시험: released 만 나오는지, 허용 목록 필드만 나가는지, 빈 목록·오류·메서드.
// DB 는 메모리 가짜. 실제 DB·서버는 쓰지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const nextServer = require("next/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const ALLOWED = ["name", "title", "description", "coverImage", "appLink", "platform", "techStack", "updatedAt", "detailUrl"].sort();
const FORBIDDEN = ["id", "status", "privacyPolicy", "privacyUpdatedAt", "databaseId", "progress", "revenues", "logs", "tags", "totalRevenue", "createdAt", "factoryApp"];

function row(name, status, createdAt, extra = {}) {
  return {
    id: `id-${name}`,
    name,
    title: `${name} 제목`,
    description: `${name} 설명`,
    coverImage: `/uploads/${name}.png`,
    appLink: "",
    platform: "mobile",
    status,
    techStack: ["Flutter"],
    progress: 70,
    databaseId: "db-secret",
    privacyPolicy: "개인정보처리방침 본문",
    privacyUpdatedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date(createdAt),
    updatedAt: new Date("2026-10-01T12:00:00Z"),
    tags: [{ id: "t1", name: "태그" }],
    logs: [{ id: "l1" }],
    revenues: [{ total: 1000 }],
    ...extra,
  };
}

// findMany 의 where/select/orderBy/take 를 흉내 낸다. ignoreWhere 면 where 를 무시해 이중 확인을 시험한다.
function fakePrisma(rows, { ignoreWhere = false, fail = null } = {}) {
  const calls = [];
  return {
    calls,
    project: {
      async findMany(args) {
        calls.push(args);
        if (fail) throw fail;
        let list = rows.slice();
        if (!ignoreWhere && args.where) list = list.filter((r) => Object.entries(args.where).every(([k, v]) => r[k] === v));
        if (args.orderBy?.createdAt === "desc") list.sort((a, b) => b.createdAt - a.createdAt);
        if (args.take) list = list.slice(0, args.take);
        if (!args.select) return list;
        return list.map((r) => Object.fromEntries(Object.keys(args.select).filter((k) => args.select[k]).map((k) => [k, r[k]])));
      },
    },
  };
}

function loadRoute(prisma) {
  const site = loadTs("config/site.ts");
  return loadTs("app/api/public/projects/route.ts", { "next/server": nextServer, "@/lib/prisma": prisma, "@/config/site": site });
}

const ROWS = [
  row("old-app", "released", "2025-01-01T00:00:00Z"),
  row("wip-app", "in-progress", "2026-09-01T00:00:00Z"),
  row("api-server", "backend", "2026-08-01T00:00:00Z"),
  row("new-app", "released", "2026-05-01T00:00:00Z", { appLink: "https://play.google.com/store/apps/details?id=x", coverImage: null }),
];

test("released 만, createdAt 내림차순, 허용 목록 필드만 돌려준다", async () => {
  const prisma = fakePrisma(ROWS);
  const { GET } = loadRoute(prisma);
  const res = await GET();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, s-maxage=300, stale-while-revalidate=600");
  assert.equal(res.headers.get("access-control-allow-origin"), null);

  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ["generatedAt", "projects"]);
  assert.ok(!isNaN(Date.parse(body.generatedAt)));
  assert.deepEqual(body.projects.map((p) => p.name), ["new-app", "old-app"]);

  for (const p of body.projects) assert.deepEqual(Object.keys(p).sort(), ALLOWED);
  const text = JSON.stringify(body);
  for (const key of FORBIDDEN) assert.ok(!text.includes(`"${key}"`), `금지 필드 ${key} 가 응답에 있다`);
  for (const value of ["db-secret", "개인정보처리방침", "id-new-app", "wip-app", "api-server"]) assert.ok(!text.includes(value), `${value} 가 응답에 있다`);

  const [first] = body.projects;
  assert.equal(first.appLink, "https://play.google.com/store/apps/details?id=x");
  assert.equal(first.coverImage, null);
  assert.equal(first.updatedAt, "2026-10-01T12:00:00.000Z");
  assert.equal(first.detailUrl, "https://www.buyoungsilcoding.com/project/new-app");
  assert.equal(body.projects[1].appLink, null); // 빈 문자열은 null

  const [args] = prisma.calls;
  assert.deepEqual(args.where, { status: "released" });
  assert.deepEqual(args.orderBy, { createdAt: "desc" });
  assert.equal(args.take, 50);
  for (const key of FORBIDDEN.filter((k) => k !== "status")) assert.ok(!(key in args.select), `DB 에서 ${key} 를 읽는다`);
});

test("DB 가 where 를 무시해도 released 가 아닌 것은 빠진다", async () => {
  const { GET } = loadRoute(fakePrisma(ROWS, { ignoreWhere: true }));
  const body = await (await GET()).json();
  assert.deepEqual(body.projects.map((p) => p.name).sort(), ["new-app", "old-app"]);
});

test("출시된 프로젝트가 없으면 200 과 빈 배열", async () => {
  const { GET } = loadRoute(fakePrisma([row("wip-app", "in-progress", "2026-09-01T00:00:00Z")]));
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.projects, []);
  assert.ok(body.generatedAt);
});

test("50개까지만 돌려준다", async () => {
  const many = Array.from({ length: 60 }, (_, i) => row(`app-${i}`, "released", new Date(Date.UTC(2026, 0, 1 + i)).toISOString()));
  const body = await (await loadRoute(fakePrisma(many)).GET()).json();
  assert.equal(body.projects.length, 50);
  assert.equal(body.projects[0].name, "app-59");
});

test("DB 오류는 500 과 정해진 문구만, 상세는 로그에만(주소 생략)", async () => {
  const err = new Error("Can't reach database server at postgresql://user:pw-SECRET@db:5432/app");
  const { GET } = loadRoute(fakePrisma([], { fail: err }));
  const logged = [];
  const original = console.error;
  console.error = (...a) => logged.push(a.join(" "));
  try {
    const res = await GET();
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "처리에 실패했습니다." });
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.ok(!logged[0].includes("pw-SECRET"));
  assert.ok(logged[0].includes("[주소 생략]"));
});

test("GET 외 메서드는 405", async () => {
  const route = loadRoute(fakePrisma(ROWS));
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const res = await route[method]();
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET");
  }
});
