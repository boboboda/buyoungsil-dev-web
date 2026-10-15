// 공용 스튜디오 [운영] 탭(3-3) 시험: 검수 행동(승인·반려·되돌림·다시 요청·기본 그림, 일괄), 내보내기 일감 생성(목록·지시문·기록·중복·미지원), 서비스 API 연결(가짜 서버), 생성 일정(시각·하루 한 번·한도), 화면.
// 실행: npm run test:studio-ops   (가짜 DB·로그인·가짜 서버, react-dom/server 로 그린다. 실제 DB·키·외부 네트워크 없음)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");

const cache = new Map();
function resolveSource(name) {
  const base = name.startsWith("@/") ? name.slice(2) : name;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (fs.existsSync(path.join(repo, base + ext))) return base + ext;
  throw new Error(`못 찾음: ${name}`);
}
function load(rel, overrides = {}) {
  const useCache = Object.keys(overrides).length === 0;
  if (useCache && cache.has(rel)) return cache.get(rel);
  const output = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const req = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith("@/")) return load(resolveSource(name), overrides);
    return require(name);
  };
  new Function("require", "module", "exports", output)(req, module, module.exports);
  if (useCache) cache.set(rel, module.exports);
  return module.exports;
}

const ops = load("lib/studio/ops.ts");
const service = load("lib/studio/service.ts", { "@/lib/factory/reviewStatus": { isPrivateHost: load("lib/factory/reviewStatus.ts", { "@/lib/prisma": { __esModule: true, default: {} }, "@/lib/factory/secretEntries": { readServerSecret: async () => null } }).isPrivateHost } });
const SECRET = "tok-super-secret-value-1234567890";

const A = (id, extra = {}) => ({ id, appSlug: "one-tiny-frame", subject: "싹이", kind: "image-prop", status: "candidate", url: `https://img.example/${id}.png`, method: "pixellab", summary: null, jobId: "job1", createdAt: "2026-10-14T01:00:00.000Z", decidedBy: "", decidedAt: null, note: "", cardId: "c1", cardVersion: 2, ...extra });
const ALIASES = { 싹이: ["감자", "ssagi"] };

// ───────── 계산: 검수함 ─────────

test("검수 필터: 카드별·대상별(별칭은 대표 이름으로)·종류별·상태별, 새 것이 먼저", () => {
  const arts = [A("a1"), A("a2", { subject: "감자", createdAt: "2026-10-14T03:00:00.000Z" }), A("a3", { subject: "나무", kind: "image-scene", cardId: "c2" }), A("a4", { cardId: null, status: "approved" })];

  assert.deepEqual(ops.filterArts(arts, { subject: "싹이" }, ALIASES).map((a) => a.id), ["a2", "a1", "a4"], "감자·ssagi 는 싹이로 묶인다, 새 것 먼저");
  assert.deepEqual(ops.filterArts(arts, { cardId: "c2" }, ALIASES).map((a) => a.id), ["a3"]);
  assert.deepEqual(ops.filterArts(arts, { cardId: ops.NO_CARD }, ALIASES).map((a) => a.id), ["a4"]);
  assert.deepEqual(ops.filterArts(arts, { kind: "image-scene" }, ALIASES).map((a) => a.id), ["a3"]);
  assert.deepEqual(ops.filterArts(arts, { status: "approved" }, ALIASES).map((a) => a.id), ["a4"]);
  assert.equal(ops.filterArts(arts, {}, ALIASES).length, 4);
  const c = ops.filterChoices(arts, new Map([["c1", "싹이 짤"], ["c2", "소품"]]), ALIASES);

  assert.deepEqual(c.subjects.map((s) => [s.name, s.count]), [["나무", 1], ["싹이", 3]]);
  assert.ok(c.cards.some((x) => x.id === ops.NO_CARD && x.count === 1));
});

test("일괄 고르기: 문자열 id 만, 중복 제거, 비었거나 50장 넘으면 거절", () => {
  assert.deepEqual(ops.pickIds(["a", "a", 3, "b c", "b"]), { ok: true, ids: ["a", "b"] });
  assert.equal(ops.pickIds([]).ok, false);
  assert.equal(ops.pickIds("x").ok, false);
  assert.equal(ops.pickIds(Array.from({ length: 51 }, (_, i) => `a${i}`)).ok, false);
  assert.equal(ops.pickIds(Array.from({ length: 50 }, (_, i) => `a${i}`)).ok, true);
});

test("다시 요청 묶기: 같은 카드·같은 대상이면 한 일감(장 수 = 그림 수, 8장씩), 카드 없는 그림은 건너뜀", () => {
  const g = ops.redoGroups([A("a1"), A("a2"), A("a3", { subject: "나무" }), A("a4", { cardId: null }), A("a5", { cardId: "c2" })]);

  assert.deepEqual(g.groups.map((x) => [x.cardId, x.subject, x.count]), [["c1", "싹이", 2], ["c1", "나무", 1], ["c2", "싹이", 1]]);
  assert.deepEqual(g.skipped, ["a4"]);
  const many = ops.redoGroups(Array.from({ length: 10 }, (_, i) => A(`m${i}`)));

  assert.deepEqual(many.groups.map((x) => x.count), [8, 2], "한 일감 장 수 상한 8");
});

test("보관함: 승인 그림만 대상(별칭 포함)별, 사용 이력은 만든 카드(판)·승인·내보낸 곳·참고 사용 순", () => {
  const arts = [A("a1", { status: "approved", decidedAt: "2026-10-14T05:00:00.000Z", decidedBy: "관리자" }), A("a2", { subject: "감자", status: "approved", decidedAt: "2026-10-14T06:00:00.000Z" }), A("a3"), A("a4", { status: "rejected" })];
  const groups = ops.archiveGroups(arts, ALIASES);

  assert.deepEqual(groups.map((g) => [g.subject, g.arts.map((a) => a.id)]), [["싹이", ["a2", "a1"]]], "후보·반려는 없고 새 승인이 먼저");
  const ev = ops.usageHistory({
    art: arts[0],
    cardName: "싹이 단독 짤",
    exports: [{ id: "e1", artId: "a1", kind: "folder", status: "done", jobId: "j9", dest: "assets/sprites/싹이-a1.png", note: "", who: "관리자", createdAt: "2026-10-14T07:00:00.000Z" }],
    usedAsRefIn: [{ jobId: "j8", title: "나무 1장", at: "2026-10-14T08:00:00.000Z" }],
  });

  assert.match(ev[0].text, /싹이 단독 짤.*판 2/);
  assert.match(ev[1].text, /승인 \(관리자\)/);
  assert.match(ev[2].text, /앱 폴더로 내보냄.*보냄.*assets\/sprites/);
  assert.match(ev[3].text, /참고 그림으로 골라 쓴 일감: 나무 1장/);
  assert.match(ops.usageHistory({ art: A("x", { cardId: null, jobId: null }), cardName: "", exports: [] })[0].text, /처음 값/);
});

// ───────── 계산: 내보내기 ─────────

test("내보내기 목록: 승인 그림만, 경로+이름, 겹치는 이름·이상한 주소는 제외, 지시문에 빌드만·e2e 없음", () => {
  const arts = [A("abcdef123456", { status: "approved" }), A("zzz999", { status: "approved", subject: "큰 나무!", url: "https://img.example/x.gif?v=1" }), A("cand01"), A("bad001", { status: "approved", url: "javascript:alert(1)" })];
  const { items, skipped } = ops.buildExportItems(arts, "assets/sprites/");

  assert.deepEqual(items.map((i) => i.path), ["assets/sprites/싹이-123456.png", "assets/sprites/큰-나무-zz9999.gif".replace("zz9999", "zzz999".slice(-6))]);
  assert.deepEqual(skipped.map((s) => s.artId), ["cand01", "bad001"]);
  const plan = ops.buildExportPlan("one-tiny-frame", items);

  assert.ok(plan.length >= 50);
  assert.match(plan, /그림 2장을 앱 폴더에 넣기/);
  assert.match(plan, /받을 주소: https:\/\/img\.example\/abcdef123456\.png\n\s+넣을 곳: assets\/sprites\/싹이-123456\.png/);
  assert.match(plan, /e2e 스크린샷은 찍지 않습니다. 검사는 빌드만 합니다/);
  assert.match(plan, /덮어쓰지 말고/);
  assert.equal(ops.artExtension("https://x/y.JPEG"), "jpg");
  assert.equal(ops.artExtension("https://x/y"), "png");
  const dup = ops.buildExportItems([A("aaaaaa", { status: "approved" }), A("zaaaaaa", { status: "approved" })], "a");

  assert.equal(dup.items.length, 1, "같은 파일 이름은 하나만");
});

// ───────── 계산: 생성 일정 ─────────

const kst = (y, mo, d, hh, mm = 0) => Date.UTC(y, mo - 1, d, hh - 9, mm);

test("일정 시각: 한국 시간 기준 날짜·시, 시각이 지나고 오늘 안 만들었을 때만 차례, 늦게 깨어나도 같은 날 안에 한 번", () => {
  assert.deepEqual(ops.kstNow(kst(2026, 10, 15, 0, 30)), { key: "2026-10-15", hour: 0 });
  assert.deepEqual(ops.kstNow(Date.UTC(2026, 9, 14, 15, 0)), { key: "2026-10-15", hour: 0 }, "UTC 15시 = 한국 다음 날 0시");
  const s = { enabled: true, hour: 9, count: 1, subjects: "싹이", extra: "", lastRunKey: "" };

  assert.equal(ops.isDue(s, kst(2026, 10, 15, 8, 59)), false);
  assert.equal(ops.isDue(s, kst(2026, 10, 15, 9, 0)), true);
  assert.equal(ops.isDue(s, kst(2026, 10, 15, 23, 59)), true, "늦게 확인돼도 같은 날");
  assert.equal(ops.isDue({ ...s, lastRunKey: "2026-10-15" }, kst(2026, 10, 15, 12)), false, "오늘 이미 만들었음");
  assert.equal(ops.isDue({ ...s, lastRunKey: "2026-10-15" }, kst(2026, 10, 16, 9)), true, "다음 날");
  assert.equal(ops.isDue({ ...s, enabled: false }, kst(2026, 10, 15, 12)), false, "기본 꺼짐");
  assert.equal(ops.nextRunLabel({ ...s, enabled: false }, kst(2026, 10, 15, 8)), "꺼짐");
  assert.equal(ops.nextRunLabel(s, kst(2026, 10, 15, 8)), "오늘 09시");
  assert.equal(ops.nextRunLabel({ ...s, lastRunKey: "2026-10-15" }, kst(2026, 10, 15, 12)), "내일 09시");
});

test("일정 입력 검사와 서비스 일정 겹침 경고", () => {
  const ok = { enabled: true, hour: 9, count: 2, subjects: "싹이, 나무", extra: "" };

  assert.equal(ops.scheduleError(ok), null);
  assert.match(ops.scheduleError({ ...ok, hour: 24 }), /0~23/);
  assert.match(ops.scheduleError({ ...ok, count: 0 }), /장 수/);
  assert.match(ops.scheduleError({ ...ok, subjects: " , " }), /대상/);
  assert.match(ops.scheduleError({ ...ok, count: 8, subjects: "a,b,c" }), /하루 전체 16장/);
  assert.match(ops.scheduleError({ ...ok, extra: "가".repeat(501) }), /500자/);
  const prof = service.serviceProfileOf("one-tiny-frame");

  assert.match(ops.overlapWarning(prof, true), /자체 생성 일정.*월요일 10:00/);
  assert.equal(ops.overlapWarning(prof, false), null, "서비스 운영이 꺼져 있으면 경고하지 않는다");
  assert.equal(ops.overlapWarning(null, true), null);
  assert.equal(ops.overlapWarning({ ownSchedule: null }, true), null);
});

// ───────── 서비스 API 확인표·호출기 (가짜 서버) ─────────

test("한 컷 확인표: 홈페이지가 부를 경로를 모두 채움(서비스에 없으면 404 → 서비스 API 없음), 키 이름 규칙", () => {
  const p = service.serviceProfileOf("one-tiny-frame");
  const has = Object.fromEntries(p.capabilities.map((c) => [c.key, !!c.api]));

  assert.deepEqual(has, { health: true, "pipeline-state": true, "schedule-toggle": true, "run-now": true, "gen-log": true, "approve-candidate": true, "review-count": true, upload: true });
  const paths = Object.fromEntries(p.capabilities.map((c) => [c.key, `${c.api.method} ${c.api.path}`]));

  assert.equal(paths["schedule-toggle"], "POST /api/admin/pipeline/auto");
  assert.equal(paths["run-now"], "POST /api/admin/pipeline/run");
  assert.equal(paths["gen-log"], "GET /api/admin/gen-log");
  assert.equal(paths["approve-candidate"], "GET /api/admin/candidates");
  assert.equal(paths.upload, "POST /api/admin/art-upload");
  assert.equal(paths.health, "GET /api/admin/health");
  assert.equal(p.capabilities.filter((c) => c.key !== "review-count").every((c) => c.api.auth === "admin"), true, "관리자 기능은 모두 서비스 관리자 키");
  assert.equal(p.server, "serverpc2");
  assert.equal(service.serviceAdminKeyName("one-tiny-frame"), "SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME");
  assert.equal(service.serviceProfileOf("nope"), null);
  assert.equal(service.missingCapabilities(p).length, 0);
  assert.match(read("lib/factory/secretEntries.ts"), /SERVER_SECRET_PREFIXES = \["REVIEW_STATUS_TOKEN_", "SERVICE_ADMIN_TOKEN_"\]/);
});

async function withFakeService(handler, run) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    handler(req, res);
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  // 홈페이지 서버는 https 공개 주소만 부른다. 시험에서는 그 주소의 요청을 가짜 서버(127.0.0.1)로 돌려보낸다
  const fetchImpl = (url, init) => fetch(String(url).replace("https://hancut.example.com", `http://127.0.0.1:${port}`), init);

  try {
    await run({ fetchImpl, seen });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("서비스 호출(가짜 서버): 키가 있으면 Bearer 로 부르고 JSON 을 받는다, 키 값은 결과에 없다", async () => {
  const p = service.serviceProfileOf("one-tiny-frame");

  await withFakeService(
    (req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ review: 3, held: 1, pending: 2, updatedAt: "2026-10-15T00:00:00.000Z" }));
    },
    async ({ fetchImpl, seen }) => {
      const r = await service.callService(p, "review-count", "https://hancut.example.com", { fetchImpl, readSecret: async (name) => (name === "REVIEW_STATUS_TOKEN_ONE_TINY_FRAME" ? SECRET : null) });

      assert.equal(r.state, "ok");
      assert.deepEqual([r.data.review, r.data.held, r.data.pending], [3, 1, 2]);
      assert.deepEqual(seen.map((s) => [s.method, s.url, s.auth]), [["GET", "/api/review-status", `Bearer ${SECRET}`]]);
      assert.equal(JSON.stringify(r).includes(SECRET), false);
    },
  );
});

test("서비스 호출: API 없는 기능은 부르지 않고 'API 없음', 키 없으면 '키 등록 필요'로 멈춤, 인증 실패·404·리다이렉트·JSON 아님·사설망은 오류", async () => {
  const p = service.serviceProfileOf("one-tiny-frame");
  let hits = 0;

  await withFakeService(
    (req, res) => {
      hits++;
      if (req.url === "/api/review-status") {
        const mode = req.headers["x-mode"];

        res.statusCode = mode === "401" ? 401 : mode === "404" ? 404 : mode === "302" ? 302 : 200;
        if (mode === "302") res.setHeader("Location", "https://evil.example.com/");
      }
      res.end(mode_text(req));
    },
    async ({ fetchImpl }) => {
      const deps = (mode, secret = SECRET) => ({ fetchImpl: (u, init) => fetchImpl(u, { ...init, headers: { ...init.headers, "x-mode": mode } }), readSecret: async () => secret });

      assert.deepEqual(await service.callService(p, "nope-key", "https://hancut.example.com", deps("200")), { state: "no-api" }, "확인표에 없는 기능은 부르지 않는다");
      assert.equal(hits, 0, "없는 API 는 서버를 부르지 않는다");
      const gone = { fetchImpl: async () => ({ status: 404, text: async () => "" }), readSecret: async () => SECRET };

      for (const key of ["schedule-toggle", "run-now", "gen-log", "approve-candidate", "upload", "health"]) assert.deepEqual(await service.callService(p, key, "https://hancut.example.com", gone), { state: "no-api" }, `${key}: 서비스가 404 면 서비스 API 없음`);
      assert.deepEqual(await service.callService(p, "review-count", "https://hancut.example.com", deps("200", null)), { state: "need-key", keyName: "REVIEW_STATUS_TOKEN_ONE_TINY_FRAME" });
      assert.equal(hits, 0, "키가 없으면 부르지 않는다");
      assert.equal((await service.callService(p, "review-count", "https://hancut.example.com", deps("401"))).reason, "인증 실패(키 확인)");
      assert.deepEqual(await service.callService(p, "review-count", "https://hancut.example.com", deps("404")), { state: "no-api" });
      assert.match((await service.callService(p, "review-count", "https://hancut.example.com", deps("302"))).reason, /응답 302/);
      assert.match((await service.callService(p, "review-count", "https://hancut.example.com", deps("text"))).reason, /JSON 아님/);
    },
  );
  for (const bad of ["http://hancut.example.com", "https://192.168.0.5", "https://localhost:8787", "https://u:p@hancut.example.com", null]) {
    const r = await service.callService(p, "review-count", bad, { readSecret: async () => SECRET, fetchImpl: async () => assert.fail("부르면 안 된다") });

    assert.equal(r.state, "blocked", String(bad));
  }
  const dns = await service.callService(p, "review-count", "https://hancut.example.com", { readSecret: async () => SECRET, lookupImpl: async () => ["10.0.0.4"], fetchImpl: async () => assert.fail("부르면 안 된다") });

  assert.equal(dns.state, "blocked", "이름이 사설망 주소로 풀리면 부르지 않는다");
});

function mode_text(req) {
  return req.headers["x-mode"] === "200" || req.headers["x-mode"] === undefined ? JSON.stringify({ review: 0, held: 0, pending: 0 }) : "not json";
}

// ───────── 가짜 DB ─────────

function makeDb(over = {}) {
  const db = {
    arts: [A("a1"), A("a2"), A("a3", { subject: "나무", cardId: "c2" }), A("a4", { status: "approved", decidedAt: new Date("2026-10-14T05:00:00Z"), decidedBy: "관리자" }), A("a5", { status: "approved", subject: "나무", cardId: "c2" }), A("o1", { appSlug: "other-app" })].map((a) => ({ ...a, createdAt: new Date(a.createdAt), decidedAt: a.decidedAt ? new Date(a.decidedAt) : null })),
    exports: [],
    actions: [],
    schedules: [],
    conn: { exportKind: "folder", exportPath: "assets/sprites", studioBatch: true, studioService: true, domain: null },
    jobs: [],
    secrets: [],
    appRow: { reviewUrl: "https://hancut.example.com/admin" },
    ...over,
  };
  let n = 0;

  db.prisma = {
    factoryArt: {
      findMany: async ({ where }) => db.arts.filter((a) => (!where.appSlug || a.appSlug === where.appSlug) && (!where.id || where.id.in.includes(a.id)) && (!where.status || a.status === where.status)).sort((x, y) => y.createdAt - x.createdAt),
      findUnique: async ({ where }) => db.arts.find((a) => a.id === where.id) ?? null,
      update: async ({ where, data }) => Object.assign(db.arts.find((a) => a.id === where.id), data),
    },
    factoryArtExport: {
      findMany: async ({ where }) => db.exports.filter((e) => (!where.appSlug || e.appSlug === where.appSlug) && (!where.kind || e.kind === where.kind) && (!where.artId || where.artId.in.includes(e.artId)) && (!where.status || where.status.in.includes(e.status))),
      create: async ({ data }) => (db.exports.push({ ...data, jobId: data.jobId ?? null, note: data.note ?? "", createdAt: new Date("2026-10-15T01:00:00Z") }), data),
    },
    factoryServiceAction: { create: async ({ data }) => (db.actions.push({ ...data, id: `act${db.actions.length + 1}`, createdAt: new Date("2026-10-15T02:00:00Z") }), data), findMany: async ({ where }) => db.actions.filter((a) => a.appSlug === where.appSlug).reverse() },
    factoryAppConnection: { findUnique: async () => db.conn },
    factoryApp: { findUnique: async () => db.appRow },
    factorySecretEntry: { findMany: async ({ where }) => db.secrets.filter((s) => where.name.in.includes(s)).map((name) => ({ name })) },
    factoryJob: { findMany: async ({ where }) => (where.id ? db.jobs.filter((j) => where.id.in.includes(j.id)) : []) },
    factorySetting: { findMany: async () => [] },
    factoryGenSchedule: {
      findMany: async ({ where } = {}) => db.schedules.filter((s) => (!where?.appSlug || s.appSlug === where.appSlug) && (where?.enabled === undefined || s.enabled === where.enabled)),
      upsert: async ({ where, create, update }) => {
        const cur = db.schedules.find((s) => s.appSlug === where.appSlug_cardId.appSlug && s.cardId === where.appSlug_cardId.cardId);

        if (cur) Object.assign(cur, update);
        else db.schedules.push({ lastRunKey: "", lastRunAt: null, lastJobId: null, lastMessage: "", ...create });
      },
      updateMany: async ({ where, data }) => {
        const s = db.schedules.find((x) => x.id === where.id && x.enabled === where.enabled && x.lastRunKey !== where.NOT.lastRunKey);

        if (!s) return { count: 0 };
        Object.assign(s, data);

        return { count: 1 };
      },
      update: async ({ where, data }) => Object.assign(db.schedules.find((x) => x.id === where.id), data),
    },
  };
  db.id = () => `id${++n}`;

  return db;
}

const CARD = (id, name, over = {}) => ({ id, name, enabled: true, version: 1, refRules: { pinDefault: false, defaultArtId: null, sameSubject: true, sameKind: true, maxRefs: null }, ...over });

function loadOps(db, extra = {}) {
  const calls = { tool: [], revision: [], card: [] };

  return {
    calls,
    mod: load("lib/studio/opsData.ts", {
      "@/lib/prisma": { __esModule: true, default: db.prisma },
      "@/lib/factory/cardsDb": {
        listCards: async () => extra.cards ?? [CARD("c1", "싹이 단독 짤"), CARD("c2", "소품 컷"), CARD("c3", "꺼진 카드", { enabled: false })],
        updateCard: async (appSlug, ref, input, source, who, note) => (calls.card.push({ appSlug, ref, input, source, who, note }), { ok: true, card: { version: 4 }, unchanged: false, message: "저장" }),
      },
      "@/lib/factory/projectToolSettingsDb": { getProjectToolSettings: async () => ({ settings: { aliases: ALIASES } }) },
      "@/lib/factory/mcp": { enqueueWithId: async (args) => (calls.revision.push(args), extra.revisionFail ? { isError: true, content: [{ text: "같은 앱에 검토 대기 일감이 있어요" }] } : { content: [{ text: "ok" }], jobId: `rev${calls.revision.length}` }) },
      "@/lib/factory/toolJobsDb": {
        enqueueToolJob: async (args, who) => {
          calls.tool.push({ args, who });
          if (extra.overLimit && args.confirmed !== true && who.askLimit) return { ok: false, message: "오늘 한도 초과", needsConfirm: { reason: "오늘 PixelLab 호출 한도를 넘어요", estimatedCost: 3, usage: { day: 9, month: 9 } } };

          return { ok: true, id: `tool${calls.tool.length}`, autoApproved: false, message: "도구 일감을 등록했어요" };
        },
      },
      "@/lib/studio/service": service,
      "@/lib/factory/artCopy": { copyAfterApprove: async () => null, copyApprovedArts: async () => ({ total: 0, copied: 0, failed: 0, remaining: 0, firstError: "" }), isOnUploadServer: (u, base) => !!base && u.startsWith(base) },
    }),
  };
}

test("검수 행동: 승인·반려·되돌림은 이 프로젝트 그림만(다른 프로젝트 그림은 건드리지 않음), 승인자 기록, 일괄 50장", async () => {
  const db = makeDb();
  const { mod } = loadOps(db);
  const ok = await mod.decideMany("one-tiny-frame", ["a1", "a2", "o1"], "approve", "관리자A");

  assert.equal(ok.ok, true);
  assert.equal(ok.changed, 2);
  assert.match(ok.message, /2장을 승인/);
  assert.match(ok.message, /1장은 이 프로젝트 그림이 아니어서/);
  assert.deepEqual(db.arts.filter((a) => ["a1", "a2"].includes(a.id)).map((a) => [a.status, a.decidedBy]), [["approved", "관리자A"], ["approved", "관리자A"]]);
  assert.equal(db.arts.find((a) => a.id === "o1").status, "candidate", "다른 프로젝트 그림은 그대로");
  assert.equal((await mod.decideMany("one-tiny-frame", ["a3"], "reject", "관리자A")).ok, true);
  assert.equal(db.arts.find((a) => a.id === "a3").status, "rejected");
  assert.equal((await mod.decideMany("one-tiny-frame", ["a3"], "reset", "관리자A")).ok, true);
  assert.deepEqual([db.arts.find((a) => a.id === "a3").status, db.arts.find((a) => a.id === "a3").decidedBy], ["candidate", ""]);
  assert.equal((await mod.decideMany("one-tiny-frame", [], "approve", "x")).status, 400);
  assert.equal((await mod.decideMany("one-tiny-frame", ["a1"], "export", "x")).status, 400, "알 수 없는 행동");
  assert.equal((await mod.decideMany("one-tiny-frame", ["zzz"], "approve", "x")).status, 404);
});

test("다시 요청: 같은 카드·같은 대상으로 도구 일감(출처 스튜디오, 한도 확인), 카드 없는 그림은 건너뜀, 한도 초과는 409 → 확인하면 등록", async () => {
  const db = makeDb({ arts: [A("a1"), A("a2"), A("a3", { subject: "나무", cardId: "c2" }), A("n1", { cardId: null })].map((a) => ({ ...a, createdAt: new Date(a.createdAt) })) });
  const { mod, calls } = loadOps(db);
  const r = await mod.redoMany("one-tiny-frame", ["a1", "a2", "a3", "n1"], false);

  assert.equal(r.ok, true);
  assert.deepEqual(r.jobIds, ["tool1", "tool2"]);
  assert.deepEqual(calls.tool.map((c) => c.args), [{ appSlug: "one-tiny-frame", card: "c1", subjects: ["싹이"], count: 2, confirmed: false }, { appSlug: "one-tiny-frame", card: "c2", subjects: ["나무"], count: 1, confirmed: false }]);
  assert.deepEqual(calls.tool[0].who, { source: "스튜디오", askLimit: true });
  assert.match(r.message, /싹이 2장/);
  assert.match(r.message, /카드 없이 만든 1장은 건너뜀/);
  assert.equal((await mod.redoMany("one-tiny-frame", ["n1"], false)).status, 400, "카드 없는 그림만 고르면 거절");

  const limited = loadOps(db, { overLimit: true });
  const first = await limited.mod.redoMany("one-tiny-frame", ["a1"], false);

  assert.equal(first.status, 409);
  assert.equal(first.needsConfirm.estimatedCost, 3);
  assert.equal(limited.calls.tool.length, 1);
  const again = await limited.mod.redoMany("one-tiny-frame", ["a1"], true);

  assert.equal(again.ok, true);
  assert.equal(limited.calls.tool[1].args.confirmed, true);
});

test("기본 그림 지정: 승인 그림만, 만든 카드의 defaultArtId 로(다른 참고 규칙은 유지), 카드 없는 그림은 거절", async () => {
  const db = makeDb({ arts: [A("a4", { status: "approved" }), A("a1"), A("n9", { status: "approved", cardId: null }), A("o1", { appSlug: "other-app", status: "approved" })].map((a) => ({ ...a, createdAt: new Date(a.createdAt) })) });
  const { mod, calls } = loadOps(db, { cards: [CARD("c1", "싹이 단독 짤", { refRules: { pinDefault: true, defaultArtId: null, sameSubject: false, sameKind: true, maxRefs: 2 } })] });
  const r = await mod.setDefaultArt("one-tiny-frame", "a4", "관리자A");

  assert.equal(r.ok, true);
  assert.match(r.message, /기본 그림으로 지정했어요\(판 4\)/);
  assert.deepEqual(calls.card[0].input, { refRules: { pinDefault: true, defaultArtId: "a4", sameSubject: false, sameKind: true, maxRefs: 2 } });
  assert.deepEqual([calls.card[0].appSlug, calls.card[0].ref, calls.card[0].source, calls.card[0].who], ["one-tiny-frame", "c1", "통제실", "관리자A"]);
  assert.equal((await mod.setDefaultArt("one-tiny-frame", "a1", "x")).status, 400, "후보는 안 됨");
  assert.equal((await mod.setDefaultArt("one-tiny-frame", "n9", "x")).status, 400, "카드 없는 그림");
  assert.equal((await mod.setDefaultArt("one-tiny-frame", "o1", "x")).status, 404, "다른 프로젝트 그림");
  assert.equal(calls.card.length, 1);
});

// ───────── 내보내기 ─────────

test("내보내기(앱 폴더): 승인 그림 n장 → 앱 수정 일감 1건(목록·빌드만), 기록은 그림마다, 같은 곳 중복은 거절", async () => {
  const db = makeDb();
  const { mod, calls } = loadOps(db);
  const r = await mod.exportArts("one-tiny-frame", ["a4", "a5", "a1"], "관리자A");

  assert.equal(r.ok, true);
  assert.deepEqual(r.jobIds, ["rev1"]);
  assert.equal(calls.revision.length, 1, "일감은 한 건");
  const job = calls.revision[0];

  assert.deepEqual([job.appSlug, job.kind, job.source], ["one-tiny-frame", "revision", "스튜디오"]);
  assert.equal(job.title, "승인 그림 2장 앱 폴더에 넣기");
  assert.match(job.planMarkdown, /assets\/sprites\/싹이-/);
  assert.match(job.planMarkdown, /assets\/sprites\/나무-/);
  assert.equal(job.planMarkdown.includes("a1.png"), false, "후보 a1 은 빠진다");
  assert.match(job.planMarkdown, /e2e 스크린샷은 찍지 않습니다. 검사는 빌드만 합니다/);
  assert.match(r.message, /1장은 승인 그림이 아니어서 뺐어요/);
  assert.deepEqual(db.exports.map((e) => [e.artId, e.kind, e.status, e.jobId, e.who]), [["a4", "folder", "requested", "rev1", "관리자A"], ["a5", "folder", "requested", "rev1", "관리자A"]]);
  const again = await mod.exportArts("one-tiny-frame", ["a4", "a5"], "관리자A");

  assert.equal(again.status, 409);
  assert.match(again.message, /이미 같은 곳으로 내보낸/);
  assert.equal(calls.revision.length, 1, "중복은 일감을 만들지 않는다");
  assert.equal(db.exports.length, 2);
});

test("내보내기 거절: 보낼 곳 미정·경로 없음·승인 그림 없음·일감 등록 실패(기록 안 남김)", async () => {
  let db = makeDb({ conn: { exportKind: null, exportPath: null, studioBatch: true, studioService: true, domain: null } });

  assert.match((await loadOps(db).mod.exportArts("one-tiny-frame", ["a4"], "x")).message, /내보낼 곳이 정해져 있지 않아요/);
  db = makeDb({ conn: { exportKind: "folder", exportPath: null, studioBatch: true, studioService: true, domain: null } });
  assert.match((await loadOps(db).mod.exportArts("one-tiny-frame", ["a4"], "x")).message, /앱 폴더 경로가 정해져/);
  db = makeDb();
  assert.equal((await loadOps(db).mod.exportArts("one-tiny-frame", ["a1"], "x")).status, 400, "후보만 고르면 거절");
  const failing = loadOps(db, { revisionFail: true });
  const r = await failing.mod.exportArts("one-tiny-frame", ["a4"], "x");

  assert.equal(r.status, 409);
  assert.match(r.message, /검토 대기 일감/);
  assert.equal(db.exports.length, 0, "일감을 못 만들면 기록도 없다");
  assert.equal((await loadOps(db).mod.exportArts("one-tiny-frame", Array.from({ length: 31 }, (_, i) => `a${i}`), "x")).status, 400, "한 번에 30장까지");
});

test("내보내기(서비스 업로드): 서비스가 404 면 '서비스 업로드 미지원' 501 + 미지원 기록, 키 없으면 키 등록 필요, 성공이면 보냄 기록 + 서비스 동작 기록", async () => {
  const db = makeDb({ conn: { exportKind: "upload", exportPath: null, studioBatch: true, studioService: true, domain: null } });
  const { mod, calls } = loadOps(db);
  const r = await mod.exportArts("one-tiny-frame", ["a4", "a5"], "관리자A", { serviceDeps: { readSecret: async () => SECRET, fetchImpl: async () => ({ status: 404, text: async () => "" }) } });

  assert.equal(r.ok, false);
  assert.equal(r.status, 501);
  assert.match(r.message, /서비스 업로드 미지원/);
  assert.match(r.message, /docs\/studio-service-api\.md/);
  assert.equal(calls.revision.length, 0, "앱 폴더 일감은 만들지 않는다");
  assert.deepEqual(db.exports.map((e) => [e.artId, e.kind, e.status, e.note]), [["a4", "upload", "unsupported", "서비스 업로드 미지원"], ["a5", "upload", "unsupported", "서비스 업로드 미지원"]]);
  const nokey = await mod.exportArts("one-tiny-frame", ["a4"], "관리자A", { serviceDeps: { readSecret: async () => null, fetchImpl: async () => assert.fail("키가 없으면 부르지 않는다") } });

  assert.equal(nokey.ok, false);
  assert.match(nokey.message, /키 등록 필요: SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME/);
  let sent = null;
  const ok = await mod.exportArts("one-tiny-frame", ["a4", "a5"], "관리자A", { serviceDeps: { readSecret: async () => SECRET, fetchImpl: async (u, init) => ((sent = { u, init }), { status: 200, text: async () => JSON.stringify({ saved: 2, skipped: [] }) }) } });

  assert.equal(ok.ok, true, ok.message);
  assert.equal(sent.u, "https://hancut.example.com/api/admin/art-upload");
  assert.equal(sent.init.headers.Authorization, `Bearer ${SECRET}`, "서비스 관리자 키로 서버가 대신 부른다");
  assert.deepEqual(JSON.parse(sent.init.body).items.map((i) => i.fileName), ["a4.png", "a5.png"]);
  assert.equal(db.actions.at(-1).action, "upload", "누가 했는지 서비스 동작 기록");
  assert.equal(db.actions.at(-1).who, "관리자A");
  assert.equal(JSON.stringify(db.actions).includes(SECRET), false);
});

test("내보낸 기록 상태: 앱 수정 일감이 끝나면 보냄, 실패·취소면 실패, 진행 중이면 그대로", () => {
  const { exportStatus } = loadOps(makeDb()).mod;

  assert.equal(exportStatus("requested", "done"), "done");
  assert.equal(exportStatus("requested", "failed"), "failed");
  assert.equal(exportStatus("requested", "cancelled"), "failed");
  assert.equal(exportStatus("requested", "running"), "requested");
  assert.equal(exportStatus("requested", undefined), "requested");
  assert.equal(exportStatus("unsupported", "done"), "unsupported");
});

// ───────── 생성 일정 ─────────

test("일정 저장: 기본 꺼짐, 카드·입력 검사, 꺼진 카드는 켤 수 없음", async () => {
  const db = makeDb();
  const { mod } = loadOps(db);
  const base = { enabled: true, hour: 9, count: 2, subjects: "싹이, 나무, 싹이", extra: " 밝게 " };

  assert.equal((await mod.saveSchedule("one-tiny-frame", "c1", base, "관리자A")).ok, true);
  assert.deepEqual([db.schedules[0].subjects, db.schedules[0].extra, db.schedules[0].hour, db.schedules[0].updatedBy], ["싹이, 나무", "밝게", 9, "관리자A"]);
  assert.equal((await mod.saveSchedule("one-tiny-frame", "c1", { ...base, enabled: false }, "x")).ok, true);
  assert.equal(db.schedules.length, 1, "같은 카드는 한 줄을 고친다");
  assert.equal(db.schedules[0].enabled, false);
  assert.equal((await mod.saveSchedule("one-tiny-frame", "c3", base, "x")).status, 400, "꺼진 카드");
  assert.equal((await mod.saveSchedule("one-tiny-frame", "nope", base, "x")).status, 404);
  assert.equal((await mod.saveSchedule("one-tiny-frame", "c1", { ...base, hour: 30 }, "x")).status, 400);
});

test("일정 실행: 시각 전엔 안 만들고, 지나면 도구 일감 1건(출처 '스튜디오 일정'), 같은 날 다시 불러도 한 번, 꺼진 일정은 무시", async () => {
  const db = makeDb();
  const { mod, calls } = loadOps(db);

  await mod.saveSchedule("one-tiny-frame", "c1", { enabled: true, hour: 9, count: 2, subjects: "싹이, 나무", extra: "밝게" }, "관리자A");
  await mod.saveSchedule("one-tiny-frame", "c2", { enabled: false, hour: 9, count: 1, subjects: "나무", extra: "" }, "관리자A");
  assert.deepEqual(await mod.runDueSchedules(new Date(kst(2026, 10, 15, 8, 59))), { ran: 0, skipped: 0 });
  assert.equal(calls.tool.length, 0);
  assert.deepEqual(await mod.runDueSchedules(new Date(kst(2026, 10, 15, 9, 1))), { ran: 1, skipped: 0 });
  assert.deepEqual(calls.tool[0].args, { appSlug: "one-tiny-frame", card: "c1", subjects: ["싹이", "나무"], count: 2, extra: "밝게" });
  assert.deepEqual(calls.tool[0].who, { source: "스튜디오 일정", askLimit: true });
  assert.deepEqual([db.schedules[0].lastRunKey, db.schedules[0].lastJobId], ["2026-10-15", "tool1"]);
  assert.deepEqual(await mod.runDueSchedules(new Date(kst(2026, 10, 15, 20))), { ran: 0, skipped: 0 }, "같은 날 두 번 만들지 않는다");
  const both = await Promise.all([mod.runDueSchedules(new Date(kst(2026, 10, 16, 10))), mod.runDueSchedules(new Date(kst(2026, 10, 16, 10)))]);

  assert.equal(both.reduce((n, r) => n + r.ran, 0), 1, "동시에 불러도 한 번");
  assert.equal(calls.tool.length, 2);
});

test("일정 실행: 비용 한도를 넘는 날은 만들지 않고 이유를 남긴다(다음 날 다시 시도)", async () => {
  const db = makeDb();
  const { mod, calls } = loadOps(db, { overLimit: true });

  await mod.saveSchedule("one-tiny-frame", "c1", { enabled: true, hour: 9, count: 1, subjects: "싹이", extra: "" }, "x");
  assert.deepEqual(await mod.runDueSchedules(new Date(kst(2026, 10, 15, 10))), { ran: 0, skipped: 1 });
  assert.equal(calls.tool[0].args.confirmed, undefined, "일정은 한도 확인을 받지 않고 스스로 넘기지 않는다");
  assert.equal(db.schedules[0].lastJobId, null);
  assert.match(db.schedules[0].lastMessage, /비용 한도를 넘어서 오늘은 만들지 않았어요/);
  assert.equal(db.schedules[0].lastRunKey, "2026-10-15");
  assert.deepEqual(await mod.runDueSchedules(new Date(kst(2026, 10, 15, 11))), { ran: 0, skipped: 0 }, "오늘은 다시 안 함");
  assert.deepEqual(await mod.runDueSchedules(new Date(kst(2026, 10, 16, 9, 5))), { ran: 0, skipped: 1 }, "다음 날 다시 시도");
});

test("일정 확인 길목: 1분에 한 번만, 실패해도 던지지 않는다", async () => {
  const db = makeDb();
  let reads = 0;
  const orig = db.prisma.factoryGenSchedule.findMany;

  db.prisma.factoryGenSchedule.findMany = async (a) => (reads++, orig(a));
  const { mod } = loadOps(db);
  const t = new Date(kst(2026, 10, 15, 10));

  await mod.tickSchedules(t, true);
  await mod.tickSchedules(new Date(t.getTime() + 10_000));
  assert.equal(reads, 1);
  await mod.tickSchedules(new Date(t.getTime() + 61_000));
  assert.equal(reads, 2);
  db.prisma.factoryGenSchedule.findMany = async () => {
    throw new Error("DB 끊김");
  };
  const quiet = console.error;

  console.error = () => {};
  try {
    await mod.tickSchedules(new Date(t.getTime() + 200_000)); // 던지지 않아야 한다
  } finally {
    console.error = quiet;
  }
});

// ───────── 자료 읽기 ─────────

test("운영 자료: 그림·필터 선택지·보관함·사용 이력·내보낸 기록(일감 상태 반영)·일정·겹침 경고·서비스 요약(키 이름만)", async () => {
  const db = makeDb({
    exports: [{ id: "e1", artId: "a4", appSlug: "one-tiny-frame", kind: "folder", status: "requested", jobId: "rev9", dest: "assets/sprites/싹이-a4.png", note: "", who: "관리자A", createdAt: new Date("2026-10-15T01:00:00Z") }],
    jobs: [{ id: "rev9", status: "done" }],
    secrets: ["REVIEW_STATUS_TOKEN_ONE_TINY_FRAME"],
  });
  const { mod } = loadOps(db);
  const fetchImpl = async () => ({ status: 200, text: async () => JSON.stringify({ review: 4, held: 0, pending: 1 }) });
  const data = await mod.readOpsData("one-tiny-frame", { uploadBase: "https://up.example.com", serviceDeps: { readSecret: async () => SECRET, fetchImpl }, healthDeps: { lookupImpl: async () => ["93.184.216.34"], tlsProbe: async () => ({ validTo: "2027-01-01T00:00:00.000Z", authorized: true, error: null }), keysReady: async () => new Set(["REVIEW_STATUS_TOKEN_ONE_TINY_FRAME"]), now: () => Date.parse("2026-10-15T00:00:00Z") } });

  assert.equal(data.arts.length, 5, "다른 프로젝트 그림은 없다");
  assert.deepEqual(data.archive.map((g) => [g.subject, g.arts.length]), [["나무", 1], ["싹이", 1]]);
  assert.equal(data.exportsByArt.a4[0].status, "done", "앱 수정 일감이 끝났으면 보냄");
  assert.match(data.history.a4.map((e) => e.text).join("\n"), /앱 폴더로 내보냄 — 보냄/);
  assert.deepEqual(data.schedules.map((s) => [s.cardName, s.enabled, s.next]), [["싹이 단독 짤", false, "꺼짐"], ["소품 컷", false, "꺼짐"], ["꺼진 카드", false, "꺼짐"]], "기본은 모두 꺼짐");
  assert.match(data.overlap, /자체 생성 일정/);
  assert.equal(data.uploadSupported, true, "업로드 경로가 확인표에 있다(서비스에 없으면 호출할 때 404 → 미지원)");
  assert.equal(data.service.health.api.state, "ok", "health API 결과가 서비스 요약에 붙는다");
  assert.deepEqual(data.copy, { enabled: true, needed: 2, failed: 0, outsideIds: ["a4", "a5"] }, "승인 그림 a4·a5 모두 업로드 서버 밖");
  assert.equal(data.service.reviewCount.review, 4);
  assert.deepEqual(data.service.adminKey, { name: "SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME", ready: false });
  assert.equal(data.service.capabilities.find((c) => c.key === "review-count").keyReady, true);
  assert.equal(JSON.stringify(data).includes(SECRET), false, "키 값은 자료에 없다");
  const off = await loadOps(makeDb({ conn: { exportKind: "folder", exportPath: "a", studioBatch: false, studioService: false, domain: null } })).mod.readOpsData("one-tiny-frame");

  assert.equal(off.service, null, "서비스 운영이 꺼져 있고 관리자 열기도 아니면 서비스는 읽지 않는다");
  const adminOpen = await loadOps(makeDb({ conn: { exportKind: "folder", exportPath: "a", studioBatch: false, studioService: false, domain: null } })).mod.readOpsData("one-tiny-frame", { includeService: true, uploadBase: "", serviceDeps: { readSecret: async () => null }, healthDeps: { lookupImpl: async () => [], keysReady: async () => new Set() } });

  assert.equal(adminOpen.service?.appSlug, "one-tiny-frame", "관리자 세션이면 연결 설정의 스위치와 상관없이 서비스 운영을 연다");
  assert.equal(off.overlap, null);
  assert.equal(await mod.readOpsData("A"), null);
});

test("서비스 요약: 키 없으면 '키 등록 필요'로 멈춤(서버를 부르지 않음), 주소 없으면 확인 안 함", async () => {
  const db = makeDb();
  const { mod } = loadOps(db);
  const nokey = await mod.readServiceView("one-tiny-frame", null, { readSecret: async () => null, fetchImpl: async () => assert.fail("키가 없으면 부르지 않는다") });

  assert.match(nokey.reviewCount.text, /키 등록 필요: REVIEW_STATUS_TOKEN_ONE_TINY_FRAME/);
  assert.equal(nokey.adminKey.ready, false);
  db.appRow = null;
  const noBase = await mod.readServiceView("one-tiny-frame", null, { readSecret: async () => SECRET, fetchImpl: async () => assert.fail("주소가 없으면 부르지 않는다") });

  assert.match(noBase.reviewCount.text, /서비스 주소가 없어서/);
  assert.ok(noBase.baseProblem);
  assert.equal(await mod.readServiceView("other-app", null), null);
});

// ───────── API ─────────

const jsonRes = (body, init = {}) => ({ body, status: init.status ?? 200, headers: init.headers ?? {} });
const reqOf = (body) => ({ json: async () => body });

function loadRoute({ admin }) {
  const calls = [];
  const rec = (name, res) => async (...a) => (calls.push([name, ...a]), res ?? { ok: true, message: `${name} 했어요`, changed: 1 });
  const route = load("app/api/studio/ops/route.ts", {
    "next/server": { NextResponse: { json: jsonRes } },
    "@/lib/auth/get-sesstion": { auth: async () => ({ user: { name: "관리자A" } }) },
    "@/lib/factory/admin": { requireAdmin: async () => (admin ? null : jsonRes({ message: "권한이 없습니다." }, { status: 403 })) },
    "@/lib/studio/opsData": {
      decideMany: rec("decide"),
      redoMany: async (...a) => (calls.push(["redo", ...a]), a[2] === true ? { ok: true, message: "등록", jobIds: ["t1"] } : { ok: false, status: 409, message: "한도", needsConfirm: { reason: "한도", estimatedCost: 2 } }),
      setDefaultArt: rec("default"),
      exportArts: async (...a) => (calls.push(["export", ...a]), { ok: true, message: "내보냄", jobIds: ["rev1"] }),
      saveSchedule: rec("schedule"),
    },
  });

  return { route, calls };
}

test("운영 API: 관리자만, 행동마다 알맞은 함수로, 한도 초과 409 → confirmed 로 재시도, 모르는 행동·잘못된 앱 이름 400", async () => {
  const anon = loadRoute({ admin: false });

  assert.equal((await anon.route.POST(reqOf({ appSlug: "one-tiny-frame", action: "approve", ids: ["a1"] }))).status, 403);
  assert.equal(anon.calls.length, 0);
  const { route, calls } = loadRoute({ admin: true });
  const post = (b) => route.POST(reqOf({ appSlug: "one-tiny-frame", ...b }));

  assert.equal((await post({ action: "approve", ids: ["a1"] })).status, 200);
  assert.deepEqual(calls[0], ["decide", "one-tiny-frame", ["a1"], "approve", "관리자A"]);
  assert.equal((await post({ action: "reject", ids: ["a1"] })).body.changed, 1);
  assert.equal((await post({ action: "reset", ids: ["a1"] })).status, 200);
  const first = await post({ action: "redo", ids: ["a1"] });

  assert.equal(first.status, 409);
  assert.equal(first.body.needsConfirm.estimatedCost, 2);
  const second = await post({ action: "redo", ids: ["a1"], confirmed: true });

  assert.equal(second.status, 201);
  assert.deepEqual(second.body.jobIds, ["t1"]);
  assert.equal((await post({ action: "redo", ids: ["a1"], confirmed: "true" })).status, 409, "문자열 'true' 는 확인으로 치지 않는다");
  assert.equal((await post({ action: "default", artId: "a4" })).status, 200);
  assert.equal((await post({ action: "export", ids: ["a4"] })).status, 201);
  const sched = await post({ action: "schedule", cardId: "c1", schedule: { enabled: true, hour: "9", count: "2", subjects: "싹이", extra: "x", hacker: 1 } });

  assert.equal(sched.status, 200);
  assert.deepEqual(calls.at(-1), ["schedule", "one-tiny-frame", "c1", { enabled: true, hour: 9, count: 2, subjects: "싹이", extra: "x" }, "관리자A"]);
  assert.equal((await post({ action: "drop-tables" })).status, 400);
  assert.equal((await route.POST(reqOf({ appSlug: "../x", action: "approve", ids: ["a1"] }))).status, 400);
  assert.equal((await route.POST(reqOf([1]))).status, 400);
  assert.equal((await route.POST({ json: async () => { throw new Error("bad"); } })).status, 400);
  assert.equal(second.headers["Cache-Control"], "no-store");
});

// ───────── 화면 ─────────

const Link = ({ href, children, ...rest }) => h("a", { href, ...rest }, children);
const refresh = { n: 0 };
const nav = { "next/link": { __esModule: true, default: Link }, "next/navigation": { useRouter: () => ({ refresh: () => refresh.n++, push() {} }) } };
const OpsTab = load("components/studio/OpsTab.tsx", nav).default;

const HEALTH = (over = {}) => ({
  appSlug: "one-tiny-frame",
  checkedAt: "2026-10-15T05:03:00.000Z",
  base: "hancut.example.com",
  domain: { state: "ok", ms: 120, status: 200, text: "응답함 200 (120ms)" },
  cert: { state: "warn", validTo: "2026-10-25T00:00:00.000Z", daysLeft: 10, text: "인증서 만료일 2026-10-25 (남은 10일) — 갱신이 필요해요" },
  keys: { review: { name: "REVIEW_STATUS_TOKEN_ONE_TINY_FRAME", ready: true }, admin: { name: "SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME", ready: false } },
  api: { state: "no-api", text: "서비스 API 없음", info: {} },
  ...over,
});

function viewData(over = {}) {
  const arts = [A("a1"), A("a2", { subject: "감자" }), A("a3", { status: "approved", cardId: "c2", decidedAt: "2026-10-14T05:00:00.000Z" }), A("a4", { status: "rejected", cardId: null })];
  const cardNames = new Map([["c1", "싹이 단독 짤"], ["c2", "소품 컷"]]);

  return {
    appSlug: "one-tiny-frame",
    arts,
    aliases: ALIASES,
    cards: [{ id: "c1", name: "싹이 단독 짤", enabled: true, defaultArtId: "a3" }, { id: "c2", name: "소품 컷", enabled: true, defaultArtId: null }],
    choices: ops.filterChoices(arts, cardNames, ALIASES),
    archive: ops.archiveGroups(arts, ALIASES),
    history: Object.fromEntries(arts.map((a) => [a.id, ops.usageHistory({ art: a, cardName: cardNames.get(a.cardId) ?? "", exports: [] })])),
    exportsByArt: { a3: [{ id: "e1", artId: "a3", kind: "folder", status: "done", jobId: "j", dest: "assets/a3.png", note: "", who: "", createdAt: "2026-10-15T01:00:00.000Z" }] },
    link: { exportKind: "folder", exportPath: "assets/sprites", studioBatch: true, studioService: true },
    schedules: [{ cardId: "c1", cardName: "싹이 단독 짤", cardEnabled: true, enabled: false, hour: 9, count: 1, subjects: "", extra: "", lastRunKey: "", lastRunAt: null, lastJobId: null, lastMessage: "", next: "꺼짐", saved: false }],
    overlap: "서비스 서버에 자체 생성 일정이 있어요(매주 월요일 10:00).",
    uploadSupported: false,
    service: service.buildServiceView({ profile: service.serviceProfileOf("one-tiny-frame"), base: "https://hancut.example.com", keysReady: new Set(["REVIEW_STATUS_TOKEN_ONE_TINY_FRAME"]), reviewCount: { state: "ok", review: 4, held: 1, pending: 2 }, health: HEALTH() }),
    serviceActions: [],
    copy: { enabled: true, needed: 0, failed: 0, outsideIds: [] },
    ...over,
  };
}
const html = (data, sub, canEdit = true, focusArt) => renderToStaticMarkup(h(OpsTab, { data, canEdit, sub, focusArt }));

test("검수함 화면: 후보가 기본, 필터 4개, 일괄 단추(승인·반려·후보로·다시 요청·기본 그림), 이력, 기본 그림 표시", () => {
  const out = html(viewData(), "review");

  assert.match(out, /data-ops-pane="review"/);
  assert.equal((out.match(/data-review-art="/g) ?? []).length, 2, "기본 필터는 후보만(a1, a2)");
  for (const a of ["approve", "reject", "reset", "redo", "default"]) assert.match(out, new RegExp(`data-review-action="${a}"`));
  assert.match(out, /data-review-filters/);
  for (const label of ["상태", "카드", "대상", "종류"]) assert.match(out, new RegExp(`${label}\\s*<select`));
  assert.match(out, /싹이 단독 짤 \(2\)/);
  assert.match(out, /싹이 \(4\)/, "별칭 감자는 싹이로 묶여 센다");
  assert.match(out, /0장 선택/);
  assert.match(out, /사용 이력/);
  assert.match(out, /image-rendering:pixelated/);
});

test("검수함 화면: 만들기 탭의 링크(art=<id>)로 열면 모든 상태에서 그 그림이 미리 골라진다", () => {
  const out = html(viewData(), "review", true, "a3");

  assert.match(out, /1장 선택/);
  assert.match(out, /data-review-art="a3"/);
  assert.match(out, /★ 기본 그림/);
  assert.match(out, /앱 폴더 · 보냄/);
});

test("접근 키(읽기 전용): 검수·내보내기·일정에 단추와 입력이 없다", () => {
  const review = html(viewData(), "review", false);

  assert.equal(review.includes("data-review-bulk"), false);
  assert.equal(/type="checkbox"/.test(review), false);
  assert.equal(html(viewData(), "export", false).includes("data-export-run"), false);
  const sched = html(viewData(), "schedule", false);

  assert.equal(sched.includes("data-schedule-save"), false);
  assert.match(sched, /disabled/);
});

test("보관함 화면: 대상별로 승인 그림만, 안내 문구, 비었을 때 안내", () => {
  const out = html(viewData(), "archive");

  assert.match(out, /data-archive-subject="싹이"/);
  assert.equal((out.match(/data-archive-art="/g) ?? []).length, 1);
  assert.match(out, /그림을 누르면 어떤 카드로 만들었고 어디로 내보냈는지/);
  assert.match(html(viewData({ archive: [] }), "archive"), /승인된 그림이 아직 없어요/);
});

test("내보내기 화면: 보낼 곳·승인 그림·내보낸 기록, 업로드인데 API 없으면 '서비스 업로드 미지원' 안내, 미정이면 경고", () => {
  const out = html(viewData(), "export");

  assert.match(out, /앱 폴더 경로 — assets\/sprites/);
  assert.equal((out.match(/data-export-art="/g) ?? []).length, 1);
  assert.match(out, /data-export-run/);
  assert.match(out, /앱 폴더 · 보냄/);
  assert.match(out, /e2e 스크린샷 없음/);
  assert.equal(out.includes("data-export-unsupported"), false);
  const up = html(viewData({ link: { exportKind: "upload", exportPath: null, studioBatch: true, studioService: true } }), "export");

  assert.match(up, /data-export-unsupported/);
  assert.match(up, /서비스 업로드 미지원/);
  assert.match(html(viewData({ link: { exportKind: null, exportPath: null, studioBatch: true, studioService: true } }), "export"), /내보낼 곳이 정해져 있지 않아요/);
});

test("생성 일정 화면: 카드마다 꺼짐 기본, 시각·장 수·대상 입력, 겹침 경고, 마지막 실행 결과", () => {
  const out = html(viewData({ schedules: [{ ...viewData().schedules[0], lastMessage: "비용 한도를 넘어서 오늘은 만들지 않았어요", lastRunAt: "2026-10-15T01:00:00.000Z" }] }), "schedule");

  assert.match(out, /data-schedule-card="c1"/);
  assert.match(out, /꺼짐/);
  assert.match(out, /data-schedule-overlap/);
  assert.match(out, /자체 생성 일정/);
  assert.match(out, /data-schedule-save/);
  assert.match(out, /09시/);
  assert.match(out, /마지막 실행.*비용 한도를 넘어서/);
  assert.equal(html(viewData({ overlap: null }), "schedule").includes("data-schedule-overlap"), false);
});

test("서비스 운영 화면: 연결 상태(도메인·인증서·키·API)·검수 대기 숫자·관리자 키 '키 등록 필요'·API 없으면 버튼 끔·키 값 없음", () => {
  const out = html(viewData(), "service");

  assert.match(out, /data-service-health="one-tiny-frame"/);
  assert.match(out, /응답함/);
  assert.match(out, /120ms/);
  assert.match(out, /만료 임박 10일/, "14일 이하면 경고");
  assert.match(out, /data-health-key="REVIEW_STATUS_TOKEN_ONE_TINY_FRAME"/);
  assert.match(out, /data-health-key="SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME"/);
  assert.match(out, /서비스 API 없음/);
  assert.match(out, /GET \/api\/admin\/health/);
  assert.match(out, /data-service-noapi/, "서비스에 API 가 없다는 안내");
  assert.match(out, /서비스 집계: 검수 4장 · 보류 1장 · 그림 대기 2장/);
  assert.match(out, /키 등록 필요 — 통제실 키 등록/);
  assert.match(out, /서버2\(serverpc2\)/);
  assert.match(out, /one-tiny-frame-api-1/);
  assert.equal(out.includes(SECRET), false);
  assert.match(out, /data-health-check/, "[지금 확인] 단추");
  for (const w of ["schedule-on", "schedule-off", "run"]) assert.match(out, new RegExp(`data-service-write="${w}"[^>]*disabled`), `${w}: 서비스 API 없음이면 꺼짐`);
  // 서비스 API 정상 + 키 등록 → 버튼이 켜진다(disabled 아님)
  const ready = html(viewData({ service: service.buildServiceView({ profile: service.serviceProfileOf("one-tiny-frame"), base: "https://hancut.example.com", keysReady: new Set(["SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME", "REVIEW_STATUS_TOKEN_ONE_TINY_FRAME"]), reviewCount: null, health: HEALTH({ api: { state: "ok", text: "정상 응답", info: { version: "1.2" } }, cert: { state: "expired", validTo: "2026-10-01T00:00:00.000Z", daysLeft: -14, text: "인증서 만료됨 (2026-10-01, 14일 지남)" } }) }) }), "service");

  assert.doesNotMatch(ready, /data-service-write="run"[^>]*disabled/);
  assert.doesNotMatch(ready, /data-service-noapi/);
  assert.match(ready, /fx-st-fail">만료됨/, "만료는 빨간색(실패 색)");
  assert.match(ready, /version=1\.2/);
  // 접근 키(읽기 전용): 쓰기 단추가 없다
  assert.equal(/data-service-write=/.test(html(viewData(), "service", false)), false, "읽기 전용에는 쓰기 단추가 없다");
  assert.equal(/data-health-check/.test(html(viewData(), "service", false)), false, "읽기 전용에는 [지금 확인]도 없다");
  assert.match(html(viewData({ service: null }), "service"), /서비스 정보가 없어요/);
});

// ───────── 연결·안전 ─────────

test("연결: 운영 탭이 화면에 붙고, 일정 확인이 일감 가져가기 길목에 있고, 마이그레이션은 새 표만, 앱 폴더·nginx·서비스 DB 를 건드리는 코드가 없다", () => {
  const page = read("app/studio/[app]/page.tsx");

  assert.match(page, /readOpsData\(app, \{ includeService: adminService \}\)/);
  assert.match(page, /<OpsTab canEdit=\{viewer\.kind === "admin"\}/);
  assert.equal(/data-studio-pending="ops"/.test(page), false);
  assert.match(page, /art\?: string \| string\[\]/);
  assert.match(read("app/api/factory/next/route.ts"), /void tickSchedules\(\)/);
  assert.match(read("components/studio/MakeTab.tsx"), /tab=ops&sub=review&art=/);
  const sql = read("prisma/migrations/20261116090000_studio_ops/migration.sql");

  assert.equal(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i.test(sql), false, "기존 데이터를 지우거나 바꾸지 않는다");
  assert.match(sql, /CREATE TABLE "factory_art_exports"/);
  assert.match(sql, /CREATE TABLE "factory_gen_schedules"/);
  for (const f of ["lib/studio/ops.ts", "lib/studio/opsData.ts", "lib/studio/service.ts", "app/api/studio/ops/route.ts", "components/studio/OpsTab.tsx"]) {
    const src = read(f);

    assert.equal(/from "node:fs"|from "fs"|child_process|writeFile|nginx|\.env\.local/.test(src.replace(/\/\/.*$/gm, "")), false, `${f}: 파일·프로세스·nginx 를 건드리지 않는다`);
  }
  const doc = read("docs/studio-service-api.md");

  for (const w of ["서비스에 API 없음", "/api/admin/art-upload", "GET /api/review-status", "ADMIN_TOKEN"]) assert.ok(doc.includes(w), w);
  assert.match(read("docs/studio-hub.md"), /\[운영\] 탭 \(3-3\)/);
});
