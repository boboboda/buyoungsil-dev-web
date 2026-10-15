"use client";

// 앱별 일감 대기열(병렬화 단계 B): 순서 번호·우선순위·승인 상태, 우선순위 올리기/내리기, 대기 일감 취소.
// appSlug 를 주면 그 앱 한 곳의 요약(스튜디오 프로젝트 상세), 안 주면 대기·실행 중인 앱 전부(일감 탭). 5초마다 갱신한다.
// 순서는 서버 규칙 그대로: 앱마다 한 번에 하나씩 priority(큰 값 먼저) → 승인 시각 → 등록 시각.
import { useCallback, useEffect, useState } from "react";

import type { GroupReport } from "@/lib/factory/parallel";
import type { QueueItem } from "@/lib/factory/queue";

const STATUS_TEXT: Record<string, string> = { running: "제작 중", approved: "승인됨", pending: "승인 대기", failed: "실패" };
const PLAN_TEXT: Record<string, string> = { requested: "계획 만드는 중(대기)", running: "계획 만드는 중", ready: "계획 승인 대기", failed: "계획을 못 만듦" }; // 계획 먼저 승인(5-1). lib/factory/planLabels.ts 와 같은 글자
const LOCK_TEXT: Record<string, string> = { build: "빌드", emulator: "에뮬레이터", port: "고정 포트", merge: "합치기" };
const KIND_TEXT: Record<string, string> = { new: "새 앱", revision: "수정", release: "출시 준비" };
const REFRESH_MS = 5_000;

type Queues = Record<string, QueueItem[]>;

/** 일감 카드에 붙일 병행 상태 이름들(시험·화면이 같이 쓴다). 합치기 실패가 가장 먼저 */
export function parallelBadges(q: Pick<QueueItem, "status" | "parallelGroup" | "parallel" | "mergeFailed"> & Partial<Pick<QueueItem, "approvalWait" | "groupPendingLeft" | "planStatus">>): string[] {
  const out: string[] = [];

  // 계획 먼저 승인(5-1): 계획을 만들거나 사람의 선택을 기다리는 동안은 시작하지 않는다(계획이 승인되면 평소 순서)
  if (q.status === "approved" && q.planStatus && q.planStatus !== "approved") out.push(`📝 ${PLAN_TEXT[q.planStatus] ?? q.planStatus}`);
  if (q.mergeFailed) out.push("합치기 실패");
  if (q.parallelGroup) out.push(`같이 돌리기 ${q.parallelGroup}`);
  if (q.status === "approved" && (q.groupPendingLeft ?? 0) > 0) out.push(`묶음 승인 기다림 (${q.groupPendingLeft}개 남음)`);
  if (q.status === "approved" && (q.approvalWait ?? 0) > 0) out.push(`다른 승인 기다림 ${q.approvalWait}초`);
  if (q.status === "running" && q.parallel?.worktree) out.push("worktree 실행 중");
  if (q.status === "running" && q.parallel?.lockWait) out.push(`잠금 대기: ${LOCK_TEXT[q.parallel.lockWait.name] ?? q.parallel.lockWait.name}`);
  if (q.status === "running" && q.parallel?.merging) out.push("합치는 중");
  if (q.status === "running" && q.parallel && q.parallel.rebases > 0) out.push(`다시 맞추기 ${q.parallel.rebases}회`);

  return out;
}

/** 지휘자(C-2) 판단 한 줄: 묶었으면 이유와 예상 파일, 순서대로 뒀으면 이유, 판단 실패면 사유. 판단한 적 없거나 사람이 정한 그룹이면 null */
export function conductorLine(q: Pick<QueueItem, "conductor" | "parallelSource">): string | null {
  const c = q.conductor;

  if (!c || q.parallelSource === "manual") return null;
  if (c.decision === "grouped") return `🎼 지휘자: 같이 돌리기 — ${c.reason}${c.files.length ? ` · 예상 파일: ${c.files.slice(0, 6).join(", ")}${c.files.length > 6 ? ` 외 ${c.files.length - 6}개` : ""}` : ""}`;
  if (c.decision === "sequential") return `🎼 지휘자: 순서대로 — ${c.reason}`;

  return `🎼 지휘자 판단 실패(순서대로 실행): ${c.reason}`;
}

/** '같이 돌리기'로 묶을 수 있는 일감: 시작 전(승인 대기·승인됨) 수정 일감 */
export const groupable = (q: Pick<QueueItem, "status" | "kind">) => q.kind === "revision" && (q.status === "pending" || q.status === "approved");
/** [묶음 승인]을 보일 일감: 묶음 안 승인 대기 일감 중 목록에서 가장 앞에 있는 것 하나(묶음마다 버튼이 한 번만 나오게) */
export function showGroupApprove(items: Pick<QueueItem, "id" | "status" | "kind" | "parallelGroup">[], q: Pick<QueueItem, "id" | "status" | "kind" | "parallelGroup">): boolean {
  if (q.status !== "pending" || q.kind !== "revision" || !q.parallelGroup) return false;

  return items.find((x) => x.status === "pending" && x.kind === "revision" && x.parallelGroup === q.parallelGroup)?.id === q.id;
}
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
  const [reports, setReports] = useState<GroupReport[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/factory/queue${appSlug ? `?appSlug=${encodeURIComponent(appSlug)}` : ""}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { queues?: Queues; groupReports?: GroupReport[] };

      if (res.ok && data.queues) setQueues(data.queues);
      if (res.ok && Array.isArray(data.groupReports)) setReports(data.groupReports);
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

  // 같이 돌리기 / 그룹 풀기: 대기열 API 로 보낸다
  const groupAct = async (body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/factory/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { message?: string };

      setNotice(data.message ?? (res.ok ? "처리했어요." : "처리하지 못했어요."));
      if (res.ok) setPicked([]);
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
  if (!apps.length && !reports.length) return null;

  return (
    <section aria-label="앱별 대기열" className="min-w-0 space-y-3 rounded-xl border border-default-200 p-3" data-app-queue>
      <h4 className="fx-label">{appSlug ? "대기열" : "앱별 대기열"}</h4>
      <p className="text-xs fx-muted">앱마다 한 번에 하나씩, priority 큰 값 → 먼저 승인한 순 → 먼저 등록한 순으로 실행해요. 번호 0은 지금 실행 중이에요. 서로 겹치지 않는 수정 일감은 체크해서 [같이 돌리기]로 묶으면(승인 전에도 묶을 수 있어요) 같은 앱에서 동시에 실행하고(작업 사본에서), 끝난 순서대로 합치며 서로 충돌하는지 마지막까지 점검해요. 묶음은 안의 일감이 모두 승인돼야 시작하니, 승인 대기 일감은 [묶음 승인]으로 한 번에 승인하세요.</p>
      {notice ? <p className="text-sm">{notice}</p> : null}
      {apps.map(([slug, items]) => (
        <div key={slug} className="space-y-1">
          {appSlug ? null : <div className="font-mono text-sm font-semibold">{slug}</div>}
          {items.filter(groupable).length >= 2 ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button className="rounded border border-default-300 px-2 py-0.5 disabled:opacity-40" data-queue-group disabled={busy || items.filter((x) => picked.includes(x.id)).length < 2} type="button" onClick={() => void groupAct({ action: "group", jobIds: items.filter((x) => picked.includes(x.id)).map((x) => x.id) }, "고른 일감을 같이 돌릴까요? 서로 다른 파일을 고치는 일감만 묶어야 충돌이 적어요.")}>
                같이 돌리기 (체크한 {items.filter((x) => picked.includes(x.id)).length}개)
              </button>
              <span className="fx-muted">시작 전 수정 일감을 2개 이상 체크하세요.</span>
            </div>
          ) : null}
          <ol className="space-y-1">
            {items.map((q, i) => (
              <li key={q.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-queue-item={q.id}>
                {groupable(q) ? <input aria-label={`${q.title} 같이 돌리기 선택`} checked={picked.includes(q.id)} data-queue-pick disabled={busy} type="checkbox" onChange={(e) => setPicked((p) => (e.target.checked ? [...p, q.id] : p.filter((x) => x !== q.id)))} /> : null}
                <span className="w-6 shrink-0 text-center font-mono">{q.position}</span>
                <a className="min-w-0 flex-1 truncate underline" href={`/admin/factory?tab=jobs&job=${encodeURIComponent(q.id)}`}>
                  {q.title}
                </a>
                <span className="fx-muted">{KIND_TEXT[q.kind] ?? q.kind}</span>
                <span className="fx-muted">{STATUS_TEXT[q.status] ?? q.status}</span>
                <span className="font-mono fx-muted">우선순위 {q.priority}</span>
                {parallelBadges(q).map((b) => (
                  <span key={b} className={`rounded px-1.5 text-xs ${b === "합치기 실패" ? "bg-danger-100 text-danger-700" : "bg-default-100"}`} data-queue-badge={b}>
                    {b}
                  </span>
                ))}
                {q.parallelGroup && q.parallelSource ? (
                  <span className="rounded bg-default-100 px-1.5 text-xs" data-queue-source={q.parallelSource}>
                    {q.parallelSource === "manual" ? "사람이 묶음" : "지휘자가 묶음"}
                  </span>
                ) : null}
                {conductorLine(q) ? (
                  <span className="basis-full pl-8 text-xs fx-muted" data-queue-conductor={q.conductor?.decision}>
                    {conductorLine(q)}
                  </span>
                ) : null}
                {q.mergeFailed ? (
                  <span className="flex items-center gap-1">
                    <button className="rounded border border-default-300 px-2" data-queue-retry disabled={busy} type="button" onClick={() => void act(q.id, { action: "retry" }, `"${q.title}" 일감을 처음부터 다시 실행할까요?`)}>
                      다시 시도
                    </button>
                  </span>
                ) : null}
                {showGroupApprove(items, q) ? (
                  <button className="rounded border border-primary-300 px-2" data-queue-approve-group disabled={busy} type="button" onClick={() => void groupAct({ action: "approve-group", jobId: q.id }, "이 묶음의 승인 대기 일감을 한 번에 승인할까요? 모두 승인되면 같이 돌기 시작해요.")}>
                    묶음 승인 ({items.filter((x) => x.status === "pending" && x.kind === "revision" && x.parallelGroup === q.parallelGroup).length}개)
                  </button>
                ) : null}
                {q.parallelGroup && q.status !== "running" ? (
                  <button className="rounded border border-default-300 px-2" data-queue-ungroup disabled={busy} type="button" onClick={() => void groupAct({ action: "ungroup", jobId: q.id })}>
                    묶음 풀기
                  </button>
                ) : null}
                {q.status !== "running" && q.status !== "failed" ? (
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
      {reports.length ? (
        <div className="space-y-1 border-t border-default-200 pt-2" data-group-reports>
          <h5 className="fx-label">같이 돌리기 묶음 완료 요약</h5>
          {reports.slice(0, appSlug ? 3 : 5).map((r) => (
            <pre key={`${r.appSlug}-${r.group}`} className="whitespace-pre-wrap text-xs fx-muted" data-group-report={r.group}>
              {r.text}
            </pre>
          ))}
        </div>
      ) : null}
    </section>
  );
}
