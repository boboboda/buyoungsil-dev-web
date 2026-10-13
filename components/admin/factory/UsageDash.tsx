// components/admin/factory/UsageDash.tsx
// 통제실 오른쪽 'AI 사용량' 요약 계기판: Claude 5시간·7일 한도 게이지, 오늘 사용량(어제 대비), Codex 5시간·주간 게이지.
// 데이터는 [사용량] 탭과 같은 /api/admin/claude-status 를 5초마다 읽는다(화면이 보일 때만).
// 넓은 화면: 오른쪽에 붙어서 따라옴(sticky). 좁은 화면: 작업 영역 위 접이식 카드(한 줄 요약 + 펼치기).
"use client";

import type {
  LimitWindowView,
  UsageLimitsView,
} from "@/lib/claude-status/limits";
import type { ClaudeDailyView, ClaudeStats } from "@/lib/claude-status/stats";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  agoText,
  ArcGauge,
  Digits,
  isStale,
  Led,
  SegmentBar,
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

/** 창 하나의 게이지 값과 아래 한 줄 */
export function windowReading(w: LimitWindowView | null, now: number) {
  if (!w) return { pct: null, status: "값 없음", line: "값 없음" };
  if (w.reset)
    return { pct: null, status: "초기화됨", line: "초기화됨 · 새 값 대기" };

  const pct = Math.round(w.usedPct);

  return {
    pct,
    status: undefined,
    line: `남은 ${Math.max(0, 100 - pct)}% · 초기화까지 ${untilText(w.resetsAt, now)}`,
  };
}

function LimitPair({
  name,
  v,
  now,
  waiting,
  labels,
}: {
  name: string;
  v: UsageLimitsView | null;
  now: number;
  waiting: string;
  labels: [string, string];
}) {
  const stale = isStale(v?.asOf, now);
  const windows: [string, LimitWindowView | null][] = [
    [labels[0], v?.fiveHour ?? null],
    [labels[1], v?.sevenDay ?? null],
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {windows.map(([label, w]) => {
        const r = v
          ? windowReading(w, now)
          : { pct: null, status: "수신 대기", line: "수신 대기" };

        return (
          <div key={label} className="fx-dash-cell">
            <ArcGauge
              label={`${name} ${label}`}
              pct={r.pct}
              status={r.status}
            />
            <p className="fx-dash-line">{r.line}</p>
            <p
              className={`fx-dash-line ${stale ? "fx-warn" : "fx-muted"}`}
              title={v?.device ? `보낸 기기: ${v.device}` : undefined}
            >
              {stale ? "⚠ " : ""}
              {updatedText(v?.asOf, now)}
            </p>
          </div>
        );
      })}
      {!v ? (
        <p className="col-span-2 text-xs fx-muted">수신 대기 — {waiting}</p>
      ) : null}
    </div>
  );
}

function limitLed(v: UsageLimitsView | null, now: number) {
  if (!v) return <Led tone="idle">수신 대기</Led>;
  if (v.failedAt !== null) return <Led tone="warn">수집 실패</Led>;
  if (isStale(v.asOf, now)) return <Led tone="warn">오래된 값</Led>;

  return <Led tone="ok">수신 중</Led>;
}

const summaryPct = (w: LimitWindowView | null | undefined) =>
  w && !w.reset ? `${Math.round(w.usedPct)}%` : "--";

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
  const day = dailyCompare(stats?.daily ?? []);
  const summary = `Claude 5h ${summaryPct(claude?.fiveHour)} · 7d ${summaryPct(claude?.sevenDay)}`;

  return (
    <section aria-labelledby="usage-dash-title" className="fx-dash fx-panel">
      <header className="fx-dash-head">
        <h2 className="fx-dash-title" id="usage-dash-title">
          AI 사용량
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
        <span className="fx-muted">{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>

      <div
        className={`${open ? "flex" : "hidden"} fx-dash-body lg:flex`}
        id="usage-dash-body"
      >
        <div className="fx-dash-block">
          <div className="fx-dash-row">
            <h3 className="fx-dash-sub">Claude 한도</h3>
            {limitLed(claude, now)}
          </div>
          <LimitPair
            labels={["5시간", "7일"]}
            name="Claude"
            now={now}
            v={claude}
            waiting="작업 PC 에서 Claude Code 를 한 번 쓰면 나타나요"
          />
        </div>

        <div className="fx-dash-block">
          <div className="fx-dash-row">
            <h3 className="fx-dash-sub">오늘 사용량</h3>
            <span className="text-xs fx-muted">입력+출력+캐시 생성</span>
          </div>
          <div className="fx-dash-row items-end">
            <Digits size="md" unit="토큰" value={compact(day.today)} />
            <span className="text-xs fx-muted">{day.diff}</span>
          </div>
          <div className="fx-dash-bars">
            <span className="text-xs">오늘</span>
            <SegmentBar
              label="오늘 사용량 (어제와 비교)"
              pct={day.todayPct}
              tone="run"
              valueText={`${compact(day.today)} 토큰`}
            />
            <span className="text-right text-xs font-mono">
              {compact(day.today)}
            </span>
            <span className="text-xs fx-muted">어제</span>
            <SegmentBar
              label="어제 사용량"
              pct={day.yesterdayPct}
              tone="idle"
              valueText={`${compact(day.yesterday)} 토큰`}
            />
            <span className="text-right text-xs font-mono fx-muted">
              {compact(day.yesterday)}
            </span>
          </div>
          <p className="fx-dash-line fx-muted">
            {stats ? updatedText(stats.asOf, now) : "갱신 기록 없음"}
          </p>
        </div>

        <div className="fx-dash-block">
          <div className="fx-dash-row">
            <h3 className="fx-dash-sub">Codex 한도</h3>
            {limitLed(codex, now)}
          </div>
          <LimitPair
            labels={["5시간", "주간"]}
            name="Codex"
            now={now}
            v={codex}
            waiting="작업 PC 에서 Codex 수집 스크립트를 켜면 나타나요"
          />
          {codex?.failedAt ? (
            <p className="fx-dash-line fx-warn">
              ⚠ 마지막 수집 실패 {agoText(codex.failedAt, now)} (지난 값 표시
              중)
            </p>
          ) : null}
          <p className="fx-dash-line fx-muted">
            비공식 수집이라 바뀌면 멈출 수 있어요
          </p>
        </div>

        <footer className="fx-dash-foot">
          {stats
            ? `패널 갱신 ${hhmmss(stats.asOf)} · ${agoText(stats.asOf, now)}`
            : "아직 받은 값이 없어요"}
          {error ? <span className="fx-bad"> · {error}</span> : null}
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
