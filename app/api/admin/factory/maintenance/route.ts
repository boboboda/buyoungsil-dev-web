// app/api/admin/factory/maintenance/route.ts
// 통제실(감독 프로그램 카드)의 공장 정비. 관리자만. 통제실에서 보낸 지시는 바로 대기열에 들어간다.
//   GET ?threadId=   정비 목록(또는 하나)과 대화
//   POST { action: "send", threadId?, text, aiEngine?, aiModel? } | { action: "approve", turnId, aiModel? } | { action: "cancel", turnId }
//        aiModel: Claude Code 모델 별칭(허용 목록, lib/factory/ai.ts CLAUDE_MODELS). 없음·"default" = 기본 설정 사용, 목록 밖은 400 | { action: "deploy"|"deploy_now"|"close", threadId } | { action: "revert", deployId }(배포 되돌리기, 5-2)
//        | { action: "queue_skip"|"queue_retry", turnId(멈춘 지시) } | { action: "queue_clear" }
//   deploy 는 정비 대기열이 비었을 때만, deploy_now(지금 배포)는 남아 있어도 지금까지 반영분을 배포한다.
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { readModelChoice } from "@/lib/factory/ai";
import { runApproval } from "@/lib/factory/approvals";
import { requestRevert } from "@/lib/factory/deployRevert";
import { cancelTurn, closeThread, maintenanceOverview, queueAction, sendMaintenance, setTurnEngine } from "@/lib/factory/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ID = /^[A-Za-z0-9_-]{1,40}$/;

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const threadId = req.nextUrl.searchParams.get("threadId") ?? "";

  return NextResponse.json(await maintenanceOverview(ID.test(threadId) ? { threadId } : {}));
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const turnId = typeof body?.turnId === "string" && ID.test(body.turnId) ? body.turnId : "";
  const threadId = typeof body?.threadId === "string" && ID.test(body.threadId) ? body.threadId : "";
  const deployId = typeof body?.deployId === "string" && ID.test(body.deployId) ? body.deployId : "";
  const model = readModelChoice(body?.aiModel);
  let r;

  if (!model.ok) return NextResponse.json({ message: model.message }, { status: 400 });
  switch (body?.action) {
    case "send":
      r = await sendMaintenance({ threadId: threadId || undefined, text: body.text, aiEngine: body.aiEngine, aiModel: model.model, source: "통제실" });
      break;
    case "set-ai":
      r = turnId ? await setTurnEngine(turnId, body.aiEngine) : null;
      break;
    case "approve":
      r = turnId ? await runApproval("maintenance_approve", turnId, "통제실", undefined, model.model) : null;
      break;
    case "cancel":
      r = turnId ? await cancelTurn(turnId) : null;
      break;
    case "deploy":
      r = threadId ? await runApproval("deploy", threadId, "통제실") : null;
      break;
    case "deploy_now":
      r = threadId ? await runApproval("deploy_now", threadId, "통제실") : null;
      break;
    case "revert":
      // 배포 되돌리기(5-2): 배포 기록의 [이전 버전으로]. 통제실에서만(텔레그램 버튼 없음)
      r = deployId ? await requestRevert(deployId, "통제실") : null;
      break;
    case "queue_skip":
      r = turnId ? await runApproval("queue_skip", turnId, "통제실") : null;
      break;
    case "queue_retry":
      r = turnId ? await runApproval("queue_retry", turnId, "통제실") : null;
      break;
    case "queue_clear":
      r = await queueAction("clear", "통제실");
      break;
    case "close":
      r = threadId ? await closeThread(threadId) : null;
      break;
    default:
      r = null;
  }
  if (!r) return NextResponse.json({ message: "action 과 id 가 올바르지 않아요." }, { status: 400 });

  return NextResponse.json({ message: r.message, id: r.id, ...(await maintenanceOverview()) }, { status: r.status });
}
