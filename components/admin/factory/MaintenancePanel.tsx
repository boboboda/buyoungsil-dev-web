// components/admin/factory/MaintenancePanel.tsx
// 감독 프로그램 카드 안의 "공장 정비": 공장 자체(홈페이지·감독 프로그램 코드)를 고치는 대화형 스레드. 앱 일감과 따로 돈다.
// 여기서 보낸 지시는 바로 대기열에, 채팅(커넥터)에서 온 지시는 여기서 승인한다. 결과가 GitHub 에 올라가고 서버 코드가 바뀌었으면 [배포].
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Chip } from "@heroui/react";

interface Msg {
  id: string;
  role: "user" | "assistant" | "log" | "system";
  text: string;
  status: string | null;
  source: string | null;
  createdAt: string;
}

interface Thread {
  id: string;
  title: string;
  status: string;
  activeTurn: { id: string; status: string; source: string | null } | null;
  pushedCommit: string | null;
  needsDeploy: boolean;
  deploy: { commit: string | null; requestedAt: string | null; startedAt: string | null; deployedAt: string | null; result: string | null };
  updatedAt: string;
  messages: Msg[];
}

interface Data {
  hold: boolean;
  threads: Thread[];
  message?: string;
  id?: string;
}

const TURN_LABEL: Record<string, string> = {
  awaiting_approval: "승인 기다림",
  queued: "대기열",
  running: "진행 중",
  done: "완료",
  failed: "실패",
  cancelled: "취소",
};

function deployState(t: Thread): string | null {
  const d = t.deploy;

  if (d.startedAt && !d.deployedAt && !d.result) return "🚀 배포 중(빌드 3~4분)";
  if (d.requestedAt && !d.startedAt) return "🚀 배포 요청됨(PC가 받아 가는 중)";
  if (d.deployedAt) return `✅ 배포 완료 ${new Date(d.deployedAt).toLocaleString("ko-KR")}`;
  if (d.result) return `⚠️ ${d.result.slice(0, 120)}`;
  if (t.needsDeploy) return "⏳ 배포 필요(서버 코드가 바뀜)";

  return null;
}

export default function MaintenancePanel() {
  const [data, setData] = useState<Data | null>(null);
  const [sel, setSel] = useState<string>("new");
  const [text, setText] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/maintenance", { cache: "no-store" });

      if (res.ok) setData((await res.json()) as Data);
    } catch {
      /* 그대로 둔다 */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);

    return () => clearInterval(t);
  }, [load]);

  const thread = data?.threads.find((t) => t.id === sel) ?? null;
  const msgCount = thread?.messages.length ?? 0;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [msgCount, sel]);

  const post = async (body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/factory/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json().catch(() => ({}))) as Data;

      if (d.threads) setData(d);
      if (res.ok && body.action === "send") {
        setText("");
        if (d.id) setSel(d.id);
      }
      setNotice(d.message ?? (res.ok ? "처리했어요." : "처리하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
  };

  const open = data?.threads.filter((t) => t.status === "open") ?? [];
  const closed = data?.threads.filter((t) => t.status !== "open") ?? [];
  const canSend = sel === "new" || (thread && thread.status === "open" && !thread.activeTurn);
  const visible = thread?.messages.filter((m) => showLogs || m.role !== "log") ?? [];

  return (
    <div className="space-y-2 border-t border-default-200 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold">🛠 공장 정비</span>
        <span className="text-xs text-default-500">
          홈페이지·감독 프로그램 코드를 고치는 대화예요. 정비가 대기·진행 중이면 새 앱 일감은 멈춰요.
          {data?.hold ? " (지금 앱 일감 멈춤)" : ""}
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select className="w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:flex-1 sm:text-sm" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="new">＋ 새 정비</option>
          {open.map((t) => (
            <option key={t.id} value={t.id}>
              {t.activeTurn ? `[${TURN_LABEL[t.activeTurn.status] ?? t.activeTurn.status}] ` : t.needsDeploy && !t.deploy.deployedAt ? "[배포 필요] " : ""}
              {t.title}
            </option>
          ))}
          {closed.length > 0 && (
            <optgroup label="닫힌 정비">
              {closed.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {thread && (
          <div className="flex gap-2">
            <Button className="min-h-11 flex-1 sm:min-h-0 sm:flex-none" size="sm" variant="light" onPress={() => setShowLogs((v) => !v)}>
              {showLogs ? "로그 숨기기" : "로그 보기"}
            </Button>
            {thread.status === "open" && (
              <Button
                className="min-h-11 flex-1 sm:min-h-0 sm:flex-none"
                isDisabled={busy || !!thread.activeTurn}
                size="sm"
                variant="light"
                onPress={() => post({ action: "close", threadId: thread.id }, "이 정비를 닫을까요? (기록은 남아요)")}
              >
                닫기
              </Button>
            )}
          </div>
        )}
      </div>

      {thread && (
        <div className="max-h-[420px] space-y-2 overflow-y-auto rounded-lg border border-default-200 p-2">
          {visible.map((m) =>
            m.role === "log" ? (
              <div key={m.id} className="break-all font-mono text-[11px] text-default-400">
                {m.text}
              </div>
            ) : (
              <div
                key={m.id}
                className={`rounded-lg p-2 text-sm ${m.role === "user" ? "ml-6 bg-primary-50 dark:bg-primary-50/10" : m.role === "system" ? "bg-warning-50 text-xs dark:bg-warning-50/10" : "mr-6 bg-default-100"}`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-default-500">
                  <span>{m.role === "user" ? `👤 지시${m.source ? ` · ${m.source}` : ""}` : m.role === "assistant" ? "🤖 결과" : "ℹ️ 알림"}</span>
                  <span>{new Date(m.createdAt).toLocaleString("ko-KR")}</span>
                  {m.status && (
                    <Chip color={m.status === "failed" ? "danger" : m.status === "done" ? "success" : "warning"} size="sm" variant="flat">
                      {TURN_LABEL[m.status] ?? m.status}
                    </Chip>
                  )}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.text}</div>
                {m.role === "user" && m.status === "awaiting_approval" && (
                  <div className="mt-2 flex gap-2">
                    <Button color="primary" isDisabled={busy} size="sm" onPress={() => post({ action: "approve", turnId: m.id })}>
                      승인
                    </Button>
                    <Button isDisabled={busy} size="sm" variant="flat" onPress={() => post({ action: "cancel", turnId: m.id })}>
                      거절
                    </Button>
                  </div>
                )}
                {m.role === "user" && m.status === "queued" && (
                  <Button className="mt-2" isDisabled={busy} size="sm" variant="flat" onPress={() => post({ action: "cancel", turnId: m.id }, "이 지시를 취소할까요?")}>
                    취소
                  </Button>
                )}
              </div>
            ),
          )}
          <div ref={bottom} />
        </div>
      )}

      {thread && (thread.pushedCommit || deployState(thread)) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {thread.pushedCommit && <span className="text-xs text-default-500">GitHub 에 올린 커밋 {thread.pushedCommit.slice(0, 7)}</span>}
          {deployState(thread) && <span className="text-xs">{deployState(thread)}</span>}
          {thread.needsDeploy && thread.pushedCommit && !(thread.deploy.requestedAt && !thread.deploy.result && !thread.deploy.deployedAt) && (
            <Button
              className="min-h-11 sm:min-h-0"
              color="danger"
              isDisabled={busy}
              size="sm"
              onPress={() => post({ action: "deploy", threadId: thread.id }, `커밋 ${thread.pushedCommit?.slice(0, 7)} 을 홈페이지 서버에 배포할까요?\n(빌드 3~4분, 그동안 잠깐 끊길 수 있어요)`)}
            >
              🚀 배포
            </Button>
          )}
        </div>
      )}

      {canSend ? (
        <div className="space-y-2">
          <textarea
            className="min-h-[80px] w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm"
            maxLength={8000}
            placeholder={sel === "new" ? "고칠 내용을 적어 주세요. 예: 통제실 일감 목록에 앱 종류(stack) 필터를 추가해 줘" : "이어서 지시할 내용(같은 Claude 세션에 이어서 처리해요)"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            className="min-h-11 sm:min-h-0"
            color="primary"
            isDisabled={busy || text.trim().length < 5}
            size="sm"
            onPress={() => post({ action: "send", text, ...(sel !== "new" ? { threadId: sel } : {}) })}
          >
            {busy ? "보내는 중…" : sel === "new" ? "새 정비 시작" : "이어서 지시"}
          </Button>
        </div>
      ) : (
        thread?.activeTurn && <p className="text-xs text-default-500">지시를 처리하는 중이에요. 끝나면 이어서 지시할 수 있어요.</p>
      )}
      {notice && <p className="text-sm text-default-600">{notice}</p>}
    </div>
  );
}
