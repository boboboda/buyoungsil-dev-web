// 소설 공장(홈페이지 쪽) 시험: lib/novel/rules.ts(상태 전이·예약 시각·검증·sync·알림) + lib/novel/store.ts(가짜 DB)
// + /api/novel/report·/api/novel/sync 라우트(작업 PC 토큰 관문은 진짜 lib/factory/http.ts, 토큰 확인만 가짜) + 공개 조건.
// 실제 DB·네트워크·텔레그램은 쓰지 않는다. 실행: node tests/novel-factory.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { NextRequest } = require("next/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const rules = loadTs("lib/novel/rules.ts");
const HOUR = 60 * 60 * 1000;
const T0 = new Date(Date.UTC(2026, 9, 20, 0, 0, 0));

// ── 가짜 DB (메모리): 소설 공장이 쓰는 Prisma 기능만 ──
const val = (v) => (v instanceof Date ? v.getTime() : v);
function matchField(v, cond) {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    if ("in" in cond && !cond.in.includes(v)) return false;
    if ("notIn" in cond && cond.notIn.includes(v)) return false;
    if ("not" in cond && (cond.not === null ? v === null || v === undefined : val(v) === val(cond.not))) return false;
    if ("lte" in cond && !(v !== null && v !== undefined && val(v) <= val(cond.lte))) return false;
    if ("lt" in cond && !(v !== null && v !== undefined && val(v) < val(cond.lt))) return false;
    if ("gt" in cond && !(v !== null && v !== undefined && val(v) > val(cond.gt))) return false;
    return true;
  }
  return val(v ?? null) === val(cond);
}
function matches(row, where = {}) {
  return Object.entries(where).every(([k, c]) => {
    if (k === "workId_number") return row.workId === c.workId && row.number === c.number;
    return matchField(row[k], c);
  });
}
function sortRows(rows, orderBy) {
  if (!orderBy) return [...rows];
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
  return [...rows].sort((a, b) => {
    for (const [k, dir] of keys) {
      const x = val(a[k]);
      const y = val(b[k]);
      if (x === y) continue;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1);
    }
    return 0;
  });
}

function makeDb() {
  const data = { works: [], episodes: [], logs: [], apps: [] };
  let seq = 0;
  const id = (p) => `${p}${++seq}`;
  const project = (row, select, model) => {
    if (!select) return { ...row };
    const out = {};
    for (const [k, v] of Object.entries(select)) {
      if (k === "episodes" && model === "work") {
        const eps = sortRows(data.episodes.filter((e) => e.workId === row.id && matches(e, v.where)), v.orderBy);
        out.episodes = eps.map((e) => project(e, v.select));
      } else if (v) out[k] = row[k];
    }
    return out;
  };
  const model = (rows, name, defaults) => ({
    findUnique: async ({ where, select }) => {
      const r = rows().find((x) => matches(x, where));
      return r ? project(r, select, name) : null;
    },
    findFirst: async ({ where, orderBy, select } = {}) => {
      const r = sortRows(rows().filter((x) => matches(x, where)), orderBy)[0];
      return r ? project(r, select, name) : null;
    },
    findMany: async ({ where, orderBy, take, select } = {}) => {
      let list = sortRows(rows().filter((x) => matches(x, where)), orderBy);
      if (take !== undefined) list = list.slice(0, take);
      return list.map((r) => project(r, select, name));
    },
    count: async ({ where } = {}) => rows().filter((x) => matches(x, where)).length,
    create: async ({ data: d, select }) => {
      const row = { id: id(name), ...defaults(), ...d, createdAt: T0, updatedAt: T0 };
      rows().push(row);
      return project(row, select, name);
    },
    createMany: async ({ data: list }) => {
      for (const d of list) rows().push({ id: ++seq, at: T0, ...d });
      return { count: list.length };
    },
    update: async ({ where, data: d, select }) => {
      const r = rows().find((x) => matches(x, where));
      if (!r) throw new Error("not found");
      Object.assign(r, d, { updatedAt: T0 });
      return project(r, select, name);
    },
    updateMany: async ({ where, data: d }) => {
      const list = rows().filter((x) => matches(x, where));
      for (const r of list) Object.assign(r, d);
      return { count: list.length };
    },
    upsert: async ({ where, create, update }) => {
      const r = rows().find((x) => matches(x, where));
      if (r) Object.assign(r, update);
      else rows().push({ id: id(name), ...defaults(), ...create, createdAt: T0, updatedAt: T0 });
      return {};
    },
  });
  const workDefaults = () => ({ status: "setup", approvalMode: "every", publishPerDay: 1, paused: false, setupApprovedAt: null, genre: null, logline: null, setupSummary: null });
  const epDefaults = () => ({ status: "planned", attempts: 0, title: null, body: null, summary: null, checkResult: null, tokens: null, revisionNote: null, approvedAt: null, publishAt: null });
  const db = {
    data,
    novelWork: model(() => data.works, "work", workDefaults),
    novelEpisode: model(() => data.episodes, "episode", epDefaults),
    novelLog: model(() => data.logs, "log", () => ({ level: "info" })),
    analyticsApp: model(() => data.apps, "app", () => ({})),
    $queryRaw: async () => [],
    $transaction: async (fn) => fn(db),
  };
  return db;
}

const DbNull = Symbol("DbNull");
function loadStore(db) {
  const prismaDep = { __esModule: true, default: db };
  const pub = loadTs("lib/novel/public.ts", { "@/lib/prisma": prismaDep, "@/lib/novel/rules": rules });
  return loadTs("lib/novel/store.ts", { "@/lib/prisma": prismaDep, "@/lib/novel/rules": rules, "@/lib/novel/public": pub, "@prisma/client": { Prisma: { DbNull } } });
}

function loadRoutes(db, notified) {
  const store = loadStore(db);
  const http = loadTs("lib/factory/http.ts", { "@/lib/factory/auth": { isValidFactoryWorkerToken: async (h) => h === "Bearer good-token-1234567890" } });
  const notify = { notifyNovel: (kind, title, n) => kind && notified.push({ kind, title, n }) };
  const deps = { "@/lib/factory/http": http, "@/lib/novel/rules": rules, "@/lib/novel/store": store, "@/lib/novel/notify": notify };
  return { report: loadTs("app/api/novel/report/route.ts", deps), sync: loadTs("app/api/novel/sync/route.ts", deps), store };
}

const req = (url, body, token = "good-token-1234567890") =>
  new NextRequest(`https://x.test${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-forwarded-for": `10.0.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}` },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });

const SETUP = { kind: "setup", slug: "my-novel", title: "나의 소설", genre: "판타지", logline: "한 줄", setupSummary: "# 설정" };
const ep = (number, status, extra = {}) => ({ kind: "episode", slug: "my-novel", number, status, ...extra });
const PENDING = (number, extra = {}) => ep(number, "pending_approval", { title: `${number}화`, body: "본문 첫 문단\n\n둘째 문단", summary: "요약", attempts: 1, checkResult: { pass: true, issues: [] }, ...extra });

// ───────── 1. 상태 전이 ─────────
test("실행기 전이: approved 보고는 400, 승인된 화에 보고는 409, 사람 차례 화는 409, 같은 상태 재전송은 허용", () => {
  assert.equal(rules.workerTransition(null, "drafting").ok, true);
  assert.deepEqual(rules.workerTransition("drafting", "approved"), { ok: false, code: 400, reason: "실행기가 보고할 수 없는 상태입니다." });
  assert.equal(rules.workerTransition("approved", "drafting").code, 409);
  assert.equal(rules.workerTransition("approved", "pending_approval").code, 409);
  assert.equal(rules.workerTransition("pending_approval", "drafting").code, 409);
  assert.equal(rules.workerTransition("held", "revising").code, 409);
  assert.equal(rules.workerTransition("pending_approval", "pending_approval").ok, true);
  assert.equal(rules.workerTransition("held", "held").ok, true);
  assert.equal(rules.workerTransition("revising", "pending_approval").ok, true);
  assert.equal(rules.workerTransition("checking", "held").ok, true);
  assert.equal(rules.workerTransition("checking", "bogus").code, 400);
});

test("사람 전이: 승인·수정 요청은 승인 대기에서만, 보류 해제는 보류에서만, 본문 없으면 승인 거절", () => {
  assert.deepEqual(rules.humanTransition("pending_approval", "approve"), { ok: true, to: "approved" });
  assert.equal(rules.humanTransition("pending_approval", "approve", false).ok, false);
  assert.equal(rules.humanTransition("drafting", "approve").ok, false);
  assert.equal(rules.humanTransition("approved", "approve").ok, false);
  assert.deepEqual(rules.humanTransition("pending_approval", "revise"), { ok: true, to: "revising" });
  assert.equal(rules.humanTransition("held", "revise").ok, false);
  assert.deepEqual(rules.humanTransition("held", "release_hold"), { ok: true, to: "revising" });
  assert.equal(rules.humanTransition("pending_approval", "release_hold").ok, false);
  assert.equal(rules.canApproveSetup("setup"), true);
  assert.equal(rules.canApproveSetup("active"), false);
});

// ───────── 2. 예약 시각 ─────────
test("예약 시각: 하루 1화(24시간 간격), 하루 3화(8시간), 이미 미래에 배정돼 있으면 그 뒤로, 지난 배정은 지금", () => {
  assert.equal(rules.nextPublishAt(T0, null, 1).getTime(), T0.getTime());
  const last = new Date(T0.getTime() - 2 * HOUR);
  assert.equal(rules.nextPublishAt(T0, last, 1).getTime(), last.getTime() + 24 * HOUR);
  assert.equal(rules.nextPublishAt(T0, last, 3).getTime(), last.getTime() + 8 * HOUR);
  const future = new Date(T0.getTime() + 30 * HOUR);
  assert.equal(rules.nextPublishAt(T0, future, 1).getTime(), future.getTime() + 24 * HOUR);
  const old = new Date(T0.getTime() - 48 * HOUR);
  assert.equal(rules.nextPublishAt(T0, old, 1).getTime(), T0.getTime());
  const three = rules.assignPublishTimes(T0, null, 3, 3).map((d) => (d.getTime() - T0.getTime()) / HOUR);
  assert.deepEqual(three, [0, 8, 16]);
});

// ───────── 검증 ─────────
test("보고 검증: slug·number·status·길이·검수 형식·pending_approval 본문 필수", () => {
  assert.equal(rules.parseNovelReport(SETUP).ok, true);
  assert.equal(rules.parseNovelReport({ ...SETUP, slug: "My_Novel" }).ok, false);
  assert.equal(rules.parseNovelReport({ ...SETUP, title: "" }).ok, false);
  assert.equal(rules.parseNovelReport(ep(0, "drafting")).ok, false);
  assert.equal(rules.parseNovelReport(ep(10000, "drafting")).ok, false);
  assert.equal(rules.parseNovelReport(ep(1.5, "drafting")).ok, false);
  assert.equal(rules.parseNovelReport(ep(1, "approved")).ok, false);
  assert.equal(rules.parseNovelReport(ep(1, "pending_approval")).ok, false);
  assert.equal(rules.parseNovelReport(ep(1, "pending_approval", { body: "   " })).ok, false);
  assert.equal(rules.parseNovelReport(ep(1, "drafting", { title: "가".repeat(101) })).ok, false);
  assert.equal(rules.parseNovelReport(ep(1, "drafting", { body: "가".repeat(100_001) })).ok, false);
  assert.equal(rules.parseNovelReport(ep(1, "drafting", { summary: "가".repeat(4001) })).ok, false);
  assert.equal(rules.parseNovelReport(ep(1, "drafting", { logs: Array.from({ length: 51 }, () => ({ message: "x" })) })).ok, false);
  assert.equal(rules.parseNovelReport(ep(1, "drafting", { logs: [{ level: "info", message: "x".repeat(2001) }] })).ok, false);
  assert.equal(rules.parseNovelReport(ep(1, "checking", { checkResult: { pass: "yes" } })).ok, false);
  assert.equal(rules.parseNovelReport(ep(1, "checking", { checkResult: { pass: false, issues: [{ type: "other", detail: "x" }] } })).ok, false);
  const okRep = rules.parseNovelReport(PENDING(1, { tokens: { writer: { model: "opus", in: 10, out: 20 } } }));
  assert.equal(okRep.ok, true);
  assert.equal(rules.tokenTotal(okRep.value.tokens), 30);
  assert.equal(rules.parseNote("", true).ok, false);
  assert.equal(rules.parseNote("가".repeat(2001), true).ok, false);
  assert.deepEqual(rules.parseNote(undefined, false), { ok: true, value: null });
  assert.equal(rules.parseWorkPatch({ publishPerDay: 25 }).ok, false);
  assert.equal(rules.parseWorkPatch({ status: "setup" }).ok, false);
  assert.deepEqual(rules.parseWorkPatch({ paused: true, approvalMode: "batch5" }), { ok: true, value: { paused: true, approvalMode: "batch5" } });
});

test("알림 조건: every 는 승인 대기마다, batch5 는 대기 5개가 됐을 때, auto 는 보류만, 재전송은 다시 안 알림", () => {
  assert.equal(rules.notifyKind("every", "checking", "pending_approval", 1), "pending");
  assert.equal(rules.notifyKind("every", "pending_approval", "pending_approval", 1), null);
  assert.equal(rules.notifyKind("batch5", "checking", "pending_approval", 4), null);
  assert.equal(rules.notifyKind("batch5", "checking", "pending_approval", 5), "batch");
  assert.equal(rules.notifyKind("auto", "checking", "pending_approval", 1), null);
  for (const m of ["every", "batch5", "auto"]) assert.equal(rules.notifyKind(m, "revising", "held", 0), "held");
  assert.equal(rules.notifyKind("every", "drafting", "checking", 0), null);
});

// ───────── 3. report API ─────────
test("report API: 인증, 검증 실패 400, 없는 작품 404, 승인된 화 409, 재전송 멱등, 본문 없는 승인 대기 400", async () => {
  const db = makeDb();
  const notified = [];
  const { report } = loadRoutes(db, notified);

  assert.equal((await report.POST(req("/api/novel/report", SETUP, "bad-token-000000000000"))).status, 401);
  assert.equal((await report.POST(req("/api/novel/report", "{not json"))).status, 400);
  assert.equal((await report.POST(req("/api/novel/report", { ...SETUP, slug: "x" }))).status, 400);

  // 작품 없음 → 404
  assert.equal((await report.POST(req("/api/novel/report", ep(1, "drafting")))).status, 404);

  // 설정 보고 → 작품 생성(setup)
  let res = await report.POST(req("/api/novel/report", SETUP));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, status: "setup" });
  assert.equal(db.data.works.length, 1);

  // 같은 화 같은 내용 두 번 → 한 줄, 같은 상태
  for (let i = 0; i < 2; i++) {
    res = await report.POST(req("/api/novel/report", PENDING(1, { logs: [{ message: "검수 통과" }] })));
    assert.equal(res.status, 200);
  }
  assert.equal(db.data.episodes.length, 1);
  assert.equal(db.data.episodes[0].status, "pending_approval");
  assert.equal(notified.length, 1, "재전송에는 다시 알리지 않는다");
  assert.equal(notified[0].kind, "pending");
  assert.equal(db.data.logs.length, 2);

  // 승인 대기 보고에 본문이 없으면 400
  assert.equal((await report.POST(req("/api/novel/report", ep(2, "pending_approval", { title: "2화" })))).status, 400);
  // 실행기가 approved 로 보고하면 400
  assert.equal((await report.POST(req("/api/novel/report", ep(2, "approved", { body: "x" })))).status, 400);

  // 사람이 승인 → 그 뒤 실행기 보고는 409 { status }
  const { approveEpisode } = loadStore(db);
  assert.equal((await approveEpisode("my-novel", 1, T0)).ok, true);
  res = await report.POST(req("/api/novel/report", PENDING(1)));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).status, "approved");

  // 너무 큰 요청(256KB 초과)은 413
  assert.equal((await report.POST(req("/api/novel/report", JSON.stringify({ ...SETUP, pad: "x".repeat(270 * 1024) })))).status, 413);
});

test("설정 보고: setup 일 때만 설정 내용을 덮어쓴다", async () => {
  const db = makeDb();
  const { report, store } = loadRoutes(db, []);
  await report.POST(req("/api/novel/report", SETUP));
  await report.POST(req("/api/novel/report", { ...SETUP, setupSummary: "# 고친 설정" }));
  assert.equal(db.data.works[0].setupSummary, "# 고친 설정");
  assert.equal((await store.approveSetup("my-novel", T0)).ok, true);
  assert.equal(db.data.works[0].status, "active");
  assert.equal((await store.approveSetup("my-novel", T0)).ok, false);
  await report.POST(req("/api/novel/report", { ...SETUP, setupSummary: "# 승인 뒤 변경" }));
  assert.equal(db.data.works[0].setupSummary, "# 고친 설정");
});

test("수정 요청 → 다시 승인 대기가 되면 메모를 지우고, 보류 해제는 revising 으로", async () => {
  const db = makeDb();
  const notified = [];
  const { report, store } = loadRoutes(db, notified);
  await report.POST(req("/api/novel/report", SETUP));
  await report.POST(req("/api/novel/report", PENDING(1)));
  assert.equal((await store.reviseEpisode("my-novel", 1, "주인공 말투를 더 거칠게")).ok, true);
  assert.equal(db.data.episodes[0].status, "revising");
  assert.equal(db.data.episodes[0].revisionNote, "주인공 말투를 더 거칠게");
  assert.equal((await store.reviseEpisode("my-novel", 1, "다시")).ok, false, "revising 에는 수정 요청 불가");
  await report.POST(req("/api/novel/report", ep(1, "drafting")));
  await report.POST(req("/api/novel/report", PENDING(1, { attempts: 2 })));
  assert.equal(db.data.episodes[0].status, "pending_approval");
  assert.equal(db.data.episodes[0].revisionNote, null);
  assert.equal(db.data.episodes[0].attempts, 2);

  await report.POST(req("/api/novel/report", ep(2, "held", { attempts: 2 })));
  assert.equal(notified.at(-1).kind, "held");
  assert.equal((await store.releaseHold("my-novel", 2, null)).ok, true);
  assert.equal(db.data.episodes.find((e) => e.number === 2).status, "revising");
  assert.equal((await store.releaseHold("my-novel", 2, null)).ok, false);
});

test("auto 모드: 검수 통과한 승인 대기는 서버가 바로 승인·예약, 통과 못 하면 그대로 대기", async () => {
  const db = makeDb();
  const notified = [];
  const { report } = loadRoutes(db, notified);
  await report.POST(req("/api/novel/report", SETUP));
  db.data.works[0].approvalMode = "auto";
  db.data.works[0].status = "active";
  let res = await report.POST(req("/api/novel/report", PENDING(1)));
  assert.deepEqual(await res.json(), { ok: true, status: "approved" });
  assert.ok(db.data.episodes[0].publishAt instanceof Date);
  res = await report.POST(req("/api/novel/report", PENDING(2, { checkResult: { pass: false, issues: [{ type: "quality", detail: "약함" }] } })));
  assert.deepEqual(await res.json(), { ok: true, status: "pending_approval" });
  assert.equal(notified.length, 0, "auto 는 보류일 때만 알린다");
});

test("일괄 승인: 번호 순 최대 5화, 하루 발행 화수 간격으로 예약", async () => {
  const db = makeDb();
  const { report, store } = loadRoutes(db, []);
  await report.POST(req("/api/novel/report", SETUP));
  db.data.works[0].publishPerDay = 2;
  for (const n of [7, 3, 1, 2, 5, 4, 6]) await report.POST(req("/api/novel/report", PENDING(n)));
  const r = await store.approvePending("my-novel", T0);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.numbers, [1, 2, 3, 4, 5]);
  const times = db.data.episodes.filter((e) => e.status === "approved").sort((a, b) => a.number - b.number).map((e) => (e.publishAt.getTime() - T0.getTime()) / HOUR);
  assert.deepEqual(times, [0, 12, 24, 36, 48]);
  // 다음 승인은 마지막 예약 뒤로
  const a6 = await store.approveEpisode("my-novel", 6, T0);
  assert.equal((a6.value.publishAt.getTime() - T0.getTime()) / HOUR, 60);
});

// ───────── 4. sync API ─────────
test("sync API: 행동이 필요한 화만(최근 승인 1개·수정 요청 메모·승인 대기·보류), 중단·완결 작품 제외", async () => {
  const db = makeDb();
  const { report, sync, store } = loadRoutes(db, []);
  await report.POST(req("/api/novel/report", SETUP));
  await report.POST(req("/api/novel/report", { ...SETUP, slug: "old-novel", title: "끝난 작품" }));
  db.data.works[1].status = "finished";
  for (const n of [1, 2, 3, 4, 5]) await report.POST(req("/api/novel/report", PENDING(n)));
  await store.approveEpisode("my-novel", 1, T0);
  await store.approveEpisode("my-novel", 2, T0);
  await store.reviseEpisode("my-novel", 3, "메모");
  await report.POST(req("/api/novel/report", ep(6, "drafting")));
  await report.POST(req("/api/novel/report", ep(7, "held")));

  const res = await sync.GET(req("/api/novel/sync"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.works.length, 1);
  const w = body.works[0];
  assert.equal(w.slug, "my-novel");
  assert.equal(w.setupApproved, false);
  assert.equal(w.paused, false);
  assert.deepEqual(w.episodes, [
    { number: 2, status: "approved" },
    { number: 3, status: "revising", revisionNote: "메모" },
    { number: 4, status: "pending_approval" },
    { number: 5, status: "pending_approval" },
    { number: 7, status: "held" },
  ]);
  assert.equal((await sync.GET(req("/api/novel/sync", undefined, "bad-token-000000000000"))).status, 401);
});

// ───────── 5. 공개 조건 ─────────
test("공개 조건: 예약 전은 없음(404), 예약 시각이 지나면 보임, setup 작품은 목록·페이지에 없음", async () => {
  const db = makeDb();
  const { report, store } = loadRoutes(db, []);
  await report.POST(req("/api/novel/report", SETUP));
  await report.POST(req("/api/novel/report", PENDING(1)));
  await report.POST(req("/api/novel/report", PENDING(2)));
  await store.approveEpisode("my-novel", 1, T0);
  await store.approveEpisode("my-novel", 2, T0); // T0 + 24h

  // setup 작품은 비공개
  assert.deepEqual(await store.publicWorks(T0), []);
  assert.equal(await store.publicWork("my-novel", T0), null);
  assert.equal(await store.publicEpisode("my-novel", 1, T0), null);

  db.data.works[0].status = "active";
  const now = new Date(T0.getTime() + HOUR);
  assert.equal((await store.publicWorks(now))[0].published, 1);
  const w = await store.publicWork("my-novel", now);
  assert.deepEqual(w.episodes.map((e) => e.number), [1]);
  const e1 = await store.publicEpisode("my-novel", 1, now);
  assert.equal(e1.episode.number, 1);
  assert.equal(e1.next, null, "예약 전인 2화는 다음 화로도 안 보인다");
  assert.equal(await store.publicEpisode("my-novel", 2, now), null, "예약 전 404");
  const later = new Date(T0.getTime() + 25 * HOUR);
  assert.equal((await store.publicEpisode("my-novel", 2, later)).prev, 1);
  assert.equal((await store.publicEpisode("my-novel", 1, later)).next, 2);
  assert.equal(await store.publicEpisode("my-novel", 3, later), null);
  assert.equal(rules.isPublished({ status: "approved", publishAt: null }, later), false);
  db.data.works[0].status = "dropped";
  assert.equal(await store.publicWork("my-novel", later), null);
});

test("본문은 빈 줄 기준 문단으로만 나뉘고 제어문자는 지운다(HTML 해석 없음)", () => {
  assert.deepEqual(rules.paragraphs("첫 줄\n둘째 줄\n\n\n<b>문단</b>\r\n\r\n끝\u0007"), ["첫 줄\n둘째 줄", "<b>문단</b>", "끝"]);
});

test("공개 읽기는 lib/novel/public.ts 로 분리: draft* 칸을 읽지 않고, store.ts 는 같은 함수를 다시 내보낸다", () => {
  const pubSrc = fs.readFileSync(path.join(repo, "lib/novel/public.ts"), "utf8");
  assert.doesNotMatch(pubSrc, /draft/i, "공개 읽기는 draft* 칸을 모른다");
  assert.doesNotMatch(pubSrc, /lib\/novel\/store/, "공개 읽기는 store.ts 에 의존하지 않는다");
  const storeSrc = fs.readFileSync(path.join(repo, "lib/novel/store.ts"), "utf8");
  assert.match(storeSrc, /export \{ publicEpisode, publicWork, publicWorks \} from "@\/lib\/novel\/public"/);
  for (const f of ["app/novel/page.tsx", "app/novel/[slug]/page.tsx", "app/novel/[slug]/[number]/page.tsx"]) {
    const src = fs.readFileSync(path.join(repo, f), "utf8");
    assert.match(src, /@\/lib\/novel\/public"/, f);
    assert.doesNotMatch(src, /@\/lib\/novel\/store"/, f);
  }
});
