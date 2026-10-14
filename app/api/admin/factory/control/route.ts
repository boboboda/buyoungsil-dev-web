// app/api/admin/factory/control/route.ts
// 감독 프로그램 켜기/끄기(일시 정지), 자동 업데이트 켜고 끄기, 지금 업데이트, 재시작, 연결 상태. 관리자만.
// 홈페이지는 PC 의 프로그램을 직접 켤 수 없다. 정해진 신호만 남긴다(lib/factory/supervisor.ts).
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { CLAUDE_MODELS, isAiEngine, AI_LABELS, readModelChoice } from "@/lib/factory/ai";
import { applyAppChecksPatch, getAppChecks, saveAppChecks } from "@/lib/factory/appChecks";
import { cleanSharedPatterns, conductorSnapshot, setAutoGroupEnabled, setConductorModel, setSharedFiles } from "@/lib/factory/conductor";
import { cleanAppSlots, cleanApprovalWait, cleanPerApp, cleanUpdateBundle, MAX_APP_SLOTS, MAX_APPROVAL_WAIT, MAX_PER_APP, MAX_UPDATE_BUNDLE, MIN_APP_SLOTS, MIN_APPROVAL_WAIT, MIN_PER_APP, MIN_UPDATE_BUNDLE, setAppSlots, setApprovalWaitSec, setUpdateBundleMin, setParallelPerApp, setCompactAfterJobEnabled, setDefaultAiEngine, setDefaultClaudeModel, setToolBrokerSettings } from "@/lib/factory/settings";
import { allowedStudioToolIds, isPurpose, isToolId, PURPOSE_LABELS, readToolkitView, setToolPurpose, type Purpose } from "@/lib/factory/toolkit";
import { APP_ROLES_KEY, applyAppRolePatch, readAppRoles } from "@/lib/factory/appRoles";
import { applyStudioPatch, readStudioProjects, STUDIO_PROJECTS_KEY } from "@/lib/factory/studioProjects";
import prisma from "@/lib/prisma";
import { resolvePicked, savePicks, type ArtDb, type PickDb } from "@/lib/factory/arts";
import { createAdminStudioJob, STUDIO_REQUEST_SOURCE } from "@/lib/studio/requests";
import { isToolBrokerMode, TOOL_BROKER_MODE_LABELS, toolBrokerLimitLabel } from "@/lib/factory/toolBroker";
import { supervisorLog } from "@/lib/factory/supervisorLog";
import { runSupervisorAction, supervisorSnapshot, type SupervisorAction } from "@/lib/factory/supervisor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  // ?log=1 → [감독] 탭의 감독 로그(최신이 위). 새 주소를 만들지 않고 이 주소에 얹는다
  if (req.nextUrl.searchParams.get("log")) return NextResponse.json({ log: await supervisorLog() });

  return NextResponse.json(await supervisorSnapshot());
}

// 본문: { enabled: boolean } | { autoUpdate: boolean } | { autoDeploy: boolean } | { compactAfterJob: boolean } | { appSlots: 1~4 } | { updateNow: true } | { restart: true }
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    defaultAiEngine?: unknown;
    defaultClaudeModel?: unknown;
    toolBroker?: unknown;
    toolPurpose?: unknown;
    studioProject?: unknown;
    studioJob?: unknown;
    appRole?: unknown;
    enabled?: unknown;
    autoUpdate?: unknown;
    autoDeploy?: unknown;
    compactAfterJob?: unknown;
    appSlots?: unknown;
    parallelPerApp?: unknown;
    approvalWaitSec?: unknown;
    updateBundleMin?: unknown;
    appChecks?: unknown;
    conductorAutoGroup?: unknown;
    conductorModel?: unknown;
    conductorSharedFiles?: unknown;
    updateNow?: unknown;
    restart?: unknown;
  } | null;

  if (body && Object.hasOwn(body, "defaultAiEngine")) {
    if (!isAiEngine(body.defaultAiEngine)) return NextResponse.json({ message: "주사용 AI를 골라 주세요." }, { status: 400 });
    await setDefaultAiEngine(body.defaultAiEngine);
    return NextResponse.json({ ...(await supervisorSnapshot()), message: `주사용 AI를 ${AI_LABELS[body.defaultAiEngine]}로 저장했어요. 새 지시부터 적용돼요.` });
  }

  // 기본 모델(승인 때 '기본 설정 사용'이면 쓰는 Claude Code 모델): { defaultClaudeModel: 별칭 | null }. null·"default" = 지정 안 함(Claude Code 자체 기본)
  if (body && Object.hasOwn(body, "defaultClaudeModel")) {
    const model = readModelChoice(body.defaultClaudeModel);

    if (!model.ok) return NextResponse.json({ message: model.message }, { status: 400 });
    await setDefaultClaudeModel(model.model);

    return NextResponse.json({
      ...(await supervisorSnapshot()),
      message: model.model
        ? `기본 모델을 ${model.model}로 저장했어요. 승인 때 '기본 설정 사용'을 고른 Claude Code 일감이 시작할 때부터 적용돼요.`
        : "기본 모델을 지정하지 않았어요. '기본 설정 사용' 일감은 예전처럼 Claude Code 자체 기본 모델로 실행돼요.",
    });
  }

  // 작업 후 컨텍스트 정리(/compact): { compactAfterJob: boolean }
  if (body && Object.hasOwn(body, "compactAfterJob")) {
    if (typeof body.compactAfterJob !== "boolean") return NextResponse.json({ message: "compactAfterJob 은 true/false 여야 해요." }, { status: 400 });
    await setCompactAfterJobEnabled(body.compactAfterJob);

    return NextResponse.json({
      ...(await supervisorSnapshot()),
      message: body.compactAfterJob
        ? "작업 후 컨텍스트 정리를 켰어요. 감독 프로그램이 다음 확인 때 받아 가요."
        : "작업 후 컨텍스트 정리를 껐어요. 감독 프로그램이 다음 확인 때 받아 가요.",
    });
  }

  // 동시에 만들 앱 수: { appSlots: 1~4 정수 }. 범위 밖·정수 아님은 400(저장 안 함). 감독 프로그램이 다음 확인 때 받아 간다
  if (body && Object.hasOwn(body, "appSlots")) {
    const n = cleanAppSlots(body.appSlots);

    if (n === null || typeof body.appSlots === "string") {
      return NextResponse.json({ message: `동시에 만들 앱 수는 ${MIN_APP_SLOTS}~${MAX_APP_SLOTS} 사이 정수여야 해요.` }, { status: 400 });
    }
    await setAppSlots(n);

    return NextResponse.json({
      ...(await supervisorSnapshot()),
      message: `동시에 만들 앱 수를 ${n}개로 저장했어요. 감독 프로그램이 다음 확인 때 받아 가요. 줄여도 이미 도는 일감은 끊지 않고, 끝나면서 줄어들어요.`,
    });
  }

  // 같은 앱에서 같이 돌릴 수(병행 그룹 일감 기준): { parallelPerApp: 1~4 정수 }. 서버가 일감을 내줄 때 바로 쓴다(감독 프로그램 재시작 필요 없음)
  if (body && Object.hasOwn(body, "parallelPerApp")) {
    const n = cleanPerApp(body.parallelPerApp);

    if (n === null || typeof body.parallelPerApp === "string") {
      return NextResponse.json({ message: `같은 앱에서 같이 돌릴 수는 ${MIN_PER_APP}~${MAX_PER_APP} 사이 정수여야 해요.` }, { status: 400 });
    }
    await setParallelPerApp(n);

    return NextResponse.json({
      ...(await supervisorSnapshot()),
      message: `같은 앱에서 같이 돌릴 수를 ${n}개로 저장했어요. '같이 돌리기'로 묶은 수정 일감만 해당돼요. 이미 도는 일감은 끊지 않아요.`,
    });
  }

  // 승인 직후 다른 승인을 기다리는 시간(초): { approvalWaitSec: 0~300 정수 }. 0 = 기다리지 않음(예전과 같음). 서버가 일감을 내줄 때 바로 쓴다
  if (body && Object.hasOwn(body, "approvalWaitSec")) {
    const n = cleanApprovalWait(body.approvalWaitSec);

    if (n === null) return NextResponse.json({ message: `승인 직후 기다리는 시간은 ${MIN_APPROVAL_WAIT}~${MAX_APPROVAL_WAIT}초 사이 정수여야 해요.` }, { status: 400 });
    await setApprovalWaitSec(n);

    return NextResponse.json({
      ...(await supervisorSnapshot()),
      message: n === 0 ? "승인 직후 기다리지 않도록 저장했어요(승인하면 바로 시작해요)." : `승인 직후 ${n}초 동안 다른 승인을 기다리도록 저장했어요. 같은 앱에 승인 대기 수정 일감이 또 있을 때만 기다려요.`,
    });
  }

  // 감독 프로그램 업데이트 묶는 시간(분): { updateBundleMin: 0~180 정수 }. 0 = 묶지 않고 바로 받음. 일감이 돌고 있을 때만 모은다(공장이 비어 있으면 바로, 통제실 [지금 업데이트]는 기다리지 않음)
  if (body && Object.hasOwn(body, "updateBundleMin")) {
    const n = cleanUpdateBundle(body.updateBundleMin);

    if (n === null) return NextResponse.json({ message: `업데이트 묶는 시간은 ${MIN_UPDATE_BUNDLE}~${MAX_UPDATE_BUNDLE}분 사이 정수여야 해요.` }, { status: 400 });
    await setUpdateBundleMin(n);

    return NextResponse.json({
      ...(await supervisorSnapshot()),
      message: n === 0 ? "업데이트를 묶지 않고 바로 받도록 저장했어요(새 버전이 있으면 진행 중인 AI 를 잠깐 멈췄다가 이어서 해요)." : `일감이 돌고 있으면 감독 프로그램 새 커밋을 최대 ${n}분 모았다가 한 번에 받도록 저장했어요. 공장이 비어 있으면 바로 받아요.`,
    });
  }

  // 앱별 합치기·최종 점검 검사 명령: { appChecks: { appSlug, commands: 줄바꿈으로 나눈 글자 | 배열 } }. 비우면 그 앱은 stack 기본 검사만(예전과 같음)
  if (body && Object.hasOwn(body, "appChecks")) {
    const res = applyAppChecksPatch(await getAppChecks(), body.appChecks);

    if (!res.ok) return NextResponse.json({ message: res.message }, { status: 400 });
    await saveAppChecks(res.checks);

    return NextResponse.json({ ...(await supervisorSnapshot()), message: res.message });
  }

  // 지휘자(C-2) 자동 묶기 켜기·끄기: { conductorAutoGroup: boolean }. 끄면 C-1 과 똑같이 사람이 묶은 것만 같이 돈다
  if (body && Object.hasOwn(body, "conductorAutoGroup")) {
    if (typeof body.conductorAutoGroup !== "boolean") return NextResponse.json({ message: "conductorAutoGroup 은 true/false 여야 해요." }, { status: 400 });
    await setAutoGroupEnabled(body.conductorAutoGroup);

    return NextResponse.json({ ...(await supervisorSnapshot()), message: body.conductorAutoGroup ? "자동 묶기를 켰어요. 같은 앱에 승인된 수정 일감이 2개 이상 쌓이면 지휘자가 겹치는지 보고 묶어요." : "자동 묶기를 껐어요. 사람이 묶은 일감만 같이 돌고, 나머지는 앱당 1개씩 순서대로 돌아요." });
  }

  // 지휘자 모델: { conductorModel: Claude Code 별칭 }. 가벼운 모델(기본 haiku)이면 충분해요
  if (body && Object.hasOwn(body, "conductorModel")) {
    const m = body.conductorModel;

    if (typeof m !== "string" || !(CLAUDE_MODELS as readonly string[]).includes(m)) return NextResponse.json({ message: "허용된 Claude Code 모델 별칭을 골라 주세요." }, { status: 400 });
    await setConductorModel(m);

    return NextResponse.json({ ...(await supervisorSnapshot()), message: `지휘자 모델을 ${m}로 저장했어요. 다음 판단부터 적용돼요.` });
  }

  // 지휘자 공용 파일 목록(건드리면 순서대로 두는 파일 패턴): { conductorSharedFiles: 줄바꿈으로 나눈 글자 | 배열 | null(기본값으로) }
  if (body && Object.hasOwn(body, "conductorSharedFiles")) {
    if (body.conductorSharedFiles === null) {
      await setSharedFiles([...(await conductorSnapshot()).defaultSharedFiles]);

      return NextResponse.json({ ...(await supervisorSnapshot()), message: "공용 파일 목록을 기본값으로 되돌렸어요." });
    }
    const list = cleanSharedPatterns(body.conductorSharedFiles);

    if (!list) return NextResponse.json({ message: "공용 파일 목록은 줄바꿈으로 나눈 패턴(최대 100줄)이어야 해요." }, { status: 400 });
    await setSharedFiles(list);

    return NextResponse.json({ ...(await supervisorSnapshot()), message: `공용 파일 패턴 ${list.length}개를 저장했어요. 다음 판단부터 적용돼요.` });
  }

  // 툴킷 도구 용도: { toolPurpose: { id, purpose: game|cut|common|unclassified|null } }. null = 저장값을 지우고 자동 추정으로
  if (body && Object.hasOwn(body, "toolPurpose")) {
    const tp = body.toolPurpose as Record<string, unknown> | null;

    if (!tp || typeof tp !== "object" || Array.isArray(tp) || !isToolId(tp.id) || !(tp.purpose === null || isPurpose(tp.purpose))) {
      return NextResponse.json({ message: "도구 이름과 용도(게임용·움짤·컷용·공용·미분류)를 확인해 주세요." }, { status: 400 });
    }
    const purpose = tp.purpose as Purpose | null;

    await setToolPurpose(prisma, tp.id, purpose);

    return NextResponse.json({ message: purpose ? `${tp.id} 의 용도를 '${PURPOSE_LABELS[purpose]}'로 저장했어요.` : `${tp.id} 의 용도를 자동 추정으로 되돌렸어요.`, id: tp.id, purpose });
  }

  // 스튜디오 프로젝트 설정: { studioProject: { appSlug, kind?: game|app|none(미분류), tools?: [도구 id], studioUrl?: https 주소 | null, links?: [{ name, url }] | null } }. 저장은 factory_settings 의 studioProjects 한 칸
  if (body && Object.hasOwn(body, "studioProject")) {
    const patch = body.studioProject as { appSlug?: unknown } | null;
    const slug = typeof patch?.appSlug === "string" ? patch.appSlug.trim() : "";
    const [row, known, view] = await Promise.all([
      prisma.factorySetting.findUnique({ where: { key: STUDIO_PROJECTS_KEY } }),
      slug ? prisma.factoryJob.findFirst({ where: { appSlug: slug }, select: { id: true } }) : null,
      readToolkitView(prisma),
    ]);
    const cur = readStudioProjects(row?.value);
    const res = applyStudioPatch(cur, body.studioProject, new Set(known ? [slug] : []), allowedStudioToolIds(view.rows, cur[slug]?.tools)); // pixel-art 기준, 예전에 연결한 내부 도구 이름은 그대로 저장 가능

    if (!res.ok) return NextResponse.json({ message: res.message }, { status: 400 });
    const value = JSON.stringify(res.projects);

    await prisma.factorySetting.upsert({ where: { key: STUDIO_PROJECTS_KEY }, create: { key: STUDIO_PROJECTS_KEY, value }, update: { value } });

    return NextResponse.json({ message: res.message, studioProjects: res.projects });
  }

  // 앱 역할: { appRole: { appSlug, role: product|tool } }. 저장은 factory_settings 의 appRoles 한 칸(앱 레코드 없어도 됨)
  if (body && Object.hasOwn(body, "appRole")) {
    const patch = body.appRole as { appSlug?: unknown } | null;
    const slug = typeof patch?.appSlug === "string" ? patch.appSlug.trim() : "";
    const [row, known] = await Promise.all([
      prisma.factorySetting.findUnique({ where: { key: APP_ROLES_KEY } }),
      slug ? prisma.factoryJob.findFirst({ where: { appSlug: slug }, select: { id: true } }) : null,
    ]);
    const res = applyAppRolePatch(readAppRoles(row?.value), body.appRole, new Set(known ? [slug] : []));

    if (!res.ok) return NextResponse.json({ message: res.message }, { status: 400 });
    const value = JSON.stringify(res.roles);

    await prisma.factorySetting.upsert({ where: { key: APP_ROLES_KEY }, create: { key: APP_ROLES_KEY, value }, update: { value } });

    return NextResponse.json({ message: res.message, appRoles: res.roles });
  }

  // 스튜디오 [일감 만들기]: { studioJob: { appSlug, kind: regen|layout|free, tool, propName?, placement?, instruction?, note? } }. 관리자 세션 전용 — Studio 요청과 같은 검증·지시문 경로로 '승인 대기' 일감을 만든다
  if (body && Object.hasOwn(body, "studioJob")) {
    const input = body.studioJob as Record<string, unknown> | null;

    if (!input || typeof input !== "object" || Array.isArray(input)) return NextResponse.json({ message: "일감 내용이 올바르지 않아요." }, { status: 400 });
    const slug = typeof input.appSlug === "string" ? input.appSlug.trim() : "";
    const [row, view] = await Promise.all([prisma.factorySetting.findUnique({ where: { key: STUDIO_PROJECTS_KEY } }), readToolkitView(prisma)]);
    const project = readStudioProjects(row?.value)[slug];
    // '참고로 고르기': 같은 프로젝트의 승인 그림만(최대 4장). 후보·반려 그림 id 는 조용히 버린다
    const picked = await resolvePicked(prisma as unknown as ArtDb, slug, input.refArtIds);
    const r = await createAdminStudioJob(input, project, allowedStudioToolIds(view.rows, project?.tools), picked.map((a) => ({ url: a.url, subject: a.subject })));

    if (r.ok === false) return NextResponse.json({ message: r.message }, { status: r.status });
    if (picked.length) await savePicks(prisma as unknown as PickDb, r.jobId, picked.map((a) => a.id)).catch(() => undefined);
    const recent = await prisma.factoryJob.findMany({ where: { appSlug: slug, source: STUDIO_REQUEST_SOURCE }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, title: true, status: true, createdAt: true } });

    return NextResponse.json({ message: r.message, jobId: r.jobId, recent: recent.map((j) => ({ ...j, createdAt: j.createdAt.toISOString() })) }, { status: 201 });
  }

  // 도구 요청 중계: { toolBroker: { mode: off|report|allow, maxRequests?, toolTimeoutSec? } }
  if (body && Object.hasOwn(body, "toolBroker")) {
    const tb = body.toolBroker as Record<string, unknown> | null;

    if (!tb || typeof tb !== "object" || Array.isArray(tb) || !isToolBrokerMode(tb.mode)) {
      return NextResponse.json({ message: "도구 요청 중계 모드(꺼짐·보고만·허용)를 골라 주세요." }, { status: 400 });
    }
    for (const k of ["maxRequests", "toolTimeoutSec"] as const) {
      if (tb[k] !== undefined && !(typeof tb[k] === "number" && Number.isInteger(tb[k]))) {
        return NextResponse.json({ message: "요청 수·제한 시간은 정수여야 해요." }, { status: 400 });
      }
    }
    const saved = await setToolBrokerSettings({
      mode: tb.mode,
      ...(typeof tb.maxRequests === "number" ? { maxRequests: tb.maxRequests } : {}),
      ...(typeof tb.toolTimeoutSec === "number" ? { toolTimeoutSec: tb.toolTimeoutSec } : {}),
    });

    return NextResponse.json({
      ...(await supervisorSnapshot()),
      message: `도구 요청 중계를 '${TOOL_BROKER_MODE_LABELS[saved.mode]}'(일감당 요청 ${toolBrokerLimitLabel(saved.maxRequests, "개")}, 제한 시간 ${toolBrokerLimitLabel(saved.toolTimeoutSec, "초")})로 저장했어요. 감독 프로그램이 다음 확인 때 받아 가요.`,
    });
  }

  let action: SupervisorAction | null = null;

  if (body?.restart === true) action = "restart";
  else if (body?.updateNow === true) action = "update_now";
  else if (typeof body?.autoDeploy === "boolean") action = body.autoDeploy ? "auto_deploy_on" : "auto_deploy_off";
  else if (typeof body?.autoUpdate === "boolean") action = body.autoUpdate ? "auto_update_on" : "auto_update_off";
  else if (typeof body?.enabled === "boolean") action = body.enabled ? "resume" : "pause";

  if (!action) {
    return NextResponse.json(
      { message: "enabled 또는 autoUpdate 는 true/false, updateNow·restart 는 true 여야 해요." },
      { status: 400 },
    );
  }

  const { message, snapshot } = await runSupervisorAction(action);

  return NextResponse.json({ ...snapshot, message });
}
