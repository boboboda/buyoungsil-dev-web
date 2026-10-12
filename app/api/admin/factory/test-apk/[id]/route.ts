// app/api/admin/factory/test-apk/[id]/route.ts
// 통제실 출시 패키지 '시험용 APK' 내려받기(관리자만, 로그인한 관리자 세션이 있어야 한다). DB 조각을 차례로 흘려 보낸다.
// id 는 형식을 확인하고, 파일 이름은 서버가 만든 이름(영문·숫자·._-)만 쓴다. PC 경로는 받지도 쓰지도 않는다.
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { openTestApk } from "@/lib/factory/testApk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const { id } = await ctx.params;

  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return NextResponse.json({ message: "id 가 올바르지 않아요." }, { status: 400 });
  const apk = await openTestApk(id);

  if (!apk) return NextResponse.json({ message: "그 APK 가 없어요(최근 5개만 남겨요)." }, { status: 404 });

  return new NextResponse(apk.stream, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(apk.size),
      "Content-Disposition": `attachment; filename="${apk.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
