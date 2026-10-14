// 앱별 일감 대기열(병렬화 단계 B). 같은 앱 안에서는 실행(running)이 1개이고, 승인된(approved) 일감은
// priority(큰 값 먼저) → 승인 시각 → 등록 시각 순으로 하나씩 실행한다. 승인 대기(pending)는 같은 규칙으로 뒤에 줄을 세워 보여 준다.
import prisma from "@/lib/prisma";
import { MERGE_FAIL_STAGE, readParallelInfo, type ParallelInfo } from "@/lib/factory/parallel";

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
}

/** 순서를 매긴다: 합치기 실패로 멈춘 것 → 실행 중(running) → 승인된 것 → 승인 대기 순으로 compareQueue. */
export function orderQueue<T extends QueueSortable & { status: string }>(rows: T[]): T[] {
  const failed = rows.filter((r) => r.status === "failed");
  const running = rows.filter((r) => r.status === "running");
  const approved = rows.filter((r) => r.status === "approved").sort(compareQueue);
  const pending = rows.filter((r) => r.status === "pending").sort(compareQueue);

  return [...failed, ...running, ...approved, ...pending];
}

const SELECT = { id: true, appSlug: true, title: true, kind: true, status: true, priority: true, approvedAt: true, createdAt: true, parallelGroup: true, parallelInfo: true, failStage: true } as const;

/** 대기열에 올릴 상태: 실행 중·승인됨·승인 대기, 그리고 최근 7일 안에 합치기 실패로 멈춘 병행 일감(관리자 확인이 필요해서) */
const listWhere = () => ({
  OR: [{ status: { in: ["running", "approved", "pending"] } }, { status: "failed", failStage: MERGE_FAIL_STAGE, parallelGroup: { not: null }, finishedAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } }],
});

type Row = QueueSortable & { id: string; title: string; kind: string; status: string; priority: number; parallelGroup?: string | null; parallelInfo?: unknown; failStage?: string | null };

/** 한 앱의 행들을 순서대로 번호 붙인다(순수 함수: 시험용). */
export function numberQueue(rows: Row[]): QueueItem[] {
  const failed = rows.filter((x) => x.status === "failed").length; // 번호 0 으로 보여 주므로 대기 번호 계산에서 뺀다

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
  }));
}

/** 한 앱의 대기열(running·approved·pending). */
export async function appQueue(appSlug: string): Promise<QueueItem[]> {
  return numberQueue(await prisma.factoryJob.findMany({ where: { appSlug, ...listWhere() }, select: SELECT }));
}

/** 여러 앱의 대기열을 한 번에(앱 이름 → 목록). 실행 중·대기가 없는 앱은 빠진다. 실험(lab)은 앱이 아니라 뺀다. */
export async function allAppQueues(): Promise<Record<string, QueueItem[]>> {
  const rows = await prisma.factoryJob.findMany({ where: { ...listWhere(), kind: { not: "lab" } }, select: SELECT });
  const bySlug = new Map<string, Row[]>();

  for (const r of rows) bySlug.set(r.appSlug, [...(bySlug.get(r.appSlug) ?? []), r]);
  const out: Record<string, QueueItem[]> = {};

  for (const [slug, list] of bySlug) out[slug] = numberQueue(list);

  return out;
}
