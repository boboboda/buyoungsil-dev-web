// Fable 사용량 시험: oauth/usage 의 Fable 항목 매핑(0~100·누락·null) → 서버 저장·화면 값 → AI USAGE 패널의 Fable 카드(한국어 이름·값 없음 구분)·
// 하단 상태바 'Fable 주 N%' → 오늘 모델별 토큰 집계(작업 PC 기록 → 서버 → 비율 막대).
// 가짜 DB·임시 폴더로 돌린다. 실제 DB·네트워크·키는 쓰지 않는다.
// 실행: npm run test:fable-usage
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const NOW = Date.UTC(2026, 9, 13, 3, 0, 0); // KST 2026-10-13 12:00
const HOUR = 3600_000;
const sec = (ms) => Math.round(ms / 1000);
const html = (el) => renderToStaticMarkup(el);
const count = (s, re) => (s.match(re) ?? []).length;

const pc = await import(pathToFileURL(path.join(repo, "tools/factory-supervisor/ai-limits.mjs")).href);
const meters = loadTs("components/admin/ui/meters.tsx");
const fable = loadTs("lib/claude-status/fable.ts");
const dash = loadTs("components/admin/factory/UsageDash.tsx", { "@/components/admin/ui/meters": meters, "@/lib/claude-status/fable": fable });
const bar = loadTs("components/admin/ui/AdminStatusBar.tsx", { "@/components/admin/ui/meters": meters, "@/lib/claude-status/fable": fable });

function fakeDb() {
  const rows = new Map();
  const aiUsageLimit = {
    upsert: async ({ where, create, update }) => {
      const prev = rows.get(where.provider);
      rows.set(where.provider, prev ? { ...prev, ...update } : { fiveHourPct: null, fiveHourResetsAt: null, sevenDayPct: null, sevenDayResetsAt: null, asOf: null, failedAt: null, ...create });
    },
    update: async ({ where, data }) => rows.set(where.provider, { ...rows.get(where.provider), ...data }),
    findUnique: async ({ where }) => (rows.get(where.provider) ? { asOf: rows.get(where.provider).asOf } : null),
  };
  return { prisma: { aiUsageLimit }, rows };
}
const loadLimits = (prisma) => loadTs("lib/claude-status/limits.ts", { "@/lib/prisma": { __esModule: true, default: prisma } });

// 실제 응답(2026-10)과 같은 구조. 값만 바꿈
const usage = (limits) => ({
  five_hour: { utilization: 52, resets_at: "2026-10-13T05:00:00+00:00" },
  seven_day: { utilization: 5, resets_at: "2026-10-18T07:00:00+00:00" },
  seven_day_opus: null,
  limits,
});
const session = { kind: "session", group: "session", percent: 52, severity: "normal", resets_at: "2026-10-13T05:00:00+00:00", scope: null, is_active: true };
const weekly = { kind: "weekly_all", group: "weekly", percent: 5, severity: "normal", resets_at: "2026-10-18T07:00:00+00:00", scope: null, is_active: false };
const fableWeek = (percent) => ({ kind: "weekly_scoped", group: "weekly", percent, severity: "normal", resets_at: "2026-10-18T07:00:00+00:00", scope: { model: { id: null, display_name: "Fable" }, surface: null }, is_active: false });

test("수집: Fable 은 limits[] weekly_scoped(0~100 그대로) → 'weekly_scoped · Fable', 0% 는 0 으로 남고 null·누락이면 항목 없음", () => {
  const r = pc.parseClaudeUsage(usage([session, weekly, fableWeek(37)]));
  assert.deepEqual(r.extra, [{ key: "weekly_scoped · Fable", usedPct: 37, resetsAt: sec(Date.parse("2026-10-18T07:00:00Z")) }]);
  assert.equal(r.fiveHour.usedPct, 52, "session·weekly_all(범위 없음)은 추가 창이 아님");
  // 0 은 '값 없음'이 아니라 0%
  assert.equal(pc.parseClaudeUsage(usage([fableWeek(0)])).extra[0].usedPct, 0);
  // 0~1 비율로 착각해 100 을 곱하지 않음(limits[].percent 는 늘 0~100)
  assert.equal(pc.parseClaudeUsage(usage([fableWeek(1)])).extra[0].usedPct, 1);
  assert.equal(pc.parseClaudeUsage({ ...usage([fableWeek(0.5)]), five_hour: { utilization: 0.4, resets_at: "2026-10-13T05:00:00Z" }, seven_day: { utilization: 0.2, resets_at: "2026-10-18T07:00:00Z" } }).extra[0].usedPct, 0.5);
  assert.equal(pc.parseClaudeUsage(usage([fableWeek(140)])).extra[0].usedPct, 100);
  // null·누락·음수·limits 없음 → Fable 항목 없음(화면은 '값 없음')
  for (const l of [[fableWeek(null)], [{ ...fableWeek(5), percent: undefined }], [fableWeek(-1)], [], undefined, [{ ...fableWeek(5), scope: null }]])
    assert.deepEqual(pc.parseClaudeUsage(usage(l)).extra, [], JSON.stringify(l));
  // 나중에 Fable 5시간 항목이 생겨도 받는다
  const five = pc.parseClaudeUsage(usage([{ ...fableWeek(9), kind: "session_scoped" }])).extra[0];
  assert.equal(five.key, "session_scoped · Fable");
  assert.equal(fable.fableSlot(five.key), "fiveHour");
  assert.equal(fable.fableSlot("weekly_scoped · Fable"), "week");
  assert.equal(fable.fableSlot("seven_day_opus"), null);
});

const limitsView = (over = {}) => ({
  fiveHour: { usedPct: 52, resetsAt: NOW + 2 * HOUR, reset: false },
  sevenDay: { usedPct: 5, resetsAt: NOW + 5 * 24 * HOUR, reset: false },
  asOf: NOW - 60_000,
  stale: false,
  failedAt: null,
  failReason: null,
  source: "auto",
  extra: [],
  extraAsOf: NOW - 60_000,
  modelTokens: null,
  device: "work-pc",
  ...over,
});
const statsOf = (limits, daily = [{ date: "2026-10-13", input: 1000, output: 500, cacheCreate: 0, cacheRead: 0 }]) => ({ asOf: NOW, sessions: [], windowHours: 5, windowTokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, daily, recent: [], limits, codexLimits: null });

test("AI USAGE: Fable 카드는 Claude 5시간·7일 아래 따로, 한국어 이름·남은 %·초기화까지·갱신 시각·상태, 24칸 막대", () => {
  const v = limitsView({ extra: [{ key: "weekly_scoped · Fable", usedPct: 81, resetsAt: NOW + 30 * HOUR, reset: false }, { key: "seven_day_opus", usedPct: 3, resetsAt: null, reset: false }] });
  const out = html(h(dash.UsageDashView, { stats: statsOf(v), now: NOW }));
  assert.doesNotMatch(out, /weekly_scoped/, "내부 이름 대신 한국어");
  const claudeAt = out.indexOf('aria-label="Claude 7일 사용률"');
  const fableAt = out.indexOf('<h3 class="fx-dash-sub">Fable</h3>');
  assert.ok(claudeAt > 0 && fableAt > claudeAt, "Claude 7일 아래");
  assert.ok(fableAt < out.indexOf("오늘 사용량"), "오늘 사용량보다 위");
  assert.match(out, /<span class="fx-limit-label">Fable 주간 한도<\/span>/);
  assert.match(out, /<span class="fx-limit-pct fx-warn">81/);
  assert.match(out, /aria-label="Claude Fable 주간 한도 사용률"[^>]*aria-valuenow="81"[^>]*aria-valuetext="81% 사용 \(주의\)"/);
  assert.match(out, /남은 19% · 초기화까지 1일 6시간/);
  assert.match(out, /11:59 갱신 · 1분 전 · 자동수집/);
  // 24칸 막대(다른 게이지와 같은 SegmentBar)
  const fableBar = out.slice(out.indexOf('aria-label="Claude Fable 주간 한도 사용률"'));
  const cells = fableBar.slice(0, fableBar.indexOf("</div>"));
  assert.equal(count(cells, /<span aria-hidden="true"/g), 24);
  assert.equal(count(cells, /class="fx-on"/g), 19, "81% → 24칸 중 19칸");
  assert.doesNotMatch(out, /Fable 5시간/, "응답에 없으면 5시간 행은 안 만듦");
  // 다른 추가 창은 Claude 칸에 그대로
  assert.match(out, /<span class="fx-limit-label">seven_day_opus<\/span>/);

  const withFive = html(h(dash.UsageDashView, { stats: statsOf(limitsView({ extra: [{ key: "session_scoped · Fable", usedPct: 95, resetsAt: NOW + HOUR, reset: false }, { key: "weekly_scoped · Fable", usedPct: 10, resetsAt: NOW + 30 * HOUR, reset: false }] })), now: NOW }));
  assert.match(withFive, /Fable 5시간<\/span><span class="fx-led fx-bad">/);
  assert.match(withFive, /<span>위험<\/span>/);
});

test("AI USAGE: Fable 0% 는 '0%·정상', 값을 못 받으면 '값 없음(한도 정보 못 받음)'으로 구분", () => {
  const zero = html(h(dash.UsageDashView, { stats: statsOf(limitsView({ extra: [{ key: "weekly_scoped · Fable", usedPct: 0, resetsAt: NOW + 30 * HOUR, reset: false }] })), now: NOW }));
  assert.match(zero, /aria-label="Claude Fable 주간 한도 사용률"[^>]*aria-valuenow="0"[^>]*aria-valuetext="0% 사용 \(정상\)"/);
  assert.match(zero, /남은 100% · 초기화까지/);
  assert.doesNotMatch(zero, /한도 정보 못 받음/);

  const missing = html(h(dash.UsageDashView, { stats: statsOf(limitsView()), now: NOW }));
  assert.match(missing, /aria-label="Claude Fable 주간 한도 사용률"[^>]*aria-valuetext="값 없음"/);
  assert.match(missing, /<span>값 없음\(한도 정보 못 받음\)<\/span>/);
  assert.match(missing, /<span class="fx-limit-pct fx-idle">--/);
  assert.match(missing, /Fable<\/h3><span class="fx-led fx-idle">/);
  assert.match(missing, /Fable 주 --/);

  // Claude 값을 아직 못 받음: Fable 은 안내 한 줄, '수신 대기'는 패널에 한 번
  const none = html(h(dash.UsageDashView, { stats: null, now: NOW }));
  assert.match(none, /— Claude 한도를 받으면 함께 나타나요/);
  assert.equal(count(none, /수신 대기/g), 1);
});

test("하단 상태바: Claude 5h·7d 옆에 'Fable 주 N%', 값이 없거나 초기화되면 '-'", () => {
  const withF = limitsView({ extra: [{ key: "weekly_scoped · Fable", usedPct: 0, resetsAt: NOW + HOUR, reset: false }] });
  assert.equal(bar.aiSummary(withF, null), "Claude 5h 52% · 7d 5% · Fable 주 0% | Codex 5h - · 주 -");
  assert.equal(bar.aiSummary(limitsView(), null), "Claude 5h 52% · 7d 5% · Fable 주 - | Codex 5h - · 주 -");
  assert.equal(bar.aiSummary(limitsView({ extra: [{ key: "weekly_scoped · Fable", usedPct: 40, resetsAt: NOW - 1, reset: true }] }), null), "Claude 5h 52% · 7d 5% · Fable 주 - | Codex 5h - · 주 -");
  assert.equal(bar.aiSummary(null, null), "Claude 5h - · 7d - · Fable 주 - | Codex 5h - · 주 -");
});

// ── 모델별 토큰 ──
function transcriptHome(lines, { mtime = NOW } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fable-usage-"));
  const proj = path.join(dir, "projects", "C--work-app");
  fs.mkdirSync(path.join(proj, "sess", "subagents"), { recursive: true });
  const write = (file, rows) => {
    fs.writeFileSync(file, rows.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n"));
    fs.utimesSync(file, new Date(mtime), new Date(mtime));
  };
  write(path.join(proj, "a.jsonl"), lines);
  return { dir, proj, write };
}
const msg = (id, model, at, u = {}) => ({ type: "assistant", timestamp: new Date(at).toISOString(), uuid: `u-${id}-${Math.random()}`, message: { id, model, role: "assistant", content: [{ type: "text", text: "비밀 내용" }], usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 999, ...u } } });

test("작업 PC: 오늘(KST) Claude Code 기록을 모델별(Fable/Opus/Sonnet/Haiku/기타)로 입력+출력+캐시 생성 합산, 같은 응답은 한 번", () => {
  const { dir, proj, write } = transcriptHome([
    msg("m1", "claude-fable-5-1", NOW - HOUR, { input_tokens: 100, output_tokens: 50 }),
    msg("m1", "claude-fable-5-1", NOW - HOUR, { input_tokens: 100, output_tokens: 300 }), // 같은 응답의 다음 줄(최댓값)
    msg("m2", "claude-opus-5-5", NOW - HOUR, { input_tokens: 10, cache_creation_input_tokens: 90 }),
    msg("m3", "claude-sonnet-5-5", NOW - HOUR, { output_tokens: 20 }),
    msg("m4", "claude-haiku-5-5", NOW - HOUR, { output_tokens: 5 }),
    msg("m5", "<synthetic>", NOW - HOUR, { output_tokens: 7 }),
    msg("m6", "claude-opus-5-5", NOW - 13 * HOUR, { output_tokens: 1000 }), // KST 어제 23시 → 제외
    { type: "user", timestamp: new Date(NOW).toISOString(), message: { role: "user", content: "usage assistant" } },
    "깨진 줄 {\"usage\" assistant",
  ]);
  // 이어 연 대화가 같은 응답(m2)을 다시 적음 + 하위 에이전트 기록
  write(path.join(proj, "resumed.jsonl"), [msg("m2", "claude-opus-5-5", NOW - HOUR, { input_tokens: 10, cache_creation_input_tokens: 90 })]);
  write(path.join(proj, "sess", "subagents", "agent-1.jsonl"), [msg("s1", "claude-fable-5-1", NOW - 30 * 60_000, { output_tokens: 1 })]);
  // 어제 이후 안 바뀐 파일은 열지 않음
  const old = path.join(proj, "old.jsonl");
  fs.writeFileSync(old, JSON.stringify(msg("o1", "claude-fable-5-1", NOW - HOUR, { output_tokens: 1e6 })));
  fs.utimesSync(old, new Date(NOW - 2 * 24 * HOUR), new Date(NOW - 2 * 24 * HOUR));

  const r = pc.readModelTokens({ env: { CLAUDE_CONFIG_DIR: dir }, now: NOW });
  assert.deepEqual(r, { date: "2026-10-13", models: { fable: 401, opus: 100, sonnet: 20, haiku: 5, other: 7 } });
  assert.doesNotMatch(JSON.stringify(r), /비밀 내용|C--work-app/, "내용·경로는 안 담음");
  assert.equal(pc.readModelTokens({ env: { CLAUDE_CONFIG_DIR: path.join(dir, "없음") }, now: NOW }), null, "기록 폴더가 없으면 null");
  assert.equal(pc.modelFamily("claude-3-5-haiku-20241022"), "haiku");
  assert.equal(pc.modelFamily(undefined), "other");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("작업 PC: 한도 수집 성공·실패 모두 modelTokens 를 같이 보내고, 못 세면 빼고 보냄", async () => {
  const posted = [];
  const post = async (b) => (posted.push(b), true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fable-cred-"));
  fs.writeFileSync(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "test-only", expiresAt: NOW + 24 * HOUR } }));
  const tokens = { date: "2026-10-13", models: { fable: 1, opus: 2, sonnet: 0, haiku: 0, other: 0 } };
  const ok = async () => ({ ok: true, status: 200, json: async () => usage([fableWeek(3)]) });
  await pc.collectClaudeOnce({ env: { CLAUDE_CONFIG_DIR: dir }, fetchImpl: ok, post, now: NOW, stream: null, readTokens: () => tokens });
  assert.deepEqual(posted[0].modelTokens, tokens);
  assert.equal(posted[0].extra[0].key, "weekly_scoped · Fable");
  await pc.collectClaudeOnce({ env: { CLAUDE_CONFIG_DIR: dir }, fetchImpl: async () => ({ ok: false, status: 500 }), post, now: NOW, stream: null, readTokens: () => tokens });
  assert.equal(posted[1].status, "failed");
  assert.deepEqual(posted[1].modelTokens, tokens);
  await pc.collectClaudeOnce({ env: { CLAUDE_CONFIG_DIR: dir }, fetchImpl: ok, post, now: NOW, stream: null, readTokens: () => { throw new Error("x"); } });
  assert.equal("modelTokens" in posted[2], false);
  assert.doesNotMatch(JSON.stringify(posted), /test-only/, "토큰은 안 보냄");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("서버: modelTokens 검증(claude 만·날짜·음수 거부·빠진 모델 0)·저장·화면 값, 오래된 한도 값이어도 토큰 수는 남김", async () => {
  const { prisma, rows } = fakeDb();
  const L = loadLimits(prisma);
  const base = { provider: "claude", device: "pc", source: "auto", measuredAt: sec(NOW - 60_000), fiveHour: { usedPct: 10, resetsAt: sec(NOW + HOUR) } };
  const v = L.validateLimitsPayload({ ...base, modelTokens: { date: "2026-10-13", models: { fable: 5.7, opus: 3 } } }, NOW);
  assert.deepEqual(v.payload.modelTokens, { date: "2026-10-13", models: { fable: 5, opus: 3, sonnet: 0, haiku: 0, other: 0 } });
  for (const bad of [{ date: "어제", models: {} }, { date: "2026-10-13", models: { fable: -1 } }, { date: "2026-10-13", models: { opus: "1" } }, { date: "2026-10-13" }, "x"])
    assert.equal(L.validateLimitsPayload({ ...base, modelTokens: bad }, NOW).ok, false, JSON.stringify(bad));
  assert.equal("modelTokens" in L.validateLimitsPayload({ ...base, provider: "codex", modelTokens: { date: "2026-10-13", models: {} } }, NOW).payload, false, "codex 는 무시");
  const failed = L.validateLimitsPayload({ provider: "claude", device: "pc", status: "failed", reason: "HTTP 500", modelTokens: { date: "2026-10-13", models: { fable: 9 } } }, NOW);
  assert.equal(failed.payload.modelTokens.models.fable, 9);

  await L.saveLimits(v.payload, new Date(NOW));
  let view = L.toLimitsView(rows.get("claude"), NOW);
  assert.deepEqual(view.modelTokens, { date: "2026-10-13", models: { fable: 5, opus: 3, sonnet: 0, haiku: 0, other: 0 }, asOf: NOW });
  // 상태줄 값(토큰 없음)은 지난 토큰 수를 지우지 않음
  await L.saveLimits(L.validateLimitsPayload({ ...base, source: "statusline", measuredAt: sec(NOW) }, NOW + 1000).payload, new Date(NOW + 1000));
  assert.equal(L.toLimitsView(rows.get("claude"), NOW).modelTokens.models.fable, 5);
  // 한도 값이 더 오래돼 버려져도 토큰 수는 저장
  const older = L.validateLimitsPayload({ ...base, measuredAt: sec(NOW - 120_000), modelTokens: { date: "2026-10-13", models: { fable: 50 } } }, NOW + 2000).payload;
  assert.deepEqual(await L.saveLimits(older, new Date(NOW + 2000)), { saved: false });
  view = L.toLimitsView(rows.get("claude"), NOW);
  assert.equal(view.modelTokens.models.fable, 50);
  assert.equal(view.fiveHour.usedPct, 10, "한도 값은 그대로");
  // 실패 보고도 토큰 수 저장
  await L.saveLimits(failed.payload, new Date(NOW + 3000));
  assert.equal(L.toLimitsView(rows.get("claude"), NOW).modelTokens.models.fable, 9);
  assert.equal(L.toLimitsView({ ...rows.get("claude"), modelTokens: { date: "x" } }, NOW).modelTokens, null, "깨진 값은 null");
});

test("오늘 사용량 아래 모델별 비율 막대: Fable/Opus/Sonnet/Haiku/기타, 값 없음·오늘 아님·기록 없음 구분", () => {
  const mt = { date: "2026-10-13", asOf: NOW, models: { fable: 600, opus: 300, sonnet: 100, haiku: 0, other: 0 } };
  const s = fable.modelShares(mt, "2026-10-13");
  assert.equal(s.state, "ok");
  assert.deepEqual(s.rows.map((r) => [r.label, Math.round(r.pct)]), [["Fable", 60], ["Opus", 30], ["Sonnet", 10], ["Haiku", 0], ["기타", 0]]);
  assert.equal(fable.modelShares(null, "2026-10-13").state, "none");
  assert.equal(fable.modelShares({ ...mt, date: "2026-10-12" }, "2026-10-13").state, "old");
  assert.equal(fable.modelShares({ ...mt, models: { fable: 0, opus: 0, sonnet: 0, haiku: 0, other: 0 } }, "2026-10-13").state, "empty");
  assert.equal(fable.kstToday(Date.UTC(2026, 9, 12, 15, 30)), "2026-10-13", "KST 자정 넘으면 다음 날");

  const out = html(h(dash.UsageDashView, { stats: statsOf(limitsView({ modelTokens: mt })), now: NOW }));
  const today = out.slice(out.indexOf("오늘 사용량"));
  assert.ok(today.indexOf("모델별 비율") > today.indexOf('aria-label="오늘 사용량 (어제와 비교)"'), "오늘 사용량 아래");
  assert.match(out, /aria-label="오늘 Fable 토큰 비율"[^>]*aria-valuenow="60"[^>]*aria-valuetext="60% \(600 토큰\)"/);
  assert.match(out, /aria-label="오늘 기타 토큰 비율"[^>]*aria-valuenow="0"/);
  assert.match(out, />60% · 600</);
  assert.match(html(h(dash.UsageDashView, { stats: statsOf(limitsView({ modelTokens: { ...mt, date: "2026-10-12" } })), now: NOW })), /모델별 값 없음\(오늘 받은 값 없음\)/);
  assert.match(html(h(dash.UsageDashView, { stats: statsOf(limitsView()), now: NOW })), /모델별 값 없음\(작업 PC 에서 아직 안 보냄\)/);
});

test("마이그레이션은 열만 추가(지우는 문장 없음)", () => {
  const dir = path.join(repo, "prisma/migrations");
  const sql = fs.readdirSync(dir).filter((d) => d.includes("ai_usage_model_tokens")).map((d) => fs.readFileSync(path.join(dir, d, "migration.sql"), "utf8")).join("\n");
  assert.match(sql, /ALTER TABLE "ai_usage_limits" ADD COLUMN "modelTokens" JSONB;/);
  assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE/i);
});
