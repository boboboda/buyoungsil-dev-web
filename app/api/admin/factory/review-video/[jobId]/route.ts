// app/api/admin/factory/review-video/[jobId]/route.ts
// 통제실 출시 검토 화면의 홍보 영상 재생(관리자만). DB 에 조각으로 둔 검토용 mp4 를 Range 요청에 맞춰 잘라 보낸다.
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { ID_RE } from "@/lib/factory/jobs";
import { readVideoRange } from "@/lib/factory/reviewVideo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const { jobId } = await ctx.params;

  if (!ID_RE.test(jobId)) return NextResponse.json({ message: "jobId 가 올바르지 않아요." }, { status: 400 });
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
  const start = m ? Number(m[1]) : 0;
  const end = m && m[2] ? Number(m[2]) : null;
  const r = await readVideoRange(jobId, start, end);

  if (!r) return NextResponse.json({ message: "검토 영상이 없어요(결정 뒤 또는 7일이 지나 지웠을 수 있어요)." }, { status: 404 });
  const headers = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };

  if (!r.data) return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${r.size}` } });

  return new NextResponse(new Blob([r.data as BlobPart]), {
    status: m ? 206 : 200,
    headers: {
      ...headers,
      "Content-Length": String(r.data.length),
      ...(m ? { "Content-Range": `bytes ${r.start}-${r.end}/${r.size}` } : {}),
    },
  });
}
