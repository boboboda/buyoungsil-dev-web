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
  const ok = validateLimitsPayload({ provider: "claude", device: "pc", fiveHour: { usedPct: 23.46, resetsAt: sec(NOW + 2 * HOUR) }, extra: "무시" }, NOW);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.payload.fiveHour, { usedPct: 23.5, resetsAt: new Date(sec(NOW + 2 * HOUR) * 1000) });
  assert.equal(ok.payload.sevenDay, null);
  assert.equal(ok.payload.status, "ok");
  assert.equal("extra" in ok.payload, false);

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
    assert.deepEqual(posted[1], { provider: "codex", status: "failed" });

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
  assert.match(out, /data-chip="danger">수집 실패/);
  assert.match(out, /아직 받은 값이 없어요/);

  const old = renderToStaticMarkup(h(View, { initial: { ...empty, limits: { ...limits, stale: true, fiveHour: { ...limits.fiveHour, reset: true } }, codexLimits: null } }));
  assert.match(old, /오래된 값/);
  assert.match(old, /초기화됨/);
});
