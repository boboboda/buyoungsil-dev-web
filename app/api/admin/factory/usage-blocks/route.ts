// app/api/admin/factory/usage-blocks/route.ts
// 블록별 비용·시간 통계(4-4): 에이전트 종류·앱·결과물 카드·도구·방법 단위로 모은 토큰·시간·결과·외부 비용. 관리자만, 읽기 전용(GET 만), 캐시 안 함.
// ?by=agent|app|card|tool  ?period=day|week|month  ?appSlug=<앱>(선택)
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { GROUP_BYS, PERIODS } from "@/lib/factory/runStats";
import { readUsageByBlock } from "@/lib/factory/runStatsDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  const by = GROUP_BYS.find((g) => g === q.get("by")) ?? "agent";
  const period = PERIODS.find((p) => p === q.get("period")) ?? "week";
  const slug = q.get("appSlug");
  const appSlug = slug && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug) ? slug : undefined;

  return NextResponse.json(await readUsageByBlock(by, period, Date.now(), appSlug), { headers: { "Cache-Control": "no-store" } });
}
