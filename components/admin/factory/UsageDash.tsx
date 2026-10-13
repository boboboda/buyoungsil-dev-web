// components/admin/factory/UsageDash.tsx
// 통제실 오른쪽 'AI USAGE' 패널: 한도마다 한 행(사용 %·세그먼트 막대·남은 %·초기화까지·갱신 시각) — Claude 5시간·7일, Codex 5시간·주간,
// 오늘 사용량(어제 대비 막대 + 14일 스파크라인). 반원 게이지는 좁은 패널에서 읽기 어려워 행 형태로 바꿨다.
// 데이터는 [사용량] 탭과 같은 /api/admin/claude-status 를 5초마다 읽는다(화면이 보일 때만).
// 넓은 화면: 오른쪽에 붙어서 따라옴(sticky). 좁은 화면: 작업 영역 위 접이식 카드(한 줄 요약 + 펼치기).
"use client";

import type {
  LimitSource,
  LimitWindowView,
  UsageLimitsView,
} from "@/lib/claude-status/limits";
import type { ClaudeDailyView, ClaudeStats } from "@/lib/claude-status/stats";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  agoText,
  Digits,
  isStale,
  Led,
  type MeterTone,
  meterTone,
  SegmentBar,
  Sparkline,
  untilText,
  updatedText,
} from "@/components/admin/ui/meters";

const REFRESH_MS = 5_000;

const compact = (n: number) => {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;

  return String(n);
};

const hhmmss = (ms: number) =>
  new Date(ms).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

/** 오늘(마지막 날)과 어제 사용량(입력+출력+캐시 생성) 비교. 막대는 둘 중 큰 값을 100% 로 */
export function dailyCompare(daily: ClaudeDailyView[]) {
  const sum = (d?: ClaudeDailyView) =>
    d ? d.input + d.output + d.cacheCreate : 0;
  const today = sum(daily[daily.length - 1]);
  const yesterday = sum(daily[daily.length - 2]);
  const max = Math.max(today, yesterday);
  const pct = (v: number) => (max > 0 ? (v / max) * 100 : 0);
  const diff =
    yesterday > 0
      ? `어제보다 ${today >= yesterday ? "+" : "−"}${Math.abs(Math.round(((today - yesterday) / yesterday) * 100))}%`
      : today > 0
        ? "어제 기록 없음"
        : "오늘·어제 기록 없음";

  return {
    today,
    yesterday,
    todayPct: pct(today),
    yesterdayPct: pct(yesterday),
    diff,
  };
}

type WindowLike = Omit<LimitWindowView, "resetsAt"> & {
  resetsAt: number | null;
};

/** 한도 창 하나의 표시 값: 사용 %(없으면 null)·상태 글자·아래 한 줄 */
export function windowReading(w: WindowLike | null, now: number) {
  if (!w)
    return {
      pct: null,
      tone: "idle" as MeterTone,
      state: "값 없음",
      line: "값 없음",
    };
  if (w.reset)
    return {
      pct: null,
      tone: "idle" as MeterTone,
      state: "초기화됨",
      line: "초기화됨 · 새 값 대기",
    };

  const pct = Math.round(w.usedPct);
  const { tone, text } = meterTone(pct);

  return {
    pct,
    tone,
    state: text,
    line:
      w.resetsAt === null
        ? `남은 ${Math.max(0, 100 - pct)}%`
        : `남은 ${Math.max(0, 100 - pct)}% · 초기화까지 ${untilText(w.resetsAt, now)}`,
  };
}

const SOURCE_LABELS: Record<LimitSource, string> = {
  statusline: "상태줄",
  auto: "자동수집",
  stream: "일감 출력",
};

/** "12:45 갱신 · 방금 · 자동수집" (출처를 모르면 시각만) */
export function updatedWithSource(
  asOf: number | null,
  source: LimitSource | null,
  now: number,
) {
  const at = updatedText(asOf, now);

  return asOf !== null && source ? `${at} · ${SOURCE_LABELS[source]}` : at;
}

/** 한도 한 행: [라벨 · 상태] [큰 사용 %] / [세그먼트 막대] / [남은 % · 초기화까지] [갱신 시각 · 출처] */
function LimitRow({
  name,
  label,
  w,
  v,
  now,
  asOf = v.asOf,
  source = v.source,
}: {
  name: string;
  label: string;
  w: WindowLike | null;
  v: UsageLimitsView;
  now: number;
  asOf?: number | null;
  source?: LimitSource | null;
}) {
  const r = windowReading(w, now);
  const stale = isStale(asOf, now);

  return (
    <div className="fx-limit">
      <div className="fx-limit-top">
        <span className="fx-limit-label">{label}</span>
        <Led tone={r.tone}>{r.state}</Led>
        <span className={`fx-limit-pct fx-${r.tone}`}>
          {r.pct === null ? "--" : r.pct}
          <span className="fx-limit-unit">%</span>
        </span>
      </div>
      <SegmentBar
        label={`${name} ${label} 사용률`}
        pct={r.pct ?? 0}
        tone={r.pct === null ? "idle" : undefined}
        valueText={r.pct === null ? r.state : `${r.pct}% 사용 (${r.state})`}
      />
      <div className="fx-limit-sub">
        <span>{r.line}</span>
        <span
          className={stale ? "fx-warn" : "fx-muted"}
          title={v.device ? `보낸 기기: ${v.device}` : undefined}
        >
          {stale ? "▲ " : ""}
          {updatedWithSource(asOf, source, now)}
        </span>
      </div>
    </div>
  );
}

function limitLed(v: UsageLimitsView | null, now: number, empty: string) {
  if (!v) return <Led tone="idle">{empty}</Led>;
  if (v.failedAt !== null) return <Led tone="warn">수집 실패</Led>;
  if (isStale(v.asOf, now)) return <Led tone="warn">오래된 값</Led>;

  return <Led tone="ok">수신 중</Led>;
}

/** Claude·Codex 한도 묶음. 값이 없으면 행 대신 안내 한 줄('수신 대기'는 오른쪽 LED 에만).
 *  모델별 주간 한도(extra)는 응답 키 이름 그대로 행을 더 붙이고, 자동수집 실패는 사유와 함께 한 줄로 */
function LimitSection({
  name,
  labels,
  v,
  now,
  empty,
  waiting,
  children,
}: {
  name: string;
  labels: [string, string];
  v: UsageLimitsView | null;
  now: number;
  empty: string;
  waiting: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="fx-dash-sec">
      <div className="fx-dash-sec-head">
        <h3 className="fx-dash-sub">{name}</h3>
        {limitLed(v, now, empty)}
      </div>
      {v ? (
        <>
          <LimitRow
            label={labels[0]}
            name={name}
            now={now}
            v={v}
            w={v.fiveHour}
          />
          <LimitRow
            label={labels[1]}
            name={name}
            now={now}
            v={v}
            w={v.sevenDay}
          />
          {(v.extra ?? []).map((x) => (
            <LimitRow
              key={x.key}
              asOf={v.extraAsOf}
              label={x.key}
              name={name}
              now={now}
              source="auto"
              v={v}
              w={x}
            />
          ))}
        </>
      ) : (
        <p className="fx-dash-wait">— {waiting}</p>
      )}
      {v?.failedAt ? (
        <p className="fx-dash-note fx-warn">
          ▲ 수집 실패{v.failReason ? `(${v.failReason})` : ""}{" "}
          {agoText(v.failedAt, now)}
          {v.asOf !== null ? " · 지난 값 표시 중" : ""}
        </p>
      ) : null}
      {children}
    </div>
  );
}

const summaryPct = (w: LimitWindowView | null | undefined) =>
  w && !w.reset ? `${Math.round(w.usedPct)}%` : "--";

const dayTotal = (d: ClaudeDailyView) => d.input + d.output + d.cacheCreate;

export function UsageDashView({
  stats,
  now,
  error = null,
  open = false,
  onToggle,
}: {
  stats: ClaudeStats | null;
  now: number;
  error?: string | null;
  open?: boolean;
  onToggle?: () => void;
}) {
  const claude = stats?.limits ?? null;
  const codex = stats?.codexLimits ?? null;
  const daily = stats?.daily ?? [];
  const day = dailyCompare(daily);
  const totals = daily.map(dayTotal);
  const summary = `Claude 5h ${summaryPct(claude?.fiveHour)} · 7d ${summaryPct(claude?.sevenDay)}`;

  return (
    <section aria-labelledby="usage-dash-title" className="fx-hud fx-dash">
      <header className="fx-hud-head">
        <h2 className="fx-hud-title" id="usage-dash-title">
          AI USAGE<span className="sr-only"> (AI 사용량)</span>
        </h2>
        {error ? (
          <Led tone="bad">갱신 실패</Led>
        ) : (
          <Led blink tone="run">
            5초 갱신
          </Led>
        )}
      </header>

      {/* 좁은 화면 전용: 한 줄 요약 + 펼치기 */}
      <button
        aria-controls="usage-dash-body"
        aria-expanded={open}
        className="fx-dash-toggle lg:hidden"
        type="button"
        onClick={onToggle}
      >
        <span className="font-mono">{summary}</span>
        <span>{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>

      <div
        className={`${open ? "flex" : "hidden"} fx-dash-body lg:flex`}
        id="usage-dash-body"
      >
        <LimitSection
          empty="수신 대기"
          labels={["5시간", "7일"]}
          name="Claude"
          now={now}
          v={claude}
          waiting="작업 PC 에서 Claude Code 를 한 번 쓰면 나타나요"
        />

        <div className="fx-dash-sec">
          <div className="fx-dash-sec-head">
            <h3 className="fx-dash-sub">오늘 사용량</h3>
            <span className="fx-dash-note">입력+출력+캐시 생성</span>
          </div>
          <div className="fx-dash-today">
            <Digits size="lg" unit="토큰" value={compact(day.today)} />
            <span className="fx-dash-note">{day.diff}</span>
          </div>
          <div className="fx-dash-bars">
            <span>오늘</span>
            <SegmentBar
              label="오늘 사용량 (어제와 비교)"
              pct={day.todayPct}
              tone="run"
              valueText={`${compact(day.today)} 토큰`}
            />
            <span className="font-mono text-right">{compact(day.today)}</span>
            <span className="fx-muted">어제</span>
            <SegmentBar
              label="어제 사용량"
              pct={day.yesterdayPct}
              tone="idle"
              valueText={`${compact(day.yesterday)} 토큰`}
            />
            <span className="font-mono text-right fx-muted">
              {compact(day.yesterday)}
            </span>
          </div>
          {totals.length > 1 ? (
            <div className="fx-dash-spark">
              <Sparkline
                label={`최근 ${totals.length}일 사용량: 가장 많은 날 ${compact(Math.max(...totals))}, 오늘 ${compact(day.today)}`}
                values={totals}
              />
              <div aria-hidden className="fx-dash-spark-axis">
                <span>{totals.length - 1}일 전</span>
                <span>오늘</span>
              </div>
            </div>
          ) : null}
        </div>

        <LimitSection
          empty="값 없음"
          labels={["5시간", "주간"]}
          name="Codex"
          now={now}
          v={codex}
          waiting="작업 PC 에서 Codex 수집 스크립트를 켜면 나타나요"
        >
          <p className="fx-dash-note">비공식 수집이라 바뀌면 멈출 수 있어요</p>
        </LimitSection>

        <footer className="fx-dash-foot">
          {stats
            ? `패널 갱신 ${hhmmss(stats.asOf)} · ${agoText(stats.asOf, now)}`
            : "아직 받은 값이 없어요"}
          {error ? <span className="fx-bad"> · ✕ {error}</span> : null}
        </footer>
      </div>
    </section>
  );
}

export default function UsageDash({
  initial,
}: {
  initial: ClaudeStats | null;
}) {
  const [stats, setStats] = useState<ClaudeStats | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;

    try {
      const res = await fetch("/api/admin/claude-status", {
        cache: "no-store",
      });

      if (!res.ok) throw new Error(String(res.status));
      setStats((await res.json()) as ClaudeStats);
      setError(null);
    } catch {
      setError("갱신 실패, 다시 시도 중");
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);

    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(id);
  }, []);

  return (
    <UsageDashView
      error={error}
      now={now}
      open={open}
      stats={stats}
      onToggle={() => setOpen((o) => !o)}
    />
  );
}
