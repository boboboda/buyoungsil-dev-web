// 앱별 일감 대기열(병렬화 단계 B). 같은 앱 안에서는 실행(running)이 1개이고, 승인된(approved) 일감은
// priority(큰 값 먼저) → 승인 시각 → 등록 시각 순으로 하나씩 실행한다. 승인 대기(pending)는 같은 규칙으로 뒤에 줄을 세워 보여 준다.
import prisma from "@/lib/prisma";

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
  /** 0 = 지금 실행 중, 1.. = 대기 순서 */
  position: number;
}

/** 순서를 매긴다: 실행 중(running) 먼저, 그 뒤에 승인된 것 → 승인 대기 순으로 compareQueue. */
export function orderQueue<T extends QueueSortable & { status: string }>(rows: T[]): T[] {
  const running = rows.filter((r) => r.status === "running");
  const approved = rows.filter((r) => r.status === "approved").sort(compareQueue);
  const pending = rows.filter((r) => r.status === "pending").sort(compareQueue);

  return [...running, ...approved, ...pending];
}

const SELECT = { id: true, appSlug: true, title: true, kind: true, status: true, priority: true, approvedAt: true, createdAt: true } as const;

type Row = QueueSortable & { id: string; title: string; kind: string; status: string; priority: number };

/** 한 앱의 행들을 순서대로 번호 붙인다(순수 함수: 시험용). */
export function numberQueue(rows: Row[]): QueueItem[] {
  const hasRunning = rows.some((x) => x.status === "running");

  return orderQueue(rows).map((r, i) => ({ id: r.id, title: r.title, kind: r.kind, status: r.status, priority: r.priority, position: r.status === "running" ? 0 : i + (hasRunning ? 0 : 1) }));
}

/** 한 앱의 대기열(running·approved·pending). */
export async function appQueue(appSlug: string): Promise<QueueItem[]> {
  return numberQueue(await prisma.factoryJob.findMany({ where: { appSlug, status: { in: ["running", "approved", "pending"] } }, select: SELECT }));
}

/** 여러 앱의 대기열을 한 번에(앱 이름 → 목록). 실행 중·대기가 없는 앱은 빠진다. 실험(lab)은 앱이 아니라 뺀다. */
export async function allAppQueues(): Promise<Record<string, QueueItem[]>> {
  const rows = await prisma.factoryJob.findMany({ where: { status: { in: ["running", "approved", "pending"] }, kind: { not: "lab" } }, select: SELECT });
  const bySlug = new Map<string, Row[]>();

  for (const r of rows) bySlug.set(r.appSlug, [...(bySlug.get(r.appSlug) ?? []), r]);
  const out: Record<string, QueueItem[]> = {};

  for (const [slug, list] of bySlug) out[slug] = numberQueue(list);

  return out;
}
