// app/api/admin/novel/works/[slug]/episodes/[number]/route.ts
// 화 상세: 본문·요약·검수 결과·역할별 토큰·진행 로그(최근 200개). 관리자만.
import { NextRequest } from "next/server";

import {
  adminGate,
  bad,
  json,
  validNumber,
  validSlug,
} from "@/lib/novel/adminHttp";
import { getEpisodeForAdmin } from "@/lib/novel/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; number: string }> },
) {
  const denied = await adminGate();

  if (denied) return denied;
  const { slug, number } = await params;
  const n = validNumber(number);

  if (!validSlug(slug) || !n) return bad("주소가 올바르지 않아요.");

  const data = await getEpisodeForAdmin(slug, n);

  return data ? json(data) : bad("없는 화예요.", 404);
}
