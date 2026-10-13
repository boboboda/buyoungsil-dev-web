// app/api/admin/factory/history/route.ts
// 통제실 '업데이트·배포 이력'의 [전체 보기]·[더 보기]. 관리자만, 캐시 안 함.
//   GET ?kind=deploys|updates|threads&limit=20&cursor=<앞 쪽 nextCursor>
//   → { kind, items, nextCursor, total }  (items 모양은 /api/admin/factory/overview 의 같은 이름 목록과 같다)
//   GET ?kind=all&limit=20&cursor=…  [전체 히스토리]: 세 종류를 최신순으로 합친 목록, items 는 { type, at, item }, total 은 세 종류 합
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import {
  HISTORY_KINDS,
  historyAllPage,
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

  if (kind !== "all" && !(HISTORY_KINDS as readonly string[]).includes(kind))
    return NextResponse.json(
      { message: "kind 는 all | deploys | updates | threads 중 하나예요." },
      { status: 400, headers: NO_STORE },
    );
  const opts = {
    limit: q.has("limit") ? Number(q.get("limit")) : undefined,
    cursor: q.get("cursor"),
  };
  const page =
    kind === "all"
      ? await historyAllPage(opts)
      : await historyPage(kind as HistoryKind, opts);

  if (!page)
    return NextResponse.json(
      { message: "cursor 가 올바르지 않아요." },
      { status: 400, headers: NO_STORE },
    );

  return NextResponse.json(page, { headers: NO_STORE });
}
