// lib/factory/statusBar.ts
// 관리자 하단 상태바(모든 /admin 화면)용 가벼운 요약: 감독 프로그램 연결·진행/대기 일감 수·마지막 응답·서버 빌드 커밋·AI 한도.
// 통제실 전체 현황(supervisorSnapshot)보다 적게 읽는다. 표가 없거나 읽기에 실패한 항목은 null(화면에는 '-').
import type { UsageLimitsView } from "@/lib/claude-status/limits";

import prisma from "@/lib/prisma";
import { readLimits } from "@/lib/claude-status/stats";
import { getSupervisorInfo } from "@/lib/factory/settings";

// lib/factory/supervisor.ts 의 ONLINE_MS 와 같은 기준(90초 안에 응답하면 연결됨)
const ONLINE_MS = 90_000;

export interface StatusBarData {
  asOf: number;
  supervisor: {
    online: boolean;
    lastSeenAt: number | null;
    running: number;
    waiting: number; // 승인된 대기 + 승인 기다림
    commit: string | null; // 감독 프로그램 커밋
  } | null;
  build: { commit: string; at: number | null } | null; // 마지막으로 성공한 서버 배포 커밋
  claude: UsageLimitsView | null;
  codex: UsageLimitsView | null;
}

const settle = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch (e) {
    console.error("[status-bar] 읽기 실패:", e);

    return null;
  }
};

export async function statusBarSnapshot(): Promise<StatusBarData> {
  const now = Date.now();
  const [last, running, approved, pending, info, deploy, limits] =
    await Promise.all([
      settle(
        prisma.factoryWorkerToken.findFirst({
          where: { lastUsedAt: { not: null } },
          orderBy: { lastUsedAt: "desc" },
          select: { lastUsedAt: true },
        }),
      ),
      settle(prisma.factoryJob.count({ where: { status: "running" } })),
      settle(prisma.factoryJob.count({ where: { status: "approved" } })),
      settle(prisma.factoryJob.count({ where: { status: "pending" } })),
      settle(getSupervisorInfo()),
      settle(
        prisma.factoryDeploy.findFirst({
          where: { ok: true },
          orderBy: { finishedAt: "desc" },
          select: { commit: true, finishedAt: true },
        }),
      ),
      readLimits(now),
    ]);
  const lastSeen = last?.lastUsedAt?.getTime() ?? null;

  return {
    asOf: now,
    supervisor:
      running === null || approved === null || pending === null
        ? null
        : {
            online: lastSeen !== null && now - lastSeen < ONLINE_MS,
            lastSeenAt: lastSeen,
            running,
            waiting: approved + pending,
            commit: info?.commit ?? null,
          },
    build: deploy
      ? { commit: deploy.commit, at: deploy.finishedAt?.getTime() ?? null }
      : null,
    claude: limits.limits,
    codex: limits.codexLimits,
  };
}
