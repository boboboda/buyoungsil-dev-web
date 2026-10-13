// app/api/admin/users/route.ts
// 관리자 '가입자 명단' 읽기 전용 API. 관리자만, 캐시 안 함. (공개 /api/users 는 6단계에서 지웠고 다시 만들지 않는다)
//   GET ?q=<이름·이메일 일부>&role=admin|user&method=email|google|github&page=1&limit=25(최대 100)
//   → { summary, items, total, page, pages, limit }   잘못된 값은 400
// 응답에는 화면에 보여 줄 열만 담는다(lib/admin/members.ts 의 MEMBER_SELECT). 비밀번호·토큰·세션은 읽지도 않는다.
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/factory/admin";
import { listMembers, memberSummary, parseMemberQuery } from "@/lib/admin/members";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) {
    denied.headers.set("Cache-Control", "no-store");

    return denied;
  }
  const params = req.nextUrl.searchParams;
  const parsed = parseMemberQuery((k) => params.get(k));

  if (parsed.error !== undefined)
    return NextResponse.json({ message: parsed.error }, { status: 400, headers: NO_STORE });
  try {
    const [summary, page] = await Promise.all([memberSummary(prisma), listMembers(prisma, parsed.query)]);

    return NextResponse.json({ summary, ...page }, { headers: NO_STORE });
  } catch (error) {
    console.error("가입자 목록 조회 실패:", error instanceof Error ? error.name : "unknown");

    return NextResponse.json({ message: "가입자 목록을 읽지 못했어요." }, { status: 500, headers: NO_STORE });
  }
}
