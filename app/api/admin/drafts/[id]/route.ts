// 초안함 관리자 동작: 보내기(개발노트/스토리로 비공개 저장) / 버리기
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth/get-sesstion";
import { markdownToLexical } from "@/lib/drafts/markdownToLexical";
import { markdownToHtml } from "@/lib/drafts/markdownToHtml";
import { MAX_MARKDOWN_LENGTH } from "@/lib/drafts/validate";
import { generateSlug } from "@/lib/utils/slugify";
import { cleanSubName, findOrCreateSubCategory, MAX_SUB_NAME } from "@/lib/drafts/subCategory";

const STORY_CATEGORIES = ["삽질기", "꿀팁", "일상"];
const LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "요청 형식이 올바르지 않아요." }, { status: 400 });
  }

  const draft = await prisma.draft.findUnique({ where: { id } });
  if (!draft || draft.status !== "pending") {
    return NextResponse.json({ message: "이미 처리됐거나 없는 초안이에요." }, { status: 404 });
  }

  // ── 버리기 ──
  if (body.action === "discard") {
    await prisma.draft.updateMany({
      where: { id, status: "pending" },
      data: { status: "discarded" },
    });
    return NextResponse.json({ success: true });
  }

  if (body.action !== "send") {
    return NextResponse.json({ message: "알 수 없는 동작이에요." }, { status: 400 });
  }

  // ── 보내기 ──
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const markdown = typeof body.markdown === "string" ? body.markdown.trim() : "";
  const tags: string[] = Array.isArray(body.tags)
    ? body.tags.filter((t: unknown): t is string => typeof t === "string" && !!t.trim()).slice(0, 20)
    : [];

  if (!title || !markdown) {
    return NextResponse.json({ message: "제목과 본문이 필요해요." }, { status: 400 });
  }
  if (markdown.length > MAX_MARKDOWN_LENGTH) {
    return NextResponse.json({ message: "본문이 너무 길어요." }, { status: 400 });
  }

  try {
    if (body.target === "note") {
      const mainCategory = typeof body.mainCategory === "string" ? body.mainCategory : "";
      if (!mainCategory) {
        return NextResponse.json({ message: "섹션을 골라주세요." }, { status: 400 });
      }
      const level = LEVELS.includes(body.level) ? body.level : "BEGINNER";

      const category = await prisma.noteCategory.findUnique({ where: { slug: mainCategory } });
      if (!category) {
        return NextResponse.json({ message: "없는 섹션이에요." }, { status: 400 });
      }

      // 세부 카테고리: 이름이 있으면 같은 뜻의 기존 것을 쓰고, 없으면 이때 만든다. (초안을 버리면 만들어지지 않는다)
      const subName = typeof body.subCategory === "string" ? body.subCategory.trim() : "";
      if (subName && !cleanSubName(subName)) {
        return NextResponse.json(
          { message: `세부 카테고리 이름은 1~${MAX_SUB_NAME}자로 써 주세요.` },
          { status: 400 },
        );
      }

      const content = markdownToLexical(markdown) as Prisma.InputJsonValue;

      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.draft.updateMany({
          where: { id, status: "pending" },
          data: { status: "sent" },
        });
        if (claimed.count === 0) throw new Error("ALREADY_HANDLED");

        const subCategory = subName ? await findOrCreateSubCategory(tx, mainCategory, subName) : null;

        const max = await tx.developNote.findFirst({
          orderBy: { noteId: "desc" },
          select: { noteId: true },
        });
        const noteId = (max?.noteId || 0) + 1;

        // isPublished 는 스키마 기본값(false). 초안에서 온 글은 항상 비공개로 시작한다.
        await tx.developNote.create({
          data: {
            noteId,
            title,
            mainCategory,
            subCategory: subCategory ? { id: subCategory.id, name: subCategory.name } : Prisma.DbNull,
            level,
            content,
            isPublished: false,
          },
        });

        await tx.draft.update({
          where: { id },
          data: { sentType: "note", sentRef: String(noteId), title, markdown, level, tags },
        });

        return { type: "note" as const, ref: String(noteId), editUrl: `/admin/write/${noteId}` };
      });

      return NextResponse.json({ success: true, ...result });
    }

    if (body.target === "story") {
      const category = STORY_CATEGORIES.includes(body.storyCategory) ? body.storyCategory : null;
      if (!category) {
        return NextResponse.json({ message: "스토리 분류를 골라주세요." }, { status: 400 });
      }

      const html = markdownToHtml(markdown);

      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.draft.updateMany({
          where: { id, status: "pending" },
          data: { status: "sent" },
        });
        if (claimed.count === 0) throw new Error("ALREADY_HANDLED");

        const story = await tx.story.create({
          data: { slug: `temp-${id}`, title, content: html, category, tags, isPublished: false },
        });
        await tx.story.update({
          where: { id: story.id },
          data: { slug: generateSlug(title, story.id) },
        });
        await tx.draft.update({
          where: { id },
          data: { sentType: "story", sentRef: story.id, title, markdown, level: draft.level, tags },
        });

        return { type: "story" as const, ref: story.id, editUrl: `/admin/stories/edit/${story.id}` };
      });

      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({ message: "보낼 곳(개발노트/스토리)을 골라주세요." }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_HANDLED") {
      return NextResponse.json({ message: "이미 처리된 초안이에요." }, { status: 409 });
    }
    console.error("초안 보내기 오류:", error);
    return NextResponse.json({ message: "보내기에 실패했어요." }, { status: 500 });
  }
}
