// lib/analytics/stats.ts
// 대시보드용 집계 쿼리. 모든 날짜는 한국시간(KST) 기준 "yyyy-MM-dd" 문자열이다.
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { kstDate } from "@/lib/analytics/ingest";

export interface AnalyticsAppInfo {
  id: string;
  appId: string;
  name: string;
  isActive: boolean;
}

export interface DailyPoint {
  date: string;
  active: number;
  newUsers: number;
  returning: number;
}

export interface RetentionPoint {
  rate: number | null;
  cohort: number;
  retained: number;
}

export interface VersionShare {
  version: string;
  installs: number;
}

export interface UserStats {
  asOf: string;
  today: string;
  dau: number;
  dauYesterday: number;
  wau: number;
  mau: number;
  stickiness: number | null;
  newToday: number;
  new7d: number;
  new30d: number;
  totalInstalls: number;
  firstDataDate: string | null;
  dailySeries: DailyPoint[];
  retention: { d1: RetentionPoint; d7: RetentionPoint; d30: RetentionPoint };
  versions: VersionShare[];
}

export async function listApps(): Promise<AnalyticsAppInfo[]> {
  return prisma.analyticsApp.findMany({
    select: { id: true, appId: true, name: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);

  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export async function getUserStats(
  appDbId: string,
  opts: { excludeDebug?: boolean } = {},
): Promise<UserStats> {
  const now = new Date();
  const today = kstDate(now);
  const day = (offset: number) => shiftDate(today, offset);

  // 디버그 빌드(appVersion 이 -debug 로 끝남)를 빼는 조건. 모든 쿼리의 설치 테이블 별칭은 ai.
  const dbg = opts.excludeDebug
    ? Prisma.sql`AND (ai."appVersion" IS NULL OR ai."appVersion" NOT LIKE '%-debug')`
    : Prisma.empty;

  const activeUsers = async (from: string, to: string) => {
    const rows = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT dai."installId")::int AS n
      FROM daily_active_installs dai
      JOIN analytics_installs ai
        ON ai."appId" = dai."appId" AND ai."installId" = dai."installId"
      WHERE dai."appId" = ${appDbId} AND dai.date >= ${from} AND dai.date <= ${to} ${dbg}
    `);

    return rows[0]?.n ?? 0;
  };

  const retentionFor = async (n: number): Promise<RetentionPoint> => {
    const cutoff = day(-n);
    const rows = await prisma.$queryRaw<{ cohort: number; retained: number }[]>(
      Prisma.sql`
        WITH cohort AS (
          SELECT ai."installId" AS install_id,
                 to_char((ai."firstSeenAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d0
          FROM analytics_installs ai
          WHERE ai."appId" = ${appDbId} ${dbg}
        )
        SELECT COUNT(*)::int AS cohort, COUNT(dai."installId")::int AS retained
        FROM cohort c
        LEFT JOIN daily_active_installs dai
          ON dai."appId" = ${appDbId}
         AND dai."installId" = c.install_id
         AND dai.date = to_char(c.d0::date + ${n}::int, 'YYYY-MM-DD')
        WHERE c.d0 <= ${cutoff}
      `,
    );
    const cohort = rows[0]?.cohort ?? 0;
    const retained = rows[0]?.retained ?? 0;

    return { cohort, retained, rate: cohort > 0 ? retained / cohort : null };
  };

  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("Z", "");

  const [
    dau,
    dauYesterday,
    wau,
    mau,
    activeRows,
    newRows,
    d1,
    d7,
    d30,
    versionRows,
  ] = await Promise.all([
    activeUsers(today, today),
    activeUsers(day(-1), day(-1)),
    activeUsers(day(-6), today),
    activeUsers(day(-29), today),
    prisma.$queryRaw<{ date: string; n: number }[]>(Prisma.sql`
      SELECT dai.date AS date, COUNT(*)::int AS n
      FROM daily_active_installs dai
      JOIN analytics_installs ai
        ON ai."appId" = dai."appId" AND ai."installId" = dai."installId"
      WHERE dai."appId" = ${appDbId} AND dai.date >= ${day(-29)} ${dbg}
      GROUP BY dai.date
    `),
    prisma.$queryRaw<{ date: string; n: number }[]>(Prisma.sql`
      SELECT to_char((ai."firstSeenAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS date,
             COUNT(*)::int AS n
      FROM analytics_installs ai
      WHERE ai."appId" = ${appDbId} ${dbg}
      GROUP BY 1
    `),
    retentionFor(1),
    retentionFor(7),
    retentionFor(30),
    prisma.$queryRaw<{ version: string; n: number }[]>(Prisma.sql`
      SELECT COALESCE(ai."appVersion", '(알 수 없음)') AS version, COUNT(*)::int AS n
      FROM analytics_installs ai
      WHERE ai."appId" = ${appDbId} AND ai."lastSeenAt" >= ${since}::timestamp ${dbg}
      GROUP BY 1
      ORDER BY n DESC
      LIMIT 12
    `),
  ]);

  const activeByDate = new Map(activeRows.map((r) => [r.date, r.n]));
  const newByDate = new Map(newRows.map((r) => [r.date, r.n]));

  const dailySeries: DailyPoint[] = Array.from({ length: 30 }, (_, i) => {
    const date = day(i - 29);
    const active = activeByDate.get(date) ?? 0;
    const newUsers = Math.min(newByDate.get(date) ?? 0, active);

    return { date, active, newUsers, returning: active - newUsers };
  });

  const sumNew = (days: number) =>
    Array.from({ length: days }, (_, i) => newByDate.get(day(-i)) ?? 0).reduce(
      (a, b) => a + b,
      0,
    );

  const allDates = newRows.map((r) => r.date).sort();

  return {
    asOf: now.toISOString(),
    today,
    dau,
    dauYesterday,
    wau,
    mau,
    stickiness: mau > 0 ? dau / mau : null,
    newToday: newByDate.get(today) ?? 0,
    new7d: sumNew(7),
    new30d: sumNew(30),
    totalInstalls: newRows.reduce((a, r) => a + r.n, 0),
    firstDataDate: allDates[0] ?? null,
    dailySeries,
    retention: { d1, d7, d30 },
    versions: versionRows.map((r) => ({ version: r.version, installs: r.n })),
  };
}