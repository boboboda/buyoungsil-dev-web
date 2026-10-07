// app/api/edu/posts/[id]/unlock/route.ts
// 비밀글 열람: 본문 { password } 가 작성 때 정한 비밀번호와 맞으면 전체 내용을 돌려준다.
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import {
  checkEduKey,
  fail,
  getEduClientIp,
  isRateLimited,
  toFullPost,
  verifyPassword,
} from "@/lib/edu/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PASSWORD_WINDOW_MS = 10 * 60 * 1000;
const MAX_PASSWORD_TRIES = 10;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = checkEduKey(req);

  if (denied) return denied;

  const { id } = await params;

  if (
    isRateLimited(
      `unlock:${id}:${getEduClientIp(req)}`,
      MAX_PASSWORD_TRIES,
      PASSWORD_WINDOW_MS,
    )
  ) {
    return fail(429, "시도 횟수가 너무 많습니다. 잠시 후 다시 해 주세요.");
  }

  let password: unknown;

  try {
    ({ password } = await req.json());
  } catch {
    return fail(400, "요청 형식이 올바르지 않습니다.");
  }

  if (typeof password !== "string" || !password) {
    return fail(400, "비밀번호를 입력해 주세요.");
  }

  try {
    const post = await prisma.eduPost.findUnique({
      where: { id },
      include: { replies: { orderBy: { createdAt: "asc" } } },
    });

    if (!post) return fail(404, "글을 찾을 수 없습니다.");

    if (!(await verifyPassword(password, post.passwordHash))) {
      return fail(403, "비밀번호가 맞지 않습니다.");
    }

    return NextResponse.json({ post: toFullPost(post) });
  } catch (error) {
    console.error("[edu-api] 비밀글 열람 실패:", error);

    return fail(500, "글을 불러오지 못했습니다.");
  }
}
