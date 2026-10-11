// app/api/factory/next/route.ts
// 내 PC 의 감독 프로그램이 일감을 가져가는 주소.
//
// 요청: GET /api/factory/next?worker=mainpc&slots=2, 헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>
// 응답: { "jobs": [ { id, appSlug, title, kind, parentJobId, stack, priority, requiredSecrets, planMarkdown, attempts } ] }
//   통제실에서 정지 상태면 { "jobs": [], "paused": true } 를 돌려주고 아무것도 가져가지 않는다.
//   모든 응답에 autoUpdate(true/false)가 들어간다. false 면 감독 프로그램은 자동 업데이트를 하지 않는다.
//   통제실·커넥터에서 "지금 업데이트"를 누르면 다음 응답 한 번에 updateNow: true 가 붙는다(받아 가면 지운다).
//   만료된 running 을 먼저 정리하고, approved 중 우선순위 높은 순으로 최대 slots 개를 running 으로 바꿔 돌려준다.
import { NextRequest, NextResponse } from "next/server";

import { claimJobs, MAX_SLOTS, releaseExpiredLeases, WORKER_RE } from "@/lib/factory/jobs";
import { fail, guardWorker } from "@/lib/factory/http";
import { consumeUpdateNow, isAutoUpdateEnabled, isSupervisorEnabled, saveSupervisorInfo } from "@/lib/factory/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const worker = req.nextUrl.searchParams.get("worker") ?? "";
  if (!WORKER_RE.test(worker)) return fail(400, "worker 이름이 올바르지 않습니다.");

  const slotsRaw = Number(req.nextUrl.searchParams.get("slots") ?? "1");
  const slots = Number.isFinite(slotsRaw) ? Math.min(MAX_SLOTS, Math.max(1, Math.floor(slotsRaw))) : 1;

  // 감독 프로그램이 알려 주는 현재 커밋·최근 업데이트 소식(선택). 형식이 이상하면 무시한다.
  const commitRaw = req.nextUrl.searchParams.get("commit") ?? "";
  const noteRaw = (req.nextUrl.searchParams.get("note") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 150);
  const commit = /^[0-9a-f]{7,40}$/.test(commitRaw) ? commitRaw : "";

  try {
    if (commit) await saveSupervisorInfo(commit, noteRaw).catch(() => undefined);

    // 통제실에서 "일시 정지" 하면 일감을 내주지 않는다. (인증은 이미 통과했으니 "연결됨" 표시는 계속 갱신된다)
    const [enabled, autoUpdate] = await Promise.all([isSupervisorEnabled(), isAutoUpdateEnabled()]);
    // 1회성 신호: 받아 가는 순간 지운다. 정지 중이어도 업데이트는 할 수 있게 같이 보낸다.
    const updateNow = await consumeUpdateNow().catch(() => false);
    const extra = updateNow ? { updateNow: true } : {};

    if (!enabled) {
      return NextResponse.json({ jobs: [], paused: true, autoUpdate, ...extra });
    }

    await releaseExpiredLeases();
    const jobs = await claimJobs(worker, slots);

    return NextResponse.json({ jobs, autoUpdate, ...extra });
  } catch (error) {
    console.error("[factory] next 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
