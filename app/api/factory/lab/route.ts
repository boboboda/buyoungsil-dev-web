// app/api/factory/lab/route.ts
// 감독 프로그램이 실험(lab) 일감의 [폴더 지우기] 처리 결과를 알리는 주소(워커 토큰만).
// 요청: POST { jobId, deleted: true } — 해당 lab\<id> 폴더를 지웠다고 labResult.folderDeleted 에 시각을 남기고 요청 표시를 지운다.
// 응답: 200 { ok }
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { ID_RE } from "@/lib/factory/jobs";
import { LAB_KIND, mergeLabResult } from "@/lib/factory/lab";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  const parsed = await readJson(req);

  if (parsed.ok === false) return parsed.res;
  const b = (parsed.body ?? {}) as Record<string, unknown>;
  const jobId = typeof b.jobId === "string" ? b.jobId : "";

  if (!ID_RE.test(jobId)) return fail(400, "jobId 형식이 올바르지 않습니다.");
  const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { kind: true, labCleanupAt: true } });

  if (!job || job.kind !== LAB_KIND) return fail(404, "없는 실험 일감입니다.");
  if (b.deleted === true) {
    await mergeLabResult(jobId, { folderDeleted: new Date().toISOString() });
    await prisma.factoryJob.update({ where: { id: jobId }, data: { labCleanupAt: null } });
  }

  return NextResponse.json({ ok: true });
}
