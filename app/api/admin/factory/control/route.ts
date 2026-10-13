// app/api/admin/factory/control/route.ts
// 감독 프로그램 켜기/끄기(일시 정지), 자동 업데이트 켜고 끄기, 지금 업데이트, 재시작, 연결 상태. 관리자만.
// 홈페이지는 PC 의 프로그램을 직접 켤 수 없다. 정해진 신호만 남긴다(lib/factory/supervisor.ts).
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { isAiEngine, AI_LABELS, readModelChoice } from "@/lib/factory/ai";
import { setCompactAfterJobEnabled, setDefaultAiEngine, setDefaultClaudeModel, setToolBrokerSettings } from "@/lib/factory/settings";
import { isToolBrokerMode, TOOL_BROKER_MODE_LABELS, toolBrokerLimitLabel } from "@/lib/factory/toolBroker";
import { runSupervisorAction, supervisorSnapshot, type SupervisorAction } from "@/lib/factory/supervisor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await supervisorSnapshot());
}

// 본문: { enabled: boolean } | { autoUpdate: boolean } | { autoDeploy: boolean } | { compactAfterJob: boolean } | { updateNow: true } | { restart: true }
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    defaultAiEngine?: unknown;
    defaultClaudeModel?: unknown;
    toolBroker?: unknown;
    enabled?: unknown;
    autoUpdate?: unknown;
    autoDeploy?: unknown;
    compactAfterJob?: unknown;
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
