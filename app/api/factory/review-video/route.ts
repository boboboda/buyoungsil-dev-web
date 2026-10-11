// app/api/factory/review-video/route.ts
// 감독 프로그램이 출시 검토용 홍보 영상을 조각으로 올리는 주소(워커 토큰만). 실행 중인 '검토 단계가 있는' 출시 일감만.
// 영상은 공개 업로드 서버가 아니라 DB 에 잠깐 둔다(관리자만 재생, 결정 뒤·7일 뒤 삭제).
//
// 요청: PUT /api/factory/review-video?jobId=…&idx=0&count=N&size=전체바이트, 본문 = 조각(application/octet-stream, 8MB 이하)
//   idx 0 을 보내면 새로 시작한다. 마지막 조각까지 받으면 complete.
// 응답: 200 { ok, message } / 크기·순서가 틀리면 400·409 / 50MB 넘으면 413
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { ID_RE } from "@/lib/factory/jobs";
import { REVIEW_VIDEO_CHUNK, receiveVideoChunk } from "@/lib/factory/reviewVideo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const q = req.nextUrl.searchParams;
  const jobId = q.get("jobId") ?? "";
  const idx = Number(q.get("idx"));
  const count = Number(q.get("count"));
  const size = Number(q.get("size"));

  if (!ID_RE.test(jobId)) return fail(400, "jobId 가 올바르지 않습니다.");
  if (Number(req.headers.get("content-length") ?? "0") > REVIEW_VIDEO_CHUNK) return fail(413, "조각이 너무 큽니다(8MB 이하).");

  try {
    const buf = new Uint8Array(await req.arrayBuffer());

    if (buf.length > REVIEW_VIDEO_CHUNK) return fail(413, "조각이 너무 큽니다(8MB 이하).");
    const r = await receiveVideoChunk(jobId, idx, count, size, buf);

    return r.ok ? NextResponse.json({ ok: true, message: r.message }) : fail(r.status, r.message);
  } catch (error) {
    console.error("[factory] 검토 영상 받기 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
