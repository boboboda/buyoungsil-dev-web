// lib/novel/store.ts
// 소설 공장 DB 작업: 실행기 보고·sync, 통제실(관리자) 조작, 독자 공개 조회, 지표 집계.
// 규칙(검증·전이·예약 시각·알림 조건)은 lib/novel/rules.ts 의 순수 함수를 쓴다.
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import {
  type ApprovalMode,
  BATCH_APPROVE_MAX,
  type EpisodeReport,
  type NotifyKind,
  type NovelReport,
  type SetupReport,
  type WorkStatus,
  assignPublishTimes,
  canApproveSetup,
  humanTransition,
  isPublished,
  isSyncWork,
  nextPublishAt,
  notifyKind,
  shouldAutoApprove,
  syncEpisodes,
  tokenTotal,
  workerTransition,
} from "@/lib/novel/rules";

type Tx = Prisma.TransactionClient;

// 같은 작품의 승인·예약 배정이 동시에 돌지 않게 작품 줄을 잠근다(같은 예약 시각 중복 방지)
const lockWork = (tx: Tx, workId: string) =>
  tx.$queryRaw`SELECT "id" FROM "novel_works" WHERE "id" = ${workId} FOR UPDATE`;

// 이 작품에서 이미 배정된 마지막 예약 시각
async function lastPublishAt(tx: Tx, workId: string): Promise<Date | null> {
  const row = await tx.novelEpisode.findFirst({
    where: { workId, status: "approved", publishAt: { not: null } },
    orderBy: { publishAt: "desc" },
    select: { publishAt: true },
  });

  return row?.publishAt ?? null;
}

async function writeLogs(
  tx: Tx,
  workId: string,
  episodeNumber: number | null,
  logs: NovelReport["logs"],
) {
  if (logs.length)
    await tx.novelLog.createMany({
      data: logs.map((l) => ({
        workId,
        episodeNumber,
        level: l.level,
        message: l.message,
      })),
    });
}

// ───────── 실행기 보고 ─────────
export type ReportOutcome =
  | {
      kind: "ok";
      status: string;
      notify: NotifyKind;
      workTitle: string;
      number?: number;
    }
  | { kind: "not_found" }
  | { kind: "rejected"; code: 400 | 409; reason: string; status?: string };

async function reportSetup(r: SetupReport): Promise<ReportOutcome> {
  return prisma.$transaction(async (tx) => {
    const found = await tx.novelWork.findUnique({
      where: { slug: r.slug },
      select: { id: true, status: true, title: true },
    });
    let work = found;

    if (!found) {
      work = await tx.novelWork.create({
        data: {
          slug: r.slug,
          title: r.title,
          genre: r.genre,
          logline: r.logline,
          setupSummary: r.setupSummary,
        },
        select: { id: true, status: true, title: true },
      });
    } else if (found.status === "setup") {
      // 설정 승인 전에만 설정 내용을 덮어쓴다(승인 뒤에는 바꾸지 않는다)
      work = await tx.novelWork.update({
        where: { id: found.id },
        data: {
          title: r.title,
          genre: r.genre,
          logline: r.logline,
          setupSummary: r.setupSummary,
        },
        select: { id: true, status: true, title: true },
      });
    }
    await writeLogs(tx, work!.id, null, r.logs);

    return {
      kind: "ok",
      status: work!.status,
      notify: null,
      workTitle: work!.title,
    } as const;
  });
}

async function reportEpisode(
  r: EpisodeReport,
  now: Date,
): Promise<ReportOutcome> {
  return prisma.$transaction(async (tx) => {
    const work = await tx.novelWork.findUnique({
      where: { slug: r.slug },
      select: {
        id: true,
        title: true,
        approvalMode: true,
        publishPerDay: true,
      },
    });

    if (!work) return { kind: "not_found" } as const;
    await lockWork(tx, work.id);

    const prev = await tx.novelEpisode.findUnique({
      where: { workId_number: { workId: work.id, number: r.number } },
      select: { status: true },
    });
    const decision = workerTransition(prev?.status ?? null, r.status);

    if (decision.ok === false)
      return {
        kind: "rejected",
        code: decision.code,
        reason: decision.reason,
        status: prev?.status,
      } as const;

    const data: Prisma.NovelEpisodeUncheckedUpdateInput = { status: r.status };

    if (r.title !== undefined) data.title = r.title;
    if (r.body !== undefined) data.body = r.body;
    if (r.summary !== undefined) data.summary = r.summary;
    if (r.attempts !== undefined) data.attempts = r.attempts;
    if (r.checkResult !== undefined)
      data.checkResult =
        r.checkResult === null
          ? Prisma.DbNull
          : (r.checkResult as unknown as Prisma.InputJsonValue);
    if (r.tokens !== undefined)
      data.tokens =
        r.tokens === null
          ? Prisma.DbNull
          : (r.tokens as unknown as Prisma.InputJsonValue);
    // 다시 써서 새로 승인 대기가 되면 사람의 수정 요청 메모는 다 쓴 것
    if (r.status === "pending_approval" && prev?.status !== "pending_approval")
      data.revisionNote = null;

    // auto 모드: 검수를 통과한 승인 대기 화는 서버가 바로 승인하고 예약 시각을 배정한다
    let status: string = r.status;

    if (shouldAutoApprove(work.approvalMode, r.status, r.checkResult)) {
      status = "approved";
      data.status = "approved";
      data.approvedAt = now;
      data.publishAt = nextPublishAt(
        now,
        await lastPublishAt(tx, work.id),
        work.publishPerDay,
      );
    }

    await tx.novelEpisode.upsert({
      where: { workId_number: { workId: work.id, number: r.number } },
      create: {
        ...(data as Prisma.NovelEpisodeUncheckedCreateInput),
        workId: work.id,
        number: r.number,
      },
      update: data,
    });
    await writeLogs(tx, work.id, r.number, r.logs);

    const pendingCount =
      status === "pending_approval"
        ? await tx.novelEpisode.count({
            where: { workId: work.id, status: "pending_approval" },
          })
        : 0;

    return {
      kind: "ok",
      status,
      notify: notifyKind(
        work.approvalMode,
        prev?.status ?? null,
        status,
        pendingCount,
      ),
      workTitle: work.title,
      number: r.number,
    } as const;
  });
}

export function reportNovel(
  r: NovelReport,
  now = new Date(),
): Promise<ReportOutcome> {
  return r.kind === "setup" ? reportSetup(r) : reportEpisode(r, now);
}

// ───────── 실행기 sync ─────────
export async function syncNovels() {
  const works = await prisma.novelWork.findMany({
    where: { status: { notIn: ["dropped", "finished"] } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      slug: true,
      status: true,
      paused: true,
      setupApprovedAt: true,
      approvalMode: true,
      publishPerDay: true,
    },
  });
  const ids = works.filter((w) => isSyncWork(w.status)).map((w) => w.id);
  // 행동이 필요한 화만 읽는다(승인된 화는 작품마다 최근 것 하나만 쓰지만, 번호 비교를 위해 approved 는 번호만)
  const rows = ids.length
    ? await prisma.novelEpisode.findMany({
        where: {
          workId: { in: ids },
          status: { in: ["approved", "revising", "pending_approval", "held"] },
        },
        select: {
          workId: true,
          number: true,
          status: true,
          revisionNote: true,
        },
      })
    : [];

  return {
    works: works
      .filter((w) => isSyncWork(w.status))
      .map((w) => ({
        slug: w.slug,
        status: w.status,
        paused: w.paused,
        setupApproved: !!w.setupApprovedAt,
        approvalMode: w.approvalMode,
        publishPerDay: w.publishPerDay,
        episodes: syncEpisodes(rows.filter((r) => r.workId === w.id)),
      })),
  };
}

// ───────── 통제실 ─────────
export type AdminResult<T = undefined> =
  | { ok: true; value?: T; message?: string }
  | { ok: false; status: number; message: string };
const notFound = (what = "작품"): AdminResult<never> => ({
  ok: false,
  status: 404,
  message: `없는 ${what}이에요.`,
});

export async function listWorksForAdmin(now = new Date()) {
  const works = await prisma.novelWork.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      slug: true,
      title: true,
      genre: true,
      status: true,
      paused: true,
      approvalMode: true,
      publishPerDay: true,
      setupApprovedAt: true,
      updatedAt: true,
      episodes: { select: { number: true, status: true, publishAt: true } },
    },
  });

  return works.map(({ episodes, ...w }) => {
    const counts: Record<string, number> = {};

    for (const e of episodes) counts[e.status] = (counts[e.status] ?? 0) + 1;
    const latest = episodes.reduce<(typeof episodes)[number] | null>(
      (a, e) => (!a || e.number > a.number ? e : a),
      null,
    );

    return {
      ...w,
      written: episodes.length,
      published: episodes.filter((e) => isPublished(e, now)).length,
      counts,
      latest: latest ? { number: latest.number, status: latest.status } : null,
    };
  });
}

export async function getWorkForAdmin(slug: string, now = new Date()) {
  const work = await prisma.novelWork.findUnique({
    where: { slug },
    select: {
      slug: true,
      title: true,
      genre: true,
      logline: true,
      setupSummary: true,
      status: true,
      paused: true,
      approvalMode: true,
      publishPerDay: true,
      setupApprovedAt: true,
      createdAt: true,
      updatedAt: true,
      episodes: {
        orderBy: { number: "asc" },
        select: {
          number: true,
          title: true,
          status: true,
          attempts: true,
          checkResult: true,
          tokens: true,
          revisionNote: true,
          approvedAt: true,
          publishAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!work) return null;

  return {
    ...work,
    episodes: work.episodes.map(({ tokens, checkResult, ...e }) => ({
      ...e,
      published: isPublished(e, now),
      checkPass: (checkResult as { pass?: boolean } | null)?.pass ?? null,
      tokenTotal: tokenTotal(tokens),
    })),
  };
}

export async function getEpisodeForAdmin(
  slug: string,
  number: number,
  now = new Date(),
) {
  const work = await prisma.novelWork.findUnique({
    where: { slug },
    select: { id: true, title: true, approvalMode: true },
  });

  if (!work) return null;
  const ep = await prisma.novelEpisode.findUnique({
    where: { workId_number: { workId: work.id, number } },
  });

  if (!ep) return null;
  const logs = await prisma.novelLog.findMany({
    where: { workId: work.id, episodeNumber: number },
    orderBy: { at: "desc" },
    take: 200,
    select: { level: true, message: true, at: true },
  });
  const pendingCount = await prisma.novelEpisode.count({
    where: { workId: work.id, status: "pending_approval" },
  });
  const { id: _id, workId: _w, ...rest } = ep;

  return {
    work: { slug, title: work.title, approvalMode: work.approvalMode },
    episode: { ...rest, published: isPublished(ep, now) },
    logs: logs.reverse(),
    pendingCount,
  };
}

export async function patchWork(
  slug: string,
  patch: {
    paused?: boolean;
    approvalMode?: ApprovalMode;
    publishPerDay?: number;
    status?: WorkStatus;
  },
): Promise<AdminResult> {
  const work = await prisma.novelWork.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });

  if (!work) return notFound();
  if (patch.status && work.status === "setup")
    return {
      ok: false,
      status: 409,
      message: "설정 승인 전 작품은 [설정 승인]으로 먼저 시작해요.",
    };
  await prisma.novelWork.update({ where: { id: work.id }, data: patch });

  return { ok: true };
}

export async function approveSetup(
  slug: string,
  now = new Date(),
): Promise<AdminResult> {
  const work = await prisma.novelWork.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });

  if (!work) return notFound();
  if (!canApproveSetup(work.status))
    return {
      ok: false,
      status: 409,
      message: "설정 승인 대기인 작품이 아니에요.",
    };
  const r = await prisma.novelWork.updateMany({
    where: { id: work.id, status: "setup" },
    data: { status: "active", setupApprovedAt: now },
  });

  return r.count
    ? { ok: true }
    : { ok: false, status: 409, message: "이미 처리된 작품이에요." };
}

export async function approveEpisode(
  slug: string,
  number: number,
  now = new Date(),
): Promise<AdminResult<{ publishAt: Date }>> {
  return prisma.$transaction(async (tx) => {
    const work = await tx.novelWork.findUnique({
      where: { slug },
      select: { id: true, publishPerDay: true },
    });

    if (!work) return notFound();
    await lockWork(tx, work.id);
    const ep = await tx.novelEpisode.findUnique({
      where: { workId_number: { workId: work.id, number } },
      select: { id: true, status: true, body: true },
    });

    if (!ep) return notFound("화");
    const t = humanTransition(ep.status, "approve", !!ep.body?.trim());

    if (t.ok === false) return { ok: false, status: 409, message: t.reason };
    const publishAt = nextPublishAt(
      now,
      await lastPublishAt(tx, work.id),
      work.publishPerDay,
    );

    await tx.novelEpisode.update({
      where: { id: ep.id },
      data: { status: t.to, approvedAt: now, publishAt, revisionNote: null },
    });

    return { ok: true, value: { publishAt } };
  });
}

export async function reviseEpisode(
  slug: string,
  number: number,
  note: string,
): Promise<AdminResult> {
  return humanNote(slug, number, "revise", note);
}

export async function releaseHold(
  slug: string,
  number: number,
  note: string | null,
): Promise<AdminResult> {
  return humanNote(slug, number, "release_hold", note);
}

async function humanNote(
  slug: string,
  number: number,
  action: "revise" | "release_hold",
  note: string | null,
): Promise<AdminResult> {
  const work = await prisma.novelWork.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!work) return notFound();
  const ep = await prisma.novelEpisode.findUnique({
    where: { workId_number: { workId: work.id, number } },
    select: { id: true, status: true },
  });

  if (!ep) return notFound("화");
  const t = humanTransition(ep.status, action);

  if (t.ok === false) return { ok: false, status: 409, message: t.reason };
  // 상태가 그사이 바뀌지 않았을 때만(같은 버튼을 두 곳에서 눌러도 한 번만)
  const r = await prisma.novelEpisode.updateMany({
    where: { id: ep.id, status: ep.status },
    data: { status: t.to, revisionNote: note },
  });

  return r.count
    ? { ok: true }
    : {
        ok: false,
        status: 409,
        message: "그사이 상태가 바뀌었어요. 새로 고침해 주세요.",
      };
}

/** 대기 화 일괄 승인: 번호 순으로 최대 5화, 본문 있는 것만 */
export async function approvePending(
  slug: string,
  now = new Date(),
): Promise<AdminResult<{ numbers: number[] }>> {
  return prisma.$transaction(async (tx) => {
    const work = await tx.novelWork.findUnique({
      where: { slug },
      select: { id: true, publishPerDay: true },
    });

    if (!work) return notFound();
    await lockWork(tx, work.id);
    const pending = await tx.novelEpisode.findMany({
      where: {
        workId: work.id,
        status: "pending_approval",
        body: { not: null },
      },
      orderBy: { number: "asc" },
      take: BATCH_APPROVE_MAX,
      select: { id: true, number: true, body: true },
    });
    const ready = pending.filter((e) => e.body?.trim());

    if (!ready.length)
      return { ok: false, status: 409, message: "승인할 대기 화가 없어요." };
    const times = assignPublishTimes(
      now,
      await lastPublishAt(tx, work.id),
      work.publishPerDay,
      ready.length,
    );

    for (let i = 0; i < ready.length; i++) {
      await tx.novelEpisode.update({
        where: { id: ready[i].id },
        data: {
          status: "approved",
          approvedAt: now,
          publishAt: times[i],
          revisionNote: null,
        },
      });
    }

    return { ok: true, value: { numbers: ready.map((e) => e.number) } };
  });
}

// ───────── 지표(최근 30일) ─────────
// 공개 페이지는 기존 분석 수집(/api/analytics/collect)으로 feature_use 이벤트를 보낸다(수집기가 허용하는 이름).
// params: { feature: chapter_view | chapter_complete | next_click, work: slug, ep: 번호 }
export const NOVEL_ANALYTICS_APP_ID = () =>
  process.env.NOVEL_ANALYTICS_APP_ID || "novel";
export const NOVEL_FEATURES = [
  "chapter_view",
  "chapter_complete",
  "next_click",
] as const;

export async function workMetrics(slug: string): Promise<{
  available: boolean;
  rows: { ep: number; view: number; complete: number; next: number }[];
}> {
  const app = await prisma.analyticsApp.findUnique({
    where: { appId: NOVEL_ANALYTICS_APP_ID() },
    select: { id: true },
  });

  if (!app) return { available: false, rows: [] };
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  // 읽기 전용 집계 하나. params 가 Json 이라 ->> 로 꺼낸다
  const rows = await prisma.$queryRaw<
    { feature: string; ep: string; n: bigint }[]
  >`
    SELECT "params"->>'feature' AS feature, "params"->>'ep' AS ep, COUNT(*)::bigint AS n
    FROM "analytics_events"
    WHERE "appId" = ${app.id} AND "name" = 'feature_use' AND "occurredAt" >= ${since}
      AND "params"->>'work' = ${slug}
      AND "params"->>'feature' IN ('chapter_view', 'chapter_complete', 'next_click')
    GROUP BY 1, 2`;
  const byEp = new Map<
    number,
    { ep: number; view: number; complete: number; next: number }
  >();

  for (const r of rows) {
    const ep = Number(r.ep);

    if (!Number.isInteger(ep) || ep < 1) continue;
    const row = byEp.get(ep) ?? { ep, view: 0, complete: 0, next: 0 };
    const n = Number(r.n);

    if (r.feature === "chapter_view") row.view += n;
    else if (r.feature === "chapter_complete") row.complete += n;
    else if (r.feature === "next_click") row.next += n;
    byEp.set(ep, row);
  }

  return {
    available: true,
    rows: [...byEp.values()].sort((a, b) => a.ep - b.ep),
  };
}

// ───────── 독자 공개 ─────────
// 공개 읽기는 lib/novel/public.ts 로 옮겼다. 기존 import 가 깨지지 않게 다시 내보낸다.
export { publicEpisode, publicWork, publicWorks } from "@/lib/novel/public";
