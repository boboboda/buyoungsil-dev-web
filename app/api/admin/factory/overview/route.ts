// app/api/admin/factory/overview/route.ts
// 통제실 "승인·배포"와 "감독 프로그램·업데이트·배포 이력" 화면용. 관리자만.
//   GET                                 감독 프로그램 상태 + 승인 기다림 목록 + 업데이트 이력 + 배포 이력 + 정비 대화 요약
//   POST { action, id, aiModel? }       action = job_approve | maintenance_approve | deploy (deploy 의 id 는 정비 id)
//                                       aiModel: 승인 때 고른 Claude Code 모델(허용 목록만, 없음·"default" = 기본 설정 사용). Codex 일감이면 400
// 승인·배포는 텔레그램 버튼과 같은 함수(lib/factory/approvals.ts runApproval)를 부른다.
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { readModelChoice } from "@/lib/factory/ai";
import {
  activeNow,
  APPROVAL_ACTIONS,
  approvalInbox,
  deployHistory,
  historyTotals,
  maintenanceSummary,
  runApproval,
  supervisorUpdateHistory,
  type ApprovalAction,
} from "@/lib/factory/approvals";
import { supervisorSnapshot } from "@/lib/factory/supervisor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function overview() {
  const [supervisor, inbox, updates, deploys, threads, totals, active] =
    await Promise.all([
      supervisorSnapshot(),
      approvalInbox(),
      supervisorUpdateHistory(),
      deployHistory(),
      maintenanceSummary(),
      historyTotals(),
      activeNow(),
    ]);

  // 이력은 최근 것만 싣는다. 전체는 /api/admin/factory/history 로 쪽마다 읽는다(totals = 종류별 전체 개수)
  // active: [현황] 맨 위 '지금 진행 중' 띠(읽기 전용)
  return { supervisor, inbox, updates, deploys, threads, totals, active };
}

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await overview());
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as {
    action?: unknown;
    id?: unknown;
    aiModel?: unknown;
  } | null;
  const action = (APPROVAL_ACTIONS as readonly string[]).includes(
    String(body?.action),
  )
    ? (body!.action as ApprovalAction)
    : null;
  const id = typeof body?.id === "string" ? body.id : "";

  if (!action || !id)
    return NextResponse.json(
      { message: "action 과 id 가 올바르지 않아요." },
      { status: 400 },
    );
  const model = readModelChoice(body?.aiModel);

  if (!model.ok) return NextResponse.json({ message: model.message }, { status: 400 });
  const r = await runApproval(action, id, "통제실", undefined, model.model);

  return NextResponse.json(
    { ok: r.ok, message: r.message, ...(await overview()) },
    { status: r.status },
  );
}
