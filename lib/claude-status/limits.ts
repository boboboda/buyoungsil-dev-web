// lib/claude-status/limits.ts
// AI 구독 한도 사용률(남은 한도 게이지)을 받고, 화면용 값으로 바꾼다.
// - claude: 작업 PC 의 Claude Code 상태줄 스크립트가 rate_limits.five_hour / seven_day 를 보낸다.
// - codex: 작업 PC 수집 스크립트가 비공식 사용량 주소에서 읽어 보낸다. 실패하면 status "failed" 만 보낸다.
// 사용률(%)과 초기화 시각만 받는다. 토큰·계정 정보는 받지 않는다.
import prisma from "@/lib/prisma";

export const LIMIT_PROVIDERS = ["claude", "codex"] as const;

export type LimitProvider = (typeof LIMIT_PROVIDERS)[number];

export interface LimitWindowInput {
  usedPct: number; // 0~100
  resetsAt: Date;
}

export interface LimitsPayload {
  provider: LimitProvider;
  device: string;
  status: "ok" | "failed";
  fiveHour: LimitWindowInput | null;
  sevenDay: LimitWindowInput | null;
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

export interface UsageLimitsView {
  fiveHour: LimitWindowView | null;
  sevenDay: LimitWindowView | null;
  asOf: number | null; // 마지막으로 값을 받은 시각
  stale: boolean; // asOf 가 오래됨
  failedAt: number | null; // 마지막 수집 실패 시각 (그 뒤로 값을 못 받음)
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
}

export const LIMIT_STALE_MS = 30 * 60 * 1000;
const MAX_RESET_PAST_MS = 24 * 60 * 60 * 1000;
const MAX_RESET_FUTURE_MS = 31 * 24 * 60 * 60 * 1000;

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

  if (status === "failed") {
    return {
      ok: true,
      payload: {
        provider: provider as LimitProvider,
        device,
        status,
        fiveHour: null,
        sevenDay: null,
      },
    };
  }

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
      fiveHour,
      sevenDay,
    },
  };
}

// 최신 스냅샷 1행을 덮어쓴다. 실패 보고는 마지막 값을 남기고 실패 시각만 적는다.
export async function saveLimits(p: LimitsPayload, now = new Date()) {
  if (p.status === "failed") {
    await prisma.aiUsageLimit.upsert({
      where: { provider: p.provider },
      create: { provider: p.provider, device: p.device, failedAt: now },
      update: { device: p.device, failedAt: now },
    });

    return;
  }

  // 창이 빠져 있으면(이미 초기화돼 Claude Code 가 뺀 경우 등) 지난 값도 지운다.
  const values = {
    device: p.device,
    fiveHourPct: p.fiveHour?.usedPct ?? null,
    fiveHourResetsAt: p.fiveHour?.resetsAt ?? null,
    sevenDayPct: p.sevenDay?.usedPct ?? null,
    sevenDayResetsAt: p.sevenDay?.resetsAt ?? null,
    asOf: now,
    failedAt: null,
  };

  await prisma.aiUsageLimit.upsert({
    where: { provider: p.provider },
    create: { provider: p.provider, ...values },
    update: values,
  });
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

  return {
    fiveHour: windowView(row.fiveHourPct, row.fiveHourResetsAt, now),
    sevenDay: windowView(row.sevenDayPct, row.sevenDayResetsAt, now),
    asOf,
    stale: asOf !== null && now - asOf > LIMIT_STALE_MS,
    // 실패 뒤에 값을 받았으면 실패는 지난 일
    failedAt:
      failedAt !== null && (asOf === null || failedAt > asOf) ? failedAt : null,
    device: row.device,
  };
}
