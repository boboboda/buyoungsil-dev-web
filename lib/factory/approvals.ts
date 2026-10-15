// lib/factory/approvals.ts
// 승인·배포의 단일 입구. 텔레그램 버튼(lib/factory/telegram.ts)과 통제실 버튼(app/api/admin/factory/overview)이 모두 이 함수를 부른다.
// - 앱 일감(새 앱·수정·출시 준비) 승인: adminAction(approve) — pending → approved 조건부 갱신
// - 계획 먼저 승인(5-1): plan_go(이대로 진행)·plan_revise(수정 지시, note 필요)·plan_cancel(취소) — 계획이 준비된 앱 일감에 대해
// - 정비 지시 승인: approveTurn — awaiting_approval → queued 조건부 갱신
// - 서버 [배포]: requestDeploy — 진행 중인 배포가 없고 정비 대기열이 비었을 때만(deploy_now 는 대기열이 남아도) 조건부 갱신
// - 정비 대기열이 실패로 멈췄을 때: queue_skip(계속 진행)·queue_retry(재시도)·queue_clear(비우기). id 는 멈춘(실패한) 지시 id
// 모두 조건부 updateMany 라서 두 곳에서 동시에 눌러도 한 번만 실행되고, 늦은 쪽은 "이미 처리됨" 안내를 받는다.
// 이 파일에는 보기용 요약(승인 기다림 목록, 업데이트·배포 이력)도 같이 둔다.
import prisma from "@/lib/prisma";
import { ID_RE, KIND_LABELS, adminAction } from "@/lib/factory/jobs";
import { approveTurn, deployBundle, queueAction, requestDeploy } from "@/lib/factory/maintenance";
import type { AiEngine, ClaudeModel } from "@/lib/factory/ai";

export const APPROVAL_ACTIONS = [
  "job_approve",
  "plan_go",
  "plan_revise",
  "plan_cancel",
  "maintenance_approve",
  "deploy",
  "deploy_now",
  "queue_skip",
  "queue_retry",
  "queue_clear",
] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
export type ApprovalVia = "통제실" | "텔레그램";

export interface ApprovalResult {
  ok: boolean;
  status: number;
  message: string;
  id?: string;
}

const JOB_STATE: Record<string, string> = {
  approved: "이미 승인돼 대기열에 있어요",
  running: "이미 진행 중이에요",
  done: "이미 끝난 일감이에요",
  failed: "실패한 일감이에요(재시도는 일감 목록에서)",
  cancelled: "취소된 일감이에요",
};

export async function runApproval(
  action: ApprovalAction,
  id: string,
  via: ApprovalVia,
  aiEngine?: AiEngine,
  aiModel: ClaudeModel | null = null, // 승인 때 고른 Claude Code 모델(null = 기본 설정 사용). Codex 일감이면 거부
  extra: { planFirst?: boolean; note?: string } = {}, // 승인 때 '계획 먼저' 선택(없으면 설정 기본값), 수정 지시 말
): Promise<ApprovalResult> {
  if (!ID_RE.test(id))
    return { ok: false, status: 400, message: "id 가 올바르지 않아요." };

  switch (action) {
    case "job_approve": {
      const r = await adminAction(id, { action: "approve", aiModel, ...(aiEngine ? { aiEngine } : {}), ...(typeof extra.planFirst === "boolean" ? { planFirst: extra.planFirst } : {}) });

      if (r.ok || r.status !== 409)
        return { ok: r.ok, status: r.status, message: r.message };
      const job = await prisma.factoryJob.findUnique({
        where: { id },
        select: { status: true },
      });

      return {
        ok: false,
        status: 409,
        message: `승인할 수 없어요: ${JOB_STATE[job?.status ?? ""] ?? r.message}.`,
      };
    }
    case "plan_go":
    case "plan_revise":
    case "plan_cancel": {
      const r = await adminAction(id, action === "plan_cancel" ? { action: "cancel" } : { action: action === "plan_go" ? "plan-go" : "plan-revise", note: extra.note });

      return { ok: r.ok, status: r.status, message: r.message };
    }
    case "maintenance_approve":
      return approveTurn(id, aiModel);
    case "deploy":
      return requestDeploy(id, via);
    case "deploy_now":
      // 텔레그램에는 [지금 배포] 버튼이 없다(확인창이 있는 통제실에서만)
      return requestDeploy(id, via, { force: via === "통제실" });
    case "queue_skip":
      return queueAction("skip", via, id);
    case "queue_retry":
      return queueAction("retry", via, id);
    case "queue_clear":
      return queueAction("clear", via, id);
  }
}

// ───────── 보기 ─────────

const excerpt = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();

  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/** 승인·배포를 기다리는 것들(통제실 맨 위 "할 일" 목록) */
export async function approvalInbox() {
  const [jobs, turns, bundle, confirmJobs, plans, planDefault] = await Promise.all([
    prisma.factoryJob.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        appSlug: true,
        title: true,
        kind: true,
        stack: true,
        aiEngine: true, // 승인 화면: Claude Code 일감에만 모델 선택을 보인다
        source: true,
        createdAt: true,
      },
    }),
    prisma.factoryMaintenanceMessage.findMany({
      where: { role: "user", status: "awaiting_approval" },
      orderBy: { createdAt: "asc" },
      take: 50,
      include: { maintenance: { select: { id: true, title: true } } },
    }),
    deployBundle(),
    // 도구 일감(2-3)이 PixelLab 비용 한도에 걸려 사람의 확인을 기다리는 것
    prisma.factoryJob.findMany({
      where: { status: "needs_confirmation" },
      orderBy: { updatedAt: "asc" },
      take: 50,
      select: { id: true, appSlug: true, title: true, kind: true, failReason: true, source: true, updatedAt: true },
    }),
    // 계획 먼저 승인(5-1): 계획이 준비돼(또는 못 만들어) 사람의 선택을 기다리는 일감
    import("@/lib/factory/planFirst").then((m) => m.planReviews()).catch(() => []),
    import("@/lib/factory/planFirst").then((m) => m.getPlanFirstDefault()).catch(() => ({ value: false })),
  ]);
  // 서버 배포는 정비 대기열 단위로 하나로 묶는다(배포 안 된 지시 목록 + 가장 최근 정비 커밋)
  const ip = bundle.inProgress;
  const deploys =
    bundle.items.length || ip
      ? [
          {
            threadId: (ip?.threadId ?? bundle.threadId)!,
            title: ip?.title ?? bundle.threadTitle ?? "정비 배포",
            commit: ip?.commit ?? bundle.commit,
            inProgress: !!ip,
            started: !!ip?.started,
            requestedAt: ip?.requestedAt ?? null,
            lastResult: bundle.lastResult && !bundle.lastResult.ok ? bundle.lastResult.result : null,
            items: bundle.items.map((i) => ({ title: i.title, commit: i.commit })),
            queueLeft: bundle.queueLeft,
            canDeploy: bundle.canDeploy,
          },
        ]
      : [];

  return {
    jobs: jobs.map((j) => ({ ...j, kindLabel: KIND_LABELS[j.kind] ?? j.kind })),
    planReviews: plans,
    planFirstDefault: planDefault.value,
    confirmations: confirmJobs.map((j) => ({ id: j.id, appSlug: j.appSlug, title: j.title, kind: j.kind, reason: excerpt(j.failReason, 300), source: j.source, at: j.updatedAt })),
    turns: turns.map((t) => ({
      id: t.id,
      threadId: t.maintenance.id,
      threadTitle: t.maintenance.title,
      text: excerpt(t.text, 400),
      aiEngine: t.aiEngine,
      source: t.source,
      createdAt: t.createdAt,
    })),
    deploys,
  };
}

/**
 * 지금 진행 중인 일감·정비 지시와 대기 개수(통제실 [현황] 맨 위 '지금 진행 중' 띠, 읽기 전용).
 * 진행 중 서버 배포는 approvalInbox().deploys 에 이미 있어서 화면이 합친다. 기획서·로그·작업 PC 이름은 싣지 않는다.
 */
export async function activeNow() {
  const [jobs, turns, queuedJobs, queuedTurns, nextJob, nextTurn] = await Promise.all([
    prisma.factoryJob.findMany({
      where: { status: "running" },
      orderBy: { startedAt: "asc" },
      take: 10,
      select: { id: true, appSlug: true, title: true, kind: true, releaseKind: true, aiEngine: true, aiModel: true, startedAt: true },
    }),
    prisma.factoryMaintenanceMessage.findMany({
      where: { role: "user", status: "running" },
      orderBy: { startedAt: "asc" },
      take: 10,
      include: { maintenance: { select: { id: true, title: true } } },
    }),
    prisma.factoryJob.count({ where: { status: "approved" } }),
    prisma.factoryMaintenanceMessage.count({ where: { role: "user", status: "queued" } }),
    prisma.factoryJob.findFirst({ where: { status: "approved" }, orderBy: { createdAt: "asc" }, select: { title: true, createdAt: true } }),
    prisma.factoryMaintenanceMessage.findFirst({ where: { role: "user", status: "queued" }, orderBy: { createdAt: "asc" }, include: { maintenance: { select: { title: true } } } }),
  ]);
  const nextIsTurn = !!nextTurn && (!nextJob || nextTurn.createdAt < nextJob.createdAt);
  const next = nextIsTurn ? { type: "maintenance" as const, title: nextTurn.maintenance.title } : nextJob ? { type: "job" as const, title: nextJob.title } : null;

  return {
    running: [
      ...jobs.map((j) => ({
        type: "job" as const,
        id: j.id,
        title: j.title,
        sub: j.appSlug,
        kindLabel: KIND_LABELS[j.releaseKind ? "release" : j.kind === "new" || j.kind === "lab" ? j.kind : "revision"] ?? j.kind,
        startedAt: j.startedAt,
        aiEngine: j.aiEngine,
        aiModel: j.aiModel,
      })),
      ...turns.map((t) => ({
        type: "maintenance" as const,
        id: t.id,
        threadId: t.maintenance.id,
        title: t.maintenance.title,
        sub: null as string | null,
        kindLabel: "정비",
        startedAt: t.startedAt,
        aiEngine: t.aiEngine,
        aiModel: t.aiModel,
      })),
    ],
    queued: queuedJobs + queuedTurns,
    next,
  };
}

/** 감독 프로그램 업데이트 이력. 커밋을 GitHub 에 올린 정비 대화가 있으면 그 제목도 붙인다. */
export async function supervisorUpdateHistory(limit = 40, cursor?: number) {
  const events = await prisma.factorySupervisorEvent.findMany({
    orderBy: { id: "desc" },
    take: limit,
    // 쪽 나누기: cursor 는 앞 쪽 마지막 항목 id(그 항목은 빼고 다음부터)
    cursor: cursor === undefined ? undefined : { id: cursor },
    skip: cursor === undefined ? 0 : 1,
  });
  const commits = [
    ...new Set(events.filter((e) => e.fromCommit).map((e) => e.commit)),
  ];
  const threads = commits.length
    ? await prisma.factoryMaintenance.findMany({
        where: {
          OR: commits.map((c) => ({ pushedCommit: { startsWith: c } })),
        },
        select: { id: true, title: true, pushedCommit: true },
      })
    : [];

  return events.map((e) => {
    const t = e.fromCommit
      ? threads.find((x) => x.pushedCommit?.startsWith(e.commit))
      : undefined;

    return { ...e, thread: t ? { id: t.id, title: t.title } : null };
  });
}

const parseItems = (raw: string | null) => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;

    return Array.isArray(v) ? (v as { title: string; commit: string }[]).map((i) => ({ title: String(i.title ?? ""), commit: String(i.commit ?? "") })) : null;
  } catch {
    return null;
  }
};

/** 서버 배포 이력(정비 제목·포함된 지시 포함) */
export async function deployHistory(limit = 40, cursor?: string) {
  const rows = await prisma.factoryDeploy.findMany({
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    take: limit,
    // 쪽 나누기: cursor 는 앞 쪽 마지막 항목 id(그 항목은 빼고 다음부터)
    cursor: cursor === undefined ? undefined : { id: cursor },
    skip: cursor === undefined ? 0 : 1,
    include: { maintenance: { select: { id: true, title: true } } },
  });

  const revert = await import("@/lib/factory/deployRevert").then((m) => m.revertInfoFor(rows.filter((d) => d.ok === true))).catch(() => new Map<string, { allowed: boolean; reason: string | null }>());

  return rows.map((d) => ({
    id: d.id,
    kind: d.kind, // deploy | revert(배포 되돌리기, 5-2)
    revertTo: d.revertTo,
    revert: revert.get(d.id) ?? null, // 성공한 배포: [이전 버전으로] 가능 여부와 막힌 이유
    threadId: d.maintenance.id,
    threadTitle: d.maintenance.title,
    commit: d.commit,
    via: d.via,
    requestedAt: d.requestedAt,
    startedAt: d.startedAt,
    finishedAt: d.finishedAt,
    ok: d.ok,
    result: d.result ? excerpt(d.result, 600) : null,
    items: parseItems(d.items), // 이 배포에 포함된 지시(예전 배포는 null)
  }));
}

/**
 * 앱 일감 이력(앱 만들기·고치기·출시 일감, 요청 시각 최신순). 필요한 열만 읽는다 —
 * 기획서 본문·로그·작업 PC 이름·도구 요청·빌드 결과는 싣지 않는다.
 */
export async function jobHistory(limit = 40, cursor?: string) {
  const rows = await prisma.factoryJob.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    // 쪽 나누기: cursor 는 앞 쪽 마지막 항목 id(그 항목은 빼고 다음부터)
    cursor: cursor === undefined ? undefined : { id: cursor },
    skip: cursor === undefined ? 0 : 1,
    select: {
      id: true,
      appSlug: true,
      title: true,
      kind: true,
      releaseKind: true,
      status: true,
      aiEngine: true,
      aiModel: true,
      summary: true,
      failReason: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
    },
  });

  return rows.map((j) => {
    // 출시 일감은 kind 가 revision 이어도 releaseKind 가 채워져 있다
    const kind = j.releaseKind ? "release" : j.kind === "new" || j.kind === "lab" ? j.kind : "revision";

    return {
      id: j.id,
      appSlug: j.appSlug,
      title: j.title,
      kind,
      kindLabel: KIND_LABELS[kind] ?? kind,
      status: j.status,
      aiEngine: j.aiEngine,
      aiModel: j.aiModel,
      // 실패면 실패 이유, 아니면 완료 요약. 길면 화면에서 접는다
      result: excerpt(j.status === "failed" ? (j.failReason ?? j.summary) : (j.summary ?? j.failReason), 600) || null,
      createdAt: j.createdAt,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
    };
  });
}

/** 정비 대화 요약(제목·상태·올린 커밋·배포 필요 여부). 대화 본문은 공장 정비 패널에서 본다. */
export async function maintenanceSummary(limit = 30, cursor?: string) {
  const threads = await prisma.factoryMaintenance.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
    // 쪽 나누기: cursor 는 앞 쪽 마지막 항목 id(그 항목은 빼고 다음부터)
    cursor: cursor === undefined ? undefined : { id: cursor },
    skip: cursor === undefined ? 0 : 1,
    include: {
      messages: {
        where: { role: "user" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, createdAt: true },
      },
      _count: { select: { messages: { where: { role: "user" } } } },
    },
  });

  return threads.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    lastTurnStatus: t.messages[0]?.status ?? null,
    turns: t._count.messages,
    pushedCommit: t.pushedCommit,
    needsDeploy: t.needsDeploy,
    deployInProgress: !!t.deployRequestedAt && !t.deployedAt && !t.deployResult,
    deployedAt: t.deployedAt,
    deployResult: t.deployResult ? excerpt(t.deployResult, 200) : null,
    updatedAt: t.updatedAt,
  }));
}

// ── 이력 전체 보기(통제실 이력 패널의 [전체 보기]·[더 보기]) ──
export const HISTORY_KINDS = ["deploys", "updates", "threads", "jobs"] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];
export const HISTORY_PAGE = 20;
export const HISTORY_PAGE_MAX = 100;

/** 이력 종류별 전체 개수(통제실 요약 줄·[전체 보기 · 총 N개]) */
export async function historyTotals(): Promise<Record<HistoryKind, number>> {
  const [deploys, updates, threads, jobs] = await Promise.all([
    prisma.factoryDeploy.count(),
    prisma.factorySupervisorEvent.count(),
    prisma.factoryMaintenance.count(),
    prisma.factoryJob.count(),
  ]);

  return { deploys, updates, threads, jobs };
}

/**
 * 이력 한 쪽(시간 역순). limit 은 1~100(기본 20), cursor 는 앞 쪽의 nextCursor.
 * 형식이 틀린 cursor 는 null(→ 400). 한 개 더 읽어서 다음 쪽이 있는지 안다.
 */
export async function historyPage(
  kind: HistoryKind,
  opts: { limit?: number; cursor?: string | null } = {},
) {
  const raw = Math.floor(Number(opts.limit ?? HISTORY_PAGE));
  const limit = Number.isFinite(raw)
    ? Math.min(HISTORY_PAGE_MAX, Math.max(1, raw))
    : HISTORY_PAGE;
  const cursor = opts.cursor || undefined;

  if (cursor && !(kind === "updates" ? /^\d{1,12}$/ : ID_RE).test(cursor))
    return null;
  const [rows, totals] = await Promise.all([
    kind === "deploys"
      ? deployHistory(limit + 1, cursor)
      : kind === "updates"
        ? supervisorUpdateHistory(limit + 1, cursor ? Number(cursor) : undefined)
        : kind === "threads"
          ? maintenanceSummary(limit + 1, cursor)
          : jobHistory(limit + 1, cursor),
    historyTotals(),
  ]);
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];

  return {
    kind,
    items,
    nextCursor: rows.length > limit && last ? String(last.id) : null,
    total: totals[kind],
  };
}

// ── 전체 히스토리(세 종류를 시간순으로 합친 목록) ──
// 항목 시각: 서버 배포는 요청 시각, 업데이트는 소식 시각, 정비 대화는 마지막 활동 시각, 앱 일감은 요청 시각.
// cursor 는 종류마다 앞 쪽에서 마지막으로 보여 준 id 를 묶은 것: "d:<id>.u:<번호>.t:<id>.j:<id>"(아직 안 나온 종류는 빠짐)
const ALL_TAG = { deploys: "d", updates: "u", threads: "t", jobs: "j" } as const;

export function parseAllCursor(raw: string | null | undefined) {
  const out: Partial<Record<HistoryKind, string>> = {};

  if (!raw) return out;
  for (const part of raw.split(".")) {
    const [tag, id, ...extra] = part.split(":");
    const kind = HISTORY_KINDS.find((k) => ALL_TAG[k] === tag);

    if (!kind || extra.length || !id || out[kind] !== undefined) return null;
    if (!(kind === "updates" ? /^\d{1,12}$/ : ID_RE).test(id)) return null;
    out[kind] = id;
  }

  return out;
}

const atOf = (kind: HistoryKind, row: { requestedAt?: unknown; at?: unknown; updatedAt?: unknown; createdAt?: unknown }) =>
  new Date((kind === "deploys" ? row.requestedAt : kind === "updates" ? row.at : kind === "jobs" ? row.createdAt : row.updatedAt) as string | Date).getTime();

/**
 * 전체 히스토리 한 쪽(최신 먼저). 종류마다 limit+1 개를 읽어 이미 정렬된 세 목록을 앞에서부터 합친다(종류 안의 순서는 그대로라 쪽 사이에 빠짐·겹침이 없다).
 * 항목은 { type, at, item } (item 은 같은 종류 탭의 항목 모양). 형식이 틀린 cursor 는 null(→ 400).
 */
export async function historyAllPage(opts: { limit?: number; cursor?: string | null } = {}) {
  const raw = Math.floor(Number(opts.limit ?? HISTORY_PAGE));
  const limit = Number.isFinite(raw)
    ? Math.min(HISTORY_PAGE_MAX, Math.max(1, raw))
    : HISTORY_PAGE;
  const cur = parseAllCursor(opts.cursor);

  if (!cur) return null;
  const [d, u, t, j, totals] = await Promise.all([
    deployHistory(limit + 1, cur.deploys),
    supervisorUpdateHistory(limit + 1, cur.updates ? Number(cur.updates) : undefined),
    maintenanceSummary(limit + 1, cur.threads),
    jobHistory(limit + 1, cur.jobs),
    historyTotals(),
  ]);
  const lists = { deploys: d, updates: u, threads: t, jobs: j } as const;
  const used: Record<HistoryKind, number> = { deploys: 0, updates: 0, threads: 0, jobs: 0 };
  const items: { type: HistoryKind; at: string; item: (typeof lists)[HistoryKind][number] }[] = [];

  while (items.length < limit) {
    let pick: HistoryKind | null = null;

    // 같은 시각이면 배포 → 업데이트 → 정비 → 일감 순
    for (const k of HISTORY_KINDS) {
      const row = lists[k][used[k]];

      if (row && (!pick || atOf(k, row) > atOf(pick, lists[pick][used[pick]]))) pick = k;
    }
    if (!pick) break;
    const row = lists[pick][used[pick]++];

    items.push({ type: pick, at: new Date(atOf(pick, row)).toISOString(), item: row });
  }
  const more = HISTORY_KINDS.some((k) => lists[k].length > used[k]);
  const next = HISTORY_KINDS.flatMap((k) => {
    const id = used[k] ? String(lists[k][used[k] - 1].id) : cur[k];

    return id ? [`${ALL_TAG[k]}:${id}`] : [];
  }).join(".");

  return {
    kind: "all" as const,
    items,
    nextCursor: more ? next : null,
    total: totals.deploys + totals.updates + totals.threads + totals.jobs,
  };
}
