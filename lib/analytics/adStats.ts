// lib/analytics/adStats.ts
// 광고 탭 집계. 날짜는 한국시간(KST) 기준 "yyyy-MM-dd".
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { kstDate } from "@/lib/analytics/ingest";

export const AD_FORMATS = [
  { key: "banner", label: "배너" },
  { key: "interstitial", label: "전면" },
  { key: "rewarded", label: "리워드" },
  { key: "rewarded_target", label: "목표 리워드" },
];

export interface FormatRow {
  format: string;
  label: string;
  loads: number;
  loadFails: number;
  loadFailRate: number | null;
  impressions: number;
  clicks: number;
  ctr: number | null;
  rewards: number;
  rewardRate: number | null;
  revenue: number;
}

export interface AdDay {
  date: string;
  impressions: number;
  clicks: number;
  revenue: number;
  dau: number;
  byFormat: Record<string, number>;
}

export interface AdStats {
  asOf: string;
  today: string;
  currency: string | null;
  otherCurrencies: string[];
  todayImpressions: number;
  todayClicks: number;
  todayRevenue: number;
  yesterdayRevenue: number;
  last7Revenue: number;
  last7Impressions: number;
  last7Clicks: number;
  arpdauToday: number | null;
  arpdau7d: number | null;
  formatKeys: string[];
  formats: FormatRow[];
  daily: AdDay[];
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);

  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const labelOf = (key: string) =>
  AD_FORMATS.find((f) => f.key === key)?.label ?? key;

const rate = (num: number, den: number) => (den > 0 ? num / den : null);

export async function getAdStats(
  appDbId: string,
  opts: { excludeDebug?: boolean } = {},
): Promise<AdStats> {
  const now = new Date();
  const today = kstDate(now);
  const day = (offset: number) => shiftDate(today, offset);
  const startDate = day(-13);

  // 한국시간 자정을 UTC 로 바꾼 시작 시각 (DB 의 시각은 UTC 로 저장돼 있음)
  const since = new Date(`${startDate}T00:00:00+09:00`)
    .toISOString()
    .replace("Z", "");

  const dbg = opts.excludeDebug
    ? Prisma.sql`AND (ai."appVersion" IS NULL OR ai."appVersion" NOT LIKE '%-debug')`
    : Prisma.empty;

  const [countRows, paidRows, dauRows] = await Promise.all([
    prisma.$queryRaw<{ date: string; format: string; name: string; n: number }[]>(
      Prisma.sql`
        SELECT to_char((e."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS date,
               COALESCE(e.params->>'format', '(없음)') AS format,
               e.name AS name,
               COUNT(*)::int AS n
        FROM analytics_events e
        JOIN analytics_installs ai
          ON ai."appId" = e."appId" AND ai."installId" = e."installId"
        WHERE e."appId" = ${appDbId}
          AND e.name IN ('ad_load', 'ad_load_failed', 'ad_impression', 'ad_click', 'ad_reward_earned')
          AND e."occurredAt" >= ${since}::timestamp ${dbg}
        GROUP BY 1, 2, 3
      `,
    ),
    prisma.$queryRaw<{ date: string; format: string; currency: string; micros: number }[]>(
      Prisma.sql`
        SELECT to_char((e."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS date,
               COALESCE(e.params->>'format', '(없음)') AS format,
               COALESCE(e.params->>'currency', '?') AS currency,
               COALESCE(SUM((e.params->>'valueMicros')::numeric), 0)::float8 AS micros
        FROM analytics_events e
        JOIN analytics_installs ai
          ON ai."appId" = e."appId" AND ai."installId" = e."installId"
        WHERE e."appId" = ${appDbId}
          AND e.name = 'ad_paid'
          AND e."occurredAt" >= ${since}::timestamp ${dbg}
        GROUP BY 1, 2, 3
      `,
    ),
    prisma.$queryRaw<{ date: string; n: number }[]>(Prisma.sql`
      SELECT dai.date AS date, COUNT(*)::int AS n
      FROM daily_active_installs dai
      JOIN analytics_installs ai
        ON ai."appId" = dai."appId" AND ai."installId" = dai."installId"
      WHERE dai."appId" = ${appDbId} AND dai.date >= ${startDate} ${dbg}
      GROUP BY dai.date
    `),
  ]);

  // 기준 통화: 최근 14일 예상 수익이 가장 큰 통화
  const byCurrency = new Map<string, number>();

  for (const r of paidRows) {
    byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + r.micros);
  }

  const sortedCurrencies = Array.from(byCurrency.entries()).sort((a, b) => b[1] - a[1]);
  const currency = sortedCurrencies[0]?.[0] ?? null;
  const otherCurrencies = sortedCurrencies.slice(1).map(([c]) => c);

  const days = Array.from({ length: 14 }, (_, i) => day(i - 13));
  const daily = new Map<string, AdDay>(
    days.map((date) => [
      date,
      { date, impressions: 0, clicks: 0, revenue: 0, dau: 0, byFormat: {} },
    ]),
  );
  const last7Start = day(-6);

  interface Acc {
    loads: number;
    loadFails: number;
    impressions: number;
    clicks: number;
    rewards: number;
    revenue: number;
  }
  const perFormat = new Map<string, Acc>();
  const acc = (f: string): Acc => {
    let a = perFormat.get(f);

    if (!a) {
      a = { loads: 0, loadFails: 0, impressions: 0, clicks: 0, rewards: 0, revenue: 0 };
      perFormat.set(f, a);
    }

    return a;
  };
  const seenFormats = new Set<string>();

  for (const r of countRows) {
    const d = daily.get(r.date);

    if (!d) continue;

    if (r.name === "ad_impression") {
      d.impressions += r.n;
      d.byFormat[r.format] = (d.byFormat[r.format] ?? 0) + r.n;
      seenFormats.add(r.format);
    }
    if (r.name === "ad_click") d.clicks += r.n;

    if (r.date >= last7Start) {
      const a = acc(r.format);

      seenFormats.add(r.format);
      if (r.name === "ad_load") a.loads += r.n;
      if (r.name === "ad_load_failed") a.loadFails += r.n;
      if (r.name === "ad_impression") a.impressions += r.n;
      if (r.name === "ad_click") a.clicks += r.n;
      if (r.name === "ad_reward_earned") a.rewards += r.n;
    }
  }

  for (const r of paidRows) {
    if (r.currency !== currency) continue;

    const d = daily.get(r.date);

    if (!d) continue;

    const value = r.micros / 1_000_000;

    d.revenue += value;
    if (r.date >= last7Start) acc(r.format).revenue += value;
    seenFormats.add(r.format);
  }

  for (const r of dauRows) {
    const d = daily.get(r.date);

    if (d) d.dau = r.n;
  }

  const series = days.map((date) => daily.get(date) as AdDay);
  const last7 = series.slice(-7);
  const sum = (arr: AdDay[], pick: (d: AdDay) => number) =>
    arr.reduce((a, d) => a + pick(d), 0);

  const todayDay = series[series.length - 1];
  const yesterdayDay = series[series.length - 2];
  const last7Revenue = sum(last7, (d) => d.revenue);
  const last7Dau = sum(last7, (d) => d.dau);

  const knownKeys = AD_FORMATS.map((f) => f.key).filter((k) => seenFormats.has(k));
  const extraKeys = Array.from(seenFormats).filter(
    (k) => !AD_FORMATS.some((f) => f.key === k),
  );
  const formatKeys = [...knownKeys, ...extraKeys];

  const formats: FormatRow[] = formatKeys.map((key) => {
    const a = acc(key);
    const isReward = key === "rewarded" || key === "rewarded_target";

    return {
      format: key,
      label: labelOf(key),
      loads: a.loads,
      loadFails: a.loadFails,
      loadFailRate: rate(a.loadFails, a.loads + a.loadFails),
      impressions: a.impressions,
      clicks: a.clicks,
      ctr: rate(a.clicks, a.impressions),
      rewards: a.rewards,
      rewardRate: isReward ? rate(a.rewards, a.impressions) : null,
      revenue: a.revenue,
    };
  });

  return {
    asOf: now.toISOString(),
    today,
    currency,
    otherCurrencies,
    todayImpressions: todayDay.impressions,
    todayClicks: todayDay.clicks,
    todayRevenue: todayDay.revenue,
    yesterdayRevenue: yesterdayDay.revenue,
    last7Revenue,
    last7Impressions: sum(last7, (d) => d.impressions),
    last7Clicks: sum(last7, (d) => d.clicks),
    arpdauToday: currency && todayDay.dau > 0 ? todayDay.revenue / todayDay.dau : null,
    arpdau7d: currency && last7Dau > 0 ? last7Revenue / last7Dau : null,
    formatKeys,
    formats,
    daily: series,
  };
}