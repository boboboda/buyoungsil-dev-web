// 4-4 시험: 블록별 비용·시간 통계
//  - 집계: 결과 분류, 대기/실행/중지 시간, 겹친 일감 토큰 나눔, 에이전트·앱·카드·도구·기간 묶음, 합계·흐름, 7일 요약 한 줄
//  - 기록: 일감·정비·지휘자 한 줄(가짜 DB), 같은 일감은 덮어쓰기, 외부 비용(도구 일감), 다시 맞추기 횟수
//  - 화면·커넥터: 표·막대, 블록의 7일 줄, get_usage_by_block 읽기 전용, API GET 만, 마이그레이션이 데이터를 지우지 않음
// 실행: node tests/run-stats.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const lib = loadTs("lib/factory/runStats.ts");
const NOW = Date.parse("2026-10-15T03:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;
const stat = (o) =>
  lib.cleanStat({ kind: "job", refId: `j${Math.random()}`, agent: "A2", appSlug: "pixel-farm", result: "success", tokens: { input: 1000, output: 500, cacheCreate: 500, cacheRead: 9000 }, waitMs: MIN, runMs: 10 * MIN, at: NOW - DAY / 2, ...o });

// ───────── 결과 분류·시간·토큰 나눔 ─────────
test("결과 분류: 성공 / 실패 / 막힘", () => {
  assert.equal(lib.classifyResult("done"), "success");
  assert.equal(lib.classifyResult("review"), "success");
  assert.equal(lib.classifyResult("failed", "build", "빌드 실패"), "failed");
  assert.equal(lib.classifyResult("failed", "key", "x"), "blocked");
  assert.equal(lib.classifyResult("failed", "merge", "합치기 실패"), "blocked");
  assert.equal(lib.classifyResult("failed", null, "필요한 키가 없어요"), "blocked");
  assert.equal(lib.classifyResult("needs_confirmation"), "blocked");
  assert.equal(lib.classifyResult("failed"), "failed");
});

test("시간: 대기 / 실행 / 일시 중지 (배포 구간은 중지로 빼고, 구간끼리 겹쳐도 한 번만)", () => {
  const t = lib.timingOf({ queuedAt: NOW - 30 * MIN, startedAt: NOW - 20 * MIN, endedAt: NOW, windows: [{ start: NOW - 15 * MIN, end: NOW - 10 * MIN }, { start: NOW - 12 * MIN, end: NOW - 8 * MIN }] });

  assert.equal(t.waitMs, 10 * MIN);
  assert.equal(t.pausedMs, 7 * MIN);
  assert.equal(t.runMs, 13 * MIN);
  const none = lib.timingOf({ queuedAt: null, startedAt: null, endedAt: NOW });

  assert.deepEqual(none, { waitMs: 0, runMs: 0, pausedMs: 0 });
  assert.equal(lib.timingOf({ queuedAt: NOW + 5, startedAt: NOW, endedAt: NOW }).waitMs, 0, "음수 대기는 0");
});

test("겹쳐 돈 일감이 있으면 토큰을 나눠 센다", () => {
  const t = { input: 900, output: 300, cacheCreate: 60, cacheRead: 30 };

  assert.deepEqual(lib.shareTokens(t, 0), t);
  assert.deepEqual(lib.shareTokens(t, 2), { input: 300, output: 100, cacheCreate: 20, cacheRead: 10 });
});

test("에이전트 번호는 지도(4-3)와 같은 규칙, 외부 비용은 도구 일감만", () => {
  const map = loadTs("lib/factory/factoryMap.ts");

  for (const j of [{ kind: "new" }, { kind: "revision" }, { kind: "revision", parallelGroup: "g" }, { kind: "lab" }, { kind: "tool" }, { kind: "revision", releaseKind: "first" }]) {
    assert.equal(lib.agentOf(j), map.agentOfJob({ releaseKind: null, parallelGroup: null, ...j }));
  }
  assert.deepEqual(lib.externalOf("tool", { cost: 12.4 }), { cost: 12, label: "PixelLab 호출" });
  assert.deepEqual(lib.externalOf("revision", { cost: 12 }), { cost: 0, label: null });
  assert.deepEqual(lib.externalOf("tool", null), { cost: 0, label: null });
});

test("한 줄 정리: 이상한 값은 0·실패로, 길이 제한", () => {
  const c = lib.cleanStat({ kind: "job", refId: "x".repeat(200), agent: "A1", result: "weird", tokens: { input: -5, output: NaN, cacheCreate: 3.6, cacheRead: 1 }, runMs: -1, externalCost: Infinity });

  assert.equal(c.refId.length, 80);
  assert.equal(c.result, "failed");
  assert.deepEqual(c.tokens, { input: 0, output: 0, cacheCreate: 4, cacheRead: 1 });
  assert.equal(c.runMs, 0);
  assert.equal(c.externalCost, 0);
});

// ───────── 집계 ─────────
const sample = [
  stat({ agent: "A1", appSlug: "pixel-farm", tokens: { input: 4000, output: 2000, cacheCreate: 1000, cacheRead: 0 }, runMs: 30 * MIN }),
  stat({ agent: "A2", appSlug: "pixel-farm", result: "failed", cardId: "c1", tool: "pixel-art", method: "pixellab", redoCount: 2 }),
  stat({ agent: "A2", appSlug: "other-app", result: "blocked", pausedMs: 4 * MIN }),
  stat({ kind: "job", agent: "T", appSlug: "pixel-farm", cardId: "c1", tool: "pixel-art", method: "pixellab", tokens: {}, externalCost: 7, externalLabel: "PixelLab 호출", runMs: 2 * MIN }),
  stat({ kind: "maintenance", agent: "M1", appSlug: null, tokens: { input: 100, output: 100, cacheCreate: 0, cacheRead: 0 } }),
  stat({ agent: "A2", appSlug: "pixel-farm", at: NOW - 3 * DAY }), // 주 안, 일 밖
  stat({ agent: "A2", appSlug: "pixel-farm", at: NOW - 20 * DAY }), // 월 안, 주 밖
  stat({ agent: "A2", appSlug: "pixel-farm", at: NOW - 40 * DAY }), // 월 밖
];

test("에이전트 종류별: 일 / 주 / 월 기간이 다르고 토큰 많은 순", () => {
  const day = lib.aggregate(sample, { by: "agent", period: "day", now: NOW });
  const week = lib.aggregate(sample, { by: "agent", period: "week", now: NOW });
  const month = lib.aggregate(sample, { by: "agent", period: "month", now: NOW });

  assert.equal(day.total.runs, 5);
  assert.equal(week.total.runs, 6);
  assert.equal(month.total.runs, 7);
  assert.equal(day.rows[0].key, "A1", "토큰이 가장 많은 에이전트가 먼저");
  const a2 = day.rows.find((r) => r.key === "A2");

  assert.equal(a2.runs, 2);
  assert.equal(a2.failed, 1);
  assert.equal(a2.blocked, 1);
  assert.equal(a2.redo, 2);
  assert.equal(a2.pausedMs, 4 * MIN);
  assert.equal(a2.waitMs, 2 * MIN);
  assert.equal(day.total.tokens, day.rows.reduce((n, r) => n + r.tokens, 0));
  assert.equal(day.total.success + day.total.failed + day.total.blocked, day.total.runs);
});

test("토큰 합계는 입력+출력+캐시 생성(캐시 읽기 제외)", () => {
  const r = lib.aggregate([stat({ tokens: { input: 1, output: 2, cacheCreate: 3, cacheRead: 1000 } })], { by: "agent", period: "day", now: NOW });

  assert.equal(r.total.tokens, 6);
  assert.equal(r.total.tokensDetail.cacheRead, 1000);
});

test("앱별 · 카드별 · 도구·방법별 묶음과 이름 붙이기, 없는 값은 따로 묶음", () => {
  const byApp = lib.aggregate(sample, { by: "app", period: "week", now: NOW });

  assert.ok(byApp.rows.find((r) => r.key === "pixel-farm").runs >= 4);
  assert.ok(byApp.rows.find((r) => r.key === "").label.includes("앱 없음"));
  const byCard = lib.aggregate(sample, { by: "card", period: "day", now: NOW, labelOf: (_b, k) => `카드:${k}` });

  assert.equal(byCard.rows.find((r) => r.key === "c1").label, "카드:c1");
  assert.equal(byCard.rows.find((r) => r.key === "c1").runs, 2);
  assert.ok(byCard.rows.find((r) => r.key === "").label.includes("카드"));
  const byTool = lib.aggregate(sample, { by: "tool", period: "day", now: NOW });
  const px = byTool.rows.find((r) => r.key === "pixel-art/pixellab");

  assert.equal(px.runs, 2);
  assert.equal(px.externalCost, 7);
  assert.equal(px.externalLabel, "PixelLab 호출");
  assert.equal(byTool.total.externalCost, 7);
});

test("앱 필터와 흐름 막대(일 7칸 · 주 8칸 · 월 6칸)", () => {
  const only = lib.aggregate(sample, { by: "agent", period: "week", now: NOW, filter: (s) => s.appSlug === "other-app" });

  assert.equal(only.total.runs, 1);
  const day = lib.aggregate(sample, { by: "agent", period: "day", now: NOW });
  const week = lib.aggregate(sample, { by: "agent", period: "week", now: NOW });
  const month = lib.aggregate(sample, { by: "agent", period: "month", now: NOW });

  assert.equal(day.trend.length, 7);
  assert.equal(week.trend.length, 8);
  assert.equal(month.trend.length, 6);
  assert.equal(day.trend.reduce((n, t) => n + t.runs, 0), 6, "최근 7일 안의 6개");
});

test("블록의 7일 요약 한 줄", () => {
  assert.equal(lib.summaryLine(null), "7일 기록 없음");
  const w = lib.aggregate(sample, { by: "agent", period: "week", now: NOW }).rows.find((r) => r.key === "A2");
  const line = lib.summaryLine(w);

  assert.match(line, /^7일 \d+회 · .+ 토큰 · .+/);
  assert.match(line, /실패·막힘 2/);
  const tool = lib.aggregate(sample, { by: "agent", period: "week", now: NOW }).rows.find((r) => r.key === "T");

  assert.match(lib.summaryLine(tool), /PixelLab 호출 7/);
});

test("블록 id → 7일 줄: 종류에 맞는 블록만, 기록 없으면 '7일 기록 없음'", () => {
  const ids = ["agent:A1", "agent:H1", "app:pixel-farm", "project:pixel-farm", "card:c1", "tool:pixel-art", "method:pixel-art:pixellab", "method:pixel-art:default", "machine:main-pc", "domain:example.com"];
  const lines = lib.nodeUsageLines(sample, ids, NOW);

  assert.match(lines["agent:A1"], /^7일 1회/);
  assert.equal(lines["agent:H1"], "7일 기록 없음");
  assert.equal(lines["app:pixel-farm"], lines["project:pixel-farm"]);
  assert.match(lines["card:c1"], /^7일 2회/);
  assert.match(lines["tool:pixel-art"], /^7일 2회/);
  assert.match(lines["method:pixel-art:pixellab"], /^7일 2회/);
  assert.equal(lines["method:pixel-art:default"], "7일 기록 없음", "방법이 비어 있는 블록은 도구만 있는 줄과 맞춘다(여기선 기록 없음)");
  assert.equal(lines["machine:main-pc"], undefined);
  assert.equal(lines["domain:example.com"], undefined);
});

test("커넥터 글자 표: 읽기 좋은 한 줄씩, 비밀 값 없음", () => {
  const txt = lib.usageText(lib.aggregate(sample, { by: "agent", period: "week", now: NOW }));

  assert.match(txt, /에이전트 종류별/);
  assert.match(txt, /A2: \d+회\(성공 \d+·실패 \d+·막힘 \d+\)/);
  assert.match(txt, /합계:/);
  assert.match(lib.usageText(lib.aggregate([], { by: "app", period: "day", now: NOW })), /기록이 없어요/);
  assert.doesNotMatch(txt, /token=|secret|password/i);
});

// ───────── 기록(가짜 DB) ─────────
function fakeDb(job, extra = {}) {
  const saved = new Map();
  const db = {
    saved,
    factoryJob: {
      findUnique: async () => job,
      count: async () => extra.others ?? 0,
    },
    factoryCard: { findUnique: async () => extra.card ?? null },
    claudeEvent: {
      aggregate: async (args) => {
        db.lastEventQuery = args;

        return { _sum: { inputDelta: 3000, outputDelta: 1000, cacheCreateDelta: 200, cacheReadDelta: 50000 } };
      },
    },
    factoryRunStat: {
      upsert: async ({ where, create, update }) => {
        const k = `${where.kind_refId.kind}|${where.kind_refId.refId}`;

        saved.set(k, saved.has(k) ? { ...saved.get(k), ...update } : create);
      },
      deleteMany: async () => ({ count: 0 }),
    },
  };

  return db;
}
const loadDb = (db, windows = []) => {
  const prismaStub = { __esModule: true, default: db };

  return loadTs("lib/factory/runStatsDb.ts", { "@/lib/prisma": prismaStub, "@/lib/factory/deployWindow": { loadDeployWindows: async () => windows }, "@/lib/factory/runStats": lib });
};
const REAL = Date.now(); // 기록 함수는 지금 시각을 끝난 시각으로 쓴다
const baseJob = { id: "job1", kind: "revision", releaseKind: null, parallelGroup: "g1", appSlug: "pixel-farm", cardId: "c1", status: "done", aiEngine: "claude", workerId: "mainpc", attempts: 1, failStage: null, failReason: null, parallelInfo: { rebases: 2 }, toolResult: null, toolRequests: [{ tool: "pixel-art" }], createdAt: new Date(REAL - 60 * MIN), approvedAt: new Date(REAL - 50 * MIN), startedAt: new Date(REAL - 30 * MIN) };

test("일감 기록: 토큰·시간·결과·다시 맞추기·카드의 도구", async () => {
  const db = fakeDb(baseJob, { card: { tool: "pixel-art", method: "pixellab" } });
  const mod = loadDb(db, [{ start: REAL - 20 * MIN, end: REAL - 10 * MIN }]);

  await mod.recordJobStat("job1", "done");
  const row = db.saved.get("job|job1:1");

  assert.equal(row.agent, "A3");
  assert.equal(row.result, "success");
  assert.equal(row.inputTokens, 3000n);
  assert.equal(row.cacheRead, 50000n);
  assert.equal(row.waitMs, 20 * MIN);
  assert.equal(row.pausedMs, 10 * MIN);
  assert.ok(Math.abs(row.runMs - 20 * MIN) < 5000);
  assert.equal(row.redoCount, 2);
  assert.equal(row.tool, "pixel-art");
  assert.equal(row.method, "pixellab");
  assert.deepEqual(db.lastEventQuery.where.session, { project: "pixel-farm", device: "mainpc" });
  await mod.recordJobStat("job1", "done");
  assert.equal(db.saved.size, 1, "같은 일감·같은 시도는 덮어쓴다");
});

test("일감 기록: 같은 앱에서 겹친 일감이 있으면 나눠 세고, Codex·도구 일감은 토큰 0, 실패·외부 비용", async () => {
  const split = fakeDb(baseJob, { others: 2 });

  await loadDb(split).recordJobStat("job1", "failed");
  const s = split.saved.get("job|job1:1");

  assert.equal(s.inputTokens, 1000n);
  assert.equal(s.result, "failed");
  const codex = fakeDb({ ...baseJob, aiEngine: "codex" });

  await loadDb(codex).recordJobStat("job1", "done");
  assert.equal(codex.saved.get("job|job1:1").inputTokens, 0n);
  assert.equal(codex.lastEventQuery, undefined, "Codex 는 사용량 이벤트를 읽지 않는다");
  const tool = fakeDb({ ...baseJob, kind: "tool", parallelGroup: null, parallelInfo: null, toolResult: { cost: 9, arts: [] } });

  await loadDb(tool).recordJobStat("job1", "done");
  const t = tool.saved.get("job|job1:1");

  assert.equal(t.agent, "T");
  assert.equal(t.externalCost, 9);
  assert.equal(t.externalLabel, "PixelLab 호출");
  assert.equal(t.inputTokens, 0n);
  const wait = fakeDb({ ...baseJob, kind: "tool" });

  await loadDb(wait).recordJobStat("job1", "needs_confirmation");
  assert.equal(wait.saved.get("job|job1:1").result, "blocked");
});

test("기록이 실패해도 던지지 않는다 / 일감이 없어도 조용히", async () => {
  const broken = fakeDb(baseJob);

  broken.factoryRunStat.upsert = async () => {
    throw new Error("db down");
  };
  const log = console.error;

  console.error = () => {};
  try {
    await loadDb(broken).recordJobStat("job1", "done");
    await loadDb(fakeDb(null)).recordJobStat("nope", "done");
  } finally {
    console.error = log;
  }
});

test("정비·지휘자 기록", async () => {
  const db = fakeDb(null);
  const mod = loadDb(db);

  await mod.recordMaintenanceStat({ id: "t1", aiEngine: "claude", createdAt: new Date(NOW - 10 * MIN), startedAt: new Date(NOW - 8 * MIN) }, true, "11111111-2222-3333-4444-555555555555");
  assert.deepEqual(db.lastEventQuery.where.sessionId, "11111111-2222-3333-4444-555555555555");
  const m = db.saved.get("maintenance|t1");

  assert.equal(m.agent, "M1");
  assert.equal(m.result, "success");
  assert.equal(m.waitMs, 2 * MIN);
  assert.equal(m.inputTokens, 3000n);
  await mod.recordMaintenanceStat({ id: "t2", aiEngine: "codex", createdAt: new Date(NOW), startedAt: null }, false, undefined);
  assert.equal(db.saved.get("maintenance|t2").result, "failed");
  assert.equal(db.saved.get("maintenance|t2").inputTokens, 0n);
  await mod.recordConductorStat({ at: "2026-10-15T01:00:00.000Z", appSlug: "pixel-farm", ok: true, ms: 12_000, tokens: { input: 10, output: 5, cacheCreate: 0, cacheRead: 0 } });
  const c = db.saved.get("conductor|2026-10-15T01:00:00.000Z:pixel-farm");

  assert.equal(c.agent, "C1");
  assert.equal(c.runMs, 12_000);
  assert.equal(c.inputTokens, 10n);
});

// ───────── 화면·커넥터·API·마이그레이션 ─────────
test("표와 막대 그림", () => {
  const panel = loadTs("components/admin/factory/BlockUsagePanel.tsx", { "@/lib/factory/runStats": lib });
  const data = lib.aggregate(sample, { by: "agent", period: "week", now: NOW });
  const html = renderToStaticMarkup(h(panel.UsageTable, { data })) + renderToStaticMarkup(h(panel.UsageBars, { data }));

  assert.match(html, /data-usage-table/);
  assert.match(html, /data-usage-row="A2"/);
  assert.match(html, /data-usage-row="\*"/, "합계 줄");
  assert.match(html, /data-bar="A1"[^>]*width:100%/, "가장 큰 값이 100%");
  assert.equal((html.match(/data-trend=/g) ?? []).length, 8);
  assert.equal(panel.barPct(0, 100), 0);
  assert.equal(panel.barPct(1, 1000), 2);
  assert.match(renderToStaticMarkup(h(panel.UsageTable, { data: lib.aggregate([], { by: "app", period: "day", now: NOW }) })), /끝난 일이 없어요/);
  assert.match(renderToStaticMarkup(h(panel.default)), /블록별/);
  assert.match(renderToStaticMarkup(h(panel.default)), /에이전트 종류/);
});

test("블록 그림: 7일 줄이 있는 블록만 보인다", () => {
  const diagram = loadTs("components/studio/BlockDiagram.tsx");
  const node = (id, usage) => ({ id, type: "agent", col: 0, x: 0, y: 0, w: 100, h: 100, title: id, sub: "", badges: [], dim: false, ...(usage ? { usage } : {}) });
  const html = renderToStaticMarkup(h(diagram.default, { graph: { nodes: [node("a", "7일 2회 · 1.5K 토큰 · 3분"), node("b")], edges: [], width: 300, height: 200 }, selected: null, onSelect: () => {} }));

  assert.equal((html.match(/data-block-usage-line/g) ?? []).length, 1);
  assert.match(html, /7일 2회 · 1\.5K 토큰/);
});

test("사용량 탭에 [블록별]이 붙고, 지도·구성에 줄을 붙이는 자리가 있다", () => {
  assert.match(read("components/admin/factory/FactoryConsole.tsx"), /<BlockUsagePanel \/>/);
  assert.match(read("lib/factory/factoryMapDb.ts"), /nodeUsageLines\(/);
  assert.match(read("components/studio/ConfigTab.tsx"), /weekLines/);
  assert.match(read("lib/studio/data.ts"), /studioWeekLines\(/);
});

test("커넥터 get_usage_by_block: 읽기 전용, 기준·기간 선택", () => {
  const src = read("lib/factory/mcp.ts");
  const block = src.slice(src.indexOf('name: "get_usage_by_block"'));
  const def = block.slice(0, block.indexOf('name: "list_secret_names"'));

  assert.match(def, /annotations: READ_ONLY/);
  assert.match(def, /enum: \["agent", "app", "card", "tool"\]/);
  assert.match(def, /enum: \["day", "week", "month"\]/);
  assert.match(src, /case "get_usage_by_block":\n\s+return getUsageByBlock\(args\)/);
  assert.match(src, /get_usage_by_block/);
});

test("API 는 관리자 전용 GET 만", () => {
  const src = read("app/api/admin/factory/usage-blocks/route.ts");

  assert.match(src, /requireAdmin\(\)/);
  assert.match(src, /export async function GET/);
  assert.doesNotMatch(src, /export async function (POST|PUT|PATCH|DELETE)/);
});

test("끝나는 자리마다 한 줄을 남긴다(일감·정비·지휘자), 실패해도 보고는 그대로", () => {
  assert.match(read("lib/factory/jobs.ts"), /recordJobStat\(input\.jobId, status\)/);
  assert.match(read("lib/factory/maintenance.ts"), /recordMaintenanceStat\(turn, ok,/);
  assert.match(read("lib/factory/conductor.ts"), /recordConductorStat\(rec\)/);
  assert.match(read("lib/factory/runStatsDb.ts"), /catch \(error\)[\s\S]*console\.error/);
});

test("마이그레이션은 새 표만 만들고 데이터를 지우지 않는다", () => {
  const sql = read("prisma/migrations/20261118090000_run_stats/migration.sql");
  const schema = read("prisma/schema.prisma");

  assert.match(sql, /CREATE TABLE "factory_run_stats"/);
  assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE|ALTER TABLE/i);
  assert.match(schema, /model FactoryRunStat/);
  assert.match(schema, /@@unique\(\[kind, refId\]\)/);
  assert.doesNotMatch(schema.slice(schema.indexOf("model FactoryRunStat")), /secret|password/i, "비밀 칸 없음");
});
