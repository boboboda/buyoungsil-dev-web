// app/api/admin/novel/works/[slug]/setup-approve/route.ts
// 설정 승인: setup 인 작품을 active 로(그 뒤로 실행기가 화 집필을 시작한다). 관리자만.
import { NextRequest } from "next/server";

import {
  adminGate,
  bad,
  resultResponse,
  validSlug,
} from "@/lib/novel/adminHttp";
import { approveSetup } from "@/lib/novel/store";

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

  return resultResponse(await approveSetup(slug));
}
