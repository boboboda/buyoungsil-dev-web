// app/api/admin/factory/map/route.ts
// 통제실 지도(4-3) 자료: 기계·에이전트·도구·카드·앱·원격·도메인·컨테이너 블록과 선, 상태, 진행 중 일감 한 줄, 블록별 상세. 관리자만, 읽기 전용(GET 만), 캐시 안 함.
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { readFactoryMap } from "@/lib/factory/factoryMapDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await readFactoryMap(), { headers: { "Cache-Control": "no-store" } });
}
