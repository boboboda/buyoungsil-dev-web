// app/api/edu/projects/[name]/board/[postType]/[id]/route.ts — 글 상세 (댓글·대댓글 포함)
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { checkEduKey, fail } from "@/lib/edu/guard";
import {
  findProjectName,
  isReadablePostType,
  toInquiryComments,
} from "@/lib/edu/projectBoard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ name: string; postType: string; id: string }> },
) {
  const denied = checkEduKey(req);

  if (denied) return denied;

  const { name, postType, id } = await params;

  if (!isReadablePostType(postType))
    return fail(404, "게시판을 찾을 수 없습니다.");

  const appName = await findProjectName(name);

  if (!appName) return fail(404, "프로젝트를 찾을 수 없습니다.");

  try {
    // 그 프로젝트의 그 게시판에 속한 글만 보여 준다.
    const post = await prisma.post.findFirst({
      where: { id, appName, postType },
      include: {
        comments: {
          orderBy: { createdAt: "asc" },
          include: { replies: { orderBy: { createdAt: "asc" } } },
        },
      },
    });

    if (!post) return fail(404, "글을 찾을 수 없습니다.");

    return NextResponse.json({
      post: {
        id: post.id,
        listNumber: post.listNumber,
        nickname: post.writer,
        title: post.title,
        content: post.content,
        createdAt: post.createdAt.toISOString(),
        comments: toInquiryComments(post.comments),
      },
    });
  } catch (error) {
    console.error("[edu-api] 게시판 상세 조회 실패:", error);

    return fail(500, "글을 불러오지 못했습니다.");
  }
}
