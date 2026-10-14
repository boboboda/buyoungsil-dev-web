// 앱별 일감 대기열(병렬화 단계 B). 관리자만. ?appSlug=이름 이면 그 앱만, 없으면 대기·실행 중인 앱 전부.
// 응답: { queues: { [appSlug]: [{ id, title, kind, status, priority, position }] } } — position 0 = 지금 실행 중, 1.. = 다음 차례.
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { allAppQueues, appQueue } from "@/lib/factory/queue";
import { APP_SLUG_RE } from "@/lib/factory/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const appSlug = req.nextUrl.searchParams.get("appSlug")?.trim() ?? "";

  if (appSlug) {
    if (!APP_SLUG_RE.test(appSlug)) return NextResponse.json({ message: "앱 이름이 올바르지 않아요." }, { status: 400 });
    const list = await appQueue(appSlug);

    return NextResponse.json({ queues: list.length ? { [appSlug]: list } : {} });
  }

  return NextResponse.json({ queues: await allAppQueues() });
}
