// 앱별 일감 대기열(병렬화 단계 B). 관리자만. ?appSlug=이름 이면 그 앱만, 없으면 대기·실행 중인 앱 전부.
// 응답: { queues: { [appSlug]: [{ id, title, kind, status, priority, position, parallelGroup, parallel, mergeFailed }] }, groupReports: [...] }
//   position 0 = 지금 실행 중(병행 그룹은 여러 개가 0), 1.. = 다음 차례. parallel = 감독 프로그램이 보고한 병행 상태, groupReports = 최근 그룹 완료 요약.
// POST: { action: "group", jobIds: [id, ...] } 같은 앱의 승인 대기·승인됨 수정 일감을 '같이 돌리기'로 묶기 | { action: "ungroup", jobId } 그룹에서 빼기
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { allAppQueues, appQueue } from "@/lib/factory/queue";
import { groupJobs, readGroupReports, settleStaleFinalChecks, ungroupJob } from "@/lib/factory/parallel";
import { APP_SLUG_RE, ID_RE } from "@/lib/factory/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const appSlug = req.nextUrl.searchParams.get("appSlug")?.trim() ?? "";

  await settleStaleFinalChecks().catch(() => 0); // 최종 점검 결과가 오지 않은 그룹 요약을 마무리한다

  if (appSlug) {
    if (!APP_SLUG_RE.test(appSlug)) return NextResponse.json({ message: "앱 이름이 올바르지 않아요." }, { status: 400 });
    const list = await appQueue(appSlug);

    const reports = (await readGroupReports().catch(() => [])).filter((r) => r.appSlug === appSlug);

    return NextResponse.json({ queues: list.length ? { [appSlug]: list } : {}, groupReports: reports });
  }

  return NextResponse.json({ queues: await allAppQueues(), groupReports: await readGroupReports().catch(() => []) });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { action?: unknown; jobIds?: unknown; jobId?: unknown } | null;

  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "요청 형식이 올바르지 않아요." }, { status: 400 });
  let res;

  if (body.action === "group") res = await groupJobs(body.jobIds);
  else if (body.action === "ungroup" && typeof body.jobId === "string" && ID_RE.test(body.jobId)) res = await ungroupJob(body.jobId);
  else return NextResponse.json({ message: "알 수 없는 동작이에요." }, { status: 400 });

  return NextResponse.json(res.ok ? { success: true, message: res.message, group: res.group } : { message: res.message }, { status: res.ok ? 200 : res.status });
}
