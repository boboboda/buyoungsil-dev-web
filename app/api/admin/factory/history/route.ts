// app/api/admin/factory/history/route.ts
// 통제실 '업데이트·배포 이력'의 [전체 보기]·[더 보기]. 관리자만, 캐시 안 함.
//   GET ?kind=deploys|updates|threads&limit=20&cursor=<앞 쪽 nextCursor>
//   → { kind, items, nextCursor, total }  (items 모양은 /api/admin/factory/overview 의 같은 이름 목록과 같다)
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import {
  HISTORY_KINDS,
  historyPage,
  type HistoryKind,
} from "@/lib/factory/approvals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind") ?? "";

  if (!(HISTORY_KINDS as readonly string[]).includes(kind))
    return NextResponse.json(
      { message: "kind 는 deploys | updates | threads 중 하나예요." },
      { status: 400, headers: NO_STORE },
    );
  const page = await historyPage(kind as HistoryKind, {
    limit: q.has("limit") ? Number(q.get("limit")) : undefined,
    cursor: q.get("cursor"),
  });

  if (!page)
    return NextResponse.json(
      { message: "cursor 가 올바르지 않아요." },
      { status: 400, headers: NO_STORE },
    );

  return NextResponse.json(page, { headers: NO_STORE });
}
