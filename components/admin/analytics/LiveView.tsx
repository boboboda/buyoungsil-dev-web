// components/admin/analytics/LiveView.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardBody, CardHeader, Chip, Switch } from "@heroui/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { LiveStats } from "@/lib/analytics/liveStats";

interface Props {
  appId: string;
  excludeDebug: boolean;
  initial: LiveStats | null;
}

const REFRESH_MS = 10_000;

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const hhmmss = (ms: number) =>
  new Date(ms).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

const EVENT_LABEL: Record<string, string> = {
  session_start: "앱 열기",
  screen_view: "화면",
  ad_load: "광고 로드",
  ad_load_failed: "로드 실패",
  ad_impression: "광고 노출",
  ad_click: "광고 클릭",
  ad_paid: "광고 수익",
  ad_reward_earned: "보상 지급",
  feature_use: "기능 사용",
};

const EVENT_COLOR: Record<string, "default" | "primary" | "success" | "warning" | "danger"> = {
  session_start: "primary",
  ad_impression: "success",
  ad_paid: "success",
  ad_click: "warning",
  ad_load_failed: "danger",
};

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
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

export default function LiveView({ appId, excludeDebug, initial }: Props) {
  const [stats, setStats] = useState<LiveStats | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [now, setNow] = useState(Date.now());
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;

    try {
      const q = new URLSearchParams({ app: appId });

      if (excludeDebug) q.set("nodebug", "1");

      const res = await fetch(`/api/admin/analytics/live?${q.toString()}`, {
        cache: "no-store",
      });

      if (!res.ok) throw new Error(String(res.status));

      setStats((await res.json()) as LiveStats);
      setError(null);
    } catch {
      setError("갱신에 실패했습니다. 잠시 뒤 다시 시도합니다.");
    } finally {
      busy.current = false;
    }
  }, [appId, excludeDebug]);

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

  if (!stats) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-default-500">
            실시간 데이터를 불러오지 못했습니다. 서버 로그를 확인하세요.
          </p>
        </CardBody>
      </Card>
    );
  }

  const ago = Math.max(0, Math.round((now - stats.asOf) / 1000));
  const chartData = stats.minutes.map((m) => ({ label: hhmm(m.at), 접속: m.installs, 이벤트: m.events }));

  return (
    <div className="viz-root flex flex-col gap-6">
      <style>{`
        .viz-root { --live-bar: #2a78d6; --live-gap: #fbfcfb; --live-grid: #d3dcd6; --live-text: #5d6e64; }
        @media (prefers-color-scheme: dark) { .viz-root { --live-bar: #3987e5; --live-gap: #17211c; --live-grid: #2a3a32; --live-text: #8fa396; } }
        .dark .viz-root { --live-bar: #3987e5; --live-gap: #17211c; --live-grid: #2a3a32; --live-text: #8fa396; }
      `}</style>

      <div className="flex flex-wrap items-center gap-4 text-xs text-default-500">
        <span>{ago}초 전 갱신</span>
        <Switch isSelected={auto} size="sm" onValueChange={setAuto}>
          10초마다 자동 갱신
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile hint="최근 5분 안에 이벤트를 보낸 설치" label="지금 접속" value={String(stats.active5)} />
        <Tile hint="최근 30분" label="접속(30분)" value={String(stats.active30)} />
        <Tile hint="최근 30분" label="앱 열기" value={String(stats.sessions30)} />
        <Tile hint="최근 30분" label="이벤트" value={String(stats.events30)} />
      </div>

      <Card>
        <CardHeader className="flex-col items-start gap-0.5">
          <h2 className="text-base font-semibold">분당 접속 (최근 30분)</h2>
          <p className="text-xs text-default-500">
            막대 하나는 1분이며, 그 분에 이벤트를 보낸 설치 수입니다.
          </p>
        </CardHeader>
        <CardBody>
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="var(--live-grid)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  interval={4}
                  stroke="var(--live-grid)"
                  tick={{ fill: "var(--live-text)", fontSize: 11 }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  stroke="var(--live-grid)"
                  tick={{ fill: "var(--live-text)", fontSize: 11 }}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--live-gap)",
                    border: "1px solid var(--live-grid)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  cursor={{ fill: "var(--live-grid)", opacity: 0.35 }}
                />
                <Bar
                  dataKey="접속"
                  fill="var(--live-bar)"
                  maxBarSize={16}
                  radius={[4, 4, 0, 0]}
                  stroke="var(--live-gap)"
                  strokeWidth={2}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex-col items-start gap-0.5">
          <h2 className="text-base font-semibold">최근 이벤트 {stats.latest.length}건</h2>
          <p className="text-xs text-default-500">
            설치 ID는 앞 8자리만 보여 줍니다. 시각은 한국시간입니다.
          </p>
        </CardHeader>
        <CardBody className="p-0">
          {stats.latest.length === 0 ? (
            <p className="p-4 text-sm text-default-500">아직 들어온 이벤트가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-default-500">
                  <tr className="border-b border-default-200">
                    <th className="px-4 py-2 text-left font-medium">시각</th>
                    <th className="px-4 py-2 text-left font-medium">이벤트</th>
                    <th className="px-4 py-2 text-left font-medium">내용</th>
                    <th className="px-4 py-2 text-left font-medium">설치</th>
                    <th className="px-4 py-2 text-left font-medium">버전</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.latest.map((e) => (
                    <tr key={e.id} className="border-b border-default-100 last:border-0">
                      <td className="px-4 py-2 tabular-nums whitespace-nowrap">{hhmmss(e.at)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <Chip color={EVENT_COLOR[e.name] ?? "default"} size="sm" variant="flat">
                          {EVENT_LABEL[e.name] ?? e.name}
                        </Chip>
                      </td>
                      <td className="px-4 py-2">{e.detail || "-"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{e.installId.slice(0, 8)}</td>
                      <td className="px-4 py-2 text-xs text-default-500 whitespace-nowrap">
                        {e.appVersion ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}