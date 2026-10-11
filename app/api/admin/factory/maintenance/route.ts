// app/api/admin/factory/maintenance/route.ts
// 통제실(감독 프로그램 카드)의 공장 정비. 관리자만. 통제실에서 보낸 지시는 바로 대기열에 들어간다.
//   GET ?threadId=   정비 목록(또는 하나)과 대화
//   POST { action: "send", threadId?, text } | { action: "approve"|"cancel", turnId } | { action: "deploy"|"close", threadId }
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { approveTurn, cancelTurn, closeThread, maintenanceOverview, requestDeploy, sendMaintenance } from "@/lib/factory/maintenance";

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
  let r;

  switch (body?.action) {
    case "send":
      r = await sendMaintenance({ threadId: threadId || undefined, text: body.text, source: "통제실" });
      break;
    case "approve":
      r = turnId ? await approveTurn(turnId) : null;
      break;
    case "cancel":
      r = turnId ? await cancelTurn(turnId) : null;
      break;
    case "deploy":
      r = threadId ? await requestDeploy(threadId) : null;
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
