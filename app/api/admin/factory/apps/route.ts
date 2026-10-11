// app/api/admin/factory/apps/route.ts
// 공장 앱 ↔ 홈페이지 Project 연결 보기·바꾸기. 관리자만. (기존 앱을 기존 Project 에 연결할 때 쓴다)
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { APP_SLUG_RE } from "@/lib/factory/jobs";
import { linkAppProject, listAppProjectLinks } from "@/lib/factory/project";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await listAppProjectLinks());
}

// 본문: { appSlug, projectId: string | null }  (null 이면 연결 풀기)
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { appSlug?: unknown; projectId?: unknown } | null;
  const appSlug = typeof body?.appSlug === "string" ? body.appSlug.trim() : "";
  const projectId = body?.projectId === null ? null : typeof body?.projectId === "string" ? body.projectId.trim() : undefined;

  if (!APP_SLUG_RE.test(appSlug) || projectId === undefined || projectId === "") {
    return NextResponse.json({ message: "appSlug 와 projectId(문자열, 또는 연결을 풀 때 null)가 필요해요." }, { status: 400 });
  }

  const res = await linkAppProject(appSlug, projectId);

  return NextResponse.json({ message: res.message, ...(res.ok ? await listAppProjectLinks() : {}) }, { status: res.status });
}
