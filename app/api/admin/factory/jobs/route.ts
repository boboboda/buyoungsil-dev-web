// 앱 공장 통제실: 지시 목록. 관리자만.
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/factory/admin";
import { JOB_STATUSES, adminAction } from "@/lib/factory/jobs";
import { enqueue } from "@/lib/factory/mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const status = req.nextUrl.searchParams.get("status");
  if (status && !(JOB_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ message: "status 값이 올바르지 않아요." }, { status: 400 });
  }

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 50;

  // 목록에는 기획서 본문을 싣지 않는다. 상세에서 받는다.
  const jobs = await prisma.factoryJob.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      appSlug: true,
      title: true,
      kind: true,
      parentJobId: true,
      stack: true,
      requiredSecrets: true,
      priority: true,
      status: true,
      phase: true,
      summary: true,
      failReason: true,
      attempts: true,
      maxAttempts: true,
      workerId: true,
      leaseUntil: true,
      source: true,
      createdAt: true,
      approvedAt: true,
      startedAt: true,
      finishedAt: true,
      _count: { select: { images: true } },
    },
  });

  return NextResponse.json({ jobs });
}

const MAX_INSTRUCTION = 5000;

// 통제실에서 직접 수정 지시를 보낸다. 완성된(done) 앱만 고칠 수 있고, 규칙은 채팅 커넥터 등록과 같다.
// runNow 가 true 면 보낸 즉시 승인한다(관리자가 직접 보낸 것이므로).
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "요청 형식이 올바르지 않아요." }, { status: 400 });
  }

  const appSlug = typeof body.appSlug === "string" ? body.appSlug.trim() : "";
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";

  if (!appSlug) return NextResponse.json({ message: "앱을 골라 주세요." }, { status: 400 });
  if (instruction.length < 5) return NextResponse.json({ message: "고칠 내용을 5자 이상 적어 주세요." }, { status: 400 });
  if (instruction.length > MAX_INSTRUCTION) {
    return NextResponse.json({ message: `고칠 내용은 ${MAX_INSTRUCTION}자 이하로 적어 주세요.` }, { status: 400 });
  }

  const last = await prisma.factoryJob.findFirst({
    where: { appSlug, status: "done" },
    orderBy: { finishedAt: "desc" },
    select: { title: true },
  });
  if (!last) return NextResponse.json({ message: "완성된 앱만 고칠 수 있어요." }, { status: 404 });

  // 기획서 최소 길이(50자)를 채우도록 머리말을 붙인다.
  const plan = `# 수정 지시 (통제실에서 직접 입력)\n\n아래 내용만 고치세요. 요청하지 않은 부분은 바꾸지 마세요.\n\n${instruction}`;

  const result = await enqueue({
    appSlug,
    title: last.title,
    kind: "revision",
    planMarkdown: plan,
    source: "통제실",
  });
  const message = result.content[0]?.text ?? "";

  if (result.isError) return NextResponse.json({ message }, { status: 409 });

  const id = /id: ([A-Za-z0-9_-]+)/.exec(message)?.[1];

  if (body.runNow === true && id) {
    const approved = await adminAction(id, { action: "approve" });

    return NextResponse.json({ id, message: approved.ok ? "수정 지시를 보내고 바로 승인했어요." : message });
  }

  return NextResponse.json({ id, message: "수정 지시를 보냈어요. 승인하면 시작해요." });
}
