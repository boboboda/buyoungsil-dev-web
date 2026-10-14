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
//   appSlots(1~4)·appSlotsDefault: 통제실 [설정]의 '동시에 만들 앱 수'. 정한 적 없으면 3 과 appSlotsDefault: true (감독 프로그램: slots 로 요청하는 수는 이 값에서 돌고 있는 일감 수를 뺀 만큼).
//   설정이 저장된 앱의 일감에는 projectToolSettings: { version, settings } 가 붙는다(프로젝트 도구 설정, lib/factory/projectToolSettingsDb.ts).
//   그림 저장소(lib/factory/arts.ts): 일감에 approvedArts: [{ url, subject, kind, approvedAt }](그 프로젝트의 승인 그림만, 최대 24), pickedArts: [{ url, subject, kind }](일감 보낼 때 '참고로 고르기' 한 승인 그림, 최대 4)가 붙을 수 있다.
//   toolBroker: { mode: off|report|allow, maxRequests, toolTimeoutSec } 가 붙는다(도구 요청 중계, 기본 꺼짐. 수치 null = 제한 없음. lib/factory/toolBroker.ts).
//   각 job 에 rules(CLAUDE.md 작업 규칙 본문)·prompt(첫 지시문)가 붙는다(lib/factory/rules.ts, 통제실에서 고칠 수 있음).
//   감독 프로그램은 이 값이 없으면 자기 코드 안 기본값을 쓴다.
//   공장 정비: 대기열 맨 앞 지시가 승인돼 있으면 maintenance: { turnId, threadId, title, text, sessionId, deployBundling: true, queueLeft } 가 붙고
//   (진행 중인 게 없고 실패로 멈추지 않았을 때. 보낸 순서대로 하나씩),
//   사람이 [배포]를 눌렀으면 maintenanceDeploy: { threadId, commit } 이 붙는다.
//   정비가 대기·진행 중이어도 앱·실험 일감은 계속 내준다(병렬화 단계 A). 일감을 멈추는 건 감독 프로그램이 스스로 slots=0 으로 요청할 때뿐이다
//   (감독 프로그램 업데이트·서버 배포를 진행 중 일감이 끝나길 기다리는 동안 = 드레인). 그때 drain=update|deploy 와 drainJobs(끝나길 기다리는 일감 수)를 함께 보낸다(통제실 표시용).
//   배포 계정의 키 파일 경로가 등록돼 있으면 pcPaths: [{ key, path }] 가 붙는다. 감독 프로그램은 "있는지"만 확인해 /api/factory/pc-status 로 알린다.
//   통제실에서 키 비밀번호를 등록했고 아직 안 가져갔으면 keyPasswordsPending: true(값은 /api/factory/key-passwords 에서 따로).
//   통제실에서 외부 서비스 키를 등록·삭제했고 PC 가 아직 반영하지 않았으면 secretsPending: true(할 일은 /api/factory/secrets 에서 따로).
//   새 감독 프로그램은 1시간에 한 번 claudeTool·codexTool("버전 · 로그인 상태" 또는 "없음")과 aiToolsAt 을 보낸다(통제실 AI 도구 상태).
//   통제실 [키 점검]을 누르면 다음 응답 한 번에 keyScan: true 가 붙는다(결과는 /api/factory/key-report).
//   출시 카드 [키 조회](앱 하나)면 keyScan: true 와 keyScanApps: [appSlug] 가 함께 붙는다(감독 프로그램은 그 앱만 점검. 예전 감독 프로그램은 전체 점검).
//   통제실 '업로드 시험'을 누르면 uploadTest: { id, kind: video|image|big } 가 한 번 붙는다(결과는 /api/factory/upload-test-report).
//   키 보관함 일(공용 키 만들기·키 파일 조회)이 있으면 keyTasks: [{ id, op: create|check, path, alias, dname, storeName, keyName }] 가 붙는다
//   (비밀번호는 이름만. 결과는 /api/factory/key-vault).
//   실험 일감(kind=lab, appSlug=lab)은 앱 폴더가 아니라 lab<id> 에서 돈다(rules·prompt 없음). 통제실 [폴더 지우기]가 눌렸으면 labCleanup: [jobId, ...] 가 붙는다
//   (감독 프로그램이 해당 lab<id> 만 지우고 /api/factory/lab 으로 알린다. shared 는 지우지 않는다).
//   출시 일감(kind=release)에는 release: { kind, stages, outbox, resumeFrom, resumeNote, key } 가 붙는다(lib/factory/release.ts releaseJobExtras).
//   병행 실행(단계 C-1): 각 job 에 parallelGroup(문자열 또는 null)이 붙는다. 수정(revision) 일감이 그룹을 가지면 감독 프로그램은 앱 폴더가 아니라 git worktree 에서 실행하고
//   끝난 순서대로 기본 브랜치에 합친다. 같은 앱·같은 그룹의 승인된 수정 일감은 설정 '같은 앱에서 같이 돌릴 수'(parallelPerApp, 기본 2)개까지 같이 내준다. 그룹이 없으면 앱당 1개.
//   지휘자(단계 C-2): 감독 프로그램이 conductor=1(지금 판단을 맡을 수 있음) 또는 conductor=busy(판단 중)를 보내면, 같은 앱의 승인된 수정 일감이 그룹 없이 2개 이상일 때 응답에
//   conductor: { appSlug, key, model, perApp, sharedFiles, jobs: [{ id, title, priority, instruction }] } 가 한 번 붙는다(공장 전체 동시에 1개). 결과는 POST /api/factory/conductor.
//   판단 결과를 기다리는 동안(최대 5분) 그 앱의 승인된 일감은 가져가지 않는다. conductor 를 보내지 않는 감독 프로그램에는 아무 영향이 없다.
//   앱별 검사 명령: 통제실에서 그 앱에 검사 명령을 정했으면(lib/factory/appChecks.ts) 일감에 checkCommands: ["python -m unittest discover -s tests -q", ...] 가 붙는다. 감독 프로그램은 합치기·최종 점검 때 stack 기본 검사 뒤에 더 돌린다(없으면 기본만).
//   묶음 중 일부만 승인된 상태(같은 묶음에 승인 대기 일감이 남음)면 그 묶음의 승인된 일감은 가져가지 않는다. 모두 승인되면 같이 내준다.
//   승인 직후 대기: 같은 앱에 승인 대기 수정 일감이 또 있으면 방금 승인된(묶이지 않은) 수정 일감을 마지막 승인 뒤 approvalWaitSec 초(기본 60, 0~300, 0=기다리지 않음) 동안 가져가지 않는다(conductor 를 보내는 감독 프로그램만).
//   만료된 running 을 먼저 정리하고, approved 중 우선순위 높은 순으로 최대 slots 개를 running 으로 바꿔 돌려준다.
import { NextRequest, NextResponse } from "next/server";

import { appsToHold, appsWaitingForApproval, conductorTaskForNext, isAutoGroupEnabled } from "@/lib/factory/conductor";
import { claimJobs, MAX_SLOTS, releaseExpiredLeases, WORKER_RE } from "@/lib/factory/jobs";
import { fail, guardWorker } from "@/lib/factory/http";
import prisma from "@/lib/prisma";
import { consumeKeyScan, notifyTestingDue, pcPathsToCheck, releaseJobExtras } from "@/lib/factory/release";
import { keyPasswordsPending } from "@/lib/factory/keyPasswords";
import { provisionPending } from "@/lib/factory/keyProvision";
import { secretEntriesPending } from "@/lib/factory/secretEntries";
import { keyTasksForNext } from "@/lib/factory/keyVault";
import { sweepReviewVideos } from "@/lib/factory/reviewVideo";
import { consumeUploadTest } from "@/lib/factory/uploadTest";
import { maintenanceForNext } from "@/lib/factory/maintenance";
import { getRuleOverrides, renderRules } from "@/lib/factory/rules";
import { consumeRestart, consumeUpdateNow, getAppSlots, getApprovalWaitSec, getDefaultAiEngine, getParallelPerApp, getToolBrokerSettings, getUpdateBundleMin, isAutoUpdateEnabled, isCompactAfterJobEnabled, isSupervisorEnabled, saveSupervisorInfo } from "@/lib/factory/settings";
import { noteSupervisorRuntime } from "@/lib/factory/supervisor";
import { workerEngines } from "@/lib/factory/ai";
import { toolBrokerForSupervisor } from "@/lib/factory/toolBroker";
import { labCleanupForNext, LAB_KIND } from "@/lib/factory/lab";
import { getAppChecks } from "@/lib/factory/appChecks";
import { projectSettingsForNext, type SettingsDb } from "@/lib/factory/projectToolSettingsDb";
import { approvedForNext, pickedForJobs, type ArtDb, type PickDb } from "@/lib/factory/arts";

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
  // 드레인(업데이트·배포를 진행 중 일감이 끝나길 기다리는 중, 새 일감은 받지 않음). 표시용이라 모양이 이상하면 무시한다
  const drainRaw = param("drain", 10);
  const drain = drainRaw === "update" || drainRaw === "deploy" ? drainRaw : undefined;
  // 재전송 대기열(배포 중 홈페이지가 응답하지 않는 동안 쌓인 보고 수)·배포 진행 여부. 표시용
  const outboxRaw = Math.floor(Number(param("outbox", 6)));
  const outbox = Number.isFinite(outboxRaw) && outboxRaw > 0 ? Math.min(9999, outboxRaw) : undefined;
  const deployingPc = param("deploying", 1) === "1" ? true : undefined;
  const drainJobs = drain ? Math.min(99, Math.max(0, Math.floor(Number(param("drainJobs", 4))) || 0)) : undefined;
  // 감독 프로그램 업데이트(1-2 D-2): 업데이트로 일시 중지된 일감 수, 새 커밋을 모으는 중(묶기)이면 남은 분. 표시용
  const pausedRaw = Math.floor(Number(param("pausedJobs", 4)));
  const pausedJobs = Number.isFinite(pausedRaw) && pausedRaw > 0 ? Math.min(99, pausedRaw) : undefined;
  const bundleRaw = Math.floor(Number(param("bundleLeft", 5)));
  const bundleLeft = Number.isFinite(bundleRaw) && bundleRaw > 0 ? Math.min(180, bundleRaw) : undefined;
  // AI 도구 상태(읽기 전용). PC 가 확인한 때만 온다
  const aiToolsAtRaw = param("aiToolsAt", 40);
  const aiTools = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(aiToolsAtRaw)
    ? { claudeTool: param("claudeTool", 120) || "확인 안 함", codexTool: param("codexTool", 120) || "확인 안 함", aiToolsAt: aiToolsAtRaw }
    : {};

  // 작업 메모리 상태(폴더|시각|KB|푸시|정리필요 ; ...). 모양이 맞는 줄만 받는다
  const memoryRows = param("memory", 600)
    .split(";")
    .filter((row) => /^[A-Za-z0-9_.-]{1,40}\|\d{4}-\d{2}-\d{2}T[\d:.]+Z\|\d{1,6}\|(?:ok|failed|none|blocked)\|[01]$/.test(row))
    .slice(0, 12);
  const memory = memoryRows.length ? memoryRows.join(";") : "";

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
          ...aiTools,
          ...(memory ? { memory } : {}),
          restartWait: hold || undefined,
          drain,
          drainJobs,
          outbox,
          deployingPc,
          pausedJobs,
          bundleLeft,
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
    const [enabled, autoUpdate, defaultAiEngine, toolBroker, compactAfterJob, appSlotsSetting] = await Promise.all([isSupervisorEnabled(), isAutoUpdateEnabled(), getDefaultAiEngine(), getToolBrokerSettings().catch(() => undefined), isCompactAfterJobEnabled().catch(() => true), getAppSlots().catch(() => null)]);
    // 1회성 신호: 받아 가는 순간 지운다. 정지 중이어도 업데이트는 할 수 있게 같이 보낸다.
    const updateNow = await consumeUpdateNow().catch(() => false);
    const pcPaths = await pcPathsToCheck().catch(() => []);
    const maint = await maintenanceForNext(engines).catch(() => ({}));
    const keyPw = await keyPasswordsPending().catch(() => false);
    const secretsPending = (await secretEntriesPending().catch(() => false)) || (await provisionPending().catch(() => false)); // 키 값 전달 또는 서버 반영 대기
    const keyScan = await consumeKeyScan().catch(() => false);
    const keyTasks = await keyTasksForNext();
    const labCleanup = await labCleanupForNext().catch(() => []);
    const uploadTest = await consumeUploadTest(); // 통제실 '업로드 시험'(한 번)
    void sweepReviewVideos(); // 7일 지난 검토 영상 정리(가끔)
    const updateBundleMin = (await Promise.resolve().then(() => getUpdateBundleMin()).catch(() => null))?.value;
    const extra = {
      defaultAiEngine,
      ...(updateBundleMin === undefined ? {} : { updateBundleMin }), // 감독 프로그램 업데이트 때 새 커밋을 모으는 시간(분, 0~180, 0 = 바로 받음)
      compactAfterJob, // 작업 후 컨텍스트 정리(/compact). false 면 감독 프로그램이 하지 않는다
      // 동시에 만들 앱 수(1~4). appSlotsDefault: true 면 통제실에서 정한 적 없는 기본값(PC 에 따로 정한 값이 있으면 감독 프로그램이 그걸 쓴다)
      ...(appSlotsSetting ? { appSlots: appSlotsSetting.value, appSlotsDefault: appSlotsSetting.isDefault } : {}),
      ...(toolBroker ? { toolBroker: toolBrokerForSupervisor(toolBroker) } : {}), // 도구 요청 중계 설정(없으면 감독 프로그램은 꺼짐으로 본다)
      ...(updateNow ? { updateNow: true } : {}),
      ...(pcPaths.length ? { pcPaths } : {}),
      ...(keyPw ? { keyPasswordsPending: true } : {}),
      ...(secretsPending ? { secretsPending: true } : {}),
      ...(keyScan ? { keyScan: true } : {}),
      ...(Array.isArray(keyScan) ? { keyScanApps: keyScan } : {}),
      ...(keyTasks.length ? { keyTasks } : {}),
      ...(uploadTest ? { uploadTest } : {}),
      ...(labCleanup.length ? { labCleanup } : {}),
      ...maint,
    };

    void notifyTestingDue(); // 비공개 테스트 완료 예정일 알림(10분에 한 번만 확인, 기다리지 않음)

    if (!enabled) {
      return NextResponse.json({ jobs: [], paused: true, autoUpdate, ...extra });
    }

    await releaseExpiredLeases();
    // 공장 정비가 대기·진행 중이어도 일감은 내준다(정비는 정비 전용 폴더에서 돌아 앱 폴더와 겹치지 않는다).
    // 감독 프로그램이 업데이트·배포를 기다리는 동안에는 스스로 slots=0 으로 요청한다.
    // 같은 앱에서 병행 그룹 일감을 같이 가져갈 수(설정, 기본 2). 그룹이 없는 일감은 예전처럼 앱당 1개
    const perApp = (await getParallelPerApp().catch(() => null))?.value;
    // 지휘자(C-2): 감독 프로그램이 conductor=1|busy 를 보낼 때만(지휘자를 쓸 줄 알 때). 판단을 기다리는 앱은 잠깐 가져가지 않고, 판단할 일이 있으면 conductor 로 내준다
    const conductorParam = param("conductor", 8);
    const capable = conductorParam === "1" || conductorParam === "busy";
    const cs = { autoGroup: await isAutoGroupEnabled().catch(() => false), perApp: perApp ?? 2, appSlots: appSlotsSetting?.value ?? 3 };
    const holdApps = await appsToHold(cs, capable).catch(() => new Set<string>());
    // 승인 직후 혼자 가져가기 막기: 같은 앱에 승인 대기 수정 일감이 또 있으면 마지막 승인 뒤 잠깐(설정 approvalWaitSec, 기본 60초) 기다린다. 0이면 기다리지 않는다
    const approvalWaitSec = (await getApprovalWaitSec().catch(() => null))?.value ?? 0;
    for (const slug of (await appsWaitingForApproval(cs, capable, approvalWaitSec).catch(() => new Map<string, number>())).keys()) holdApps.add(slug);
    const claimed = slots > 0 ? await claimJobs(worker, slots, engines, { ...(perApp === undefined ? {} : { perApp }), holdApps }) : [];
    const conductor = conductorParam === "1" && !drain ? await conductorTaskForNext(cs).catch(() => null) : null;
    // 일감마다 작업 규칙·첫 지시문을 붙인다. 못 만들면 붙이지 않는다(감독 프로그램이 기본값을 씀)
    const overrides = claimed.length ? await getRuleOverrides().catch(() => ({})) : {};
    const releases = await releaseJobExtras(claimed).catch(() => new Map<string, Record<string, unknown>>());
    // 프로젝트 도구 설정(pixel-art settings): 설정이 있는 앱의 일감에만 projectToolSettings: { version, settings } 를 붙인다(감독 프로그램이 .factory/project-settings.json 으로 내려 줌)
    const toolSettings = await projectSettingsForNext(prisma as unknown as SettingsDb, claimed.filter((j) => j.kind !== LAB_KIND).map((j) => j.appSlug)).catch(() => new Map<string, { version: number; settings: Record<string, unknown> }>());
    // 도트 그림 저장소: 그 프로젝트의 '승인' 그림 목록(approvedArts)과 이 일감에서 '참고로 고른' 그림(pickedArts). 후보·반려는 절대 싣지 않는다. 못 읽으면 붙이지 않는다(일감은 그대로)
    const artJobs = claimed.filter((j) => j.kind !== LAB_KIND);
    const approvedArts = await approvedForNext(prisma as unknown as ArtDb, artJobs.map((j) => j.appSlug)).catch(() => new Map());
    const pickedArts = await pickedForJobs(prisma as unknown as PickDb & ArtDb, artJobs).catch(() => new Map());
    // 앱별 합치기·최종 점검 검사 명령(통제실 설정). 있는 앱의 일감에만 checkCommands 를 붙인다(비면 stack 기본 검사만)
    const appChecks = claimed.length ? await getAppChecks().catch(() => ({} as Record<string, string[]>)) : {};
    const jobs = claimed.map((j) => {
      const release = releases.get(j.id);
      const projectToolSettings = toolSettings.get(j.appSlug);
      const checks = appChecks[j.appSlug]?.length ? { checkCommands: appChecks[j.appSlug] } : {};
      const arts = { ...checks, ...(approvedArts.has(j.appSlug) ? { approvedArts: approvedArts.get(j.appSlug) } : {}), ...(pickedArts.has(j.id) ? { pickedArts: pickedArts.get(j.id) } : {}) };

      if (j.kind === LAB_KIND) return j; // 실험은 앱 작업 규칙·첫 지시문을 붙이지 않는다(감독 프로그램이 머리말을 만든다)

      try {
        return { ...j, ...renderRules(j, overrides), ...(release ? { release } : {}), ...(projectToolSettings ? { projectToolSettings } : {}), ...arts };
      } catch {
        return { ...j, ...(release ? { release } : {}), ...(projectToolSettings ? { projectToolSettings } : {}), ...arts };
      }
    });

    return NextResponse.json({ jobs, autoUpdate, ...(conductor ? { conductor } : {}), ...extra });
  } catch (error) {
    console.error("[factory] next 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
