// 출시 카드 '검수 페이지'·'검수 대기 N장' 시험: lib/factory/reviewStatus.ts(주소 검사·사설망 거부·토큰 미등록·타임아웃·캐시)와
// 서버 보관 키(secretEntries 의 REVIEW_STATUS_TOKEN_…), 관리자 라우트·카드 코드 검사. 실제 네트워크·DB·키는 쓰지 않는다.
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
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const TOKEN = "review-TOKEN-value-1234567890";
const URL_OK = "https://hancut.buyoungsilcoding.com/admin";

function lib(apps = []) {
  const prisma = { factoryApp: { findMany: async ({ where }) => apps.filter((a) => (where.storeTarget ? a.storeTarget : true) && a.reviewUrl) } };
  return loadTs("lib/factory/reviewStatus.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/secretEntries": { readServerSecret: async () => null },
  });
}
const json = (status, body) => ({ status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const publicDns = async () => ["203.0.113.10"];
const tokens = (map) => async (name) => map[name] ?? null;
const noToken = (s) => assert.ok(!JSON.stringify(s).includes(TOKEN), "토큰이 새어 나옴");

test("토큰 키 이름: 앱 이름을 대문자·_ 로", () => {
  const r = lib();
  assert.equal(r.reviewTokenName("one-tiny-frame"), "REVIEW_STATUS_TOKEN_ONE_TINY_FRAME");
  assert.ok(r.reviewTokenName("a".repeat(40)).length <= 64); // 외부 서비스 키 이름 규칙(64자) 안
});

test("주소 검사: https 만, 비우면 null, 계정 정보·사설망·로컬 거부", () => {
  const r = lib();
  assert.deepEqual(r.checkReviewUrl(URL_OK), { ok: true, value: URL_OK });
  for (const empty of ["", "   ", null, undefined]) assert.deepEqual(r.checkReviewUrl(empty), { ok: true, value: null });
  for (const bad of [
    "http://hancut.buyoungsilcoding.com/admin",
    "ftp://example.com",
    "javascript:alert(1)",
    "hancut.buyoungsilcoding.com",
    "https://user:pw@example.com/",
    "https://127.0.0.1/admin",
    "https://10.1.2.3/",
    "https://192.168.0.5/",
    "https://172.16.0.1/",
    "https://169.254.169.254/latest",
    "https://100.64.0.1/",
    "https://0.0.0.0/",
    "https://[::1]/",
    "https://[fd00::1]/",
    "https://[fe80::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://localhost/",
    "https://app.localhost/",
    "https://nas.local/",
    "https://intranet/",
    `https://example.com/${"a".repeat(300)}`,
    123,
  ]) {
    assert.equal(r.checkReviewUrl(bad).ok, false, String(bad));
  }
  assert.equal(r.isPrivateHost("203.0.113.10"), false);
  assert.equal(r.isPrivateHost("172.32.0.1"), false);
  assert.equal(r.isPrivateHost("8.8.8.8"), false);
});

test("토큰 미등록이면 부르지 않고 no_token", async () => {
  const r = lib();
  let called = 0;
  const s = await r.reviewStatusOf("one-tiny-frame", URL_OK, { readToken: tokens({}), fetchImpl: async () => (called++, json(200, {})), lookupImpl: publicDns });
  assert.deepEqual(s, { state: "no_token" });
  assert.equal(called, 0);
});

test("정상 응답: Bearer 로 그 호스트의 /api/review-status 만 부르고, 리다이렉트는 따라가지 않는다", async () => {
  const r = lib();
  const calls = [];
  const s = await r.reviewStatusOf("one-tiny-frame", URL_OK, {
    readToken: tokens({ REVIEW_STATUS_TOKEN_ONE_TINY_FRAME: TOKEN }),
    lookupImpl: publicDns,
    fetchImpl: async (url, init) => (calls.push({ url, init }), json(200, { review: 3, held: 1, pending: 7, updatedAt: "2026-10-13T01:00:00.000Z" })),
  });
  assert.equal(s.state, "ok");
  assert.equal(s.review, 3);
  assert.equal(s.held, 1);
  assert.equal(s.pending, 7);
  assert.equal(s.updatedAt, "2026-10-13T01:00:00.000Z");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hancut.buyoungsilcoding.com/api/review-status");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].init.redirect, "manual");
  noToken(s);
});

test("실패는 '확인 못 함'(error)으로만: 401·404·500·리다이렉트·형식 오류·연결 실패, 토큰은 결과에 없다", async () => {
  const cases = [
    [json(401, {}), /인증 실패/],
    [json(404, {}), /기능 꺼짐/],
    [json(500, {}), /응답 500/],
    [json(302, ""), /응답 302/],
    [json(200, "<html>"), /형식/],
    [json(200, { review: -1, held: 0, pending: 0 }), /형식/],
    [json(200, { review: 1.5, held: 0, pending: 0 }), /형식/],
    [json(200, { review: "3", held: 0, pending: 0 }), /형식/],
    [json(200, "x".repeat(9000)), /너무 큼/],
  ];
  for (const [res, reason] of cases) {
    const r = lib();
    const s = await r.reviewStatusOf("one-tiny-frame", URL_OK, { readToken: tokens({ REVIEW_STATUS_TOKEN_ONE_TINY_FRAME: TOKEN }), lookupImpl: publicDns, fetchImpl: async () => res });
    assert.equal(s.state, "error");
    assert.match(s.reason, reason);
    noToken(s);
  }
  const r = lib();
  const s = await r.reviewStatusOf("one-tiny-frame", URL_OK, {
    readToken: tokens({ REVIEW_STATUS_TOKEN_ONE_TINY_FRAME: TOKEN }),
    lookupImpl: publicDns,
    fetchImpl: async () => {
      throw new TypeError(`fetch failed ${TOKEN}`);
    },
  });
  assert.deepEqual([s.state, s.reason], ["error", "연결 실패"]);
  noToken(s);
});

test("타임아웃: 응답이 늦거나 DNS 가 늦으면 정해진 시간 안에 '시간 초과'", async () => {
  const r = lib();
  const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const t0 = Date.now();
  const s = await r.reviewStatusOf("one-tiny-frame", URL_OK, { readToken: tokens({ REVIEW_STATUS_TOKEN_ONE_TINY_FRAME: TOKEN }), lookupImpl: publicDns, fetchImpl: hang, timeoutMs: 80 });
  assert.equal(s.state, "error");
  assert.match(s.reason, /시간 초과/);
  assert.ok(Date.now() - t0 < 2000);
  // signal 을 무시하는 fetch 도 경쟁(race)으로 끊는다
  const s2 = await lib().reviewStatusOf("one-tiny-frame", URL_OK, { readToken: tokens({ REVIEW_STATUS_TOKEN_ONE_TINY_FRAME: TOKEN }), lookupImpl: publicDns, fetchImpl: () => new Promise(() => {}), timeoutMs: 80 });
  assert.match(s2.reason, /시간 초과/);
  const s3 = await lib().reviewStatusOf("one-tiny-frame", URL_OK, { readToken: tokens({ REVIEW_STATUS_TOKEN_ONE_TINY_FRAME: TOKEN }), lookupImpl: () => new Promise(() => {}), fetchImpl: async () => json(200, {}), timeoutMs: 80 });
  assert.match(s3.reason, /시간 초과/);
  // 기본값은 3초
  assert.equal(lib().REVIEW_TIMEOUT_MS, 3000);
});

test("사설망 거부: 이름이 사설 IP 로 풀리면 부르지 않는다, 저장된 주소가 사설 IP 여도 부르지 않는다", async () => {
  let called = 0;
  const fetchImpl = async () => (called++, json(200, { review: 1, held: 0, pending: 0 }));
  const readToken = tokens({ REVIEW_STATUS_TOKEN_ONE_TINY_FRAME: TOKEN });
  for (const addrs of [["127.0.0.1"], ["203.0.113.10", "10.0.0.5"], ["::1"], ["192.168.1.2"]]) {
    const s = await lib().reviewStatusOf("one-tiny-frame", URL_OK, { readToken, fetchImpl, lookupImpl: async () => addrs });
    assert.deepEqual(s, { state: "blocked" }, addrs.join(","));
  }
  const s = await lib().reviewStatusOf("one-tiny-frame", "https://192.168.0.10/admin", { readToken, fetchImpl, lookupImpl: publicDns });
  assert.deepEqual(s, { state: "blocked" });
  assert.equal(called, 0);
});

test("60초 캐시: 같은 앱·주소·토큰이면 다시 부르지 않고, 60초가 지나거나 토큰이 바뀌면 새로", async () => {
  const r = lib();
  let now = 1_000_000;
  let called = 0;
  let token = TOKEN;
  const deps = {
    now: () => now,
    readToken: async () => token,
    lookupImpl: publicDns,
    fetchImpl: async () => (called++, json(200, { review: called, held: 0, pending: 0 })),
  };
  assert.equal((await r.reviewStatusOf("one-tiny-frame", URL_OK, deps)).review, 1);
  now += 59_000;
  assert.equal((await r.reviewStatusOf("one-tiny-frame", URL_OK, deps)).review, 1);
  now += 2_000;
  assert.equal((await r.reviewStatusOf("one-tiny-frame", URL_OK, deps)).review, 2);
  token = `${TOKEN}-new`;
  assert.equal((await r.reviewStatusOf("one-tiny-frame", URL_OK, deps)).review, 3);
  assert.equal(called, 3);
});

test("목록: 출시 대상·주소 있는 앱만 병렬로, 앱 하나가 느려도 다른 앱 결과는 나온다", async () => {
  const r = lib([
    { appSlug: "one-tiny-frame", storeTarget: true, reviewUrl: URL_OK },
    { appSlug: "slow-app", storeTarget: true, reviewUrl: "https://slow.example.com/admin" },
    { appSlug: "no-token-app", storeTarget: true, reviewUrl: "https://nt.example.com/" },
    { appSlug: "not-target", storeTarget: false, reviewUrl: "https://x.example.com/" },
  ]);
  const t0 = Date.now();
  const rows = await r.reviewStatusList({
    timeoutMs: 150,
    lookupImpl: publicDns,
    readToken: tokens({ REVIEW_STATUS_TOKEN_ONE_TINY_FRAME: TOKEN, REVIEW_STATUS_TOKEN_SLOW_APP: TOKEN }),
    fetchImpl: (url) => (url.includes("slow") ? new Promise(() => {}) : Promise.resolve(json(200, { review: 2, held: 0, pending: 0 }))),
  });
  assert.ok(Date.now() - t0 < 1000); // 병렬: 느린 앱 하나의 타임아웃만큼
  assert.deepEqual(
    rows.map((x) => [x.appSlug, x.status.state, x.tokenName]),
    [
      ["one-tiny-frame", "ok", "REVIEW_STATUS_TOKEN_ONE_TINY_FRAME"],
      ["slow-app", "error", "REVIEW_STATUS_TOKEN_SLOW_APP"],
      ["no-token-app", "no_token", "REVIEW_STATUS_TOKEN_NO_TOKEN_APP"],
    ],
  );
  noToken(rows);
});

// ───────── 서버 보관 키(외부 서비스 키 REVIEW_STATUS_TOKEN_…) ─────────

function secretsServer() {
  process.env.FACTORY_SECRET_KEY = "test-factory-secret-key-0123456789";
  const entries = new Map();
  const names = new Map();
  const match = (row, where = {}) =>
    where.OR ? where.OR.some((w) => match(row, w)) : Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "not" in v ? row[k] !== v.not : row[k] === v));
  const prisma = {
    factorySecretEntry: {
      findUnique: async ({ where }) => (entries.has(where.name) ? { ...entries.get(where.name) } : null),
      count: async (q = {}) => [...entries.values()].filter((r) => match(r, q.where)).length,
      findMany: async (q = {}) => [...entries.values()].filter((r) => match(r, q.where)).map((r) => ({ ...r })),
      upsert: async ({ where, create, update }) => {
        const cur = entries.get(where.name);
        if (cur) {
          for (const [k, v] of Object.entries(update)) cur[k] = v && typeof v === "object" && "increment" in v ? cur[k] + v.increment : v;
          cur.updatedAt = new Date();
          return cur;
        }
        const row = { description: "", sealed: null, version: 1, status: "pending", storedAt: null, updatedAt: new Date(), ...create };
        entries.set(where.name, row);
        return row;
      },
      updateMany: async () => ({ count: 0 }),
      deleteMany: async ({ where }) => {
        let count = 0;
        for (const [k, r] of entries) if (match(r, where)) (entries.delete(k), count++);
        return { count };
      },
    },
    factorySecretName: {
      findUnique: async ({ where }) => names.get(where.name) ?? null,
      findMany: async () => [...names.values()],
      upsert: async ({ where, create }) => (names.has(where.name) ? names.get(where.name) : (names.set(where.name, { createdAt: new Date(), ...create }), create)),
    },
  };
  const db = { __esModule: true, default: prisma };
  const keyPasswords = loadTs("lib/factory/keyPasswords.ts", { "@/lib/prisma": db });
  const secrets = loadTs("lib/factory/secretEntries.ts", {
    "@/lib/prisma": db,
    "@/lib/factory/keyPasswords": keyPasswords,
    "@/lib/factory/settings": { getSettingValue: async () => null, setSettingValue: async () => {} },
  });
  return { secrets, entries, names };
}

test("서버 보관 키: 등록하면 바로 저장됨, PC 로 보내지 않고, 서버 안에서만 풀 수 있다", async () => {
  const { secrets, entries, names } = secretsServer();
  const r = await secrets.registerSecretEntry("REVIEW_STATUS_TOKEN_ONE_TINY_FRAME", "한 컷 검수 상태", TOKEN);
  assert.equal(r.ok, true);
  noToken(r);
  const row = entries.get("REVIEW_STATUS_TOKEN_ONE_TINY_FRAME");
  assert.equal(row.status, "stored");
  assert.ok(row.sealed && !row.sealed.includes(TOKEN)); // 암호문만
  assert.equal(names.size, 0); // 앱 일감용 이름 카탈로그에는 넣지 않는다
  assert.equal(await secrets.secretEntriesPending(), false);
  assert.deepEqual(await secrets.pendingSecretEntries(), []); // PC 로 안 감
  // PC 가 확인(ack)을 보내도 암호문은 그대로
  await secrets.ackSecretEntries([{ name: "REVIEW_STATUS_TOKEN_ONE_TINY_FRAME", version: 1, action: "store" }]);
  assert.ok(row.sealed);
  assert.equal(await secrets.readServerSecret("REVIEW_STATUS_TOKEN_ONE_TINY_FRAME"), TOKEN);
  assert.equal(await secrets.readServerSecret("PIXELLAB_TOKEN"), null); // 일반 키는 서버에서 읽지 않는다
  const view = await secrets.secretEntryStatuses();
  assert.deepEqual(view.items.map((i) => [i.name, i.state]), [["REVIEW_STATUS_TOKEN_ONE_TINY_FRAME", "server"]]);
  noToken(view);
  assert.ok(!JSON.stringify(view).includes("v1:")); // 암호문도 안 나감
  assert.equal((await secrets.knownSecretNames()).length, 0);
  // 교체 → version 증가, 삭제는 PC 를 거치지 않고 바로
  const again = await secrets.registerSecretEntry("REVIEW_STATUS_TOKEN_ONE_TINY_FRAME", "", `${TOKEN}-2`);
  assert.equal(again.replaced, true);
  assert.equal(row.version, 2);
  assert.equal(await secrets.readServerSecret("REVIEW_STATUS_TOKEN_ONE_TINY_FRAME"), `${TOKEN}-2`);
  assert.equal((await secrets.requestSecretDelete("REVIEW_STATUS_TOKEN_ONE_TINY_FRAME")).ok, true);
  assert.equal(entries.size, 0);
  assert.equal(await secrets.readServerSecret("REVIEW_STATUS_TOKEN_ONE_TINY_FRAME"), null);
  assert.equal((await secrets.requestSecretDelete("REVIEW_STATUS_TOKEN_ONE_TINY_FRAME")).status, 404);
});

// ───────── 코드 검사: 관리자만, 토큰은 브라우저로 안 감, 공개 프로젝트 카드는 그대로 ─────────

test("라우트·카드: 관리자만 부르고, 응답·로그·카드 코드에 토큰 값이 없다", () => {
  const route = fs.readFileSync(path.join(repo, "app/api/admin/factory/review-status/route.ts"), "utf8");
  assert.match(route, /const denied = await requireAdmin\(\);\s+if \(denied\) return denied;/);
  for (const line of route.split("\n").filter((l) => /console\./.test(l))) assert.ok(!/error\)|token|status/i.test(line), line);
  const box = fs.readFileSync(path.join(repo, "components/admin/factory/ReviewBox.tsx"), "utf8");
  const panel = fs.readFileSync(path.join(repo, "components/admin/factory/ReleasePanel.tsx"), "utf8");
  for (const src of [box, panel]) assert.ok(!/readServerSecret|Authorization|Bearer/.test(src)); // 브라우저 코드는 토큰을 모른다
  assert.match(panel, /\/api\/admin\/factory\/review-status/);
  assert.match(box, /target="_blank"/);
  assert.match(box, /rel="noopener noreferrer"/);
  assert.match(box, /토큰 미등록/);
  assert.match(box, /확인 못 함/);
  // 예시 주소는 안내 문구에만(자동 입력 없음)
  assert.ok(!/useState\([^)]*hancut/.test(box));
  // reviewStatus 모듈은 관리자 라우트에서만 쓴다(공개 화면·공개 API 에서 import 하지 않음)
  const users = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /@\/lib\/factory\/reviewStatus/.test(fs.readFileSync(p, "utf8"))) users.push(path.relative(repo, p).replace(/\\/g, "/"));
    }
  };
  walk(path.join(repo, "app"));
  walk(path.join(repo, "components"));
  assert.deepEqual(users, ["app/api/admin/factory/review-status/route.ts"]);
});
