// app/api/edu/posts/route.ts
// edu(특수교육 도구함) 사이트 서버가 호출하는 게시판 목록 / 작성 API.
// 브라우저에서 직접 부르지 않는다. 헤더 x-edu-key 가 EDU_API_KEY 와 같아야 한다.
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import {
  checkEduKey,
  cleanText,
  fail,
  getEduClientIp,
  hashPassword,
  isEduBoard,
  isRateLimited,
} from "@/lib/edu/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE_SIZE = 15;

const LIMITS = {
  nickname: 20,
  title: 80,
  content: 3000,
  passwordMin: 4,
  passwordMax: 32,
};

const POST_WINDOW_MS = 10 * 60 * 1000;
const MAX_POSTS_PER_IP_PER_WINDOW = 5;
const MAX_POSTS_PER_HOUR = 120;

// 목록
export async function GET(req: NextRequest) {
  const denied = checkEduKey(req);

  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const board = searchParams.get("board");

  if (!isEduBoard(board)) return fail(400, "게시판 종류가 올바르지 않습니다.");

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  try {
    const [rows, total] = await Promise.all([
      prisma.eduPost.findMany({
        where: { board },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          board: true,
          nickname: true,
          title: true,
          isSecret: true,
          status: true,
          createdAt: true,
          _count: { select: { replies: true } },
        },
      }),
      prisma.eduPost.count({ where: { board } }),
    ]);

    return NextResponse.json({
      posts: rows.map((p) => ({
        id: p.id,
        board: p.board,
        nickname: p.nickname,
        title: p.title,
        isSecret: p.isSecret,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        replyCount: p._count.replies,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (error) {
    console.error("[edu-api] 목록 조회 실패:", error);

    return fail(500, "목록을 불러오지 못했습니다.");
  }
}

// 작성
export async function POST(req: NextRequest) {
  const denied = checkEduKey(req);

  if (denied) return denied;

  if (
    isRateLimited(
      `post:${getEduClientIp(req)}`,
      MAX_POSTS_PER_IP_PER_WINDOW,
      POST_WINDOW_MS,
    )
  ) {
    return fail(429, "잠시 후 다시 작성해 주세요.");
  }

  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return fail(400, "요청 형식이 올바르지 않습니다.");
  }

  const board = body.board;

  if (!isEduBoard(board)) return fail(400, "게시판 종류가 올바르지 않습니다.");

  const nickname = cleanText(body.nickname);
  const title = cleanText(body.title);
  const content = cleanText(body.content, true);
  const password = typeof body.password === "string" ? body.password : null;

  if (!nickname || nickname.length > LIMITS.nickname) {
    return fail(400, `닉네임은 1~${LIMITS.nickname}자로 입력해 주세요.`);
  }

  if (!title || title.length > LIMITS.title) {
    return fail(400, `제목은 1~${LIMITS.title}자로 입력해 주세요.`);
  }

  if (!content || content.length > LIMITS.content) {
    return fail(400, `내용은 1~${LIMITS.content}자로 입력해 주세요.`);
  }

  if (
    !password ||
    password.length < LIMITS.passwordMin ||
    password.length > LIMITS.passwordMax
  ) {
    return fail(
      400,
      `비밀번호는 ${LIMITS.passwordMin}~${LIMITS.passwordMax}자로 입력해 주세요.`,
    );
  }

  try {
    // 서버 전체 안전장치: 최근 1시간 동안 너무 많은 글이 들어오면 잠시 막는다.
    const recent = await prisma.eduPost.count({
      where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });

    if (recent >= MAX_POSTS_PER_HOUR) {
      return fail(
        429,
        "지금은 글을 받을 수 없습니다. 잠시 후 다시 시도해 주세요.",
      );
    }

    const created = await prisma.eduPost.create({
      data: {
        board,
        nickname,
        passwordHash: await hashPassword(password),
        title,
        content,
        // 문의는 항상 비밀글, 앱·도구 요청은 공개
        isSecret: board === "contact",
      },
      select: { id: true },
    });

    return NextResponse.json(
      { success: true, id: created.id },
      { status: 201 },
    );
  } catch (error) {
    console.error("[edu-api] 작성 실패:", error);

    return fail(500, "글을 저장하지 못했습니다.");
  }
}
