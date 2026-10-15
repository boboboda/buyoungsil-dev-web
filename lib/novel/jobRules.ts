// lib/novel/jobRules.ts
// 소설 실행 일감(7-1)의 순수 규칙: 모드→cycle.sh 옵션, 비용 한도, 검수 결과 파싱, 줄 번호 본문, 메모 파일 형식. DB 없음.
// 시험: tests/novel-jobs.test.mjs. 감독 프로그램 쪽 같은 규칙: tools/factory-supervisor/novelrun.mjs (모양을 맞춘다)

export const JOB_STATUSES = ["pending_approval", "approved", "running", "done", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending_approval: "승인 대기",
  approved: "승인됨(시작 대기)",
  running: "실행 중",
  done: "완료",
  failed: "실패",
  cancelled: "취소",
};
export const OPEN_JOB_STATUSES: JobStatus[] = ["pending_approval", "approved", "running"];

export const JOB_MODES = ["check", "revise", "fresh"] as const;
export type JobMode = (typeof JOB_MODES)[number];
export const JOB_MODE_LABELS: Record<JobMode, string> = {
  check: "검수만",
  revise: "메모 반영해 수정",
  fresh: "처음부터 새로 쓰기",
};

export interface JobParams {
  fresh: boolean;
  skipWrite: boolean;
  maxRewrites: number;
}

/** 화면 버튼·채팅 도구 모드 → cycle.sh 인자 */
export function paramsForMode(mode: JobMode): JobParams {
  if (mode === "check") return { fresh: false, skipWrite: true, maxRewrites: 0 };
  if (mode === "revise") return { fresh: false, skipWrite: true, maxRewrites: 2 };

  return { fresh: true, skipWrite: false, maxRewrites: 0 };
}

export const isJobMode = (v: unknown): v is JobMode => typeof v === "string" && (JOB_MODES as readonly string[]).includes(v);

export const NOTE_KINDS = ["필수", "권장"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const MAX_NOTE_TEXT = 1000;
export const MAX_OPEN_NOTES = 200;
export const MAX_LINE_NUMBER = 9999;

export const DEFAULT_DAILY_COST_CAP_USD = 8;
export const MAX_DAILY_COST_CAP_USD = 1000;
export const JOB_TIMEOUT_MIN = 40; // 작업 한 번 최대
export const STALE_SILENCE_MIN = 10; // 이 시간 동안 감독 프로그램 소식이 없으면 서버가 실패로 정리
export const LOG_TAIL_LINES = 200;
export const MAX_LOG_TAIL_CHARS = 40_000;
export const MAX_CHAPTER_CHARS = 100_000;
export const MAX_REVIEW_CHARS = 150_000;
export const MAX_SUMMARY_CHARS = 4000;

export function cleanCap(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;

  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > MAX_DAILY_COST_CAP_USD) return null;

  return Math.round(n * 100) / 100;
}

/** 오늘(최근 24시간) 쓴 돈 + 이번 일감 예상 비용이 한도를 넘나. 한도 0 이하면 항상 넘음 */
export function overCap(spentUsd: number, capUsd: number): boolean {
  return spentUsd >= capUsd;
}

/** 일감 상태 전이(사람 조작). 허용 안 되면 이유 */
export function jobAction(status: string, action: "approve" | "cancel"): { ok: true; to: JobStatus } | { ok: false; reason: string } {
  if (action === "approve") {
    return status === "pending_approval" ? { ok: true, to: "approved" } : { ok: false, reason: "승인 대기 상태의 작업만 승인할 수 있어요." };
  }

  return status === "pending_approval" || status === "approved" || status === "running"
    ? { ok: true, to: "cancelled" }
    : { ok: false, reason: "이미 끝난 작업이에요." };
}

export const isOpenJob = (status: string) => (OPEN_JOB_STATUSES as string[]).includes(status);

// ───────── 본문·검수 ─────────

/** 본문을 줄 번호 붙은 목록으로(검수의 L줄번호와 같은 기준: 파일의 줄, 1부터). from/to 는 범위(포함) */
export function numberedLines(body: string, from?: number, to?: number): { line: number; text: string }[] {
  const lines = body.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const a = Math.max(1, Math.floor(from ?? 1));
  const b = Math.min(lines.length, Math.floor(to ?? lines.length));
  const out: { line: number; text: string }[] = [];

  for (let i = a; i <= b; i++) out.push({ line: i, text: lines[i - 1] });

  return out;
}

export const lineCount = (body: string) => body.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").length;

export interface ReviewItem {
  grade: "필수" | "권장";
  type: string;
  where: string; // "L23" · "L5, L7" · "전체"
  lines: number[]; // where 에서 읽은 줄 번호(없으면 [])
  text: string;
  fix: string;
}

const splitRow = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));

/** reviews/NNN.md 의 '지적 목록' 표를 읽는다. 등급이 필수/권장이 아닌 줄(머리·구분선·다른 표)은 건너뛴다. 필수가 위 */
export function parseReviewItems(md: string): ReviewItem[] {
  const out: ReviewItem[] = [];

  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    if (!raw.trim().startsWith("|")) continue;
    const c = splitRow(raw);
    const grade = c[0]?.replace(/[*`\s]/g, "");

    if (grade !== "필수" && grade !== "권장") continue;
    const where = c[2] ?? "";
    const lines = [...where.matchAll(/L(\d{1,4})(?:\s*[~-]\s*L?(\d{1,4}))?/g)].flatMap((m) => {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;

      return b >= a && b - a <= 60 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
    });

    out.push({ grade, type: c[1] ?? "", where, lines: [...new Set(lines)], text: c[3] ?? "", fix: c[4] ?? "" });
  }

  return [...out.filter((i) => i.grade === "필수"), ...out.filter((i) => i.grade === "권장")];
}

/** 검수 파일 맨 끝 'VERDICT: PASS|FAIL|UNKNOWN' */
export function parseVerdict(md: string): "PASS" | "FAIL" | "UNKNOWN" | null {
  const m = [...md.matchAll(/^[`*\s]*VERDICT:\s*(PASS|FAIL|UNKNOWN)[`*\s]*$/gm)].pop();

  return m ? (m[1] as "PASS" | "FAIL" | "UNKNOWN") : null;
}

export const VERDICT_LABELS: Record<string, string> = { PASS: "통과", FAIL: "재집필 필요", UNKNOWN: "판정 불명" };

// ───────── 메모 파일 ─────────

/** reviews/NNN-memo.md 에 이어 붙이는 한 줄: '- (필수|권장) [L줄번호] 내용' (줄이 없으면 [L…] 생략) */
export function memoLine(n: { kind: string; line: number | null; text: string }): string {
  const text = n.text.replace(/\s*\n+\s*/g, " ").trim();

  return `- (${n.kind === "필수" ? "필수" : "권장"})${n.line ? ` [L${n.line}]` : ""} ${text}`;
}

export function parseNoteInput(
  body: unknown,
): { ok: true; value: { line: number | null; kind: NoteKind; text: string } } | { ok: false; reason: string } {
  const r = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const kind = r.kind === undefined ? "권장" : r.kind;

  if (kind !== "필수" && kind !== "권장") return { ok: false, reason: "종류는 필수 또는 권장이어야 해요." };
  if (typeof r.text !== "string" || !r.text.trim()) return { ok: false, reason: "메모 내용이 비었어요." };
  const text = r.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();

  if (text.length > MAX_NOTE_TEXT) return { ok: false, reason: `메모는 ${MAX_NOTE_TEXT}자까지예요.` };
  let line: number | null = null;

  if (r.line !== undefined && r.line !== null && r.line !== "") {
    const n = Number(r.line);

    if (!Number.isInteger(n) || n < 1 || n > MAX_LINE_NUMBER) return { ok: false, reason: "줄 번호가 올바르지 않아요." };
    line = n;
  }

  return { ok: true, value: { line, kind, text } };
}

// ───────── 보고 ─────────

export function tailLines(text: string, max = LOG_TAIL_LINES): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const tail = lines.slice(-max).join("\n");

  return tail.length > MAX_LOG_TAIL_CHARS ? tail.slice(-MAX_LOG_TAIL_CHARS) : tail;
}

const intOrNull = (v: unknown, max = 1_000_000) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);

export interface CompleteReport {
  ok: boolean;
  verdict: string | null;
  mustCount: number | null;
  recCount: number | null;
  charCount: number | null;
  costUsd: number;
  summary: string;
  logTail: string;
  chapter: string | null;
  review: string | null;
  appliedNoteIds: string[];
}

export function parseComplete(body: unknown): { ok: true; value: CompleteReport } | { ok: false; reason: string } {
  const r = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;

  if (!r) return { ok: false, reason: "본문이 올바르지 않아요." };
  if (typeof r.ok !== "boolean") return { ok: false, reason: "ok(성공 여부)가 필요해요." };
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  const cost = typeof r.costUsd === "number" && Number.isFinite(r.costUsd) && r.costUsd >= 0 && r.costUsd < 1000 ? Math.round(r.costUsd * 10000) / 10000 : 0;
  const verdict = typeof r.verdict === "string" && ["PASS", "FAIL", "UNKNOWN"].includes(r.verdict) ? r.verdict : null;
  const ids = Array.isArray(r.appliedNoteIds) ? r.appliedNoteIds.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x)).slice(0, MAX_OPEN_NOTES) : [];

  return {
    ok: true,
    value: {
      ok: r.ok,
      verdict,
      mustCount: intOrNull(r.mustCount, 9999),
      recCount: intOrNull(r.recCount, 9999),
      charCount: intOrNull(r.charCount, 200_000),
      costUsd: cost,
      summary: str(r.summary, MAX_SUMMARY_CHARS) ?? "",
      logTail: tailLines(str(r.logTail, MAX_LOG_TAIL_CHARS * 2) ?? ""),
      chapter: str(r.chapter, MAX_CHAPTER_CHARS),
      review: str(r.review, MAX_REVIEW_CHARS),
      appliedNoteIds: ids,
    },
  };
}

/** 에피소드 번호·작품 이름 형식(감독 프로그램이 폴더 이름으로 쓰므로 엄격하게) */
export const NOVEL_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const validEpisode = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 9999;
