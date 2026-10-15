// 블로그 설정 "연결 키" 시험: 통제실(factory-web)과 같은 해시, 생성 형식, 원문 한 번만, 폐기, 비관리자 403, 표 없음 처리.
// 가짜 DB(메모리)로 돌린다. 시험용 값은 실행할 때 난수로 만든다(해시 일치 시험만 고정 입력).
// 실행: npm run test:connection-keys
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { NextRequest } = require("next/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const logs = [];
for (const level of ["log", "info", "warn", "error"]) console[level] = (...args) => logs.push(args.map(String).join(" "));

const PEPPER = randomBytes(32).toString("hex");
const keys = loadTs("lib/connection-keys.ts");

function setup({ session = { user: { role: "admin", email: "admin@example.test", id: "u1" } }, missingTable = false, pepper = PEPPER } = {}) {
  const rows = [];
  let seq = 0;
  const miss = () => {
    throw Object.assign(new Error("The table `public.control_connection_keys` does not exist"), { code: "P2021" });
  };
  const model = {
    findMany: async () => (missingTable ? miss() : [...rows].sort((a, b) => b.createdAt - a.createdAt)),
    count: async ({ where }) => (missingTable ? miss() : rows.filter((r) => r.revokedAt === where.revokedAt).length),
    create: async ({ data }) => {
      if (missingTable) miss();
      const row = { id: `c${++seq}`, scopes: [], createdAt: new Date(Date.now() + seq), lastUsedAt: null, revokedAt: null, ...data };
      rows.push(row);
      return row;
    },
    updateMany: async ({ where, data }) => {
      if (missingTable) miss();
      const hit = rows.filter((r) => r.id === where.id && r.revokedAt === null);
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  };
  const state = { session };
  const prisma = { controlConnectionKey: model };
  const adminKeys = loadTs("lib/connect/adminKeys.ts", { "@/lib/prisma": { __esModule: true, default: prisma }, "@/lib/connect/pepper": { getPepper: async () => pepper }, "@/lib/connection-keys": keys });
  const route = loadTs("app/api/admin/factory/connection-keys/route.ts", {
    "@/lib/auth/get-sesstion": { auth: async () => state.session },
    "@/lib/auth/requireAdmin": loadTs("lib/auth/requireAdmin.ts", { "@/lib/auth/get-sesstion": { auth: async () => state.session } }),
    "@/lib/connect/adminKeys": adminKeys,
    "@/lib/connect/guard": { hit: () => false, isSameOriginRequest: (get) => get("sec-fetch-site") === "same-origin" },
  });
  const req = (method, body, site = "same-origin") =>
    new NextRequest("http://localhost/api/admin/factory/connection-keys", { method, headers: { "sec-fetch-site": site, "content-type": "application/json" }, body: JSON.stringify(body) });

  return { rows, route, req, state };
}

test("통제실과 같은 해시: 고정 입력의 HMAC 값이 같고, 통제실 사본이 있으면 소스도 같다", () => {
  const key = `ck_${"ab".repeat(32)}`;
  const expected = "b107b1754ce466f80a75af82d303792f3bebc59791d399cdf4f67907650b3007";

  assert.equal(keys.hashConnectionKey("p".repeat(32), key), expected);
  assert.equal(createHmac("sha256", "p".repeat(32)).update(key, "utf8").digest("hex"), expected);
  // pepper 유도(NEXTAUTH_SECRET → HKDF) 고정 값
  assert.equal(Buffer.from(hkdfSync("sha256", "n".repeat(32), "", "studio-access-key-v1", 32)).toString("hex"), "0e79559434d6de8b92aa7876bde0756c2427435f1e92e7d712b47b03ff6f2518");
  const same = (rel) => {
    const other = path.join(repo, "..", "factory-web", rel);

    if (!fs.existsSync(other)) return;
    const norm = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

    assert.equal(norm(path.join(repo, rel)), norm(other), `${rel} 가 통제실과 달라요`);
  };

  same("lib/connection-keys.ts");
});

test("pepper 선택 순서가 pepper.ts 에 있다(환경변수 → 유도)", () => {
  const src = fs.readFileSync(path.join(repo, "lib/connect/pepper.ts"), "utf8");
  const i1 = src.indexOf("process.env[PEPPER_NAME]");
  const i2 = src.indexOf("derivedPepper()", i1);

  assert.ok(i1 > 0 && i2 > i1);
});

test("만들기: ck_ 형식, 원문은 응답에만, 저장은 해시·앞 8자", async () => {
  const t = setup();
  const res = await t.route.POST(t.req("POST", { label: "  블로그   서버 " }));
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.match(body.key, /^ck_[0-9a-f]{64}$/);
  assert.equal(body.label, "블로그 서버");
  assert.equal(body.prefix, body.key.slice(0, 8));
  assert.equal(t.rows.length, 1);
  assert.equal(t.rows[0].hash, keys.hashConnectionKey(PEPPER, body.key));
  assert.equal(t.rows[0].createdBy, "admin@example.test");
  assert.ok(!JSON.stringify(t.rows).includes(body.key));
});

test("원문은 한 번만: 목록·로그에 키·해시가 없다", async () => {
  const t = setup();
  const created = await (await t.route.POST(t.req("POST", { label: "a" }))).json();
  const listRes = await t.route.GET();
  const text = JSON.stringify(await listRes.json());

  assert.equal(listRes.status, 200);
  assert.ok(text.includes(created.prefix));
  assert.ok(!text.includes(created.key) && !text.includes(t.rows[0].hash));
  const all = logs.join("\n");

  assert.ok(!all.includes(created.key) && !all.includes(t.rows[0].hash) && !all.includes(PEPPER));
  const second = await (await t.route.POST(t.req("POST", { label: "b" }))).json();

  assert.notEqual(second.key, created.key);
});

test("이름 검사와 유효 키 개수 제한", async () => {
  const t = setup();

  assert.equal((await t.route.POST(t.req("POST", { label: "" }))).status, 400);
  assert.equal((await t.route.POST(t.req("POST", { label: "x".repeat(41) }))).status, 400);
  assert.equal((await t.route.POST(t.req("POST", { label: "<b>" }))).status, 400);
  assert.equal((await t.route.POST(t.req("POST", {}))).status, 400);
  for (let i = 0; i < 20; i += 1) assert.equal((await t.route.POST(t.req("POST", { label: `k${i}` }))).status, 200);
  assert.equal((await t.route.POST(t.req("POST", { label: "넘침" }))).status, 400);
});

test("폐기: 한 번만 성공, 두 번째는 404, 목록에 폐기 시각", async () => {
  const t = setup();
  await t.route.POST(t.req("POST", { label: "a" }));
  const id = t.rows[0].id;

  assert.equal((await t.route.DELETE(t.req("DELETE", { id }))).status, 200);
  assert.ok(t.rows[0].revokedAt instanceof Date);
  assert.equal((await t.route.DELETE(t.req("DELETE", { id }))).status, 404);
  assert.equal((await t.route.DELETE(t.req("DELETE", {}))).status, 400);
  const list = await (await t.route.GET()).json();

  assert.ok(list.items[0].revokedAt);
});

test("비관리자·비로그인은 403, 다른 사이트 요청은 403", async () => {
  const t = setup({ session: { user: { role: "user", id: "u2" } } });

  assert.equal((await t.route.GET()).status, 403);
  assert.equal((await t.route.POST(t.req("POST", { label: "a" }))).status, 403);
  assert.equal((await t.route.DELETE(t.req("DELETE", { id: "x" }))).status, 403);
  t.state.session = null;
  assert.equal((await t.route.GET()).status, 403);
  assert.equal((await t.route.POST(t.req("POST", { label: "a" }))).status, 403);
  t.state.session = { user: { role: "admin", id: "u1" } };
  assert.equal((await t.route.POST(t.req("POST", { label: "a" }, "cross-site"))).status, 403);
  assert.equal(t.rows.length, 0);
});

test("표가 없으면(통제실 배포 전) 목록은 available:false, 만들기·폐기는 503", async () => {
  const t = setup({ missingTable: true });
  const list = await t.route.GET();

  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), { available: false, items: [] });
  const made = await t.route.POST(t.req("POST", { label: "a" }));

  assert.equal(made.status, 503);
  assert.match((await made.json()).message, /통제실 배포 후/);
  assert.equal((await t.route.DELETE(t.req("DELETE", { id: "x" }))).status, 503);
});

test("비밀값이 없으면 만들기 409", async () => {
  const t = setup({ pepper: null });
  const res = await t.route.POST(t.req("POST", { label: "a" }));

  assert.equal(res.status, 409);
  assert.equal(t.rows.length, 0);
});
