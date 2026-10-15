// app/api/factory/diff/route.ts
// 일감 변경 내용(diff) 보고(5-1): 감독 프로그램이 일감이 끝나기 직전(완료 보고 전)에 커밋 범위의 파일 목록·줄 수·파일별 diff 를 보낸다.
// 헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>. 본문 { jobId, diff } — 완료 보고(64KB 한도)에는 너무 커서 따로 받는다(최대 700KB).
// 서버가 한 번 더 정리해서(lib/factory/diffReport.ts: 파일 수·크기 한도, 키·비밀 파일 내용 숨김, 키·비밀번호 줄 가림) 저장한다.
// 받는 상태: 실행 중이거나 막 끝난(done, 1시간 안) 일감. 응답: 200 { ok }
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { cleanDiffReport, MAX_DIFF_BODY_BYTES } from "@/lib/factory/diffReport";
import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { ID_RE } from "@/lib/factory/jobs";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  const read = await readJson(req, MAX_DIFF_BODY_BYTES);

  if (read.ok === false) return read.res;
  const b = read.body as Record<string, unknown> | null;

  if (!b || typeof b !== "object" || Array.isArray(b)) return fail(400, "요청 형식이 올바르지 않습니다.");
  const jobId = typeof b.jobId === "string" ? b.jobId : "";

  if (!ID_RE.test(jobId)) return fail(400, "jobId 형식이 올바르지 않습니다.");
  const diff = cleanDiffReport(b.diff);

  if (!diff) return fail(400, "diff 형식이 올바르지 않습니다.");

  try {
    const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { status: true, finishedAt: true } });

    if (!job) return fail(404, "없는 지시입니다.");
    const recentDone = job.status === "done" && job.finishedAt && Date.now() - job.finishedAt.getTime() < 60 * 60_000;

    if (job.status !== "running" && !recentDone) return fail(409, `지시가 실행 중이 아닙니다(${job.status}).`);
    await prisma.factoryJob.update({ where: { id: jobId }, data: { diffInfo: diff as unknown as Prisma.InputJsonObject } });

    return NextResponse.json({ ok: true, files: diff.totalFiles });
  } catch (error) {
    console.error("[factory] diff 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
