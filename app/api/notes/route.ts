// app/api/notes/route.ts
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth/get-sesstion";

// 노트 생성 (기존 addEdtiorServer 서버 액션을 API 라우트로 이전)
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session || session.user?.role !== "admin") {
      return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
    }

    const note = await request.json();

    // noteId는 서버에서 원자적으로 계산 (기존 getMaxNoteId + 클라이언트 세팅 방식의 경합 조건도 같이 제거)
    const maxNote = await prisma.developNote.findFirst({
      orderBy: { noteId: "desc" },
      select: { noteId: true },
    });
    const nextNoteId = (maxNote?.noteId || 0) + 1;

    const created = await prisma.developNote.create({
      data: {
        noteId: nextNoteId,
        title: note.title,
        mainCategory: note.mainCategory || null,
        subCategory: note.subCategory ?? null,
        level: note.level || "BEGINNER",
        content: note.content,
      },
    });

    return NextResponse.json({ success: true, note: created }, { status: 201 });
  } catch (error) {
    console.error("노트 생성 오류:", error);

    return NextResponse.json(
      { success: false, message: "저장 실패" },
      { status: 500 },
    );
  }
}