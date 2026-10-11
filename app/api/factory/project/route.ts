// app/api/factory/project/route.ts
// 감독 프로그램이 출시 단계에서 홈페이지 프로젝트의 빈 항목을 채우는 주소. 이미 있는 값은 건드리지 않는다.
//
// 요청: POST JSON { appSlug, jobId?, description?, coverImage?, appLink?, techStack?, privacyPolicy? }, 헤더 Authorization: Bearer <토큰>
//   jobId 가 출시 일감이면 그 종류가 홈페이지 반영을 허락할 때만 받는다.
//   출시 일감이면 서버가 가진 값(스토어 자료의 대표 이미지 → coverImage, 출시된 앱의 Play 주소 → appLink)을 보낸 값이 없을 때 더한다.
//   승인 때 '홈페이지 프로젝트도 덮어쓰기'를 고른 store/project 일감은 기존 값도 바꾼다(개인정보처리방침 제외).
//   갱신 항목을 고른 일감은 그 항목의 칸만 받는다(나머지는 버림). '개인정보처리방침 갱신'을 고른 일감만 방침을 덮어쓴다.
// 응답: 200 { ok, message, filled: [...], skipped: [...] } / 연결된 프로젝트가 없으면 404 / 방침에 [[ ]] 가 남아 있으면 400
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { fillProjectIfEmpty, type ProjectFill } from "@/lib/factory/project";
import { projectFillAllowed } from "@/lib/factory/release";
import { storeProjectValues } from "@/lib/factory/storeAssets";
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
    const allowed = await projectFillAllowed(body.jobId);

    if (allowed.ok === false) return fail(400, allowed.message);
    const server = allowed.release ? await storeProjectValues(body.appSlug) : {};
    const fill: ProjectFill = {
      title: server.title, // 앱 이름은 서버 값만(카드에서 사람이 정한 이름)
      description: str(body.description, 2000),
      coverImage: str(body.coverImage, 500) ?? server.coverImage,
      appLink: str(body.appLink, 500) ?? server.appLink,
      techStack: tech,
      privacyPolicy: str(body.privacyPolicy, 60000),
    };

    // 고르지 않은 항목의 칸은 버린다
    if (allowed.fields) for (const k of Object.keys(fill) as (keyof ProjectFill)[]) if (!allowed.fields.includes(k)) delete fill[k];
    const r = await fillProjectIfEmpty(body.appSlug, fill, { overwrite: allowed.overwrite, privacyOverwrite: allowed.privacyOverwrite });

    if (!r.ok) return fail(r.status, r.message);

    return NextResponse.json({ ok: true, message: r.message, filled: r.filled, skipped: r.skipped });
  } catch (error) {
    console.error("[factory] project 채우기 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
