// app/api/admin/novel/works/[slug]/episodes/[number]/approve/route.ts
// 승인: 승인 대기 화를 approved 로 바꾸고 예약 시각(max(지금, 마지막 예약 + 24시간/하루 발행 화수))을 배정한다. 관리자만.
import { NextRequest } from "next/server";

import {
  adminGate,
  bad,
  resultResponse,
  validNumber,
  validSlug,
} from "@/lib/novel/adminHttp";
import { approveEpisode } from "@/lib/novel/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; number: string }> },
) {
  const denied = await adminGate(true);

  if (denied) return denied;
  const { slug, number } = await params;
  const n = validNumber(number);

  if (!validSlug(slug) || !n) return bad("주소가 올바르지 않아요.");

  return resultResponse(await approveEpisode(slug, n));
}
