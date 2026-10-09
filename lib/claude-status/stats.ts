// lib/claude-status/stats.ts
// 관리자 화면에 보여줄 Claude Code 작업 현황 집계.
import { kstDate } from "./ingest";

import prisma from "@/lib/prisma";

export type SessionStatus = "working" | "waiting" | "idle" | "ended";

export interface TokenSum {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface ClaudeSessionView {
  id: string;
  device: string;
  project: string;
  status: SessionStatus;
  quiet: boolean; // 작업 중/입력 필요인데 오래 소식이 없음 (긴 빌드이거나 훅이 끊겼을 수 있음)
  lastEvent: string;
  lastTool: string | null;
  startedAt: number; // epoch ms
  lastEventAt: number; // epoch ms
  tokens: TokenSum;
}

export interface ClaudeEventView {
  id: number;
  at: number;
  event: string;
  project: string;
  device: string;
}

export interface ClaudeDailyView extends TokenSum {
  date: string; // yyyy-MM-dd (KST)
}

export interface ClaudeStats {
  asOf: number;
  sessions: ClaudeSessionView[];
  windowHours: number;
  windowTokens: TokenSum; // 최근 N시간 사용량 (한도 잔량이 아니라 "내가 쓴 양")
  daily: ClaudeDailyView[]; // 최근 14일, 오래된 순
  recent: ClaudeEventView[];
}

export const WINDOW_HOURS = 5;
const QUIET_MS = 10 * 60 * 1000;
const SESSION_SHOW_MS = 24 * 60 * 60 * 1000;
const DAILY_DAYS = 14;

const ORDER: Record<string, number> = {
  working: 0,
  waiting: 1,
  idle: 2,
  ended: 3,
};

const num = (v: bigint | number | null | undefined) =>
  v === null || v === undefined ? 0 : Number(v);

export async function getClaudeStats(): Promise<ClaudeStats> {
  const now = Date.now();
  const windowFrom = new Date(now - WINDOW_HOURS * 60 * 60 * 1000);
  const sessionFrom = new Date(now - SESSION_SHOW_MS);
  const firstDay = kstDate(
    new Date(now - (DAILY_DAYS - 1) * 24 * 60 * 60 * 1000),
  );

  const [sessions, windowSum, dailyRows, recent] = await Promise.all([
    prisma.claudeSession.findMany({
      where: { lastEventAt: { gte: sessionFrom } },
      orderBy: { lastEventAt: "desc" },
      take: 50,
    }),
    prisma.claudeEvent.aggregate({
      where: { at: { gte: windowFrom } },
      _sum: {
        inputDelta: true,
        outputDelta: true,
        cacheCreateDelta: true,
        cacheReadDelta: true,
      },
    }),
    prisma.claudeDailyUsage.groupBy({
      by: ["date"],
      where: { date: { gte: firstDay } },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheCreateTokens: true,
        cacheReadTokens: true,
      },
    }),
    prisma.claudeEvent.findMany({
      orderBy: { at: "desc" },
      take: 20,
      include: { session: { select: { project: true, device: true } } },
    }),
  ]);

  const sessionViews: ClaudeSessionView[] = sessions
    .map((s) => {
      const status = (s.status in ORDER ? s.status : "idle") as SessionStatus;
      const quiet =
        (status === "working" || status === "waiting") &&
        now - s.lastEventAt.getTime() > QUIET_MS;

      return {
        id: s.id,
        device: s.device,
        project: s.project,
        status,
        quiet,
        lastEvent: s.lastEvent,
        lastTool: s.lastTool,
        startedAt: s.startedAt.getTime(),
        lastEventAt: s.lastEventAt.getTime(),
        tokens: {
          input: num(s.inputTokens),
          output: num(s.outputTokens),
          cacheCreate: num(s.cacheCreateTokens),
          cacheRead: num(s.cacheReadTokens),
        },
      };
    })
    .sort(
      (a, b) =>
        ORDER[a.status] - ORDER[b.status] || b.lastEventAt - a.lastEventAt,
    );

  const byDate = new Map(dailyRows.map((r) => [r.date, r._sum]));
  const daily: ClaudeDailyView[] = [];

  for (let i = DAILY_DAYS - 1; i >= 0; i--) {
    const date = kstDate(new Date(now - i * 24 * 60 * 60 * 1000));
    const sum = byDate.get(date);

    daily.push({
      date,
      input: num(sum?.inputTokens),
      output: num(sum?.outputTokens),
      cacheCreate: num(sum?.cacheCreateTokens),
      cacheRead: num(sum?.cacheReadTokens),
    });
  }

  return {
    asOf: now,
    sessions: sessionViews,
    windowHours: WINDOW_HOURS,
    windowTokens: {
      input: num(windowSum._sum.inputDelta),
      output: num(windowSum._sum.outputDelta),
      cacheCreate: num(windowSum._sum.cacheCreateDelta),
      cacheRead: num(windowSum._sum.cacheReadDelta),
    },
    daily,
    recent: recent.map((e) => ({
      id: e.id,
      at: e.at.getTime(),
      event: e.event,
      project: e.session.project,
      device: e.session.device,
    })),
  };
}
