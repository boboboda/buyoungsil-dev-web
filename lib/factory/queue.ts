// 앱별 일감 대기열(병렬화 단계 B). 같은 앱 안에서는 실행(running)이 1개이고, 승인된(approved) 일감은
// priority(큰 값 먼저) → 승인 시각 → 등록 시각 순으로 하나씩 실행한다. 승인 대기(pending)는 같은 규칙으로 뒤에 줄을 세워 보여 준다.
import prisma from "@/lib/prisma";
import { approvalWaitRemaining, groupOf, MERGE_FAIL_STAGE, PARALLEL_KIND, readConductorInfo, readParallelInfo, type ConductorInfo, type ParallelInfo } from "@/lib/factory/parallel";

export interface QueueSortable {
  priority: number;
  approvedAt: Date | null;
  createdAt: Date;
}

const time = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY);

/** 실행 순서 비교: priority 큰 값 먼저 → 승인 시각 빠른 순(미승인은 뒤) → 등록 시각 빠른 순. */
export function compareQueue(a: QueueSortable, b: QueueSortable): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const ta = time(a.approvedAt);
  const tb = time(b.approvedAt);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

export interface QueueItem {
  id: string;
  title: string;
  kind: string;
  status: string;
  priority: number;
  /** 0 = 지금 실행 중(합치기 실패로 멈춘 일감도 0), 1.. = 대기 순서 */
  position: number;
  /** 병행 그룹(같이 돌리기). 없으면 null */
  parallelGroup: string | null;
  /** 감독 프로그램이 보고한 병행 상태(worktree 실행·잠금 대기·합치는 중·다시 맞추기 횟수). 없으면 null */
  parallel: ParallelInfo | null;
  /** 합치기 실패로 멈춤(status 는 failed). 이미 합쳐진 다른 일감은 그대로다 */
  mergeFailed: boolean;
  /** 그룹을 정한 쪽: manual(사람) | conductor(지휘자) | null */
  parallelSource: string | null;
  /** 지휘자 판단(묶음·순서대로·판단 실패와 이유·예상 파일). 판단한 적 없으면 null */
  conductor: ConductorInfo | null;
  /** 승인 직후 '다른 승인'을 기다리는 남은 초(카드에 '다른 승인 기다림 n초'). 기다리지 않으면 0 */
  approvalWait: number;
  /** 묶음 안에 아직 승인 대기(pending)로 남은 다른 일감 수. 0보다 크면 이 묶음은 모두 승인될 때까지 시작하지 않는다 */
  groupPendingLeft: number;
}

export interface NumberOptions {
  /** 승인 직후 기다리는 시간(초, 설정). 0·생략 = 표시하지 않음 */
  waitSec?: number;
  now?: number;
}

/** 순서를 매긴다: 합치기 실패로 멈춘 것 → 실행 중(running) → 승인된 것 → 승인 대기 순으로 compareQueue. */
export function orderQueue<T extends QueueSortable & { status: string }>(rows: T[]): T[] {
  const failed = rows.filter((r) => r.status === "failed");
  const running = rows.filter((r) => r.status === "running");
  const approved = rows.filter((r) => r.status === "approved").sort(compareQueue);
  const pending = rows.filter((r) => r.status === "pending").sort(compareQueue);

  return [...failed, ...running, ...approved, ...pending];
}

const SELECT = { id: true, appSlug: true, title: true, kind: true, status: true, priority: true, approvedAt: true, createdAt: true, parallelGroup: true, parallelInfo: true, failStage: true, parallelSource: true, conductorInfo: true } as const;

/** 대기열에 올릴 상태: 실행 중·승인됨·승인 대기, 그리고 최근 7일 안에 합치기 실패로 멈춘 병행 일감(관리자 확인이 필요해서) */
const listWhere = () => ({
  OR: [{ status: { in: ["running", "approved", "pending"] } }, { status: "failed", failStage: MERGE_FAIL_STAGE, parallelGroup: { not: null }, finishedAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } }],
});

type Row = QueueSortable & { id: string; title: string; kind: string; status: string; priority: number; parallelGroup?: string | null; parallelInfo?: unknown; failStage?: string | null; parallelSource?: string | null; conductorInfo?: unknown };

/** 한 앱의 행들을 순서대로 번호 붙인다(순수 함수: 시험용). */
export function numberQueue(rows: Row[], opts: NumberOptions = {}): QueueItem[] {
  const failed = rows.filter((x) => x.status === "failed").length; // 번호 0 으로 보여 주므로 대기 번호 계산에서 뺀다
  const revision = (x: Row) => x.kind === PARALLEL_KIND;
  const wait = approvalWaitRemaining({
    approvedAts: rows.filter((x) => x.status === "approved" && revision(x) && !x.parallelGroup).map((x) => x.approvedAt),
    pendingCount: rows.filter((x) => x.status === "pending" && revision(x)).length,
    waitSec: opts.waitSec ?? 0,
    now: opts.now,
  });
  const pendingInGroup = (group: string | null | undefined) => (group ? rows.filter((x) => x.status === "pending" && revision(x) && x.parallelGroup === group).length : 0);

  return orderQueue(rows).map((r, i) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    status: r.status,
    priority: r.priority,
    // 실행 중은 0. 병행 그룹은 실행 중이 여러 개라 모두 0, 대기 번호는 실행 중 개수와 상관없이 1부터
    position: r.status === "running" || r.status === "failed" ? 0 : i - failed - rows.filter((x) => x.status === "running").length + 1,
    parallelGroup: r.parallelGroup ?? null,
    parallel: readParallelInfo(r.parallelInfo),
    mergeFailed: r.status === "failed" && r.failStage === MERGE_FAIL_STAGE,
    parallelSource: r.parallelSource ?? null,
    conductor: readConductorInfo(r.conductorInfo),
    approvalWait: r.status === "approved" && revision(r) && !r.parallelGroup ? wait : 0,
    groupPendingLeft: r.status === "approved" && groupOf({ kind: r.kind, parallelGroup: r.parallelGroup ?? null }) ? pendingInGroup(r.parallelGroup) : 0,
  }));
}

/** 한 앱의 대기열(running·approved·pending). */
export async function appQueue(appSlug: string, opts: NumberOptions = {}): Promise<QueueItem[]> {
  return numberQueue(await prisma.factoryJob.findMany({ where: { appSlug, kind: { not: "tool" }, ...listWhere() }, select: SELECT }), opts);
}

/** 여러 앱의 대기열을 한 번에(앱 이름 → 목록). 실행 중·대기가 없는 앱은 빠진다. 실험(lab)·도구 일감(tool)은 앱 슬롯과 따로 돌아서 뺀다. */
export async function allAppQueues(opts: NumberOptions = {}): Promise<Record<string, QueueItem[]>> {
  const rows = await prisma.factoryJob.findMany({ where: { ...listWhere(), kind: { notIn: ["lab", "tool"] } }, select: SELECT });
  const bySlug = new Map<string, Row[]>();

  for (const r of rows) bySlug.set(r.appSlug, [...(bySlug.get(r.appSlug) ?? []), r]);
  const out: Record<string, QueueItem[]> = {};

  for (const [slug, list] of bySlug) out[slug] = numberQueue(list, opts);

  return out;
}
