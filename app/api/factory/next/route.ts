// app/api/factory/next/route.ts
// 내 PC 의 감독 프로그램이 일감을 가져가는 주소.
//
// 요청: GET /api/factory/next?worker=mainpc&slots=2, 헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>
// 응답: { "jobs": [ { id, appSlug, title, kind, parentJobId, stack, priority, requiredSecrets, planMarkdown, attempts } ] }
//   통제실에서 정지 상태면 { "jobs": [], "paused": true } 를 돌려주고 아무것도 가져가지 않는다.
//   만료된 running 을 먼저 정리하고, approved 중 우선순위 높은 순으로 최대 slots 개를 running 으로 바꿔 돌려준다.
import { NextRequest, NextResponse } from "next/server";

import { claimJobs, MAX_SLOTS, releaseExpiredLeases, WORKER_RE } from "@/lib/factory/jobs";
import { fail, guardWorker } from "@/lib/factory/http";
import { isSupervisorEnabled } from "@/lib/factory/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const worker = req.nextUrl.searchParams.get("worker") ?? "";
  if (!WORKER_RE.test(worker)) return fail(400, "worker 이름이 올바르지 않습니다.");

  const slotsRaw = Number(req.nextUrl.searchParams.get("slots") ?? "1");
  const slots = Number.isFinite(slotsRaw) ? Math.min(MAX_SLOTS, Math.max(1, Math.floor(slotsRaw))) : 1;

  try {
    // 통제실에서 "일시 정지" 하면 일감을 내주지 않는다. (인증은 이미 통과했으니 "연결됨" 표시는 계속 갱신된다)
    if (!(await isSupervisorEnabled())) {
      return NextResponse.json({ jobs: [], paused: true });
    }

    await releaseExpiredLeases();
    const jobs = await claimJobs(worker, slots);

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error("[factory] next 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
