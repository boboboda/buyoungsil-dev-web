// app/api/admin/factory/devices/route.ts
// 통제실 [사용량] '장비 상태' 패널: 서버1·서버2·메인PC 최신 값·24시간 이력·배포된 프로젝트 수. 관리자만, 캐시 안 함.
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { devicesSnapshot } from "@/lib/factory/devices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await devicesSnapshot(), { headers: NO_STORE });
}
