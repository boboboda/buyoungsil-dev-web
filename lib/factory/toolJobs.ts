// lib/factory/toolJobs.ts
// 도구 일감(kind=tool, 2-3): AI 턴 없이 감독 프로그램이 도구 중계(toolbroker)로 결과물 카드의 도구·방법·옵션을 그대로 실행한다. 순수 함수·상수만 둔다(DB 는 toolJobsDb.ts).
// - 입력: 카드 id(FactoryJob.cardId), 장 수, 대상(1~8개), 추가 지시(선택), 고른 참고 그림(선택, art-picks). 키 값은 어디에도 없다.
// - 앱 슬롯과 따로 센다(설정 concurrency, 기본 2). 같은 카드가 동시에 둘 돌지 않는다. PixelLab 비용 한도(일·월)를 넘으면 needs_confirmation 으로 멈춘다.
import { maskSecrets } from "@/lib/factory/mask";
import type { ToolManifestEntry } from "@/lib/factory/toolManifest";

export const TOOL_KIND = "tool";
export const TOOL_STATUS_CONFIRM = "needs_confirmation";
export const TOOL_SETTINGS_KEY = "toolJobSettings";
export const TOOL_STACK = "tool"; // 일감의 stack 칸(앱 템플릿이 아니라서 고정)
export const MAX_COUNT = 8; // 대상 하나당 장 수
export const MAX_SUBJECTS = 8;
export const MAX_TOTAL_IMAGES = 16; // 한 일감의 전체 장 수(대상 수 × 장 수)
export const MAX_EXTRA = 500;
export const MAX_SUBJECT_LEN = 60;
export const MAX_TOOL_REFS = 4;
export const TOOL_CONCURRENCY = { min: 1, max: 4, default: 2 } as const;
export const DEFAULT_DAILY_LIMIT = 30; // PixelLab 호출 수(하루, 한국 시간). 0 = 제한 없음
export const DEFAULT_MONTHLY_LIMIT = 300;

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
// 카드가 이 안에 들어 있는 도구 방법만 감독이 직접 실행한다. AI 턴이 필요한 방법은 '지원 안 함'(이번 범위 밖). 지금 설명서의 방법(codex·pixellab·claude·manual)은 모두 툴킷이 직접 처리한다
export const AI_TURN_METHODS: ReadonlySet<string> = new Set();

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface ToolSettings {
  autoApprove: boolean; // 비용 한도 안이면 승인 대기 없이 바로 시작(기본 꺼짐)
  autoApproveMaxCost: number; // 자동 승인할 한 일감의 예상 비용(PixelLab 호출 수) 상한. 0 = 비용이 없는 일감만
  concurrency: number; // 도구 일감 동시 실행 수(앱 슬롯과 따로)
  dailyLimit: number; // 하루 PixelLab 호출 수 한도(0 = 제한 없음)
  monthlyLimit: number; // 한 달 한도(0 = 제한 없음)
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = { autoApprove: false, autoApproveMaxCost: 5, concurrency: TOOL_CONCURRENCY.default, dailyLimit: DEFAULT_DAILY_LIMIT, monthlyLimit: DEFAULT_MONTHLY_LIMIT };

const intIn = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "string" && /^\s*\d{1,6}\s*$/.test(v) ? Number(v) : v;

  return typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

/** 저장된 값/입력 → 설정. 모르는 칸·이상한 값은 기본값(또는 이전 값)으로 둔다 */
export function normalizeToolSettings(v: unknown, base: ToolSettings = DEFAULT_TOOL_SETTINGS): ToolSettings {
  const o = isRecord(v) ? v : {};

  return {
    autoApprove: typeof o.autoApprove === "boolean" ? o.autoApprove : base.autoApprove,
    autoApproveMaxCost: intIn(o.autoApproveMaxCost, 0, 10_000) ?? base.autoApproveMaxCost,
    concurrency: intIn(o.concurrency, TOOL_CONCURRENCY.min, TOOL_CONCURRENCY.max) ?? base.concurrency,
    dailyLimit: intIn(o.dailyLimit, 0, 100_000) ?? base.dailyLimit,
    monthlyLimit: intIn(o.monthlyLimit, 0, 1_000_000) ?? base.monthlyLimit,
  };
}

export function readStoredToolSettings(raw: string | null | undefined): ToolSettings {
  if (!raw) return DEFAULT_TOOL_SETTINGS;
  try {
    return normalizeToolSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_TOOL_SETTINGS;
  }
}

// ───────── 입력 ─────────

export interface ToolJobInput {
  count: number;
  subjects: string[];
  extra: string;
  refArtIds: string[];
  estimatedCost: number;
  confirmed?: boolean; // 한도 확인에서 사람이 [그대로 진행]을 누른 일감
}

const oneLine = (v: unknown, max: number) => (typeof v === "string" ? maskSecrets(v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max)) : "");

export type ToolInputCheck = { ok: true; value: Omit<ToolJobInput, "estimatedCost"> } | { ok: false; message: string };

/** 등록 요청 → 입력. count(장 수, 기본 1), subject(문자열) 또는 subjects(배열), extra(추가 지시), refArtIds(고른 참고 그림 id) */
export function parseToolJobInput(raw: Record<string, unknown>): ToolInputCheck {
  const count = raw.count === undefined || raw.count === null || raw.count === "" ? 1 : intIn(raw.count, 1, MAX_COUNT);

  if (count === null) return { ok: false, message: `장 수(count)는 1~${MAX_COUNT} 정수예요.` };
  const given = Array.isArray(raw.subjects) ? raw.subjects : raw.subject !== undefined ? [raw.subject] : [];

  if (given.length > MAX_SUBJECTS) return { ok: false, message: `대상은 한 번에 ${MAX_SUBJECTS}개까지예요.` };
  const subjects = [...new Set(given.map((s) => oneLine(s, MAX_SUBJECT_LEN)).filter(Boolean))];

  if (!subjects.length) return { ok: false, message: "대상(subject)이 필요해요. 예: 싹이" };
  if (count * subjects.length > MAX_TOTAL_IMAGES) return { ok: false, message: `한 일감은 전체 ${MAX_TOTAL_IMAGES}장까지예요(대상 ${subjects.length}개 × ${count}장). 나눠서 보내세요.` };
  if (raw.extra !== undefined && raw.extra !== null && typeof raw.extra !== "string") return { ok: false, message: "추가 지시(extra)는 글이에요." };
  const extra = oneLine(raw.extra, MAX_EXTRA);
  const ids = raw.refArtIds === undefined || raw.refArtIds === null ? [] : raw.refArtIds;

  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string" || !ID_RE.test(x))) return { ok: false, message: "고른 참고 그림(refArtIds)은 그림 id 목록이에요." };
  if (ids.length > MAX_TOOL_REFS) return { ok: false, message: `참고 그림은 ${MAX_TOOL_REFS}장까지예요.` };

  return { ok: true, value: { count, subjects, extra, refArtIds: [...new Set(ids as string[])] } };
}

/** 저장된 toolInput → 모양이 맞는 값(아니면 null) */
export function readToolInput(v: unknown): ToolJobInput | null {
  if (!isRecord(v)) return null;
  const check = parseToolJobInput({ count: v.count, subjects: v.subjects, extra: v.extra, refArtIds: v.refArtIds });

  if (check.ok === false) return null;
  const est = typeof v.estimatedCost === "number" && Number.isFinite(v.estimatedCost) && v.estimatedCost >= 0 ? Math.min(Math.round(v.estimatedCost), 1_000_000) : 0;

  return { ...check.value, estimatedCost: est, ...(v.confirmed === true ? { confirmed: true } : {}) };
}

// ───────── 비용 ─────────

/** 방법 하나를 한 번 부를 때 드는 비용 단위(설명서 cost.perCall). 설명서가 없거나 비용 표기가 없으면 0 */
export function perCallCost(manifest: ToolManifestEntry | null | undefined, methodId: string): number {
  const m = manifest?.methods.find((x) => x.id.toLowerCase() === methodId.toLowerCase());
  const n = m?.cost?.perCall;

  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/** 일감 하나의 예상 비용 = 전체 장 수 × 방법의 호출당 비용(모션처럼 더 드는 경우는 실행 결과의 실제 비용으로 정산) */
export const estimateToolCost = (manifest: ToolManifestEntry | null | undefined, methodId: string, count: number, subjects: number): number => perCallCost(manifest, methodId) * count * subjects;

export interface ToolResult {
  cost: number; // 실제로 쓴 PixelLab 호출 수
  arts: { url: string; subject: string; kind: string }[];
  message: string;
  needsConfirmation?: boolean;
}

/** 감독의 보고 → 저장할 결과(모양·길이 정리, 비밀번호 모양은 가린다). 틀리면 null */
export function cleanToolResult(v: unknown): ToolResult | null {
  if (!isRecord(v)) return null;
  const cost = typeof v.cost === "number" && Number.isFinite(v.cost) && v.cost >= 0 ? Math.min(Math.round(v.cost), 100_000) : 0;
  const arts = (Array.isArray(v.arts) ? v.arts : [])
    .filter((a): a is Record<string, unknown> => isRecord(a) && typeof a.url === "string" && /^https?:\/\/[^\s]{1,480}$/.test(a.url))
    .slice(0, 40)
    .map((a) => ({ url: a.url as string, subject: oneLine(a.subject, MAX_SUBJECT_LEN), kind: oneLine(a.kind, 40) }));

  return { cost, arts, message: oneLine(v.message, 600), ...(v.needsConfirmation === true ? { needsConfirmation: true } : {}) };
}

// ───────── 한도 ─────────

const KST_MS = 9 * 60 * 60 * 1000;

/** 한국 시간 기준 오늘 0시·이번 달 1일 0시(UTC Date) */
export function usageWindows(now = new Date()): { dayStart: Date; monthStart: Date } {
  const k = new Date(now.getTime() + KST_MS);
  const day = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_MS;
  const month = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - KST_MS;

  return { dayStart: new Date(day), monthStart: new Date(month) };
}

export interface CostRow {
  at: Date | null; // 끝난 시각(진행 중이면 시작 시각)
  cost: number;
}

export interface Usage {
  day: number;
  month: number;
}

export function sumUsage(rows: readonly CostRow[], now = new Date()): Usage {
  const { dayStart, monthStart } = usageWindows(now);
  let day = 0;
  let month = 0;

  for (const r of rows) {
    if (!r.at || !(r.cost > 0)) continue;
    if (r.at >= monthStart) month += r.cost;
    if (r.at >= dayStart) day += r.cost;
  }

  return { day, month };
}

export type LimitCheck = { ok: true } | { ok: false; reason: string };

/** 이 일감(예상 비용 est)을 더하면 일·월 한도를 넘는지. est 가 0 이면 항상 통과(비용 없는 방법) */
export function checkCostLimit(usage: Usage, est: number, s: Pick<ToolSettings, "dailyLimit" | "monthlyLimit">): LimitCheck {
  if (!(est > 0)) return { ok: true };
  if (s.dailyLimit > 0 && usage.day + est > s.dailyLimit) return { ok: false, reason: `오늘 PixelLab 호출 한도(${s.dailyLimit}회)를 넘어요: 오늘 ${usage.day}회 + 이 일감 ${est}회` };
  if (s.monthlyLimit > 0 && usage.month + est > s.monthlyLimit) return { ok: false, reason: `이번 달 PixelLab 호출 한도(${s.monthlyLimit}회)를 넘어요: 이번 달 ${usage.month}회 + 이 일감 ${est}회` };

  return { ok: true };
}

/** 등록 때 자동 승인할지: 설정이 켜져 있고, 예상 비용이 자동 승인 상한 안이며, 일·월 한도 안일 때만 */
export function shouldAutoApprove(s: ToolSettings, est: number, usage: Usage): boolean {
  return s.autoApprove && est <= s.autoApproveMaxCost && checkCostLimit(usage, est, s).ok;
}

// ───────── 가져가기 고르기 ─────────

export interface ToolCandidate {
  id: string;
  cardId: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  priority?: number;
}

/**
 * 승인된 도구 일감 중 지금 시작할 것을 고른다: 도구 슬롯(동시 실행 수 − 돌고 있는 수) 안에서, 우선순위 → 승인 순 → 등록 순.
 * 같은 카드가 이미 돌고 있거나 이번에 이미 고른 카드의 일감은 건너뛴다(같은 카드는 동시에 하나)
 */
export function pickToolClaims(args: { approved: readonly ToolCandidate[]; runningCardIds: readonly (string | null)[]; concurrency: number; slots: number }): string[] {
  const free = Math.min(args.slots, args.concurrency - args.runningCardIds.length);

  if (free <= 0) return [];
  const busy = new Set(args.runningCardIds.filter((c): c is string => !!c));
  const order = [...args.approved].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.approvedAt?.getTime() ?? a.createdAt.getTime()) - (b.approvedAt?.getTime() ?? b.createdAt.getTime()) || a.createdAt.getTime() - b.createdAt.getTime());
  const out: string[] = [];

  for (const c of order) {
    if (out.length >= free) break;
    if (c.cardId) {
      if (busy.has(c.cardId)) continue;
      busy.add(c.cardId);
    }
    out.push(c.id);
  }

  return out;
}

/** 일감 제목: 대상과 카드 이름 */
export const toolJobTitle = (cardName: string, subjects: readonly string[], count: number): string =>
  `${subjects.slice(0, 3).join("·")}${subjects.length > 3 ? ` 외 ${subjects.length - 3}` : ""} ${count}장 (${cardName})`.slice(0, 80);

/** 승인 화면·로그용 일감 설명(기획서 칸) */
export function toolJobPlan(args: { cardName: string; cardVersion?: number; tool: string; method: string; input: Omit<ToolJobInput, "estimatedCost">; estimatedCost: number }): string {
  const i = args.input;

  return [
    `도구 일감: AI 턴 없이 카드로 바로 생성`,
    `- 카드: ${args.cardName}${args.cardVersion ? ` (판 ${args.cardVersion})` : ""} · ${args.tool}${args.method ? ` · ${args.method}` : ""}`,
    `- 대상: ${i.subjects.join(", ")} · 대상마다 ${i.count}장`,
    ...(i.extra ? [`- 추가 지시: ${i.extra}`] : []),
    ...(i.refArtIds.length ? [`- 고른 참고 그림: ${i.refArtIds.length}장`] : []),
    `- 예상 비용: PixelLab 호출 ${args.estimatedCost}회`,
  ].join("\n");
}

/** get_factory_job 용 도구 일감 결과 보기(상태·입력·비용·만든 그림 주소). 키 값은 없다 */
export function toolResultView(input: unknown, result: unknown, status: string, cardId: string | null) {
  const i = readToolInput(input);
  const r = cleanToolResult(result);

  return {
    상태: status === TOOL_STATUS_CONFIRM ? "확인 대기(비용 한도) — 통제실 할 일에서 [그대로 진행] 또는 [취소]" : status,
    카드: cardId,
    ...(i ? { 대상: i.subjects, 장수: i.count, 추가_지시: i.extra, 예상_비용: i.estimatedCost, 확인됨: i.confirmed === true } : {}),
    ...(r ? { 실제_비용: r.cost, 만든_그림: r.arts, 메시지: r.message } : {}),
  };
}
