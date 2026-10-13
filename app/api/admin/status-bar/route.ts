// 관리자 하단 상태바가 15초마다 읽는 요약(감독 프로그램 연결·일감 수·빌드 커밋·AI 한도). 관리자만.
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { statusBarSnapshot } from "@/lib/factory/statusBar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await statusBarSnapshot(), {
    headers: { "Cache-Control": "no-store" },
  });
}
