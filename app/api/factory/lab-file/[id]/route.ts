// app/api/factory/lab-file/[id]/route.ts
// 실험(lab) 결과 파일 보기. 관리자 로그인 세션이거나, 커넥터에 준 임시 서명 주소(exp·sig)일 때만 연다.
// 이미지는 미리보기, mp4 는 Range 요청에 맞춰 잘라 보낸다(폰 재생).
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { ID_RE } from "@/lib/factory/jobs";
import { readLabRange, verifyLabLink } from "@/lib/factory/lab";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  if (!ID_RE.test(id)) return NextResponse.json({ message: "id 가 올바르지 않아요." }, { status: 400 });
  const q = req.nextUrl.searchParams;
  const signed = verifyLabLink(id, q.get("exp"), q.get("sig"));

  if (!signed) {
    const denied = await requireAdmin();

    if (denied) return denied;
  }
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
  const start = m ? Number(m[1]) : 0;
  const end = m && m[2] ? Number(m[2]) : null;
  const r = await readLabRange(id, start, end);

  if (!r) return NextResponse.json({ message: "파일이 없어요." }, { status: 404 });
  const headers = {
    "Content-Type": r.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    // 문서(report.md)는 화면에 그리지 않고 글로만 보이게 한다
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
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
