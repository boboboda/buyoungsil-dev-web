// lib/novel/rules.ts
// 소설 공장의 규칙(순수 함수): 입력 검증, 화 상태 전이, 예약 발행 시각, 알림 조건, sync 에 넣을 화, 공개 조건.
// DB·네트워크를 쓰지 않아서 시험에서 그대로 부른다. DB 작업은 lib/novel/store.ts.

// 앱 공장 보고와 같은 한도(lib/factory/jobs.ts 의 APP_SLUG_RE·MAX_LOGS_PER_REPORT·MAX_LOG_MESSAGE·MAX_SUMMARY 와 같은 값)
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const MAX_LOGS_PER_REPORT = 50;
export const MAX_LOG_MESSAGE = 2000;
export const MAX_SUMMARY = 4000;

export const MAX_TITLE = 100;
export const MAX_BODY = 100_000;
export const MAX_GENRE = 50;
export const MAX_LOGLINE = 1000;
export const MAX_SETUP_SUMMARY = 20_000;
export const MAX_NOTE = 2000;
export const MAX_NUMBER = 9999;
export const MAX_ATTEMPTS = 99;
export const MAX_ISSUES = 50;
export const MAX_ISSUE_DETAIL = 1000;
export const MAX_TOKEN_ROLES = 8;
export const MAX_REPORT_BYTES = 256 * 1024; // 본문(10만 자)이 들어가서 이 라우트만 크게
export const BATCH_APPROVE_MAX = 5;
export const BATCH_NOTIFY_AT = 5; // batch5: 승인 대기 화가 이만큼 모이면 알림

export const WORK_STATUSES = [
  "setup",
  "active",
  "finished",
  "dropped",
] as const;
export const APPROVAL_MODES = ["every", "batch5", "auto"] as const;
export const EPISODE_STATUSES = [
  "planned",
  "drafting",
  "checking",
  "revising",
  "pending_approval",
  "approved",
  "held",
] as const;
// 실행기가 보고할 수 있는 상태. approved 는 사람(또는 auto 모드의 서버 규칙)만 정한다
export const WORKER_STATUSES = [
  "planned",
  "drafting",
  "checking",
  "revising",
  "pending_approval",
  "held",
] as const;
export const ISSUE_TYPES = [
  "consistency",
  "voice",
  "foreshadow",
  "quality",
] as const;
export const LOG_LEVELS = ["info", "warn", "error"] as const;

export type WorkStatus = (typeof WORK_STATUSES)[number];
export type ApprovalMode = (typeof APPROVAL_MODES)[number];
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

export const EPISODE_STATUS_LABELS: Record<EpisodeStatus, string> = {
  planned: "기획",
  drafting: "집필 중",
  checking: "검수 중",
  revising: "수정 중",
  pending_approval: "승인 대기",
  approved: "예약",
  held: "보류",
};

export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  setup: "설정 승인 대기",
  active: "연재 중",
  finished: "완결",
  dropped: "중단",
};

export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  every: "화마다 승인",
  batch5: "5화씩 일괄 승인",
  auto: "자동(검수 통과 시)",
};

export interface CheckResult {
  pass: boolean;
  issues: { type: (typeof ISSUE_TYPES)[number]; detail: string }[];
}
export type TokenUsage = Record<
  string,
  { model: string; in: number; out: number }
>;
export interface ReportLog {
  level: (typeof LOG_LEVELS)[number];
  message: string;
}

export interface SetupReport {
  kind: "setup";
  slug: string;
  title: string;
  genre: string | null;
  logline: string | null;
  setupSummary: string | null;
  logs: ReportLog[];
}

export interface EpisodeReport {
  kind: "episode";
  slug: string;
  number: number;
  status: WorkerStatus;
  title?: string | null;
  body?: string | null;
  summary?: string | null;
  attempts?: number;
  checkResult?: CheckResult | null;
  tokens?: TokenUsage | null;
  logs: ReportLog[];
}

export type NovelReport = SetupReport | EpisodeReport;
type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const has = (o: Record<string, unknown>, k: string) =>
  o[k] !== undefined && o[k] !== null;
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

// 줄바꿈(\n)·탭은 살리고 나머지 제어문자는 지운다. \r\n 은 \n 으로
export function cleanText(v: string): string {
  return v
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

// 문자열 필드: 없으면 null, 문자열이 아니거나 너무 길면 오류 문구
function text(
  o: Record<string, unknown>,
  key: string,
  max: number,
  oneLine = false,
): string | null | { error: string } {
  if (!has(o, key)) return null;
  const v = o[key];

  if (typeof v !== "string") return { error: `${key} 는 문자열이어야 합니다.` };
  let s = cleanText(v);

  if (oneLine) s = s.replace(/\s+/g, " ").trim();
  if (s.length > max) return { error: `${key} 는 ${max}자까지입니다.` };

  return s;
}
const isErr = (v: unknown): v is { error: string } =>
  isRecord(v) && typeof v.error === "string";

function parseLogs(v: unknown): Parsed<ReportLog[]> {
  if (v === undefined || v === null) return { ok: true, value: [] };
  if (!Array.isArray(v))
    return { ok: false, reason: "logs 는 배열이어야 합니다." };
  if (v.length > MAX_LOGS_PER_REPORT)
    return {
      ok: false,
      reason: `logs 는 한 번에 ${MAX_LOGS_PER_REPORT}개까지 보낼 수 있습니다.`,
    };
  const out: ReportLog[] = [];

  for (const rec of v) {
    if (!isRecord(rec) || typeof rec.message !== "string")
      return {
        ok: false,
        reason: "logs 항목은 { level, message } 형식이어야 합니다.",
      };
    const level = rec.level === undefined ? "info" : rec.level;

    if (!oneOf(LOG_LEVELS, level))
      return {
        ok: false,
        reason: "logs.level 은 info·warn·error 중 하나입니다.",
      };
    const message = cleanText(rec.message).trim();

    if (!message) continue;
    if (message.length > MAX_LOG_MESSAGE)
      return {
        ok: false,
        reason: `로그 메시지는 ${MAX_LOG_MESSAGE}자까지입니다.`,
      };
    out.push({ level, message });
  }

  return { ok: true, value: out };
}

function parseCheckResult(v: unknown): Parsed<CheckResult> {
  if (!isRecord(v) || typeof v.pass !== "boolean")
    return {
      ok: false,
      reason: "checkResult 는 { pass: boolean, issues: [] } 형식이어야 합니다.",
    };
  const issues = v.issues === undefined || v.issues === null ? [] : v.issues;

  if (!Array.isArray(issues))
    return { ok: false, reason: "checkResult.issues 는 배열이어야 합니다." };
  if (issues.length > MAX_ISSUES)
    return {
      ok: false,
      reason: `checkResult.issues 는 ${MAX_ISSUES}개까지입니다.`,
    };
  const out: CheckResult["issues"] = [];

  for (const it of issues) {
    if (
      !isRecord(it) ||
      !oneOf(ISSUE_TYPES, it.type) ||
      typeof it.detail !== "string"
    ) {
      return {
        ok: false,
        reason: `checkResult.issues 항목은 { type: ${ISSUE_TYPES.join("|")}, detail } 형식이어야 합니다.`,
      };
    }
    const detail = cleanText(it.detail).trim();

    if (detail.length > MAX_ISSUE_DETAIL)
      return {
        ok: false,
        reason: `검수 지적은 ${MAX_ISSUE_DETAIL}자까지입니다.`,
      };
    out.push({ type: it.type, detail });
  }

  return { ok: true, value: { pass: v.pass, issues: out } };
}

function parseTokens(v: unknown): Parsed<TokenUsage> {
  if (!isRecord(v))
    return {
      ok: false,
      reason: "tokens 는 역할별 { model, in, out } 객체여야 합니다.",
    };
  const roles = Object.keys(v);

  if (roles.length > MAX_TOKEN_ROLES)
    return {
      ok: false,
      reason: `tokens 역할은 ${MAX_TOKEN_ROLES}개까지입니다.`,
    };
  const out: TokenUsage = {};

  for (const role of roles) {
    const t = v[role];

    if (!/^[a-z][a-z0-9_-]{0,19}$/.test(role) || !isRecord(t))
      return {
        ok: false,
        reason: "tokens 의 역할 이름이나 형식이 올바르지 않습니다.",
      };
    const model =
      typeof t.model === "string" ? cleanText(t.model).trim().slice(0, 60) : "";

    if (!isInt(t.in ?? 0, 0, 1e10) || !isInt(t.out ?? 0, 0, 1e10))
      return {
        ok: false,
        reason: "tokens 의 in·out 은 0 이상의 정수여야 합니다.",
      };
    out[role] = {
      model,
      in: (t.in as number) ?? 0,
      out: (t.out as number) ?? 0,
    };
  }

  return { ok: true, value: out };
}

/** POST /api/novel/report 본문 검증. 실패 이유는 사람이 읽는 문구 */
export function parseNovelReport(body: unknown): Parsed<NovelReport> {
  if (!isRecord(body))
    return { ok: false, reason: "본문은 JSON 객체여야 합니다." };
  if (typeof body.slug !== "string" || !SLUG_RE.test(body.slug))
    return {
      ok: false,
      reason: "slug 형식이 올바르지 않습니다(영문 소문자·숫자·-, 3~40자).",
    };
  const logs = parseLogs(body.logs);

  if (logs.ok === false) return { ok: false, reason: logs.reason };

  if (body.kind === "setup") {
    const title = text(body, "title", MAX_TITLE, true);

    if (isErr(title)) return { ok: false, reason: title.error };
    if (!title)
      return { ok: false, reason: "설정 보고에는 title 이 필요합니다." };
    const genre = text(body, "genre", MAX_GENRE, true);
    const logline = text(body, "logline", MAX_LOGLINE);
    const setupSummary = text(body, "setupSummary", MAX_SETUP_SUMMARY);

    for (const f of [genre, logline, setupSummary])
      if (isErr(f)) return { ok: false, reason: f.error };

    return {
      ok: true,
      value: {
        kind: "setup",
        slug: body.slug,
        title,
        genre: genre as string | null,
        logline: logline as string | null,
        setupSummary: setupSummary as string | null,
        logs: logs.value,
      },
    };
  }

  if (body.kind !== "episode")
    return { ok: false, reason: "kind 는 setup 또는 episode 입니다." };
  if (!isInt(body.number, 1, MAX_NUMBER))
    return { ok: false, reason: `number 는 1~${MAX_NUMBER} 정수입니다.` };
  if (body.status === "approved")
    return { ok: false, reason: "approved 는 사람만 정할 수 있습니다." };
  if (!oneOf(WORKER_STATUSES, body.status))
    return {
      ok: false,
      reason: `status 는 ${WORKER_STATUSES.join(", ")} 중 하나입니다.`,
    };

  const value: EpisodeReport = {
    kind: "episode",
    slug: body.slug,
    number: body.number,
    status: body.status,
    logs: logs.value,
  };

  for (const [key, max, oneLine] of [
    ["title", MAX_TITLE, true],
    ["body", MAX_BODY, false],
    ["summary", MAX_SUMMARY, false],
  ] as const) {
    const v = text(body, key, max, oneLine);

    if (isErr(v)) return { ok: false, reason: v.error };
    if (has(body, key)) value[key] = v;
  }
  if (has(body, "attempts")) {
    if (!isInt(body.attempts, 0, MAX_ATTEMPTS))
      return { ok: false, reason: `attempts 는 0~${MAX_ATTEMPTS} 정수입니다.` };
    value.attempts = body.attempts;
  }
  if (has(body, "checkResult")) {
    const c = parseCheckResult(body.checkResult);

    if (c.ok === false) return { ok: false, reason: c.reason };
    value.checkResult = c.value;
  }
  if (has(body, "tokens")) {
    const t = parseTokens(body.tokens);

    if (t.ok === false) return { ok: false, reason: t.reason };
    value.tokens = t.value;
  }
  if (value.status === "pending_approval" && !value.body?.trim())
    return {
      ok: false,
      reason: "pending_approval 보고에는 body(본문)가 필요합니다.",
    };

  return { ok: true, value };
}

// ───────── 상태 전이 ─────────
export type Decision =
  | { ok: true }
  | { ok: false; code: 400 | 409; reason: string };

/** 실행기 보고로 화 상태를 바꿔도 되는지. from 이 null 이면 새 화. 같은 상태 재전송은 늘 허용(멱등) */
export function workerTransition(from: string | null, to: string): Decision {
  if (to === "approved" || !oneOf(WORKER_STATUSES, to))
    return {
      ok: false,
      code: 400,
      reason: "실행기가 보고할 수 없는 상태입니다.",
    };
  if (from === null) return { ok: true };
  if (from === "approved")
    return { ok: false, code: 409, reason: "이미 승인된 화입니다." };
  if (from === to) return { ok: true };
  // 승인 대기·보류는 사람 차례. 사람이 [수정 요청]·[보류 해제]로 revising 으로 돌려야 실행기가 다시 쓴다
  if (from === "pending_approval" || from === "held")
    return { ok: false, code: 409, reason: "사람의 판단을 기다리는 화입니다." };

  return { ok: true };
}

export type HumanAction = "approve" | "revise" | "release_hold";

/** 통제실 버튼으로 바꿀 수 있는지. 바뀐 뒤 상태도 돌려준다 */
export function humanTransition(
  from: string,
  action: HumanAction,
  hasBody = true,
): { ok: true; to: EpisodeStatus } | { ok: false; reason: string } {
  if (action === "approve") {
    if (from !== "pending_approval")
      return { ok: false, reason: "승인 대기인 화만 승인할 수 있어요." };
    if (!hasBody)
      return { ok: false, reason: "본문이 없는 화는 승인할 수 없어요." };

    return { ok: true, to: "approved" };
  }
  if (action === "revise") {
    if (from !== "pending_approval")
      return { ok: false, reason: "승인 대기인 화만 수정 요청할 수 있어요." };

    return { ok: true, to: "revising" };
  }
  if (from !== "held")
    return { ok: false, reason: "보류된 화만 보류 해제할 수 있어요." };

  return { ok: true, to: "revising" };
}

/** 설정 승인: setup 인 작품만 */
export const canApproveSetup = (workStatus: string) => workStatus === "setup";

/** 수정 요청 메모 검증(필수면 빈 값 거절) */
export function parseNote(
  v: unknown,
  required: boolean,
): Parsed<string | null> {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
    return required
      ? { ok: false, reason: "메모를 적어 주세요." }
      : { ok: true, value: null };
  }
  if (typeof v !== "string")
    return { ok: false, reason: "메모는 문자열이어야 해요." };
  const s = cleanText(v).trim();

  if (s.length > MAX_NOTE)
    return { ok: false, reason: `메모는 ${MAX_NOTE}자까지예요.` };

  return { ok: true, value: s };
}

/** PATCH /api/admin/novel/works/[slug] 본문 검증 */
export function parseWorkPatch(body: unknown): Parsed<{
  paused?: boolean;
  approvalMode?: ApprovalMode;
  publishPerDay?: number;
  status?: WorkStatus;
}> {
  if (!isRecord(body)) return { ok: false, reason: "JSON 객체가 아니에요." };
  const out: {
    paused?: boolean;
    approvalMode?: ApprovalMode;
    publishPerDay?: number;
    status?: WorkStatus;
  } = {};

  if (body.paused !== undefined) {
    if (typeof body.paused !== "boolean")
      return { ok: false, reason: "paused 는 true/false 예요." };
    out.paused = body.paused;
  }
  if (body.approvalMode !== undefined) {
    if (!oneOf(APPROVAL_MODES, body.approvalMode))
      return { ok: false, reason: "승인 방식이 올바르지 않아요." };
    out.approvalMode = body.approvalMode;
  }
  if (body.publishPerDay !== undefined) {
    if (!isInt(body.publishPerDay, 1, 24))
      return { ok: false, reason: "하루 발행 화수는 1~24 예요." };
    out.publishPerDay = body.publishPerDay;
  }
  if (body.status !== undefined) {
    // setup 으로 되돌리기·setup 에서 바로 active 는 막는다(설정 승인 버튼으로만 active)
    if (!oneOf(["active", "finished", "dropped"] as const, body.status))
      return {
        ok: false,
        reason: "작품 상태는 active·finished·dropped 중 하나예요.",
      };
    out.status = body.status;
  }
  if (Object.keys(out).length === 0)
    return { ok: false, reason: "바꿀 항목이 없어요." };

  return { ok: true, value: out };
}

// ───────── 예약 발행 ─────────
export const DAY_MS = 24 * 60 * 60 * 1000;
export const publishGapMs = (perDay: number) =>
  Math.round(DAY_MS / Math.min(24, Math.max(1, Math.floor(perDay) || 1)));

/** 다음 예약 시각 = max(지금, 이 작품에서 이미 배정된 마지막 시각 + 간격) */
export function nextPublishAt(
  now: Date,
  lastPublishAt: Date | null,
  perDay: number,
): Date {
  if (!lastPublishAt) return new Date(now.getTime());

  return new Date(
    Math.max(now.getTime(), lastPublishAt.getTime() + publishGapMs(perDay)),
  );
}

/** 여러 화를 차례로 배정(일괄 승인) */
export function assignPublishTimes(
  now: Date,
  lastPublishAt: Date | null,
  perDay: number,
  count: number,
): Date[] {
  const out: Date[] = [];
  let last = lastPublishAt;

  for (let i = 0; i < count; i++) {
    const t = nextPublishAt(now, last, perDay);

    out.push(t);
    last = t;
  }

  return out;
}

/** 공개 조건(파생값): approved 이고 예약 시각이 지났음 */
export function isPublished(
  ep: { status: string; publishAt: Date | null },
  now: Date,
): boolean {
  return (
    ep.status === "approved" &&
    !!ep.publishAt &&
    ep.publishAt.getTime() <= now.getTime()
  );
}

/** 독자에게 보이는 작품 상태(설정 승인 전·중단은 목록에 없음) */
export const isPublicWork = (status: string) =>
  status === "active" || status === "finished";

// ───────── 알림 ─────────
export type NotifyKind = "pending" | "batch" | "held" | null;

/** 보고 뒤 텔레그램으로 알릴지. 같은 상태 재전송(prev === next)에는 다시 알리지 않는다 */
export function notifyKind(
  mode: string,
  prev: string | null,
  next: string,
  pendingCount: number,
): NotifyKind {
  if (prev === next) return null;
  if (next === "held") return "held";
  if (next !== "pending_approval") return null;
  if (mode === "every") return "pending";
  if (mode === "batch5")
    return pendingCount === BATCH_NOTIFY_AT ? "batch" : null;

  return null; // auto: held 일 때만
}

/** auto 모드에서 서버가 바로 승인할지 */
export const shouldAutoApprove = (
  mode: string,
  status: string,
  check: CheckResult | null | undefined,
) => mode === "auto" && status === "pending_approval" && check?.pass === true;

// ───────── sync ─────────
export interface SyncEpisodeRow {
  number: number;
  status: string;
  revisionNote: string | null;
}

/** 실행기가 행동해야 하는 화만: 최근 승인 1개, 수정 요청(메모 포함), 승인 대기, 보류 */
export function syncEpisodes(
  rows: SyncEpisodeRow[],
): { number: number; status: string; revisionNote?: string }[] {
  const sorted = [...rows].sort((a, b) => a.number - b.number);
  const approved = sorted.filter((r) => r.status === "approved");
  const latest = approved[approved.length - 1];
  const out: { number: number; status: string; revisionNote?: string }[] = [];

  for (const r of sorted) {
    if (r === latest) out.push({ number: r.number, status: r.status });
    else if (r.status === "revising")
      out.push({
        number: r.number,
        status: r.status,
        ...(r.revisionNote ? { revisionNote: r.revisionNote } : {}),
      });
    else if (r.status === "pending_approval" || r.status === "held")
      out.push({ number: r.number, status: r.status });
  }

  return out;
}

/** sync 에 넣을 작품(중단·완결 제외) */
export const isSyncWork = (status: string) =>
  status !== "dropped" && status !== "finished";

/** 토큰 합계(통제실 화 목록) */
export function tokenTotal(tokens: unknown): number {
  if (!isRecord(tokens)) return 0;
  let sum = 0;

  for (const t of Object.values(tokens)) {
    if (isRecord(t)) sum += (Number(t.in) || 0) + (Number(t.out) || 0);
  }

  return sum;
}

/** 본문을 문단으로(빈 줄 기준). 공개 페이지는 일반 텍스트로만 그린다 */
export function paragraphs(body: string): string[] {
  return cleanText(body)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
