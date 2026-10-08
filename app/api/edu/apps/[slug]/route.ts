// app/api/edu/apps/[slug]/route.ts
// edu 사이트의 앱 상세 화면용. "특수교육" 태그가 붙은 프로젝트만 내보낸다.
// 브라우저에서 직접 부르지 않는다. 헤더 x-edu-key 가 EDU_API_KEY 와 같아야 한다.
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { checkEduKey, fail } from "@/lib/edu/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EDU_APP_TAG = "특수교육";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const denied = checkEduKey(req);

  if (denied) return denied;

  const { slug } = await params;

  const project = await prisma.project.findFirst({
    where: { name: slug, tags: { some: { name: EDU_APP_TAG } } },
    select: {
      name: true,
      title: true,
      description: true,
      coverImage: true,
      appLink: true,
      platform: true,
      status: true,
    },
  });

  if (!project) return fail(404, "앱을 찾을 수 없습니다.");

  return NextResponse.json({
    app: {
      slug: project.name,
      title: project.title,
      description: project.description,
      coverImage: project.coverImage,
      appLink: project.appLink,
      platform: project.platform,
      status: project.status,
    },
  });
}
