// 통제실 로그인 넘김(블로그 쪽) 시험: lib/auth/handoff.ts 토큰 약속, /api/admin/handoff 분기.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { jwtVerify } = require("jose");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let session = null;
const fakeNext = {
  NextResponse: {
    redirect: (url, status) => new Response(null, { status, headers: { location: String(url) } }),
    json: (body, init) => Response.json(body, init),
  },
};
const MOCKS = { "next/server": fakeNext, "@/lib/auth/get-sesstion": { auth: async () => session } };

function load(rel, cache = {}) {
  const out = ts.transpileModule(fs.readFileSync(path.join(repo, rel), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", out)((name) => {
    if (MOCKS[name]) return MOCKS[name];
    if (name.startsWith("@/")) return cache[name] ?? (cache[name] = load(`${name.slice(2)}.ts`, cache));
    return require(name);
  }, module, module.exports);
  return module.exports;
}

const SECRET = "x".repeat(40);
const handoff = load("lib/auth/handoff.ts");
const route = load("app/api/admin/handoff/route.ts");
const req = (qs = "") => ({
  nextUrl: new URL(`https://www.buyoungsilcoding.com/api/admin/handoff${qs}`),
  headers: new Headers({ host: "www.buyoungsilcoding.com", "x-forwarded-proto": "https" }),
});
const admin = { user: { id: "u1", email: "a@b.c", name: "관리자", role: "admin" } };
const ticketOf = (loc) => new URL(loc).searchParams.get("ticket");

test.beforeEach(() => {
  process.env.CONTROL_HANDOFF_SECRET = SECRET;
  delete process.env.CONTROL_PUBLIC_URL;
  session = null;
});

test("토큰: 약속한 클레임, 60초 만료, jti 128비트 hex, 매번 다른 jti", async () => {
  const t1 = await handoff.signHandoffTicket({ id: "u1", email: "a@b.c", name: "관리자" }, 1_000_000);
  const { payload, protectedHeader } = await jwtVerify(t1, new TextEncoder().encode(SECRET), { issuer: "buyoungsil-blog", audience: "buyoungsil-control", algorithms: ["HS256"], currentDate: new Date(1_000_010_000) });
  assert.equal(protectedHeader.alg, "HS256");
  assert.deepEqual({ ...payload, jti: undefined }, { iss: "buyoungsil-blog", aud: "buyoungsil-control", purpose: "control-handoff", sub: "u1", email: "a@b.c", name: "관리자", role: "admin", iat: 1_000_000, exp: 1_000_060, jti: undefined });
  assert.match(payload.jti, /^[0-9a-f]{32}$/);
  const t2 = await handoff.signHandoffTicket({ id: "u1", email: "a@b.c", name: "관리자" }, 1_000_000);
  assert.notEqual(JSON.parse(Buffer.from(t2.split(".")[1], "base64url")).jti, payload.jti);
  await assert.rejects(jwtVerify(t1, new TextEncoder().encode(SECRET), { currentDate: new Date(1_000_061_000) }), /exp/);
});

test("비밀값이 없거나 짧으면 발급하지 않는다", async () => {
  delete process.env.CONTROL_HANDOFF_SECRET;
  await assert.rejects(handoff.signHandoffTicket({ id: "u", email: "e", name: "n" }), /CONTROL_HANDOFF_SECRET/);
  process.env.CONTROL_HANDOFF_SECRET = "short";
  await assert.rejects(handoff.signHandoffTicket({ id: "u", email: "e", name: "n" }), /CONTROL_HANDOFF_SECRET/);
});

test("to 허용 목록: /admin/factory·/studio 로 시작하는 경로만", () => {
  const ok = ["/admin/factory", "/admin/factory/jobs", "/admin/factory?tab=1", "/studio", "/studio/x/y", "/studio?a=1"];
  for (const p of ok) assert.equal(handoff.safeHandoffTo(p), p, p);
  const bad = [null, "", "/admin", "/admin/factoryx", "/studiox", "//evil.com", "https://evil.com", "/admin/users", "/admin/factory\\x", "/studio\nx"];
  for (const p of bad) assert.equal(handoff.safeHandoffTo(p), "/admin/factory", String(p));
});

test("관리자: 303 + no-store, 통제실 /auth/enter?ticket&to 로", async () => {
  session = admin;
  const res = await route.GET(req("?to=/studio/make"));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const loc = res.headers.get("location");
  assert.ok(loc.startsWith("https://factory.buyoungsilcoding.com/auth/enter?ticket="), loc);
  assert.equal(new URL(loc).searchParams.get("to"), "/studio/make");
  assert.match(loc, /&to=%2Fstudio%2Fmake$/);
  const { payload } = await jwtVerify(ticketOf(loc), new TextEncoder().encode(SECRET));
  assert.equal(payload.sub, "u1");
  // 허용 밖 to 는 기본값, CONTROL_PUBLIC_URL 이 있으면 그것을 쓴다
  process.env.CONTROL_PUBLIC_URL = "https://control.example.com/";
  const r2 = await route.GET(req("?to=//evil.com"));
  assert.ok(r2.headers.get("location").startsWith("https://control.example.com/auth/enter?ticket="));
  assert.match(r2.headers.get("location"), /&to=%2Fadmin%2Ffactory$/);
});

test("비로그인: /signin?callbackUrl=<handoff 주소> 로(같은 도메인), 토큰 없음", async () => {
  const res = await route.GET(req("?to=/admin/factory"));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const loc = new URL(res.headers.get("location"));
  assert.equal(loc.origin, "https://www.buyoungsilcoding.com");
  assert.equal(loc.pathname, "/signin");
  assert.equal(loc.searchParams.get("callbackUrl"), "/api/admin/handoff?to=%2Fadmin%2Ffactory");
  assert.ok(!loc.href.includes("ticket"));
});

test("관리자가 아니면 403, 비밀값이 없으면 503(토큰·값 노출 없음)", async () => {
  session = { user: { id: "u2", email: "u@b.c", name: "회원", role: "user" } };
  const res = await route.GET(req());
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("location"), null);
  session = admin;
  delete process.env.CONTROL_HANDOFF_SECRET;
  const res2 = await route.GET(req());
  assert.equal(res2.status, 503);
  assert.equal(res2.headers.get("location"), null);
});

test("블로그 [통제실] 링크가 handoff 주소를 가리킨다", () => {
  const site = fs.readFileSync(path.join(repo, "config/site.ts"), "utf8");
  assert.match(site, /key: "adminFactory"[^}]*href: "\/api\/admin\/handoff\?to=\/admin\/factory"/);
});
