// app/api/admin/factory/tool-manifests/route.ts
// 도구 설명서 조회(읽기 전용). 관리자만. 도구마다 방법·필요한 키와 준비 상태(키 이름이 등록돼 있는지만, 값 없음)·한계·입력 항목.
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { readManifestsView } from "@/lib/factory/toolManifestDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await readManifestsView(), { headers: { "Cache-Control": "no-store" } });
}
