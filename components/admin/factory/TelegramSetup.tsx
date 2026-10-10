// components/admin/factory/TelegramSetup.tsx
// 텔레그램 알림 설정 상태 확인, 웹훅 등록, 테스트 알림. (값은 서버 환경변수에 있고 여기서는 있는지 없는지만 본다)
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";

interface Info {
  status: {
    botToken: boolean;
    chatId: boolean;
    webhookSecret: boolean;
    approveButtons: boolean;
  };
  webhookUrl: string | null;
  expectedWebhookUrl: string;
}

const Mark = ({ ok }: { ok: boolean }) => <span>{ok ? "✅" : "⬜"}</span>;

export default function TelegramSetup() {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/telegram", {
        cache: "no-store",
      });

      if (res.ok) setInfo((await res.json()) as Info);
    } catch {
      /* 못 읽으면 그대로 둔다 */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: "setup" | "test") => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/factory/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };

      setNotice(
        data.message ?? (res.ok ? "처리했어요." : "처리하지 못했어요."),
      );
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
    await load();
  };

  const webhookOk = !!info && info.webhookUrl === info.expectedWebhookUrl;

  return (
    <Card>
      <CardHeader className="flex flex-col items-start gap-1">
        <span className="font-semibold">🔔 텔레그램 알림</span>
        <span className="text-xs text-default-500">
          승인 대기, 완료, 실패를 텔레그램으로 알려요. 값은 서버 환경변수에
          두고, 여기서는 설정 여부만 보여요.
        </span>
      </CardHeader>
      <CardBody className="space-y-3 text-sm">
        {!info ? (
          <p className="text-default-500">상태를 읽는 중…</p>
        ) : (
          <ul className="space-y-1">
            <li>
              <Mark ok={info.status.botToken} /> TELEGRAM_BOT_TOKEN
            </li>
            <li>
              <Mark ok={info.status.webhookSecret} /> TELEGRAM_WEBHOOK_SECRET
            </li>
            <li>
              <Mark ok={info.status.chatId} /> TELEGRAM_CHAT_ID
            </li>
            <li>
              <Mark ok={webhookOk} /> 웹훅 등록
              {info.webhookUrl && !webhookOk
                ? " (주소가 달라요. 다시 등록하세요)"
                : ""}
            </li>
            <li>
              <Mark ok={info.status.approveButtons} /> 알림에 [승인] 버튼
              (TELEGRAM_APPROVE_BUTTONS=true)
            </li>
          </ul>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="min-h-11 sm:min-h-0"
            isDisabled={
              busy || !info?.status.botToken || !info?.status.webhookSecret
            }
            size="sm"
            variant="flat"
            onPress={() => run("setup")}
          >
            웹훅 등록
          </Button>
          <Button
            className="min-h-11 sm:min-h-0"
            color="primary"
            isDisabled={busy || !info?.status.botToken || !info?.status.chatId}
            size="sm"
            onPress={() => run("test")}
          >
            테스트 알림 보내기
          </Button>
        </div>
        {notice && <p className="text-default-600">{notice}</p>}
      </CardBody>
    </Card>
  );
}
