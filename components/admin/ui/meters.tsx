// components/admin/ui/meters.tsx
// 관리자 HUD 부품(겉모양만, 훅 없음): 상태 LED(기호 ● ▲ ✕ ○ + 글자), 세그먼트 막대, 모노스페이스 숫자, 막대 스파크라인.
// 색은 app/admin/admin-ui.css 의 토큰을 쓴다. 색만으로 상태를 알리지 않도록 늘 기호와 글자(정상·주의·위험 등)를 같이 붙인다.
// 계산(퍼센트→세그먼트·스파크라인 높이, 갱신 시각 문구)은 순수 함수로 따로 내보내 단위 시험한다.

export type MeterTone = "run" | "ok" | "warn" | "bad" | "idle";

export const STALE_MS = 15 * 60 * 1000;

/** 0~100 으로 자르고, 숫자가 아니면 0 */
export const clampPct = (v: number) =>
  Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;

/** 사용률 → 색·글자. 70% 미만 정상, 90% 미만 주의, 그 위는 위험 */
export function meterTone(pct: number): { tone: MeterTone; text: string } {
  const p = clampPct(pct);

  if (p < 70) return { tone: "ok", text: "정상" };
  if (p < 90) return { tone: "warn", text: "주의" };

  return { tone: "bad", text: "위험" };
}

/** 켜질 세그먼트 수. 0 보다 크면 최소 1칸은 켠다(아주 적게 써도 '0' 처럼 보이지 않게) */
export function litSegments(pct: number, total: number) {
  const p = clampPct(pct);

  if (p <= 0 || total <= 0) return 0;

  return Math.min(total, Math.max(1, Math.round((p / 100) * total)));
}

/** 경과 시간: "방금", "45초 전", "3분 전", "2시간 전", "1일 전" */
export function agoText(ms: number, now: number) {
  const s = Math.max(0, Math.floor((now - ms) / 1000));

  if (s < 5) return "방금";
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;

  return `${Math.floor(s / 86400)}일 전`;
}

/** 남은 시간: "12분", "2시간 13분", "3일 4시간" */
export function untilText(ms: number, now: number) {
  const m = Math.max(0, Math.ceil((ms - now) / 60_000));

  if (m < 60) return `${m}분`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 ${m % 60}분`;

  return `${Math.floor(m / 1440)}일 ${Math.floor((m % 1440) / 60)}시간`;
}

/** 한국 시간 HH:MM */
export const hhmmKst = (ms: number) =>
  new Date(ms).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** 마지막 갱신 문구: "12:05 갱신 · 3분 전". 값이 없으면 "갱신 기록 없음" */
export function updatedText(asOf: number | null | undefined, now: number) {
  if (asOf === null || asOf === undefined) return "갱신 기록 없음";

  return `${hhmmKst(asOf)} 갱신 · ${agoText(asOf, now)}`;
}

/** 값이 오래됐는지(기본 15분) */
export const isStale = (
  asOf: number | null | undefined,
  now: number,
  limit = STALE_MS,
) => asOf !== null && asOf !== undefined && now - asOf > limit;

// ── 부품 ──────────────────────────────────────

/** 상태별 기호: 색을 못 봐도 구분되게 (● 정상·진행, ▲ 주의, ✕ 실패, ○ 꺼짐·대기) */
export const TONE_SYMBOL: Record<MeterTone, string> = {
  run: "●",
  ok: "●",
  warn: "▲",
  bad: "✕",
  idle: "○",
};

/** 상태 LED: 기호 + 글자(색만으로 구분하지 않음) */
export function Led({
  tone,
  children,
  blink = false,
}: {
  tone: MeterTone;
  children: React.ReactNode;
  blink?: boolean;
}) {
  return (
    <span className={`fx-led fx-${tone}`}>
      <span aria-hidden className={`fx-led-sym${blink ? " fx-blink" : ""}`}>
        {TONE_SYMBOL[tone]}
      </span>
      <span>{children}</span>
    </span>
  );
}

/** 큰 숫자: monospace·고정폭 숫자 */
export function Digits({
  value,
  unit,
  size = "md",
}: {
  value: string;
  unit?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className={`fx-digits fx-digits-${size}`}>
      <span className="fx-digits-value">{value}</span>
      {unit ? <span className="fx-digits-unit">{unit}</span> : null}
    </span>
  );
}

/** 세그먼트 막대. pct(0~100) 만큼 칸을 켠다(색은 70% 주의·90% 위험) */
export function SegmentBar({
  label,
  pct,
  segments = 24,
  tone,
  valueText,
}: {
  label: string;
  pct: number;
  segments?: number;
  tone?: MeterTone;
  valueText?: string;
}) {
  const lit = litSegments(pct, segments);
  const t = tone ?? meterTone(pct).tone;

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(clampPct(pct))}
      aria-valuetext={valueText}
      className={`fx-seg fx-${t}`}
      role="meter"
    >
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} aria-hidden className={i < lit ? "fx-on" : undefined} />
      ))}
    </div>
  );
}

/** 스파크라인 막대 높이(0~max). 가장 큰 값이 max, 0 보다 크면 최소 1(아주 적게 써도 보이게) */
export function sparkHeights(values: number[], max: number) {
  const top = Math.max(0, ...values.map((v) => (Number.isFinite(v) ? v : 0)));

  return values.map((v) =>
    top > 0 && Number.isFinite(v) && v > 0
      ? Math.max(1, Math.round((v / top) * max))
      : 0,
  );
}

/** 막대 스파크라인(마지막 막대 = 오늘, 강조). 그림은 숨기고 화면 읽기 프로그램에는 label 로 요약 */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const H = 28;
  const W = 6;
  const GAP = 2;
  const heights = sparkHeights(values, H);
  const width = Math.max(1, values.length * (W + GAP) - GAP);

  return (
    <svg
      aria-label={label}
      className="fx-spark"
      height={H}
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${width} ${H}`}
    >
      <line className="fx-spark-base" x1={0} x2={width} y1={H - 0.5} y2={H - 0.5} />
      {heights.map((h, i) => (
        <rect
          key={i}
          className={i === heights.length - 1 ? "fx-spark-now" : "fx-spark-bar"}
          height={h}
          width={W}
          x={i * (W + GAP)}
          y={H - h}
        />
      ))}
    </svg>
  );
}
