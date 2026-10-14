// app/api/factory/lab-file/route.ts
// 감독 프로그램이 실험(lab) 일감의 결과 파일(png·webp·gif·mp4·report.md)을 조각으로 올리는 주소(워커 토큰만). 실행 중인 실험 일감만.
//
// 요청: PUT /api/factory/lab-file?jobId=…&name=outputs 아래 상대 경로&idx=0&count=N&size=전체바이트, 본문 = 조각(application/octet-stream, 512KB 이하)
//   idx 0 을 보내면 같은 이름의 파일을 새로 시작한다. 마지막 조각까지 받으면 complete.
// 응답: 200 { ok, message } / 크기·순서·이름이 틀리면 400·409 / 파일 50MB·일감 200MB 를 넘으면 413
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { ID_RE } from "@/lib/factory/jobs";
import { LAB_CHUNK, receiveLabChunk } from "@/lib/factory/lab";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;

  const q = req.nextUrl.searchParams;
  const jobId = q.get("jobId") ?? "";
  const name = q.get("name") ?? "";
  const idx = Number(q.get("idx"));
  const count = Number(q.get("count"));
  const size = Number(q.get("size"));

  if (!ID_RE.test(jobId)) return fail(400, "jobId 가 올바르지 않습니다.");
  if (Number(req.headers.get("content-length") ?? "0") > LAB_CHUNK) return fail(413, "조각이 너무 큽니다(512KB 이하).");

  try {
    const buf = new Uint8Array(await req.arrayBuffer());

    if (buf.length > LAB_CHUNK) return fail(413, "조각이 너무 큽니다(512KB 이하).");
    const r = await receiveLabChunk(jobId, name, idx, count, size, buf);

    return r.ok ? NextResponse.json({ ok: true, message: r.message }) : fail(r.status, r.message);
  } catch (error) {
    console.error("[factory] 실험 파일 받기 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
