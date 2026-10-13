// components/admin/factory/FactoryOverview.tsx
// 통제실 "승인·배포 할 일"(텔레그램 버튼과 같은 동작)과 "업데이트·배포 이력"(감독 프로그램 업데이트, 서버 배포, 정비 대화 요약).
// 승인·배포는 /api/admin/factory/overview → lib/factory/approvals.ts runApproval 로, 텔레그램과 같은 함수를 쓴다.
// 텔레그램과 동시에 눌러도 한쪽만 처리되고, 늦은 쪽에는 "이미 처리됨" 안내가 나온다.
"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody } from "@heroui/react";

import ClaudeModelSelect, { ModelTag } from "./ClaudeModelSelect";
import {
  type StatusInfo,
  formatElapsed,
  isLiveKind,
  jobStatusInfo,
  KindChip,
  StatusChip,
  StatusDot,
  turnStatusInfo,
  type StatusKind,
} from "./fx";

import { AI_LABELS, isAiEngine, isClaudeModel, type AiEngine, type TaskModel } from "@/lib/factory/ai";

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
      aiEngine?: string; // Claude Code 일감에만 모델 선택(예전 서버에는 없다 → 숨김)
      source: string | null;
      createdAt: string;
    }[];
    turns: {
      id: string;
      threadId: string;
      threadTitle: string;
      text: string;
      aiEngine?: string;
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
  // [현황] 맨 위 '지금 진행 중' 띠(예전 서버에는 없다 → 띠가 '진행 중인 작업 없음'으로 보인다)
  active?: ActiveNow;
  // 종류별 전체 개수(예전 서버에는 없다. jobs 는 앱 일감을 넣은 서버부터)
  totals?: Partial<Record<HistoryKind, number>>;
  // 기본 모델·주사용 AI(승인 줄의 '기본 설정 사용' 표시)
  supervisor?: { defaultClaudeModel?: string | null; defaultAiEngine?: string };
  message?: string;
}

// 서버가 알려 주는 진행 중 일감·정비 지시와 대기 개수(진행 중 서버 배포는 inbox.deploys 에서 합친다)
export interface ActiveItem {
  type: "job" | "maintenance" | "deploy";
  id: string;
  title: string;
  sub?: string | null;
  kindLabel: string;
  startedAt: string | null;
  aiEngine?: string | null;
  aiModel?: string | null;
}
export interface ActiveNow {
  running: ActiveItem[];
  queued: number;
  next: { type: "job" | "maintenance"; title: string } | null;
}

export type HistoryKind = "deploys" | "updates" | "threads" | "jobs";
// 앱 일감 목록은 탭을 누를 때 /api/admin/factory/history 에서 읽는다(overview 에는 개수만)
export type HistoryData = Pick<Overview, "deploys" | "updates" | "threads" | "totals">;
// 앱 일감 한 줄(/api/admin/factory/history?kind=jobs 의 항목. 기획서 본문·로그·작업 PC 이름은 없다)
export interface JobHistoryItem {
  id: string;
  appSlug: string;
  title: string;
  kind: string;
  kindLabel: string;
  status: string;
  aiEngine: string;
  aiModel: string | null;
  result: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
type HistoryItem = HistoryData[Exclude<HistoryKind, "jobs">][number] | JobHistoryItem;

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

// 종류별 개수(예전 서버는 최근 목록 길이, 앱 일감은 개수를 모르면 0)
export const countOf = (data: HistoryData | null, k: HistoryKind) =>
  data?.totals?.[k] ?? (k === "jobs" ? 0 : (data?.[k].length ?? 0));

// 전체 히스토리 탭 이름 옆 배지: 네 종류 전체 개수 합
export const totalOf = (data: HistoryData | null) =>
  data
    ? (["deploys", "updates", "threads", "jobs"] as const).reduce(
        (n, k) => n + countOf(data, k),
        0,
      )
    : undefined;

// 줄을 누르면 [일감] 탭의 그 일감 상세가 열린다
export const jobHref = (id: string) =>
  `/admin/factory?tab=jobs&job=${encodeURIComponent(id)}`;

const when = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("ko-KR") : "-";
const short = (c: string | null | undefined) => (c ? c.slice(0, 7) : "-");

// 업데이트 소식 문구로 결과를 나눈다(감독 프로그램 update.mjs 의 "자동 업데이트 …" 문구)
function updateResult(u: Overview["updates"][number]): {
  label: string;
  kind: StatusKind;
} {
  const n = u.note ?? "";

  if (n.includes("실패")) return { label: "실패·되돌림", kind: "fail" };
  if (n.startsWith("자동 업데이트 확인:") && n.includes("성공"))
    return { label: "새 버전 확인됨", kind: "done" };
  if (n.startsWith("자동 업데이트 완료"))
    return { label: "받음(재시작)", kind: "done" };
  if (n.startsWith("자동 업데이트 시작"))
    return { label: "받는 중", kind: "run" };
  if (n.includes("건너뜀")) return { label: "건너뜀", kind: "cancel" };
  if (n.includes("이미 최신")) return { label: "이미 최신", kind: "done" };
  if (u.fromCommit) return { label: "버전 바뀜", kind: "done" };

  return { label: "소식", kind: "info" };
}

function deployStatus(d: Overview["deploys"][number]): {
  label: string;
  kind: StatusKind;
} {
  if (d.ok === true) return { label: "완료", kind: "done" };
  if (d.ok === false) return { label: "실패", kind: "fail" };
  if (d.startedAt) return { label: "진행 중(빌드)", kind: "run" };

  return { label: "진행 중(PC 대기)", kind: "run" };
}

// 정비 대화 한 줄의 상태: 배포 중이면 진행 중, 아니면 마지막 지시의 상태(없으면 상태 칩 없음)
function threadStatus(t: HistoryData["threads"][number]): StatusInfo | null {
  if (t.deployInProgress) return { kind: "run", label: "배포 진행 중" };

  return t.lastTurnStatus ? turnStatusInfo(t.lastTurnStatus) : null;
}

// '진행 중만 보기': 진행 중이거나 사람이 눌러야 하는 줄
export function isLiveItem(type: HistoryKind, item: HistoryItem) {
  if (type === "jobs") return isLiveKind(jobStatusInfo((item as JobHistoryItem).status).kind);
  if (type === "deploys") return isLiveKind(deployStatus(item as Overview["deploys"][number]).kind);
  if (type === "updates") return isLiveKind(updateResult(item as Overview["updates"][number]).kind);

  const s = threadStatus(item as HistoryData["threads"][number]);

  return !!s && isLiveKind(s.kind);
}

// children(감독 프로그램 카드)은 "할 일"과 "이력" 사이에 놓는다.
export default function FactoryOverview({
  children,
  initialTab,
}: {
  children?: ReactNode;
  // 주소의 ?history=jobs 처럼 이력 탭을 바로 열 때(예: [일감] 탭의 '최근 50개만 보임' 안내 링크)
  initialTab?: HistoryTab;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<HistoryTab>(initialTab ?? "deploys");
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
    // 주소로 이력 탭을 지정했으면 펼쳐서 그 탭의 목록을 읽는다
    if (initialTab) {
      setHistoryOpen(true);
      if (initialTab === "all") loadMerged("all");
      else loadAll(initialTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // 승인 줄마다 고른 모델(없으면 '기본 설정 사용')
  const [models, setModels] = useState<Record<string, TaskModel>>({});
  const pickModel = useCallback((id: string) => (m: TaskModel) => setModels((cur) => (cur[id] === m ? cur : { ...cur, [id]: m })), []);
  const act = async (action: Action, id: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(`${action}:${id}`);
    setNotice(null);
    const model = models[id];

    try {
      const res = await fetch("/api/admin/factory/overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, ...(model && model !== "default" ? { aiModel: model } : {}) }),
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
  const sup = data?.supervisor;
  const modelDefaults = {
    model: isClaudeModel(sup?.defaultClaudeModel) ? sup.defaultClaudeModel : null,
    engine: isAiEngine(sup?.defaultAiEngine) ? sup.defaultAiEngine : null,
  };
  const todo = inbox
    ? inbox.jobs.length +
      inbox.turns.length +
      inbox.deploys.filter((d) => !d.inProgress && d.canDeploy !== false).length
    : 0;

  return (
    <>
      <ActiveStrip active={data?.active} deploys={inbox?.deploys} loading={!data} />

      <Card className="mb-6" data-title="todo · 승인·배포" id="factory-todo">
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
              className="fx-row flex flex-col gap-2 rounded-lg border border-default-200 p-2 sm:flex-row sm:items-center sm:justify-between"
              data-st={d.inProgress ? "run" : "approval"}
            >
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip kind={d.inProgress ? "run" : "approval"} label={d.inProgress ? "배포 진행 중" : "승인 필요"} />
                  <KindChip label="🚀 서버 배포" />
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
              className="fx-row flex flex-col gap-2 rounded-lg border border-default-200 p-2 sm:flex-row sm:items-center sm:justify-between"
              data-st="approval"
            >
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip kind="approval" />
                  <KindChip label="🛠 정비 지시" />
                  <span className="font-medium">{t.threadTitle}</span>
                  <span className="font-mono text-xs text-default-500">
                    {t.source ?? ""} · {when(t.createdAt)}
                  </span>
                </div>
                <div className="mt-1 whitespace-pre-wrap break-words text-xs text-default-600">
                  {t.text}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2" data-approve={t.id}>
                {t.aiEngine && (
                  <ClaudeModelSelect
                    defaults={modelDefaults}
                    disabled={!!busy}
                    engine={t.aiEngine}
                    value={models[t.id] ?? "default"}
                    onChange={pickModel(t.id)}
                  />
                )}
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
            </div>
          ))}

          {inbox?.jobs.map((j) => (
            <div
              key={`j-${j.id}`}
              className="fx-row flex flex-col gap-2 rounded-lg border border-default-200 p-2 sm:flex-row sm:items-center sm:justify-between"
              data-st="approval"
            >
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip kind="approval" />
                  <KindChip label={`${j.kind === "release" ? "📦 " : "📱 "}${j.kindLabel}`} />
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
              <div className="flex flex-wrap items-center gap-2" data-approve={j.id}>
                {j.aiEngine && (
                  <ClaudeModelSelect
                    defaults={modelDefaults}
                    disabled={!!busy}
                    engine={j.aiEngine}
                    value={models[j.id] ?? "default"}
                    onChange={pickModel(j.id)}
                  />
                )}
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
          // 앱 일감은 개수가 많아서 처음부터 20개씩 [더 보기]로 보여 준다
          if (k === "jobs") loadAll("jobs");
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
  jobs: "앱 일감 기록이 없어요.",
};

// 전체 히스토리에서 줄마다 붙는 종류 표시와 필터 이름
const KIND_BADGE: Record<HistoryKind, { label: string }> = {
  deploys: { label: "🚀 배포" },
  updates: { label: "🔄 감독" },
  threads: { label: "🛠 정비" },
  jobs: { label: "📦 일감" },
};
const FILTERS = [
  ["all", "전체"],
  ["deploys", "배포"],
  ["updates", "감독"],
  ["threads", "정비"],
  ["jobs", "일감"],
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
  initialLiveOnly = false,
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
  initialLiveOnly?: boolean; // '진행 중만 보기' 처음 값(시험·미리보기용)
}) {
  const [liveOnly, setLiveOnly] = useState(initialLiveOnly);
  const toggleLive = () => setLiveOnly((v) => !v);
  const kindTab = tab === "all" ? null : tab;
  const all = full && full.kind === tab ? full : null;
  // 앱 일감은 최근 목록이 없고(overview 에는 개수만) 탭을 누르면 바로 전체 목록을 읽는다
  const list: HistoryItem[] = all
    ? all.items
    : kindTab && kindTab !== "jobs"
      ? (data?.[kindTab] ?? [])
      : [];
  const total = all ? all.total : kindTab ? data?.totals?.[kindTab] : undefined;
  const count = (k: HistoryKind) => countOf(data, k);
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
                {count("threads")} · 일감 {count("jobs")}, 눌러서 펼치기)
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
            {/* 앱 일감(앱 만들기·고치기·출시)은 탭 줄에 늘 보이고 개수 배지가 붙는다 */}
            <Button
              aria-selected={open && tab === "jobs"}
              color={open && tab === "jobs" ? "primary" : "default"}
              data-tab="jobs"
              role="tab"
              size="sm"
              variant={open && tab === "jobs" ? "solid" : "flat"}
              onPress={() => onTab("jobs")}
            >
              📦 앱 일감
              {data && (
                <span
                  className="rounded-full bg-default-200 px-1.5 font-mono text-[11px] text-default-700"
                  data-jobs-total
                >
                  총 {count("jobs")}개
                </span>
              )}
            </Button>
          </div>
        </div>

        {open && !data && <p className="text-sm text-default-500">읽는 중…</p>}

        {open && data && tab === "all" && (
          <MergedList
            liveOnly={liveOnly}
            merged={merged}
            onFilter={onFilter}
            onLive={toggleLive}
            onMore={onMoreMerged}
          />
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
            {list.length === 0 && !all?.loading && !(kindTab === "jobs" && !all) && (
              <p className="text-sm text-default-500">{EMPTY[kindTab]}</p>
            )}
            {kindTab === "jobs" && !all && (
              <p className="text-sm text-default-500">읽는 중…</p>
            )}
            {tab === "jobs" && (
              <div className="flex flex-wrap items-center gap-2">
                <LiveToggle liveOnly={liveOnly} onLive={toggleLive} />
                {liveOnly && (
                  <span className="text-xs text-default-500" data-live-note>
                    불러온 {list.length}개 중 진행 중·승인 필요만 보여요.
                  </span>
                )}
              </div>
            )}
            {tab === "jobs" &&
              (list as JobHistoryItem[])
                .filter((j) => !liveOnly || isLiveItem("jobs", j))
                .map((j) => <JobRow key={j.id} j={j} />)}
            {tab === "jobs" && liveOnly && !all?.loading && (list as JobHistoryItem[]).every((j) => !isLiveItem("jobs", j)) && (
              <p className="text-sm text-default-500">진행 중이거나 승인이 필요한 일감이 없어요.</p>
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
  liveOnly,
  onLive,
}: {
  merged: MergedHistory | null;
  onFilter: (f: HistoryFilter) => void;
  onMore: () => void;
  liveOnly: boolean;
  onLive: () => void;
}) {
  const filter = merged?.filter ?? "all";
  const items = merged?.items ?? [];
  const shown = liveOnly ? items.filter((m) => isLiveItem(m.type, m.item)) : items;

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
          <LiveToggle liveOnly={liveOnly} onLive={onLive} />
        </div>
      </div>
      {liveOnly && items.length > 0 && (
        <p className="text-xs text-default-500" data-live-note>
          불러온 {items.length}개 중 진행 중·승인 필요 {shown.length}개만 보여요{merged?.nextCursor ? " (더 보기를 누르면 더 찾아요)" : ""}.
        </p>
      )}
      {liveOnly && items.length > 0 && shown.length === 0 && (
        <p className="text-sm text-default-500">진행 중이거나 승인이 필요한 줄이 없어요.</p>
      )}
      {items.length === 0 && merged && !merged.loading && !merged.error && (
        <p className="text-sm text-default-500">
          {filter === "all" ? "기록이 없어요." : EMPTY[filter]}
        </p>
      )}
      {shown.map((m) => {
        const badge = <KindChip kind={m.type} label={KIND_BADGE[m.type].label} />;

        return m.type === "deploys" ? (
          <DeployRow key={`d-${m.item.id}`} badge={badge} d={m.item as HistoryData["deploys"][number]} />
        ) : m.type === "updates" ? (
          <UpdateRow key={`u-${m.item.id}`} badge={badge} u={m.item as HistoryData["updates"][number]} />
        ) : m.type === "jobs" ? (
          <JobRow key={`j-${m.item.id}`} badge={badge} j={m.item as JobHistoryItem} />
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
    <div className="fx-row rounded-lg border border-default-200 p-2 text-sm" data-st={st.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip kind={st.kind} label={st.label} />
        {badge}
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
      {d.result && <ResultText fail={st.kind === "fail"} text={d.result} />}
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
    <div className="fx-row rounded-lg border border-default-200 p-2 text-sm" data-st={r.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip kind={r.kind} label={r.label} />
        {badge}
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
      {u.note && <ResultText fail={r.kind === "fail"} text={u.note} />}
    </div>
  );
}

// 앱 일감 한 줄: 제목(누르면 [일감] 탭의 그 일감 상세)·앱·종류·상태·시각·모델·결과 요약(길면 접기)
function JobRow({ j, badge }: { j: JobHistoryItem; badge?: ReactNode }) {
  const st = jobStatusInfo(j.status);
  const engine = (j.aiEngine === "codex" ? "codex" : "claude") as AiEngine;

  return (
    <div className="fx-row rounded-lg border border-default-200 p-2 text-sm" data-job={j.id} data-st={st.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip kind={st.kind} label={st.label} />
        {badge}
        <KindChip label={j.kindLabel} />
        <a className="min-w-0 break-words font-medium underline decoration-default-300 underline-offset-2" href={jobHref(j.id)}>
          {j.title}
        </a>
        <span className="font-mono text-xs text-default-500">{j.appSlug}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-default-500">
        <span>요청 {when(j.createdAt)}</span>
        <span>시작 {when(j.startedAt)}</span>
        <span>완료 {when(j.finishedAt)}</span>
        <span className="font-sans">{AI_LABELS[engine]}</span>
        <ModelTag engine={engine} model={j.aiModel} />
      </div>
      {j.result && <ResultText fail={st.kind === "fail"} text={j.result} />}
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
  const st = threadStatus(t);

  return (
    <div className="fx-row rounded-lg border border-default-200 p-2 text-sm" data-st={st?.kind ?? "info"}>
      <div className="flex flex-wrap items-center gap-2">
        {st && <StatusChip kind={st.kind} label={st.label} />}
        {badge}
        <span className="font-medium">{t.title}</span>
        {/* 대화(스레드)가 열려 있는지일 뿐 작업 상태가 아니다 → 흐린 보조 표시 */}
        <span className="fx-faint text-xs" data-thread-open={t.status === "open" ? "open" : "closed"}>
          {t.status === "open" ? "대화 열림" : "대화 닫힘"}
        </span>
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

function ResultText({ text, fail = false }: { text: string; fail?: boolean }) {
  const [open, setOpen] = useState(false);
  const long = isLongResult(text);

  return (
    <div className={`mt-1 break-words text-xs ${fail ? "fx-fail-text" : "text-default-600"}`} data-fail-reason={fail ? "" : undefined} data-result={long ? (open ? "open" : "folded") : "short"}>
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

// '진행 중만 보기' 토글(전체 히스토리 탭·앱 일감 탭)
function LiveToggle({ liveOnly, onLive }: { liveOnly: boolean; onLive: () => void }) {
  return (
    <Button
      aria-pressed={liveOnly}
      className="min-h-11 sm:min-h-0"
      color={liveOnly ? "primary" : "default"}
      data-live-toggle
      size="sm"
      variant={liveOnly ? "solid" : "flat"}
      onPress={onLive}
    >
      {liveOnly ? "▶ 진행 중만 보는 중" : "▶ 진행 중만 보기"}
    </Button>
  );
}

// 띠에 보일 최대 개수. 더 있으면 '외 N개'
export const ACTIVE_MAX = 3;

// 진행 중 목록: 서버가 준 일감·정비 + 진행 중인 서버 배포(inbox.deploys). 시작이 빠른 것부터
export function activeItems(active: ActiveNow | undefined, deploys: Overview["inbox"]["deploys"] | undefined): ActiveItem[] {
  const dep: ActiveItem[] = (deploys ?? [])
    .filter((d) => d.inProgress)
    .map((d) => ({
      type: "deploy" as const,
      id: d.threadId,
      title: d.title,
      sub: d.commit ? short(d.commit) : null,
      kindLabel: "서버 배포",
      startedAt: d.requestedAt,
    }));

  return [...(active?.running ?? []), ...dep].sort((a, b) => (Date.parse(a.startedAt ?? "") || Infinity) - (Date.parse(b.startedAt ?? "") || Infinity));
}

const activeHref = (it: ActiveItem) => (it.type === "job" ? jobHref(it.id) : it.type === "deploy" ? "#factory-todo" : "/admin/factory?tab=jobs");
const TYPE_ICON = { job: "📦", maintenance: "🛠", deploy: "🚀" } as const;

// [현황] 맨 위 '지금 진행 중' 띠. 값은 7초마다 읽는 overview(active + inbox.deploys) 하나에서만 온다
// (아래 이력·할 일과 같은 응답이라 서로 어긋나지 않는다). now 를 주면 그 시각 기준(시험·미리보기), 아니면 10초마다 갱신
export function ActiveStrip({
  active,
  deploys,
  loading = false,
  now,
}: {
  active: ActiveNow | undefined;
  deploys?: Overview["inbox"]["deploys"];
  loading?: boolean;
  now?: number;
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (now !== undefined) return;
    const t = setInterval(() => setTick((n) => n + 1), 10000);

    return () => clearInterval(t);
  }, [now]);
  void tick;
  const at = now ?? Date.now();
  const items = activeItems(active, deploys);
  const shown = items.slice(0, ACTIVE_MAX);
  const queued = active?.queued ?? 0;

  return (
    <section aria-label="지금 진행 중" className="mb-4 space-y-2" data-active-strip data-title="now · 지금 진행 중">
      {loading && <p className="text-sm text-default-500">읽는 중…</p>}
      {!loading && items.length === 0 && (
        <p className="text-base font-semibold" data-active-none>
          <span className="fx-faint">▶</span> 진행 중인 작업 없음 · 대기 {queued}개
        </p>
      )}
      {shown.map((it) => (
        <a
          key={`${it.type}-${it.id}`}
          className="fx-active-item flex flex-col gap-1 rounded-lg p-3 no-underline"
          data-active-item={it.type}
          href={activeHref(it)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip kind="run" />
            <KindChip label={`${TYPE_ICON[it.type]} ${it.kindLabel}`} />
            <span className="fx-active-title">{it.title}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-default-500">
            {it.sub && <span className="font-mono">{it.sub}</span>}
            <span className="font-mono" data-elapsed>
              {it.startedAt ? `경과 ${formatElapsed(at - Date.parse(it.startedAt))}` : "시작하는 중"}
            </span>
            {it.aiEngine && (
              <span>
                {isAiEngine(it.aiEngine) ? AI_LABELS[it.aiEngine] : it.aiEngine}
                {it.aiModel && (
                  <>
                    {" · "}
                    <ModelTag engine={it.aiEngine} model={it.aiModel} />
                  </>
                )}
              </span>
            )}
          </div>
        </a>
      ))}
      {items.length > ACTIVE_MAX && (
        <p className="text-sm text-default-500" data-active-more>
          외 {items.length - ACTIVE_MAX}개 진행 중
        </p>
      )}
      {!loading && items.length > 0 && queued > 0 && (
        <p className="fx-faint text-sm" data-active-queued>
          대기 {queued}개{active?.next ? ` · 다음 차례: ${active.next.title}` : ""}
        </p>
      )}
      {!loading && items.length === 0 && active?.next && (
        <p className="fx-faint text-sm" data-active-next>
          다음 차례: {active.next.title}
        </p>
      )}
    </section>
  );
}
