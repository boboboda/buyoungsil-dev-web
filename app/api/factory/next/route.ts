// app/api/factory/next/route.ts
// 내 PC 의 감독 프로그램이 일감을 가져가는 주소.
//
// 요청: GET /api/factory/next?worker=mainpc&slots=2, 헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>
// 응답: { "jobs": [ { id, appSlug, title, kind, parentJobId, stack, priority, requiredSecrets, planMarkdown, attempts } ] }
//   통제실에서 정지 상태면 { "jobs": [], "paused": true } 를 돌려주고 아무것도 가져가지 않는다.
//   모든 응답에 autoUpdate(true/false)가 들어간다. false 면 감독 프로그램은 자동 업데이트를 하지 않는다.
//   감독 프로그램은 commit(현재 커밋)·note(최근 업데이트 소식)·subject(현재 커밋 메시지 첫 줄)를 함께 보낸다(모두 선택).
//   통제실·커넥터에서 "지금 업데이트"를 누르면 다음 응답 한 번에 updateNow: true 가 붙는다(받아 가면 지운다).
//   새 감독 프로그램은 started(시작 시각 ISO)·boot(restart|start)·ffmpeg·ffprobe("버전 | 경로" 또는 "없음")·restartWait(1)·restartFail(이유)도 보낸다.
//   [감독 재시작]을 누르면 다음 응답 한 번에 { jobs: [], restart: true } 가 간다(started 를 보내는 감독 프로그램에만. 받아 가면 지운다. 그 응답에는 일감·신호를 싣지 않는다).
//   재시작을 기다리는 감독 프로그램은 hold=1 을 붙인다: 일감·정비·1회성 신호를 하나도 넘기지 않고(유실 방지) { jobs: [], restartHold: true } 만 돌려준다.
//   각 job 에 rules(CLAUDE.md 작업 규칙 본문)·prompt(첫 지시문)가 붙는다(lib/factory/rules.ts, 통제실에서 고칠 수 있음).
//   감독 프로그램은 이 값이 없으면 자기 코드 안 기본값을 쓴다.
//   공장 정비: 대기열 맨 앞 지시가 승인돼 있으면 maintenance: { turnId, threadId, title, text, sessionId, deployBundling: true, queueLeft } 가 붙고
//   (진행 중인 게 없고 실패로 멈추지 않았을 때. 보낸 순서대로 하나씩),
//   사람이 [배포]를 눌렀으면 maintenanceDeploy: { threadId, commit } 이 붙는다. 정비가 대기·진행 중이면 새 앱 일감은 내주지 않는다(maintenanceHold: true).
//   배포 계정의 키 파일 경로가 등록돼 있으면 pcPaths: [{ key, path }] 가 붙는다. 감독 프로그램은 "있는지"만 확인해 /api/factory/pc-status 로 알린다.
//   통제실에서 키 비밀번호를 등록했고 아직 안 가져갔으면 keyPasswordsPending: true(값은 /api/factory/key-passwords 에서 따로).
//   통제실 [키 점검]을 누르면 다음 응답 한 번에 keyScan: true 가 붙는다(결과는 /api/factory/key-report).
//   출시 카드 [키 조회](앱 하나)면 keyScan: true 와 keyScanApps: [appSlug] 가 함께 붙는다(감독 프로그램은 그 앱만 점검. 예전 감독 프로그램은 전체 점검).
//   통제실 '업로드 시험'을 누르면 uploadTest: { id, kind: video|image|big } 가 한 번 붙는다(결과는 /api/factory/upload-test-report).
//   키 보관함 일(공용 키 만들기·키 파일 조회)이 있으면 keyTasks: [{ id, op: create|check, path, alias, dname, storeName, keyName }] 가 붙는다
//   (비밀번호는 이름만. 결과는 /api/factory/key-vault).
//   출시 일감(kind=release)에는 release: { kind, stages, outbox, resumeFrom, resumeNote, key } 가 붙는다(lib/factory/release.ts releaseJobExtras).
//   만료된 running 을 먼저 정리하고, approved 중 우선순위 높은 순으로 최대 slots 개를 running 으로 바꿔 돌려준다.
import { NextRequest, NextResponse } from "next/server";

import { claimJobs, MAX_SLOTS, releaseExpiredLeases, WORKER_RE } from "@/lib/factory/jobs";
import { fail, guardWorker } from "@/lib/factory/http";
import { consumeKeyScan, notifyTestingDue, pcPathsToCheck, releaseJobExtras } from "@/lib/factory/release";
import { keyPasswordsPending } from "@/lib/factory/keyPasswords";
import { keyTasksForNext } from "@/lib/factory/keyVault";
import { sweepReviewVideos } from "@/lib/factory/reviewVideo";
import { consumeUploadTest } from "@/lib/factory/uploadTest";
import { maintenanceForNext, maintenanceHold } from "@/lib/factory/maintenance";
import { getRuleOverrides, renderRules } from "@/lib/factory/rules";
import { consumeRestart, consumeUpdateNow, isAutoUpdateEnabled, isSupervisorEnabled, saveSupervisorInfo } from "@/lib/factory/settings";
import { noteSupervisorRuntime } from "@/lib/factory/supervisor";
import { workerEngines } from "@/lib/factory/ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const worker = req.nextUrl.searchParams.get("worker") ?? "";
  if (!WORKER_RE.test(worker)) return fail(400, "worker 이름이 올바르지 않습니다.");

  const slotsRaw = Number(req.nextUrl.searchParams.get("slots") ?? "1");
  const engines = workerEngines(req.nextUrl.searchParams.get("aiEngines"));
  const slots = Number.isFinite(slotsRaw) ? Math.min(MAX_SLOTS, Math.max(0, Math.floor(slotsRaw))) : 1; // 0 = 일감은 받지 않고 신호만(감독 프로그램이 정비 중)

  // 감독 프로그램이 알려 주는 현재 커밋·최근 업데이트 소식(선택). 형식이 이상하면 무시한다.
  const commitRaw = req.nextUrl.searchParams.get("commit") ?? "";
  const noteRaw = (req.nextUrl.searchParams.get("note") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 150);
  const commit = /^[0-9a-f]{7,40}$/.test(commitRaw) ? commitRaw : "";
  const subject = (req.nextUrl.searchParams.get("subject") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 150);
  // 실행 정보(새 감독 프로그램만)
  const param = (k: string, max: number) => (req.nextUrl.searchParams.get(k) ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
  const startedRaw = param("started", 40);
  const started = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(startedRaw) ? startedRaw : "";
  const hold = req.nextUrl.searchParams.get("hold") === "1";

  try {
    if (commit) await saveSupervisorInfo(commit, noteRaw, subject).catch(() => undefined);

    // 재시작 요청은 재시작을 할 줄 아는(started 를 보내는) 감독 프로그램에만, 기다리는 중이 아닐 때 넘긴다
    const restart = started && !hold ? await consumeRestart().catch(() => false) : false;

    if (started) {
      await noteSupervisorRuntime(
        {
          startedAt: started,
          boot: param("boot", 20) === "restart" ? "restart" : "start",
          ffmpeg: param("ffmpeg", 300) || undefined,
          ffprobe: param("ffprobe", 300) || undefined,
          restartWait: hold || undefined,
          restartFail: param("restartFail", 300) || undefined,
        },
        restart,
      ).catch(() => undefined);
    }
    if (hold || restart) {
      // 재시작을 넘기는 응답과 재시작 대기 중에는 다른 것을 넘기지 않는다(일감·정비·1회성 신호는 다시 켜진 뒤 받아 간다)
      return NextResponse.json({ jobs: [], ...(restart ? { restart: true } : { restartHold: true }), autoUpdate: await isAutoUpdateEnabled() });
    }

    // 통제실에서 "일시 정지" 하면 일감을 내주지 않는다. (인증은 이미 통과했으니 "연결됨" 표시는 계속 갱신된다)
    const [enabled, autoUpdate] = await Promise.all([isSupervisorEnabled(), isAutoUpdateEnabled()]);
    // 1회성 신호: 받아 가는 순간 지운다. 정지 중이어도 업데이트는 할 수 있게 같이 보낸다.
    const updateNow = await consumeUpdateNow().catch(() => false);
    const pcPaths = await pcPathsToCheck().catch(() => []);
    const maint = await maintenanceForNext(engines).catch(() => ({}));
    const keyPw = await keyPasswordsPending().catch(() => false);
    const keyScan = await consumeKeyScan().catch(() => false);
    const keyTasks = await keyTasksForNext();
    const uploadTest = await consumeUploadTest(); // 통제실 '업로드 시험'(한 번)
    void sweepReviewVideos(); // 7일 지난 검토 영상 정리(가끔)
    const extra = {
      ...(updateNow ? { updateNow: true } : {}),
      ...(pcPaths.length ? { pcPaths } : {}),
      ...(keyPw ? { keyPasswordsPending: true } : {}),
      ...(keyScan ? { keyScan: true } : {}),
      ...(Array.isArray(keyScan) ? { keyScanApps: keyScan } : {}),
      ...(keyTasks.length ? { keyTasks } : {}),
      ...(uploadTest ? { uploadTest } : {}),
      ...maint,
    };

    void notifyTestingDue(); // 비공개 테스트 완료 예정일 알림(10분에 한 번만 확인, 기다리지 않음)

    if (!enabled) {
      return NextResponse.json({ jobs: [], paused: true, autoUpdate, ...extra });
    }

    await releaseExpiredLeases();
    // 공장 정비가 대기·진행 중이면 새 앱 일감은 내주지 않는다(진행 중인 앱 일감은 끝까지)
    if (await maintenanceHold().catch(() => false)) {
      return NextResponse.json({ jobs: [], maintenanceHold: true, autoUpdate, ...extra });
    }
    const claimed = slots > 0 ? await claimJobs(worker, slots, engines) : [];
    // 일감마다 작업 규칙·첫 지시문을 붙인다. 못 만들면 붙이지 않는다(감독 프로그램이 기본값을 씀)
    const overrides = claimed.length ? await getRuleOverrides().catch(() => ({})) : {};
    const releases = await releaseJobExtras(claimed).catch(() => new Map<string, Record<string, unknown>>());
    const jobs = claimed.map((j) => {
      const release = releases.get(j.id);

      try {
        return { ...j, ...renderRules(j, overrides), ...(release ? { release } : {}) };
      } catch {
        return { ...j, ...(release ? { release } : {}) };
      }
    });

    return NextResponse.json({ jobs, autoUpdate, ...extra });
  } catch (error) {
    console.error("[factory] next 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
