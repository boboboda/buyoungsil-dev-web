// lib/claude-status/limits.ts
// AI 구독 한도 사용률(남은 한도 게이지)을 받고, 화면용 값으로 바꾼다.
// - claude: 작업 PC 의 Claude Code 상태줄 스크립트가 rate_limits.five_hour / seven_day 를 보낸다.
//   claude 는 출처가 셋: statusline(상태줄, 화면으로 쓸 때) · auto(작업 PC 가 5분마다·일감이 끝날 때 oauth/usage 를 읽음) ·
//   stream(일감 출력의 rate_limit_event, 자동 수집이 안 될 때 보조).
// - codex: 작업 PC 수집 스크립트가 비공식 사용량 주소에서 읽어 보낸다(auto). 실패하면 status "failed" + 짧은 사유만 보낸다.
// 출처가 여럿이라 measuredAt(읽은 시각)이 저장된 값보다 오래됐으면 버린다 → 더 최근에 읽은 값이 남는다.
// 사용률(%)과 초기화 시각만 받는다. 토큰·계정 정보는 받지 않는다.
import prisma from "@/lib/prisma";

export const LIMIT_PROVIDERS = ["claude", "codex"] as const;

export type LimitProvider = (typeof LIMIT_PROVIDERS)[number];

export const LIMIT_SOURCES = ["statusline", "auto", "stream"] as const;

export type LimitSource = (typeof LIMIT_SOURCES)[number]; // 화면 이름: 상태줄 · 자동수집 · 일감 출력

// 모델별 주간 한도 등 추가 창(예: seven_day_opus, "weekly_scoped · Fable"). 이름은 응답 키 그대로
export interface ExtraWindowInput {
  key: string;
  usedPct: number;
  resetsAt: Date | null;
}

export interface LimitWindowInput {
  usedPct: number; // 0~100
  resetsAt: Date;
}

// 오늘(KST) 모델별 토큰 수(입력+출력+캐시 생성). 작업 PC 의 Claude Code 대화 기록에서 모델 이름으로 나눠 센다.
export const MODEL_FAMILIES = [
  "fable",
  "opus",
  "sonnet",
  "haiku",
  "other",
] as const;

export type ModelFamily = (typeof MODEL_FAMILIES)[number];

export interface ModelTokensInput {
  date: string; // yyyy-MM-dd (KST)
  models: Record<ModelFamily, number>;
}

export interface ModelTokensView extends ModelTokensInput {
  asOf: number; // 받은 시각(ms)
}

export interface LimitsPayload {
  provider: LimitProvider;
  device: string;
  status: "ok" | "failed";
  source: LimitSource;
  measuredAt: Date | null; // 작업 PC 가 읽은 시각. 없으면 받은 시각
  reason: string | null; // failed 일 때 짧은 사유
  fiveHour: LimitWindowInput | null;
  sevenDay: LimitWindowInput | null;
  extra?: ExtraWindowInput[]; // 보낸 경우에만 덮어씀(상태줄은 안 보냄 → 지난 값 유지)
  modelTokens?: ModelTokensInput; // claude 만, 보낸 경우에만 덮어씀
}

export type LimitsValidateResult =
  | { ok: true; payload: LimitsPayload }
  | { ok: false; reason: string };

// 화면에 보내는 값 (시각은 epoch ms)
export interface LimitWindowView {
  usedPct: number;
  resetsAt: number;
  reset: boolean; // 초기화 시각이 지났음 (새 값이 오기 전까지 사용률은 의미 없음)
}

export interface ExtraWindowView {
  key: string;
  usedPct: number;
  resetsAt: number | null;
  reset: boolean;
}

export interface UsageLimitsView {
  fiveHour: LimitWindowView | null;
  sevenDay: LimitWindowView | null;
  asOf: number | null; // 마지막으로 값을 받은 시각
  stale: boolean; // asOf 가 오래됨
  failedAt: number | null; // 마지막 수집 실패 시각 (그 뒤로 값을 못 받음)
  failReason: string | null; // 그 실패의 짧은 사유
  source: LimitSource | null; // 지금 보이는 값의 출처
  extra: ExtraWindowView[]; // 모델별 주간 한도 등(없으면 빈 배열)
  extraAsOf: number | null;
  modelTokens: ModelTokensView | null; // 모델별 토큰 수(받은 적 없으면 null). 날짜가 오늘이 아니면 화면이 숨긴다
  device: string;
}

export interface UsageLimitRow {
  device: string;
  fiveHourPct: number | null;
  fiveHourResetsAt: Date | null;
  sevenDayPct: number | null;
  sevenDayResetsAt: Date | null;
  asOf: Date | null;
  failedAt: Date | null;
  source?: string | null;
  failReason?: string | null;
  extraWindows?: unknown; // { asOf: ms, windows: [{ key, usedPct, resetsAt(ms)|null }] }
  modelTokens?: unknown; // { date, asOf: ms, models: { fable, opus, sonnet, haiku, other } }
}

export const LIMIT_STALE_MS = 30 * 60 * 1000;
const MAX_RESET_PAST_MS = 24 * 60 * 60 * 1000;
const MAX_RESET_FUTURE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_MEASURED_PAST_MS = 6 * 60 * 60 * 1000;
const MAX_EXTRA = 8;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;

  const t = v
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);

  return t.length > 0 ? t : null;
}

// 창 하나. 없으면 null, 형식이 틀리면 "invalid". resetsAt 은 유닉스 초.
function parseWindow(
  v: unknown,
  now: number,
): LimitWindowInput | null | "invalid" {
  if (v === undefined || v === null) return null;
  if (!isRecord(v)) return "invalid";

  const pct = v.usedPct;
  const sec = v.resetsAt;

  if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 1000)
    return "invalid";
  if (typeof sec !== "number" || !Number.isFinite(sec)) return "invalid";

  const ms = Math.round(sec * 1000);

  if (ms < now - MAX_RESET_PAST_MS || ms > now + MAX_RESET_FUTURE_MS)
    return "invalid";

  return {
    usedPct: Math.round(Math.min(100, pct) * 10) / 10,
    resetsAt: new Date(ms),
  };
}

// 추가 창 목록. 없으면 undefined(지난 값 유지), 배열이 아니면 "invalid". 이상한 항목 하나는 건너뛴다.
function parseExtra(
  v: unknown,
  now: number,
): ExtraWindowInput[] | undefined | "invalid" {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) return "invalid";

  const out: ExtraWindowInput[] = [];

  for (const item of v.slice(0, MAX_EXTRA)) {
    if (!isRecord(item)) continue;

    const key = cleanText(item.key, 40);
    const pct = item.usedPct;

    if (!key || typeof pct !== "number" || !Number.isFinite(pct) || pct < 0)
      continue;

    const sec = item.resetsAt;
    const ms =
      typeof sec === "number" && Number.isFinite(sec)
        ? Math.round(sec * 1000)
        : null;

    out.push({
      key,
      usedPct: Math.round(Math.min(100, pct) * 10) / 10,
      resetsAt:
        ms !== null &&
        ms >= now - MAX_RESET_PAST_MS &&
        ms <= now + MAX_RESET_FUTURE_MS
          ? new Date(ms)
          : null,
    });
  }

  return out;
}

const MAX_MODEL_TOKENS = 1_000_000_000_000;

// 모델별 토큰 수. 없으면 undefined(지난 값 유지), 형식이 틀리면 "invalid". 빠진 모델은 0.
export function parseModelTokens(
  v: unknown,
): ModelTokensInput | undefined | "invalid" {
  if (v === undefined || v === null) return undefined;
  if (!isRecord(v) || !isRecord(v.models)) return "invalid";
  if (typeof v.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.date))
    return "invalid";

  const src = v.models;
  const models = {} as Record<ModelFamily, number>;

  for (const f of MODEL_FAMILIES) {
    const n = src[f] ?? 0;

    if (
      typeof n !== "number" ||
      !Number.isFinite(n) ||
      n < 0 ||
      n > MAX_MODEL_TOKENS
    )
      return "invalid";
    models[f] = Math.floor(n);
  }

  return { date: v.date, models };
}

// 읽은 시각(유닉스 초). 없으면 null(받은 시각을 씀), 미래면 지금으로, 6시간 넘게 지난 값은 "invalid".
function parseMeasuredAt(v: unknown, now: number): Date | null | "invalid" {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) return "invalid";

  const ms = Math.round(v * 1000);

  if (ms < now - MAX_MEASURED_PAST_MS) return "invalid";

  return new Date(Math.min(ms, now));
}

export function validateLimitsPayload(
  body: unknown,
  now = Date.now(),
): LimitsValidateResult {
  if (!isRecord(body))
    return { ok: false, reason: "요청 형식이 올바르지 않습니다." };

  const provider = body.provider;

  if (
    typeof provider !== "string" ||
    !(LIMIT_PROVIDERS as readonly string[]).includes(provider)
  )
    return { ok: false, reason: "알 수 없는 provider 입니다." };

  const device = cleanText(body.device, 60);

  if (!device) return { ok: false, reason: "device 가 필요합니다." };

  const status = body.status === undefined ? "ok" : body.status;

  if (status !== "ok" && status !== "failed")
    return { ok: false, reason: "status 가 올바르지 않습니다." };

  // 출처가 없으면 예전 스크립트: claude 는 상태줄, codex 는 자동수집
  const source =
    body.source === undefined
      ? provider === "claude"
        ? "statusline"
        : "auto"
      : body.source;

  if (
    typeof source !== "string" ||
    !(LIMIT_SOURCES as readonly string[]).includes(source)
  )
    return { ok: false, reason: "source 가 올바르지 않습니다." };

  // 모델별 토큰 수는 claude 만 받는다(codex 가 보내면 무시). 한도 수집이 실패해도 같이 온다.
  const modelTokens =
    provider === "claude" ? parseModelTokens(body.modelTokens) : undefined;

  if (modelTokens === "invalid")
    return { ok: false, reason: "modelTokens 가 올바르지 않습니다." };

  const tokensPart = modelTokens !== undefined ? { modelTokens } : {};

  if (status === "failed") {
    return {
      ok: true,
      payload: {
        provider: provider as LimitProvider,
        device,
        status,
        source: source as LimitSource,
        measuredAt: null,
        reason: cleanText(body.reason, 80),
        fiveHour: null,
        sevenDay: null,
        ...tokensPart,
      },
    };
  }

  const measuredAt = parseMeasuredAt(body.measuredAt, now);

  if (measuredAt === "invalid")
    return { ok: false, reason: "measuredAt 이 올바르지 않습니다." };

  const extra = parseExtra(body.extra, now);

  if (extra === "invalid")
    return { ok: false, reason: "extra 가 올바르지 않습니다." };

  const fiveHour = parseWindow(body.fiveHour, now);
  const sevenDay = parseWindow(body.sevenDay, now);

  if (fiveHour === "invalid" || sevenDay === "invalid")
    return { ok: false, reason: "한도 값이 올바르지 않습니다." };
  if (!fiveHour && !sevenDay)
    return { ok: false, reason: "한도 값이 없습니다." };

  return {
    ok: true,
    payload: {
      provider: provider as LimitProvider,
      device,
      status,
      source: source as LimitSource,
      measuredAt,
      reason: null,
      fiveHour,
      sevenDay,
      ...(extra !== undefined ? { extra } : {}),
      ...tokensPart,
    },
  };
}

const modelTokensData = (p: LimitsPayload, now: Date) =>
  p.modelTokens !== undefined
    ? { modelTokens: { ...p.modelTokens, asOf: now.getTime() } }
    : {};

// 최신 스냅샷 1행을 덮어쓴다. 실패 보고는 마지막 값을 남기고 실패 시각·사유만 적는다.
// 값은 읽은 시각(measuredAt)이 저장된 값(asOf)보다 최근일 때만 덮어쓴다 → 상태줄·자동수집 중 더 최근 값이 남는다.
// 반환 saved: 값을 저장했는지(더 오래된 값이라 버렸으면 false)
export async function saveLimits(
  p: LimitsPayload,
  now = new Date(),
): Promise<{ saved: boolean }> {
  if (p.status === "failed") {
    const fail = {
      failedAt: now,
      failReason: p.reason,
      ...modelTokensData(p, now),
    };

    await prisma.aiUsageLimit.upsert({
      where: { provider: p.provider },
      create: { provider: p.provider, device: p.device, ...fail },
      update: fail,
    });

    return { saved: true };
  }

  const asOf = p.measuredAt ?? now;
  const prev = await prisma.aiUsageLimit.findUnique({
    where: { provider: p.provider },
    select: { asOf: true },
  });

  if (prev?.asOf && asOf.getTime() <= prev.asOf.getTime()) {
    // 한도 값은 더 오래돼 버려도, 같이 온 모델별 토큰 수는 방금 센 값이라 남긴다
    if (p.modelTokens !== undefined)
      await prisma.aiUsageLimit.update({
        where: { provider: p.provider },
        data: modelTokensData(p, now),
      });

    return { saved: false };
  }

  // 창이 빠져 있으면(이미 초기화돼 Claude Code 가 뺀 경우 등) 지난 값도 지운다.
  // 실패 표시는 자동수집이 성공했을 때만 지운다. 상태줄 값이 와도 남겨 두고, 화면은 실패 뒤에 값이 왔으면 실패를 숨긴다.
  const values = {
    device: p.device,
    fiveHourPct: p.fiveHour?.usedPct ?? null,
    fiveHourResetsAt: p.fiveHour?.resetsAt ?? null,
    sevenDayPct: p.sevenDay?.usedPct ?? null,
    sevenDayResetsAt: p.sevenDay?.resetsAt ?? null,
    asOf,
    source: p.source,
    ...(p.source === "auto" ? { failedAt: null, failReason: null } : {}),
    ...(p.extra !== undefined
      ? {
          extraWindows: {
            asOf: asOf.getTime(),
            windows: p.extra.map((w) => ({
              key: w.key,
              usedPct: w.usedPct,
              resetsAt: w.resetsAt ? w.resetsAt.getTime() : null,
            })),
          },
        }
      : {}),
    ...modelTokensData(p, now),
  };

  await prisma.aiUsageLimit.upsert({
    where: { provider: p.provider },
    create: { provider: p.provider, ...values },
    update: values,
  });

  return { saved: true };
}

function extraView(
  v: unknown,
  now: number,
): { extra: ExtraWindowView[]; extraAsOf: number | null } {
  if (!isRecord(v) || !Array.isArray(v.windows))
    return { extra: [], extraAsOf: null };

  const extra: ExtraWindowView[] = [];

  for (const w of v.windows) {
    if (!isRecord(w) || typeof w.key !== "string") continue;
    if (typeof w.usedPct !== "number" || !Number.isFinite(w.usedPct)) continue;

    const at =
      typeof w.resetsAt === "number" && Number.isFinite(w.resetsAt)
        ? w.resetsAt
        : null;

    extra.push({
      key: w.key,
      usedPct: w.usedPct,
      resetsAt: at,
      reset: at !== null && at <= now,
    });
  }

  return { extra, extraAsOf: typeof v.asOf === "number" ? v.asOf : null };
}

function modelTokensView(v: unknown): ModelTokensView | null {
  if (!isRecord(v) || typeof v.asOf !== "number") return null;

  const parsed = parseModelTokens(v);

  return parsed && parsed !== "invalid" ? { ...parsed, asOf: v.asOf } : null;
}

function windowView(
  pct: number | null,
  resetsAt: Date | null,
  now: number,
): LimitWindowView | null {
  if (pct === null || resetsAt === null) return null;

  const at = resetsAt.getTime();

  return { usedPct: pct, resetsAt: at, reset: at <= now };
}

// DB 1행 → 화면 값. 행이 없으면 null(아직 받은 적 없음).
export function toLimitsView(
  row: UsageLimitRow | null,
  now: number,
): UsageLimitsView | null {
  if (!row) return null;

  const asOf = row.asOf ? row.asOf.getTime() : null;
  const failedAt = row.failedAt ? row.failedAt.getTime() : null;
  // 실패 뒤에 값을 받았으면 실패는 지난 일
  const failing = failedAt !== null && (asOf === null || failedAt > asOf);
  const source = (LIMIT_SOURCES as readonly string[]).includes(
    row.source ?? "",
  )
    ? (row.source as LimitSource)
    : null;

  return {
    fiveHour: windowView(row.fiveHourPct, row.fiveHourResetsAt, now),
    sevenDay: windowView(row.sevenDayPct, row.sevenDayResetsAt, now),
    asOf,
    stale: asOf !== null && now - asOf > LIMIT_STALE_MS,
    failedAt: failing ? failedAt : null,
    failReason: failing ? (row.failReason ?? null) : null,
    source: asOf !== null ? source : null,
    ...extraView(row.extraWindows, now),
    modelTokens: modelTokensView(row.modelTokens),
    device: row.device,
  };
}
