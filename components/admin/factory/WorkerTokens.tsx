// components/admin/factory/WorkerTokens.tsx
// 작업 PC 접속 토큰: 발급(원문은 한 번만 표시), 마지막 접속 시각, 삭제.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader, Chip, Input } from "@heroui/react";

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const REFRESH_MS = 10_000;
const ONLINE_MS = 90_000; // 감독 프로그램이 이 안에 접속했으면 "연결됨"

const rel = (iso: string | null, now: number) => {
  if (!iso) return "아직 접속 없음";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));

  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;

  return `${Math.floor(s / 86400)}일 전`;
};

export default function WorkerTokens() {
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState("mainpc");
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/tokens", {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setTokens(data.tokens);
        setNow(Date.now());
      } else {
        setMessage(
          data.message ??
            "토큰 목록을 읽지 못했어요. 마이그레이션이 적용됐는지 확인하세요.",
        );
      }
    } catch {
      setMessage("서버에 연결하지 못했어요.");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);

    return () => clearInterval(t);
  }, [load]);

  const issue = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/factory/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setIssued({ name: data.item.name, token: data.token });
        await load();
      } else {
        setMessage(data.message ?? "발급하지 못했어요.");
      }
    } catch {
      setMessage("서버에 연결하지 못했어요.");
    }
    setBusy(false);
  };

  const remove = async (t: TokenRow) => {
    if (
      !window.confirm(
        `${t.name} (${t.prefix}…) 토큰을 지울까요? 이 토큰을 쓰는 PC는 바로 접속이 끊겨요.`,
      )
    )
      return;
    const res = await fetch(
      `/api/admin/factory/tokens?id=${encodeURIComponent(t.id)}`,
      { method: "DELETE" },
    );
    const data = await res.json().catch(() => ({}));

    setMessage(res.ok ? "지웠어요." : (data.message ?? "지우지 못했어요."));
    await load();
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setMessage("복사했어요.");
    } catch {
      setMessage("복사하지 못했어요. 직접 선택해서 복사하세요.");
    }
  };

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <h2 className="text-lg font-bold">🔌 작업 PC 연결</h2>
        <p className="text-xs text-default-500">
          감독 프로그램이 이 홈페이지에 접속할 때 쓰는 토큰이에요. 여기서
          발급하면 서버 설정 파일을 고치거나 다시 배포하지 않아도 바로 쓸 수
          있어요. 토큰 원문은 발급할 때 한 번만 보여요.
        </p>
      </CardHeader>
      <CardBody className="space-y-3">
        {message && <p className="text-sm text-default-600">{message}</p>}

        {issued && (
          <div className="space-y-2 rounded-lg border border-warning-300 bg-warning-50 p-3 dark:bg-warning-50/10">
            <p className="text-sm font-semibold">
              {issued.name} 토큰이 발급됐어요. 지금 복사해서 PC에 넣으세요. 이
              창을 닫으면 다시 볼 수 없어요.
            </p>
            <code className="block break-all rounded bg-default-100 p-2 font-mono text-xs">
              {issued.token}
            </code>
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

        {tokens?.length === 0 && (
          <p className="text-sm text-default-500">발급된 토큰이 없어요.</p>
        )}
        {tokens?.map((t) => {
          const online = t.lastUsedAt
            ? now - new Date(t.lastUsedAt).getTime() < ONLINE_MS
            : false;

          return (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Chip
                  color={online ? "success" : "default"}
                  size="sm"
                  variant="flat"
                >
                  {online ? "연결됨" : "끊김"}
                </Chip>
                <span className="font-mono font-semibold">{t.name}</span>
                <span className="font-mono text-xs text-default-400">
                  {t.prefix}…
                </span>
                <span className="truncate text-xs text-default-500">
                  마지막 접속: {rel(t.lastUsedAt, now)}
                </span>
              </div>
              <Button
                color="danger"
                size="sm"
                variant="light"
                onPress={() => remove(t)}
              >
                삭제
              </Button>
            </div>
          );
        })}

        <div className="flex flex-col gap-2 border-t border-default-200 pt-3 sm:flex-row">
          <Input
            label="기기 이름"
            placeholder="mainpc"
            size="sm"
            value={name}
            onValueChange={setName}
          />
          <Button
            color="primary"
            isDisabled={busy || !name.trim()}
            onPress={issue}
          >
            토큰 발급
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
