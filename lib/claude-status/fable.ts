// lib/claude-status/fable.ts
// 화면용(서버·클라이언트 공용, DB 없음): Claude 추가 한도 창 중 Fable 을 골라내고, 오늘 모델별 토큰 비율을 만든다.
// Fable 은 oauth/usage 의 limits[] 에 { kind:"weekly_scoped", scope:{ model:{ display_name:"Fable" } } } 로 온다 →
// 수집 스크립트가 "weekly_scoped · Fable" 키로 보낸다. 5시간짜리 Fable 항목은 지금 응답에 없다(생기면 session·five 종류로 받음).
import type {
  ExtraWindowView,
  ModelFamily,
  ModelTokensView,
  UsageLimitsView,
} from "./limits";

export type FableSlot = "week" | "fiveHour";

/** 추가 창 키 → Fable 칸. Fable 이 아니면 null */
export function fableSlot(key: string): FableSlot | null {
  if (!/fable/i.test(key)) return null;

  return /session|five|5h/i.test(key) ? "fiveHour" : "week";
}

export const FABLE_LABELS: Record<FableSlot, string> = {
  week: "Fable 주간 한도",
  fiveHour: "Fable 5시간",
};

/** Claude 한도 → Fable 주간·5시간 창(없으면 null) + 나머지 추가 창 */
export function fableWindows(v: UsageLimitsView | null | undefined) {
  const out: {
    week: ExtraWindowView | null;
    fiveHour: ExtraWindowView | null;
    rest: ExtraWindowView[];
  } = { week: null, fiveHour: null, rest: [] };

  for (const x of v?.extra ?? []) {
    const slot = fableSlot(x.key);

    if (slot && !out[slot]) out[slot] = x;
    else if (!slot) out.rest.push(x);
  }

  return out;
}

export const MODEL_LABELS: Record<ModelFamily, string> = {
  fable: "Fable",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  other: "기타",
};

const ORDER: ModelFamily[] = ["fable", "opus", "sonnet", "haiku", "other"];

export const kstToday = (now: number) =>
  new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** 오늘 모델별 토큰 비율. state: none(받은 적 없음)·old(오늘 값 아님)·empty(오늘 0)·ok */
export function modelShares(
  mt: ModelTokensView | null | undefined,
  today: string,
) {
  const rows = ORDER.map((family) => {
    const tokens = mt && mt.date === today ? (mt.models[family] ?? 0) : 0;

    return { family, label: MODEL_LABELS[family], tokens, pct: 0 };
  });
  const total = rows.reduce((s, r) => s + r.tokens, 0);

  for (const r of rows) r.pct = total > 0 ? (r.tokens / total) * 100 : 0;

  const state: "none" | "old" | "empty" | "ok" = !mt
    ? "none"
    : mt.date !== today
      ? "old"
      : total === 0
        ? "empty"
        : "ok";

  return { state, rows, total, asOf: mt?.asOf ?? null };
}
