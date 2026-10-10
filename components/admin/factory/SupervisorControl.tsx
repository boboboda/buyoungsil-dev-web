// components/admin/factory/SupervisorControl.tsx
// 감독 프로그램 상태(연결/꺼짐)와 일시 정지·재개 스위치.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody } from "@heroui/react";

interface State {
  enabled: boolean;
  online: boolean;
  lastSeenAt: string | null;
  workerName: string | null;
  running: number;
  approved: number;
}

export default function SupervisorControl() {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/control", {
        cache: "no-store",
      });

      if (res.ok) setS((await res.json()) as State);
    } catch {
      /* 못 읽으면 그대로 둔다 */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);

    return () => clearInterval(t);
  }, [load]);

  const toggle = async () => {
    if (!s) return;
    if (
      s.enabled &&
      !window.confirm(
        "일시 정지할까요?\n진행 중인 작업은 끝까지 하고, 새 일감만 가져가지 않아요.",
      )
    )
      return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/factory/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      const data = (await res.json().catch(() => ({}))) as State & {
        message?: string;
      };

      if (res.ok) setS(data);
      setNotice(data.message ?? (res.ok ? "처리했어요." : "처리하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
  };

  let badge = "읽는 중…";
  let hint = "";

  if (s) {
    if (!s.online) {
      badge = "🔴 PC 꺼짐";
      hint =
        "감독 프로그램이 응답하지 않아요. PC가 켜져 있는지 확인하세요. (홈페이지에서 PC 프로그램을 켤 수는 없어요)";
    } else if (!s.enabled) {
      badge = "⏸️ 일시 정지";
      hint = "연결은 되어 있고, 새 일감은 가져가지 않아요.";
    } else {
      badge = "🟢 작동 중";
      hint = "승인된 일감을 가져가서 만들어요.";
    }
  }

  return (
    <Card className="mb-6">
      <CardBody className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">🤖 감독 프로그램: {badge}</div>
            {s && (
              <div className="text-xs text-default-500">
                진행 중 {s.running}개 · 승인 대기열 {s.approved}개
                {s.lastSeenAt
                  ? ` · 마지막 응답 ${new Date(s.lastSeenAt).toLocaleTimeString("ko-KR")}`
                  : ""}
              </div>
            )}
          </div>
          <Button
            className="min-h-11 w-full sm:min-h-0 sm:w-auto"
            color={s?.enabled ? "warning" : "success"}
            isDisabled={busy || !s}
            size="sm"
            onPress={toggle}
          >
            {s?.enabled ? "⏸️ 일시 정지" : "▶️ 다시 시작"}
          </Button>
        </div>
        {hint && <p className="text-sm text-default-600">{hint}</p>}
        {notice && <p className="text-sm text-default-600">{notice}</p>}
      </CardBody>
    </Card>
  );
}
