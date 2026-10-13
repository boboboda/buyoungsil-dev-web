// components/admin/ui/meters.tsx
// 관리자 계기판 부품(겉모양만, 훅 없음): 반원 게이지(호 채움 + 바늘 + 눈금), LED 세그먼트 막대, 7세그먼트풍 숫자, 상태 LED.
// 색은 app/admin/admin-ui.css 의 토큰을 쓴다. 색만으로 상태를 알리지 않도록 늘 글자(정상·주의·위험 등)를 같이 붙인다.
// 계산(퍼센트→각도·세그먼트, 갱신 시각 문구)은 순수 함수로 따로 내보내 단위 시험한다.

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

/**
 * 퍼센트 → 바늘 각도(도). 0 은 위쪽, 음수는 왼쪽.
 * 기본 반원(sweep 180): 0% = -90°(왼쪽 끝), 50% = 0°(위), 100% = 90°(오른쪽 끝).
 */
export function gaugeAngle(pct: number, sweep = 180) {
  return -sweep / 2 + (clampPct(pct) / 100) * sweep;
}

/** 원 위의 점. 각도 0 = 위쪽, 시계 방향 */
export function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;

  return {
    x: Math.round((cx + r * Math.sin(rad)) * 100) / 100,
    y: Math.round((cy - r * Math.cos(rad)) * 100) / 100,
  };
}

/** from° → to° 호(시계 방향) SVG path */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
) {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;

  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
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

/** 상태 LED: 빛나는 점 + 글자(색만으로 구분하지 않음) */
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
      <span aria-hidden className={`fx-led-dot${blink ? " fx-blink" : ""}`} />
      <span>{children}</span>
    </span>
  );
}

/** 7세그먼트풍 숫자: monospace·고정폭 숫자·은은한 글로우 */
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

const TICKS = Array.from({ length: 11 }, (_, i) => i * 10);

/**
 * 반원 아날로그 게이지. pct 가 null 이면 빈 게이지(바늘 없음, "--").
 * 화면 읽기 프로그램에는 role="meter" 와 label·값을 준다.
 */
export function ArcGauge({
  label,
  pct,
  status,
}: {
  label: string;
  pct: number | null;
  status?: string; // 숫자 대신/옆에 보일 짧은 글자 (예: "수신 대기")
}) {
  const cx = 60;
  const cy = 58;
  const r = 46;
  const has = pct !== null;
  const p = has ? clampPct(pct) : 0;
  const { tone, text } = has
    ? meterTone(p)
    : { tone: "idle" as MeterTone, text: status ?? "값 없음" };
  const angle = gaugeAngle(p);
  // 바늘은 눈금 안쪽에서 호 바깥까지 짧게(가운데 숫자를 가리지 않게)
  const tipIn = polar(cx, cy, r - 15, angle);
  const tipOut = polar(cx, cy, r + 4, angle);

  return (
    <div
      aria-label={`${label} 사용률`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={has ? Math.round(p) : undefined}
      aria-valuetext={
        has ? `${Math.round(p)}% 사용 (${text})` : (status ?? "값 없음")
      }
      className={`fx-gauge fx-${tone}`}
      role="meter"
    >
      <svg aria-hidden className="fx-gauge-svg" viewBox="0 0 120 66">
        <path className="fx-gauge-track" d={arcPath(cx, cy, r, -90, 90)} />
        {/* 경고 구간 표시(70~90 주의, 90~100 위험) — 아주 옅게 */}
        <path
          className="fx-gauge-zone fx-warn"
          d={arcPath(cx, cy, r + 6, gaugeAngle(70), gaugeAngle(90))}
        />
        <path
          className="fx-gauge-zone fx-bad"
          d={arcPath(cx, cy, r + 6, gaugeAngle(90), 90)}
        />
        {TICKS.map((t) => {
          const major = t % 50 === 0;
          const a = polar(cx, cy, r - 6, gaugeAngle(t));
          const b = polar(cx, cy, r - (major ? 12 : 9), gaugeAngle(t));

          return (
            <line
              key={t}
              className={major ? "fx-gauge-tick fx-major" : "fx-gauge-tick"}
              x1={a.x}
              x2={b.x}
              y1={a.y}
              y2={b.y}
            />
          );
        })}
        {has && p > 0 ? (
          <path className="fx-gauge-fill" d={arcPath(cx, cy, r, -90, angle)} />
        ) : null}
        {has ? (
          <line
            className="fx-gauge-needle"
            x1={tipIn.x}
            x2={tipOut.x}
            y1={tipIn.y}
            y2={tipOut.y}
          />
        ) : null}
      </svg>
      <div className="fx-gauge-readout">
        <Digits
          size="lg"
          unit={has ? "%" : undefined}
          value={has ? String(Math.round(p)) : "--"}
        />
      </div>
      <div className="fx-gauge-caption">
        <span className="fx-gauge-label">{label}</span>
        <span className={`fx-${tone} fx-gauge-state`}>{text}</span>
      </div>
    </div>
  );
}

/** LED 세그먼트 막대. pct(0~100) 만큼 칸을 켠다 */
export function SegmentBar({
  label,
  pct,
  segments = 20,
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
