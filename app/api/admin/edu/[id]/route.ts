// 특수교육 도구함(edu) 게시판 관리자 동작: 답변 달기 / 상태 바꾸기 / 답변 삭제 / 글 삭제
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth/get-sesstion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUSES = ["open", "reviewing", "planned", "done"];
const MAX_REPLY_LENGTH = 3000;

type Ctx = { params: Promise<{ id: string }> };

const fail = (status: number, message: string) =>
  NextResponse.json({ message }, { status });

export async function POST(request: NextRequest, { params }: Ctx) {
  const session = await auth();

  if (!session || session.user?.role !== "admin") {
    return fail(403, "권한이 없습니다.");
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return fail(400, "요청 형식이 올바르지 않아요.");
  }

  const post = await prisma.eduPost.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!post) return fail(404, "글을 찾을 수 없어요.");

  try {
    switch (body.action) {
      case "reply": {
        const content =
          typeof body.content === "string"
            ? body.content.replace(/\r\n?/g, "\n").trim()
            : "";

        if (!content || content.length > MAX_REPLY_LENGTH) {
          return fail(400, `답변은 1~${MAX_REPLY_LENGTH}자로 입력해 주세요.`);
        }

        const reply = await prisma.eduReply.create({
          data: { postId: id, content },
        });

        return NextResponse.json({
          success: true,
          reply: {
            id: reply.id,
            content: reply.content,
            createdAt: reply.createdAt.toISOString(),
          },
        });
      }

      case "status": {
        if (
          typeof body.status !== "string" ||
          !STATUSES.includes(body.status)
        ) {
          return fail(400, "상태 값이 올바르지 않아요.");
        }

        await prisma.eduPost.update({
          where: { id },
          data: { status: body.status },
        });

        return NextResponse.json({ success: true });
      }

      case "deleteReply": {
        if (typeof body.replyId !== "string") {
          return fail(400, "답변 정보가 필요해요.");
        }

        // 이 글에 속한 답변만 지운다.
        await prisma.eduReply.deleteMany({
          where: { id: body.replyId, postId: id },
        });

        return NextResponse.json({ success: true });
      }

      case "deletePost": {
        await prisma.eduPost.delete({ where: { id } });

        return NextResponse.json({ success: true });
      }

      default:
        return fail(400, "알 수 없는 동작이에요.");
    }
  } catch (error) {
    console.error("[admin/edu] 처리 실패:", error);

    return fail(500, "처리하지 못했어요.");
  }
}
