// app/api/admin/factory/agents/route.ts
// 에이전트 블록 정의 목록(읽기 전용). 관리자만. 종류별 요약과 흐름, 거절된 정의의 이유. 고치는 기능은 없다(정의 파일은 코드와 같이 커밋해서 바꾼다).
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { readAgentsView } from "@/lib/factory/agents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(readAgentsView(), { headers: { "Cache-Control": "no-store" } });
}
