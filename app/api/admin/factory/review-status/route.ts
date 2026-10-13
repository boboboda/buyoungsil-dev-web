// app/api/admin/factory/review-status/route.ts
// 출시 패키지 카드의 '검수 대기 N장'. 관리자만. 홈페이지 서버가 앱별 검수 페이지 호스트의 /api/review-status 를 병렬로 대신 부른다.
// 토큰 값은 응답에 없다(토큰 키 이름과 등록 여부만). 실패는 앱별 '확인 못 함'으로만(이 라우트는 실패해도 빈 목록).
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { reviewStatusList } from "@/lib/factory/reviewStatus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  try {
    return NextResponse.json({ apps: await reviewStatusList() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[factory] 검수 상태 목록 실패");

    return NextResponse.json({ apps: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
