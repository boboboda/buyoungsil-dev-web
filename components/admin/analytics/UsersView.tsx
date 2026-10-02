// components/admin/analytics/UsersView.tsx
"use client";

import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { RetentionPoint, UserStats } from "@/lib/analytics/stats";

const numberFormat = new Intl.NumberFormat("ko-KR");
const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : numberFormat.format(n);
const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);

const AXIS_TEXT = "hsl(var(--heroui-default-500))";
const GRID = "hsl(var(--heroui-default-200))";
const SURFACE = "hsl(var(--heroui-content1))";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card shadow="sm">
      <CardBody className="gap-1">
        <span className="text-xs text-default-500">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {sub ? <span className="text-xs text-default-400">{sub}</span> : null}
      </CardBody>
    </Card>
  );
}

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;

  const p = payload[0].payload;

  return (
    <div className="rounded-md border border-default-200 bg-content1 px-3 py-2 text-sm shadow-md">
      <div className="text-xs text-default-500">{p.date}</div>
      <div className="mt-1 text-base font-semibold tabular-nums">
        {fmt(p.active)}명 활성
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-default-600">
        <span className="inline-block h-0.5 w-3" style={{ background: "var(--series-1)" }} />
        신규 <span className="font-semibold tabular-nums">{fmt(p.newUsers)}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-default-600">
        <span className="inline-block h-0.5 w-3" style={{ background: "var(--series-2)" }} />
        재방문 <span className="font-semibold tabular-nums">{fmt(p.returning)}</span>
      </div>
    </div>
  );
}

function RetentionCell({ label, point }: { label: string; point: RetentionPoint }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-default-500">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{pct(point.rate)}</span>
      <span className="text-xs text-default-400">
        {point.cohort > 0
          ? `${fmt(point.retained)} / ${fmt(point.cohort)}명`
          : "아직 데이터 없음"}
      </span>
    </div>
  );
}

export default function UsersView({ stats }: { stats: UserStats }) {
  const router = useRouter();

  const chartData = stats.dailySeries.map((d) => ({ ...d, label: d.date.slice(5) }));
  const maxVersion = Math.max(1, ...stats.versions.map((v) => v.installs));

  return (
    <div className="viz-root flex flex-col gap-6">
      <style>{`
        .viz-root { --series-1: #2a78d6; --series-2: #eb6834; }
        .dark .viz-root { --series-1: #3987e5; --series-2: #d95926; }
      `}</style>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-default-500">
          기준: {stats.today} (한국시간) ·{" "}
          {new Date(stats.asOf).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })} 집계
        </p>
        <Button size="sm" variant="flat" onPress={() => router.refresh()}>
          새로고침
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="col-span-2 md:row-span-2" shadow="sm">
          <CardBody className="justify-center gap-1">
            <span className="text-xs text-default-500">오늘 활성 사용자 (DAU)</span>
            <span className="text-6xl font-semibold">{fmt(stats.dau)}</span>
            <span className="text-xs text-default-400">어제 {fmt(stats.dauYesterday)}명</span>
          </CardBody>
        </Card>
        <Stat label="주간 활성 (WAU)" sub="최근 7일" value={fmt(stats.wau)} />
        <Stat label="월간 활성 (MAU)" sub="최근 30일" value={fmt(stats.mau)} />
        <Stat
          label="DAU / MAU"
          sub="높을수록 자주 다시 쓰는 앱"
          value={pct(stats.stickiness)}
        />
        <Stat
          label="신규 설치"
          sub={`7일 ${fmt(stats.new7d)} · 30일 ${fmt(stats.new30d)}`}
          value={`오늘 ${fmt(stats.newToday)}`}
        />
      </div>

      <Card shadow="sm">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">일별 활성 사용자 (최근 30일)</h2>
          <div className="flex items-center gap-4 text-xs text-default-600">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--series-1)" }} />
              신규
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--series-2)" }} />
              재방문
            </span>
          </div>
        </CardHeader>
        <CardBody>
          <div className="h-64 w-full">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart
                barCategoryGap="20%"
                data={chartData}
                margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
              >
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="label"
                  interval="preserveStartEnd"
                  minTickGap={16}
                  tick={{ fill: AXIS_TEXT, fontSize: 12 }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tick={{ fill: AXIS_TEXT, fontSize: 12 }}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ fill: "hsl(var(--heroui-default-100))" }}
                />
                <Bar
                  dataKey="newUsers"
                  fill="var(--series-1)"
                  maxBarSize={20}
                  name="신규"
                  stackId="a"
                  stroke={SURFACE}
                  strokeWidth={2}
                />
                <Bar
                  dataKey="returning"
                  fill="var(--series-2)"
                  maxBarSize={20}
                  name="재방문"
                  radius={[4, 4, 0, 0]}
                  stackId="a"
                  stroke={SURFACE}
                  strokeWidth={2}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-default-500">표로 보기</summary>
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-default-500">
                  <tr>
                    <th className="py-1 pr-4 font-medium">날짜</th>
                    <th className="py-1 pr-4 text-right font-medium">활성</th>
                    <th className="py-1 pr-4 text-right font-medium">신규</th>
                    <th className="py-1 text-right font-medium">재방문</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {[...stats.dailySeries].reverse().map((d) => (
                    <tr key={d.date} className="border-t border-default-100">
                      <td className="py-1 pr-4">{d.date}</td>
                      <td className="py-1 pr-4 text-right">{fmt(d.active)}</td>
                      <td className="py-1 pr-4 text-right">{fmt(d.newUsers)}</td>
                      <td className="py-1 text-right">{fmt(d.returning)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card shadow="sm">
          <CardHeader>
            <h2 className="text-base font-semibold">리텐션</h2>
          </CardHeader>
          <CardBody className="gap-4">
            <div className="grid grid-cols-3 gap-4">
              <RetentionCell label="D1 (다음 날)" point={stats.retention.d1} />
              <RetentionCell label="D7 (7일 뒤)" point={stats.retention.d7} />
              <RetentionCell label="D30 (30일 뒤)" point={stats.retention.d30} />
            </div>
            <p className="text-xs text-default-400">
              처음 확인된 날을 기준으로, N일 뒤에 다시 앱을 연 설치의 비율입니다.
            </p>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader>
            <h2 className="text-base font-semibold">앱 버전 분포 (최근 30일 활성 설치)</h2>
          </CardHeader>
          <CardBody className="gap-2">
            {stats.versions.length === 0 ? (
              <p className="text-sm text-default-500">아직 데이터가 없습니다.</p>
            ) : (
              stats.versions.map((v) => (
                <div key={v.version} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 truncate tabular-nums">{v.version}</span>
                  <div className="h-2 flex-1 rounded-full bg-default-100">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${(v.installs / maxVersion) * 100}%`,
                        background: "var(--series-1)",
                      }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right tabular-nums">{fmt(v.installs)}</span>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <div className="text-xs leading-relaxed text-default-400">
        <p>
          · 전체 설치 {fmt(stats.totalInstalls)}대
          {stats.firstDataDate ? ` · 데이터 시작일 ${stats.firstDataDate}` : ""}
        </p>
        <p>· 앱 로거를 처음 배포한 날에는 기존 사용자가 모두 신규로 잡혀 신규 설치가 크게 나옵니다.</p>
        <p>· D7, D30 리텐션은 로거 배포 후 각각 1주, 1달이 지나야 의미가 생깁니다.</p>
        <p>· 앱을 열지 않은 사용자와 이벤트를 아직 못 보낸 기기는 집계되지 않습니다.</p>
      </div>
    </div>
  );
}