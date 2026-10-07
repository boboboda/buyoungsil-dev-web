// app/api/edu/inquiries/route.ts
// edu 사이트용 문의 게시판 목록 / 작성. 홈페이지 프로젝트의 기존 문의 게시판(posts)과 같은 글이다.
// 브라우저에서 직접 부르지 않는다. 헤더 x-edu-key 가 EDU_API_KEY 와 같아야 한다.
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import {
  checkEduKey,
  cleanText,
  fail,
  getEduClientIp,
  isRateLimited,
} from "@/lib/edu/guard";
import {
  EDU_GUEST_EMAIL,
  INQUIRY_POST_TYPE,
  getEduProjectName,
} from "@/lib/edu/projectBoard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE_SIZE = 15;

const LIMITS = { nickname: 20, title: 80, content: 3000 };

const POST_WINDOW_MS = 10 * 60 * 1000;
const MAX_POSTS_PER_IP_PER_WINDOW = 3;
const MAX_POSTS_PER_HOUR = 60;

// 목록
export async function GET(req: NextRequest) {
  const denied = checkEduKey(req);

  if (denied) return denied;

  const appName = await getEduProjectName();

  if (!appName) return fail(503, "문의 게시판이 아직 준비되지 않았습니다.");

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const where = { appName, postType: INQUIRY_POST_TYPE };

  try {
    const [rows, total] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          listNumber: true,
          writer: true,
          title: true,
          createdAt: true,
          _count: { select: { comments: true } },
        },
      }),
      prisma.post.count({ where }),
    ]);

    return NextResponse.json({
      posts: rows.map((p) => ({
        id: p.id,
        listNumber: p.listNumber,
        nickname: p.writer,
        title: p.title,
        createdAt: p.createdAt.toISOString(),
        replyCount: p._count.comments,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (error) {
    console.error("[edu-api] 문의 목록 조회 실패:", error);

    return fail(500, "목록을 불러오지 못했습니다.");
  }
}

// 작성
export async function POST(req: NextRequest) {
  const denied = checkEduKey(req);

  if (denied) return denied;

  if (
    isRateLimited(
      `inquiry:${getEduClientIp(req)}`,
      MAX_POSTS_PER_IP_PER_WINDOW,
      POST_WINDOW_MS,
    )
  ) {
    return fail(429, "잠시 후 다시 작성해 주세요.");
  }

  const appName = await getEduProjectName();

  if (!appName) return fail(503, "문의 게시판이 아직 준비되지 않았습니다.");

  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return fail(400, "요청 형식이 올바르지 않습니다.");
  }

  const nickname = cleanText(body.nickname);
  const title = cleanText(body.title);
  const content = cleanText(body.content, true);

  if (!nickname || nickname.length > LIMITS.nickname) {
    return fail(400, `닉네임은 1~${LIMITS.nickname}자로 입력해 주세요.`);
  }

  if (!title || title.length > LIMITS.title) {
    return fail(400, `제목은 1~${LIMITS.title}자로 입력해 주세요.`);
  }

  if (!content || content.length > LIMITS.content) {
    return fail(400, `내용은 1~${LIMITS.content}자로 입력해 주세요.`);
  }

  try {
    // 서버 전체 안전장치: 최근 1시간 동안 edu 에서 너무 많은 문의가 들어오면 잠시 막는다.
    const recent = await prisma.post.count({
      where: {
        email: EDU_GUEST_EMAIL,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });

    if (recent >= MAX_POSTS_PER_HOUR) {
      return fail(
        429,
        "지금은 글을 받을 수 없습니다. 잠시 후 다시 시도해 주세요.",
      );
    }

    // 기존 게시판과 같은 방식으로 글 번호를 +1 한다.
    const last = await prisma.post.aggregate({
      where: { appName, postType: INQUIRY_POST_TYPE },
      _max: { listNumber: true },
    });

    const created = await prisma.post.create({
      data: {
        appName,
        postType: INQUIRY_POST_TYPE,
        listNumber: (last._max.listNumber ?? 0) + 1,
        writer: nickname,
        email: EDU_GUEST_EMAIL,
        title,
        content,
      },
      select: { id: true },
    });

    return NextResponse.json(
      { success: true, id: created.id },
      { status: 201 },
    );
  } catch (error) {
    console.error("[edu-api] 문의 작성 실패:", error);

    return fail(500, "글을 저장하지 못했습니다.");
  }
}
