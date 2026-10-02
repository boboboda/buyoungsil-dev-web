// components/admin/analytics/AdsView.tsx
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

import type { AdStats } from "@/lib/analytics/adStats";

const numberFormat = new Intl.NumberFormat("ko-KR");
const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : numberFormat.format(n);
const pct = (v: number | null, digits = 1) =>
  v === null ? "-" : `${(v * 100).toFixed(digits)}%`;

const NO_DECIMAL = ["KRW", "JPY"];

function fmtMoney(v: number | null | undefined, cur: string | null) {
  if (v === null || v === undefined || cur === null) return "-";

  const digits = NO_DECIMAL.includes(cur) ? 0 : v !== 0 && Math.abs(v) < 1 ? 4 : 2;

  try {
    return new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency: cur,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(v);
  } catch {
    return `${v.toFixed(digits)} ${cur}`;
  }
}

// 광고 형식별 고정 색 (형식이 곧 색이다. 순서나 필터에 따라 바뀌지 않는다)
const FORMAT_COLOR: Record<string, string> = {
  banner: "var(--series-1)",
  interstitial: "var(--series-2)",
  rewarded: "var(--series-3)",
  rewarded_target: "var(--series-4)",
};
const colorOf = (f: string) => FORMAT_COLOR[f] ?? "var(--heroui-default-400)";

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

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
      style={{ background: color }}
    />
  );
}

export default function AdsView({ stats }: { stats: AdStats }) {
  const router = useRouter();
  const cur = stats.currency;
  const labelOf = (key: string) =>
    stats.formats.find((f) => f.format === key)?.label ?? key;

  const chartData = stats.daily.map((d) => ({
    ...d.byFormat,
    date: d.date,
    label: d.date.slice(5),
    impressions: d.impressions,
    revenue: d.revenue,
  }));

  const impressionTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;

    const p = payload[0].payload;

    return (
      <div className="rounded-md border border-default-200 bg-content1 px-3 py-2 text-sm shadow-md">
        <div className="text-xs text-default-500">{p.date}</div>
        <div className="mt-1 text-base font-semibold tabular-nums">
          노출 {fmt(p.impressions)}회
        </div>
        {stats.formatKeys.map((k) => (
          <div key={k} className="flex items-center gap-2 text-xs text-default-600">
            <span className="inline-block h-0.5 w-3" style={{ background: colorOf(k) }} />
            {labelOf(k)}{" "}
            <span className="font-semibold tabular-nums">{fmt(p[k] ?? 0)}</span>
          </div>
        ))}
      </div>
    );
  };

  const revenueTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;

    const p = payload[0].payload;

    return (
      <div className="rounded-md border border-default-200 bg-content1 px-3 py-2 text-sm shadow-md">
        <div className="text-xs text-default-500">{p.date}</div>
        <div className="mt-1 text-base font-semibold tabular-nums">
          {fmtMoney(p.revenue, cur)}
        </div>
      </div>
    );
  };

  const lastKey = stats.formatKeys[stats.formatKeys.length - 1];

  return (
    <div className="viz-root flex flex-col gap-6">
      <style>{`
        .viz-root { --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a; --series-4: #eda100; --series-6: #008300; }
        .dark .viz-root { --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; --series-4: #c98500; --series-6: #008300; }
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
            <span className="text-xs text-default-500">오늘 예상 수익</span>
            <span className="text-5xl font-semibold tabular-nums">
              {cur ? fmtMoney(stats.todayRevenue, cur) : "-"}
            </span>
            <span className="text-xs text-default-400">
              {cur
                ? `어제 ${fmtMoney(stats.yesterdayRevenue, cur)} · 최근 7일 ${fmtMoney(stats.last7Revenue, cur)}`
                : "아직 수익 이벤트(ad_paid)가 없습니다"}
            </span>
          </CardBody>
        </Card>
        <Stat
          label="오늘 노출"
          sub={`최근 7일 ${fmt(stats.last7Impressions)}회`}
          value={`${fmt(stats.todayImpressions)}회`}
        />
        <Stat
          label="오늘 클릭"
          sub={`CTR ${pct(
            stats.todayImpressions > 0 ? stats.todayClicks / stats.todayImpressions : null,
            2,
          )}`}
          value={`${fmt(stats.todayClicks)}회`}
        />
        <Stat
          label="ARPDAU (오늘)"
          sub="활성 사용자 1명당 예상 수익"
          value={fmtMoney(stats.arpdauToday, cur)}
        />
        <Stat
          label="ARPDAU (7일 평균)"
          sub="7일 수익 ÷ 일별 활성 합계"
          value={fmtMoney(stats.arpdau7d, cur)}
        />
      </div>

      <Card shadow="sm">
        <CardHeader>
          <h2 className="text-base font-semibold">광고 형식별 성과 (최근 7일)</h2>
        </CardHeader>
        <CardBody>
          {stats.formats.length === 0 ? (
            <p className="text-sm text-default-500">아직 광고 이벤트가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-default-500">
                  <tr>
                    <th className="py-2 pr-4 font-medium">광고</th>
                    <th className="py-2 pr-4 text-right font-medium">노출</th>
                    <th className="py-2 pr-4 text-right font-medium">클릭</th>
                    <th className="py-2 pr-4 text-right font-medium">CTR</th>
                    <th className="py-2 pr-4 text-right font-medium">로드 실패율</th>
                    <th className="py-2 pr-4 text-right font-medium">리워드 완료율</th>
                    <th className="py-2 text-right font-medium">예상 수익</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {stats.formats.map((f) => (
                    <tr key={f.format} className="border-t border-default-100">
                      <td className="py-2 pr-4">
                        <span className="flex items-center gap-2">
                          <Swatch color={colorOf(f.format)} />
                          {f.label}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right">{fmt(f.impressions)}</td>
                      <td className="py-2 pr-4 text-right">{fmt(f.clicks)}</td>
                      <td className="py-2 pr-4 text-right">{pct(f.ctr, 2)}</td>
                      <td className="py-2 pr-4 text-right">
                        {pct(f.loadFailRate)}
                        <span className="block text-xs text-default-400">
                          실패 {fmt(f.loadFails)} / 시도 {fmt(f.loads + f.loadFails)}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {f.rewardRate === null ? "-" : pct(f.rewardRate)}
                        {f.rewardRate !== null ? (
                          <span className="block text-xs text-default-400">
                            보상 {fmt(f.rewards)} / 노출 {fmt(f.impressions)}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 text-right">{fmtMoney(f.revenue, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card shadow="sm">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">일별 광고 노출 (최근 14일)</h2>
          <div className="flex flex-wrap items-center gap-4 text-xs text-default-600">
            {stats.formatKeys.map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <Swatch color={colorOf(k)} />
                {labelOf(k)}
              </span>
            ))}
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
                  tick={{ fill: AXIS_TEXT, fontSize: 12 }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tick={{ fill: AXIS_TEXT, fontSize: 12 }}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  content={impressionTooltip}
                  cursor={{ fill: "hsl(var(--heroui-default-100))" }}
                />
                {stats.formatKeys.map((k) => (
                  <Bar
                    key={k}
                    dataKey={k}
                    fill={colorOf(k)}
                    maxBarSize={20}
                    name={labelOf(k)}
                    radius={k === lastKey ? [4, 4, 0, 0] : undefined}
                    stackId="a"
                    stroke={SURFACE}
                    strokeWidth={2}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      <Card shadow="sm">
        <CardHeader>
          <h2 className="text-base font-semibold">
            일별 예상 수익 (최근 14일{cur ? `, ${cur}` : ""})
          </h2>
        </CardHeader>
        <CardBody>
          <div className="h-56 w-full">
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
                  tick={{ fill: AXIS_TEXT, fontSize: 12 }}
                  tickLine={false}
                />
                <YAxis
                  axisLine={false}
                  tick={{ fill: AXIS_TEXT, fontSize: 12 }}
                  tickFormatter={(v) => (v >= 1 ? String(Math.round(v * 100) / 100) : String(v))}
                  tickLine={false}
                  width={48}
                />
                <Tooltip
                  content={revenueTooltip}
                  cursor={{ fill: "hsl(var(--heroui-default-100))" }}
                />
                <Bar
                  dataKey="revenue"
                  fill="var(--series-6)"
                  maxBarSize={20}
                  name="예상 수익"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-default-500">표로 보기</summary>
            <div className="mt-2 max-h-72 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-default-500">
                  <tr>
                    <th className="py-1 pr-4 font-medium">날짜</th>
                    <th className="py-1 pr-4 text-right font-medium">노출</th>
                    <th className="py-1 pr-4 text-right font-medium">클릭</th>
                    <th className="py-1 pr-4 text-right font-medium">예상 수익</th>
                    <th className="py-1 text-right font-medium">활성 사용자</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {[...stats.daily].reverse().map((d) => (
                    <tr key={d.date} className="border-t border-default-100">
                      <td className="py-1 pr-4">{d.date}</td>
                      <td className="py-1 pr-4 text-right">{fmt(d.impressions)}</td>
                      <td className="py-1 pr-4 text-right">{fmt(d.clicks)}</td>
                      <td className="py-1 pr-4 text-right">{fmtMoney(d.revenue, cur)}</td>
                      <td className="py-1 text-right">{fmt(d.dau)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </CardBody>
      </Card>

      <div className="text-xs leading-relaxed text-default-400">
        <p>· 예상 수익은 AdMob이 광고마다 알려주는 추정치라서, 콘솔의 확정 수익과는 차이가 날 수 있습니다.</p>
        <p>· 배너는 광고가 자동으로 새로 고쳐질 때마다 로드와 노출이 각각 집계됩니다.</p>
        <p>· 로드 실패율은 실패 ÷ (성공 + 실패)이고, 리워드 완료율은 보상 지급 ÷ 리워드 노출입니다.</p>
        {stats.otherCurrencies.length > 0 ? (
          <p>
            · 다른 통화({stats.otherCurrencies.join(", ")})의 수익은 합산하지 않았습니다.
          </p>
        ) : null}
        <p>· 앱 로거 배포 이전의 광고 기록은 없습니다.</p>
      </div>
    </div>
  );
}