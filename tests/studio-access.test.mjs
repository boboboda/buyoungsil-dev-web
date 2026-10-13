// Studio 접근 키 시험: lib/studio/access.ts + 발급 라우트(/api/admin/factory/studio-keys) + 검증 라우트(/api/studio-auth/verify).
// 가짜 DB(메모리)와 가짜 세션으로 돌린다. 실제 DB·키·네트워크는 쓰지 않고, 시험용 값은 실행할 때 난수로 만든다.
// 실행: npm run test:studio-access
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
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

// 로그를 모아서 키·해시·헤더 값이 없는지 본다
const logs = [];
for (const level of ["log", "info", "warn", "error"]) {
  console[level] = (...args) => logs.push(args.map(String).join(" "));
}

const PEPPER = randomBytes(32).toString("hex");

function fakeDb() {
  const rows = [];
  let seq = 0;
  const match = (r, where = {}) => Object.entries(where).every(([k, v]) => r[k] === v);
  const studioAccessKey = {
    updateMany: async ({ where, data }) => {
      const hit = rows.filter((r) => match(r, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
    create: async ({ data }) => {
      if (rows.some((r) => r.keyHash === data.keyHash)) throw Object.assign(new Error("unique"), { code: "P2002" });
      const row = { id: `k${++seq}`, createdAt: new Date(Date.now() + seq), revokedAt: null, lastUsedAt: null, ...data };
      rows.push(row);
      return { createdAt: row.createdAt };
    },
    findMany: async () => [...rows].sort((a, b) => b.createdAt - a.createdAt).map((r) => ({ ...r })),
    findFirst: async ({ where }) => {
      const r = [...rows].sort((a, b) => b.createdAt - a.createdAt).find((x) => match(x, where));
      return r ? { id: r.id, keyHash: r.keyHash, lastUsedAt: r.lastUsedAt } : null;
    },
    update: async ({ where, data }) => {
      const r = rows.find((x) => x.id === where.id);
      Object.assign(r, data);
      return r;
    },
  };
  const prisma = { studioAccessKey, $transaction: async (fn) => fn(prisma) };
  return { prisma, rows };
}

const setEnv = (name, value) => (value ? (process.env[name] = value) : delete process.env[name]);

// authSecret/authEnv: 유도에 쓰는 로그인용 시크릿. 기본은 없음(시험마다 따로 정한다). db 를 넘기면 같은 가짜 DB 를 이어 쓴다.
function setup({ pepper = PEPPER, authSecret = null, authEnv = "NEXTAUTH_SECRET", db, session = { user: { role: "admin", email: "admin@example.test", id: "u1" } } } = {}) {
  setEnv("STUDIO_KEY_PEPPER", pepper);
  setEnv("NEXTAUTH_SECRET", null);
  setEnv("AUTH_SECRET", null);
  setEnv(authEnv, authSecret);
  const { prisma, rows } = db ?? fakeDb();
  const access = loadTs("lib/studio/access.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/secretEntries": { readServerSecret: async () => null },
  });
  const state = { session };
  const admin = loadTs("app/api/admin/factory/studio-keys/route.ts", {
    "@/lib/auth/get-sesstion": { auth: async () => state.session },
    "@/lib/factory/http": { hit: () => false },
    "@/lib/studio/access": access,
  });
  const verify = loadTs("app/api/studio-auth/verify/route.ts", { "@/lib/studio/access": access });
  return { access, admin, verify, rows, state, db: { prisma, rows } };
}

const SAME = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
const adminReq = (method, app, headers = SAME) =>
  new NextRequest("http://localhost/api/admin/factory/studio-keys", { method, headers, body: JSON.stringify({ app }) });
const basic = (key, user = "studio") => `Basic ${Buffer.from(`${user}:${key}`).toString("base64")}`;
let ipSeq = 0;
const freshIp = () => `203.0.113.${++ipSeq}`;
function verifyReq(app, key, { ip = freshIp(), realIp, url = "http://localhost/api/studio-auth/verify" } = {}) {
  const headers = { "x-forwarded-for": ip };
  if (app !== undefined) headers["x-studio-app"] = app;
  if (key !== undefined) headers.authorization = key === null ? "Basic !!!" : basic(key);
  if (realIp) headers["x-real-ip"] = realIp;
  return new NextRequest(url, { headers });
}

async function issue(admin, app) {
  const res = await admin.POST(adminReq("POST", app));
  const body = await res.json();
  assert.equal(res.status, 200, body.message);
  assert.equal(res.headers.get("cache-control"), "no-store");
  return body.key;
}

const noStore = (res) => assert.equal(res.headers.get("cache-control"), "no-store");

test("키 모양: stk_ + 32바이트 base64url, 해시는 HMAC hex", () => {
  const { access } = setup();
  const k = access.generateStudioKey();
  assert.match(k, access.STUDIO_KEY_RE);
  assert.notEqual(k, access.generateStudioKey());
  assert.match(access.hashStudioKey(PEPPER, k), /^[0-9a-f]{64}$/);
  assert.notEqual(access.hashStudioKey(PEPPER, k), access.hashStudioKey(`${PEPPER}x`, k));
  assert.equal(access.basicPassword(basic("pw:with:colon")), "pw:with:colon");
  assert.equal(access.basicPassword("Bearer abc"), null);
  assert.equal(access.basicPassword(null), null);
  for (const bad of ["AB", "Sprout", "a_b", "a".repeat(41), "", null]) assert.equal(access.checkStudioApp(bad).ok, false, String(bad));
  assert.equal(access.checkStudioApp("sprout-hub").ok, true);
});

test("STUDIO_KEY_PEPPER 도 로그인용 시크릿도 없으면 발급을 막고 안내한다", async () => {
  const { admin, rows } = setup({ pepper: null, authSecret: null });
  const res = await admin.POST(adminReq("POST", "sprout-hub"));
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.match(body.message, /먼저 비밀값을 등록하세요/);
  assert.equal(body.key, undefined);
  assert.equal(rows.length, 0);
  const list = await (await admin.GET()).json();
  assert.equal(list.pepperReady, false);
});

test("STUDIO_KEY_PEPPER 가 없어도 로그인용 시크릿에서 유도한 값으로 발급→204, 응답·목록·로그에 비밀값 없음", async () => {
  for (const authEnv of ["NEXTAUTH_SECRET", "AUTH_SECRET"]) {
    const authSecret = randomBytes(24).toString("base64url");
    const { admin, verify, access, rows } = setup({ pepper: null, authSecret, authEnv });
    const before = logs.length;
    const res = await admin.POST(adminReq("POST", "sprout-hub"));
    const text = await res.text();
    assert.equal(res.status, 200, authEnv);
    const { key } = JSON.parse(text);
    assert.equal((await verify.GET(verifyReq("sprout-hub", key))).status, 204, authEnv);
    const listText = await (await admin.GET()).text();
    assert.equal(JSON.parse(listText).pepperReady, true);

    const derived = await access.getPepper();
    assert.match(derived, /^[0-9a-f]{64}$/);
    assert.notEqual(derived, authSecret, "원래 시크릿을 그대로 씀");
    // 원래 시크릿으로 바로 만든 해시와 다르다(유도 값을 거친다)
    assert.notEqual(rows[0].keyHash, access.hashStudioKey(authSecret, key));
    const seen = [text, listText, logs.slice(before).join("\n")].join("\n");
    for (const secret of [authSecret, derived]) assert.ok(!seen.includes(secret), "응답·로그에 비밀값이 남음");
  }
});

test("유도에 쓴 시크릿이 바뀌면 이전 키 401, STUDIO_KEY_PEPPER 가 있으면 그것이 우선", async () => {
  const authA = randomBytes(24).toString("base64url");
  const first = setup({ pepper: null, authSecret: authA });
  const key = await issue(first.admin, "sprout-hub");
  assert.equal((await first.verify.GET(verifyReq("sprout-hub", key))).status, 204);

  // 같은 DB, 시크릿만 바뀐 서버
  const changed = setup({ pepper: null, authSecret: randomBytes(24).toString("base64url"), db: first.db });
  assert.equal((await changed.verify.GET(verifyReq("sprout-hub", key))).status, 401);

  // 시크릿이 같아도 STUDIO_KEY_PEPPER 가 생기면 그것을 쓴다(유도 값으로 만든 키는 401)
  const withPepper = setup({ pepper: PEPPER, authSecret: authA, db: first.db });
  assert.equal(await withPepper.access.getPepper(), PEPPER);
  assert.equal((await withPepper.verify.GET(verifyReq("sprout-hub", key))).status, 401);
  const key2 = await issue(withPepper.admin, "sprout-hub");
  assert.equal(withPepper.rows.at(-1).keyHash, withPepper.access.hashStudioKey(PEPPER, key2));
  assert.equal((await withPepper.verify.GET(verifyReq("sprout-hub", key2))).status, 204);
});

test("통제실 카드: 비밀값 안내는 pepperReady 가 false 일 때만, 문서에 등록 단계 없음", () => {
  const card = fs.readFileSync(path.join(repo, "components/admin/factory/StudioAccessKeys.tsx"), "utf8");
  const i = card.indexOf("먼저 비밀값을 등록하세요");
  assert.ok(i > 0);
  assert.ok(card.lastIndexOf("{pepperReady === false && (", i) > card.lastIndexOf(")}", i), "안내가 조건 밖에 있음");
  const doc = fs.readFileSync(path.join(repo, "docs/studio-access.md"), "utf8");
  assert.ok(doc.includes("[키 발급]만 누르면 된다"));
  assert.ok(!doc.includes("비밀값 등록(처음 한 번)"));
  assert.match(doc, /시크릿이 바뀌면.*무효/);
});

test("발급 직후 204, 틀린 키·다른 앱·키 없음 401(같은 응답), 응답은 no-store", async () => {
  const { admin, verify, rows } = setup();
  const key = await issue(admin, "sprout-hub");
  assert.match(key, /^stk_/);
  assert.ok(!rows.some((r) => JSON.stringify(r).includes(key)), "DB 에 원문이 있음");

  const ok = await verify.GET(verifyReq("sprout-hub", key));
  assert.equal(ok.status, 204);
  noStore(ok);

  const wrong = await verify.GET(verifyReq("sprout-hub", `${key.slice(0, -2)}AA`));
  const otherApp = await verify.GET(verifyReq("other-game", key));
  const noApp = await verify.GET(verifyReq(undefined, key));
  const badHeader = await verify.GET(verifyReq("sprout-hub", null));
  const noKey = await verify.GET(verifyReq("sprout-hub", undefined));
  for (const r of [wrong, otherApp, noApp, badHeader, noKey]) {
    assert.equal(r.status, 401);
    assert.equal(r.headers.get("www-authenticate"), 'Basic realm="Studio", charset="UTF-8"');
    noStore(r);
    assert.equal(await r.text(), "");
  }
  // 쿼리로 보낸 키는 보지 않는다
  const q = await verify.GET(verifyReq("sprout-hub", undefined, { url: `http://localhost/api/studio-auth/verify?key=${key}` }));
  assert.equal(q.status, 401);
});

test("폐기 후 401, 같은 앱 재발급 시 이전 키 401·새 키 204, 다른 앱 키는 그대로", async () => {
  const { admin, verify } = setup();
  const first = await issue(admin, "sprout-hub");
  const other = await issue(admin, "prop-lab");
  const second = await issue(admin, "sprout-hub");
  assert.equal((await verify.GET(verifyReq("sprout-hub", first))).status, 401);
  assert.equal((await verify.GET(verifyReq("sprout-hub", second))).status, 204);
  assert.equal((await verify.GET(verifyReq("prop-lab", other))).status, 204);
  assert.equal((await verify.GET(verifyReq("prop-lab", second))).status, 401);

  const list = await (await admin.GET()).json();
  assert.deepEqual(list.items.map((i) => [i.app, i.active]), [["prop-lab", true], ["sprout-hub", true]]);
  assert.ok(!JSON.stringify(list).includes("keyHash"));

  const del = await admin.DELETE(adminReq("DELETE", "sprout-hub"));
  assert.equal(del.status, 200);
  noStore(del);
  assert.equal((await verify.GET(verifyReq("sprout-hub", second))).status, 401);
  assert.equal((await admin.DELETE(adminReq("DELETE", "sprout-hub"))).status, 404);
  const after = await (await admin.GET()).json();
  assert.deepEqual(after.items.map((i) => [i.app, i.active]), [["prop-lab", true], ["sprout-hub", false]]);
});

test("관리자 아님·로그인 없음은 발급·폐기·목록 불가, 다른 사이트에서 온 요청도 거절(CSRF)", async () => {
  const { admin, rows, state } = setup();
  state.session = { user: { role: "user", email: "u@example.test" } };
  assert.equal((await admin.POST(adminReq("POST", "sprout-hub"))).status, 403);
  assert.equal((await admin.DELETE(adminReq("DELETE", "sprout-hub"))).status, 403);
  assert.equal((await admin.GET()).status, 403);
  state.session = null;
  assert.equal((await admin.POST(adminReq("POST", "sprout-hub"))).status, 403);
  state.session = { user: { role: "admin", email: "admin@example.test" } };
  assert.equal((await admin.POST(adminReq("POST", "sprout-hub", { "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await admin.POST(adminReq("POST", "sprout-hub", { origin: "https://evil.example", host: "localhost" }))).status, 403);
  assert.equal((await admin.POST(adminReq("POST", "sprout-hub", {}))).status, 403);
  assert.equal(rows.length, 0);
  assert.equal((await admin.POST(adminReq("POST", "Bad_Name"))).status, 400);
});

test("한 주소가 10번 틀리면 429(맞는 키도), 다른 주소는 그대로, 키 없는 첫 요청은 세지 않음", async () => {
  const { admin, verify } = setup();
  const key = await issue(admin, "sprout-hub");
  const ip = freshIp();
  for (let i = 0; i < 20; i++) assert.equal((await verify.GET(verifyReq("sprout-hub", undefined, { ip }))).status, 401);
  for (let i = 0; i < 9; i++) assert.equal((await verify.GET(verifyReq("sprout-hub", "stk_wrong", { ip }))).status, 401);
  assert.equal((await verify.GET(verifyReq("sprout-hub", key, { ip }))).status, 204, "9번까지는 열림");
  assert.equal((await verify.GET(verifyReq("sprout-hub", "stk_wrong", { ip }))).status, 401);
  const blocked = await verify.GET(verifyReq("sprout-hub", key, { ip }));
  assert.equal(blocked.status, 429);
  noStore(blocked);
  assert.ok(Number(blocked.headers.get("retry-after")) > 800);
  assert.equal((await verify.GET(verifyReq("sprout-hub", key))).status, 204);
});

test("X-Real-IP 는 믿는 프록시(사설망·로컬)에서 온 것만 쓴다", () => {
  const { access } = setup();
  const h = (o) => (n) => o[n] ?? null;
  assert.equal(access.studioClientIp(h({ "x-forwarded-for": "172.18.0.1", "x-real-ip": "198.51.100.7" })), "198.51.100.7");
  assert.equal(access.studioClientIp(h({ "x-forwarded-for": "::ffff:127.0.0.1", "x-real-ip": "198.51.100.7" })), "198.51.100.7");
  assert.equal(access.studioClientIp(h({ "x-forwarded-for": "198.51.100.9", "x-real-ip": "10.9.9.9" })), "198.51.100.9");
  assert.equal(access.studioClientIp(h({ "x-forwarded-for": "1.1.1.1, 198.51.100.9", "x-real-ip": "10.9.9.9" })), "198.51.100.9");
  assert.equal(access.studioClientIp(h({})), "unknown");
  assert.equal(access.isTrustedProxy("172.32.0.1"), false);
});

test("제한기: 15분 뒤 풀림, 앱 전체 실패가 많으면 늦춤", () => {
  const { access } = setup();
  let t = 1_000_000;
  const lim = access.createFailLimiter(() => t);
  for (let i = 0; i < access.FAIL_LIMIT; i++) lim.fail("a", "sprout-hub");
  assert.ok(lim.blockedFor("a") > 0);
  t += access.BLOCK_MS + 1;
  assert.equal(lim.blockedFor("a"), 0);
  let slow = 0;
  for (let i = 0; i < access.APP_SLOW_AFTER + 1; i++) slow = lim.fail(`ip${i}`, "prop-lab");
  assert.equal(slow, access.APP_SLOW_MS);
  t += access.FAIL_WINDOW_MS + 1;
  assert.equal(lim.fail("ipX", "prop-lab"), 0);
});

test("성공하면 마지막 사용 시각을 1분에 한 번만 쓴다", async () => {
  const { admin, verify, rows } = setup();
  const key = await issue(admin, "sprout-hub");
  await verify.GET(verifyReq("sprout-hub", key));
  const first = rows[0].lastUsedAt;
  assert.ok(first instanceof Date);
  await verify.GET(verifyReq("sprout-hub", key));
  assert.equal(rows[0].lastUsedAt, first);
  const old = new Date(Date.now() - 61_000);
  rows[0].lastUsedAt = old;
  await verify.GET(verifyReq("sprout-hub", key));
  assert.ok(rows[0].lastUsedAt.getTime() > old.getTime() + 60_000);
});

test("로그에 키·해시·헤더 값이 없다", async () => {
  const { admin, verify, rows, access } = setup();
  const key = await issue(admin, "log-check");
  for (let i = 0; i < 12; i++) await verify.GET(verifyReq("log-check", `${key}x`, { ip: "198.51.100.200" }));
  await admin.DELETE(adminReq("DELETE", "log-check"));
  const all = logs.join("\n");
  assert.match(all, /\[studio\] 키 발급: app=log-check/);
  assert.match(all, /\[studio\] 키 폐기: app=log-check/);
  for (const secret of [key, key.slice(4), rows[0].keyHash, basic(key).slice(6), access.hashStudioKey(PEPPER, key), PEPPER]) {
    assert.ok(!all.includes(secret), "로그에 값이 남음");
  }
});

test("문서·미들웨어: 문서 있음, /api 는 미들웨어 대상 아님(검증 주소가 로그인 보호에 안 걸림)", () => {
  const doc = fs.readFileSync(path.join(repo, "docs/studio-access.md"), "utf8");
  for (const s of ["auth_request /_studio_auth", "/api/studio-auth/verify", "X-Studio-App", "WWW-Authenticate"]) assert.ok(doc.includes(s), s);
  assert.ok(!/stk_[A-Za-z0-9_-]{10,}/.test(doc), "문서에 키 예시가 있음");
  const mw = fs.readFileSync(path.join(repo, "middleware.ts"), "utf8");
  const matcher = mw.slice(mw.indexOf("matcher"));
  assert.ok(!matcher.includes("/api"), "미들웨어가 /api 를 잡음");
});
