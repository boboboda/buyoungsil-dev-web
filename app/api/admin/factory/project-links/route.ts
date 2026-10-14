// app/api/admin/factory/project-links/route.ts
// 앱별 연결 표 보기·고치기·새로 읽기 요청. 관리자만.
// GET: 표. POST { appSlug, ...고칠 칸 } : 보낸 칸만 저장. POST { refresh: true } : 다음 /next 에 읽기 요청을 한 번 붙인다.
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { isSlug, validatePatch } from "@/lib/factory/projectLinks";
import { readLinksView, requestScan, updateConnection } from "@/lib/factory/projectLinksDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await readLinksView(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (body?.refresh === true) {
    await requestScan();

    return NextResponse.json({ message: "새로 읽기를 요청했어요. 작업 PC 가 15초쯤 뒤에 읽어 보고해요.", ...(await readLinksView()) });
  }
  if (!body || !isSlug(body.appSlug)) return NextResponse.json({ message: "appSlug 가 필요해요." }, { status: 400 });
  const { appSlug, ...rest } = body;
  const parsed = validatePatch(rest);

  if (parsed.ok === false) return NextResponse.json({ message: parsed.reason }, { status: 400 });
  await updateConnection(appSlug, parsed.patch);

  return NextResponse.json({ message: `${appSlug} 연결 정보를 저장했어요.`, ...(await readLinksView()) });
}
