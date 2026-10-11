// app/api/factory/project/route.ts
// 감독 프로그램이 출시 단계에서 홈페이지 프로젝트의 빈 항목을 채우는 주소. 이미 있는 값은 건드리지 않는다.
//
// 요청: POST JSON { appSlug, description?, coverImage?, appLink?, techStack?, privacyPolicy? }, 헤더 Authorization: Bearer <토큰>
// 응답: 200 { ok, message, filled: [...], skipped: [...] } / 연결된 프로젝트가 없으면 404 / 방침에 [[ ]] 가 남아 있으면 400
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { fillProjectIfEmpty } from "@/lib/factory/project";
import { APP_SLUG_RE } from "@/lib/factory/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : undefined);

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body || typeof body.appSlug !== "string" || !APP_SLUG_RE.test(body.appSlug)) {
    return fail(400, "appSlug 가 올바르지 않습니다.");
  }

  const tech = Array.isArray(body.techStack)
    ? body.techStack.filter((t): t is string => typeof t === "string" && t.length <= 30).slice(0, 12)
    : undefined;

  try {
    const r = await fillProjectIfEmpty(body.appSlug, {
      description: str(body.description, 2000),
      coverImage: str(body.coverImage, 500),
      appLink: str(body.appLink, 500),
      techStack: tech,
      privacyPolicy: str(body.privacyPolicy, 60000),
    });

    if (!r.ok) return fail(r.status, r.message);

    return NextResponse.json({ ok: true, message: r.message, filled: r.filled, skipped: r.skipped });
  } catch (error) {
    console.error("[factory] project 채우기 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
