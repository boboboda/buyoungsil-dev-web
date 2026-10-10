// components/admin/factory/RevisionSender.tsx
// 통제실에서 완성된 앱에 간단한 수정 지시를 바로 보낸다. (채팅을 거치지 않는 경로. 결과는 채팅에서도 읽을 수 있다)
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";

interface DoneJob {
  appSlug: string;
  title: string;
}

export default function RevisionSender() {
  const [apps, setApps] = useState<DoneJob[]>([]);
  const [appSlug, setAppSlug] = useState("");
  const [instruction, setInstruction] = useState("");
  const [runNow, setRunNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadApps = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/jobs?status=done&limit=100", {
        cache: "no-store",
      });
      const data = (await res.json()) as { jobs?: DoneJob[] };
      const seen = new Set<string>();
      const list: DoneJob[] = [];

      for (const j of data.jobs ?? []) {
        if (seen.has(j.appSlug)) continue;
        seen.add(j.appSlug);
        list.push({ appSlug: j.appSlug, title: j.title });
      }
      setApps(list);
      setAppSlug((cur) => cur || list[0]?.appSlug || "");
    } catch {
      /* 목록을 못 읽어도 화면은 그대로 둔다 */
    }
  }, []);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  const send = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/factory/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appSlug, instruction, runNow }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };

      setNotice(data.message ?? (res.ok ? "보냈어요." : "보내지 못했어요."));
      if (res.ok) setInstruction("");
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
  };

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-col items-start gap-1">
        <span className="font-semibold">✏️ 수정 지시 바로 보내기</span>
        <span className="text-xs text-default-500">
          완성된 앱에 간단한 수정만 보낼 때 쓰세요. 보낸 내용과 결과는 Claude
          채팅에서도 읽을 수 있어요.
        </span>
      </CardHeader>
      <CardBody className="space-y-3">
        {apps.length === 0 ? (
          <p className="text-sm text-default-500">아직 완성된 앱이 없어요.</p>
        ) : (
          <>
            <select
              className="w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm"
              value={appSlug}
              onChange={(e) => setAppSlug(e.target.value)}
            >
              {apps.map((a) => (
                <option key={a.appSlug} value={a.appSlug}>
                  {a.title} ({a.appSlug})
                </option>
              ))}
            </select>
            <textarea
              className="min-h-[96px] w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm"
              maxLength={5000}
              placeholder="고칠 내용만 적어 주세요. 예: 버튼 색을 주황색으로 바꾸고, 숫자를 0으로 되돌리는 초기화 버튼을 추가해 줘"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={runNow}
                type="checkbox"
                onChange={(e) => setRunNow(e.target.checked)}
              />
              보내면 바로 승인해서 시작하기
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <Button
                className="min-h-11 sm:min-h-0"
                color="primary"
                isDisabled={busy || !appSlug || instruction.trim().length < 5}
                size="sm"
                onPress={send}
              >
                {busy ? "보내는 중…" : "수정 지시 보내기"}
              </Button>
              {notice && (
                <span className="text-sm text-default-600">{notice}</span>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
