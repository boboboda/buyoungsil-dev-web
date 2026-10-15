// lib/novel/public.ts
// 독자 공개 조회(읽기 전용). 공개된 화의 본문(body)만 읽고 검수 대기 사본 칸은 읽지 않는다.
// 블로그 쪽 /novel 화면은 이 파일만 쓴다(store.ts 의 실행기·관리자 작업과 분리).
import prisma from "@/lib/prisma";
import { isPublicWork, isPublished } from "@/lib/novel/rules";

export async function publicWorks(now = new Date()) {
  const works = await prisma.novelWork.findMany({
    where: { status: { in: ["active", "finished"] } },
    orderBy: { updatedAt: "desc" },
    select: {
      slug: true,
      title: true,
      genre: true,
      logline: true,
      status: true,
      episodes: {
        where: { status: "approved", publishAt: { lte: now } },
        select: { number: true, publishAt: true },
      },
    },
  });

  return works
    .filter((w) => isPublicWork(w.status))
    .map(({ episodes, ...w }) => ({
      ...w,
      published: episodes.length,
      lastPublishedAt: episodes.reduce<Date | null>(
        (a, e) => (e.publishAt && (!a || e.publishAt > a) ? e.publishAt : a),
        null,
      ),
    }));
}

export async function publicWork(slug: string, now = new Date()) {
  const work = await prisma.novelWork.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      genre: true,
      logline: true,
      status: true,
      episodes: {
        where: { status: "approved", publishAt: { lte: now } },
        orderBy: { number: "asc" },
        select: { number: true, title: true, publishAt: true, status: true },
      },
    },
  });

  if (!work || !isPublicWork(work.status)) return null;
  const { id: _id, ...rest } = work;

  return {
    ...rest,
    episodes: work.episodes
      .filter((e) => isPublished(e, now))
      .map(({ status: _s, ...e }) => e),
  };
}

export async function publicEpisode(
  slug: string,
  number: number,
  now = new Date(),
) {
  const work = await prisma.novelWork.findUnique({
    where: { slug },
    select: { id: true, slug: true, title: true, status: true },
  });

  if (!work || !isPublicWork(work.status)) return null;
  const ep = await prisma.novelEpisode.findUnique({
    where: { workId_number: { workId: work.id, number } },
    select: {
      number: true,
      title: true,
      body: true,
      summary: true,
      status: true,
      publishAt: true,
    },
  });

  if (!ep || !isPublished(ep, now) || !ep.body) return null;
  const [prev, next] = await Promise.all([
    prisma.novelEpisode.findFirst({
      where: {
        workId: work.id,
        status: "approved",
        publishAt: { lte: now },
        number: { lt: number },
      },
      orderBy: { number: "desc" },
      select: { number: true },
    }),
    prisma.novelEpisode.findFirst({
      where: {
        workId: work.id,
        status: "approved",
        publishAt: { lte: now },
        number: { gt: number },
      },
      orderBy: { number: "asc" },
      select: { number: true },
    }),
  ]);

  return {
    work: { slug: work.slug, title: work.title },
    episode: {
      number: ep.number,
      title: ep.title,
      body: ep.body,
      summary: ep.summary,
      publishAt: ep.publishAt,
    },
    prev: prev?.number ?? null,
    next: next?.number ?? null,
  };
}
