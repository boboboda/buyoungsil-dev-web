// 관리자 '가입자 명단' 시험: lib/admin/members.ts(주소 값 검사·조건·쪽 나누기·요약) + /api/admin/users(관리자만·no-store·400)
// + /admin/users 화면(관리자 관문·표/카드·빈 결과) + 민감 필드(비밀번호 해시·토큰·세션 버전)가 select·응답·화면 어디에도 없는지.
// 가짜 DB(메모리, Prisma where 를 흉내)로 돌린다. 실제 DB·네트워크는 쓰지 않는다.
// 실행: npm run test:admin-users  (npm run test:access-control 에도 묶여 있다)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { NextRequest, NextResponse } = require("next/server");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

// ── 가짜 회원 30명 + cuid 가 아닌 옛 관리자 1명 ──
const NOW = Date.UTC(2026, 9, 14, 3, 0, 0); // 2026-10-14(수) 12:00 KST
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const cuidAt = (ms, i) => `c${ms.toString(36)}${String(i).padStart(4, "0")}${"k".repeat(12)}`;
const SECRET = "SECRET-DO-NOT-LEAK";
// 가입 시각: 0=1시간 전(오늘), 1=어제 KST, 2=이번 주 월요일, 3=지난주, 그 뒤로 4일 간격
const joinedAt = (i) => [NOW - HOUR, NOW - DAY, Date.UTC(2026, 9, 12, 1, 0, 0), Date.UTC(2026, 9, 10, 1, 0, 0)][i] ?? NOW - (4 + i * 4) * DAY;
const users = Array.from({ length: 30 }, (_, i) => {
  const kind = i % 4; // 0 이메일, 1 Google, 2 GitHub, 3 이메일+Google
  return {
    id: cuidAt(joinedAt(i), i),
    name: i === 5 ? "김철수" : `회원${String(i).padStart(2, "0")}`,
    email: i === 5 ? "Chulsoo.Kim@Example.com" : `member${i}@test.dev`,
    emailVerified: null,
    image: `https://img.example/${i}.png`,
    password: kind === 0 || kind === 3 ? `$2a$10$${SECRET}${i}` : null,
    role: i === 0 ? "admin" : i === 7 ? null : i === 9 ? "supporter" : "user",
    sessionVersion: 42,
    accounts: [
      ...(kind === 1 || kind === 3 ? [{ provider: "google", access_token: `ya29.${SECRET}`, refresh_token: SECRET, id_token: SECRET }] : []),
      ...(kind === 2 ? [{ provider: "github", access_token: `gho_${SECRET}`, refresh_token: null, id_token: null }] : []),
    ],
    sessions: [{ sessionToken: SECRET }],
  };
});
// cuid 가 아닌 id(옛 수동 입력 등)는 가입일 "-", 순서는 id 문자열 순(여기서는 맨 뒤)
users.push({ id: "admin-seed-1", name: "옛 관리자", email: "old@test.dev", password: `$2a$10$${SECRET}`, role: "admin", sessionVersion: 1, accounts: [], sessions: [] });

// ── 가짜 Prisma: 이 화면이 쓰는 where 만 흉내(모르는 조건이면 실패시켜 놓치지 않게) ──
function match(row, where) {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "AND") {
      if (!cond.every((c) => match(row, c))) return false;
    } else if (key === "OR") {
      if (!cond.some((c) => match(row, c))) return false;
    } else if (key === "accounts") {
      if (!row.accounts.some((a) => match(a, cond.some))) return false;
    } else if (cond === null || typeof cond !== "object") {
      if ((row[key] ?? null) !== cond) return false;
    } else {
      const v = row[key] ?? null;
      for (const [op, x] of Object.entries(cond)) {
        if (op === "mode") continue;
        // SQL 처럼: <> 와 LIKE 는 NULL 을 빼고, 문자열 비교는 같은 길이의 소문자·숫자라 JS 비교와 같다
        const ok = {
          not: () => (x === null ? v !== null : v !== null && v !== x),
          contains: () => v !== null && (cond.mode === "insensitive" ? v.toLowerCase().includes(x.toLowerCase()) : v.includes(x)),
          gte: () => v !== null && v >= x,
          lt: () => v !== null && v < x,
          in: () => x.includes(v),
        }[op];
        if (!ok) throw new Error(`가짜 DB 가 모르는 조건: ${key}.${op}`);
        if (!ok()) return false;
      }
    }
  }
  return true;
}
function project(row, select) {
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, on]) => on)
      .map(([k, on]) => [k, on === true ? row[k] : row[k].map((r) => project(r, on.select))]),
  );
}
const selects = [];
let failCount = null; // 이 where 가 들어오면 count 가 실패(요약 한 칸만 비는지)
const db = {
  user: {
    count: async (args = {}) => {
      if (failCount && JSON.stringify(args.where ?? null) === JSON.stringify(failCount)) throw new Error(`연결 끊김 ${SECRET}`);
      return users.filter((u) => match(u, args.where)).length;
    },
    findMany: async (args = {}) => {
      assert.ok(args.select, "findMany 는 반드시 select 로 열을 지정해야 함(통째로 읽기 금지)");
      selects.push(args.select);
      let list = users.filter((u) => match(u, args.where));
      if (args.orderBy) {
        assert.deepEqual(args.orderBy, { id: "desc" });
        list = list.sort((a, b) => (a.id < b.id ? 1 : -1));
      }
      list = list.slice(args.skip ?? 0);
      if (args.take !== undefined) list = list.slice(0, args.take);
      return list.map((u) => project(u, args.select));
    },
  },
};

const members = loadTs("lib/admin/members.ts");
const q = (o = {}) => {
  const r = members.parseMemberQuery((k) => o[k] ?? null);
  assert.ok(r.query, r.error);
  return r.query;
};
const SENSITIVE = /SECRET|password|\$2a\$|access_token|refresh_token|id_token|sessionVersion|sessionToken|ya29|gho_/;

test("주소 값 검사: 기본값, limit 은 100 으로 묶고, 틀린 값은 오류(→ 400)", () => {
  assert.deepEqual(q(), { q: "", role: "", method: "", page: 1, limit: 25 });
  assert.deepEqual(q({ q: "  김  ", role: "admin", method: "google", page: "3", limit: "50" }), { q: "김", role: "admin", method: "google", page: 3, limit: 50 });
  assert.equal(q({ limit: "1000" }).limit, 100);
  for (const bad of [{ role: "root" }, { method: "kakao" }, { page: "0" }, { page: "-1" }, { page: "1.5" }, { page: "abc" }, { limit: "0" }, { limit: "x" }, { q: "가".repeat(101) }]) {
    const r = members.parseMemberQuery((k) => bad[k] ?? null);
    assert.ok(r.error && !r.query, JSON.stringify(bad));
  }
});

test("가입 시각은 cuid 에서: 한국 시간 오늘·이번 주(월)·이번 달 시작, cuid 가 아니면 null", () => {
  assert.equal(members.joinedAtFromId(users[3].id, NOW), Date.UTC(2026, 9, 10, 1, 0, 0));
  assert.equal(members.joinedAtFromId("admin-seed-1", NOW), null);
  assert.equal(members.joinedAtFromId(`c${"0".repeat(24)}`, NOW), null); // 1970 년
  const s = members.kstPeriodStarts(NOW);
  assert.equal(new Date(s.today).toISOString(), "2026-10-13T15:00:00.000Z"); // 10/14 00:00 KST
  assert.equal(new Date(s.week).toISOString(), "2026-10-11T15:00:00.000Z"); // 10/12(월) 00:00 KST
  assert.equal(new Date(s.month).toISOString(), "2026-09-30T15:00:00.000Z"); // 10/1 00:00 KST
});

test("목록: 최신 가입순 25개씩(25 + 6), 겹침·빠짐 없음, 가입 방식·권한·가입일", async () => {
  const p1 = await members.listMembers(db, q(), NOW);
  const p2 = await members.listMembers(db, q({ page: "2" }), NOW);
  assert.deepEqual([p1.items.length, p2.items.length, p1.total, p1.pages, p2.page], [25, 6, 31, 2, 2]);
  const ids = [...p1.items, ...p2.items].map((m) => m.id);
  assert.equal(new Set(ids).size, 31);
  assert.equal(ids[0], users[0].id, "가장 최근 가입자가 맨 위");
  const joined = [...p1.items, ...p2.items].map((m) => m.joinedAt).filter(Boolean);
  assert.deepEqual(joined, [...joined].sort().reverse(), "가입일 내림차순");
  const by = Object.fromEntries([...p1.items, ...p2.items].map((m) => [m.id, m]));
  assert.deepEqual(by[users[0].id], { id: users[0].id, name: "회원00", email: "member0@test.dev", role: "admin", methods: ["email"], joinedAt: new Date(NOW - HOUR).toISOString() });
  assert.deepEqual(by[users[3].id].methods, ["email", "google"]);
  assert.deepEqual(by[users[2].id].methods, ["github"]);
  assert.equal(by[users[7].id].role, "user", "role 이 비어 있으면 회원");
  assert.equal(by[users[9].id].role, "user", "예전 값(supporter)도 회원");
  assert.equal(by["admin-seed-1"].joinedAt, null);
  assert.equal(ids.at(-1), "admin-seed-1");
  assert.equal((await members.listMembers(db, q({ page: "9" }), NOW)).items.length, 0);
  assert.equal((await members.listMembers(db, q({ limit: "100" }), NOW)).items.length, 31);
});

test("검색(이름·이메일, 대소문자 무시)·권한·가입 방식 필터, 따옴표·SQL 같은 검색어도 그냥 글자로", async () => {
  const names = async (o) => (await members.listMembers(db, q({ limit: "100", ...o }), NOW)).items.map((m) => m.name);
  assert.deepEqual(await names({ q: "철수" }), ["김철수"]);
  assert.deepEqual(await names({ q: "chulsoo.kim@example" }), ["김철수"]);
  assert.equal((await names({ q: "member1" })).length, 11); // member1, member10~19
  assert.deepEqual((await names({ role: "admin" })).sort(), ["옛 관리자", "회원00"]);
  assert.equal((await names({ role: "user" })).length, 29);
  assert.equal((await names({ method: "email" })).length, 16); // 이메일 8 + 이메일+Google 7 + 옛 관리자
  assert.equal((await names({ method: "google" })).length, 15);
  assert.equal((await names({ method: "github" })).length, 7);
  assert.deepEqual(await names({ q: "회원0", role: "admin", method: "email" }), ["회원00"]);
  const injected = await members.listMembers(db, q({ q: `'; DROP TABLE "User"; --` }), NOW);
  assert.deepEqual([injected.total, injected.items.length], [0, 0]);
  // 검색어는 Prisma contains 값으로만 들어간다(문자열을 이어 붙인 SQL 없음)
  assert.deepEqual(members.memberWhere({ q: "a'b", role: "", method: "" }), {
    AND: [{ OR: [{ name: { contains: "a'b", mode: "insensitive" } }, { email: { contains: "a'b", mode: "insensitive" } }] }],
  });
  assert.doesNotMatch(read("lib/admin/members.ts"), /\$queryRaw|\$executeRaw/);
});

test("요약: 전체(홈 카드와 같은 기준)·오늘/이번 주/이번 달 신규·방식별·권한별, 실패한 칸만 null", async () => {
  const s = await members.memberSummary(db, NOW);
  assert.deepEqual(s, { total: 31, today: 1, week: 3, month: 4, byMethod: { email: 16, google: 15, github: 7 }, byRole: { admin: 2, user: 29 } });
  // 홈 '가입자' 카드처럼 조건 없는 user.count()
  assert.match(read("lib/admin/members.ts"), /count\(\), \/\/ 홈 '가입자' 카드와 같은 기준/);
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.join(" "));
  try {
    failCount = { role: "admin" };
    const f = await members.memberSummary(db, NOW);
    assert.equal(f.byRole.admin, null);
    assert.equal(f.total, 31);
  } finally {
    console.error = orig;
    failCount = null;
  }
  assert.ok(logs.length && logs.every((l) => !l.includes(SECRET)), "로그에 오류 내용(개인정보가 섞일 수 있는)을 남기지 않음");
});

test("민감 필드: select 에 비밀번호·토큰·세션이 없고, 결과에도 없다", async () => {
  selects.length = 0;
  const page = await members.listMembers(db, q({ limit: "100" }), NOW);
  assert.ok(selects.length >= 2);
  for (const s of selects) {
    const keys = JSON.stringify(s);
    assert.doesNotMatch(keys, /password|sessionVersion|sessions|token|session_state|image|emailVerified/, keys);
  }
  assert.doesNotMatch(JSON.stringify(page), SENSITIVE);
});

// ── API: 비로그인·일반 회원·관리자 (관문은 실제 lib/auth/requireAdmin.ts) ──
let session = null;
const getSession = { auth: async () => session };
const factoryAdmin = loadTs("lib/auth/requireAdmin.ts", { "@/lib/auth/get-sesstion": getSession });
const route = loadTs("app/api/admin/users/route.ts", {
  "@/lib/prisma": { __esModule: true, default: db },
  "@/lib/auth/requireAdmin": factoryAdmin,
  "@/lib/admin/members": members,
});
const get = (qs = "") => route.GET(new NextRequest(`http://localhost/api/admin/users${qs ? `?${qs}` : ""}`));
const VISITORS = { 비로그인: null, 일반회원: { user: { id: "u1", role: "user", email: "member1@test.dev" } }, 관리자: { user: { id: "a1", role: "admin" } } };

test("API 접근: 비로그인·일반 회원 403(목록 없음), 관리자 200 · 모두 no-store", async () => {
  for (const [who, s] of Object.entries(VISITORS)) {
    session = s;
    const res = await get();
    assert.equal(res.headers.get("cache-control"), "no-store", who);
    const body = await res.json();
    if (who === "관리자") {
      assert.equal(res.status, 200);
      assert.deepEqual([body.items.length, body.total, body.pages, body.summary.total], [25, 31, 2, 31]);
    } else {
      assert.equal(res.status, 403, who);
      assert.equal(body.items, undefined);
      assert.doesNotMatch(JSON.stringify(body), /@test\.dev/);
    }
  }
  assert.equal(route.dynamic, "force-dynamic");
});

test("API 값: 잘못된 값 400, limit 상한 100, 검색·필터, 응답에 민감 필드 없음", async () => {
  session = VISITORS.관리자;
  for (const qs of ["role=root", "method=kakao", "page=0", "limit=abc", `q=${"x".repeat(101)}`]) {
    const res = await get(qs);
    assert.equal(res.status, 400, qs);
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  const big = await (await get("limit=500")).json();
  assert.deepEqual([big.limit, big.items.length], [100, 31]);
  const found = await (await get(`q=${encodeURIComponent("철수")}&role=user&method=google`)).json();
  assert.deepEqual(found.items.map((m) => m.name), ["김철수"]);
  const text = JSON.stringify(big);
  assert.doesNotMatch(text, SENSITIVE);
  assert.ok(!fs.existsSync(path.join(repo, "app/api/users")), "공개 /api/users 는 다시 만들지 않음");
});

// ── 화면 ──
const link = { __esModule: true, default: ({ href, children, ...rest }) => h("a", { href, ...rest }, children) };
const view = loadTs("components/admin/users/MembersView.tsx", {
  "next/link": link,
  "@/components/admin/ui/meters": loadTs("components/admin/ui/meters.tsx"),
  "@/lib/admin/members": members,
});
const redirected = (url) => Object.assign(new Error(`REDIRECT ${url}`), { url });
const page = loadTs("app/admin/users/page.tsx", {
  "next/navigation": { redirect: (url) => { throw redirected(url); } },
  "@/components/admin/users/MembersView": view,
  "@/lib/auth/get-sesstion": getSession,
  "@/lib/prisma": { __esModule: true, default: db },
  "@/lib/admin/members": members,
});
const openPage = async (sp = {}) => renderToStaticMarkup(await page.default({ searchParams: Promise.resolve(sp) }));

test("화면 접근: 비로그인 → 로그인 화면, 일반 회원 → 홈, 관리자만 명단 (미들웨어도 /admin/:path* 를 막음)", async () => {
  session = VISITORS.비로그인;
  await assert.rejects(openPage(), (e) => e.url === "/signin");
  session = VISITORS.일반회원;
  await assert.rejects(openPage(), (e) => e.url === "/");
  session = VISITORS.관리자;
  assert.match(await openPage(), /가입자 명단/);
  const mw = read("middleware.ts");
  assert.match(mw, /"\/admin\/:path\*"/);
  assert.match(mw, /pathname\.startsWith\("\/admin"\)[\s\S]*?redirect\(new URL\("\/signin"[\s\S]*?session\.role !== "admin"/);
});

test("화면: 요약·표(넓은 화면)·카드(좁은 화면) 25명씩·쪽 이동 링크·검색 칸, 민감 필드 없음", async () => {
  session = VISITORS.관리자;
  const html = await openPage();
  assert.equal((html.match(/data-member-row=""/g) ?? []).length, 25);
  assert.equal((html.match(/data-member-card=""/g) ?? []).length, 25);
  assert.match(html, /class="hidden overflow-x-auto md:block"/);
  assert.match(html, /class="grid gap-2 md:hidden"/);
  for (const t of ["전체 가입자", "오늘 신규", "이번 주 신규", "이번 달 신규"]) assert.match(html, new RegExp(`data-stat="${t}"`));
  assert.match(html, /이메일 16 · Google 15 · GitHub 7/);
  assert.match(html, /관리자 2 · 회원 29/);
  assert.match(html, /1 \/ 2쪽/);
  assert.match(html, /<a href="\/admin\/users\?page=2"[^>]*rel="next"/);
  assert.match(html, /name="q"/);
  assert.match(html, /member0@test\.dev/);
  assert.match(html, /이메일 · Google/);
  assert.match(html, /▲ 관리자/);
  assert.doesNotMatch(html, SENSITIVE);
  assert.doesNotMatch(html, /최근 로그인<\/th>/, "기록이 없는 열은 만들지 않음");

  const p2 = await openPage({ page: "2", q: "회원", role: "user" });
  assert.match(p2, /<a href="\/admin\/users\?q=%ED%9A%8C%EC%9B%90&amp;role=user"[^>]*rel="prev"/);
});

test("화면: 빈 결과·0명·잘못된 값·DB 실패 안내", async () => {
  session = VISITORS.관리자;
  assert.match(await openPage({ q: "없는사람" }), /조건에 맞는 가입자가 없어요/);
  assert.match(await openPage({ role: "root" }), /role="alert"[^>]*>✕ 권한은 admin \| user 중 하나예요/);
  const empty = renderToStaticMarkup(h(view.default, { summary: { total: 0, today: 0, week: 0, month: 0, byMethod: { email: 0, google: 0, github: 0 }, byRole: { admin: 0, user: 0 } }, list: { items: [], total: 0, page: 1, pages: 1, limit: 25 } }));
  assert.match(empty, /아직 가입자가 없어요/);
  assert.doesNotMatch(empty, /rel="next"/);
  const down = renderToStaticMarkup(h(view.default, { summary: null, list: null }));
  assert.match(down, /가입자 목록을 읽지 못했어요/);
  assert.match(down, /data-stat="전체 가입자"[\s\S]*?>-</);
});

test("관리자 메뉴·상단바에 '가입자'(/admin/users), 지금 위치 강조", () => {
  const site = loadTs("config/site.ts");
  assert.ok(site.siteConfig.adminNavItems.some((i) => i.key === "adminUsers" && i.href === "/admin/users" && i.short === "가입자"));
  const top = loadTs("components/admin/ui/AdminTopBar.tsx", {
    "next/link": link,
    "next/navigation": { usePathname: () => "/admin/users", useRouter: () => ({}) },
    "next-auth/react": { signOut: () => {}, useSession: () => ({ data: null }) },
    "@/app/hooks/auth/useIdleLogout": { useIdleLogout: () => ({ remainingSeconds: null }) },
    "@/components/admin/ui/meters": {},
    "@/config/site": site,
  });
  const html = renderToStaticMarkup(h(top.AdminTopBarView, { pathname: "/admin/users", clock: "12:00", account: null }));
  assert.match(html, /href="\/admin\/users" aria-current="page" class="fx-topbar-link">가입자</);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
});
