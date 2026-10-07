// 초안 수신 엔드포인트. 스킬/커넥터가 Bearer 토큰으로 호출한다.
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { isValidDraftToken } from "@/lib/drafts/auth";
import { parseDraftInput } from "@/lib/drafts/validate";

export async function POST(request: NextRequest) {
  if (!isValidDraftToken(request.headers.get("authorization"))) {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON 형식이 아니에요." }, { status: 400 });
  }

  const parsed = parseDraftInput(body);
  if (parsed.ok === false) {
    return NextResponse.json({ message: parsed.message }, { status: 400 });
  }

  const draft = await prisma.draft.create({ data: parsed.data, select: { id: true } });

  // 초안은 항상 대기(pending) 상태로만 쌓인다. 공개는 관리자가 초안함에서 보낸 뒤에도 비공개로 시작한다.
  return NextResponse.json({ success: true, id: draft.id }, { status: 201 });
}
