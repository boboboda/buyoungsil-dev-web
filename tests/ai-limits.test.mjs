// 남은 한도 게이지 시험: lib/claude-status/limits.ts(검증·저장·화면 값) + stats.ts(ClaudeStats.limits) +
// 수집 주소(/api/claude-status/limits) + 작업 PC 스크립트(tools/factory-supervisor/ai-limits.mjs) + [사용량] 화면 렌더.
// 가짜 DB(메모리)·가짜 fetch 로 돌린다. 실제 DB·네트워크·키는 쓰지 않고, 시험용 토큰은 실행할 때 난수로 만든다.
// 실행: npm run test:ai-limits
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { NextRequest } = require("next/server");
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

const logs = [];
for (const level of ["log", "info", "warn", "error"]) {
  console[level] = (...args) => logs.push(args.map(String).join(" "));
}

const NOW = Date.UTC(2026, 9, 13, 3, 0, 0);
const sec = (ms) => Math.round(ms / 1000);
const HOUR = 3600_000;

function fakeDb({ broken = false } = {}) {
  const rows = new Map();
  const aiUsageLimit = {
    upsert: async ({ where, create, update }) => {
      if (broken) throw new Error("relation does not exist");
      const prev = rows.get(where.provider);
      const row = prev ? { ...prev, ...update } : { fiveHourPct: null, fiveHourResetsAt: null, sevenDayPct: null, sevenDayResetsAt: null, asOf: null, failedAt: null, ...create };
      rows.set(where.provider, row);
      return row;
    },
    findUnique: async ({ where }) => {
      if (broken) throw new Error("relation does not exist");
      const r = rows.get(where.provider);
      return r ? { asOf: r.asOf } : null;
    },
    findMany: async () => {
      if (broken) throw new Error("relation does not exist");
      return [...rows.values()].map((r) => ({ ...r }));
    },
  };
  return { prisma: { aiUsageLimit }, rows };
}

const loadLimits = (prisma) => loadTs("lib/claude-status/limits.ts", { "@/lib/prisma": { __esModule: true, default: prisma } });

test("검증: 정해진 값만 받고 범위를 벗어나면 400 사유", () => {
  const { validateLimitsPayload } = loadLimits(fakeDb().prisma);
  const ok = validateLimitsPayload({ provider: "claude", device: "pc", fiveHour: { usedPct: 23.46, resetsAt: sec(NOW + 2 * HOUR) }, other: "무시" }, NOW);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.payload.fiveHour, { usedPct: 23.5, resetsAt: new Date(sec(NOW + 2 * HOUR) * 1000) });
  assert.equal(ok.payload.sevenDay, null);
  assert.equal(ok.payload.status, "ok");
  assert.equal("other" in ok.payload, false);
  assert.equal("extra" in ok.payload, false, "extra 를 안 보내면 지난 값 유지");
  assert.equal(ok.payload.source, "statusline", "출처가 없으면 claude=상태줄");
  assert.equal(ok.payload.measuredAt, null);

  // 100 넘는 값은 100 으로 자름
  assert.equal(validateLimitsPayload({ provider: "codex", device: "pc", sevenDay: { usedPct: 130, resetsAt: sec(NOW + HOUR) } }, NOW).payload.sevenDay.usedPct, 100);
  // 실패 보고는 창 값 없이 받음
  const failed = validateLimitsPayload({ provider: "codex", device: "pc", status: "failed", fiveHour: "무시" }, NOW);
  assert.equal(failed.ok, true);
  assert.equal(failed.payload.fiveHour, null);

  const bad = [
    null,
    { provider: "gemini", device: "pc", fiveHour: { usedPct: 1, resetsAt: sec(NOW) } },
    { provider: "claude", fiveHour: { usedPct: 1, resetsAt: sec(NOW) } },
    { provider: "claude", device: "pc" }, // 창이 하나도 없음
    { provider: "claude", device: "pc", status: "weird", fiveHour: { usedPct: 1, resetsAt: sec(NOW) } },
    { provider: "claude", device: "pc", fiveHour: { usedPct: -1, resetsAt: sec(NOW) } },
    { provider: "claude", device: "pc", fiveHour: { usedPct: "1", resetsAt: sec(NOW) } },
    { provider: "claude", device: "pc", fiveHour: { usedPct: 1, resetsAt: NOW } }, // 밀리초로 잘못 보냄(먼 미래)
    { provider: "claude", device: "pc", fiveHour: { usedPct: 1, resetsAt: sec(NOW - 3 * 86400_000) } },
  ];
  for (const b of bad) assert.equal(validateLimitsPayload(b, NOW).ok, false, JSON.stringify(b));
});

test("화면 값: 없음·정상·오래됨·초기화 지남·수집 실패", () => {
  const { toLimitsView, LIMIT_STALE_MS } = loadLimits(fakeDb().prisma);
  assert.equal(toLimitsView(null, NOW), null);

  const base = { device: "pc", fiveHourPct: 23.5, fiveHourResetsAt: new Date(NOW + 2 * HOUR), sevenDayPct: null, sevenDayResetsAt: null, asOf: new Date(NOW - 60_000), failedAt: null };
  assert.deepEqual(toLimitsView(base, NOW), {
    fiveHour: { usedPct: 23.5, resetsAt: NOW + 2 * HOUR, reset: false },
    sevenDay: null,
    asOf: NOW - 60_000,
    stale: false,
    failedAt: null,
    failReason: null,
    source: null,
    extra: [],
    extraAsOf: null,
    device: "pc",
  });
  assert.equal(toLimitsView({ ...base, asOf: new Date(NOW - LIMIT_STALE_MS - 1) }, NOW).stale, true);
  assert.equal(toLimitsView({ ...base, fiveHourResetsAt: new Date(NOW - 1) }, NOW).fiveHour.reset, true);
  // 값을 받은 뒤 실패 → 실패 표시, 실패 뒤 값을 받음 → 실패 아님, 값 없이 실패만 → 실패
  assert.equal(toLimitsView({ ...base, failedAt: new Date(NOW) }, NOW).failedAt, NOW);
  assert.equal(toLimitsView({ ...base, failedAt: new Date(NOW - 2 * 60_000) }, NOW).failedAt, null);
  const onlyFail = toLimitsView({ ...base, fiveHourPct: null, fiveHourResetsAt: null, asOf: null, failedAt: new Date(NOW) }, NOW);
  assert.equal(onlyFail.failedAt, NOW);
  assert.equal(onlyFail.asOf, null);
  assert.equal(onlyFail.stale, false);
});

test("저장: 최신 1행 덮어쓰기, 실패는 지난 값을 남기고 실패 시각만", async () => {
  const { prisma, rows } = fakeDb();
  const { saveLimits, validateLimitsPayload } = loadLimits(prisma);
  const p = (b) => validateLimitsPayload({ device: "pc", ...b }, NOW).payload;

  await saveLimits(p({ provider: "codex", status: "failed" }), new Date(NOW - 10_000));
  assert.equal(rows.get("codex").asOf, null);
  assert.equal(rows.get("codex").failedAt.getTime(), NOW - 10_000);

  await saveLimits(p({ provider: "codex", fiveHour: { usedPct: 10, resetsAt: sec(NOW + HOUR) }, sevenDay: { usedPct: 40, resetsAt: sec(NOW + 50 * HOUR) } }), new Date(NOW));
  assert.equal(rows.get("codex").failedAt, null);
  assert.equal(rows.get("codex").sevenDayPct, 40);

  await saveLimits(p({ provider: "codex", status: "failed" }), new Date(NOW + 1000));
  assert.equal(rows.get("codex").sevenDayPct, 40, "실패해도 지난 값은 남음");
  assert.equal(rows.get("codex").failedAt.getTime(), NOW + 1000);

  // 창이 빠지면 지난 값도 지움
  await saveLimits(p({ provider: "codex", fiveHour: { usedPct: 12, resetsAt: sec(NOW + HOUR) } }), new Date(NOW + 2000));
  assert.equal(rows.get("codex").sevenDayPct, null);
  assert.equal(rows.size, 1);
});

function statsWith(db) {
  const limits = loadLimits(db.prisma);
  const prisma = {
    ...db.prisma,
    claudeSession: { findMany: async () => [] },
    claudeEvent: { aggregate: async () => ({ _sum: {} }), findMany: async () => [] },
    claudeDailyUsage: { groupBy: async () => [] },
  };
  return loadTs("lib/claude-status/stats.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "./ingest": { kstDate: (d) => d.toISOString().slice(0, 10) },
    "./limits": limits,
  });
}

test("stats: ClaudeStats 에 limits·codexLimits, 표가 없어도 나머지 현황은 나옴", async () => {
  const db = fakeDb();
  const { saveLimits, validateLimitsPayload } = loadLimits(db.prisma);
  await saveLimits(validateLimitsPayload({ provider: "claude", device: "pc", fiveHour: { usedPct: 23, resetsAt: sec(Date.now() + HOUR) }, sevenDay: { usedPct: 41, resetsAt: sec(Date.now() + 90 * HOUR) } }).payload);

  const stats = await statsWith(db).getClaudeStats();
  assert.equal(stats.limits.fiveHour.usedPct, 23);
  assert.equal(stats.limits.sevenDay.usedPct, 41);
  assert.equal(stats.limits.device, "pc");
  assert.equal(stats.codexLimits, null);
  assert.equal(stats.daily.length, 14);

  const broken = await statsWith(fakeDb({ broken: true })).getClaudeStats();
  assert.equal(broken.limits, null);
  assert.equal(broken.codexLimits, null);
  assert.equal(broken.daily.length, 14);
});

test("수집 주소: 토큰 없으면 401, 잘못된 값 400, 정상 200 으로 저장", async () => {
  const token = randomBytes(24).toString("hex");
  process.env.CLAUDE_STATUS_TOKEN = token;
  const db = fakeDb();
  const limits = loadLimits(db.prisma);
  const http = loadTs("lib/factory/http.ts", { "@/lib/factory/auth": { isValidFactoryWorkerToken: async () => false } });
  const route = loadTs("app/api/claude-status/limits/route.ts", {
    "@/lib/claude-status/auth": loadTs("lib/claude-status/auth.ts"),
    "@/lib/claude-status/limits": limits,
    "@/lib/factory/http": { hit: () => false, getClientIP: http.getClientIP },
  });
  const req = (body, auth) =>
    new NextRequest("http://localhost/api/claude-status/limits", {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const good = { provider: "claude", device: "pc", fiveHour: { usedPct: 5, resetsAt: sec(Date.now() + HOUR) } };

  assert.equal((await route.POST(req(good))).status, 401);
  assert.equal((await route.POST(req(good, `Bearer ${token}x`))).status, 401);
  assert.equal((await route.POST(req("{", `Bearer ${token}`))).status, 400);
  assert.equal((await route.POST(req({ provider: "claude", device: "pc" }, `Bearer ${token}`))).status, 400);
  assert.equal(db.rows.size, 0);
  assert.equal((await route.POST(req(good, `Bearer ${token}`))).status, 200);
  assert.equal(db.rows.get("claude").fiveHourPct, 5);
  delete process.env.CLAUDE_STATUS_TOKEN;
});

const pc = await import(pathToFileURL(path.join(repo, "tools/factory-supervisor/ai-limits.mjs")).href);

test("상태줄: rate_limits 만 뽑고 없는 창은 건너뜀", () => {
  assert.equal(pc.parseClaudeStatusline({ model: {} }), null);
  assert.equal(pc.parseClaudeStatusline(null), null);
  assert.equal(pc.statuslineText(null), "");
  const both = pc.parseClaudeStatusline({ rate_limits: { five_hour: { used_percentage: 23.4, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600 } } });
  assert.deepEqual(both, { fiveHour: { usedPct: 23.4, resetsAt: 1738425600 }, sevenDay: { usedPct: 41.2, resetsAt: 1738857600 } });
  assert.equal(pc.statuslineText(both), "5h 23% · 7d 41%");
  const onlyWeek = pc.parseClaudeStatusline({ rate_limits: { seven_day: { used_percentage: 7, resets_at: 1738857600 }, five_hour: { used_percentage: null } } });
  assert.equal(onlyWeek.fiveHour, null);
  assert.equal(pc.statuslineText(onlyWeek), "7d 7%");
  assert.notEqual(pc.limitsSignature(both), pc.limitsSignature(onlyWeek));
  assert.equal(pc.limitsSignature(both), pc.limitsSignature({ ...both, fiveHour: { ...both.fiveHour, usedPct: 23.1 } }));
});

test("보낼 주소: CLAUDE_STATUS_URL 뒤에 /limits, AI_LIMITS_URL 우선", () => {
  assert.equal(pc.limitsUrl({ CLAUDE_STATUS_URL: "https://example.test/api/claude-status" }), "https://example.test/api/claude-status/limits");
  assert.equal(pc.limitsUrl({ CLAUDE_STATUS_URL: "https://example.test/api/claude-status/" }), "https://example.test/api/claude-status/limits");
  assert.equal(pc.limitsUrl({ AI_LIMITS_URL: "https://x.test/l", CLAUDE_STATUS_URL: "https://example.test/a" }), "https://x.test/l");
  assert.equal(pc.limitsUrl({}), null);
  assert.equal(pc.limitsUrl({ CLAUDE_STATUS_URL: "없는주소" }), null);
});

test("Codex 응답 해석: 알려진 형식·남은 초·창 길이로 구분·형식 다름", () => {
  const known = { plan_type: "plus", rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1760000000 }, secondary_window: { used_percent: 55, limit_window_seconds: 604800, reset_after_seconds: 3600 } } };
  assert.deepEqual(pc.parseCodexUsage(known, NOW), { fiveHour: { usedPct: 12, resetsAt: 1760000000 }, sevenDay: { usedPct: 55, resetsAt: sec(NOW) + 3600 } });
  // 창 순서가 바뀌어도 길이로 맞춤
  const swapped = { rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 604800, reset_at: 2 }, secondary_window: null } };
  assert.deepEqual(pc.parseCodexUsage(swapped, NOW), { fiveHour: null, sevenDay: { usedPct: 30, resetsAt: 2 } });
  for (const bad of [null, {}, { rate_limit: {} }, { rate_limit: { primary_window: { used_percent: "12" } } }, "html"]) assert.equal(pc.parseCodexUsage(bad, NOW), null);
});

test("Codex 수집: 성공·HTTP 실패·형식 다름·auth.json 없음, 토큰은 서버·로그로 안 나감", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-limits-test-"));
  const secret = `tok-${randomBytes(16).toString("hex")}`;
  try {
    fs.writeFileSync(path.join(home, "auth.json"), JSON.stringify({ tokens: { access_token: secret, account_id: "acc-1" } }));
    const env = { CODEX_HOME: home };
    const posted = [];
    const post = async (body) => (posted.push(body), true);
    const calls = [];
    const fetchOk = async (url, init) => (calls.push({ url, init }), { ok: true, status: 200, json: async () => ({ rate_limit: { primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_after_seconds: 60 } } }) });

    const r1 = await pc.collectCodexOnce({ env, fetchImpl: fetchOk, post });
    assert.deepEqual(r1, { result: "ok", sent: true });
    assert.equal(calls[0].url, "https://chatgpt.com/backend-api/wham/usage");
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${secret}`);
    assert.equal(calls[0].init.headers["ChatGPT-Account-Id"], "acc-1");
    assert.equal(posted[0].provider, "codex");
    assert.equal(posted[0].fiveHour.usedPct, 20);

    const r2 = await pc.collectCodexOnce({ env, fetchImpl: async () => ({ ok: false, status: 401 }), post });
    assert.equal(r2.result, "HTTP 401");
    assert.deepEqual(posted[1], { provider: "codex", source: "auto", status: "failed", reason: "HTTP 401" });

    const r3 = await pc.collectCodexOnce({ env, fetchImpl: async () => ({ ok: true, json: async () => ({ changed: true }) }), post });
    assert.equal(r3.result, "응답 형식이 다름");

    const r4 = await pc.collectCodexOnce({ env, fetchImpl: async () => { throw new Error(secret); }, post });
    assert.equal(r4.result, "읽기 실패");

    const r5 = await pc.collectCodexOnce({ env: { CODEX_HOME: path.join(home, "none") }, fetchImpl: fetchOk, post });
    assert.equal(r5.result, "auth.json 없음");

    const out = JSON.stringify([posted, r1, r2, r3, r4, r5, logs]);
    assert.ok(!out.includes(secret), "토큰이 보낸 값·결과·로그에 있음");
    assert.ok(!out.includes("acc-1"), "계정 ID 가 보낸 값에 있음");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("[사용량] 화면: 게이지 2개·남은 시간·수신 대기·수집 실패", () => {
  const passthrough = (tag) => ({ children, className }) => h(tag, { className }, children);
  const heroui = {
    Card: passthrough("section"),
    CardBody: passthrough("div"),
    CardHeader: passthrough("header"),
    Chip: ({ children, color }) => h("span", { "data-chip": color }, children),
    Input: () => null,
    Switch: ({ children }) => h("label", null, children),
    Progress: ({ value, color, "aria-label": label }) => h("progress", { value, "data-color": color, "aria-label": label }),
  };
  const { default: View } = loadTs("components/admin/claude/ClaudeStatusView.tsx", { "@heroui/react": heroui });
  const now = Date.now();
  const empty = { asOf: now, sessions: [], windowHours: 5, windowTokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, daily: [], recent: [] };

  const waiting = renderToStaticMarkup(h(View, { initial: { ...empty, limits: null, codexLimits: null } }));
  assert.match(waiting, /남은 한도/);
  assert.match(waiting, /수신 대기\(작업 PC 에서 Claude Code 를 한 번 쓰면 나타나요\)/);
  assert.match(waiting, /수신 대기\(작업 PC 에서 Codex 수집 스크립트를 켜면 나타나요\)/);

  const limits = {
    fiveHour: { usedPct: 23.4, resetsAt: now + 2 * HOUR + 13 * 60_000 + 30_000, reset: false },
    sevenDay: { usedPct: 92, resetsAt: now + 3 * 86400_000 + 4 * HOUR + 30_000, reset: false },
    asOf: now - 60_000,
    stale: false,
    failedAt: null,
    device: "work-pc",
  };
  const codex = { fiveHour: null, sevenDay: null, asOf: null, stale: false, failedAt: now - 1000, device: "work-pc" };
  const out = renderToStaticMarkup(h(View, { initial: { ...empty, limits, codexLimits: codex } }));
  assert.equal((out.match(/<progress/g) ?? []).length, 2, "Claude 게이지 2개");
  assert.match(out, /aria-label="5시간 한도 사용률"[^>]*|value="23"/);
  assert.match(out, /남은 <span[^>]*>77%<\/span>/);
  assert.match(out, /남은 <span[^>]*>8%<\/span>/);
  assert.match(out, /data-color="danger"/);
  assert.match(out, /초기화까지 2시간 14분/);
  assert.match(out, /초기화까지 3일 4시간/);
  assert.match(out, /1분 전 받은 값/);
  assert.match(out, /data-chip="warning">수집 실패/);
  assert.match(out, /아직 받은 값이 없어요/);

  const old = renderToStaticMarkup(h(View, { initial: { ...empty, limits: { ...limits, stale: true, fiveHour: { ...limits.fiveHour, reset: true } }, codexLimits: null } }));
  assert.match(old, /오래된 값/);
  assert.match(old, /초기화됨/);
});

// ── Claude 자동 수집(oauth/usage)·5분 실행·일감 끝 갱신 ─────────────────
// 실제 응답(2026-10, 값만 바꿈)과 같은 모양. seven_day_* 는 null, 이번 주 Fable 은 limits[] 의 weekly_scoped 로 온다.
const usageSample = (over = {}) => ({
  five_hour: { utilization: 9, resets_at: "2026-10-13T09:09:59.961407+00:00", limit_dollars: null },
  seven_day: { utilization: 41, resets_at: "2026-10-14T06:59:59.961427+00:00" },
  seven_day_oauth_apps: null,
  seven_day_opus: null,
  seven_day_sonnet: null,
  extra_usage: { is_enabled: false, utilization: null },
  limits: [
    { kind: "session", group: "session", percent: 9, resets_at: "2026-10-13T09:09:59.961407+00:00", scope: null },
    { kind: "weekly_all", group: "weekly", percent: 41, resets_at: "2026-10-14T06:59:59.961427+00:00", scope: null },
    { kind: "weekly_scoped", group: "weekly", percent: 12, resets_at: "2026-10-14T07:00:00+00:00", scope: { model: { id: null, display_name: "Fable" }, surface: null } },
  ],
  ...over,
});
const isoSec = (iso) => Math.round(Date.parse(iso) / 1000);

test("oauth/usage 해석: 5시간·7일·ISO 시각, 이번 주 Fable·seven_day_* 는 키 그대로, 0~1 환산, 형식 다름", () => {
  const r = pc.parseClaudeUsage(usageSample());
  assert.deepEqual(r.fiveHour, { usedPct: 9, resetsAt: isoSec("2026-10-13T09:09:59Z") + 1 });
  assert.deepEqual(r.sevenDay, { usedPct: 41, resetsAt: isoSec("2026-10-14T07:00:00Z") });
  assert.deepEqual(r.extra, [{ key: "weekly_scoped · Fable", usedPct: 12, resetsAt: isoSec("2026-10-14T07:00:00Z") }]);

  // 모델별 주간 창이 객체로 오면 키 그대로, 초기화 시각이 없어도 받음
  const withOpus = pc.parseClaudeUsage(usageSample({ seven_day_opus: { utilization: 3, resets_at: null }, limits: undefined }));
  assert.deepEqual(withOpus.extra, [{ key: "seven_day_opus", usedPct: 3, resetsAt: null }]);

  // 모든 값이 0~1 이고 소수가 있으면 0~1 로 보고 환산, 초기화 시각은 초·밀리초도 받음
  const frac = pc.parseClaudeUsage({ five_hour: { utilization: 0.093, resets_at: 1791882600 }, seven_day: { utilization: 0.41, resets_at: 1791961200000 } });
  assert.deepEqual(frac, { fiveHour: { usedPct: 9.3, resetsAt: 1791882600 }, sevenDay: { usedPct: 41, resetsAt: 1791961200 }, extra: [] });
  // 정수 0·1 은 % 그대로(1%)
  assert.equal(pc.parseClaudeUsage({ five_hour: { utilization: 1, resets_at: 1791882600 } }).fiveHour.usedPct, 1);
  // 창 하나가 이상하면 그 창만 건너뜀, 100 넘으면 100
  const partial = pc.parseClaudeUsage({ five_hour: { utilization: "9" }, seven_day: { utilization: 130, resets_at: "2026-10-14T07:00:00Z" } });
  assert.equal(partial.fiveHour, null);
  assert.equal(partial.sevenDay.usedPct, 100);
  for (const bad of [null, "html", [], {}, { limits: [] }, { five_hour: 9 }]) assert.equal(pc.parseClaudeUsage(bad), null, JSON.stringify(bad));
  assert.equal(pc.toEpochSec("이상한 값"), null);
  assert.equal(pc.toEpochSec("1791882600"), 1791882600);
});

test("claude -p stream-json 의 rate_limit_event: utilization 0~1 → %, 다른 이벤트는 무시", () => {
  const ev = { type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 1791882600, rateLimitType: "five_hour", unifiedWindows: { five_hour: { utilization: 0.09, resetsAt: 1791882600 }, seven_day: { utilization: 0.01, resetsAt: 1791961200 } } } };
  assert.deepEqual(pc.parseRateLimitEvent(ev), { fiveHour: { usedPct: 9, resetsAt: 1791882600 }, sevenDay: { usedPct: 1, resetsAt: 1791961200 } });
  assert.equal(pc.parseRateLimitEvent({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }), null);
  assert.equal(pc.parseRateLimitEvent({ type: "assistant" }), null);
  pc.noteRateLimitEvent({ type: "result" }, NOW);
  pc.noteRateLimitEvent(ev, NOW);
  assert.equal(pc.latestStreamLimits().at, NOW);
  assert.equal(pc.latestStreamLimits().limits.fiveHour.usedPct, 9);
});

// 가짜 Claude 로그인 폴더 + 상태 폴더
function claudeHome({ expiresAt = Math.max(NOW, Date.now()) + 24 * HOUR, token = `oat-${randomBytes(16).toString("hex")}`, write = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-limits-test-"));
  if (write) fs.writeFileSync(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: `rt-${token}`, expiresAt, subscriptionType: "max" } }));
  const env = { CLAUDE_CONFIG_DIR: dir, AI_LIMITS_STATE_DIR: dir, CODEX_HOME: path.join(dir, "no-codex") };
  return { dir, env, token, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const respond = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("Claude 자동 수집: 헤더·성공 전송(출처 auto·읽은 시각·추가 창), 토큰은 서버·결과·로그로 안 나감", async () => {
  const home = claudeHome();
  try {
    const posted = [];
    const calls = [];
    const fetchImpl = async (url, init) => (calls.push({ url, init }), respond(200, usageSample())());
    const state = {};
    const r = await pc.collectClaudeOnce({ env: home.env, fetchImpl, post: async (b) => (posted.push(b), true), now: NOW, state, stream: null });
    assert.deepEqual(r, { result: "ok", sent: true });
    assert.equal(calls[0].url, "https://api.anthropic.com/api/oauth/usage");
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${home.token}`);
    assert.equal(calls[0].init.headers["anthropic-beta"], "oauth-2025-04-20");
    assert.equal(posted[0].provider, "claude");
    assert.equal(posted[0].source, "auto");
    assert.equal(posted[0].measuredAt, sec(NOW));
    assert.equal(posted[0].fiveHour.usedPct, 9);
    assert.equal(posted[0].extra[0].key, "weekly_scoped · Fable");
    assert.deepEqual(state.claude, {});
    const out = JSON.stringify([posted, r, logs, state]);
    assert.ok(!out.includes(home.token), "토큰이 보낸 값·결과·로그에 있음");
  } finally {
    home.cleanup();
  }
});

test("Claude 자동 수집 실패: 만료 토큰은 부르지 않고 '로그인 필요', 401·429 는 5분→15분→30분 쉬고 성공하면 복귀, 형식 다름", async () => {
  const expired = claudeHome({ expiresAt: NOW - 1 });
  try {
    let called = 0;
    const posted = [];
    const r = await pc.collectClaudeOnce({ env: expired.env, fetchImpl: async () => (called++, respond(200, usageSample())()), post: async (b) => (posted.push(b), true), now: NOW, state: {}, stream: null });
    assert.equal(r.result, pc.LOGIN_NEEDED);
    assert.equal(called, 0, "만료 토큰으로는 부르지 않음(갱신도 안 함)");
    assert.deepEqual(posted[0], { provider: "claude", source: "auto", status: "failed", reason: pc.LOGIN_NEEDED });
    assert.ok(!JSON.stringify(posted).includes(expired.token));
  } finally {
    expired.cleanup();
  }

  const missing = claudeHome({ write: false });
  try {
    const r = await pc.collectClaudeOnce({ env: missing.env, fetchImpl: respond(200, {}), post: async () => true, now: NOW, state: {}, stream: null });
    assert.equal(r.result, "credentials 없음(Claude Code 로그인 필요)");
  } finally {
    missing.cleanup();
  }

  const home = claudeHome();
  try {
    const posted = [];
    const post = async (b) => (posted.push(b), true);
    const state = {};
    let calls = 0;
    const f429 = async () => (calls++, { ok: false, status: 429, json: async () => ({}) });
    const MIN_MS = 60_000;

    let r = await pc.collectClaudeOnce({ env: home.env, fetchImpl: f429, post, now: NOW, state, stream: null });
    assert.equal(r.result, "HTTP 429 요청 제한 · 5분 뒤 다시");
    assert.deepEqual(posted.at(-1), { provider: "claude", source: "auto", status: "failed", reason: "HTTP 429 요청 제한 · 5분 뒤 다시" });
    assert.deepEqual(state.claude, { fails: 1, until: NOW + 5 * MIN_MS, reason: "HTTP 429 요청 제한" });

    // 쉬는 동안은 부르지 않고 보내지도 않음
    r = await pc.collectClaudeOnce({ env: home.env, fetchImpl: f429, post, now: NOW + 4 * MIN_MS, state, stream: null });
    assert.equal(r.skipped, true);
    assert.match(r.result, /^쉬는 중\(HTTP 429 요청 제한 · 1분 뒤 다시\)$/);
    assert.equal(calls, 1);
    assert.equal(posted.length, 1);

    r = await pc.collectClaudeOnce({ env: home.env, fetchImpl: f429, post, now: NOW + 5 * MIN_MS, state, stream: null });
    assert.equal(r.result, "HTTP 429 요청 제한 · 15분 뒤 다시");
    r = await pc.collectClaudeOnce({ env: home.env, fetchImpl: respond(401, {}), post, now: NOW + 20 * MIN_MS, state, stream: null });
    assert.equal(r.result, `${pc.LOGIN_NEEDED} · 30분 뒤 다시`);
    r = await pc.collectClaudeOnce({ env: home.env, fetchImpl: f429, post, now: NOW + 50 * MIN_MS, state, stream: null });
    assert.equal(r.result, "HTTP 429 요청 제한 · 30분 뒤 다시", "30분이 최대");
    assert.equal(state.claude.fails, 4);

    // 성공하면 쉬는 시간 없음
    r = await pc.collectClaudeOnce({ env: home.env, fetchImpl: respond(200, usageSample()), post, now: NOW + 80 * MIN_MS, state, stream: null });
    assert.equal(r.result, "ok");
    assert.deepEqual(state.claude, {});
    assert.deepEqual([1, 2, 3, 9].map(pc.backoffMs), [5, 15, 30, 30].map((m) => m * MIN_MS));

    // 형식이 다르거나 값이 없으면 실패지만 쉬지 않음
    r = await pc.collectClaudeOnce({ env: home.env, fetchImpl: respond(200, { changed: true }), post, now: NOW + 81 * MIN_MS, state, stream: null });
    assert.equal(r.result, "응답 형식이 다름");
    assert.deepEqual(state.claude, {});
    r = await pc.collectClaudeOnce({ env: home.env, fetchImpl: respond(200, { five_hour: null, seven_day: { utilization: null } }), post, now: NOW + 82 * MIN_MS, state, stream: null });
    assert.equal(r.result, "한도 값 없음");
    r = await pc.collectClaudeOnce({ env: home.env, fetchImpl: respond(500, {}), post, now: NOW + 83 * MIN_MS, state, stream: null });
    assert.equal(r.result, "HTTP 500");
    r = await pc.collectClaudeOnce({ env: home.env, fetchImpl: async () => { throw new Error(home.token); }, post, now: NOW + 84 * MIN_MS, state, stream: null });
    assert.equal(r.result, "읽기 실패");
    assert.ok(!JSON.stringify([posted, logs]).includes(home.token));
  } finally {
    home.cleanup();
  }
});

test("자동 수집이 안 될 때: 10분 안의 일감 출력(rate_limit_event) 값을 출처 stream·그 시각으로 보냄", async () => {
  const home = claudeHome();
  try {
    const posted = [];
    const post = async (b) => (posted.push(b), true);
    const stream = { at: NOW - 60_000, limits: { fiveHour: { usedPct: 9, resetsAt: sec(NOW + HOUR) }, sevenDay: null } };
    const r = await pc.collectClaudeOnce({ env: home.env, fetchImpl: respond(429, {}), post, now: NOW, state: {}, stream });
    assert.equal(r.streamSent, true);
    assert.deepEqual(posted.map((b) => `${b.source}:${b.status}`), ["auto:failed", "stream:ok"]);
    assert.equal(posted[1].measuredAt, sec(NOW - 60_000));
    // 10분 넘은 값은 안 보냄
    const old = await pc.collectClaudeOnce({ env: home.env, fetchImpl: respond(429, {}), post, now: NOW + HOUR, state: {}, stream });
    assert.equal(old.streamSent, false);
  } finally {
    home.cleanup();
  }
});

test("서버: 두 출처 중 읽은 시각이 더 최근인 값만 남김, 자동수집 실패 사유는 자동수집 성공 때만 지움, 추가 창은 보낼 때만 바뀜", async () => {
  const { prisma, rows } = fakeDb();
  const { saveLimits, validateLimitsPayload, toLimitsView } = loadLimits(prisma);
  const p = (b, now = NOW) => {
    const v = validateLimitsPayload({ provider: "claude", device: "pc", ...b }, now);
    assert.equal(v.ok, true, v.reason);
    return v.payload;
  };
  const w = (pct) => ({ usedPct: pct, resetsAt: sec(NOW + HOUR) });
  const at = (ms) => new Date(NOW + ms);

  // 자동수집 12:00 값
  assert.deepEqual(await saveLimits(p({ source: "auto", measuredAt: sec(NOW - 60_000), fiveHour: w(10), extra: [{ key: "weekly_scoped · Fable", usedPct: 12, resetsAt: sec(NOW + 30 * HOUR) }] }), at(0)), { saved: true });
  // 그보다 먼저 읽은 일감 출력 값은 버림, 같은 시각도 버림
  assert.deepEqual(await saveLimits(p({ source: "stream", measuredAt: sec(NOW - 120_000), fiveHour: w(5) }), at(1000)), { saved: false });
  assert.deepEqual(await saveLimits(p({ source: "stream", measuredAt: sec(NOW - 60_000), fiveHour: w(6) }), at(1000)), { saved: false });
  assert.equal(rows.get("claude").fiveHourPct, 10);
  // 상태줄이 더 최근(받은 시각) → 상태줄 값, 추가 창은 그대로
  assert.deepEqual(await saveLimits(p({ fiveHour: w(14) }), at(0)), { saved: true });
  assert.equal(rows.get("claude").fiveHourPct, 14);
  assert.equal(rows.get("claude").source, "statusline");
  let view = toLimitsView(rows.get("claude"), NOW);
  assert.equal(view.source, "statusline");
  assert.deepEqual(view.extra, [{ key: "weekly_scoped · Fable", usedPct: 12, resetsAt: NOW + 30 * HOUR, reset: false }]);
  assert.equal(view.extraAsOf, NOW - 60_000);

  // 자동수집 실패(사유) → 값은 남기고 실패 표시
  await saveLimits(p({ source: "auto", status: "failed", reason: "HTTP 429 요청 제한 · 5분 뒤 다시" }), at(60_000));
  view = toLimitsView(rows.get("claude"), NOW + 60_000);
  assert.equal(view.failedAt, NOW + 60_000);
  assert.equal(view.failReason, "HTTP 429 요청 제한 · 5분 뒤 다시");
  assert.equal(view.fiveHour.usedPct, 14, "마지막 성공 값 유지");
  // 그 뒤 상태줄 값이 오면 화면에서 실패는 숨지만, 기록(사유)은 자동수집이 성공할 때까지 남음
  await saveLimits(p({ fiveHour: w(15) }), at(120_000));
  view = toLimitsView(rows.get("claude"), NOW + 120_000);
  assert.equal(view.failedAt, null);
  assert.equal(view.failReason, null);
  assert.equal(rows.get("claude").failReason, "HTTP 429 요청 제한 · 5분 뒤 다시");
  await saveLimits(p({ source: "auto", measuredAt: sec(NOW + 180_000), fiveHour: w(16), extra: [] }, NOW + 180_000), at(180_000));
  assert.equal(rows.get("claude").failReason, null);
  assert.equal(rows.get("claude").failedAt, null);
  assert.deepEqual(toLimitsView(rows.get("claude"), NOW + 180_000).extra, [], "자동수집이 빈 목록을 보내면 추가 창을 지움");

  // 검증: 출처·읽은 시각·추가 창
  const bad = (b) => validateLimitsPayload({ provider: "claude", device: "pc", fiveHour: w(1), ...b }, NOW);
  assert.equal(bad({ source: "web" }).ok, false);
  assert.equal(bad({ measuredAt: "어제" }).ok, false);
  assert.equal(bad({ measuredAt: sec(NOW - 7 * HOUR) }).ok, false, "6시간 넘게 지난 값");
  assert.equal(bad({ measuredAt: sec(NOW + HOUR) }).payload.measuredAt.getTime(), NOW, "미래 시각은 지금으로");
  assert.equal(bad({ extra: "x" }).ok, false);
  const ex = bad({ extra: [null, { key: "", usedPct: 1 }, { key: "seven_day_opus", usedPct: 3, resetsAt: null }, { key: "a\u0000b", usedPct: 130, resetsAt: NOW }] }).payload.extra;
  assert.deepEqual(ex, [{ key: "seven_day_opus", usedPct: 3, resetsAt: null }, { key: "ab", usedPct: 100, resetsAt: null }]);
  assert.equal(validateLimitsPayload({ provider: "codex", device: "pc", status: "failed", reason: "x".repeat(200) }, NOW).payload.reason.length, 80);
  assert.equal(validateLimitsPayload({ provider: "codex", device: "pc", fiveHour: w(1) }, NOW).payload.source, "auto", "codex 기본 출처는 자동수집");
});

test("잠금·최소 간격: 동시에 두 번 돌면 한 번만 읽고, 60초 안에 다시 부르면 건너뜀, 2분 넘은 잠금은 치움", async () => {
  const home = claudeHome();
  try {
    let calls = 0;
    let release;
    const gate = new Promise((r) => (release = r));
    const fetchImpl = async () => (calls++, await gate, respond(200, usageSample())());
    const posted = [];
    const post = async (b) => (posted.push(b), true);
    const first = pc.runAllOnce({ env: home.env, fetchImpl, post, now: NOW, stream: null });
    const second = await pc.runAllOnce({ env: home.env, fetchImpl, post, now: NOW + 1000, stream: null });
    assert.deepEqual(second, { skipped: "다른 수집이 진행 중" });
    release();
    const r1 = await first;
    assert.equal(r1.claude.result, "ok");
    assert.equal(r1.codex.skipped, true, "Codex 를 안 쓰면(auth.json 없음) 건너뜀");
    assert.equal(calls, 1);
    assert.equal(fs.existsSync(path.join(home.dir, "ai-limits.lock")), false, "끝나면 잠금 풀림");

    assert.deepEqual(await pc.runAllOnce({ env: home.env, fetchImpl, post, now: NOW + 59_000, stream: null }), { skipped: "1분 안에 이미 읽음" });
    assert.equal((await pc.runAllOnce({ env: home.env, fetchImpl, post, now: NOW + 61_000, stream: null })).claude.result, "ok");
    assert.equal(calls, 2);

    // 끝나지 못한 실행의 잠금(2분 넘음)은 치우고 진행
    fs.writeFileSync(path.join(home.dir, "ai-limits.lock"), JSON.stringify({ pid: 1, at: NOW }));
    assert.equal(pc.acquireLock(home.dir, NOW + 60_000), null);
    const lock = pc.acquireLock(home.dir, NOW + 3 * 60_000);
    assert.ok(lock);
    lock.release();
    assert.equal(pc.readState(home.dir).lastRunAt, NOW + 61_000);
    assert.equal(pc.summaryLine(r1), "AI 한도 갱신: Claude 성공");
    assert.equal(pc.summaryLine({ claude: { result: "HTTP 429 요청 제한 · 5분 뒤 다시" }, codex: { result: "HTTP 401" } }), "AI 한도 갱신: Claude 실패(HTTP 429 요청 제한 · 5분 뒤 다시) · Codex 실패(HTTP 401)");
    assert.equal(pc.summaryLine({ skipped: "1분 안에 이미 읽음" }), "AI 한도 갱신: 건너뜀(1분 안에 이미 읽음)");
  } finally {
    home.cleanup();
  }
});

test("일감·정비 끝 갱신: 던지지 않고, 15초(시험은 짧게) 넘으면 기다리지 않고, 로그는 한 줄", async () => {
  const home = claudeHome();
  try {
    const lines = [];
    const log = (l) => lines.push(l);
    const ok = await pc.refreshAfterTask({ log, env: home.env, fetchImpl: respond(200, usageSample()), post: async () => true });
    assert.equal(ok, "AI 한도 갱신: Claude 성공");
    const slow = await pc.refreshAfterTask({ log, env: { ...home.env, AI_LIMITS_STATE_DIR: fs.mkdtempSync(path.join(home.dir, "s-")) }, fetchImpl: () => new Promise(() => {}), post: async () => true, timeoutMs: 50 });
    assert.equal(slow, "AI 한도 갱신: 건너뜀(시간 초과 0초)");
    const boom = await pc.refreshAfterTask({ log: () => { throw new Error("log 실패"); }, env: home.env, post: async () => true });
    assert.match(boom, /^AI 한도 갱신: /);
    assert.equal(lines.length, 2, "호출마다 한 줄");
    // 보낼 주소·토큰이 없으면 아무것도 읽지 않음
    let called = 0;
    const none = await pc.refreshAfterTask({ log, env: { ...home.env, CLAUDE_STATUS_URL: "", AI_LIMITS_URL: "" }, fetchImpl: async () => (called++, respond(200, {})()) });
    assert.equal(none, "AI 한도 갱신: 건너뜀(보낼 주소·토큰 없음)");
    assert.equal(called, 0);
  } finally {
    home.cleanup();
  }
});

test("감독 프로그램 연결: 일감·정비 출력에서 rate_limit_event 를 보고, 끝날 때(성공·실패 모두) 갱신", () => {
  const sup = fs.readFileSync(path.join(repo, "tools/factory-supervisor/supervisor.mjs"), "utf8");
  const mnt = fs.readFileSync(path.join(repo, "tools/factory-supervisor/maintenance.mjs"), "utf8");
  for (const src of [sup, mnt]) {
    assert.match(src, /import \{ noteRateLimitEvent, refreshAfterTask \} from "\.\/ai-limits\.mjs";/);
    assert.match(src, /if \(!ev\) return;\s*\n\s*noteRateLimitEvent\(ev\);/);
  }
  assert.match(sup, /\} finally \{\s*\n\s*running\.delete\(job\.id\);[\s\S]{0,200}void refreshAfterTask\(\{ log \}\);/);
  assert.match(mnt, /\} finally \{\s*\n\s*lock\?\.release\(\);[\s\S]{0,200}void refreshAfterTask\(/);
});
