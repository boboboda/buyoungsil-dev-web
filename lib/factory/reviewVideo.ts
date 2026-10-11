// lib/factory/reviewVideo.ts
// 출시 검토용 홍보 영상 임시 저장. 감독 프로그램이 8MB 이하 조각으로 올리고(워커 토큰), 통제실(관리자만)이 재생한다.
// 영상은 공개 업로드 서버가 아니라 DB 에 잠깐 둔다(서버 컨테이너에 영구 디스크가 없어서). 검토 결정(진행·다시 만들기·취소) 뒤
// 또는 만든 지 7일이 지나면 지운다. 크기 상한 50MB(넘으면 감독 프로그램이 줄이거나 'PC 에서 직접 확인'으로 표시).
import prisma from "@/lib/prisma";

export const REVIEW_VIDEO_MAX = 50 * 1024 * 1024;
export const REVIEW_VIDEO_CHUNK = 8 * 1024 * 1024;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

type Res = { ok: boolean; status: number; message: string };

/** 조각 하나 받기. 첫 조각(idx 0)이 오면 새로 시작한다. 실행 중인 검토 필요 출시 일감만 */
export async function receiveVideoChunk(jobId: string, idx: number, count: number, size: number, data: Uint8Array): Promise<Res> {
  const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { appSlug: true, kind: true, status: true, reviewRequired: true } });

  if (!job || job.kind !== "release") return { ok: false, status: 404, message: "없는 출시 일감이에요." };
  if (job.status !== "running") return { ok: false, status: 409, message: `지시가 실행 중이 아닙니다(${job.status}).` };
  if (!job.reviewRequired) return { ok: false, status: 400, message: "검토 단계가 있는 일감만 검토 영상을 올릴 수 있어요." };
  if (!Number.isInteger(size) || size <= 0 || size > REVIEW_VIDEO_MAX) return { ok: false, status: 413, message: "영상은 50MB 이하여야 해요." };
  if (!Number.isInteger(count) || count !== Math.ceil(size / REVIEW_VIDEO_CHUNK)) return { ok: false, status: 400, message: "조각 수가 맞지 않아요." };
  if (!Number.isInteger(idx) || idx < 0 || idx >= count) return { ok: false, status: 400, message: "조각 번호가 올바르지 않아요." };
  const expect = idx === count - 1 ? size - idx * REVIEW_VIDEO_CHUNK : REVIEW_VIDEO_CHUNK;

  if (data.length !== expect) return { ok: false, status: 400, message: `조각 크기가 맞지 않아요(${data.length}/${expect}).` };
  if (idx === 0) {
    await prisma.factoryReviewVideo.deleteMany({ where: { jobId } });
    await prisma.factoryReviewVideo.create({ data: { jobId, appSlug: job.appSlug, size, chunkCount: count, expiresAt: new Date(Date.now() + KEEP_MS) } });
  }
  const v = await prisma.factoryReviewVideo.findUnique({ where: { jobId } });

  if (!v || v.size !== size || v.chunkCount !== count) return { ok: false, status: 409, message: "첫 조각부터 다시 보내 주세요." };
  await prisma.factoryReviewVideoChunk.upsert({
    where: { jobId_idx: { jobId, idx } },
    create: { jobId, idx, data: new Uint8Array(data) },
    update: { data: new Uint8Array(data) },
  });
  const received = await prisma.factoryReviewVideoChunk.count({ where: { jobId } });

  await prisma.factoryReviewVideo.update({ where: { jobId }, data: { received, complete: received === count } });

  return { ok: true, status: 200, message: received === count ? "검토 영상을 다 받았어요." : `조각 ${idx + 1}/${count} 받음` };
}

/** 화면용: 다 받은 검토 영상 정보(없으면 null) */
export async function reviewVideoInfo(jobIds: string[]) {
  if (jobIds.length === 0) return new Map<string, { size: number; expiresAt: Date }>();
  const rows = await prisma.factoryReviewVideo.findMany({ where: { jobId: { in: jobIds }, complete: true }, select: { jobId: true, size: true, expiresAt: true } });

  return new Map(rows.map((r) => [r.jobId, { size: r.size, expiresAt: r.expiresAt }]));
}

/**
 * 관리자 재생용: 요청한 바이트 범위를 조각에서 잘라 돌려준다(start~end 포함). 영상이 없으면 null.
 * 한 번에 조각 두 개 이하만 읽도록 end 를 줄인다(브라우저는 이어서 다시 요청한다).
 */
export async function readVideoRange(jobId: string, start: number, endIn: number | null) {
  const v = await prisma.factoryReviewVideo.findUnique({ where: { jobId }, select: { size: true, complete: true } });

  if (!v || !v.complete || start >= v.size) return v?.complete ? { size: v.size, start, end: start - 1, data: null } : null;
  const firstIdx = Math.floor(start / REVIEW_VIDEO_CHUNK);
  const end = Math.min(endIn ?? v.size - 1, v.size - 1, (firstIdx + 2) * REVIEW_VIDEO_CHUNK - 1);
  const lastIdx = Math.floor(end / REVIEW_VIDEO_CHUNK);
  const chunks = await prisma.factoryReviewVideoChunk.findMany({ where: { jobId, idx: { gte: firstIdx, lte: lastIdx } }, orderBy: { idx: "asc" } });
  // 이 프로젝트의 TS 설정에서 Buffer 가 Uint8Array 로 바로 안 맞아서 직접 이어 붙인다
  const total = chunks.reduce((n, c) => n + c.data.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;

  for (const c of chunks) {
    joined.set(new Uint8Array(c.data), at);
    at += c.data.length;
  }
  const off = start - firstIdx * REVIEW_VIDEO_CHUNK;

  return { size: v.size, start, end, data: joined.slice(off, off + (end - start + 1)) };
}

export async function deleteReviewVideo(jobId: string): Promise<void> {
  await prisma.factoryReviewVideo.deleteMany({ where: { jobId } });
}

let lastSweep = 0;

/** 7일이 지난 검토 영상을 지운다. /next 에서 가끔 부른다. 던지지 않는다 */
export async function sweepReviewVideos(): Promise<void> {
  if (Date.now() - lastSweep < 30 * 60 * 1000) return;
  lastSweep = Date.now();
  try {
    await prisma.factoryReviewVideo.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch (error) {
    console.error("[factory] 검토 영상 정리 실패:", error);
  }
}
