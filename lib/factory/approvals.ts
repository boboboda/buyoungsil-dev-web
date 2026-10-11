// lib/factory/approvals.ts
// 승인·배포의 단일 입구. 텔레그램 버튼(lib/factory/telegram.ts)과 통제실 버튼(app/api/admin/factory/overview)이 모두 이 함수를 부른다.
// - 앱 일감(새 앱·수정·출시 준비) 승인: adminAction(approve) — pending → approved 조건부 갱신
// - 정비 지시 승인: approveTurn — awaiting_approval → queued 조건부 갱신
// - 서버 [배포]: requestDeploy — 진행 중인 배포가 없을 때만 조건부 갱신
// 모두 조건부 updateMany 라서 두 곳에서 동시에 눌러도 한 번만 실행되고, 늦은 쪽은 "이미 처리됨" 안내를 받는다.
// 이 파일에는 보기용 요약(승인 기다림 목록, 업데이트·배포 이력)도 같이 둔다.
import prisma from "@/lib/prisma";
import { ID_RE, KIND_LABELS, adminAction } from "@/lib/factory/jobs";
import { approveTurn, requestDeploy } from "@/lib/factory/maintenance";

export const APPROVAL_ACTIONS = [
  "job_approve",
  "maintenance_approve",
  "deploy",
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
): Promise<ApprovalResult> {
  if (!ID_RE.test(id))
    return { ok: false, status: 400, message: "id 가 올바르지 않아요." };

  switch (action) {
    case "job_approve": {
      const r = await adminAction(id, { action: "approve" });

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
    case "maintenance_approve":
      return approveTurn(id);
    case "deploy":
      return requestDeploy(id, via);
  }
}

// ───────── 보기 ─────────

const excerpt = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();

  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/** 승인·배포를 기다리는 것들(통제실 맨 위 "할 일" 목록) */
export async function approvalInbox() {
  const [jobs, turns, deployThreads] = await Promise.all([
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
    prisma.factoryMaintenance.findMany({
      where: { needsDeploy: true, pushedCommit: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
  ]);

  return {
    jobs: jobs.map((j) => ({ ...j, kindLabel: KIND_LABELS[j.kind] ?? j.kind })),
    turns: turns.map((t) => ({
      id: t.id,
      threadId: t.maintenance.id,
      threadTitle: t.maintenance.title,
      text: excerpt(t.text, 400),
      source: t.source,
      createdAt: t.createdAt,
    })),
    deploys: deployThreads.map((t) => ({
      threadId: t.id,
      title: t.title,
      commit: t.pushedCommit,
      // 진행 중: 요청됐고 아직 결과가 없음
      inProgress: !!t.deployRequestedAt && !t.deployedAt && !t.deployResult,
      started: !!t.deployStartedAt,
      requestedAt: t.deployRequestedAt,
      lastResult: t.deployResult,
    })),
  };
}

/** 감독 프로그램 업데이트 이력. 커밋을 GitHub 에 올린 정비 대화가 있으면 그 제목도 붙인다. */
export async function supervisorUpdateHistory(limit = 40) {
  const events = await prisma.factorySupervisorEvent.findMany({
    orderBy: { id: "desc" },
    take: limit,
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

/** 서버 배포 이력(정비 제목 포함) */
export async function deployHistory(limit = 40) {
  const rows = await prisma.factoryDeploy.findMany({
    orderBy: { requestedAt: "desc" },
    take: limit,
    include: { maintenance: { select: { id: true, title: true } } },
  });

  return rows.map((d) => ({
    id: d.id,
    threadId: d.maintenance.id,
    threadTitle: d.maintenance.title,
    commit: d.commit,
    via: d.via,
    requestedAt: d.requestedAt,
    startedAt: d.startedAt,
    finishedAt: d.finishedAt,
    ok: d.ok,
    result: d.result ? excerpt(d.result, 600) : null,
  }));
}

/** 정비 대화 요약(제목·상태·올린 커밋·배포 필요 여부). 대화 본문은 공장 정비 패널에서 본다. */
export async function maintenanceSummary(limit = 30) {
  const threads = await prisma.factoryMaintenance.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
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
