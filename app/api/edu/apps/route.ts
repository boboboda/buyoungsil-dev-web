// app/api/edu/apps/route.ts
// edu 사이트의 "앱" 페이지용 목록. 프로젝트에 "특수교육" 태그가 붙은 것만 내보낸다.
// 관리자 > 프로젝트 수정에서 태그를 달면 edu 에 나타나고, 태그를 빼면 사라진다.
// 브라우저에서 직접 부르지 않는다. 헤더 x-edu-key 가 EDU_API_KEY 와 같아야 한다.
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { checkEduKey } from "@/lib/edu/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const EDU_APP_TAG = "특수교육";

export async function GET(req: NextRequest) {
  const denied = checkEduKey(req);

  if (denied) return denied;

  const projects = await prisma.project.findMany({
    where: { tags: { some: { name: EDU_APP_TAG } } },
    orderBy: { createdAt: "desc" },
    take: 50,
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

  return NextResponse.json({
    apps: projects.map((p) => ({
      slug: p.name,
      title: p.title,
      description: p.description.slice(0, 300),
      coverImage: p.coverImage,
      appLink: p.appLink,
      platform: p.platform,
      status: p.status,
    })),
  });
}
