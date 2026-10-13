// components/admin/factory/StudioAccessKeys.tsx
// Studio 접근 키: 앱 이름별 발급(원문은 한 번만 표시)·상태·폐기. 서버1 nginx 가 /api/studio-auth/verify 로 확인한다. docs/studio-access.md
// 원문은 이 화면 상태(state)에만 잠깐 있고 저장하지 않는다. 새로고침·닫기 하면 다시 볼 수 없다.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";

import { StatusDot } from "./fx";

interface Item {
  app: string;
  active: boolean;
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

const APP_RE = /^[a-z0-9-]{3,40}$/;
const input = "w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 font-mono text-base sm:text-sm";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-");

export default function StudioAccessKeys() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [pepperReady, setPepperReady] = useState<boolean | null>(null);
  const [app, setApp] = useState("");
  const [issued, setIssued] = useState<{ app: string; key: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/studio-keys", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));

      if (res.ok) {
        setItems(d.items);
        setPepperReady(!!d.pepperReady);
      } else setMessage(d.message ?? "목록을 읽지 못했어요.");
    } catch {
      setMessage("서버에 연결하지 못했어요.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (method: "POST" | "DELETE", target: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/factory/studio-keys", {
        method,
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: target }),
      });
      const d = await res.json().catch(() => ({}));

      if (res.ok && method === "POST") {
        setIssued({ app: d.app, key: d.key });
        setApp("");
      } else setMessage(res.ok ? `${target} 키를 폐기했어요. 이 키로는 바로 못 열어요.` : (d.message ?? "처리하지 못했어요."));
    } catch {
      setMessage("서버에 연결하지 못했어요.");
    }
    setBusy(false);
    load();
  };

  const issue = (target: string) => {
    const active = items?.some((i) => i.app === target && i.active);

    if (!window.confirm(active ? `${target} 의 새 키를 발급할까요?\n지금 쓰는 키는 바로 무효가 돼요.` : `${target} 의 Studio 접근 키를 발급할까요?`)) return;
    send("POST", target);
  };

  const revoke = (target: string) => {
    if (!window.confirm(`${target} 키를 폐기할까요?\n이 키로는 바로 /studio/ 를 열 수 없어요. 되돌릴 수 없어요.`)) return;
    send("DELETE", target);
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

  const target = app.trim();

  return (
    <Card id="studio-keys">
      <CardHeader className="flex-col items-start gap-1">
        <h2 className="text-lg font-bold">Studio 접근 키</h2>
        <p className="text-xs fx-muted">
          밖에서 /studio/ (Prop Studio 등)를 열 때 쓰는 키예요. 서버1 nginx 가 요청마다 홈페이지에 맞는 키인지 물어봐요. 앱마다 유효한 키는
          하나이고, 새로 발급하면 이전 키는 바로 무효가 돼요. 서버에는 키 원문을 남기지 않아요. 설정 방법: docs/studio-access.md
        </p>
      </CardHeader>
      <CardBody className="space-y-4">
        {message && <p className="break-words text-sm text-default-600">{message}</p>}

        {pepperReady === false && (
          <p className="rounded-lg border border-warning-300 p-3 text-sm">
            먼저 비밀값을 등록하세요. 위 &apos;외부 서비스 키&apos;에 이름 <span className="font-mono">STUDIO_KEY_PEPPER</span>, 값은 32자 이상의 아무
            난수로 등록하면 발급할 수 있어요. 비밀값을 바꾸면 이미 발급한 키는 모두 다시 발급해야 해요.
          </p>
        )}

        {issued && (
          <div className="space-y-2 rounded-lg border-2 border-warning-400 p-3">
            <p className="text-base font-bold">
              {issued.app} 키는 지금 한 번만 보여요. 새로고침하거나 이 창을 닫으면 다시 볼 수 없어요.
            </p>
            <p className="text-xs fx-muted">브라우저가 /studio/ 에서 아이디·비밀번호를 물으면 아이디는 아무거나, 비밀번호에 이 키를 넣어요.</p>
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

        {items?.length === 0 && <p className="text-sm fx-muted">발급한 키가 없어요.</p>}
        {items?.map((i) => (
          <div key={i.app} className="flex flex-wrap items-center justify-between gap-2 border-b border-default-100 pb-2 text-sm">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2">
                <StatusDot hollow={!i.active} tone={i.active ? "ok" : "idle"} />
                <span className="font-mono font-semibold">{i.app}</span>
                <span className="text-xs fx-muted">{i.active ? "유효" : "발급 없음(폐기됨)"}</span>
              </div>
              <div className="font-mono text-xs fx-muted">
                {i.active ? `발급 ${when(i.createdAt)} · 마지막 사용 ${i.lastUsedAt ? when(i.lastUsedAt) : "아직 없음"}` : `폐기 ${when(i.revokedAt)}`}
              </div>
            </div>
            <div className="flex gap-2">
              <Button isDisabled={busy || !pepperReady} size="sm" variant="flat" onPress={() => issue(i.app)}>
                {i.active ? "새로 발급" : "키 발급"}
              </Button>
              {i.active && (
                <Button color="danger" isDisabled={busy} size="sm" variant="light" onPress={() => revoke(i.app)}>
                  폐기
                </Button>
              )}
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-2 border-t border-default-200 pt-3 sm:flex-row sm:items-end">
          <label className="block flex-1 text-xs">
            <span className="fx-muted">앱 이름 (영어 소문자·숫자·하이픈 3~40자)</span>
            <input
              autoComplete="off"
              className={input}
              list="studio-key-apps"
              placeholder="sprout-hub"
              spellCheck={false}
              value={app}
              onChange={(e) => setApp(e.target.value.toLowerCase())}
            />
            <datalist id="studio-key-apps">
              {items?.map((i) => <option key={i.app} value={i.app} />)}
            </datalist>
          </label>
          <Button color="primary" isDisabled={busy || !pepperReady || !APP_RE.test(target)} onPress={() => issue(target)}>
            키 발급
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
