// lib/factory/deployWindow.ts
// 서버 배포 중에는 홈페이지가 3~5분 응답하지 않아 감독 프로그램의 보고가 끊긴다. "N분 보고 없음 → 실패" 판정에서
// 그 구간은 빼고 센다. 구간은 배포 기록(factory_deploys)의 startedAt~finishedAt 이다(deploy_start/deploy_done 때 이미 남는다).
// 끝이 안 찍힌 배포는 CAP 까지만 구간으로 본다(배포가 멈춘 채 판정이 영원히 미뤄지지 않게).
import prisma from "@/lib/prisma";

export const OPEN_DEPLOY_CAP_MS = 30 * 60 * 1000;

export interface DeployWindow {
  start: number;
  end: number;
}

/** from~to 구간 중 배포 구간과 겹치는 시간(ms). 구간끼리 겹쳐도 한 번만 센다. */
export function deployOverlapMs(windows: readonly DeployWindow[], from: number, to: number): number {
  if (to <= from) return 0;
  const clipped = windows
    .map((w) => ({ start: Math.max(w.start, from), end: Math.min(w.end, to) }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let cursor = from;

  for (const w of clipped) {
    const start = Math.max(w.start, cursor);

    if (w.end > start) {
      total += w.end - start;
      cursor = w.end;
    }
  }

  return total;
}

/** 마지막 보고(lastAt) 이후 지금까지 "배포가 아닌 시간"(ms). 판정은 이 값이 한도를 넘었는지로 한다. */
export function idleMsExcludingDeploy(windows: readonly DeployWindow[], lastAt: number, now: number): number {
  return Math.max(0, now - lastAt - deployOverlapMs(windows, lastAt, now));
}

/** since 이후에 겹칠 수 있는 배포 구간. DB 를 못 읽으면 빈 목록(예전 판정 그대로). */
export async function loadDeployWindows(since: Date, now = Date.now()): Promise<DeployWindow[]> {
  try {
    const rows = await prisma.factoryDeploy.findMany({
      where: { startedAt: { not: null }, OR: [{ finishedAt: null }, { finishedAt: { gt: since } }] },
      select: { startedAt: true, finishedAt: true },
    });

    return rows.flatMap((r) => {
      if (!r.startedAt) return [];
      const start = r.startedAt.getTime();
      const end = r.finishedAt ? r.finishedAt.getTime() : Math.min(now, start + OPEN_DEPLOY_CAP_MS);

      return end > start ? [{ start, end }] : [];
    });
  } catch {
    return [];
  }
}

/** 지금 배포 중인가(시작했고 끝이 없고 CAP 안). 통제실 표시용. */
export async function isDeployingNow(now = Date.now()): Promise<boolean> {
  try {
    const row = await prisma.factoryDeploy.findFirst({
      where: { startedAt: { gt: new Date(now - OPEN_DEPLOY_CAP_MS) }, finishedAt: null },
      select: { id: true },
    });

    return !!row;
  } catch {
    return false;
  }
}
