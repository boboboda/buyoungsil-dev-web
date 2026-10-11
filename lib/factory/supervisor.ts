// lib/factory/supervisor.ts
// 감독 프로그램(내 PC) 상태 보기와 제어. 통제실(app/api/admin/factory/control)과 커넥터 도구(supervisor_control)가 같이 쓴다.
// 홈페이지는 PC 의 프로그램을 직접 켜거나 코드를 보낼 수 없다. 정해진 신호(정지/재개, 자동 업데이트 켜고 끄기, 지금 업데이트)만 남기고,
// 감독 프로그램이 /api/factory/next 를 확인할 때 가져간다.
import prisma from "@/lib/prisma";
import {
  getPendingUpdateNow,
  getSupervisorInfo,
  isAutoUpdateEnabled,
  isSupervisorEnabled,
  requestUpdateNow,
  setAutoUpdateEnabled,
  setSupervisorEnabled,
} from "@/lib/factory/settings";

const ONLINE_MS = 90_000;

// 허용하는 명령은 이 목록뿐이다.
export const SUPERVISOR_ACTIONS = ["status", "update_now", "pause", "resume", "auto_update_on", "auto_update_off"] as const;
export type SupervisorAction = (typeof SUPERVISOR_ACTIONS)[number];

export async function supervisorSnapshot() {
  const [enabled, autoUpdate, info, updateNowRequestedAt, last, running, approved, pending] = await Promise.all([
    isSupervisorEnabled(),
    isAutoUpdateEnabled(),
    getSupervisorInfo(),
    getPendingUpdateNow(),
    prisma.factoryWorkerToken.findFirst({
      where: { lastUsedAt: { not: null } },
      orderBy: { lastUsedAt: "desc" },
      select: { name: true, lastUsedAt: true },
    }),
    prisma.factoryJob.count({ where: { status: "running" } }),
    prisma.factoryJob.count({ where: { status: "approved" } }),
    prisma.factoryJob.count({ where: { status: "pending" } }),
  ]);
  const lastSeen = last?.lastUsedAt ?? null;

  return {
    enabled,
    autoUpdate,
    commit: info?.commit ?? null,
    updateNote: info?.note ?? null,
    updateNoteAt: info?.at ?? null,
    // 아직 감독 프로그램이 받아 가지 않은 "지금 업데이트" 요청 시각
    updateNowRequestedAt,
    online: !!lastSeen && Date.now() - lastSeen.getTime() < ONLINE_MS,
    lastSeenAt: lastSeen,
    workerName: last?.name ?? null,
    running,
    approved,
    pending,
  };
}

export type SupervisorSnapshot = Awaited<ReturnType<typeof supervisorSnapshot>>;

/** 정해진 명령 하나를 실행하고 안내 문구와 현재 상태를 돌려준다. */
export async function runSupervisorAction(action: SupervisorAction): Promise<{ message: string; snapshot: SupervisorSnapshot }> {
  let message = "";

  switch (action) {
    case "status":
      break;
    case "update_now":
      await requestUpdateNow();
      message =
        "지금 업데이트를 요청했어요. 감독 프로그램이 다음 확인(15초 안) 때 받아 가서, 돌고 있는 일감이 없으면 바로 새 버전을 확인해요. " +
        "새 버전이면 30초쯤 뒤 다시 켜지니 잠시 뒤 status 로 commit 과 updateNote 를 확인하세요.";
      break;
    case "pause":
      await setSupervisorEnabled(false);
      message = "일시 정지했어요. 진행 중인 작업은 끝까지 하고, 새 일감은 가져가지 않아요.";
      break;
    case "resume":
      await setSupervisorEnabled(true);
      message = "다시 켰어요. 감독 프로그램이 다음 확인 때부터 일감을 가져가요.";
      break;
    case "auto_update_on":
      await setAutoUpdateEnabled(true);
      message = "자동 업데이트를 켰어요. 다음 확인 때부터 적용돼요.";
      break;
    case "auto_update_off":
      await setAutoUpdateEnabled(false);
      message = "자동 업데이트를 껐어요. PC 프로그램은 지금 코드 그대로 실행돼요. (지금 업데이트 요청은 여전히 할 수 있어요)";
      break;
  }

  return { message, snapshot: await supervisorSnapshot() };
}
