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
  // 종류별 전체 개수(예전 서버에는 없다)
  totals?: Record<HistoryKind, number>;
  message?: string;
}

export type HistoryKind = "deploys" | "updates" | "threads";
export type HistoryData = Pick<Overview, HistoryKind | "totals">;
type HistoryItem = HistoryData[HistoryKind][number];

// [전체 보기]: /api/admin/factory/history 에서 HISTORY_PAGE 개씩 읽어 붙인 목록
export const HISTORY_PAGE = 20;
export interface FullHistory {
  kind: HistoryKind;
  items: HistoryItem[];
  nextCursor: string | null;
  total: number;
  loading: boolean;
  error: string | null;
}

// 다음 쪽을 붙인다. 읽는 사이 순서가 바뀌어(정비 대화는 마지막 활동순) 겹친 항목은 한 번만
export function mergeHistory(prev: HistoryItem[], next: HistoryItem[]) {
  const seen = new Set(prev.map((i) => String(i.id)));

  return [...prev, ...next.filter((i) => !seen.has(String(i.id)))];
}

// [전체 히스토리] 탭: 세 종류를 최신순으로 합친 목록. 종류 필터가 '전체'면 kind=all, 아니면 그 종류만 읽는다
export type HistoryTab = HistoryKind | "all";
export type HistoryFilter = HistoryKind | "all";
export interface MixedItem {
  type: HistoryKind;
  item: HistoryItem;
}
export interface MergedHistory {
  filter: HistoryFilter;
  items: MixedItem[];
  nextCursor: string | null;
  total: number;
  loading: boolean;
  error: string | null;
}

export function mergeMixed(prev: MixedItem[], next: MixedItem[]) {
  const key = (m: MixedItem) => `${m.type}:${m.item.id}`;
  const seen = new Set(prev.map(key));

  return [...prev, ...next.filter((m) => !seen.has(key(m)))];
}

// 전체 히스토리 탭 이름 옆 배지: 세 종류 전체 개수 합(예전 서버는 최근 목록 길이)
export const totalOf = (data: HistoryData | null) =>
  data
    ? (["deploys", "updates", "threads"] as const).reduce(
        (n, k) => n + (data.totals?.[k] ?? data[k].length),
        0,
      )
    : undefined;

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
  const [tab, setTab] = useState<HistoryTab>("deploys");
  // 업데이트·배포 이력은 길어서 기본으로 접어 둔다. 펼침 여부는 이 브라우저에 기억
  const [historyOpen, setHistoryOpen] = useState(false);
  // [전체 보기]로 연 탭의 전체 목록(20개씩 [더 보기]). null 이면 overview 의 최근 목록
  const [full, setFull] = useState<FullHistory | null>(null);
  // [전체 히스토리] 탭의 합친 목록(20개씩 [더 보기])
  const [merged, setMerged] = useState<MergedHistory | null>(null);

  const loadMerged = async (filter: HistoryFilter, prev?: MergedHistory) => {
    const base: MergedHistory = prev ?? {
      filter,
      items: [],
      nextCursor: null,
      total:
        filter === "all"
          ? (totalOf(data) ?? 0)
          : (data?.totals?.[filter] ?? 0),
      loading: true,
      error: null,
    };

    setMerged({ ...base, loading: true, error: null });
    const qs = new URLSearchParams({ kind: filter, limit: String(HISTORY_PAGE) });

    if (prev?.nextCursor) qs.set("cursor", prev.nextCursor);
    try {
      const res = await fetch(`/api/admin/factory/history?${qs}`, {
        cache: "no-store",
      });
      const d = (await res.json().catch(() => ({}))) as {
        items?: unknown[];
        nextCursor?: string | null;
        total?: number;
        message?: string;
      };

      if (!res.ok || !d.items) throw new Error(d.message ?? "읽지 못했어요.");
      // kind=all 은 { type, item }, 한 종류만 읽으면 항목 그대로라 종류를 붙인다
      const items =
        filter === "all"
          ? (d.items as MixedItem[])
          : (d.items as HistoryItem[]).map((item) => ({ type: filter, item }));

      setMerged((cur) =>
        // 그 사이 필터를 바꿨으면 버린다
        cur?.filter !== filter
          ? cur
          : {
              filter,
              items: mergeMixed(base.items, items),
              nextCursor: d.nextCursor ?? null,
              total: d.total ?? base.total,
              loading: false,
              error: null,
            },
      );
    } catch (e) {
      setMerged((cur) =>
        cur?.filter !== filter
          ? cur
          : {
              ...base,
              loading: false,
              error:
                e instanceof Error && e.message !== "Failed to fetch"
                  ? e.message
                  : "서버에 연결하지 못했어요.",
            },
      );
    }
  };

  const loadAll = async (kind: HistoryKind, prev?: FullHistory) => {
    const base: FullHistory = prev ?? {
      kind,
      items: [],
      nextCursor: null,
      total: data?.totals?.[kind] ?? 0,
      loading: true,
      error: null,
    };

    setFull({ ...base, loading: true, error: null });
    const qs = new URLSearchParams({ kind, limit: String(HISTORY_PAGE) });

    if (prev?.nextCursor) qs.set("cursor", prev.nextCursor);
    try {
      const res = await fetch(`/api/admin/factory/history?${qs}`, {
        cache: "no-store",
      });
      const d = (await res.json().catch(() => ({}))) as {
        items?: HistoryItem[];
        nextCursor?: string | null;
        total?: number;
        message?: string;
      };

      if (!res.ok || !d.items) throw new Error(d.message ?? "읽지 못했어요.");
      setFull((cur) =>
        // 그 사이 다른 탭으로 옮겼거나 [최근만 보기]를 눌렀으면 버린다
        cur?.kind !== kind
          ? cur
          : {
              kind,
              items: mergeHistory(base.items, d.items!),
              nextCursor: d.nextCursor ?? null,
              total: d.total ?? base.total,
              loading: false,
              error: null,
            },
      );
    } catch (e) {
      setFull((cur) =>
        cur?.kind !== kind
          ? cur
          : {
              ...base,
              loading: false,
              error:
                e instanceof Error && e.message !== "Failed to fetch"
                  ? e.message
                  : "서버에 연결하지 못했어요.",
            },
      );
    }
  };

  useEffect(() => {
    try {
      setHistoryOpen(localStorage.getItem("factory.historyOpen") === "1");
    } catch {}
  }, []);
  const setOpen = (v: boolean) => {
    try {
      localStorage.setItem("factory.historyOpen", v ? "1" : "0");
    } catch {}
    setHistoryOpen(v);
  };
  const toggleHistory = () => setOpen(!historyOpen);

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
      <Card className="mb-6" data-title="todo · 승인·배포">
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

      <HistoryPanelView
        data={data}
        full={full}
        merged={merged}
        open={historyOpen}
        tab={tab}
        onFilter={(f) => loadMerged(f)}
        onMore={() => full && full.nextCursor && loadAll(full.kind, full)}
        onMoreMerged={() =>
          merged && merged.nextCursor && loadMerged(merged.filter, merged)
        }
        onShowAll={() => tab !== "all" && loadAll(tab)}
        onShowRecent={() => setFull(null)}
        onTab={(k) => {
          // 접혀 있을 때 탭을 누르면 펼친다
          if (!historyOpen) setOpen(true);
          setTab(k);
          setFull(null);
          // 전체 히스토리는 누를 때마다 첫 쪽부터 새로 읽는다(필터는 유지)
          if (k === "all") loadMerged(merged?.filter ?? "all");
        }}
        onToggle={toggleHistory}
      />
    </>
  );
}

const HISTORY_TABS = [
  ["deploys", "서버 배포"],
  ["updates", "감독 프로그램 업데이트"],
  ["threads", "정비 대화"],
] as const;

const EMPTY: Record<HistoryKind, string> = {
  deploys: "배포 기록이 없어요.",
  updates: "업데이트 기록이 없어요(감독 프로그램이 다음에 알려 주면 쌓여요).",
  threads: "정비 대화가 없어요.",
};

// 전체 히스토리에서 줄마다 붙는 종류 표시와 필터 이름
const KIND_BADGE: Record<HistoryKind, { label: string; color: ChipColor }> = {
  deploys: { label: "🚀 배포", color: "danger" },
  updates: { label: "🔄 감독", color: "secondary" },
  threads: { label: "🛠 정비", color: "warning" },
};
const FILTERS = [
  ["all", "전체"],
  ["deploys", "배포"],
  ["updates", "감독"],
  ["threads", "정비"],
] as const;

// 업데이트·배포 이력 패널(보기 전용: 상태·읽기는 FactoryOverview 가 한다. 미리보기·시험도 이걸 그린다)
// 탭 줄 맨 앞 [전체 히스토리 · N]은 접혀 있어도 늘 보인다 → 세 종류를 최신순으로 합쳐 20개씩 [더 보기], 종류 필터
// 나머지 탭은 최근 목록 아래 [전체 보기] → 같은 패널 안에서 그 종류 전체 목록(시간 역순)을 20개씩 [더 보기]
export function HistoryPanelView({
  data,
  open,
  tab,
  full,
  merged = null,
  onToggle,
  onTab,
  onShowAll,
  onMore,
  onShowRecent,
  onFilter = () => {},
  onMoreMerged = () => {},
}: {
  data: HistoryData | null;
  open: boolean;
  tab: HistoryTab;
  full: FullHistory | null;
  merged?: MergedHistory | null;
  onToggle: () => void;
  onTab: (k: HistoryTab) => void;
  onShowAll: () => void;
  onMore: () => void;
  onShowRecent: () => void;
  onFilter?: (f: HistoryFilter) => void;
  onMoreMerged?: () => void;
}) {
  const kindTab = tab === "all" ? null : tab;
  const all = full && full.kind === tab ? full : null;
  const list: HistoryItem[] = all ? all.items : kindTab ? (data?.[kindTab] ?? []) : [];
  const total = all ? all.total : kindTab ? data?.totals?.[kindTab] : undefined;
  const count = (k: HistoryKind) => data?.totals?.[k] ?? data?.[k].length ?? 0;
  const grand = totalOf(data);

  return (
    <Card className="mb-6" data-title="history · 업데이트·배포">
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            aria-expanded={open}
            className="flex min-h-11 items-center gap-2 text-left font-semibold sm:min-h-0"
            type="button"
            onClick={onToggle}
          >
            <span className="text-default-500">{open ? "▾" : "▸"}</span>
            업데이트·배포 이력
            {!open && data && (
              <span className="text-xs font-normal text-default-500">
                (배포 {count("deploys")} · 업데이트 {count("updates")} · 정비{" "}
                {count("threads")}, 눌러서 펼치기)
              </span>
            )}
          </button>
          {/* 탭 줄은 접혀 있어도 늘 보인다. 맨 앞 [전체 히스토리]는 눈에 띄게(테두리·배지) */}
          <div className="flex flex-wrap gap-1" data-history-tabs role="tablist">
            <Button
              aria-selected={open && tab === "all"}
              className="font-semibold"
              color="secondary"
              data-tab="all"
              role="tab"
              size="sm"
              variant={open && tab === "all" ? "solid" : "bordered"}
              onPress={() => onTab("all")}
            >
              🗂 전체 히스토리
              {grand !== undefined && (
                <span
                  className="rounded-full bg-secondary-100 px-1.5 font-mono text-[11px] text-secondary-700"
                  data-history-total
                >
                  총 {grand}개
                </span>
              )}
            </Button>
            {HISTORY_TABS.map(([k, label]) => (
              <Button
                key={k}
                aria-selected={open && tab === k}
                color={open && tab === k ? "primary" : "default"}
                data-tab={k}
                role="tab"
                size="sm"
                variant={open && tab === k ? "solid" : "flat"}
                onPress={() => onTab(k)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        {open && !data && <p className="text-sm text-default-500">읽는 중…</p>}

        {open && data && tab === "all" && (
          <MergedList merged={merged} onFilter={onFilter} onMore={onMoreMerged} />
        )}

        {open && data && kindTab && (
          <div className="space-y-2" data-history={all ? "all" : "recent"}>
            {all && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-default-200 pb-2 text-xs">
                <span className="font-semibold">
                  전체 이력 · 최신순{" "}
                  <span className="font-mono text-default-500">
                    {all.items.length} / {all.total}
                  </span>
                </span>
                <Button size="sm" variant="flat" onPress={onShowRecent}>
                  최근만 보기
                </Button>
              </div>
            )}
            {list.length === 0 && !all?.loading && (
              <p className="text-sm text-default-500">{EMPTY[kindTab]}</p>
            )}
            {tab === "deploys" &&
              (list as HistoryData["deploys"]).map((d) => (
                <DeployRow key={d.id} d={d} />
              ))}
            {tab === "updates" &&
              (list as HistoryData["updates"]).map((u) => (
                <UpdateRow key={u.id} u={u} />
              ))}
            {tab === "threads" &&
              (list as HistoryData["threads"]).map((t) => (
                <ThreadRow key={t.id} t={t} />
              ))}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {all ? (
                <>
                  {all.nextCursor && (
                    <Button
                      className="min-h-11 sm:min-h-0"
                      isDisabled={all.loading}
                      size="sm"
                      variant="flat"
                      onPress={onMore}
                    >
                      더 보기 (
                      {Math.min(HISTORY_PAGE, all.total - all.items.length) ||
                        HISTORY_PAGE}
                      개)
                    </Button>
                  )}
                  {all.loading && (
                    <span className="text-xs text-default-500">읽는 중…</span>
                  )}
                  {!all.loading && !all.nextCursor && !all.error && (
                    <span className="text-xs text-default-500">
                      끝까지 다 봤어요.
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Button
                    className="min-h-11 sm:min-h-0"
                    size="sm"
                    variant="flat"
                    onPress={onShowAll}
                  >
                    전체 보기{total !== undefined ? ` · 총 ${total}개` : ""}
                  </Button>
                  {total !== undefined && total > list.length && (
                    <span className="text-xs text-default-500">
                      최근 {list.length}개만 보이는 중
                    </span>
                  )}
                </>
              )}
              {all?.error && (
                <span className="text-xs text-danger-500">
                  {all.error}
                </span>
              )}
            </div>

            {tab === "threads" && (
              <p className="text-xs text-default-500">
                대화 내용·이어서 지시는{" "}
                <a className="underline" href="/admin/factory?tab=jobs">
                  [일감] 탭
                </a>
                의 「공장 정비」에서 해요.
              </p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// [전체 히스토리] 탭 내용: 종류 필터 + 합친 목록(줄마다 종류 표시) + [더 보기]
function MergedList({
  merged,
  onFilter,
  onMore,
}: {
  merged: MergedHistory | null;
  onFilter: (f: HistoryFilter) => void;
  onMore: () => void;
}) {
  const filter = merged?.filter ?? "all";
  const items = merged?.items ?? [];

  return (
    <div className="space-y-2" data-history="merged">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-default-200 pb-2 text-xs">
        <span className="font-semibold">
          전체 히스토리 · 최신순{" "}
          {merged && (
            <span className="font-mono text-default-500">
              {items.length} / {merged.total}
            </span>
          )}
        </span>
        <div aria-label="종류 필터" className="flex flex-wrap gap-1" role="group">
          {FILTERS.map(([f, label]) => (
            <Button
              key={f}
              aria-pressed={filter === f}
              className="min-h-11 sm:min-h-0"
              color={filter === f ? "secondary" : "default"}
              data-filter={f}
              size="sm"
              variant={filter === f ? "solid" : "flat"}
              onPress={() => onFilter(f)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      {items.length === 0 && merged && !merged.loading && !merged.error && (
        <p className="text-sm text-default-500">
          {filter === "all" ? "기록이 없어요." : EMPTY[filter]}
        </p>
      )}
      {items.map((m) => {
        const badge = (
          <Chip color={KIND_BADGE[m.type].color} data-kind={m.type} size="sm" variant="bordered">
            {KIND_BADGE[m.type].label}
          </Chip>
        );

        return m.type === "deploys" ? (
          <DeployRow key={`d-${m.item.id}`} badge={badge} d={m.item as HistoryData["deploys"][number]} />
        ) : m.type === "updates" ? (
          <UpdateRow key={`u-${m.item.id}`} badge={badge} u={m.item as HistoryData["updates"][number]} />
        ) : (
          <ThreadRow key={`t-${m.item.id}`} badge={badge} t={m.item as HistoryData["threads"][number]} />
        );
      })}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {merged?.nextCursor && (
          <Button
            className="min-h-11 sm:min-h-0"
            isDisabled={merged.loading}
            size="sm"
            variant="flat"
            onPress={onMore}
          >
            더 보기 (
            {Math.min(HISTORY_PAGE, merged.total - items.length) || HISTORY_PAGE}
            개)
          </Button>
        )}
        {(!merged || merged.loading) && (
          <span className="text-xs text-default-500">읽는 중…</span>
        )}
        {merged && !merged.loading && !merged.nextCursor && !merged.error && items.length > 0 && (
          <span className="text-xs text-default-500">끝까지 다 봤어요.</span>
        )}
        {merged?.error && (
          <span className="text-xs text-danger-500">{merged.error}</span>
        )}
      </div>
    </div>
  );
}

function DeployRow({
  d,
  badge,
}: {
  d: HistoryData["deploys"][number];
  badge?: ReactNode;
}) {
  const st = deployStatus(d);

  return (
    <div className="rounded-lg border border-default-200 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {badge}
        <Chip color={st.color} size="sm" variant="flat">
          {st.label}
        </Chip>
        <span className="font-mono text-xs">{short(d.commit)}</span>
        <span className="font-medium">{d.threadTitle}</span>
        {d.via && (
          <span className="text-xs text-default-500">
            ({d.via === "자동" ? "자동 배포" : `${d.via}에서 요청`})
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
        요청 {when(d.requestedAt)} · 시작 {when(d.startedAt)} · 완료{" "}
        {when(d.finishedAt)}
      </div>
      {d.result && <ResultText text={d.result} />}
    </div>
  );
}

function UpdateRow({
  u,
  badge,
}: {
  u: HistoryData["updates"][number];
  badge?: ReactNode;
}) {
  const r = updateResult(u);

  return (
    <div className="rounded-lg border border-default-200 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {badge}
        <Chip color={r.color} size="sm" variant="flat">
          {r.label}
        </Chip>
        <span className="font-mono text-xs">
          {u.fromCommit
            ? `${short(u.fromCommit)} → ${short(u.commit)}`
            : short(u.commit)}
        </span>
        <span className="font-mono text-xs text-default-500">{when(u.at)}</span>
      </div>
      {u.subject && <div className="mt-1 text-xs">📝 {u.subject}</div>}
      {u.thread && (
        <div className="mt-1 text-xs text-default-500">
          🛠 정비: {u.thread.title}
        </div>
      )}
      {u.note && <ResultText text={u.note} />}
    </div>
  );
}

function ThreadRow({
  t,
  badge,
}: {
  t: HistoryData["threads"][number];
  badge?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-default-200 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {badge}
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
  );
}

// 배포 결과·업데이트 소식: 길면(빌드 로그 끝부분 등) 3줄까지만 보이고 [펼치기]로 전부 본다
export const RESULT_FOLD_LINES = 3;
export const RESULT_FOLD_CHARS = 180;

export function isLongResult(text: string) {
  return (
    text.split("\n").length > RESULT_FOLD_LINES ||
    text.length > RESULT_FOLD_CHARS
  );
}

function ResultText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = isLongResult(text);

  return (
    <div className="mt-1 break-words text-xs text-default-600" data-result={long ? (open ? "open" : "folded") : "short"}>
      <div
        className={`whitespace-pre-wrap ${long && !open ? "line-clamp-3" : long ? "max-h-64 overflow-y-auto rounded border border-default-200 bg-background p-2 font-mono text-[11px]" : ""}`}
      >
        {text}
      </div>
      {long && (
        <button
          aria-expanded={open}
          className="mt-1 min-h-8 text-default-500 underline"
          type="button"
          onClick={() => setOpen(!open)}
        >
          {open ? "접기" : `펼치기 (${text.split("\n").length}줄)`}
        </button>
      )}
    </div>
  );
}
