// 앱 공장 통제실: 지시 상세와 관리 동작(승인, 취소, 재시도, 우선순위). 관리자만.
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/factory/admin";
import { adminAction, claudeUsageFor, ID_RE } from "@/lib/factory/jobs";
import { runApproval } from "@/lib/factory/approvals";
import { isAiEngine, readModelChoice } from "@/lib/factory/ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.json({ message: "없는 지시예요." }, { status: 404 });

  const job = await prisma.factoryJob.findUnique({
    where: { id },
    include: {
      images: { orderBy: { createdAt: "asc" } },
      logs: { orderBy: { id: "desc" }, take: 200 },
    },
  });
  if (!job) return NextResponse.json({ message: "없는 지시예요." }, { status: 404 });

  // 같은 앱 이름의 Claude 세션과 토큰 합계. 지시를 가져간 감독 프로그램 이름과 기기 이름이 같은 것만 붙인다.
  const claude = await claudeUsageFor(job.appSlug, job.workerId);

  return NextResponse.json({ job: { ...job, logs: [...job.logs].reverse() }, claude });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.json({ message: "없는 지시예요." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ message: "요청 형식이 올바르지 않아요." }, { status: 400 });
  }

  // 승인은 텔레그램 버튼과 같은 입구로(이미 처리된 건이면 안내)
  if (body.aiEngine !== undefined && !isAiEngine(body.aiEngine)) return NextResponse.json({ message: "작업 AI가 올바르지 않아요." }, { status: 400 });
  // 모델은 허용 목록(Claude Code 별칭)만. 없음·"default" 는 기본 설정 사용
  const model = readModelChoice(body.aiModel);
  if (!model.ok) return NextResponse.json({ message: model.message }, { status: 400 });
  const result =
    (body as Record<string, unknown>).action === "approve"
      ? await runApproval("job_approve", id, "통제실", body.aiEngine, model.model)
      : await adminAction(id, body as Record<string, unknown>);

  return NextResponse.json(
    result.ok ? { success: true, message: result.message } : { message: result.message },
    { status: result.status },
  );
}
