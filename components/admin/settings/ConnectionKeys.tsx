// components/admin/settings/ConnectionKeys.tsx
// 연결 키(서버끼리 쓰는 키): 만들기(원문은 한 번만 표시)·목록·폐기. 관리자 설정 화면(/admin/settings)에서 쓴다.
// 원문은 이 화면 상태(state)에만 잠깐 있고 저장하지 않는다. 새로고침·닫기 하면 다시 볼 수 없다. 표는 통제실 배포 후에 생긴다.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";

interface Item {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const input = "w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-");

export default function ConnectionKeys() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState<{ label: string; key: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/connection-keys", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));

      if (res.ok) {
        setItems(d.items);
        setAvailable(d.available !== false);
      } else setMessage(d.message ?? "목록을 읽지 못했어요.");
    } catch {
      setMessage("서버에 연결하지 못했어요.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/factory/connection-keys", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const d = await res.json().catch(() => ({}));

      if (res.ok) {
        setIssued({ label: d.label, key: d.key });
        setLabel("");
      } else setMessage(d.message ?? "처리하지 못했어요.");
    } catch {
      setMessage("서버에 연결하지 못했어요.");
    }
    setBusy(false);
    load();
  };

  const revoke = async (item: Item) => {
    if (!window.confirm(`연결 키 "${item.label}"(${item.prefix}…)를 폐기할까요?\n이 키를 쓰는 서버는 바로 연결이 끊겨요. 되돌릴 수 없어요.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/factory/connection-keys", {
        method: "DELETE",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const d = await res.json().catch(() => ({}));

      setMessage(res.ok ? `"${item.label}" 키를 폐기했어요.` : (d.message ?? "처리하지 못했어요."));
    } catch {
      setMessage("서버에 연결하지 못했어요.");
    }
    setBusy(false);
    load();
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.key);
      setMessage("복사했어요.");
    } catch {
      setMessage("복사하지 못했어요. 직접 선택해서 복사하세요.");
    }
  };

  return (
    <Card id="connection-keys">
      <CardHeader className="flex-col items-start gap-1">
        <h2 className="text-lg font-bold">연결 키</h2>
        <p className="text-xs fx-muted">
          서버끼리(블로그 ↔ 통제실) 부르는 데 쓰는 키예요. 서버에는 키 원문을 남기지 않고 앞 8자만 보여요.
        </p>
      </CardHeader>
      <CardBody className="space-y-4">
        {message && <p className="break-words text-sm text-default-600">{message}</p>}

        {!available && <p className="rounded-lg border border-warning-300 p-3 text-sm">통제실 배포 후 사용 가능해요. (연결 키 표가 아직 없어요.)</p>}

        {issued && (
          <div className="space-y-2 rounded-lg border-2 border-warning-400 p-3">
            <p className="text-base font-bold">
              &quot;{issued.label}&quot; 키는 지금 한 번만 보여요. 새로고침하거나 이 창을 닫으면 다시 볼 수 없어요.
            </p>
            <code className="block select-all break-all rounded bg-default-100 p-2 text-xs">{issued.key}</code>
            <div className="flex gap-2">
              <Button color="primary" size="sm" onPress={copy}>
                복사
              </Button>
              <Button size="sm" variant="flat" onPress={() => setIssued(null)}>
                복사했어요, 닫기
              </Button>
            </div>
          </div>
        )}

        {items?.length === 0 && available && <p className="text-sm fx-muted">만든 연결 키가 없어요.</p>}
        {items?.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-default-100 pb-2 text-sm">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2">
                <span aria-hidden className={`fx-dot ${i.revokedAt ? "fx-idle fx-hollow" : "fx-ok"}`} />
                <span className="font-semibold">{i.label}</span>
                <span className="font-mono text-xs fx-muted">{i.prefix}…</span>
                <span className="text-xs fx-muted">{i.revokedAt ? "폐기됨" : "유효"}</span>
              </div>
              <div className="font-mono text-xs fx-muted">
                만든 날 {when(i.createdAt)} · 마지막 사용 {i.lastUsedAt ? when(i.lastUsedAt) : "아직 없음"}
                {i.revokedAt ? ` · 폐기 ${when(i.revokedAt)}` : ""}
              </div>
            </div>
            {!i.revokedAt && (
              <Button color="danger" isDisabled={busy} size="sm" variant="light" onPress={() => revoke(i)}>
                폐기
              </Button>
            )}
          </div>
        ))}

        <div className="flex flex-col gap-2 border-t border-default-200 pt-3 sm:flex-row sm:items-end">
          <label className="block flex-1 text-xs">
            <span className="fx-muted">새 키 이름 (40자까지)</span>
            <input
              autoComplete="off"
              className={input}
              maxLength={40}
              placeholder="블로그 서버"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <Button color="primary" isDisabled={busy || !available || !label.trim()} onPress={create}>
            새 키 만들기
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
