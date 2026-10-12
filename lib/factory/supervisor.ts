// lib/factory/supervisor.ts
// 감독 프로그램(내 PC) 상태 보기와 제어. 통제실(app/api/admin/factory/control)과 커넥터 도구(supervisor_control)가 같이 쓴다.
// 홈페이지는 PC 의 프로그램을 직접 켜거나 코드를 보낼 수 없다. 정해진 신호(정지/재개, 자동 업데이트 켜고 끄기, 지금 업데이트, 재시작)만 남기고,
// 감독 프로그램이 /api/factory/next 를 확인할 때 가져간다.
import prisma from "@/lib/prisma";
import {
  getDefaultAiEngine,
  getPendingRestart,
  getPendingUpdateNow,
  getSupervisorInfo,
  getSupervisorRuntime,
  getToolBrokerSettings,
  isAutoDeployEnabled,
  isAutoUpdateEnabled,
  isSupervisorEnabled,
  requestRestart,
  requestUpdateNow,
  saveSupervisorRuntime,
  setAutoDeployEnabled,
  setAutoUpdateEnabled,
  setSupervisorEnabled,
  type SupervisorRuntime,
} from "@/lib/factory/settings";
import { notifyText } from "@/lib/factory/telegram";

const ONLINE_MS = 90_000;
// 재시작 요청을 받아 간 뒤 이만큼 응답이 없고 새로 켜지지도 않았으면 실패로 본다(실행기는 30초 뒤 다시 띄운다)
const RESTART_FAIL_MS = 3 * 60_000;

// 허용하는 명령은 이 목록뿐이다.
export const SUPERVISOR_ACTIONS = ["status", "update_now", "restart", "pause", "resume", "auto_update_on", "auto_update_off", "auto_deploy_on", "auto_deploy_off"] as const;
export type SupervisorAction = (typeof SUPERVISOR_ACTIONS)[number];

export async function supervisorSnapshot() {
  const [enabled, autoUpdate, autoDeploy, info, updateNowRequestedAt, restartRequestedAt, rt, last, running, approved, pending, defaultAiEngine, toolBroker] = await Promise.all([
    isSupervisorEnabled(),
    isAutoUpdateEnabled(),
    isAutoDeployEnabled(),
    getSupervisorInfo(),
    getPendingUpdateNow(),
    getPendingRestart(),
    getSupervisorRuntime(),
    prisma.factoryWorkerToken.findFirst({
      where: { lastUsedAt: { not: null } },
      orderBy: { lastUsedAt: "desc" },
      select: { name: true, lastUsedAt: true },
    }),
    prisma.factoryJob.count({ where: { status: "running" } }),
    prisma.factoryJob.count({ where: { status: "approved" } }),
    prisma.factoryJob.count({ where: { status: "pending" } }),
    getDefaultAiEngine(),
    getToolBrokerSettings(),
  ]);
  const lastSeen = last?.lastUsedAt ?? null;
  const restart = await restartStatus(rt, restartRequestedAt, lastSeen);

  return {
    defaultAiEngine,
    toolBroker, // 도구 요청 중계 설정(모드·상한)
    enabled,
    autoUpdate,
    autoDeploy, // 정비 대기열이 모두 끝나면 자동 배포(기본 꺼짐)
    commit: info?.commit ?? null,
    commitSubject: info?.subject ?? null, // 현재 커밋 메시지 첫 줄(무엇이 바뀌었는지)
    updateNote: info?.note ?? null,
    updateNoteAt: info?.at ?? null,
    // 아직 감독 프로그램이 받아 가지 않은 "지금 업데이트" 요청 시각
    updateNowRequestedAt,
    // 감독 프로그램 실행 정보(새 감독 프로그램만 알려 준다)
    startedAt: rt.startedAt ?? null,
    restartedBoot: rt.boot === "restart", // 지금 프로세스가 재시작 요청으로 다시 켜진 것인지
    ffmpeg: rt.ffmpeg ?? null, // "버전 | 경로" 또는 "없음"
    ffprobe: rt.ffprobe ?? null,
    restartRequestedAt, // 아직 PC 가 받아 가지 않은 재시작 요청
    restartState: restart.state, // null | requested | waiting | restarting | failed
    restartNote: restart.note,
    online: !!lastSeen && Date.now() - lastSeen.getTime() < ONLINE_MS,
    lastSeenAt: lastSeen,
    workerName: last?.name ?? null,
    running,
    approved,
    pending,
  };
}

// 재시작 진행 상황. PC 가 꺼진 채 다시 안 켜지는 경우는 PC 가 알릴 수 없으니 여기서(상태를 볼 때) 판단하고 텔레그램으로 한 번 알린다.
async function restartStatus(rt: SupervisorRuntime, requestedAt: string | null, lastSeen: Date | null) {
  if (requestedAt) return { state: "requested", note: "재시작 요청됨(PC가 15초 안에 받아 가요)" };
  if (rt.restartFail) return { state: "failed", note: `재시작 실패: ${rt.restartFail}` };
  if (rt.restartTakenAt) {
    const taken = new Date(rt.restartTakenAt).getTime();
    const silent = !lastSeen || Date.now() - lastSeen.getTime() > RESTART_FAIL_MS;

    if (silent && Date.now() - taken > RESTART_FAIL_MS) {
      const reason = "재시작하려고 껐는데 3분 넘게 다시 켜지지 않았어요. PC 의 실행기(run-supervisor.sh)·작업 스케줄러(AppFactorySupervisor)를 확인하세요.";

      if (rt.restartFailNotified !== reason) {
        await saveSupervisorRuntime({ ...rt, restartFailNotified: reason }, rt).catch(() => false);
        void notifyText(`🔄❌ 감독 프로그램 재시작 실패\n${reason}`, "/admin/factory");
      }

      return { state: "failed", note: `재시작 실패: ${reason}` };
    }
    if (rt.restartWait) return { state: "waiting", note: "재시작 대기: 진행 중인 작업이 끝나면 다시 켜져요(새 일감은 받지 않아요)" };

    return { state: "restarting", note: "재시작 중: 껐다가 30초쯤 뒤 다시 켜져요" };
  }

  return { state: null, note: rt.boot === "restart" && rt.restartedAt ? `재시작됨 (${new Date(rt.restartedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })})` : null };
}

/** /next 에서 부른다. 감독 프로그램이 알려 준 실행 정보를 저장하고, 재시작이 끝났거나 실패했으면 텔레그램으로 알린다.
 *  tookRestart: 이번 응답으로 재시작 요청을 넘겨줬는지. */
export async function noteSupervisorRuntime(
  pc: Pick<SupervisorRuntime, "startedAt" | "boot" | "ffmpeg" | "ffprobe" | "restartWait" | "restartFail">,
  tookRestart: boolean,
): Promise<void> {
  const cur = await getSupervisorRuntime();
  const next: SupervisorRuntime = { ...cur, ...pc };
  const notes: string[] = [];

  if (tookRestart) {
    next.restartTakenAt = new Date().toISOString();
    delete next.restartFail;
    delete next.restartFailNotified;
  }
  // 재시작 요청을 받아 간 뒤 새로 켜졌다 → 재시작 끝
  if (next.restartTakenAt && pc.startedAt && pc.startedAt > next.restartTakenAt) {
    next.restartedAt = pc.startedAt;
    delete next.restartTakenAt;
    delete next.restartFailNotified;
    notes.push(`🔄 감독 프로그램을 다시 켰어요 (시작 ${new Date(pc.startedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })})\nffmpeg: ${pc.ffmpeg ?? "알 수 없음"}`);
  }
  // PC 가 재시작하지 못한 이유를 알려 왔다(실행기 밖 등)
  if (pc.restartFail && pc.restartFail !== cur.restartFail) {
    delete next.restartTakenAt;
    next.restartFailNotified = pc.restartFail;
    notes.push(`🔄❌ 감독 프로그램 재시작 실패\n${pc.restartFail}`);
  }
  if (await saveSupervisorRuntime(next, cur)) for (const n of notes) void notifyText(n, "/admin/factory");
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
    case "restart":
      await requestRestart();
      message =
        "재시작을 요청했어요. 감독 프로그램이 다음 확인(15초 안) 때 받아 가서 새 일감 받기를 멈추고, 진행 중인 작업이 있으면 끝난 뒤 꺼졌다가 " +
        "실행기가 30초쯤 뒤 다시 켜요(윈도우 PATH 를 새로 읽어요). 1분쯤 뒤 status 의 startedAt·restartNote 로 확인하세요.";
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
    case "auto_deploy_on":
      await setAutoDeployEnabled(true);
      message = "정비 대기열이 모두 끝나면 자동 배포해요(지난 배포 뒤 실패한 지시가 있으면 하지 않아요). 결과는 통제실·텔레그램에 알려요.";
      break;
    case "auto_deploy_off":
      await setAutoDeployEnabled(false);
      message = "자동 배포를 껐어요. 정비 대기열이 끝나면 '배포 필요'만 알리고, 배포는 [배포]를 눌러야 해요.";
      break;
  }

  return { message, snapshot: await supervisorSnapshot() };
}
