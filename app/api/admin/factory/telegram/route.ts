// app/api/admin/factory/telegram/route.ts
// 텔레그램 설정 확인, 웹훅 등록, 테스트 알림. 관리자만. (토큰 값은 절대 돌려주지 않는다)
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { telegramStatus, tg } from "@/lib/factory/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const base = () =>
  (
    process.env.FACTORY_PUBLIC_URL?.trim() || "https://www.buyoungsilcoding.com"
  ).replace(/\/+$/, "");

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  const status = telegramStatus();
  let webhookUrl: string | null = null;

  if (status.botToken) {
    const info = await tg("getWebhookInfo", {});
    const url = (info?.result as { url?: string } | undefined)?.url;

    webhookUrl = url ? url : null;
  }

  return NextResponse.json({
    status,
    webhookUrl,
    expectedWebhookUrl: `${base()}/api/telegram/webhook`,
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const status = telegramStatus();

  if (body.action === "setup") {
    if (!status.botToken || !status.webhookSecret) {
      return NextResponse.json(
        {
          message:
            "TELEGRAM_BOT_TOKEN 과 TELEGRAM_WEBHOOK_SECRET 이 서버에 설정돼 있어야 해요.",
        },
        { status: 400 },
      );
    }
    const res = await tg("setWebhook", {
      url: `${base()}/api/telegram/webhook`,
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET?.trim(),
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });

    return res?.ok
      ? NextResponse.json({
          message: "웹훅을 등록했어요. 이제 봇에게 /start 를 보내 보세요.",
        })
      : NextResponse.json(
          {
            message: `웹훅 등록에 실패했어요: ${res?.description ?? "텔레그램에 연결하지 못했어요."}`,
          },
          { status: 502 },
        );
  }

  if (body.action === "test") {
    if (!status.botToken || !status.chatId) {
      return NextResponse.json(
        {
          message:
            "TELEGRAM_BOT_TOKEN 과 TELEGRAM_CHAT_ID 가 서버에 설정돼 있어야 해요.",
        },
        { status: 400 },
      );
    }
    const res = await tg("sendMessage", {
      chat_id: process.env.TELEGRAM_CHAT_ID?.trim(),
      text: "🔔 앱 공장 테스트 알림이에요. 이 알림이 보이면 연결이 된 거예요.",
      reply_markup: {
        inline_keyboard: [
          [{ text: "통제실 열기", url: `${base()}/admin/factory` }],
        ],
      },
    });

    return res?.ok
      ? NextResponse.json({
          message: "테스트 알림을 보냈어요. 텔레그램을 확인하세요.",
        })
      : NextResponse.json(
          {
            message: `보내지 못했어요: ${res?.description ?? "텔레그램에 연결하지 못했어요."}`,
          },
          { status: 502 },
        );
  }

  return NextResponse.json(
    { message: "알 수 없는 동작이에요." },
    { status: 400 },
  );
}
