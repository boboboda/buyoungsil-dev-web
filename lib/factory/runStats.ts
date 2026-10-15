// lib/factory/runStats.ts
// 블록별 비용·시간 통계(4-4)의 순수 계산: 결과 분류, 한 줄 만들기, 집계(에이전트·앱·카드·도구·기간), 7일 요약 한 줄.
// DB 를 읽고 쓰는 쪽은 runStatsDb.ts. 여기는 DB 없이 시험할 수 있다. 값에 비밀은 없다(토큰 수·시간·결과·횟수·외부 비용 수치뿐).
export const RUN_RESULTS = ["success", "failed", "blocked"] as const;
export type RunResult = (typeof RUN_RESULTS)[number];

export const GROUP_BYS = ["agent", "app", "card", "tool"] as const;
export type GroupBy = (typeof GROUP_BYS)[number];

export const PERIODS = ["day", "week", "month"] as const;
export type Period = (typeof PERIODS)[number];

export const GROUP_LABEL: Record<GroupBy, string> = { agent: "에이전트 종류", app: "앱", card: "결과물 카드", tool: "도구·방법" };
export const PERIOD_LABEL: Record<Period, string> = { day: "일(최근 24시간)", week: "주(최근 7일)", month: "월(최근 30일)" };
export const RESULT_LABEL: Record<RunResult, string> = { success: "성공", failed: "실패", blocked: "막힘" };
export const PERIOD_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30 };

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_MS = 9 * 60 * 60 * 1000;

export interface TokenSum {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface RunStat {
  kind: "job" | "maintenance" | "conductor";
  refId: string;
  agent: string;
  appSlug: string | null;
  cardId: string | null;
  tool: string | null;
  method: string | null;
  result: RunResult;
  tokens: TokenSum;
  waitMs: number;
  runMs: number;
  pausedMs: number;
  redoCount: number;
  externalCost: number;
  externalLabel: string | null;
  at: number; // epoch ms (끝난 시각)
}

export const ZERO_TOKENS: TokenSum = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
/** 토큰 합계: 입력+출력+캐시 생성(사용량 계기판의 '오늘 사용량'과 같은 기준. 캐시 읽기는 한도를 거의 쓰지 않아 뺀다) */
export const tokenTotal = (t: TokenSum) => t.input + t.output + t.cacheCreate;

const nonNeg = (v: unknown, max = Number.MAX_SAFE_INTEGER) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), max) : 0);

// ───────── 결과 분류 ─────────
// 막힘 = 사람이 풀어 줘야 이어지는 실패(키 부족·합치기 실패·비용 한도 확인 대기). 그 밖의 실패는 실패.
const BLOCKED_STAGES = new Set(["key", "keys", "merge", "confirm", "needs_confirmation"]);
const BLOCKED_REASON = /키(가| 이름이)? ?(없|부족|등록)|확인이 필요|합치기 실패|막혔|막힘/;

export function classifyResult(status: string, failStage?: string | null, failReason?: string | null): RunResult {
  if (status === "done" || status === "review" || status === "linkwait") return "success";
  if (status === "needs_confirmation") return "blocked";
  if (status === "failed") {
    if (failStage && BLOCKED_STAGES.has(failStage)) return "blocked";
    if (failReason && BLOCKED_REASON.test(failReason)) return "blocked";

    return "failed";
  }

  return "failed";
}

// ───────── 시간 ─────────
export interface DeployWindowLike {
  start: number;
  end: number;
}

/** from~to 중 배포(보고 중단) 구간과 겹치는 시간. 구간끼리 겹쳐도 한 번만 센다 */
export function overlapMs(windows: readonly DeployWindowLike[], from: number, to: number): number {
  if (to <= from) return 0;
  const clipped = windows
    .map((w) => ({ start: Math.max(w.start, from), end: Math.min(w.end, to) }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let cursor = from;

  for (const w of clipped) {
    const start = Math.max(w.start, cursor);

    if (w.end > start) {
      total += w.end - start;
      cursor = w.end;
    }
  }

  return total;
}

export interface TimingInput {
  queuedAt: number | null; // 승인(없으면 등록) 시각
  startedAt: number | null;
  endedAt: number;
  windows?: readonly DeployWindowLike[];
}

/** 대기 / 실행 / 일시 중지(ms). 실행은 중지 시간을 뺀 값 */
export function timingOf(t: TimingInput): { waitMs: number; runMs: number; pausedMs: number } {
  const started = t.startedAt ?? t.endedAt;
  const waitMs = t.queuedAt === null ? 0 : Math.max(0, started - t.queuedAt);
  const total = Math.max(0, t.endedAt - started);
  const pausedMs = Math.min(total, overlapMs(t.windows ?? [], started, t.endedAt));

  return { waitMs: nonNeg(waitMs, 2_000_000_000), runMs: nonNeg(total - pausedMs, 2_000_000_000), pausedMs: nonNeg(pausedMs, 2_000_000_000) };
}

/** 같은 앱에서 겹쳐 돈 일감이 있으면 토큰을 나눠 센다(세션을 일감별로 가를 수 없어서). others = 겹친 다른 일감 수 */
export function shareTokens(t: TokenSum, others: number): TokenSum {
  const d = 1 + Math.max(0, Math.floor(others));

  return d === 1 ? t : { input: Math.round(t.input / d), output: Math.round(t.output / d), cacheCreate: Math.round(t.cacheCreate / d), cacheRead: Math.round(t.cacheRead / d) };
}

/** 에이전트 종류(4-2 정의 번호). lib/factory/factoryMap.ts agentOfJob 과 같은 규칙 */
export function agentOf(job: { kind: string; releaseKind?: string | null; parallelGroup?: string | null }): string {
  if (job.releaseKind) return "R1";
  if (job.kind === "lab") return "L1";
  if (job.kind === "tool") return "T";
  if (job.kind === "new") return "A1";

  return job.parallelGroup ? "A3" : "A2";
}

/** 도구 일감 결과의 외부 비용(PixelLab 호출 수). 모양이 이상하면 0 */
export function externalOf(kind: string, toolResult: unknown): { cost: number; label: string | null } {
  if (kind !== "tool" || !toolResult || typeof toolResult !== "object") return { cost: 0, label: null };
  const c = nonNeg((toolResult as { cost?: unknown }).cost, 100_000);

  return c > 0 ? { cost: c, label: "PixelLab 호출" } : { cost: 0, label: null };
}

// ───────── 한 줄 만들기(DB 에 쓰기 전 정리) ─────────
export function cleanStat(s: Partial<RunStat> & Pick<RunStat, "kind" | "refId" | "agent">): RunStat {
  const t: Partial<TokenSum> = s.tokens ?? {};

  return {
    kind: s.kind,
    refId: s.refId.slice(0, 80),
    agent: s.agent.slice(0, 8),
    appSlug: s.appSlug ? s.appSlug.slice(0, 60) : null,
    cardId: s.cardId ? s.cardId.slice(0, 60) : null,
    tool: s.tool ? s.tool.slice(0, 60) : null,
    method: s.method ? s.method.slice(0, 60) : null,
    result: RUN_RESULTS.includes(s.result as RunResult) ? (s.result as RunResult) : "failed",
    tokens: { input: nonNeg(t.input), output: nonNeg(t.output), cacheCreate: nonNeg(t.cacheCreate), cacheRead: nonNeg(t.cacheRead) },
    waitMs: nonNeg(s.waitMs, 2_000_000_000),
    runMs: nonNeg(s.runMs, 2_000_000_000),
    pausedMs: nonNeg(s.pausedMs, 2_000_000_000),
    redoCount: nonNeg(s.redoCount, 1000),
    externalCost: nonNeg(s.externalCost, 1e9),
    externalLabel: s.externalLabel ? s.externalLabel.slice(0, 40) : null,
    at: s.at ?? Date.now(),
  };
}

// ───────── 집계 ─────────
export interface UsageRow {
  key: string;
  label: string;
  runs: number;
  success: number;
  failed: number;
  blocked: number;
  tokens: number; // 입력+출력+캐시 생성
  tokensDetail: TokenSum;
  waitMs: number;
  runMs: number;
  pausedMs: number;
  redo: number;
  externalCost: number;
  externalLabel: string | null;
}

export interface UsageByBlock {
  by: GroupBy;
  period: Period;
  from: number;
  to: number;
  rows: UsageRow[];
  total: UsageRow;
  trend: { label: string; tokens: number; runs: number }[];
}

export type LabelOf = (by: GroupBy, key: string) => string;

/** 집계 기준에 따른 묶음 키. 값이 없으면 '(없음)' 묶음 */
export function groupKey(s: RunStat, by: GroupBy): string {
  switch (by) {
    case "agent":
      return s.agent;
    case "app":
      return s.appSlug ?? "";
    case "card":
      return s.cardId ?? "";
    case "tool":
      return s.tool ? (s.method ? `${s.tool}/${s.method}` : s.tool) : "";
  }
}

const NONE_LABEL: Record<GroupBy, string> = { agent: "(종류 없음)", app: "(앱 없음)", card: "(카드 없이 한 일)", tool: "(도구 없이 한 일)" };

const emptyRow = (key: string, label: string): UsageRow => ({ key, label, runs: 0, success: 0, failed: 0, blocked: 0, tokens: 0, tokensDetail: { ...ZERO_TOKENS }, waitMs: 0, runMs: 0, pausedMs: 0, redo: 0, externalCost: 0, externalLabel: null });

function addTo(row: UsageRow, s: RunStat) {
  row.runs += 1;
  row[s.result] += 1;
  row.tokensDetail.input += s.tokens.input;
  row.tokensDetail.output += s.tokens.output;
  row.tokensDetail.cacheCreate += s.tokens.cacheCreate;
  row.tokensDetail.cacheRead += s.tokens.cacheRead;
  row.tokens = tokenTotal(row.tokensDetail);
  row.waitMs += s.waitMs;
  row.runMs += s.runMs;
  row.pausedMs += s.pausedMs;
  row.redo += s.redoCount;
  if (s.externalCost > 0) {
    row.externalCost += s.externalCost;
    row.externalLabel = row.externalLabel ?? s.externalLabel;
  }
}

/** 한국 시간 기준 날짜 글자(MM-DD) */
const kstDay = (ms: number) => new Date(ms + KST_MS).toISOString().slice(5, 10);

/** 기간 안의 흐름: 일=1시간 조각이 아니라 최근 7일 일별, 주=최근 8주 주별, 월=최근 6달 30일 단위 막대 */
export function trendBuckets(stats: readonly RunStat[], period: Period, now: number): UsageByBlock["trend"] {
  const spec = period === "day" ? { n: 7, size: DAY_MS } : period === "week" ? { n: 8, size: 7 * DAY_MS } : { n: 6, size: 30 * DAY_MS };
  const out = Array.from({ length: spec.n }, (_, i) => {
    const end = now - (spec.n - 1 - i) * spec.size;

    return { end, start: end - spec.size, label: period === "day" ? kstDay(end - 1) : `${kstDay(end - spec.size)}~`, tokens: 0, runs: 0 };
  });

  for (const s of stats) {
    const b = out.find((o) => s.at > o.start && s.at <= o.end);

    if (b) {
      b.tokens += tokenTotal(s.tokens);
      b.runs += 1;
    }
  }

  return out.map(({ label, tokens, runs }) => ({ label, tokens, runs }));
}

export function aggregate(stats: readonly RunStat[], opts: { by: GroupBy; period: Period; now: number; labelOf?: LabelOf; filter?: (s: RunStat) => boolean }): UsageByBlock {
  const { by, period, now } = opts;
  const from = now - PERIOD_DAYS[period] * DAY_MS;
  const scoped = stats.filter((s) => (opts.filter ? opts.filter(s) : true));
  const inWindow = scoped.filter((s) => s.at > from && s.at <= now);
  const rows = new Map<string, UsageRow>();
  const total = emptyRow("*", "합계");

  for (const s of inWindow) {
    const key = groupKey(s, by);
    const row = rows.get(key) ?? emptyRow(key, key ? (opts.labelOf?.(by, key) ?? key) : NONE_LABEL[by]);

    addTo(row, s);
    addTo(total, s);
    rows.set(key, row);
  }

  const list = [...rows.values()].sort((a, b) => b.tokens - a.tokens || b.runMs - a.runMs || b.runs - a.runs || a.label.localeCompare(b.label));

  return { by, period, from, to: now, rows: list, total, trend: trendBuckets(scoped, period, now) };
}

// ───────── 표시 글자 ─────────
export const compactTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;

  return String(Math.round(n));
};

export const durationText = (ms: number) => {
  const s = Math.round(ms / 1000);

  if (s < 60) return `${s}초`;
  const m = Math.round(s / 60);

  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);

  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
};

/** 블록에 붙이는 최근 7일 요약 한 줄. 기록이 없으면 '7일간 기록 없음' */
export function summaryLine(row: UsageRow | null | undefined): string {
  if (!row || row.runs === 0) return "7일 기록 없음";
  const bits = [`7일 ${row.runs}회`, `${compactTokens(row.tokens)} 토큰`, durationText(row.runMs)];

  if (row.failed + row.blocked > 0) bits.push(`실패·막힘 ${row.failed + row.blocked}`);
  if (row.externalCost > 0) bits.push(`${row.externalLabel ?? "외부"} ${Math.round(row.externalCost)}`);

  return bits.join(" · ");
}

/** 최근 7일(블록 종류별) 요약 줄 지도: 키 → 한 줄. 지도 노드 id 에 맞춰 쓰도록 키는 groupKey 값 그대로 */
export function weekSummaries(stats: readonly RunStat[], by: GroupBy, now: number): Map<string, string> {
  const r = aggregate(stats, { by, period: "week", now });

  return new Map(r.rows.filter((x) => x.key).map((x) => [x.key, summaryLine(x)]));
}

/** 채팅 커넥터용 글자 표(읽기 전용). 토큰·시간·결과·횟수만 */
export function usageText(u: UsageByBlock): string {
  const head = `${GROUP_LABEL[u.by]}별 · ${PERIOD_LABEL[u.period]}`;

  if (!u.rows.length) return `${head}\n기록이 없어요.`;
  const lines = u.rows.slice(0, 30).map((r) => {
    const parts = [`${r.label}: ${r.runs}회(성공 ${r.success}·실패 ${r.failed}·막힘 ${r.blocked})`, `토큰 ${compactTokens(r.tokens)}`, `대기 ${durationText(r.waitMs)}·실행 ${durationText(r.runMs)}·중지 ${durationText(r.pausedMs)}`];

    if (r.redo) parts.push(`다시 맞추기 ${r.redo}회`);
    if (r.externalCost > 0) parts.push(`${r.externalLabel ?? "외부 비용"} ${Math.round(r.externalCost)}`);

    return `- ${parts.join(" · ")}`;
  });
  const t = u.total;

  return [head, ...lines, `합계: ${t.runs}회 · 토큰 ${compactTokens(t.tokens)} · 실행 ${durationText(t.runMs)}${t.externalCost > 0 ? ` · ${t.externalLabel ?? "외부 비용"} ${Math.round(t.externalCost)}` : ""}`].join("\n");
}

/**
 * 지도·스튜디오 블록 id 마다 붙일 최근 7일 요약 한 줄.
 *  agent:<번호> → 에이전트, app:<앱>·project:<앱> → 앱, card:<id> → 카드, tool:<도구> → 도구(방법 무관), method:<도구>:<방법> → 도구·방법
 * 위 종류가 아닌 블록(기계·도메인 등)은 줄이 없다. 종류에 맞는데 기록이 없으면 '7일 기록 없음'.
 */
export function nodeUsageLines(stats: readonly RunStat[], ids: readonly string[], now: number): Record<string, string> {
  const week = (by: GroupBy, list: readonly RunStat[] = stats) => new Map(aggregate(list, { by, period: "week", now }).rows.map((r) => [r.key, r]));
  const agent = week("agent");
  const app = week("app");
  const card = week("card");
  const tool = week("tool", stats.filter((s) => s.tool).map((s) => ({ ...s, method: null })));
  const method = week("tool");
  const out: Record<string, string> = {};

  for (const id of ids) {
    const i = id.indexOf(":");
    const kind = id.slice(0, i);
    const rest = id.slice(i + 1);
    const table = kind === "agent" ? agent : kind === "app" || kind === "project" ? app : kind === "card" ? card : kind === "tool" ? tool : kind === "method" ? method : null;

    if (!table) continue;
    const key = kind === "method" ? rest.replace(/:default$/, "").replace(":", "/") : rest; // 방법이 비어 있으면 블록 id 가 :default 로 끝난다

    out[id] = summaryLine(table.get(key));
  }

  return out;
}
