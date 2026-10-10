// app/api/telegram/webhook/route.ts
// 텔레그램이 알림 버튼 클릭 등을 보내 주는 주소. 비밀 헤더(secret_token)가 맞지 않으면 처리하지 않는다.
import { NextRequest, NextResponse } from "next/server";

import { handleUpdate, isValidWebhook } from "@/lib/factory/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isValidWebhook(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 401 });
  }

  let update: unknown;

  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    await handleUpdate(update as Parameters<typeof handleUpdate>[0]);
  } catch {
    console.error("[telegram] 웹훅 처리 실패");
  }

  // 텔레그램이 같은 요청을 다시 보내지 않도록 항상 200 으로 답한다.
  return NextResponse.json({ ok: true });
}
