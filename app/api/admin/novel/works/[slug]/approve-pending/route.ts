// app/api/admin/novel/works/[slug]/approve-pending/route.ts
// 대기 화 일괄 승인: 승인 대기 화를 번호 순으로 최대 5화 승인하고 예약 시각을 차례로 배정한다. 관리자만.
import { NextRequest } from "next/server";

import {
  adminGate,
  bad,
  resultResponse,
  validSlug,
} from "@/lib/novel/adminHttp";
import { approvePending } from "@/lib/novel/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const denied = await adminGate(true);

  if (denied) return denied;
  const { slug } = await params;

  if (!validSlug(slug)) return bad("작품 주소가 올바르지 않아요.");

  return resultResponse(await approvePending(slug));
}
