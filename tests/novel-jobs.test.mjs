// 소설 실행 일감(7-1) 홈페이지 쪽 시험: lib/novel/jobRules.ts(순수 규칙) + lib/novel/jobStore.ts(가짜 DB: 메모리) + 워커 API 라우트(진짜 토큰 관문, 토큰 확인만 가짜)
// + 커넥터 도구 5개(등록·읽기 전용 표시·줄 범위·검증). 실제 DB·네트워크·텔레그램은 쓰지 않는다. 실행: node tests/novel-jobs.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const rules = loadTs("lib/novel/jobRules.ts");
const MIN = 60_000;
const T0 = new Date(Date.now() - 2 * 60 * MIN); // 서버 코드는 진짜 시계(new Date())를 쓰는 곳이 있어 시험 시계도 지금 기준으로

// ───────── 순수 규칙 ─────────
test("모드 → cycle.sh 인자: 검수만/메모 반영해 수정/처음부터 새로 쓰기", () => {
  assert.deepEqual(rules.paramsForMode("check"), { fresh: false, skipWrite: true, maxRewrites: 0 });
  assert.deepEqual(rules.paramsForMode("revise"), { fresh: false, skipWrite: true, maxRewrites: 2 });
  assert.deepEqual(rules.paramsForMode("fresh"), { fresh: true, skipWrite: false, maxRewrites: 0 });
  assert.equal(rules.isJobMode("check"), true);
  assert.equal(rules.isJobMode("rm -rf"), false);
  assert.equal(rules.DEFAULT_DAILY_COST_CAP_USD, 8);
  assert.equal(rules.JOB_TIMEOUT_MIN, 40);
});

test("줄 번호 본문: 파일의 줄 기준(L줄번호와 같음), 범위, 끝 줄바꿈", () => {
  const body = "# 001화 제목\n\n첫 문단\n\n둘째 문단\n";
  const all = rules.numberedLines(body);
  assert.deepEqual(all.map((l) => l.line), [1, 2, 3, 4, 5]);
  assert.equal(all[2].text, "첫 문단");
  assert.deepEqual(rules.numberedLines(body, 3, 4), [{ line: 3, text: "첫 문단" }, { line: 4, text: "" }]);
  assert.deepEqual(rules.numberedLines(body, 5, 999).map((l) => l.line), [5]);
  assert.equal(rules.lineCount(body), 5);
  assert.equal(rules.lineCount("a\r\nb\r\n"), 2);
  assert.equal(rules.numberedLines("a\r\nb")[1].text, "b", "CRLF 는 LF 로");
});

test("검수 표 파싱: 필수가 위, 위치에서 줄 번호, 표 밖·체크리스트 행 제외", () => {
  const md = [
    "# 001화 검수 결과",
    "| 등급(필수/권장) | 유형 | 위치(L줄번호) | 내용 | 수정 제안 |",
    "|---|---|---|---|---|",
    "| 권장 | quality | L3 | 비유가 많다 | 줄인다 |",
    "| 필수 | consistency | L23 | 시점 위반 | 눈으로 보는 것만 |",
    "| 필수 | quality | L5, L7~L9 | 단문 연속 | 이어 쓴다 |",
    "| 권장 | quality | 전체 | 종결 비율 | 바꾼다 |",
    "",
    "## 체크리스트",
    "| 항목 | O/X | 근거 위치 |",
    "|---|---|---|",
    "| 1. 설정 일관성 | X | L23 |",
    "",
    "VERDICT: FAIL",
  ].join("\n");
  const items = rules.parseReviewItems(md);
  assert.deepEqual(items.map((i) => i.grade), ["필수", "필수", "권장", "권장"]);
  assert.deepEqual(items[0].lines, [23]);
  assert.deepEqual(items[1].lines, [5, 7, 8, 9]);
  assert.deepEqual(items[3].lines, [], "전체");
  assert.equal(items[0].fix, "눈으로 보는 것만");
  assert.equal(rules.parseVerdict(md), "FAIL");
  assert.equal(rules.parseVerdict("VERDICT: PASS\n"), "PASS");
  assert.equal(rules.parseVerdict("없음"), null);
  assert.deepEqual(rules.parseReviewItems("| 필수 | a | b |"), [{ grade: "필수", type: "a", where: "b", lines: [], text: "", fix: "" }]);
});

test("메모 한 줄 형식과 입력 검증", () => {
  assert.equal(rules.memoLine({ kind: "필수", line: 23, text: "시점 고치기" }), "- (필수) [L23] 시점 고치기");
  assert.equal(rules.memoLine({ kind: "권장", line: null, text: "전체\n톤" }), "- (권장) 전체 톤");
  assert.deepEqual(rules.parseNoteInput({ line: 5, kind: "필수", text: " 고쳐 " }), { ok: true, value: { line: 5, kind: "필수", text: "고쳐" } });
  assert.equal(rules.parseNoteInput({ kind: "권장", text: "x" }).value.line, null);
  assert.equal(rules.parseNoteInput({ text: "x" }).value.kind, "권장", "종류 생략은 권장");
  for (const bad of [{ kind: "중요", text: "x" }, { kind: "필수", text: "  " }, { kind: "필수", text: "x", line: 0 }, { kind: "필수", text: "x", line: 1.5 }, { kind: "필수", text: "x".repeat(1001) }, null, []])
    assert.equal(rules.parseNoteInput(bad).ok, false);
});

test("비용 한도·상태 전이·완료 보고 파싱", () => {
  assert.equal(rules.overCap(7.99, 8), false);
  assert.equal(rules.overCap(8, 8), true);
  assert.equal(rules.cleanCap("12.345"), 12.35);
  for (const bad of [-1, "abc", 1001, NaN, null]) assert.equal(rules.cleanCap(bad), null);
  assert.deepEqual(rules.jobAction("pending_approval", "approve"), { ok: true, to: "approved" });
  assert.equal(rules.jobAction("running", "approve").ok, false);
  assert.equal(rules.jobAction("done", "cancel").ok, false);
  assert.equal(rules.jobAction("running", "cancel").ok, true);
  const p = rules.parseComplete({ ok: true, verdict: "PASS", mustCount: 0, recCount: 2, charCount: 5012, costUsd: 0.4, summary: "s", logTail: "a\nb", chapter: "c", review: "r", appliedNoteIds: ["n1", "../x", 5] });
  assert.equal(p.ok, true);
  assert.deepEqual(p.value.appliedNoteIds, ["n1"], "id 형식이 아닌 것은 버림");
  assert.equal(p.value.costUsd, 0.4);
  assert.equal(rules.parseComplete({ verdict: "PASS" }).ok, false);
  assert.equal(rules.parseComplete({ ok: true, costUsd: -3, verdict: "WIN" }).value.costUsd, 0);
  assert.equal(rules.parseComplete({ ok: true, verdict: "WIN" }).value.verdict, null);
  assert.equal(rules.tailLines(Array.from({ length: 300 }, (_, i) => `l${i}`).join("\n")).split("\n").length, 200);
});

// ───────── 가짜 DB ─────────
const val = (v) => (v instanceof Date ? v.getTime() : v);
function matches(row, where, db) {
  for (const [k, c] of Object.entries(where ?? {})) {
    if (k === "OR") {
      if (!c.some((w) => matches(row, w, db))) return false;
      continue;
    }
    if (k === "work") {
      const w = db.works.find((x) => x.id === row.workId);
      if (!w || !matches(w, c, db)) return false;
      continue;
    }
    const v = row[k];
    if (c !== null && typeof c === "object" && !(c instanceof Date)) {
      if ("in" in c && !c.in.includes(v)) return false;
      if ("gte" in c && !(v != null && val(v) >= val(c.gte))) return false;
      if ("lt" in c && !(v != null && val(v) < val(c.lt))) return false;
      if ("not" in c && (c.not === null ? v == null : val(v) === val(c.not))) return false;
    } else if (val(v ?? null) !== val(c)) return false;
  }
  return true;
}

function makeDb(clock) {
  const db = { works: [], episodes: [], jobs: [], notes: [], settings: new Map(), telegram: [], seq: 0 };
  const id = (p) => `${p}${++db.seq}`;
  const table = (rows, prefix, defaults) => ({
    async create({ data }) {
      const row = { id: id(prefix), createdAt: clock(), updatedAt: clock(), ...defaults, ...data };
      rows.push(row);
      return { ...row };
    },
    async findUnique({ where }) {
      const row = rows.find((r) => (where.id ? r.id === where.id : r.slug === where.slug));
      return row ? { ...row } : null;
    },
    async findFirst({ where, orderBy }) {
      const list = rows.filter((r) => matches(r, where, db));
      return list[0] ? { ...list[0] } : null;
    },
    async findMany({ where, orderBy, take } = {}) {
      let list = rows.filter((r) => matches(r, where, db)).map((r) => ({ ...r }));
      const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [{ createdAt: "asc" }]).map((o) => Object.entries(o)[0]);
      list.sort((a, b) => {
        for (const [key, dir] of keys) {
          const x = val(a[key]);
          const y = val(b[key]);
          if (x === y) continue;
          if (x == null) return 1; // null 은 뒤로(Postgres asc 기본)
          if (y == null) return -1;
          return (x > y ? 1 : -1) * (dir === "desc" ? -1 : 1);
        }
        return 0;
      });
      return take ? list.slice(0, take) : list;
    },
    async update({ where, data }) {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data, { updatedAt: clock() });
      return { ...row };
    },
    async updateMany({ where, data }) {
      const list = rows.filter((r) => matches(r, where, db));
      for (const r of list) Object.assign(r, data, { updatedAt: clock() });
      return { count: list.length };
    },
    async deleteMany({ where }) {
      const list = rows.filter((r) => matches(r, where, db));
      for (const r of list) rows.splice(rows.indexOf(r), 1);
      return { count: list.length };
    },
    async count({ where }) {
      return rows.filter((r) => matches(r, where, db)).length;
    },
    async groupBy({ by, where }) {
      const groups = new Map();
      for (const r of rows.filter((x) => matches(x, where, db))) {
        const key = by.map((b) => r[b]).join("|");
        const g = groups.get(key) ?? { ...Object.fromEntries(by.map((b) => [b, r[b]])), _count: 0 };
        g._count++;
        groups.set(key, g);
      }
      return [...groups.values()];
    },
  });
  db.jobTable = { ...table(db.jobs, "job", { status: "pending_approval", requestedBy: "web", overrideCap: false, autoApproved: false, costUsd: 0, approvedAt: null, startedAt: null, finishedAt: null, verdict: null, mustCount: null, recCount: null, charCount: null, summary: null, logTail: null }) };
  db.jobTable.aggregate = async ({ where }) => ({ _sum: { costUsd: db.jobs.filter((r) => matches(r, where, db)).reduce((n, r) => n + r.costUsd, 0) } });
  db.prisma = {
    novelJob: db.jobTable,
    novelNote: table(db.notes, "note", { status: "open", createdBy: "admin", line: null }),
    novelWork: {
      ...table(db.works, "w", { status: "setup", paused: false }),
      async findMany() {
        return db.works.map((w) => ({ ...w, episodes: db.episodes.filter((e) => e.workId === w.id).sort((a, b) => a.number - b.number) }));
      },
    },
    novelEpisode: {
      ...table(db.episodes, "ep", { status: "planned", draftBody: null, draftReview: null, draftVerdict: null, draftMust: null, draftRec: null, draftChars: null, draftSyncedAt: null, body: null, publishAt: null, title: null }),
      async findUnique({ where }) {
        const k = where.workId_number;
        const row = db.episodes.find((e) => e.workId === k.workId && e.number === k.number);
        return row ? { ...row } : null;
      },
      async upsert({ where, create, update }) {
        const k = where.workId_number;
        const row = db.episodes.find((e) => e.workId === k.workId && e.number === k.number);
        if (row) return Object.assign(row, update);
        const n = { id: id("ep"), createdAt: clock(), updatedAt: clock(), status: "planned", draftBody: null, draftReview: null, draftVerdict: null, draftMust: null, draftRec: null, draftChars: null, draftSyncedAt: null, body: null, publishAt: null, title: null, ...create };
        db.episodes.push(n);
        return n;
      },
    },
    // 원자적 가져오기 흉내: 승인된 것 중 같은 작품에 running 이 없는 가장 오래된 것
    async $queryRaw(_strings, now) {
      const cand = db.jobs
        .filter((j) => j.status === "approved" && !db.jobs.some((r) => r.status === "running" && r.workSlug === j.workSlug))
        .sort((a, b) => (val(a.approvedAt) ?? val(a.createdAt)) - (val(b.approvedAt) ?? val(b.createdAt)))[0];
      if (!cand) return [];
      Object.assign(cand, { status: "running", startedAt: now, updatedAt: now });
      return [{ id: cand.id }];
    },
  };
  return db;
}

function setup() {
  let now = T0.getTime();
  const clock = () => new Date(now);
  const db = makeDb(clock);
  const settings = {
    getSettingValue: async (k) => db.settings.get(k) ?? null,
    setSettingValue: async (k, v) => (v === null ? db.settings.delete(k) : db.settings.set(k, v)),
  };
  const store = loadTs("lib/novel/jobStore.ts", {
    "@/lib/prisma": { __esModule: true, default: db.prisma },
    "@/lib/factory/settings": settings,
    "@/lib/factory/telegram": { notifyText: async (text) => db.telegram.push(text) },
    "@prisma/client": { Prisma: {} },
    "@/lib/novel/jobRules": rules,
  });
  const advance = (ms) => (now += ms);
  const seed = async () => {
    const w = await db.prisma.novelWork.create({ data: { slug: "my-novel", title: "내 소설", status: "active" } });
    await db.prisma.novelEpisode.upsert({ where: { workId_number: { workId: w.id, number: 1 } }, create: { workId: w.id, number: 1, draftBody: "# 001화 제목\n\n첫 문단\n\n둘째 문단\n", draftReview: "| 필수 | quality | L3 | 길다 | 줄여 |\n\nVERDICT: FAIL\n", draftVerdict: "FAIL", draftMust: 1, draftRec: 0 }, update: {} });
    return w;
  };

  return { db, store, advance, seed, clock };
}

const done = (over = {}) => rules.parseComplete({ ok: true, verdict: "PASS", mustCount: 0, recCount: 1, charCount: 5000, costUsd: 0.4, summary: "끝", logTail: "로그", chapter: "# 001화 새 제목\n\n새 본문\n", review: "VERDICT: PASS\n", appliedNoteIds: [], ...over }).value;

test("작업 만들기: 없는 작품·원고 없는 화·중복 거부, 기본은 승인 대기(알림)", async () => {
  const { store, db, seed } = setup();
  assert.equal((await store.createJob({ workSlug: "nope-nope", episode: 1, mode: "check", requestedBy: "web" })).status, 404);
  await seed();
  assert.equal((await store.createJob({ workSlug: "my-novel", episode: 0, mode: "check", requestedBy: "web" })).status, 400);
  assert.equal((await store.createJob({ workSlug: "my-novel", episode: 2, mode: "check", requestedBy: "web" })).ok, false, "없는 화");
  const a = await store.createJob({ workSlug: "my-novel", episode: 1, mode: "revise", requestedBy: "chat" });
  assert.equal(a.ok, true);
  assert.equal(a.value.status, "pending_approval", "만들기만 하고 시작은 사람이 승인");
  assert.equal(a.value.requestedBy, "chat");
  assert.deepEqual(a.value.params, { fresh: false, skipWrite: true, maxRewrites: 2 });
  assert.match(db.telegram[0], /승인 대기/);
  const dup = await store.createJob({ workSlug: "my-novel", episode: 1, mode: "revise", requestedBy: "web" });
  assert.equal(dup.status, 409);
  assert.equal((await store.createJob({ workSlug: "my-novel", episode: 1, mode: "check", requestedBy: "web" })).ok, true, "다른 모드는 가능");
  // 처음부터 새로 쓰기는 원고가 없어도 만들 수 있다
  const fresh = await store.createJob({ workSlug: "my-novel", episode: 9, mode: "fresh", requestedBy: "web" });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.value.status, "pending_approval");
  assert.deepEqual(fresh.value.params, { fresh: true, skipWrite: false, maxRewrites: 0 });
});

test("승인→가져오기(원자적)→완료: 원고·검수·판정·비용이 올라가고 메모는 applied, 공개 본문은 그대로", async () => {
  const { store, db, seed, advance } = setup();
  const w = await seed();
  const epRow = db.episodes[0];
  epRow.body = "공개 본문";
  epRow.status = "approved";
  epRow.publishAt = new Date(T0.getTime() - 1000);
  await store.addNote({ workSlug: "my-novel", episode: 1, line: 3, kind: "필수", text: "첫 문단 고치기", createdBy: "admin" });
  const note2 = await store.addNote({ workSlug: "my-novel", episode: 1, line: null, kind: "권장", text: "전체 톤", createdBy: "chat" });
  const job = (await store.createJob({ workSlug: "my-novel", episode: 1, mode: "revise", requestedBy: "web" })).value;
  assert.equal(await store.claimNextJob(), null, "승인 전에는 가져가지 못한다");
  assert.equal((await store.approveJob(job.id)).ok, true);
  assert.equal((await store.approveJob(job.id)).status, 409, "두 번 승인 불가");
  const claim = await store.claimNextJob();
  assert.equal(claim.id, job.id);
  assert.equal(claim.notes.length, 2);
  assert.equal(claim.notes[0].memoLine, "- (필수) [L3] 첫 문단 고치기");
  assert.equal(claim.timeoutMin, 40);
  assert.equal(db.jobs[0].status, "running");
  assert.equal(await store.claimNextJob(), null, "이미 running 이라 중복 실행 없음");
  assert.deepEqual(await store.reportProgress(job.id, "진행 중 로그"), { found: true, cancel: false });
  assert.equal(db.jobs[0].logTail, "진행 중 로그");
  const noteIds = db.notes.map((n) => n.id);
  advance(5 * MIN);
  const r = await store.completeJob(job.id, done({ appliedNoteIds: noteIds }));
  assert.deepEqual(r.value, { status: "done" });
  assert.equal(db.jobs[0].status, "done");
  assert.equal(db.jobs[0].verdict, "PASS");
  assert.equal(db.jobs[0].costUsd, 0.4);
  assert.equal(db.episodes[0].draftBody, "# 001화 새 제목\n\n새 본문\n");
  assert.equal(db.episodes[0].draftVerdict, "PASS");
  assert.equal(db.episodes[0].body, "공개 본문", "공개 본문은 건드리지 않는다");
  assert.equal(db.episodes[0].status, "approved", "화 상태·예약 발행도 그대로");
  assert.ok(db.notes.every((n) => n.status === "applied"), "메모 applied");
  assert.equal((await store.addNote({ workSlug: "my-novel", episode: 1, line: 999, kind: "필수", text: "x", createdBy: "admin" })).ok, false, "없는 줄");
  assert.ok(note2.ok);
  assert.match(db.telegram.at(-1), /작업 완료/);
  assert.equal((await store.completeJob(job.id, done())).status, 409, "끝난 작업에 또 보고하면 거절");
  void w;
});

test("공개 본문이 없는 화에서 원고만 올라오면 planned 로 만들고 공개 조건은 그대로", async () => {
  const { store, db } = setup();
  const r = await store.saveDraft({ slug: "from-pc-only", episode: 3, chapter: "# 003화 PC 폴더에만 있던 화\n\n본문\n", review: "VERDICT: PASS\n", verdict: "PASS", must: 0, rec: 0, chars: 4800, title: "PC 폴더에만 있던 화" });
  assert.deepEqual(r.value, { created: true, changed: true });
  assert.equal(db.works[0].status, "setup", "설정 승인 전으로 만들어 공개·기존 실행기에 영향 없음");
  assert.equal(db.works[0].paused, true);
  assert.equal(db.episodes[0].status, "planned");
  assert.equal(db.episodes[0].body, null);
  assert.equal(db.episodes[0].title, "PC 폴더에만 있던 화");
  assert.equal((await store.saveDraft({ slug: "from-pc-only", episode: 3, chapter: "# 003화 PC 폴더에만 있던 화\n\n본문\n" })).value.changed, false);
});

test("비용 한도: 넘으면 승인 때 한 번 더 확인, 승인된 것도 한도 때문에 승인 대기로 되돌림, 사람이 확인한 것은 통과", async () => {
  const { store, db, seed, advance } = setup();
  await seed();
  db.jobs.push({ id: "old1", workSlug: "x", episode: 1, status: "done", costUsd: 7.9, finishedAt: new Date(T0.getTime() - 60 * MIN), createdAt: T0, updatedAt: T0 });
  assert.equal((await store.costStatus()).over, false);
  db.jobs.push({ id: "old2", workSlug: "x", episode: 2, status: "done", costUsd: 0.2, finishedAt: new Date(T0.getTime() - 10 * MIN), createdAt: T0, updatedAt: T0 });
  const cost = await store.costStatus();
  assert.equal(cost.over, true);
  assert.equal(cost.capUsd, 8);
  const j = (await store.createJob({ workSlug: "my-novel", episode: 1, mode: "check", requestedBy: "web" })).value;
  assert.equal(j.status, "pending_approval");
  assert.match(db.telegram.at(-1), /한도를 넘었어요/);
  const refused = await store.approveJob(j.id);
  assert.equal(refused.status, 409);
  assert.equal(refused.extra.overCap, true);
  assert.equal(db.jobs.find((x) => x.id === j.id).status, "pending_approval");
  assert.equal((await store.approveJob(j.id, true)).ok, true, "한도 확인 승인");
  assert.equal(db.jobs.find((x) => x.id === j.id).overrideCap, true);
  assert.equal((await store.claimNextJob()).id, j.id, "한도를 확인하고 승인한 것은 시작");
  // 설정으로 한도를 올리면 통과, 24시간이 지나면 다시 통과
  await store.setCapUsd(20);
  assert.equal((await store.costStatus()).over, false);
  await store.setCapUsd(8);
  const j2 = (await store.createJob({ workSlug: "my-novel", episode: 1, mode: "revise", requestedBy: "web" })).value;
  db.jobs.find((x) => x.id === j.id).status = "done";
  db.jobs.find((x) => x.id === j2.id).status = "approved";
  db.jobs.find((x) => x.id === j2.id).approvedAt = T0;
  assert.equal(await store.claimNextJob(), null, "승인됐어도 한도 초과면 승인 대기로 되돌린다");
  assert.equal(db.jobs.find((x) => x.id === j2.id).status, "pending_approval");
  advance(25 * 60 * MIN);
  assert.equal((await store.costStatus(new Date(Date.now() + 25 * 60 * MIN))).over, false, "24시간 뒤 한도 해소");
});

test("자동 승인(5-3): 기본 꺼짐, 켜면 [검수만]만 한도 안에서 바로 승인", async () => {
  const { store, seed } = setup();
  await seed();
  assert.equal((await store.createJob({ workSlug: "my-novel", episode: 1, mode: "check", requestedBy: "web" })).value.status, "pending_approval");
  await store.cancelJob((await store.listJobs("my-novel", 1))[0].id);
  await store.setAutoApproveCheck(true);
  const c = (await store.createJob({ workSlug: "my-novel", episode: 1, mode: "check", requestedBy: "chat" })).value;
  assert.equal(c.status, "approved");
  assert.equal(c.autoApproved, true);
  assert.equal((await store.createJob({ workSlug: "my-novel", episode: 1, mode: "revise", requestedBy: "web" })).value.status, "pending_approval", "수정은 늘 사람이");
  assert.equal((await store.createJob({ workSlug: "my-novel", episode: 5, mode: "fresh", requestedBy: "web" })).value.status, "pending_approval", "새로 쓰기도 늘 사람이");
});

test("취소: 승인 대기·실행 중 취소, 실행 중이면 진행 보고가 cancel=true 로 알려 준다", async () => {
  const { store, db, seed } = setup();
  await seed();
  const j = (await store.createJob({ workSlug: "my-novel", episode: 1, mode: "check", requestedBy: "web" })).value;
  await store.approveJob(j.id);
  await store.claimNextJob();
  assert.equal((await store.cancelJob(j.id)).ok, true);
  assert.equal(db.jobs[0].status, "cancelled");
  assert.deepEqual(await store.reportProgress(j.id, "로그"), { found: true, cancel: true });
  assert.deepEqual(await store.reportProgress("nope", "로그"), { found: false, cancel: true });
  // 취소 뒤 감독 프로그램의 늦은 완료 보고: 원고는 올리되 상태는 취소로 남는다
  const r = await store.completeJob(j.id, done());
  assert.equal(r.value.status, "cancelled");
  assert.equal((await store.cancelJob(j.id)).status, 409, "이미 끝난 작업");
});

test("재시작·끊김: recover 는 running 을 failed 로, 소식이 10분 끊기거나 45분 넘으면 서버가 정리", async () => {
  const { store, db, seed } = setup();
  await seed();
  const mk = async (mode, ep) => {
    const j = (await store.createJob({ workSlug: "my-novel", episode: ep, mode, requestedBy: "web" })).value;
    await store.approveJob(j.id);
    return j;
  };
  const a = await mk("check", 1);
  await store.claimNextJob();
  assert.equal(await store.recoverRunning(), 1);
  assert.equal(db.jobs.find((x) => x.id === a.id).status, "failed");
  assert.match(db.jobs.find((x) => x.id === a.id).summary, /다시 시작/);
  assert.equal(await store.recoverRunning(), 0, "두 번째는 할 일 없음");
  assert.equal(await store.claimNextJob(), null, "failed 는 다시 실행되지 않는다(중복 실행 없음)");
  // 소식 끊김
  const b = await mk("revise", 1);
  await store.claimNextJob(T0);
  assert.equal(await store.sweepStale(new Date(T0.getTime() + 9 * MIN)), 0);
  assert.equal(await store.sweepStale(new Date(T0.getTime() + 11 * MIN)), 1);
  assert.equal(db.jobs.find((x) => x.id === b.id).status, "failed");
  // 하트비트가 이어지는 긴 작업은 45분(40+5)까지만
  const c = await mk("fresh", 1);
  const t1 = new Date(T0.getTime() + 11 * MIN);
  await store.claimNextJob(t1);
  const job = db.jobs.find((x) => x.id === c.id);
  job.updatedAt = new Date(T0.getTime() + 55 * MIN);
  assert.equal(await store.sweepStale(new Date(T0.getTime() + 57 * MIN)), 1, "시작 뒤 45분 넘음(하트비트가 이어져도)");
});

test("한 작품에 도는 작업이 있으면 같은 작품의 다음 작업은 기다린다(작품당 하나)", async () => {
  const { store, db, seed } = setup();
  const w = await seed();
  await db.prisma.novelEpisode.upsert({ where: { workId_number: { workId: w.id, number: 2 } }, create: { workId: w.id, number: 2, draftBody: "x\n" }, update: {} });
  const a = (await store.createJob({ workSlug: "my-novel", episode: 1, mode: "check", requestedBy: "web" })).value;
  const b = (await store.createJob({ workSlug: "my-novel", episode: 2, mode: "check", requestedBy: "web" })).value;
  await store.approveJob(b.id);
  await new Promise((r) => setTimeout(r, 15));
  await store.approveJob(a.id);
  assert.equal((await store.claimNextJob()).id, b.id, "먼저 승인된 것부터");
  assert.equal(await store.claimNextJob(), null, "같은 작품은 하나씩");
  await store.completeJob(b.id, done());
  assert.equal((await store.claimNextJob()).id, a.id);
});

test("화 보기(웹·채팅 공용): 줄 번호·범위·검수·열린 메모·최근 작업·비용", async () => {
  const { store, seed } = setup();
  await seed();
  await store.addNote({ workSlug: "my-novel", episode: 1, line: 3, kind: "필수", text: "메모", createdBy: "chat" });
  const v = await store.episodeDraftView("my-novel", 1);
  assert.equal(v.totalLines, 5);
  assert.equal(v.lines[2].text, "첫 문단");
  assert.equal(v.review.items[0].lines[0], 3);
  assert.equal(v.review.verdictLabel, "재집필 필요");
  assert.equal(v.notes.length, 1);
  assert.equal(v.cost.capUsd, 8);
  assert.deepEqual((await store.episodeDraftView("my-novel", 1, { from: 4, to: 5 })).lines.map((l) => l.line), [4, 5]);
  assert.equal(await store.episodeDraftView("my-novel", 7), null);
  assert.equal(await store.episodeDraftView("nope-nope", 1), null);
  const list = await store.listNovelsForChat();
  assert.equal(list[0].episodes[0].openNotes, 1);
  assert.equal(list[0].episodes[0].verdict, "FAIL");
  assert.equal(list[0].episodes[0].hasText, true);
  assert.equal(list[0].episodes[0].published, false);
});

// ───────── 라우트(진짜 관문, 가짜 토큰 확인) ─────────
test("워커 라우트는 작업 PC 토큰이 없으면 401, 관리자 라우트는 관리자만(소스 확인)", () => {
  for (const f of ["next", "progress", "complete", "notes", "recover", "content"]) {
    const src = fs.readFileSync(path.join(repo, `app/api/novel/jobs/${f}/route.ts`), "utf8");
    assert.match(src, /guardWorker\(req\)/, `${f}: 워커 토큰 관문`);
  }
  const adminFiles = ["jobs/route.ts", "jobs/[id]/route.ts", "job-settings/route.ts", "works/[slug]/episodes/[number]/draft/route.ts", "works/[slug]/episodes/[number]/notes/route.ts"];
  for (const f of adminFiles) {
    const src = fs.readFileSync(path.join(repo, "app/api/admin/novel", f), "utf8");
    assert.match(src, /adminGate\(/, `${f}: 관리자 관문`);
  }
  // 공개 페이지는 새 컬럼(draft*)을 읽지 않는다
  const store = fs.readFileSync(path.join(repo, "lib/novel/public.ts"), "utf8");
  assert.doesNotMatch(store, /draft(Body|Review|Verdict)/, "공개 조회(publicEpisode 등)는 draft 컬럼을 모른다");
  for (const f of ["app/novel/page.tsx", "app/novel/[slug]/page.tsx", "app/novel/[slug]/[number]/page.tsx"]) assert.doesNotMatch(fs.readFileSync(path.join(repo, f), "utf8"), /draft|NovelJob|NovelNote/, f);
});

// ───────── 커넥터 도구 ─────────
test("커넥터 도구 5개: 등록, 읽기 전용 표시, 입력 스키마, 줄 범위 인자", () => {
  const src = fs.readFileSync(path.join(repo, "lib/factory/mcp.ts"), "utf8");
  for (const name of ["novel_list", "novel_get_episode", "novel_add_note", "novel_enqueue", "novel_get_job"]) {
    assert.match(src, new RegExp(`name: "${name}"`), `${name} 등록`);
    assert.match(src, new RegExp(`case "${name}":`), `${name} 분기`);
  }
  const block = (name) => src.slice(src.indexOf(`name: "${name}"`), src.indexOf("annotations", src.indexOf(`name: "${name}"`)) + 120);
  for (const name of ["novel_list", "novel_get_episode", "novel_get_job"]) assert.match(block(name), /annotations: READ_ONLY/, `${name} 읽기 전용`);
  assert.match(block("novel_get_episode"), /from:[\s\S]*to:/, "줄 범위 인자");
  assert.match(block("novel_enqueue"), /enum: \["check", "revise", "fresh"\]/);
  assert.match(block("novel_add_note"), /enum: \["필수", "권장"\]/);
  assert.match(src, /requestedBy: "chat"/, "채팅에서 만든 작업은 chat 으로 표시");
  assert.match(src, /시작은 관리자가 통제실 작품 탭에서 승인해요/, "만들기만 하고 승인은 관리자가");
  assert.match(src, /NOVEL_MAX_LINES = 400/);
  assert.doesNotMatch(src.slice(src.indexOf("async function novelEnqueue"), src.indexOf("async function novelGetJob")), /approveJob/, "채팅 도구는 승인하지 못한다");
});
