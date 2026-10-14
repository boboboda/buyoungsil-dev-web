// 도구 일감(kind=tool, 2-3) 서버 쪽 시험: 입력 검사·비용 한도·가져가기(앱 슬롯과 따로, 같은 카드 하나씩)·자동 승인(기본 꺼짐)·보고(needs_confirmation)·
// Studio 요청 변환(재생성·쪼개기만)·커넥터. 가짜 DB(메모리)로 돌린다. 실제 DB·키·네트워크는 쓰지 않는다.
// 감독 쪽(임시 폴더 실행·키·정리)은 tools/factory-supervisor/tests/tooljob.test.mjs. 실행: npm run test:tool-jobs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");

function loadTs(relative, overrides = {}) {
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const req = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith("@/")) return loadTs(`${name.slice(2)}.ts`, overrides);

    return require(name);
  };

  new Function("require", "module", "exports", output)(req, module, module.exports);

  return module.exports;
}

const tj = loadTs("lib/factory/toolJobs.ts");
const toolManifest = loadTs("lib/factory/toolManifest.ts");

const TOOLS = toolManifest.validateManifestReport({
  commit: "8dfe69fabcde1",
  tools: [
    {
      name: "pixel-art",
      label: "도트 이미지 생성",
      description: "스튜디오 도구",
      layer: "studio",
      version: 1,
      source: "file",
      methods: [
        { id: "codex", label: "코덱스", secrets: [], limits: {} },
        { id: "pixellab", label: "PixelLab", secrets: ["PIXELLAB_TOKEN"], limits: {}, cost: { unit: "pixellab-generation", perCall: 1 } },
      ],
      inputs: [
        { name: "kind", label: "결과 종류", type: "string", required: true, choices: ["image-prop", "image-scene"], description: "종류" },
        { name: "subject", label: "대상", type: "string", required: true, description: "대상" },
        { name: "output_dir", label: "결과 폴더", type: "path", required: true, description: "출력" },
      ],
      outputs: { formats: ["PNG"], files: ["result.json"], resultFile: "result.json", resultFields: ["kind"] },
    },
  ],
}).report.tools;

// ───────── 순수 함수 ─────────

test("입력 검사: 장 수 1~8·대상 1~8·전체 16장·추가 지시 500자·참고 그림 4장, 기본 장 수 1", () => {
  const ok = tj.parseToolJobInput({ subject: " 싹이 ", count: 2, extra: "웃는\n얼굴", refArtIds: ["a1", "a1", "a2"] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { count: 2, subjects: ["싹이"], extra: "웃는 얼굴", refArtIds: ["a1", "a2"] });
  assert.equal(tj.parseToolJobInput({ subjects: ["a"] }).value.count, 1);
  assert.match(tj.parseToolJobInput({ count: 1 }).message, /대상/);
  assert.match(tj.parseToolJobInput({ subject: "a", count: 9 }).message, /장 수/);
  assert.match(tj.parseToolJobInput({ subject: "a", count: "x" }).message, /장 수/);
  assert.match(tj.parseToolJobInput({ subjects: ["a", "b", "c"], count: 8 }).message, /16장/);
  assert.match(tj.parseToolJobInput({ subjects: Array.from({ length: 9 }, (_, i) => `s${i}`) }).message, /8개/);
  assert.match(tj.parseToolJobInput({ subject: "a", refArtIds: ["a", "b", "c", "d", "e"] }).message, /4장/);
  assert.match(tj.parseToolJobInput({ subject: "a", refArtIds: ["../x"] }).message, /그림 id/);
  assert.equal(tj.parseToolJobInput({ subject: "a", extra: "x".repeat(900) }).value.extra.length, 500);
  assert.equal(tj.readToolInput({ count: 99, subjects: ["a"] }), null, "저장된 값이 이상하면 null");
  assert.equal(tj.readToolInput({ count: 1, subjects: ["a"], estimatedCost: 3, confirmed: true }).confirmed, true);
});

test("설정: 기본은 자동 승인 꺼짐·동시 2개·일 30/월 300, 이상한 값은 이전 값 유지", () => {
  assert.deepEqual(tj.DEFAULT_TOOL_SETTINGS, { autoApprove: false, autoApproveMaxCost: 5, concurrency: 2, dailyLimit: 30, monthlyLimit: 300 });
  const s = tj.normalizeToolSettings({ autoApprove: true, concurrency: "3", dailyLimit: 0, monthlyLimit: -1, autoApproveMaxCost: 1.5 });
  assert.equal(s.autoApprove, true);
  assert.equal(s.concurrency, 3);
  assert.equal(s.dailyLimit, 0, "0 = 제한 없음");
  assert.equal(s.monthlyLimit, 300, "음수는 무시");
  assert.equal(s.autoApproveMaxCost, 5, "정수가 아니면 무시");
  assert.equal(tj.normalizeToolSettings({ concurrency: 9 }).concurrency, 2);
  assert.deepEqual(tj.readStoredToolSettings("{broken"), tj.DEFAULT_TOOL_SETTINGS);
});

test("비용: 방법의 호출당 비용 × 전체 장 수, 한도는 일·월(한국 시간)로 센다", () => {
  assert.equal(tj.estimateToolCost(TOOLS["pixel-art"], "pixellab", 2, 3), 6);
  assert.equal(tj.estimateToolCost(TOOLS["pixel-art"], "codex", 2, 3), 0, "비용 표기가 없는 방법은 0");
  assert.equal(tj.estimateToolCost(undefined, "pixellab", 1, 1), 0);
  // 한국 시간 2026-10-15 00:30 = UTC 10-14 15:30
  const now = new Date("2026-10-14T15:30:00Z");
  const { dayStart, monthStart } = tj.usageWindows(now);
  assert.equal(dayStart.toISOString(), "2026-10-14T15:00:00.000Z");
  assert.equal(monthStart.toISOString(), "2026-09-30T15:00:00.000Z");
  const usage = tj.sumUsage(
    [
      { at: new Date("2026-10-14T16:00:00Z"), cost: 4 }, // 오늘
      { at: new Date("2026-10-14T14:00:00Z"), cost: 10 }, // 어제(이번 달)
      { at: new Date("2026-09-20T00:00:00Z"), cost: 99 }, // 지난달
      { at: null, cost: 5 },
    ],
    now,
  );
  assert.deepEqual(usage, { day: 4, month: 14 });
  const s = { dailyLimit: 10, monthlyLimit: 20 };
  assert.equal(tj.checkCostLimit({ day: 4, month: 14 }, 6, s).ok, true, "딱 한도까지는 통과");
  assert.match(tj.checkCostLimit({ day: 4, month: 14 }, 7, s).reason, /오늘.*한도\(10회\)/);
  assert.match(tj.checkCostLimit({ day: 0, month: 18 }, 3, s).reason, /이번 달.*한도\(20회\)/);
  assert.equal(tj.checkCostLimit({ day: 99, month: 999 }, 0, s).ok, true, "비용 없는 일감은 한도와 상관없다");
  assert.equal(tj.checkCostLimit({ day: 99, month: 999 }, 5, { dailyLimit: 0, monthlyLimit: 0 }).ok, true, "0 = 제한 없음");
});

test("자동 승인: 설정을 켠 경우만, 상한과 일·월 한도 안일 때만", () => {
  const base = { ...tj.DEFAULT_TOOL_SETTINGS };
  assert.equal(tj.shouldAutoApprove(base, 0, { day: 0, month: 0 }), false, "기본은 꺼짐");
  const on = { ...base, autoApprove: true, autoApproveMaxCost: 5, dailyLimit: 10 };
  assert.equal(tj.shouldAutoApprove(on, 0, { day: 0, month: 0 }), true, "비용 없는 일감");
  assert.equal(tj.shouldAutoApprove(on, 5, { day: 0, month: 0 }), true);
  assert.equal(tj.shouldAutoApprove(on, 6, { day: 0, month: 0 }), false, "자동 승인 상한 초과");
  assert.equal(tj.shouldAutoApprove(on, 3, { day: 8, month: 8 }), false, "일 한도 초과");
});

test("가져가기 고르기: 동시 실행 수 안에서, 같은 카드는 하나씩, 우선순위·승인 순", () => {
  const t0 = new Date("2026-10-15T00:00:00Z");
  const at = (m) => new Date(t0.getTime() + m * 60_000);
  const c = (id, cardId, m, priority = 0) => ({ id, cardId, approvedAt: at(m), createdAt: at(m), priority });
  const approved = [c("a", "card1", 1), c("b", "card1", 2), c("c", "card2", 3), c("d", "card3", 4)];

  assert.deepEqual(tj.pickToolClaims({ approved, runningCardIds: [], concurrency: 2, slots: 4 }), ["a", "c"], "같은 카드 b 는 건너뛴다");
  assert.deepEqual(tj.pickToolClaims({ approved, runningCardIds: ["card1"], concurrency: 2, slots: 4 }), ["c"], "card1 이 돌고 있으면 a·b 둘 다 건너뜀, 자리는 하나 남음");
  assert.deepEqual(tj.pickToolClaims({ approved, runningCardIds: ["x", "y"], concurrency: 2, slots: 4 }), [], "자리 없음");
  assert.deepEqual(tj.pickToolClaims({ approved, runningCardIds: [], concurrency: 4, slots: 1 }), ["a"], "감독이 요청한 자리만");
  assert.deepEqual(tj.pickToolClaims({ approved: [c("a", "card1", 1), c("z", "card2", 9, 5)], runningCardIds: [], concurrency: 1, slots: 1 }), ["z"], "우선순위가 먼저");
});

test("결과 정리: 비용·그림 주소(http 만)·메시지", () => {
  const r = tj.cleanToolResult({ cost: 3.4, arts: [{ url: "https://img.example/a.png", subject: "싹이", kind: "image-prop" }, { url: "file:///etc/passwd", subject: "x", kind: "y" }, { nope: 1 }], message: "완료", needsConfirmation: true });
  assert.equal(r.cost, 3);
  assert.equal(r.arts.length, 1);
  assert.equal(r.needsConfirmation, true);
  assert.equal(tj.cleanToolResult("x"), null);
  const view = tj.toolResultView({ count: 1, subjects: ["싹이"], estimatedCost: 2 }, r, "needs_confirmation", "card_x");
  assert.match(view.상태, /확인 대기/);
  assert.equal(view.만든_그림.length, 1);
  assert.equal(view.예상_비용, 2);
});

// ───────── 가짜 DB 로 등록·가져가기 ─────────

const inSet = (v, c) => (c && typeof c === "object" && Array.isArray(c.in) ? c.in.includes(v) : v === c);
function match(r, where = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return v.some((w) => match(r, w));
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(r[k]);
      if ("not" in v) return r[k] !== v.not;
      if ("gte" in v) return r[k] !== null && r[k] !== undefined && r[k] >= v.gte;
    }
    return r[k] === v;
  });
}

function fakeWorld({ cards, arts = [] } = {}) {
  const jobs = [];
  const settings = new Map();
  const logs = [];
  const events = [];
  const saved = [];
  let seq = 0;
  const factoryJob = {
    findMany: async ({ where = {}, take } = {}) => jobs.filter((r) => match(r, where)).slice(0, take ?? 9999).map((r) => ({ ...r })),
    count: async ({ where = {} } = {}) => jobs.filter((r) => match(r, where)).length,
    updateMany: async ({ where, data }) => {
      const hit = jobs.filter((r) => match(r, where));
      for (const r of hit) {
        for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === "object" && "increment" in v ? r[k] + v.increment : v;
      }
      return { count: hit.length };
    },
    create: async ({ data }) => {
      const row = { id: `tj${++seq}`, priority: 0, attempts: 0, createdAt: new Date(Date.now() + seq), startedAt: null, finishedAt: null, approvedAt: null, toolResult: null, workerId: null, failReason: null, ...data };
      jobs.push(row);
      return { ...row };
    },
  };
  const prisma = {
    factoryJob,
    factorySetting: {
      findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      upsert: async ({ where, create, update }) => void settings.set(where.key, settings.has(where.key) ? update.value : create.value),
    },
    factoryJobLog: { create: async ({ data }) => void logs.push(data), createMany: async ({ data }) => void logs.push(...data) },
    $transaction: async (fn) => fn({ ...prisma, $executeRaw: async () => 0 }),
    $executeRaw: async () => 0,
  };
  const cardRows = cards ?? [{ id: "card_1", appSlug: "one-tiny-frame", name: "싹이 단독 짤", version: 2, tool: "pixel-art", method: "pixellab", options: { kind: "image-prop" }, refRules: {}, settings: "", enabled: true }];
  const world = {
    jobs,
    settings,
    logs,
    events,
    saved,
    prisma,
    overrides: {
      "@/lib/prisma": { __esModule: true, default: prisma },
      "@prisma/client": { Prisma: {} },
      "@/lib/factory/jobs": { LEASE_MS: 600_000, MAX_PENDING_JOBS: 30 },
      "@/lib/factory/settings": { getDefaultAiEngine: async () => "claude" },
      "@/lib/factory/arts": {
        resolvePicked: async (_db, _slug, ids) => ids.filter((id) => arts.includes(id)).map((id) => ({ id })),
        savePicks: async (_db, jobId, ids) => void saved.push({ jobId, ids }),
      },
      "@/lib/factory/cardsDb": {
        resolveCardForEnqueue: async (_slug, ref) => {
          const row = cardRows.find((c) => c.id === ref || c.name === ref);
          if (!row) return { ok: false, message: `카드가 없어요: ${ref}` };
          if (!row.enabled) return { ok: false, message: "꺼진 카드" };

          return { ok: true, id: row.id, name: row.name, secrets: row.method === "pixellab" ? ["PIXELLAB_TOKEN"] : [] };
        },
        findCardRow: async (_slug, id) => cardRows.find((c) => c.id === id) ?? null,
      },
      "@/lib/factory/toolManifestDb": { readManifestTools: async () => TOOLS },
      "@/lib/factory/telegram": { notifyJobEvent: (id, ev) => void events.push({ id, ev }) },
    },
  };

  return world;
}

const loadDb = (w) => loadTs("lib/factory/toolJobsDb.ts", w.overrides);

test("등록: 기본은 승인 대기(자동 승인 꺼짐), 카드·키·참고 그림을 일감에 묶는다", async () => {
  const w = fakeWorld({ arts: ["art_ok"] });
  const db = loadDb(w);
  const r = await db.enqueueToolJob({ appSlug: "one-tiny-frame", card: "싹이 단독 짤", subject: "싹이", count: 2, extra: "밝게", refArtIds: ["art_ok"] }, { source: "채팅" });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.autoApproved, false);
  const job = w.jobs[0];
  assert.equal(job.kind, "tool");
  assert.equal(job.status, "pending");
  assert.equal(job.cardId, "card_1");
  assert.deepEqual(job.requiredSecrets, ["PIXELLAB_TOKEN"], "키는 설명서가 정한 방법의 키만 이름으로");
  assert.equal(job.toolInput.estimatedCost, 2, "pixellab 호출당 1 × 2장");
  assert.deepEqual(w.saved, [{ jobId: job.id, ids: ["art_ok"] }]);
  assert.deepEqual(w.events, [{ id: job.id, ev: "pending" }], "승인 대기 알림");
  assert.match(job.planMarkdown, /싹이 단독 짤 \(판 2\)/);
  assert.equal(JSON.stringify(job).includes("TOKEN_VALUE"), false);
});

test("등록 거절: 없는 카드·잘못된 입력·승인 안 된 참고 그림·AI 턴 방법·설명서 없음", async () => {
  const w = fakeWorld();
  const db = loadDb(w);
  assert.match((await db.enqueueToolJob({ appSlug: "one-tiny-frame", card: "없음", subject: "a" })).message, /카드/);
  assert.match((await db.enqueueToolJob({ appSlug: "one-tiny-frame", card: "card_1" })).message, /대상/);
  assert.match((await db.enqueueToolJob({ appSlug: "x", card: "card_1", subject: "a" })).message, /appSlug/);
  assert.match((await db.enqueueToolJob({ appSlug: "one-tiny-frame", card: "card_1", subject: "a", refArtIds: ["nope"] })).message, /승인/);
  assert.equal(w.jobs.length, 0);
  const ai = fakeWorld({ cards: [{ id: "card_ai", appSlug: "one-tiny-frame", name: "AI 카드", version: 1, tool: "pixel-art", method: "llm-post", options: {}, refRules: {}, settings: "", enabled: true }] });
  const tjAi = loadTs("lib/factory/toolJobs.ts");
  tjAi.AI_TURN_METHODS.add("llm-post"); // 같은 모듈 인스턴스가 아니라서 아래에서 따로 확인
  const dbAi = loadTs("lib/factory/toolJobsDb.ts", { ...ai.overrides, "@/lib/factory/toolJobs": tjAi });
  assert.match((await dbAi.enqueueToolJob({ appSlug: "one-tiny-frame", card: "card_ai", subject: "a" })).message, /AI 턴이 필요해서/);
  const none = fakeWorld();
  none.overrides["@/lib/factory/toolManifestDb"] = { readManifestTools: async () => ({}) };
  assert.match((await loadDb(none).enqueueToolJob({ appSlug: "one-tiny-frame", card: "card_1", subject: "a" })).message, /설명서/);
});

test("자동 승인: 설정을 켜면 상한·한도 안에서만 바로 승인 상태로 등록한다 (알림 없음)", async () => {
  const w = fakeWorld();
  const db = loadDb(w);
  await db.setToolSettings({ autoApprove: true, autoApproveMaxCost: 2, dailyLimit: 5 });
  const a = await db.enqueueToolJob({ appSlug: "one-tiny-frame", card: "card_1", subject: "싹이", count: 2 }, { source: "채팅" });
  assert.equal(a.autoApproved, true);
  assert.equal(w.jobs[0].status, "approved");
  assert.ok(w.jobs[0].approvedAt);
  assert.equal(w.events.length, 0);
  const b = await db.enqueueToolJob({ appSlug: "one-tiny-frame", card: "card_1", subject: "싹이", count: 3 }, { source: "채팅" });
  assert.equal(b.autoApproved, false, "예상 비용 3 > 자동 승인 상한 2");
  assert.equal(w.jobs[1].status, "pending");
  assert.equal((await db.getToolSettings()).autoApprove, true);
});

test("가져가기: 앱 슬롯과 따로 동시 2개, 같은 카드는 하나씩, 시도 횟수·로그", async () => {
  const w = fakeWorld({
    cards: [
      { id: "card_1", appSlug: "one-tiny-frame", name: "A", version: 1, tool: "pixel-art", method: "codex", options: {}, refRules: {}, settings: "", enabled: true },
      { id: "card_2", appSlug: "one-tiny-frame", name: "B", version: 1, tool: "pixel-art", method: "codex", options: {}, refRules: {}, settings: "", enabled: true },
    ],
  });
  const db = loadDb(w);
  await db.setToolSettings({ autoApprove: true });
  for (const card of ["card_1", "card_1", "card_2", "card_2"]) await db.enqueueToolJob({ appSlug: "one-tiny-frame", card, subject: "a" });
  assert.deepEqual(w.jobs.map((j) => j.status), ["approved", "approved", "approved", "approved"]);

  const first = await db.claimToolJobs("mainpc", 4);
  assert.equal(first.length, 2, "설정 동시 실행 수(기본 2)");
  assert.deepEqual(first.map((j) => j.cardId).sort(), ["card_1", "card_2"], "같은 카드는 동시에 하나");
  assert.ok(first.every((j) => j.kind === "tool" && j.toolInput && j.attempts === 1));
  assert.equal((await db.claimToolJobs("mainpc", 4)).length, 0, "자리가 없으면 더 가져가지 않는다");
  assert.ok(w.logs.some((l) => /도구 일감: AI 없이 카드로 바로 실행/.test(l.message)));
  // 하나가 끝나면 같은 카드의 다음 일감이 시작한다
  const done = w.jobs.find((j) => j.status === "running" && j.cardId === "card_1");
  done.status = "done";
  const next = await db.claimToolJobs("mainpc", 4);
  assert.equal(next.length, 1);
  assert.equal(next[0].cardId, "card_1");
  await db.setToolSettings({ concurrency: 4 });
  assert.equal((await db.claimToolJobs("mainpc", 0)).length, 0, "감독이 자리를 0 으로 요청하면 받지 않는다");
});

test("비용 한도: 넘는 일감은 가져가지 않고 확인 대기로 멈춘 뒤 알린다. 확인된 일감은 통과한다", async () => {
  const w = fakeWorld();
  const db = loadDb(w);
  await db.setToolSettings({ autoApprove: true, autoApproveMaxCost: 10, dailyLimit: 4, concurrency: 4 });
  // 오늘 이미 3회 사용
  w.jobs.push({ id: "old", kind: "tool", status: "done", cardId: "card_x", startedAt: new Date(), finishedAt: new Date(), toolInput: null, toolResult: { cost: 3, arts: [], message: "" } });
  const a = await db.enqueueToolJob({ appSlug: "one-tiny-frame", card: "card_1", subject: "싹이", count: 2 });
  assert.equal(a.autoApproved, false, "등록 때도 일 한도(4)를 넘으니 자동 승인하지 않는다 (3+2>4)");
  w.jobs.find((j) => j.id === a.id).status = "approved"; // 사람이 승인했다고 하자
  const claimed = await db.claimToolJobs("mainpc", 4);

  assert.equal(claimed.length, 0);
  const held = w.jobs.find((j) => j.id === a.id);
  assert.equal(held.status, "needs_confirmation");
  assert.match(held.failReason, /오늘 PixelLab 호출 한도\(4회\)/);
  assert.equal(held.toolResult.needsConfirmation, true);
  assert.deepEqual(w.events.filter((e) => e.ev === "needs_confirmation").map((e) => e.id), [a.id], "텔레그램 알림");
  assert.ok(w.logs.some((l) => l.jobId === a.id && /비용 한도 확인이 필요해서 멈췄어요/.test(l.message)));
  // 사람이 [그대로 진행]을 누른 일감(adminAction confirm 이 toolInput.confirmed 를 켠다)은 한도 검사 없이 시작한다
  held.status = "approved";
  held.toolInput = { ...held.toolInput, confirmed: true };
  const again = await db.claimToolJobs("mainpc", 4);
  assert.equal(again.length, 1);
  assert.equal(held.status, "running");
});

test("진행 중 일감의 예상 비용도 한도에 센다 (두 일감이 한꺼번에 한도를 넘지 못하게)", async () => {
  const w = fakeWorld({
    cards: [
      { id: "card_1", appSlug: "one-tiny-frame", name: "A", version: 1, tool: "pixel-art", method: "pixellab", options: {}, refRules: {}, settings: "", enabled: true },
      { id: "card_2", appSlug: "one-tiny-frame", name: "B", version: 1, tool: "pixel-art", method: "pixellab", options: {}, refRules: {}, settings: "", enabled: true },
    ],
  });
  const db = loadDb(w);
  await db.setToolSettings({ autoApprove: true, autoApproveMaxCost: 99, dailyLimit: 5, concurrency: 4 });
  const x = await db.enqueueToolJob({ appSlug: "one-tiny-frame", card: "card_1", subject: "a", count: 3 });
  const y = await db.enqueueToolJob({ appSlug: "one-tiny-frame", card: "card_2", subject: "b", count: 3 });
  // 등록 때는 각각 3 ≤ 5 라 자동 승인. 가져갈 때 두 번째는 3+3 > 5
  assert.equal(x.autoApproved && y.autoApproved, true);
  const claimed = await db.claimToolJobs("mainpc", 4);

  assert.equal(claimed.length, 1);
  assert.equal(w.jobs.find((j) => j.id === y.id).status, "needs_confirmation");
});

// ───────── 보고·승인·앱 일감과의 분리 ─────────

const jobsMod = loadTs("lib/factory/jobs.ts", {
  "@/lib/prisma": { __esModule: true, default: {} },
  "@/lib/factory/ai": loadTs("lib/factory/ai.ts"),
  "@/lib/factory/reviewVideo": { deleteReviewVideo: async () => {} },
  "@/lib/factory/mask": { maskSecrets: (v) => v },
  "@/lib/factory/toolBroker": loadTs("lib/factory/toolBroker.ts", { "@/lib/factory/mask": { maskSecrets: (v) => v } }),
  "@/lib/factory/handoff": { cleanHandoff: () => null },
  "@/lib/factory/settings": { getDefaultClaudeModel: async () => null },
  "@/lib/factory/parallel": loadTs("lib/factory/parallel.ts", { "@/lib/prisma": { __esModule: true, default: {} } }),
});

test("보고: needs_confirmation 과 toolResult 를 받고, 종류 이름·상태 목록에 tool 이 있다", () => {
  assert.ok(jobsMod.JOB_KINDS.includes("tool"));
  assert.equal(jobsMod.KIND_LABELS.tool, "도구");
  assert.ok(jobsMod.JOB_STATUSES.includes("needs_confirmation"));
  const p = jobsMod.parseReport({ jobId: "job1", status: "needs_confirmation", failReason: "한도", toolResult: { cost: 2, arts: [] } });
  assert.equal(p.ok, true);
  assert.equal(p.value.status, "needs_confirmation");
  assert.equal(p.value.toolResult.cost, 2);
  assert.equal(jobsMod.parseReport({ jobId: "job1", status: "weird" }).ok, false);
});

test("앱 슬롯과 분리: 앱 일감 가져가기·대기열 순서에서 도구 일감은 빠지고, /next 는 toolSlots 로만 내준다", () => {
  const jobs = read("lib/factory/jobs.ts");
  const queue = read("lib/factory/queue.ts");
  const next = read("app/api/factory/next/route.ts");

  assert.match(jobs, /where: \{ status: "approved", kind: \{ not: TOOL_KIND \}/, "claimJobs 는 도구 일감을 가져가지 않는다");
  assert.match(jobs, /status: "running", kind: \{ not: TOOL_KIND \}/, "앱별 1개 계산에서도 뺀다");
  assert.match(queue, /kind: \{ not: "tool" \}/);
  assert.match(queue, /notIn: \["lab", "tool"\]/);
  assert.match(next, /toolSlots/);
  assert.match(next, /claimToolJobs\(worker, toolSlots\)/);
  assert.match(next, /toolSlots > 0 && !drain/, "드레인(업데이트 대기) 중에는 도구 일감도 내주지 않는다");
  assert.match(next, /j\.kind === TOOL_KIND\) return \{ \.\.\.j, \.\.\.card/, "도구 일감에는 작업 규칙·첫 지시문이 없다");
});

test("확인 동작: 확인 대기 → 승인됨(+확인 표시), 취소 가능. 도구 일감이 아니면 거절", () => {
  const src = read("lib/factory/jobs.ts");

  assert.match(src, /case "confirm":/);
  assert.match(src, /toolInput: \{ \.\.\.input, confirmed: true \}/);
  assert.match(src, /"review", "linkwait", "needs_confirmation"\] \} \},\n\s*data: \{ status: "cancelled"/, "확인 대기 일감도 취소할 수 있다");
  assert.match(read("app/api/factory/report/route.ts"), /out\.status === "needs_confirmation"\) void notifyJobEvent/, "보고로 멈추면 텔레그램 알림");
  assert.match(read("lib/factory/telegram.ts"), /확인 필요\(비용 한도\)/);
  assert.match(read("lib/factory/approvals.ts"), /status: "needs_confirmation"/, "할 일 목록에 올린다");
});

// ───────── Studio 요청 변환 ─────────

function loadRequests({ cards, arts = [], enq }) {
  const calls = [];
  const prisma = {
    factoryCard: { findMany: async ({ where }) => cards.filter((c) => c.appSlug === where.appSlug && c.enabled === where.enabled && c.tool === where.tool && c.method === where.method) },
    factoryArt: { findFirst: async ({ where }) => arts.find((a) => a.appSlug === where.appSlug && a.subject === where.subject && a.status === where.status) ?? null },
  };
  const mod = loadTs("lib/studio/requests.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/mcp": { enqueueWithId: async () => ({ isError: true, content: [{ text: "app" }] }) },
    "@/lib/factory/jobs": { APP_SLUG_RE: /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/ },
    "@/lib/factory/studioProjects": { isManualTool: () => false },
    "@/lib/factory/toolJobsDb": { enqueueToolJob: async (args, who) => (calls.push({ args, who }), enq ?? { ok: true, id: "tj9", autoApproved: false }) },
  });

  return { mod, calls };
}

const CARD = (over = {}) => ({ id: "card_c1", appSlug: "one-tiny-frame", name: "싹이 단독 짤", tool: "pixel-art", method: "pixellab", options: { kind: "image-prop" }, refRules: {}, settings: "", enabled: true, version: 1, description: "", ...over });

test("Studio 요청 변환: 재생성(regen)은 요청한 방식과 같은 방법의 카드가 있으면 도구 일감", async () => {
  const { mod, calls } = loadRequests({ cards: [CARD()] });
  const r = await mod.tryStudioToolJob({ kind: "regen", appSlug: "one-tiny-frame", engine: "pixellab", propName: "싹이", note: "더 밝게" });

  assert.deepEqual(r, { jobId: "tj9", autoApproved: false });
  assert.equal(calls[0].args.card, "card_c1");
  assert.deepEqual(calls[0].args.subjects, ["싹이"]);
  assert.equal(calls[0].args.extra, "더 밝게");
  assert.equal(calls[0].who.source, "Studio 요청", "승인 규칙은 기존과 같다(자동 승인은 설정에서만)");
  // 방식이 다른 카드뿐이면 예전처럼 앱 일감
  assert.equal(await mod.tryStudioToolJob({ kind: "regen", appSlug: "one-tiny-frame", engine: "codex", propName: "싹이", note: "" }), null);
  // 모션 카드(결과 종류가 다름)는 소품 재생성에 쓰지 않는다
  const motion = loadRequests({ cards: [CARD({ options: { kind: "motion-game" } })] });
  assert.equal(await motion.mod.tryStudioToolJob({ kind: "regen", appSlug: "one-tiny-frame", engine: "pixellab", propName: "싹이", note: "" }), null);
  // 기본 카드를 먼저 고른다
  const pref = loadRequests({ cards: [CARD({ id: "card_other", name: "기타" }), CARD({ id: "card_def", name: "기본 카드" })] });
  await pref.mod.tryStudioToolJob({ kind: "regen", appSlug: "one-tiny-frame", engine: "pixellab", propName: "싹이", note: "" });
  assert.equal(pref.calls[0].args.card, "card_def");
});

test("Studio 요청 변환: 다시 그리는 쪼개기(redraw)만 도구 일감, 자르기(cut)·배치(layout)는 앱 일감", async () => {
  const { mod, calls } = loadRequests({ cards: [CARD()], arts: [{ id: "art_src", appSlug: "one-tiny-frame", subject: "정원 세트", status: "approved" }] });
  const split = await mod.tryStudioToolJob({ kind: "split", appSlug: "one-tiny-frame", engine: "pixellab", method: "redraw", propName: "정원 세트", parts: ["꽃", "나무"], note: "" });

  assert.equal(split.jobId, "tj9");
  assert.deepEqual(calls[0].args.subjects, ["꽃", "나무"]);
  assert.deepEqual(calls[0].args.refArtIds, ["art_src"], "원본 소품의 승인 그림을 참고로");
  assert.match(calls[0].args.extra, /정원 세트/);
  assert.equal(await mod.tryStudioToolJob({ kind: "split", appSlug: "one-tiny-frame", method: "cut", propName: "정원 세트", parts: ["꽃", "나무"], note: "" }), null, "cut 은 이미지를 자르는 일이라 앱 일감");
  assert.equal(await mod.tryStudioToolJob({ kind: "layout", appSlug: "one-tiny-frame", layout: {}, note: "" }), null, "배치는 앱 데이터를 바꾸므로 앱 일감");
  assert.equal(await mod.tryStudioToolJob({ kind: "free", appSlug: "one-tiny-frame", instruction: "x", note: "" }), null);
  assert.equal(calls.length, 1);
});

test("Studio 요청 변환: 도구 일감 등록이 거절되면(null) 예전처럼 앱 일감으로 이어진다", async () => {
  const { mod } = loadRequests({ cards: [CARD()], enq: { ok: false, message: "거절" } });
  assert.equal(await mod.tryStudioToolJob({ kind: "regen", appSlug: "one-tiny-frame", engine: "pixellab", propName: "싹이", note: "" }), null);
  const src = read("lib/studio/requests.ts");
  assert.match(src, /const tool = await tryStudioToolJob\(v\)\.catch\(\(\) => null\);/, "예외도 앱 일감으로 이어진다");
  assert.match(src, /jobKind: "tool"/);
});

// ───────── 커넥터 ─────────

test("커넥터: generate_with_card 가 도구 목록·실행에 있고, get_factory_job 이 도구_결과를 준다", () => {
  const mcp = read("lib/factory/mcp.ts");

  assert.match(mcp, /name: "generate_with_card"/);
  assert.match(mcp, /required: \["appSlug", "card"\]/);
  assert.match(mcp, /case "generate_with_card":\n\s*return generateWithCard\(args\);/);
  assert.match(mcp, /enqueueToolJob\(args, \{ source \}\)/);
  assert.match(mcp, /도구_결과: toolResultView\(job\.toolInput, job\.toolResult, job\.status, job\.cardId\)/);
  assert.match(mcp, /generate_with_card\(appSlug, card, subject, count, extra\?\)/, "안내문에 쓰는 법");
  // 도구 목록에 새 도구가 한 번만 있다
  const names = [...mcp.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map((m) => m[1]);
  assert.equal(names.filter((n) => n === "generate_with_card").length, 1);
});

test("그림 등록 API: 카드 판 번호를 숫자로 읽는다 (예전 정규식은 'd' 글자만 받았다)", () => {
  const src = read("app/api/factory/art/route.ts");

  assert.ok(src.includes('/^\\d{1,6}$/.test(text("cardVersion"))'));
});

test("마이그레이션: 새 칸 2개만 추가하고 지우는 문장이 없다", () => {
  const dir = fs.readdirSync(path.join(repo, "prisma", "migrations")).filter((d) => d.endsWith("_tool_jobs"));

  assert.equal(dir.length, 1);
  const sql = read(`prisma/migrations/${dir[0]}/migration.sql`);

  assert.match(sql, /ADD COLUMN "toolInput" JSONB/);
  assert.match(sql, /ADD COLUMN "toolResult" JSONB/);
  assert.equal(/DROP|DELETE|TRUNCATE/i.test(sql.replace(/^--.*$/gm, "")), false);
  assert.match(read("prisma/schema.prisma"), /toolInput\s+Json\?/);
});
