// app/api/novel/jobs/next/route.ts
// 소설 실행기(감독 프로그램)가 승인된 다음 소설 작업을 가져가는 주소(7-1). 작업 PC 토큰 인증.
// GET: 승인된 작업 하나를 원자적으로 running 으로 표시해 돌려준다(같은 작품에 도는 작업이 있으면 건너뜀). 없으면 { job: null }.
// 응답: { job: { id, workSlug, episode, mode, params: { fresh, skipWrite, maxRewrites }, notes: [{ id, line, kind, text, memoLine }], timeoutMin } | null }
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { claimNextJob } from "@/lib/novel/jobStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  try {
    return NextResponse.json({ job: await claimNextJob() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[novel-jobs] next 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
