"use client";

// 앱별 일감 대기열(병렬화 단계 B): 순서 번호·우선순위·승인 상태, 우선순위 올리기/내리기, 대기 일감 취소.
// appSlug 를 주면 그 앱 한 곳의 요약(스튜디오 프로젝트 상세), 안 주면 대기·실행 중인 앱 전부(일감 탭). 5초마다 갱신한다.
// 순서는 서버 규칙 그대로: 앱마다 한 번에 하나씩 priority(큰 값 먼저) → 승인 시각 → 등록 시각.
import { useCallback, useEffect, useState } from "react";

import type { QueueItem } from "@/lib/factory/queue";

const STATUS_TEXT: Record<string, string> = { running: "제작 중", approved: "승인됨", pending: "승인 대기" };
const KIND_TEXT: Record<string, string> = { new: "새 앱", revision: "수정", release: "출시 준비" };
const REFRESH_MS = 5_000;

type Queues = Record<string, QueueItem[]>;

/** 올리기/내리기로 바꿀 priority: 바로 앞(뒤) 일감과 순서가 바뀌도록 1 차이를 둔다(-100~100). */
export function movedPriority(items: QueueItem[], index: number, dir: "up" | "down"): number | null {
  const cur = items[index];
  const other = items[index + (dir === "up" ? -1 : 1)];

  if (!cur || !other || other.status === "running") return null;
  const p = dir === "up" ? other.priority + 1 : other.priority - 1;

  if (p > 100 || p < -100) return null;

  return p;
}

export default function AppQueue({ appSlug }: { appSlug?: string }) {
  const [queues, setQueues] = useState<Queues | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/factory/queue${appSlug ? `?appSlug=${encodeURIComponent(appSlug)}` : ""}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { queues?: Queues };

      if (res.ok && data.queues) setQueues(data.queues);
    } catch {
      // 다음 갱신 때 다시
    }
  }, [appSlug]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);

    return () => clearInterval(t);
  }, [load]);

  const act = async (id: string, body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/factory/jobs/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { message?: string };

      setNotice(data.message ?? (res.ok ? "처리했어요." : "처리하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
    await load();
  };

  const apps = Object.entries(queues ?? {}).filter(([, list]) => list.length > 0);

  if (!queues) return null;
  if (appSlug && apps.length === 0) {
    return (
      <section aria-label="대기열" className="min-w-0 space-y-1 border-t border-default-300 pt-3" data-app-queue>
        <h4 className="fx-label">대기열</h4>
        <p className="text-sm fx-muted">이 앱에 대기·진행 중인 일감이 없어요.</p>
      </section>
    );
  }
  if (!apps.length) return null;

  return (
    <section aria-label="앱별 대기열" className="min-w-0 space-y-3 rounded-xl border border-default-200 p-3" data-app-queue>
      <h4 className="fx-label">{appSlug ? "대기열" : "앱별 대기열"}</h4>
      <p className="text-xs fx-muted">앱마다 한 번에 하나씩, priority 큰 값 → 먼저 승인한 순 → 먼저 등록한 순으로 실행해요. 번호 0은 지금 실행 중이에요.</p>
      {notice ? <p className="text-sm">{notice}</p> : null}
      {apps.map(([slug, items]) => (
        <div key={slug} className="space-y-1">
          {appSlug ? null : <div className="font-mono text-sm font-semibold">{slug}</div>}
          <ol className="space-y-1">
            {items.map((q, i) => (
              <li key={q.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-queue-item={q.id}>
                <span className="w-6 shrink-0 text-center font-mono">{q.position}</span>
                <a className="min-w-0 flex-1 truncate underline" href={`/admin/factory?tab=jobs&job=${encodeURIComponent(q.id)}`}>
                  {q.title}
                </a>
                <span className="fx-muted">{KIND_TEXT[q.kind] ?? q.kind}</span>
                <span className="fx-muted">{STATUS_TEXT[q.status] ?? q.status}</span>
                <span className="font-mono fx-muted">우선순위 {q.priority}</span>
                {q.status !== "running" ? (
                  <span className="flex items-center gap-1">
                    <button aria-label="순서 올리기" className="rounded border border-default-300 px-2 disabled:opacity-40" data-queue-up disabled={busy || movedPriority(items, i, "up") === null} type="button" onClick={() => void act(q.id, { action: "set-priority", priority: movedPriority(items, i, "up") })}>
                      ▲
                    </button>
                    <button aria-label="순서 내리기" className="rounded border border-default-300 px-2 disabled:opacity-40" data-queue-down disabled={busy || movedPriority(items, i, "down") === null} type="button" onClick={() => void act(q.id, { action: "set-priority", priority: movedPriority(items, i, "down") })}>
                      ▼
                    </button>
                    <button className="rounded border border-default-300 px-2" data-queue-cancel disabled={busy} type="button" onClick={() => void act(q.id, { action: "cancel" }, `"${q.title}" 지시를 취소할까요?`)}>
                      취소
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
