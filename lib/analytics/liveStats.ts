// lib/analytics/liveStats.ts
// 실시간 탭 집계. "접속 중" = 최근 N분 안에 이벤트를 보낸 설치 수.
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

export interface LiveEvent {
  id: number;
  at: number; // epoch ms
  name: string;
  installId: string;
  appVersion: string | null;
  detail: string;
}

export interface LiveMinute {
  at: number; // 분 시작 epoch ms
  installs: number;
  events: number;
}

export interface LiveStats {
  asOf: number;
  active5: number;
  active30: number;
  sessions30: number;
  events30: number;
  minutes: LiveMinute[]; // 최근 30분, 오래된 순
  latest: LiveEvent[];
}

function describe(name: string, params: Record<string, unknown> | null): string {
  if (!params) return "";

  const p = params as Record<string, string | number | boolean | null>;

  if (name === "screen_view") return String(p.screen ?? p.screen_name ?? "");

  if (name.startsWith("ad_")) {
    const parts: string[] = [];

    if (p.format) parts.push(String(p.format));
    if (name === "ad_paid" && p.valueMicros != null) {
      parts.push(`${(Number(p.valueMicros) / 1_000_000).toFixed(4)} ${p.currency ?? ""}`.trim());
    }
    if (name === "ad_load_failed" && p.code != null) parts.push(`code ${p.code}`);

    return parts.join(" · ");
  }

  if (name === "feature_use") return String(p.feature ?? p.name ?? "");

  return Object.entries(p)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

export async function getLiveStats(
  appDbId: string,
  opts: { excludeDebug?: boolean } = {},
): Promise<LiveStats> {
  const now = Date.now();
  const since30 = new Date(now - 30 * 60 * 1000);
  const since5 = new Date(now - 5 * 60 * 1000);

  const dbg = opts.excludeDebug
    ? Prisma.sql`AND (ai."appVersion" IS NULL OR ai."appVersion" NOT LIKE '%-debug')`
    : Prisma.empty;

  const [counts, perMinute, latest] = await Promise.all([
    prisma.$queryRaw<
      { active5: number; active30: number; sessions30: number; events30: number }[]
    >(Prisma.sql`
      SELECT
        COUNT(DISTINCT e."installId") FILTER (WHERE e."occurredAt" >= ${since5})::int AS active5,
        COUNT(DISTINCT e."installId")::int AS active30,
        COUNT(*) FILTER (WHERE e.name = 'session_start')::int AS sessions30,
        COUNT(*)::int AS events30
      FROM analytics_events e
      JOIN analytics_installs ai
        ON ai."appId" = e."appId" AND ai."installId" = e."installId"
      WHERE e."appId" = ${appDbId} AND e."occurredAt" >= ${since30} ${dbg}
    `),
    prisma.$queryRaw<{ t: number; installs: number; events: number }[]>(Prisma.sql`
      SELECT
        EXTRACT(EPOCH FROM date_trunc('minute', e."occurredAt"))::float8 AS t,
        COUNT(DISTINCT e."installId")::int AS installs,
        COUNT(*)::int AS events
      FROM analytics_events e
      JOIN analytics_installs ai
        ON ai."appId" = e."appId" AND ai."installId" = e."installId"
      WHERE e."appId" = ${appDbId} AND e."occurredAt" >= ${since30} ${dbg}
      GROUP BY 1
    `),
    prisma.$queryRaw<
      {
        id: number;
        t: number;
        name: string;
        installId: string;
        appVersion: string | null;
        params: Record<string, unknown> | null;
      }[]
    >(Prisma.sql`
      SELECT
        e.id,
        EXTRACT(EPOCH FROM e."occurredAt")::float8 AS t,
        e.name,
        e."installId",
        e."appVersion",
        e.params
      FROM analytics_events e
      JOIN analytics_installs ai
        ON ai."appId" = e."appId" AND ai."installId" = e."installId"
      WHERE e."appId" = ${appDbId} ${dbg}
      ORDER BY e."occurredAt" DESC, e.id DESC
      LIMIT 50
    `),
  ]);

  const c = counts[0] ?? { active5: 0, active30: 0, sessions30: 0, events30: 0 };

  const byMinute = new Map<number, { installs: number; events: number }>();

  for (const r of perMinute) {
    byMinute.set(Math.round(Number(r.t) * 1000), {
      installs: Number(r.installs),
      events: Number(r.events),
    });
  }

  const currentMinute = Math.floor(now / 60_000) * 60_000;
  const minutes: LiveMinute[] = [];

  for (let i = 29; i >= 0; i--) {
    const at = currentMinute - i * 60_000;
    const hit = byMinute.get(at);

    minutes.push({ at, installs: hit?.installs ?? 0, events: hit?.events ?? 0 });
  }

  return {
    asOf: now,
    active5: Number(c.active5),
    active30: Number(c.active30),
    sessions30: Number(c.sessions30),
    events30: Number(c.events30),
    minutes,
    latest: latest.map((r) => ({
      id: r.id,
      at: Math.round(Number(r.t) * 1000),
      name: r.name,
      installId: r.installId,
      appVersion: r.appVersion,
      detail: describe(r.name, r.params),
    })),
  };
}