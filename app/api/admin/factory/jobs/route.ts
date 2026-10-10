// 앱 공장 통제실: 지시 목록. 관리자만.
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/factory/admin";
import { JOB_STATUSES } from "@/lib/factory/jobs";

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
