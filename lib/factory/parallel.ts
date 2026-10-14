// 같은 앱 일감 병행 실행(병렬화 단계 C-1). 같은 앱·같은 병행 그룹(parallelGroup)의 승인된 수정 일감은 동시에 실행할 수 있다.
// 그룹이 없으면 지금처럼 앱당 1개. 감독 프로그램은 병행 일감을 git worktree 에서 돌리고, 끝난 순서대로 기본 브랜치에 합친다
// (tools/factory-supervisor/worktree.mjs, merge.mjs). 이 파일은 서버 쪽 규칙: 가져가기(claim) 선택, 그룹 묶기·풀기, 병행 상태 정리, 그룹 완료 요약.
import prisma from "@/lib/prisma";

/** 병행 그룹을 쓸 수 있는 일감 종류. 새 앱·출시·실험은 앱 폴더나 외부 상태를 건드리므로 병행하지 않는다 */
export const PARALLEL_KIND = "revision";

export const MIN_PER_APP = 1;
export const MAX_PER_APP = 4;
export const DEFAULT_PER_APP = 2;
export const MAX_GROUP_SIZE = 8;
export const MAX_REBASES = 2; // 합치기 실패(글자 충돌·검사 실패) 때 '최신 기본 브랜치 기준으로 다시 맞추기'를 되돌려 보내는 최대 횟수
export const MERGE_FAIL_STAGE = "merge"; // 합치기 실패로 멈춘 일감의 failStage
export const GROUP_RE = /^g-[a-z0-9]{4,20}$/;

/** 같은 앱에서 병행할 수 있는 개수로 받아들이는 값: 1~4 정수(숫자 또는 정수 문자열)만. 그 밖은 null */
export function cleanPerApp(v: unknown): number | null {
  if (typeof v === "string" && !/^\s*\d{1,3}\s*$/.test(v)) return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);

  return Number.isInteger(n) && n >= MIN_PER_APP && n <= MAX_PER_APP ? n : null;
}

// ───────────── 가져가기(claim) 규칙 ─────────────

export interface ClaimCandidate {
  id: string;
  appSlug: string;
  kind: string;
  priority: number;
  approvedAt: Date | null;
  createdAt: Date;
  parallelGroup: string | null;
}

export interface RunningRow {
  appSlug: string;
  kind: string;
  parallelGroup: string | null;
}

/** 일감이 실제로 속한 병행 그룹. 수정 일감이 아니면 그룹이 있어도 없는 것으로 본다 */
export function groupOf(row: { kind: string; parallelGroup: string | null }): string | null {
  return row.kind === PARALLEL_KIND && row.parallelGroup ? row.parallelGroup : null;
}

const time = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY);

function byOrder(a: ClaimCandidate, b: ClaimCandidate): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (time(a.approvedAt) !== time(b.approvedAt)) return time(a.approvedAt) < time(b.approvedAt) ? -1 : 1;

  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * 이번에 가져갈 일감 id 를 고른다(순수 함수).
 *  - 앱마다 이미 실행 중인 일감이 하나라도 그룹 없음이면 그 앱은 건너뛴다(예전과 같음: 앱당 1개).
 *  - 실행 중인 일감이 없으면 가장 앞선 승인 일감이 첫 번째. 그 일감이 그룹이 있으면 같은 그룹이 이어지는 동안 더 고른다.
 *  - 실행 중인 일감이 모두 같은 그룹이면 그 그룹의 승인 일감을 앞에서부터 이어 고른다.
 *  - 같은 앱에서 동시에 실행하는 수(이미 실행 중 + 이번에 고름)는 perApp 이하. 그룹이 아닌 일감이 끼어 있으면 거기서 멈춘다(순서를 새치기하지 않음).
 * 앱을 가로질러 전체 순서(priority→승인→등록)로 정렬한 앞에서부터 slots 개까지. 같은 앱 안의 순서는 항상 유지된다.
 */
export function pickClaims(args: { approved: ClaimCandidate[]; running: RunningRow[]; slots: number; perApp?: number }): string[] {
  const perApp = args.perApp === undefined ? DEFAULT_PER_APP : Math.min(MAX_PER_APP, Math.max(MIN_PER_APP, Math.floor(args.perApp)));
  const picks: ClaimCandidate[] = [];
  const bySlug = new Map<string, ClaimCandidate[]>();

  for (const c of args.approved) bySlug.set(c.appSlug, [...(bySlug.get(c.appSlug) ?? []), c]);

  for (const [slug, list] of bySlug) {
    const run = args.running.filter((r) => r.appSlug === slug);
    const runGroups = new Set(run.map((r) => groupOf(r)));

    if (run.some((r) => groupOf(r) === null)) continue; // 그룹 없는 일감이 돌고 있으면 앱당 1개
    if (runGroups.size > 1) continue; // 서로 다른 그룹이 섞여 돌 수 없다(방어)

    const ordered = [...list].sort(byOrder);
    const group: string | null = run.length ? [...runGroups][0] : groupOf(ordered[0]);
    let count = run.length;

    for (const c of ordered) {
      if (groupOf(c) !== group) break; // 다른 그룹이거나 그룹 없는 일감이 끼면 거기서 멈춘다(새치기 없음)
      if (group === null) {
        picks.push(c); // 그룹 없는 일감은 앱당 1개
        break;
      }
      if (count >= perApp) break;
      picks.push(c);
      count++;
    }
  }

  return picks
    .sort(byOrder)
    .slice(0, Math.max(0, Math.floor(args.slots)))
    .map((c) => c.id);
}

// ───────────── 병행 상태(감독 프로그램 보고) ─────────────

export interface ParallelInfo {
  worktree: boolean; // worktree 에서 실행 중
  lockWait: { name: string; since: string } | null; // 앱 단위 잠금 대기(build·emulator·port·merge)
  merging: boolean; // 기본 브랜치에 합치는 중(검사 포함)
  rebases: number; // 다시 맞추기를 되돌려 보낸 횟수
  mergedAt: string | null; // 기본 브랜치에 합친 시각(ISO)
  checks: string | null; // 합친 뒤 검사 결과 한 줄
}

export const LOCK_NAMES = ["build", "emulator", "port", "merge"] as const;
export const LOCK_LABELS: Record<string, string> = { build: "빌드", emulator: "에뮬레이터", port: "고정 포트", merge: "합치기" };

const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

/** 보고에서 받은 병행 상태를 정리한다(모양이 이상한 값은 버림). 하나도 못 읽으면 null */
export function cleanParallelInfo(v: unknown): ParallelInfo | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const lw = r.lockWait && typeof r.lockWait === "object" && !Array.isArray(r.lockWait) ? (r.lockWait as Record<string, unknown>) : null;
  const lockWait = lw && typeof lw.name === "string" && (LOCK_NAMES as readonly string[]).includes(lw.name) && typeof lw.since === "string" && ISO_RE.test(lw.since) ? { name: lw.name, since: lw.since } : null;
  const rebases = typeof r.rebases === "number" && Number.isInteger(r.rebases) ? Math.min(99, Math.max(0, r.rebases)) : 0;
  const text = (x: unknown) => (typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300) || null : null);

  return {
    worktree: r.worktree === true,
    lockWait,
    merging: r.merging === true,
    rebases,
    mergedAt: typeof r.mergedAt === "string" && ISO_RE.test(r.mergedAt) ? r.mergedAt : null,
    checks: text(r.checks),
  };
}

/** 저장된 JSON 을 화면용으로 읽는다(없거나 이상하면 null) */
export function readParallelInfo(v: unknown): ParallelInfo | null {
  return cleanParallelInfo(v);
}

// ───────────── 그룹 묶기·풀기 ─────────────

export type GroupResult = { ok: true; message: string; group?: string } | { ok: false; status: number; message: string };

const refuse = (status: number, message: string): GroupResult => ({ ok: false, status, message });

/** 새 그룹 이름: g- 뒤에 시각과 무작위 몇 글자 */
export function newGroupId(now = Date.now(), rand = Math.random()): string {
  return `g-${now.toString(36)}${Math.floor(rand * 36 ** 3).toString(36).padStart(3, "0")}`;
}

/** 승인 대기·승인됨 수정 일감 2개 이상을 같은 앱 안에서 '같이 돌리기'로 묶는다. 이미 그룹이 하나 있으면 거기에 합류시킨다 */
export async function groupJobs(jobIds: unknown): Promise<GroupResult> {
  if (!Array.isArray(jobIds) || jobIds.length < 2 || jobIds.length > MAX_GROUP_SIZE || jobIds.some((x) => typeof x !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(x))) {
    return refuse(400, `같이 돌릴 일감을 2~${MAX_GROUP_SIZE}개 골라 주세요.`);
  }
  const ids = [...new Set(jobIds as string[])];

  if (ids.length < 2) return refuse(400, "서로 다른 일감을 2개 이상 골라 주세요.");
  const rows = await prisma.factoryJob.findMany({ where: { id: { in: ids } }, select: { id: true, appSlug: true, kind: true, status: true, parallelGroup: true } });

  if (rows.length !== ids.length) return refuse(404, "없는 일감이 있어요.");
  if (new Set(rows.map((r) => r.appSlug)).size > 1) return refuse(400, "같은 앱의 일감끼리만 묶을 수 있어요.");
  if (rows.some((r) => r.kind !== PARALLEL_KIND)) return refuse(400, "수정 일감만 같이 돌릴 수 있어요(새 앱·출시·실험은 따로 돌아요).");
  if (rows.some((r) => r.status !== "pending" && r.status !== "approved")) return refuse(409, "승인 대기·승인됨 상태의 일감만 묶을 수 있어요(이미 시작한 일감은 묶을 수 없어요).");
  const existing = [...new Set(rows.map((r) => r.parallelGroup).filter((g): g is string => !!g))];

  if (existing.length > 1) return refuse(409, "서로 다른 그룹에 이미 들어 있어요. 먼저 한쪽을 풀어 주세요.");
  const group = existing[0] ?? newGroupId();

  await prisma.factoryJob.updateMany({ where: { id: { in: ids }, status: { in: ["pending", "approved"] } }, data: { parallelGroup: group } });

  return { ok: true, group, message: `${ids.length}개 일감을 같이 돌리도록 묶었어요. 승인된 일감부터 같은 앱에서 동시에 실행돼요(최대 동시 수는 설정의 '같은 앱에서 같이 돌릴 수').` };
}

/** 일감 하나를 그룹에서 뺀다(시작 전 일감만). 남은 일감이 1개뿐이면 그 그룹은 사실상 해제된 것과 같다 */
export async function ungroupJob(id: string): Promise<GroupResult> {
  const res = await prisma.factoryJob.updateMany({ where: { id, status: { in: ["pending", "approved", "failed"] }, parallelGroup: { not: null } }, data: { parallelGroup: null } });

  return res.count > 0 ? { ok: true, message: "그룹에서 뺐어요. 이 일감은 앞으로 앱당 1개 규칙으로 돌아요." } : refuse(409, "그룹에 들어 있지 않거나, 이미 실행 중이라 뺄 수 없어요.");
}

// ───────────── 그룹 완료 요약 ─────────────

export interface GroupJobView {
  id: string;
  title: string;
  status: string;
  finishedAt: Date | null;
  parallelInfo: unknown;
}

export interface GroupReport {
  appSlug: string;
  group: string;
  at: string;
  order: { id: string; title: string; rebases: number; checks: string | null }[];
  rebases: number;
  text: string;
}

/** 그룹의 모든 일감(취소 제외)이 완료됐을 때만 요약을 만든다. 합친 순서는 mergedAt(없으면 finishedAt) 순 */
export function summarizeGroup(appSlug: string, group: string, jobs: GroupJobView[], now = new Date()): GroupReport | null {
  const live = jobs.filter((j) => j.status !== "cancelled");

  if (!live.length || live.some((j) => j.status !== "done")) return null;
  const stamp = (j: GroupJobView) => readParallelInfo(j.parallelInfo)?.mergedAt ?? j.finishedAt?.toISOString() ?? "";
  const sorted = [...live].sort((a, b) => stamp(a).localeCompare(stamp(b)));
  const order = sorted.map((j) => {
    const info = readParallelInfo(j.parallelInfo);

    return { id: j.id, title: j.title, rebases: info?.rebases ?? 0, checks: info?.checks ?? null };
  });
  const rebases = order.reduce((n, o) => n + o.rebases, 0);
  const lines = order.map((o, i) => `${i + 1}. ${o.title} — 다시 맞추기 ${o.rebases}회 · 검사: ${o.checks ?? "통과"}`);

  return {
    appSlug,
    group,
    at: now.toISOString(),
    order,
    rebases,
    text: `병행 그룹 ${group} 완료 (${appSlug}): ${order.length}개 일감을 합쳤어요. 합친 순서와 결과:\n${lines.join("\n")}\n다시 맞추기 합계 ${rebases}회.`,
  };
}

const REPORTS_KEY = "parallelGroupReports";
const MAX_REPORTS = 20;

export async function readGroupReports(): Promise<GroupReport[]> {
  const row = await prisma.factorySetting.findUnique({ where: { key: REPORTS_KEY } });

  if (!row?.value) return [];
  try {
    const list = JSON.parse(row.value) as unknown;

    return Array.isArray(list) ? (list as GroupReport[]).filter((r) => r && typeof r.group === "string" && typeof r.text === "string").slice(0, MAX_REPORTS) : [];
  } catch {
    return [];
  }
}

/**
 * 일감 하나가 완료됐을 때 불러 준다. 그 일감의 그룹이 전부 완료됐으면 그룹 요약을 통제실 설정 한 칸(최근 20개)에 남기고
 * 각 일감 로그에도 한 줄 남긴다. 같은 그룹을 다시 완료하면(재시도) 요약을 새로 쓴다. 던지지 않는다.
 */
export async function recordGroupReportIfDone(jobId: string): Promise<GroupReport | null> {
  try {
    const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { appSlug: true, kind: true, parallelGroup: true } });
    const group = job ? groupOf(job) : null;

    if (!job || !group) return null;
    const jobs = await prisma.factoryJob.findMany({ where: { appSlug: job.appSlug, parallelGroup: group }, select: { id: true, title: true, status: true, finishedAt: true, parallelInfo: true } });
    const report = summarizeGroup(job.appSlug, group, jobs);

    if (!report) return null;
    const rest = (await readGroupReports()).filter((r) => !(r.appSlug === report.appSlug && r.group === report.group));
    const value = JSON.stringify([report, ...rest].slice(0, MAX_REPORTS));

    await prisma.factorySetting.upsert({ where: { key: REPORTS_KEY }, create: { key: REPORTS_KEY, value }, update: { value } });
    await prisma.factoryJobLog.createMany({ data: report.order.map((o) => ({ jobId: o.id, level: "info", message: report.text.slice(0, 1900) })) });

    return report;
  } catch {
    return null;
  }
}
