// lib/factory/stageRetry.ts
// 실패 단계부터 다시 (5-2). 지금 [다시 시도]는 일감을 처음부터 다시 한다.
//   실패한 단계(failStage: 검사·스크린샷·합치기·업로드 …)가 기록돼 있으면 [실패 단계부터 다시]를 함께 준다.
//   누르면 일감을 승인됨으로 되돌리고 resumeFrom(그 단계)·resumeNote(실패 이유, 마스킹됨)를 남긴다.
//   감독 프로그램은 /next 의 stageResume 을 보고, 이 PC 에 같은 세션·작업 폴더가 남아 있으면 같은 세션(--resume)에
//   "검사에서 실패했다, 이 오류를 고쳐라" 같은 짧은 지시만 넣어 이어서 하게 한다. 없으면 처음부터 다시 하는 기존 재실행으로 대신한다.
//   출시 일감(kind=release)은 이미 단계 재시도가 따로 있어서(lib/factory/release.ts) 여기서 다루지 않는다.
import { maskSecrets } from "@/lib/factory/mask";

export const STAGE_RETRY_KINDS: readonly string[] = ["new", "revision"];
// 이어서 해도 소용없는 단계: 업데이트 뒤 이어받기가 이미 실패한 것(세션을 못 찾음)
const NO_RESUME_STAGES: readonly string[] = ["resume"];

export const STAGE_LABELS: Record<string, string> = {
  scaffold: "만들기",
  build: "빌드",
  check: "검사",
  checks: "검사",
  verify: "검사",
  test: "시험",
  screenshots: "스크린샷",
  merge: "합치기",
  upload: "업로드",
  homepage: "홈페이지 반영",
  stuck: "막힘",
};

export const stageLabel = (stage: string | null | undefined): string => (stage ? (STAGE_LABELS[stage] ?? stage) : "알 수 없음");

export interface StageRetryJob {
  kind: string;
  status: string;
  failStage?: string | null;
  failReason?: string | null;
}

/** [실패 단계부터 다시]를 줄 수 있나. 못 주면 이유. 작업 폴더·세션이 남아 있는지는 PC 가 알아서 판단하고, 없으면 기존 재실행으로 대신한다 */
export function stageRetryCheck(job: StageRetryJob): { ok: true; stage: string } | { ok: false; reason: string } {
  if (job.status !== "failed") return { ok: false, reason: `지금 상태(${job.status})에서는 쓸 수 없어요. 실패한 지시만 돼요.` };
  if (!STAGE_RETRY_KINDS.includes(job.kind)) return { ok: false, reason: "새 앱·수정 일감만 단계부터 다시 할 수 있어요(출시 일감은 출시 화면의 재시도)." };
  const stage = (job.failStage ?? "").trim();

  if (!stage) return { ok: false, reason: "실패한 단계가 기록되지 않았어요. [다시 시도]로 처음부터 하세요." };
  if (NO_RESUME_STAGES.includes(stage)) return { ok: false, reason: "이어받기 자체가 실패한 일감이라 [다시 시도]로 처음부터 하세요." };

  return { ok: true, stage };
}

/** 단계 재시도 때 일감에 쓸 값(승인됨으로 되돌림). 실패 이유는 마스킹하고 500자로 자른다 */
export function stageRetryData(job: StageRetryJob, now: Date) {
  const c = stageRetryCheck(job);

  if (!c.ok) return null;

  return {
    status: "approved",
    approvedAt: now,
    attempts: 0,
    failReason: null,
    failStage: null,
    resumeFrom: c.stage,
    resumeNote: maskSecrets(String(job.failReason ?? "")).slice(0, 500) || null,
    phase: null,
    workerId: null,
    leaseUntil: null,
    startedAt: null,
    finishedAt: null,
  };
}

interface StageDb {
  factoryJob: {
    findMany(args: { where: Record<string, unknown>; select: Record<string, boolean> }): Promise<{ id: string; resumeFrom: string | null; resumeNote: string | null }[]>;
  };
}

/** /next 에 붙일 것: 단계부터 다시 하라고 승인된 새 앱·수정 일감의 { from, note, label }. 없으면 빈 Map */
export async function stageResumeForJobs(db: StageDb, jobs: { id: string; kind: string }[]): Promise<Map<string, { from: string; note: string | null; label: string }>> {
  const ids = jobs.filter((j) => STAGE_RETRY_KINDS.includes(j.kind)).map((j) => j.id);
  const out = new Map<string, { from: string; note: string | null; label: string }>();

  if (!ids.length) return out;
  const rows = await db.factoryJob.findMany({ where: { id: { in: ids }, resumeFrom: { not: null } }, select: { id: true, resumeFrom: true, resumeNote: true } });

  for (const r of rows) if (r.resumeFrom) out.set(r.id, { from: r.resumeFrom, note: r.resumeNote, label: stageLabel(r.resumeFrom) });

  return out;
}
