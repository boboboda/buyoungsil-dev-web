// 관리자 화면이 5초마다 불러가는 Claude Code 작업 현황.
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/get-sesstion";
import { getClaudeStats } from "@/lib/claude-status/stats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await auth();

  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
  }

  try {
    const stats = await getClaudeStats();

    return NextResponse.json(stats, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[claude-status] 현황 조회 실패:", error);

    return NextResponse.json(
      { message: "현황을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
