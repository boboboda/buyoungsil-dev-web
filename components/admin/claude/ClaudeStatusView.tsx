// components/admin/claude/ClaudeStatusView.tsx
// Claude Code 작업 현황: 세션별 상태, 최근 5시간 사용량(추정), 14일 토큰 사용량, 최근 이벤트.
"use client";

import type {
  ClaudeDailyView,
  ClaudeSessionView,
  ClaudeStats,
  SessionStatus,
  TokenSum,
} from "@/lib/claude-status/stats";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Progress,
  Switch,
} from "@heroui/react";

interface Props {
  initial: ClaudeStats | null;
}

const REFRESH_MS = 5_000;
const BASELINE_KEY = "claudeStatusWindowBaseline";

const STATUS: Record<
  SessionStatus,
  {
    label: string;
    icon: string;
    color: "primary" | "warning" | "success" | "default";
  }
> = {
  working: { label: "작업 중", icon: "●", color: "primary" },
  waiting: { label: "입력 필요", icon: "▲", color: "warning" },
  idle: { label: "완료·대기", icon: "✓", color: "success" },
  ended: { label: "종료", icon: "–", color: "default" },
};

const EVENT_LABEL: Record<string, string> = {
  SessionStart: "세션 시작",
  UserPromptSubmit: "프롬프트 보냄",
  Notification: "알림 (입력·권한 필요)",
  Stop: "응답 완료",
  SessionEnd: "세션 종료",
};

const hhmmss = (ms: number) =>
  new Date(ms).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

const rel = (ms: number, now: number) => {
  const s = Math.max(0, Math.round((now - ms) / 1000));

  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;

  return `${Math.floor(s / 86400)}일 전`;
};

const compact = (n: number) => {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;

  return String(n);
};

const full = (n: number) => n.toLocaleString("ko-KR");

// 구독 한도에 영향을 주는 쪽만 합친다. (캐시 읽기는 양이 매우 커서 따로 보여준다)
const counted = (t: TokenSum) => t.input + t.output + t.cacheCreate;

const niceMax = (v: number) => {
  if (v <= 0) return 1000;

  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;

  return n * exp;
};

const md = (date: string) =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardBody className="gap-1">
        <span className="text-xs text-default-500">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {hint ? <span className="text-xs text-default-400">{hint}</span> : null}
      </CardBody>
    </Card>
  );
}

function SessionCard({ s, now }: { s: ClaudeSessionView; now: number }) {
  const st = STATUS[s.status];
  const detail =
    s.status === "working" && s.lastTool
      ? `${s.lastTool} 실행`
      : (EVENT_LABEL[s.lastEvent] ?? s.lastEvent);

  return (
    <Card className={s.status === "ended" ? "opacity-60" : undefined}>
      <CardBody className="gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{s.project}</p>
            <p className="truncate text-xs text-default-500">
              {s.device} · {s.id.slice(0, 8)}
            </p>
          </div>
          <Chip color={st.color} size="sm" variant="flat">
            {st.icon} {st.label}
          </Chip>
        </div>

        <p className="text-sm">{detail}</p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-default-500">
          <span>마지막 소식 {rel(s.lastEventAt, now)}</span>
          <span>시작 {rel(s.startedAt, now)}</span>
        </div>

        {s.quiet ? (
          <p className="text-xs text-warning-600">
            10분 넘게 소식이 없어요. 긴 작업이거나 훅이 끊겼을 수 있어요.
          </p>
        ) : null}

        <p className="text-xs text-default-500 tabular-nums">
          이 세션 누적 · 입력 {compact(s.tokens.input)} · 출력{" "}
          {compact(s.tokens.output)} · 캐시생성 {compact(s.tokens.cacheCreate)}
        </p>
      </CardBody>
    </Card>
  );
}

const SERIES = [
  { key: "input", label: "입력", color: "var(--cv-input)" },
  { key: "output", label: "출력", color: "var(--cv-output)" },
  { key: "cacheCreate", label: "캐시 생성", color: "var(--cv-cache)" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

function DailyChart({ daily }: { daily: ClaudeDailyView[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const totals = daily.map((d) => counted(d));
  const max = niceMax(Math.max(0, ...totals));
  const n = daily.length;
  const hasData = totals.some((t) => t > 0);
  const sums: Record<SeriesKey, number> = {
    input: 0,
    output: 0,
    cacheCreate: 0,
  };

  for (const d of daily) {
    sums.input += d.input;
    sums.output += d.output;
    sums.cacheCreate += d.cacheCreate;
  }

  if (!hasData) {
    return (
      <p className="text-sm text-default-500">
        아직 집계된 토큰 사용량이 없어요. 훅이 세션 시작과 응답 완료 때 usage 를
        보내면 여기에 쌓여요.
      </p>
    );
  }

  const hovered = hover !== null ? daily[hover] : null;
  // 툴팁이 화면 밖으로 나가지 않게 양끝에서는 정렬을 바꾼다.
  const tipAlign =
    hover === null
      ? ""
      : hover <= 1
        ? "left-0"
        : hover >= n - 2
          ? "right-0"
          : "-translate-x-1/2";
  const tipLeft =
    hover !== null && hover > 1 && hover < n - 2
      ? `${((hover + 0.5) / n) * 100}%`
      : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-default-600">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              style={{
                background: s.color,
                width: 10,
                height: 10,
                borderRadius: 2,
                display: "inline-block",
              }}
            />
            {s.label}
            <span className="text-default-400 tabular-nums">
              14일 {compact(sums[s.key])}
            </span>
          </span>
        ))}
      </div>

      <div className="flex">
        <div
          className="relative w-11 shrink-0 text-right text-[11px] text-default-400"
          style={{ height: 180 }}
        >
          <span className="absolute right-1 top-0 -translate-y-1/2 tabular-nums">
            {compact(max)}
          </span>
          <span className="absolute right-1 top-1/2 -translate-y-1/2 tabular-nums">
            {compact(max / 2)}
          </span>
          <span className="absolute bottom-0 right-1 translate-y-1/2 tabular-nums">
            0
          </span>
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="relative" style={{ height: 180 }}>
            <div
              className="absolute inset-x-0 top-0 border-t"
              style={{ borderColor: "var(--cv-grid)" }}
            />
            <div
              className="absolute inset-x-0 top-1/2 border-t"
              style={{ borderColor: "var(--cv-grid)" }}
            />
            <div
              className="absolute inset-x-0 bottom-0 border-t"
              style={{ borderColor: "var(--cv-grid)" }}
            />

            <div
              className="absolute inset-0 flex"
              onMouseLeave={() => setHover(null)}
            >
              {daily.map((d, i) => {
                const total = totals[i];
                const parts = SERIES.filter((s) => d[s.key] > 0);
                const topKey =
                  parts.length > 0 ? parts[parts.length - 1].key : null;

                return (
                  <button
                    key={d.date}
                    aria-label={`${md(d.date)} 입력 ${full(d.input)}, 출력 ${full(d.output)}, 캐시 생성 ${full(d.cacheCreate)}`}
                    className="flex h-full flex-1 items-end justify-center outline-none focus-visible:bg-default-100/60"
                    style={{
                      background: hover === i ? "var(--cv-hover)" : undefined,
                    }}
                    type="button"
                    onBlur={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onMouseEnter={() => setHover(i)}
                  >
                    {total > 0 ? (
                      <div
                        className="flex w-full max-w-[24px] flex-col-reverse"
                        style={{ height: `${(total / max) * 100}%`, gap: 2 }}
                      >
                        {parts.map((s) => (
                          <div
                            key={s.key}
                            style={{
                              flex: d[s.key],
                              minHeight: 0,
                              background: s.color,
                              borderTopLeftRadius: s.key === topKey ? 4 : 0,
                              borderTopRightRadius: s.key === topKey ? 4 : 0,
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {hovered ? (
              <div
                className={`pointer-events-none absolute z-10 rounded-md border border-divider bg-content1 px-3 py-2 text-xs shadow-md ${tipAlign}`}
                style={{ bottom: "100%", marginBottom: 6, left: tipLeft }}
              >
                <p className="mb-1 text-default-500">{hovered.date}</p>
                {SERIES.map((s) => (
                  <p
                    key={s.key}
                    className="flex items-center gap-2 tabular-nums"
                  >
                    <span
                      aria-hidden
                      style={{
                        background: s.color,
                        width: 10,
                        height: 2,
                        display: "inline-block",
                      }}
                    />
                    <span className="font-semibold">
                      {full(hovered[s.key])}
                    </span>
                    <span className="text-default-500">{s.label}</span>
                  </p>
                ))}
                <p className="mt-1 text-default-400 tabular-nums">
                  캐시 읽기 {full(hovered.cacheRead)} (합계 제외)
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-1 flex text-[11px] text-default-400">
            {daily.map((d, i) => (
              <span key={d.date} className="flex-1 text-center tabular-nums">
                {(n - 1 - i) % 2 === 0 ? md(d.date) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>

      <details className="text-xs text-default-600">
        <summary className="cursor-pointer select-none">표로 보기</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-right tabular-nums">
            <thead className="text-default-500">
              <tr>
                <th className="py-1 text-left font-medium">날짜</th>
                <th className="py-1 font-medium">입력</th>
                <th className="py-1 font-medium">출력</th>
                <th className="py-1 font-medium">캐시 생성</th>
                <th className="py-1 font-medium">캐시 읽기</th>
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.date} className="border-t border-divider">
                  <td className="py-1 text-left">{d.date}</td>
                  <td className="py-1">{full(d.input)}</td>
                  <td className="py-1">{full(d.output)}</td>
                  <td className="py-1">{full(d.cacheCreate)}</td>
                  <td className="py-1">{full(d.cacheRead)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export default function ClaudeStatusView({ initial }: Props) {
  const [stats, setStats] = useState<ClaudeStats | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [baseline, setBaseline] = useState("");
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
      setError("갱신에 실패했습니다. 잠시 뒤 다시 시도합니다.");
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!auto) return;

    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);

    return () => clearInterval(id);
  }, [auto, load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(id);
  }, []);

  // 기준선은 이 브라우저에만 저장한다. (저장소를 못 쓰는 환경에서도 화면은 그대로 동작)
  useEffect(() => {
    try {
      setBaseline(localStorage.getItem(BASELINE_KEY) ?? "");
    } catch {
      /* 무시 */
    }
  }, []);

  const changeBaseline = (v: string) => {
    const digits = v.replace(/[^0-9]/g, "");

    setBaseline(digits);
    try {
      localStorage.setItem(BASELINE_KEY, digits);
    } catch {
      /* 무시 */
    }
  };

  if (!stats) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-default-500">
            작업 현황을 불러오지 못했습니다. 서버 로그와 DB 마이그레이션을
            확인하세요.
          </p>
        </CardBody>
      </Card>
    );
  }

  const ago = Math.max(0, Math.round((now - stats.asOf) / 1000));
  const count = (s: SessionStatus) =>
    stats.sessions.filter((x) => x.status === s).length;
  const used = counted(stats.windowTokens);
  const base = Number(baseline);
  const pct = base > 0 ? Math.min(100, Math.round((used / base) * 100)) : null;

  return (
    <div className="claude-viz flex flex-col gap-6">
      <style>{`
        .claude-viz { --cv-input: #2a78d6; --cv-output: #eb6834; --cv-cache: #1baf7a; --cv-grid: #e6e5e1; --cv-hover: rgba(0,0,0,0.04); }
        .dark .claude-viz { --cv-input: #3987e5; --cv-output: #d95926; --cv-cache: #199e70; --cv-grid: #2b2b29; --cv-hover: rgba(255,255,255,0.06); }
      `}</style>

      <div className="flex flex-wrap items-center gap-4 text-xs text-default-500">
        <span>{ago}초 전 갱신</span>
        <Switch isSelected={auto} size="sm" onValueChange={setAuto}>
          5초마다 자동 갱신
        </Switch>
        <button
          className="underline underline-offset-2"
          type="button"
          onClick={() => load()}
        >
          지금 갱신
        </button>
        {error ? <span className="text-danger">{error}</span> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          hint="지금 도구를 쓰거나 응답을 만드는 세션"
          label="● 작업 중"
          value={String(count("working"))}
        />
        <Tile
          hint="권한 승인이나 입력을 기다리는 세션"
          label="▲ 입력 필요"
          value={String(count("waiting"))}
        />
        <Tile
          hint="응답을 마치고 대기 중인 세션"
          label="✓ 완료·대기"
          value={String(count("idle"))}
        />
        <Tile
          hint="최근 24시간 안에 소식이 있었던 세션"
          label="전체 세션"
          value={String(stats.sessions.length)}
        />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">세션</h2>
        {stats.sessions.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-default-500">
                최근 24시간 동안 들어온 이벤트가 없어요. 내 PC의 Claude Code 훅
                설정을 확인해 보세요.
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {stats.sessions.map((s) => (
              <SessionCard key={s.id} now={now} s={s} />
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader className="flex-col items-start gap-0.5">
          <h2 className="text-base font-semibold">
            최근 {stats.windowHours}시간 사용량 (추정)
          </h2>
          <p className="text-xs text-default-500">
            구독 한도의 남은 양이 아니라, 훅이 보낸 내가 쓴 양(입력 + 출력 +
            캐시 생성)이에요. 아래 기준선과 비교해서 대략의 감을 잡는 용도예요.
          </p>
        </CardHeader>
        <CardBody className="gap-4">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
            <div>
              <span className="text-3xl font-semibold tabular-nums">
                {compact(used)}
              </span>
              <span className="ml-2 text-sm text-default-500 tabular-nums">
                토큰 ({full(used)})
              </span>
            </div>
            <p className="text-xs text-default-400 tabular-nums">
              입력 {compact(stats.windowTokens.input)} · 출력{" "}
              {compact(stats.windowTokens.output)} · 캐시 생성{" "}
              {compact(stats.windowTokens.cacheCreate)} · 캐시 읽기{" "}
              {compact(stats.windowTokens.cacheRead)} (합계 제외)
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <Input
              className="max-w-xs"
              description="내가 보통 한도에 닿는 5시간 사용량(토큰). 이 브라우저에만 저장돼요."
              inputMode="numeric"
              label="내 기준선"
              placeholder="예: 5000000"
              size="sm"
              value={baseline}
              onValueChange={changeBaseline}
            />
            {pct !== null ? (
              <div className="min-w-[200px] flex-1">
                <Progress
                  aria-label="최근 5시간 사용량 추정"
                  color={pct < 70 ? "success" : pct < 90 ? "warning" : "danger"}
                  label={`기준선 대비 ${pct}%`}
                  showValueLabel={false}
                  size="md"
                  value={pct}
                />
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex-col items-start gap-0.5">
          <h2 className="text-base font-semibold">
            일별 토큰 사용량 (최근 14일)
          </h2>
          <p className="text-xs text-default-500">
            한국 시간 기준이에요. 막대에 마우스를 올리면 그날의 값이 보여요.
          </p>
        </CardHeader>
        <CardBody>
          <DailyChart daily={stats.daily} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex-col items-start gap-0.5">
          <h2 className="text-base font-semibold">최근 이벤트</h2>
        </CardHeader>
        <CardBody>
          {stats.recent.length === 0 ? (
            <p className="text-sm text-default-500">아직 이벤트가 없어요.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-divider text-sm">
              {stats.recent.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5"
                >
                  <span className="tabular-nums text-default-500">
                    {hhmmss(e.at)}
                  </span>
                  <span>{EVENT_LABEL[e.event] ?? e.event}</span>
                  <span className="text-default-500">
                    {e.project} · {e.device}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
