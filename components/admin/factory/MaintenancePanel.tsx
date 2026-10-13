// components/admin/factory/MaintenancePanel.tsx
// 감독 프로그램 카드 안의 "공장 정비": 공장 자체(홈페이지·감독 프로그램 코드)를 고치는 대화형 스레드. 앱 일감과 따로 돈다.
// 여기서 보낸 지시는 바로 대기열에, 채팅(커넥터)에서 온 지시는 여기서 승인한다. 처리 중이어도 지시는 대기열에 쌓이고 보낸 순서대로 하나씩 돈다.
// 앞 지시가 실패하면 대기열이 멈추고 [계속 진행]·[재시도]·[대기열 비우기]. 배포는 대기열이 다 끝난 뒤 한 번([지금 배포]는 확인 뒤 언제든).
"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Button, Chip } from "@heroui/react";
import AiEngineSelect from "./AiEngineSelect";
import ClaudeModelSelect, { ModelTag } from "./ClaudeModelSelect";
import { AI_LABELS, type AiEngine, type TaskAiEngine, type TaskModel } from "@/lib/factory/ai";
import type { HandoffEntry } from "@/lib/factory/handoff";
import HandoffBox from "./HandoffBox";

interface Msg {
  aiEngine?: AiEngine;
  aiModel?: string | null; // 지시: 고른 모델, 결과: 실행한 모델(없으면 기본 설정)
  id: string;
  turnId?: string | null; // 로그(log): 이 로그를 남긴 지시 id(예전 로그는 없음)
  role: "user" | "assistant" | "log" | "system";
  text: string;
  status: string | null;
  source: string | null;
  createdAt: string;
  handoff?: HandoffEntry | null; // 결과(assistant) 메시지: 이 지시가 끝날 때 남긴 인계 기록(없으면 칸 숨김)
}

interface Thread {
  id: string;
  title: string;
  status: string;
  activeTurn: { id: string; status: string; source: string | null } | null;
  activeTurns?: number;
  pushedCommit: string | null;
  needsDeploy: boolean;
  deploy: { commit: string | null; requestedAt: string | null; startedAt: string | null; deployedAt: string | null; result: string | null };
  updatedAt: string;
  messages: Msg[];
}

interface QueueItem {
  aiEngine?: AiEngine;
  aiModel?: string | null;
  position: number;
  turnId: string;
  threadId: string;
  threadTitle: string;
  status: string;
  source: string | null;
  firstLine: string;
  wait: string | null;
}

interface Queue {
  items: QueueItem[];
  left: number;
  halted: { turnId: string; threadId: string; at: string; threadTitle: string; firstLine: string } | null;
  recent: { turnId: string; threadId: string; threadTitle: string; status: string | null; firstLine: string; pushedCommit: string | null; finishedAt: string | null }[];
}

interface Bundle {
  items: { turnId: string | null; threadId: string; title: string; commit: string }[];
  commit: string | null;
  threadId: string | null;
  queueLeft: number;
  inProgress: { threadId: string; title: string; commit: string | null; started: boolean; requestedAt: string | null } | null;
  canDeploy: boolean;
  lastResult: { ok: boolean | null; result: string | null; commit: string; finishedAt: string | null } | null;
}

interface Data {
  hold: boolean;
  queue?: Queue; // 예전 서버에는 없다
  deploy?: Bundle;
  autoDeploy?: boolean;
  threads: Thread[];
  message?: string;
  id?: string;
}

const TURN_LABEL: Record<string, string> = {
  awaiting_approval: "승인 대기",
  queued: "대기",
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
  if (t.needsDeploy) return "⏳ 배포 필요(서버 코드가 바뀜 — 위 배포 묶음에 들어가요)";

  return null;
}

/** 지시 하나의 진행 로그. 진행 중이면 펼쳐서 아래로 따라가고, 끝난 지시는 접어 두었다가 눌러서 다시 열어 본다. */
export function TurnLogs({ logs, running }: { logs: Msg[]; running: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const last = logs[logs.length - 1]?.id;

  useEffect(() => {
    if (running) end.current?.scrollIntoView({ block: "nearest" });
  }, [last, running]);

  if (logs.length === 0) return running ? <p className="ml-6 text-xs text-default-500">아직 로그가 없어요.</p> : null;

  return (
    <details className="ml-6 text-xs" open={running}>
      <summary className="cursor-pointer text-default-500">진행 로그 {logs.length}줄{running ? " (실시간)" : ""}</summary>
      <div className="mt-1 max-h-72 overflow-y-auto break-words rounded-lg border border-default-200 bg-background p-3 font-mono text-xs leading-relaxed">
        {logs.map((l) => (
          <div key={l.id}>
            <span className="text-default-400">{new Date(l.createdAt).toLocaleTimeString("ko-KR", { hour12: false })}</span> {l.text}
          </div>
        ))}
        <div ref={end} />
      </div>
    </details>
  );
}

export default function MaintenancePanel() {
  const [data, setData] = useState<Data | null>(null);
  const [sel, setSel] = useState<string>("new");
  const [text, setText] = useState("");
  const [aiEngine, setAiEngine] = useState<TaskAiEngine>("default");
  // 통제실에서 보내는 지시는 보내는 순간이 승인이라 여기서 모델을 고른다. 승인 대기 지시는 지시마다 따로
  const [aiModel, setAiModel] = useState<TaskModel>("default");
  const [turnModels, setTurnModels] = useState<Record<string, TaskModel>>({});
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
  // 처리 중·승인 대기인 지시가 있어도 보낼 수 있다(대기열에 쌓임)
  const canSend = sel === "new" || (thread && thread.status === "open");
  const queue = data?.queue;
  const bundle = data?.deploy;
  // 지시에 묶인 로그는 그 지시 밑에 보이고, 지시 없는 예전 로그만 [로그 보기]로 섞어 본다
  const logsByTurn = new Map<string, Msg[]>();

  for (const m of thread?.messages ?? []) {
    if (m.role === "log" && m.turnId) logsByTurn.set(m.turnId, [...(logsByTurn.get(m.turnId) ?? []), m]);
  }
  const legacyLogs = thread?.messages.some((m) => m.role === "log" && !m.turnId) ?? false;
  const visible = thread?.messages.filter((m) => (m.role !== "log" || (!m.turnId && showLogs))) ?? [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold">공장 정비</span>
        <span className="text-xs text-default-500">
          홈페이지·감독 프로그램 코드를 고치는 대화예요. 정비가 대기·진행 중이면 새 앱 일감은 멈춰요.
          {data?.hold ? " (지금 앱 일감 멈춤)" : ""}
        </span>
      </div>

      {queue?.halted && (
        <div className="space-y-2 rounded-lg border border-danger-200 bg-danger-50 p-2 text-sm dark:bg-danger-50/10">
          <div>
            ⏸ 정비 대기열이 멈췄어요: 「{queue.halted.firstLine}」({queue.halted.threadTitle}) 지시가 실패했어요. 뒤 지시가 이 결과에 기댈 수 있어서 기다리는 중이에요.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              color="primary"
              isDisabled={busy}
              size="sm"
              onPress={() => post({ action: "queue_skip", turnId: queue.halted!.turnId }, "실패한 지시를 건너뛰고 다음 지시로 계속 진행할까요?")}
            >
              ▶️ 계속 진행
            </Button>
            <Button isDisabled={busy} size="sm" variant="flat" onPress={() => post({ action: "queue_retry", turnId: queue.halted!.turnId }, "실패한 지시를 다시 시도할까요?")}>
              🔁 재시도
            </Button>
            <Button
              color="danger"
              isDisabled={busy}
              size="sm"
              variant="flat"
              onPress={() => post({ action: "queue_clear" }, "시작 전인 정비 지시를 모두 취소할까요? (진행 중인 지시는 끝까지 해요)")}
            >
              🗑 대기열 비우기
            </Button>
            <Button size="sm" variant="light" onPress={() => setSel(queue.halted!.threadId)}>
              실패한 정비 보기
            </Button>
          </div>
        </div>
      )}

      {queue && (queue.items.length > 0 || queue.recent.length > 0) && (
        <div className="space-y-1 rounded-lg border border-default-200 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-default-500">
            <span>📋 정비 대기열 {queue.left ? `(${queue.left}개, 보낸 순서대로 하나씩)` : "(비어 있음)"}</span>
            {queue.items.some((i) => i.status !== "running") && !queue.halted && (
              <Button
                isDisabled={busy}
                size="sm"
                variant="light"
                onPress={() => post({ action: "queue_clear" }, "시작 전인 정비 지시를 모두 취소할까요? (진행 중인 지시는 끝까지 해요)")}
              >
                대기열 비우기
              </Button>
            )}
          </div>
          {queue.items.map((i) => (
            <div key={i.turnId} className="flex flex-col gap-1 rounded-md bg-default-50 p-1.5 text-sm sm:flex-row sm:items-center sm:justify-between">
              <button className="min-w-0 text-left" type="button" onClick={() => setSel(i.threadId)}>
                <span className="mr-1 font-mono text-xs text-default-500">{i.position}.</span>
                <Chip color={i.status === "running" ? "primary" : "warning"} size="sm" variant="flat">
                  {TURN_LABEL[i.status] ?? i.status}
                </Chip>
                <span className="ml-1 break-words">{i.firstLine}</span>
                <span className="ml-1 text-xs text-default-400">
                  · {i.threadTitle}
                  {` · ${AI_LABELS[i.aiEngine ?? "claude"]}`}
                  {(i.aiEngine ?? "claude") === "claude" && <> · <ModelTag engine="claude" model={i.aiModel} /></>}
                  {i.wait && i.status !== "running" ? ` · ${i.wait}` : ""}
                </span>
              </button>
              {i.status !== "running" && (
                <div className="flex shrink-0 gap-1">
                  {/* 승인은 [현황] 탭 '승인·배포 할 일' 또는 이 정비 대화 안(지시 아래)에서 한다 */}
                  {i.status === "awaiting_approval" && (
                    <a className="inline-flex min-h-8 items-center rounded-md px-2 text-xs text-warning underline" href="/admin/factory?tab=status">
                      승인은 [현황]
                    </a>
                  )}
                  <Button isDisabled={busy} size="sm" variant="flat" onPress={() => post({ action: "cancel", turnId: i.turnId }, `이 지시를 취소할까요?\n「${i.firstLine}」`)}>
                    취소
                  </Button>
                </div>
              )}
            </div>
          ))}
          {queue.recent.map((r) => (
            <button key={r.turnId} className="block w-full truncate text-left text-xs text-default-400" type="button" onClick={() => setSel(r.threadId)}>
              {r.status === "done" ? "✅ 완료" : r.status === "failed" ? "❌ 실패" : "⏹ 취소"} · {r.firstLine}
              {r.pushedCommit ? ` (${r.pushedCommit.slice(0, 7)})` : ""} · {r.threadTitle}
            </button>
          ))}
        </div>
      )}

      {bundle && (bundle.items.length > 0 || bundle.inProgress) && (
        <div className="space-y-1 rounded-lg border border-danger-200 p-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {bundle.inProgress
                ? `🚀 ${bundle.inProgress.started ? "배포 중(빌드 3~4분)" : "배포 요청됨(PC가 받아 가는 중)"} · ${bundle.inProgress.commit?.slice(0, 7) ?? ""}`
                : bundle.queueLeft
                  ? `⏳ 배포 대기: 대기열 ${bundle.queueLeft}개 처리 후 배포할 수 있어요`
                  : `⏳ 배포 필요 · 커밋 ${bundle.commit?.slice(0, 7) ?? ""}`}
            </span>
            {!bundle.inProgress && bundle.items.length > 0 && (
              <div className="flex gap-2">
                <Button
                  className="min-h-11 sm:min-h-0"
                  color="danger"
                  isDisabled={busy || !bundle.canDeploy}
                  size="sm"
                  onPress={() =>
                    post(
                      { action: "deploy", threadId: bundle.threadId },
                      `커밋 ${bundle.commit?.slice(0, 7)} 을 홈페이지 서버에 배포할까요?\n(지시 ${bundle.items.length}개 포함, 빌드 3~4분, 그동안 잠깐 끊길 수 있어요)`,
                    )
                  }
                >
                  {bundle.queueLeft ? `대기열 ${bundle.queueLeft}개 처리 후 배포할 수 있어요` : "🚀 배포"}
                </Button>
                {bundle.queueLeft > 0 && (
                  <Button
                    className="min-h-11 sm:min-h-0"
                    color="danger"
                    isDisabled={busy}
                    size="sm"
                    variant="flat"
                    onPress={() =>
                      post(
                        { action: "deploy_now", threadId: bundle.threadId },
                        `대기열에 지시 ${bundle.queueLeft}개가 남아 있어요.\n지금까지 반영분(${bundle.commit?.slice(0, 7)}, 지시 ${bundle.items.length}개)만 먼저 배포할까요?\n남은 지시가 끝나면 다시 배포해야 해요.`,
                      )
                    }
                  >
                    지금 배포
                  </Button>
                )}
              </div>
            )}
          </div>
          {bundle.items.length > 0 && (
            <ul className="text-xs text-default-500">
              {bundle.items.map((i) => (
                <li key={`${i.turnId ?? i.threadId}-${i.commit}`} className="break-words">
                  • {i.title} ({i.commit.slice(0, 7)})
                </li>
              ))}
            </ul>
          )}
          {bundle.lastResult && bundle.lastResult.ok === false && !bundle.inProgress && (
            <div className="text-xs text-danger">지난 배포 실패: {bundle.lastResult.result?.slice(0, 160)}</div>
          )}
          <div className="text-xs text-default-400">대기열이 끝나면 자동 배포: {data?.autoDeploy ? "켜짐" : "꺼짐"}([현황] 탭 감독 프로그램 카드에서 바꿔요)</div>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select className="w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:flex-1 sm:text-sm" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="new">＋ 새 정비</option>
          {open.map((t) => (
            <option key={t.id} value={t.id}>
              {t.activeTurn
                ? `[${TURN_LABEL[t.activeTurn.status] ?? t.activeTurn.status}${(t.activeTurns ?? 1) > 1 ? ` 외 ${(t.activeTurns ?? 1) - 1}` : ""}] `
                : t.needsDeploy && !t.deploy.deployedAt
                  ? "[배포 필요] "
                  : ""}
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
            {legacyLogs && (
              <Button className="min-h-11 flex-1 sm:min-h-0 sm:flex-none" size="sm" variant="light" onPress={() => setShowLogs((v) => !v)}>
                {showLogs ? "이전 로그 숨기기" : "이전 로그 보기"}
              </Button>
            )}
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
              <div key={m.id} className="break-all font-mono text-[11px] text-default-500">
                {m.text}
              </div>
            ) : (
              <Fragment key={m.id}>
              <div
                className={`rounded-lg p-2 text-sm ${m.role === "user" ? "ml-6 bg-primary-50 dark:bg-primary-50/10" : m.role === "system" ? "bg-warning-50 text-xs dark:bg-warning-50/10" : "mr-6 bg-default-100"}`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-default-500">
                  <span>{m.role === "user" ? `👤 지시${m.source ? ` · ${m.source}` : ""}` : m.role === "assistant" ? "🤖 결과" : "ℹ️ 알림"}</span>
                  <span className="font-mono">{new Date(m.createdAt).toLocaleString("ko-KR")}</span>
                  {(m.role === "user" || m.role === "assistant") && <span>{AI_LABELS[m.aiEngine ?? "claude"]}</span>}
                  {(m.role === "user" || m.role === "assistant") && <ModelTag engine={m.aiEngine ?? "claude"} model={m.aiModel} />}
                  {m.status && (
                    <Chip color={m.status === "failed" ? "danger" : m.status === "done" ? "success" : "warning"} size="sm" variant="flat">
                      {TURN_LABEL[m.status] ?? m.status}
                    </Chip>
                  )}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.text}</div>
                {m.role === "assistant" && m.handoff && (
                  <div className="mt-2">
                    <HandoffBox entry={m.handoff} />
                  </div>
                )}
                {m.role === "user" && m.status === "awaiting_approval" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ClaudeModelSelect
                      disabled={busy}
                      engine={m.aiEngine ?? "claude"}
                      label="승인할 모델"
                      value={turnModels[m.id] ?? "default"}
                      onChange={(v) => setTurnModels((cur) => (cur[m.id] === v ? cur : { ...cur, [m.id]: v }))}
                    />
                    <Button color="primary" isDisabled={busy} size="sm" onPress={() => post({ action: "approve", turnId: m.id, ...((turnModels[m.id] ?? "default") !== "default" ? { aiModel: turnModels[m.id] } : {}) })}>
                      승인
                    </Button>
                    <Button isDisabled={busy} size="sm" variant="flat" onPress={() => post({ action: "cancel", turnId: m.id })}>
                      거절
                    </Button>
                  </div>
                )}
                {m.role === "user" && ["awaiting_approval", "queued", "failed"].includes(m.status ?? "") && (
                  <div className="mt-2"><AiEngineSelect value={m.aiEngine ?? "claude"} disabled={busy} onChange={(engine) => post({ action: "set-ai", turnId: m.id, aiEngine: engine })} /></div>
                )}
                {m.role === "user" && m.status === "queued" && (
                  <Button className="mt-2" isDisabled={busy} size="sm" variant="flat" onPress={() => post({ action: "cancel", turnId: m.id }, "이 지시를 취소할까요?")}>
                    취소
                  </Button>
                )}
              </div>
              {m.role === "user" && <TurnLogs logs={logsByTurn.get(m.id) ?? []} running={m.status === "running"} />}
              </Fragment>
            ),
          )}
          <div ref={bottom} />
        </div>
      )}

      {thread && (thread.pushedCommit || deployState(thread)) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {thread.pushedCommit && <span className="text-xs text-default-500">GitHub 에 올린 커밋 <span className="font-mono">{thread.pushedCommit.slice(0, 7)}</span></span>}
          {deployState(thread) && <span className="text-xs">{deployState(thread)}</span>}
          {!bundle && thread.needsDeploy && thread.pushedCommit && !(thread.deploy.requestedAt && !thread.deploy.result && !thread.deploy.deployedAt) && (
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
          <div className="flex flex-wrap items-center gap-3">
            <AiEngineSelect allowDefault value={aiEngine} onChange={setAiEngine} disabled={busy} />
            <ClaudeModelSelect disabled={busy} engine={aiEngine} value={aiModel} onChange={setAiModel} />
          </div>
          <p className="text-xs text-default-500">선택한 AI로 차례대로 처리해요. AI를 바꾸면 이전 결과와 현재 작업 파일을 전달해요. 모델은 Claude Code 지시에만 적용돼요.</p>
          <textarea
            className="min-h-[80px] w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm"
            maxLength={8000}
            placeholder={sel === "new" ? "고칠 내용을 적어 주세요. 예: 통제실 일감 목록에 앱 종류(stack) 필터를 추가해 줘" : "이어서 지시할 내용"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            className="min-h-11 sm:min-h-0"
            color="primary"
            isDisabled={busy || text.trim().length < 5}
            size="sm"
            onPress={() => post({ action: "send", text, aiEngine: aiEngine === "default" ? undefined : aiEngine, ...(aiModel !== "default" ? { aiModel } : {}), ...(sel !== "new" ? { threadId: sel } : {}) })}
          >
            {busy ? "보내는 중…" : sel === "new" ? "새 정비 시작" : thread?.activeTurn ? "대기열에 이어서 지시" : "이어서 지시"}
          </Button>
        </div>
      ) : (
        thread && thread.status !== "open" && <p className="text-xs text-default-500">닫힌 정비예요. 새 정비로 보내세요.</p>
      )}
      {notice && <p className="text-sm text-default-600">{notice}</p>}
    </div>
  );
}
