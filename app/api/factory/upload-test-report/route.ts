// app/api/factory/upload-test-report/route.ts
// 감독 프로그램이 '업로드 시험' 결과(단계별 크기·걸린 시간·HTTP 상태·공개 주소)를 보내는 주소(워커 토큰만).
// 요청: POST JSON { id, synthetic, note, steps: [ { label, bytes, ms, status, ok, url, message, stage, upstreamStatus } ] }
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { receiveUploadTestReport } from "@/lib/factory/uploadTest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const read = await readJson(req);
  if (read.ok === false) return read.res;

  try {
    const r = await receiveUploadTestReport(read.body);

    return r.ok ? NextResponse.json({ ok: true, message: r.message }) : fail(r.status, r.message);
  } catch (error) {
    console.error("[factory] 업로드 시험 결과 저장 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
