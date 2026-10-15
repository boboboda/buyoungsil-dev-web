// lib/novel/jobStore.ts
// 소설 실행 일감(7-1) DB 작업: 관리자·채팅의 작업 생성/승인/취소·메모, 감독 프로그램(워커)의 가져오기/진행/완료/메모 반영/재시작 정리,
// 원고·검수 사본 저장, 화면·채팅용 화 조회. 규칙은 lib/novel/jobRules.ts.
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { getSettingValue, setSettingValue } from "@/lib/factory/settings";
import { notifyText } from "@/lib/factory/telegram";
import {
  type CompleteReport,
  DEFAULT_DAILY_COST_CAP_USD,
  JOB_MODE_LABELS,
  JOB_TIMEOUT_MIN,
  type JobMode,
  MAX_OPEN_NOTES,
  STALE_SILENCE_MIN,
  VERDICT_LABELS,
  isOpenJob,
  jobAction,
  lineCount,
  memoLine,
  numberedLines,
  overCap,
  parseReviewItems,
  paramsForMode,
  validEpisode,
} from "@/lib/novel/jobRules";

export type Result<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; status: number; message: string; extra?: Record<string, unknown> };
const fail = (status: number, message: string, extra?: Record<string, unknown>): Result<never> => ({ ok: false, status, message, extra });

const CAP_KEY = "novel.dailyCostCapUsd";
const AUTO_CHECK_KEY = "novel.autoApproveCheck";
const DAY_MS = 24 * 60 * 60 * 1000;
export const NOVEL_JOBS_PATH = "/admin/factory?tab=novels";

// ───────── 설정 ─────────
export async function getCapUsd(): Promise<{ value: number; isDefault: boolean }> {
  const raw = await getSettingValue(CAP_KEY).catch(() => null);
  const n = raw === null ? NaN : Number(raw);

  return Number.isFinite(n) && n >= 0 ? { value: n, isDefault: false } : { value: DEFAULT_DAILY_COST_CAP_USD, isDefault: true };
}
export const setCapUsd = (n: number) => setSettingValue(CAP_KEY, String(n));
export const getAutoApproveCheck = async () => (await getSettingValue(AUTO_CHECK_KEY).catch(() => null)) === "1";
export const setAutoApproveCheck = (on: boolean) => setSettingValue(AUTO_CHECK_KEY, on ? "1" : null);

/** 최근 24시간에 끝났거나 도는 작업의 비용 합계 */
export async function spentLastDay(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - DAY_MS);
  const r = await prisma.novelJob.aggregate({
    _sum: { costUsd: true },
    where: { OR: [{ finishedAt: { gte: since } }, { status: "running" }] },
  });

  return r._sum.costUsd ?? 0;
}

export async function costStatus(now = new Date()) {
  const [cap, spent] = await Promise.all([getCapUsd(), spentLastDay(now)]);

  return { capUsd: cap.value, capIsDefault: cap.isDefault, spentUsd: Math.round(spent * 10000) / 10000, over: overCap(spent, cap.value) };
}

// ───────── 작업 보기 ─────────
const jobSelect = {
  id: true, workSlug: true, episode: true, kind: true, params: true, mode: true, status: true, requestedBy: true, overrideCap: true, autoApproved: true,
  createdAt: true, approvedAt: true, startedAt: true, finishedAt: true, verdict: true, mustCount: true, recCount: true, charCount: true, costUsd: true, summary: true,
} as const;

export interface JobView {
  id: string; workSlug: string; episode: number; kind: string; mode: string; status: string; requestedBy: string; autoApproved: boolean; overrideCap: boolean;
  createdAt: Date; approvedAt: Date | null; startedAt: Date | null; finishedAt: Date | null;
  verdict: string | null; mustCount: number | null; recCount: number | null; charCount: number | null; costUsd: number; summary: string | null;
  params: unknown; logTail?: string | null;
}

export async function listJobs(workSlug: string, episode: number, take = 10): Promise<JobView[]> {
  return prisma.novelJob.findMany({ where: { workSlug, episode }, orderBy: { createdAt: "desc" }, take, select: jobSelect });
}

export async function getJob(id: string): Promise<JobView | null> {
  return prisma.novelJob.findUnique({ where: { id }, select: { ...jobSelect, logTail: true } });
}

/** 통제실 할 일·현황용: 승인 대기·진행 중 작업 수 */
export async function openJobCounts() {
  const rows = await prisma.novelJob.groupBy({ by: ["status"], where: { status: { in: ["pending_approval", "approved", "running"] } }, _count: true });

  return Object.fromEntries(rows.map((r) => [r.status, r._count]));
}

// ───────── 작업 만들기·승인·취소 ─────────
export async function createJob(input: { workSlug: string; episode: number; mode: JobMode; requestedBy: "web" | "chat" }): Promise<Result<JobView>> {
  if (!validEpisode(input.episode)) return fail(400, "화 번호가 올바르지 않아요.");
  const work = await prisma.novelWork.findUnique({ where: { slug: input.workSlug }, select: { title: true } });

  if (!work) return fail(404, "없는 작품이에요.");
  const dup = await prisma.novelJob.findFirst({
    where: { workSlug: input.workSlug, episode: input.episode, mode: input.mode, status: { in: ["pending_approval", "approved", "running"] } },
    select: { id: true, status: true },
  });

  if (dup) return fail(409, `같은 작업(${JOB_MODE_LABELS[input.mode]})이 이미 ${dup.status === "running" ? "실행 중" : "대기 중"}이에요.`, { id: dup.id });
  if (input.mode !== "fresh") {
    const ep = await prisma.novelEpisode.findFirst({ where: { work: { slug: input.workSlug }, number: input.episode }, select: { draftBody: true, body: true } });

    if (!ep || !(ep.draftBody || ep.body)) return fail(409, "아직 원고가 올라오지 않은 화예요. [처음부터 새로 쓰기]를 쓰거나 원고가 올라올 때까지 기다려 주세요.");
  }
  const now = new Date();
  const [auto, cost] = await Promise.all([getAutoApproveCheck(), costStatus(now)]);
  // 자동 승인(5-3): 켜져 있고 [검수만](약 $0.4)이며 하루 한도 안일 때만. 그 밖에는 사람이 [승인]
  const autoOk = auto && input.mode === "check" && !cost.over;
  const job = await prisma.novelJob.create({
    data: {
      workSlug: input.workSlug,
      episode: input.episode,
      kind: "cycle",
      params: paramsForMode(input.mode) as unknown as Prisma.InputJsonValue,
      mode: input.mode,
      status: autoOk ? "approved" : "pending_approval",
      requestedBy: input.requestedBy,
      autoApproved: autoOk,
      approvedAt: autoOk ? now : null,
    },
    select: jobSelect,
  });

  if (!autoOk)
    void notifyText(`📖 소설 작업 승인 대기: 「${work.title}」 ${input.episode}화 ${JOB_MODE_LABELS[input.mode]}${cost.over ? " — 오늘 비용 한도를 넘었어요" : ""}`, NOVEL_JOBS_PATH);

  return { ok: true, value: job, message: autoOk ? "자동 승인 규칙으로 바로 대기열에 넣었어요." : cost.over ? `오늘 비용이 한도($${cost.capUsd})를 넘어 승인 대기로 뒀어요.` : "승인 대기로 뒀어요." };
}

export async function approveJob(id: string, force = false): Promise<Result<JobView>> {
  const job = await prisma.novelJob.findUnique({ where: { id }, select: { status: true } });

  if (!job) return fail(404, "없는 작업이에요.");
  const t = jobAction(job.status, "approve");

  if (t.ok === false) return fail(409, t.reason);
  const cost = await costStatus();

  if (cost.over && !force)
    return fail(409, `오늘 쓴 비용 $${cost.spentUsd.toFixed(2)}이(가) 하루 한도 $${cost.capUsd.toFixed(2)}에 닿았어요. 그래도 시작하려면 한도 확인 뒤 승인해 주세요.`, { overCap: true, ...cost });
  const r = await prisma.novelJob.updateMany({ where: { id, status: "pending_approval" }, data: { status: "approved", approvedAt: new Date(), overrideCap: cost.over && force } });

  if (r.count === 0) return fail(409, "이미 다른 곳에서 처리됐어요.");

  return { ok: true, value: (await getJob(id))!, message: "승인했어요. 작업 PC가 15초 안에 가져가요." };
}

export async function cancelJob(id: string): Promise<Result<JobView>> {
  const job = await prisma.novelJob.findUnique({ where: { id }, select: { status: true } });

  if (!job) return fail(404, "없는 작업이에요.");
  const t = jobAction(job.status, "cancel");

  if (t.ok === false) return fail(409, t.reason);
  const r = await prisma.novelJob.updateMany({
    where: { id, status: { in: ["pending_approval", "approved", "running"] } },
    data: { status: "cancelled", finishedAt: new Date(), summary: job.status === "running" ? "사람이 취소했어요(실행 중이던 작업은 작업 PC가 곧 멈춰요)." : "사람이 취소했어요." },
  });

  if (r.count === 0) return fail(409, "이미 끝난 작업이에요.");

  return { ok: true, value: (await getJob(id))!, message: job.status === "running" ? "취소했어요. 작업 PC가 곧 멈춰요." : "취소했어요." };
}

// ───────── 메모 ─────────
export async function addNote(input: { workSlug: string; episode: number; line: number | null; kind: string; text: string; createdBy: string }): Promise<Result<{ id: string }>> {
  if (!validEpisode(input.episode)) return fail(400, "화 번호가 올바르지 않아요.");
  const ep = await prisma.novelEpisode.findFirst({ where: { work: { slug: input.workSlug }, number: input.episode }, select: { draftBody: true, body: true } });

  if (!ep) return fail(404, "없는 화예요.");
  const body = ep.draftBody ?? ep.body;

  if (input.line !== null && body && input.line > lineCount(body)) return fail(400, `이 화는 ${lineCount(body)}줄까지예요.`);
  const open = await prisma.novelNote.count({ where: { workSlug: input.workSlug, episode: input.episode, status: "open" } });

  if (open >= MAX_OPEN_NOTES) return fail(409, `열린 메모가 ${MAX_OPEN_NOTES}개예요. 먼저 반영하거나 지워 주세요.`);
  const n = await prisma.novelNote.create({ data: input, select: { id: true } });

  return { ok: true, value: n };
}

export async function deleteNote(id: string): Promise<Result> {
  const r = await prisma.novelNote.deleteMany({ where: { id, status: "open" } });

  return r.count ? { ok: true, value: undefined } : fail(404, "없거나 이미 반영된 메모예요.");
}

export const openNotes = (workSlug: string, episode: number) =>
  prisma.novelNote.findMany({ where: { workSlug, episode, status: "open" }, orderBy: [{ line: "asc" }, { createdAt: "asc" }], select: { id: true, line: true, kind: true, text: true, createdBy: true, createdAt: true } });

// ───────── 화 보기(웹·채팅 공용) ─────────
export async function episodeDraftView(slug: string, episode: number, range?: { from?: number; to?: number }) {
  const work = await prisma.novelWork.findUnique({ where: { slug }, select: { title: true, status: true } });

  if (!work) return null;
  const ep = await prisma.novelEpisode.findFirst({
    where: { work: { slug }, number: episode },
    select: { number: true, title: true, status: true, body: true, draftBody: true, draftReview: true, draftVerdict: true, draftMust: true, draftRec: true, draftChars: true, draftSyncedAt: true, publishAt: true, updatedAt: true },
  });

  if (!ep) return null;
  const text = ep.draftBody ?? ep.body ?? "";
  const [notes, jobs, cost, epCost] = await Promise.all([
    openNotes(slug, episode),
    listJobs(slug, episode, 8),
    costStatus(),
    prisma.novelJob.aggregate({ _sum: { costUsd: true }, where: { workSlug: slug, episode } }),
  ]);
  const total = text ? lineCount(text) : 0;

  return {
    work: { slug, title: work.title },
    episode: {
      number: ep.number,
      title: ep.title,
      status: ep.status,
      published: ep.status === "approved" && !!ep.publishAt && ep.publishAt.getTime() <= Date.now(),
      source: ep.draftBody ? "cycle" : ep.body ? "published-body" : "none",
      syncedAt: ep.draftSyncedAt,
      chars: ep.draftChars,
    },
    totalLines: total,
    lines: text ? numberedLines(text, range?.from, range?.to) : [],
    review: ep.draftReview
      ? { verdict: ep.draftVerdict, verdictLabel: ep.draftVerdict ? VERDICT_LABELS[ep.draftVerdict] ?? ep.draftVerdict : null, must: ep.draftMust, rec: ep.draftRec, items: parseReviewItems(ep.draftReview) }
      : null,
    notes,
    jobs,
    cost: { episodeTotalUsd: Math.round((epCost._sum.costUsd ?? 0) * 10000) / 10000, ...cost },
  };
}

export async function listNovelsForChat() {
  const works = await prisma.novelWork.findMany({
    orderBy: { updatedAt: "desc" },
    select: { slug: true, title: true, status: true, episodes: { orderBy: { number: "asc" }, select: { number: true, title: true, status: true, draftVerdict: true, draftMust: true, draftRec: true, draftChars: true, publishAt: true, draftBody: true, body: true } } },
  });
  const notes = await prisma.novelNote.groupBy({ by: ["workSlug", "episode"], where: { status: "open" }, _count: true });
  const open = await prisma.novelJob.findMany({ where: { status: { in: ["pending_approval", "approved", "running"] } }, select: { workSlug: true, episode: true, mode: true, status: true } });

  return works.map((w) => ({
    slug: w.slug,
    title: w.title,
    status: w.status,
    episodes: w.episodes.map((e) => ({
      number: e.number,
      title: e.title,
      status: e.status,
      published: e.status === "approved" && !!e.publishAt && e.publishAt.getTime() <= Date.now(),
      hasText: !!(e.draftBody || e.body),
      verdict: e.draftVerdict,
      must: e.draftMust,
      rec: e.draftRec,
      chars: e.draftChars,
      openNotes: notes.find((n) => n.workSlug === w.slug && n.episode === e.number)?._count ?? 0,
      openJobs: open.filter((j) => j.workSlug === w.slug && j.episode === e.number).map((j) => ({ mode: j.mode, status: j.status })),
    })),
  }));
}

// ───────── 원고·검수 사본 ─────────
export async function saveDraft(input: {
  slug: string;
  episode: number;
  chapter?: string | null;
  review?: string | null;
  verdict?: string | null;
  must?: number | null;
  rec?: number | null;
  chars?: number | null;
  title?: string | null;
}): Promise<Result<{ created: boolean; changed: boolean }>> {
  if (!validEpisode(input.episode)) return fail(400, "화 번호가 올바르지 않아요.");
  const work =
    (await prisma.novelWork.findUnique({ where: { slug: input.slug }, select: { id: true } })) ??
    // 작업 PC 폴더에만 있던 작품: 설정 승인 전(setup)·일시 정지로 만들어 공개·기존 실행기에 영향이 없게 한다
    (await prisma.novelWork.create({ data: { slug: input.slug, title: input.slug, status: "setup", paused: true }, select: { id: true } }).catch(() => prisma.novelWork.findUnique({ where: { slug: input.slug }, select: { id: true } })));

  if (!work) return fail(500, "작품을 만들지 못했어요.");
  const prev = await prisma.novelEpisode.findUnique({ where: { workId_number: { workId: work.id, number: input.episode } }, select: { draftBody: true, draftReview: true, title: true } });
  const data: Prisma.NovelEpisodeUncheckedUpdateInput = { draftSyncedAt: new Date() };

  if (input.chapter != null) data.draftBody = input.chapter;
  if (input.review != null) {
    data.draftReview = input.review;
    data.draftVerdict = input.verdict ?? null;
    data.draftMust = input.must ?? null;
    data.draftRec = input.rec ?? null;
  }
  if (input.chars != null) data.draftChars = input.chars;
  if (input.title && !prev?.title) data.title = input.title.slice(0, 100);
  const changed = !prev || (input.chapter != null && input.chapter !== prev.draftBody) || (input.review != null && input.review !== prev.draftReview);

  await prisma.novelEpisode.upsert({
    where: { workId_number: { workId: work.id, number: input.episode } },
    create: { ...(data as Prisma.NovelEpisodeUncheckedCreateInput), workId: work.id, number: input.episode, status: "planned" },
    update: data,
  });

  return { ok: true, value: { created: !prev, changed } };
}

// ───────── 감독 프로그램(워커) ─────────

/** 오래 소식이 없거나 시간 초과인 running 작업을 failed 로(감독 프로그램이 죽었거나 끊긴 경우) */
export async function sweepStale(now = new Date()): Promise<number> {
  const timeout = new Date(now.getTime() - (JOB_TIMEOUT_MIN + 5) * 60_000);
  const silent = new Date(now.getTime() - STALE_SILENCE_MIN * 60_000);
  const r = await prisma.novelJob.updateMany({
    where: { status: "running", OR: [{ startedAt: { lt: timeout } }, { updatedAt: { lt: silent } }] },
    data: { status: "failed", finishedAt: now, summary: "작업 PC 소식이 끊기거나 시간이 지나 서버가 실패로 정리했어요." },
  });

  return r.count;
}

export interface NextJob {
  id: string; workSlug: string; episode: number; mode: string; params: unknown; notes: { id: string; line: number | null; kind: string; text: string; memoLine: string }[]; timeoutMin: number;
}

/** 승인된 다음 작업을 원자적으로 running 으로 표시해 돌려준다. 같은 작품에 이미 도는 작업이 있으면 건너뛴다. 비용 한도를 넘었으면(사람이 한도 확인 승인한 것 제외) 승인 대기로 되돌린다 */
export async function claimNextJob(now = new Date()): Promise<NextJob | null> {
  await sweepStale(now);
  const cost = await costStatus(now);

  if (cost.over) {
    const back = await prisma.novelJob.updateMany({ where: { status: "approved", overrideCap: false }, data: { status: "pending_approval", approvedAt: null, autoApproved: false } });

    if (back.count) void notifyText(`📖 소설 작업 ${back.count}개를 하루 비용 한도($${cost.capUsd}) 때문에 승인 대기로 되돌렸어요.`, NOVEL_JOBS_PATH);
  }
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "novel_jobs" SET "status" = 'running', "startedAt" = ${now}, "updatedAt" = ${now}
    WHERE "id" = (
      SELECT j."id" FROM "novel_jobs" j
      WHERE j."status" = 'approved'
        AND NOT EXISTS (SELECT 1 FROM "novel_jobs" r WHERE r."status" = 'running' AND r."workSlug" = j."workSlug")
      ORDER BY j."approvedAt" ASC NULLS LAST, j."createdAt" ASC
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;

  if (!rows.length) return null;
  const job = await prisma.novelJob.findUnique({ where: { id: rows[0].id }, select: { id: true, workSlug: true, episode: true, mode: true, params: true } });

  if (!job) return null;
  const notes = await openNotes(job.workSlug, job.episode);

  return { ...job, notes: notes.map((n) => ({ id: n.id, line: n.line, kind: n.kind, text: n.text, memoLine: memoLine(n) })), timeoutMin: JOB_TIMEOUT_MIN };
}

/** 진행 로그. 취소됐으면 cancel:true 로 알려 감독 프로그램이 멈추게 한다 */
export async function reportProgress(id: string, logTail: string): Promise<{ found: boolean; cancel: boolean }> {
  const r = await prisma.novelJob.updateMany({ where: { id, status: "running" }, data: { logTail } });

  if (r.count) return { found: true, cancel: false };
  const job = await prisma.novelJob.findUnique({ where: { id }, select: { status: true } });

  return { found: !!job, cancel: !job || job.status !== "running" };
}

export async function completeJob(id: string, rep: CompleteReport): Promise<Result<{ status: string }>> {
  const job = await prisma.novelJob.findUnique({ where: { id }, select: { status: true, workSlug: true, episode: true, mode: true } });

  if (!job) return fail(404, "없는 작업이에요.");
  // 취소된 작업의 뒤늦은 완료 보고: 원고·검수는 올리되 상태는 취소로 둔다(비용은 기록)
  const status = job.status === "cancelled" ? "cancelled" : rep.ok ? "done" : "failed";

  if (job.status !== "running" && job.status !== "cancelled") return fail(409, "실행 중인 작업이 아니에요.");
  if (rep.chapter != null || rep.review != null)
    await saveDraft({ slug: job.workSlug, episode: job.episode, chapter: rep.chapter, review: rep.review, verdict: rep.verdict, must: rep.mustCount, rec: rep.recCount, chars: rep.charCount });
  if (rep.appliedNoteIds.length)
    await prisma.novelNote.updateMany({ where: { id: { in: rep.appliedNoteIds }, workSlug: job.workSlug, episode: job.episode, status: "open" }, data: { status: "applied" } });
  await prisma.novelJob.update({
    where: { id },
    data: { status, finishedAt: new Date(), verdict: rep.verdict, mustCount: rep.mustCount, recCount: rep.recCount, charCount: rep.charCount, costUsd: rep.costUsd, summary: rep.summary || null, logTail: rep.logTail || null },
  });
  const work = await prisma.novelWork.findUnique({ where: { slug: job.workSlug }, select: { title: true } });
  const label = `「${work?.title ?? job.workSlug}」 ${job.episode}화 ${JOB_MODE_LABELS[job.mode as JobMode] ?? job.mode}`;

  if (status === "done") void notifyText(`📖 소설 작업 완료: ${label} — ${rep.verdict ? VERDICT_LABELS[rep.verdict] : "판정 없음"}${rep.mustCount != null ? `, 필수 ${rep.mustCount}건` : ""}, $${rep.costUsd.toFixed(2)}`, NOVEL_JOBS_PATH);
  else if (status === "failed") void notifyText(`⚠️ 소설 작업 실패: ${label} — ${(rep.summary || "원인은 통제실 작품 탭의 로그를 보세요").slice(0, 200)}`, NOVEL_JOBS_PATH);

  return { ok: true, value: { status } };
}

/** 감독 프로그램 재시작: 이 PC 에서 running 이던 작업은 이어 갈 수 없으니 failed 로 정리 */
export async function recoverRunning(now = new Date()): Promise<number> {
  const r = await prisma.novelJob.updateMany({
    where: { status: "running" },
    data: { status: "failed", finishedAt: now, summary: "감독 프로그램이 다시 시작돼 중단됐어요. 필요하면 다시 요청해 주세요." },
  });

  if (r.count) void notifyText(`⚠️ 감독 프로그램 재시작으로 소설 작업 ${r.count}개가 중단(실패)됐어요.`, NOVEL_JOBS_PATH);

  return r.count;
}

export async function markNotesApplied(slug: string, episode: number, ids: string[]): Promise<number> {
  if (!ids.length) return 0;

  return (await prisma.novelNote.updateMany({ where: { id: { in: ids.slice(0, MAX_OPEN_NOTES) }, workSlug: slug, episode, status: "open" }, data: { status: "applied" } })).count;
}

export { isOpenJob };
