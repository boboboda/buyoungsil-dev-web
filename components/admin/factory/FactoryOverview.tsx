// components/admin/factory/FactoryOverview.tsx
// 통제실 "승인·배포 할 일"(텔레그램 버튼과 같은 동작)과 "업데이트·배포 이력"(감독 프로그램 업데이트, 서버 배포, 정비 대화 요약).
// 승인·배포는 /api/admin/factory/overview → lib/factory/approvals.ts runApproval 로, 텔레그램과 같은 함수를 쓴다.
// 텔레그램과 동시에 눌러도 한쪽만 처리되고, 늦은 쪽에는 "이미 처리됨" 안내가 나온다.
"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, Chip } from "@heroui/react";

import { StatusDot } from "./fx";

type Action = "job_approve" | "maintenance_approve" | "deploy" | "deploy_now";

interface Overview {
  inbox: {
    jobs: {
      id: string;
      appSlug: string;
      title: string;
      kind: string;
      kindLabel: string;
      stack: string;
      source: string | null;
      createdAt: string;
    }[];
    turns: {
      id: string;
      threadId: string;
      threadTitle: string;
      text: string;
      source: string | null;
      createdAt: string;
    }[];
    deploys: {
      threadId: string;
      title: string;
      commit: string | null;
      inProgress: boolean;
      started: boolean;
      requestedAt: string | null;
      lastResult: string | null;
      // 정비 대기열 묶음 배포(예전 서버에는 없다)
      items?: { title: string; commit: string }[];
      queueLeft?: number;
      canDeploy?: boolean;
    }[];
  };
  updates: {
    id: number;
    at: string;
    fromCommit: string | null;
    commit: string;
    subject: string | null;
    note: string | null;
    thread: { id: string; title: string } | null;
  }[];
  deploys: {
    id: string;
    threadId: string;
    threadTitle: string;
    commit: string;
    via: string | null;
    requestedAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    ok: boolean | null;
    result: string | null;
    items?: { title: string; commit: string }[] | null;
  }[];
  threads: {
    id: string;
    title: string;
    status: string;
    lastTurnStatus: string | null;
    turns: number;
    pushedCommit: string | null;
    needsDeploy: boolean;
    deployInProgress: boolean;
    deployedAt: string | null;
    deployResult: string | null;
    updatedAt: string;
  }[];
  message?: string;
}

const when = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("ko-KR") : "-";
const short = (c: string | null | undefined) => (c ? c.slice(0, 7) : "-");

const TURN_LABEL: Record<string, string> = {
  awaiting_approval: "승인 기다림",
  queued: "대기열",
  running: "진행 중",
  done: "완료",
  failed: "실패",
  cancelled: "취소",
};

type ChipColor =
  | "default"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger";

// 업데이트 소식 문구로 결과를 나눈다(감독 프로그램 update.mjs 의 "자동 업데이트 …" 문구)
function updateResult(u: Overview["updates"][number]): {
  label: string;
  color: ChipColor;
} {
  const n = u.note ?? "";

  if (n.includes("실패")) return { label: "실패·되돌림", color: "danger" };
  if (n.startsWith("자동 업데이트 확인:") && n.includes("성공"))
    return { label: "새 버전 확인됨", color: "success" };
  if (n.startsWith("자동 업데이트 완료"))
    return { label: "받음(재시작)", color: "primary" };
  if (n.startsWith("자동 업데이트 시작"))
    return { label: "받는 중", color: "primary" };
  if (n.includes("건너뜀")) return { label: "건너뜀", color: "default" };
  if (n.includes("이미 최신")) return { label: "이미 최신", color: "default" };
  if (u.fromCommit) return { label: "버전 바뀜", color: "primary" };

  return { label: "소식", color: "default" };
}

function deployStatus(d: Overview["deploys"][number]): {
  label: string;
  color: ChipColor;
} {
  if (d.ok === true) return { label: "완료", color: "success" };
  if (d.ok === false) return { label: "실패", color: "danger" };
  if (d.startedAt) return { label: "진행 중(빌드)", color: "primary" };

  return { label: "진행 중(PC 대기)", color: "primary" };
}

// children(감독 프로그램 카드)은 "할 일"과 "이력" 사이에 놓는다.
export default function FactoryOverview({
  children,
}: {
  children?: ReactNode;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"updates" | "deploys" | "threads">("deploys");
  // 업데이트·배포 이력은 길어서 기본으로 접어 둔다. 펼침 여부는 이 브라우저에 기억
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    try {
      setHistoryOpen(localStorage.getItem("factory.historyOpen") === "1");
    } catch {}
  }, []);
  const toggleHistory = () =>
    setHistoryOpen((v) => {
      try {
        localStorage.setItem("factory.historyOpen", v ? "0" : "1");
      } catch {}

      return !v;
    });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/overview", {
        cache: "no-store",
      });

      if (res.ok) setData((await res.json()) as Overview);
    } catch {
      /* 그대로 둔다 */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 7000);

    return () => clearInterval(t);
  }, [load]);

  const act = async (action: Action, id: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(`${action}:${id}`);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/factory/overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      const d = (await res.json().catch(() => ({}))) as Overview;

      if (d.inbox) setData(d);
      else load();
      setNotice(d.message ?? (res.ok ? "처리했어요." : "처리하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(null);
  };

  const inbox = data?.inbox;
  const todo = inbox
    ? inbox.jobs.length +
      inbox.turns.length +
      inbox.deploys.filter((d) => !d.inProgress && d.canDeploy !== false).length
    : 0;

  return (
    <>
      <Card className="mb-6">
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold">
              <StatusDot tone={todo > 0 ? "warn" : "idle"} />
              승인·배포 할 일
              {inbox && <span className="font-mono">({todo})</span>}
            </div>
            <span className="text-xs text-default-500">
              텔레그램 버튼과 같은 동작이에요. 어느 쪽에서 먼저 눌러도 한 번만
              처리돼요.
            </span>
          </div>
          {!inbox && <p className="text-sm text-default-500">읽는 중…</p>}
          {inbox &&
            inbox.jobs.length + inbox.turns.length + inbox.deploys.length ===
              0 && (
              <p className="text-sm text-default-500">
                기다리는 승인·배포가 없어요.
              </p>
            )}

          {inbox?.deploys.map((d) => (
            <div
              key={`d-${d.threadId}`}
              className="flex flex-col gap-2 rounded-lg border border-danger-200 p-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip color="danger" size="sm" variant="flat">
                    🚀 서버 배포
                  </Chip>
                  <span className="font-medium">{d.title}</span>
                </div>
                <div className="mt-1 font-mono text-xs text-default-500">
                  커밋 {short(d.commit)}
                  {d.inProgress
                    ? ` · ${d.started ? "배포 중(빌드 3~4분)" : "요청됨 — PC가 받아 가는 중"} · 요청 ${when(d.requestedAt)}`
                    : ""}
                  {!d.inProgress && d.lastResult
                    ? ` · 지난 시도: ${d.lastResult.slice(0, 80)}`
                    : ""}
                  {!d.inProgress && d.queueLeft
                    ? ` · 정비 대기열 ${d.queueLeft}개 처리 후 배포할 수 있어요`
                    : ""}
                </div>
                {d.items && d.items.length > 0 && (
                  <ul className="mt-1 text-xs text-default-500">
                    {d.items.map((i, n) => (
                      <li key={`${n}-${i.commit}`} className="break-words">
                        • {i.title} ({short(i.commit)})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  className="min-h-11 sm:min-h-0"
                  color="danger"
                  isDisabled={!!busy || d.inProgress || d.canDeploy === false}
                  size="sm"
                  onPress={() =>
                    act(
                      "deploy",
                      d.threadId,
                      `커밋 ${short(d.commit)} 을 홈페이지 서버에 배포할까요?\n${d.items?.length ? `(정비 지시 ${d.items.length}개 포함)` : `「${d.title}」`}\n(빌드 3~4분, 그동안 잠깐 끊길 수 있어요)`,
                    )
                  }
                >
                  {d.inProgress
                    ? "진행 중"
                    : d.queueLeft
                      ? `대기열 ${d.queueLeft}개 처리 후`
                      : "🚀 배포"}
                </Button>
                {!d.inProgress && !!d.queueLeft && (
                  <Button
                    className="min-h-11 sm:min-h-0"
                    color="danger"
                    isDisabled={!!busy}
                    size="sm"
                    variant="flat"
                    onPress={() =>
                      act(
                        "deploy_now",
                        d.threadId,
                        `정비 대기열에 지시 ${d.queueLeft}개가 남아 있어요.\n지금까지 반영분(${short(d.commit)})만 먼저 배포할까요?\n남은 지시가 끝나면 다시 배포해야 해요.`,
                      )
                    }
                  >
                    지금 배포
                  </Button>
                )}
              </div>
            </div>
          ))}

          {inbox?.turns.map((t) => (
            <div
              key={`t-${t.id}`}
              className="flex flex-col gap-2 rounded-lg border border-default-200 p-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip color="warning" size="sm" variant="flat">
                    🛠 정비 지시
                  </Chip>
                  <span className="font-medium">{t.threadTitle}</span>
                  <span className="font-mono text-xs text-default-500">
                    {t.source ?? ""} · {when(t.createdAt)}
                  </span>
                </div>
                <div className="mt-1 whitespace-pre-wrap break-words text-xs text-default-600">
                  {t.text}
                </div>
              </div>
              <Button
                className="min-h-11 sm:min-h-0"
                color="primary"
                isDisabled={!!busy}
                size="sm"
                onPress={() => act("maintenance_approve", t.id)}
              >
                승인
              </Button>
            </div>
          ))}

          {inbox?.jobs.map((j) => (
            <div
              key={`j-${j.id}`}
              className="flex flex-col gap-2 rounded-lg border border-default-200 p-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip
                    color={
                      j.kind === "release"
                        ? "success"
                        : j.kind === "new"
                          ? "primary"
                          : "default"
                    }
                    size="sm"
                    variant="flat"
                  >
                    {j.kind === "release" ? "📦 " : "📱 "}
                    {j.kindLabel}
                  </Chip>
                  <span className="font-medium">{j.title}</span>
                  <span className="font-mono text-xs text-default-500">
                    {j.appSlug} · {j.stack} · {when(j.createdAt)}
                  </span>
                </div>
                {j.source && (
                  <div className="mt-1 text-xs text-default-500">
                    출처: {j.source}
                  </div>
                )}
              </div>
              <Button
                className="min-h-11 sm:min-h-0"
                color="primary"
                isDisabled={!!busy}
                size="sm"
                onPress={() => act("job_approve", j.id)}
              >
                승인
              </Button>
            </div>
          ))}
          {notice && <p className="text-sm text-default-600">{notice}</p>}
        </CardBody>
      </Card>

      {children}

      <Card className="mb-6">
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              aria-expanded={historyOpen}
              className="flex min-h-11 items-center gap-2 text-left font-semibold sm:min-h-0"
              type="button"
              onClick={toggleHistory}
            >
              <span className="text-default-500">
                {historyOpen ? "▾" : "▸"}
              </span>
              업데이트·배포 이력
              {!historyOpen && data && (
                <span className="text-xs font-normal text-default-500">
                  (배포 {data.deploys.length} · 업데이트 {data.updates.length} ·
                  정비 {data.threads.length}, 눌러서 펼치기)
                </span>
              )}
            </button>
            {historyOpen && (
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["deploys", "서버 배포"],
                    ["updates", "감독 프로그램 업데이트"],
                    ["threads", "정비 대화"],
                  ] as const
                ).map(([k, label]) => (
                  <Button
                    key={k}
                    color={tab === k ? "primary" : "default"}
                    size="sm"
                    variant={tab === k ? "solid" : "flat"}
                    onPress={() => setTab(k)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {historyOpen && !data && (
            <p className="text-sm text-default-500">읽는 중…</p>
          )}

          {historyOpen && data && tab === "deploys" && (
            <div className="space-y-2">
              {data.deploys.length === 0 && (
                <p className="text-sm text-default-500">배포 기록이 없어요.</p>
              )}
              {data.deploys.map((d) => {
                const st = deployStatus(d);

                return (
                  <div
                    key={d.id}
                    className="rounded-lg border border-default-200 p-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip color={st.color} size="sm" variant="flat">
                        {st.label}
                      </Chip>
                      <span className="font-mono text-xs">
                        {short(d.commit)}
                      </span>
                      <span className="font-medium">{d.threadTitle}</span>
                      {d.via && (
                        <span className="text-xs text-default-500">
                          (
                          {d.via === "자동" ? "자동 배포" : `${d.via}에서 요청`}
                          )
                        </span>
                      )}
                    </div>
                    {d.items && d.items.length > 0 && (
                      <ul className="mt-1 text-xs text-default-500">
                        {d.items.map((i, n) => (
                          <li key={`${n}-${i.commit}`} className="break-words">
                            • {i.title} ({short(i.commit)})
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-1 font-mono text-xs text-default-500">
                      요청 {when(d.requestedAt)} · 시작 {when(d.startedAt)} ·
                      완료 {when(d.finishedAt)}
                    </div>
                    {d.result && <ResultText text={d.result} />}
                  </div>
                );
              })}
            </div>
          )}

          {historyOpen && data && tab === "updates" && (
            <div className="space-y-2">
              {data.updates.length === 0 && (
                <p className="text-sm text-default-500">
                  업데이트 기록이 없어요(감독 프로그램이 다음에 알려 주면
                  쌓여요).
                </p>
              )}
              {data.updates.map((u) => {
                const r = updateResult(u);

                return (
                  <div
                    key={u.id}
                    className="rounded-lg border border-default-200 p-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip color={r.color} size="sm" variant="flat">
                        {r.label}
                      </Chip>
                      <span className="font-mono text-xs">
                        {u.fromCommit
                          ? `${short(u.fromCommit)} → ${short(u.commit)}`
                          : short(u.commit)}
                      </span>
                      <span className="font-mono text-xs text-default-500">
                        {when(u.at)}
                      </span>
                    </div>
                    {u.subject && (
                      <div className="mt-1 text-xs">📝 {u.subject}</div>
                    )}
                    {u.thread && (
                      <div className="mt-1 text-xs text-default-500">
                        🛠 정비: {u.thread.title}
                      </div>
                    )}
                    {u.note && (
                      <div className="mt-1 break-words text-xs text-default-600">
                        {u.note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {historyOpen && data && tab === "threads" && (
            <div className="space-y-2">
              {data.threads.length === 0 && (
                <p className="text-sm text-default-500">정비 대화가 없어요.</p>
              )}
              {data.threads.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-default-200 p-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip
                      color={t.status === "open" ? "primary" : "default"}
                      size="sm"
                      variant="flat"
                    >
                      {t.status === "open" ? "열림" : "닫힘"}
                    </Chip>
                    {t.lastTurnStatus && (
                      <Chip
                        color={
                          t.lastTurnStatus === "failed"
                            ? "danger"
                            : t.lastTurnStatus === "done"
                              ? "success"
                              : "warning"
                        }
                        size="sm"
                        variant="flat"
                      >
                        {TURN_LABEL[t.lastTurnStatus] ?? t.lastTurnStatus}
                      </Chip>
                    )}
                    <span className="font-medium">{t.title}</span>
                  </div>
                  <div className="mt-1 text-xs text-default-500">
                    지시 {t.turns}개 · 올린 커밋 {short(t.pushedCommit)} ·{" "}
                    {t.deployInProgress
                      ? "🚀 배포 진행 중"
                      : t.needsDeploy
                        ? "⏳ 배포 필요"
                        : t.deployedAt
                          ? `✅ 배포 완료 ${when(t.deployedAt)}`
                          : t.pushedCommit
                            ? "배포 필요 없음"
                            : "올린 커밋 없음"}{" "}
                    · 마지막 활동 {when(t.updatedAt)}
                  </div>
                  {t.deployResult && t.needsDeploy && !t.deployInProgress && (
                    <div className="mt-1 break-words text-xs text-danger-500">
                      지난 배포: {t.deployResult}
                    </div>
                  )}
                </div>
              ))}
              <p className="text-xs text-default-500">
                대화 내용·이어서 지시는{" "}
                <a className="underline" href="/admin/factory?tab=jobs">
                  [일감] 탭
                </a>
                의 「공장 정비」에서 해요.
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}

// 배포 결과: 첫 줄(요약)만 보이고, 로그 끝부분 같은 나머지는 접어 둔다
function ResultText({ text }: { text: string }) {
  const [first, ...rest] = text.split("\n");
  const more = rest.join("\n").trim();

  return (
    <div className="mt-1 break-words text-xs text-default-600">
      <div className="whitespace-pre-wrap">{first}</div>
      {more && (
        <details className="mt-1">
          <summary className="cursor-pointer text-default-500">
            자세히 ({rest.length}줄)
          </summary>
          <div className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-default-200 bg-background p-2 font-mono text-[11px]">
            {more}
          </div>
        </details>
      )}
    </div>
  );
}
