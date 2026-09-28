// app/api/notes/[noteId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth/get-sesstion";

// 노트 수정 (기존 findOneAndUpdateEditorServer 서버 액션을 API 라우트로 이전)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> },
) {
  try {
    const session = await auth();

    if (!session || session.user?.role !== "admin") {
      return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
    }

    const { noteId } = await params;
    const numericNoteId = parseInt(noteId);
    const note = await request.json();

    const updated = await prisma.developNote.update({
      where: { noteId: numericNoteId },
      data: {
        title: note.title,
        mainCategory: note.mainCategory || null,
        subCategory: note.subCategory ?? null,
        level: note.level || "BEGINNER",
        content: note.content,
      },
    });

    revalidatePath("/note");
    if (updated.mainCategory) {
      revalidatePath(`/note/${updated.mainCategory}`);
    }

    return NextResponse.json({ success: true, note: updated });
  } catch (error) {
    console.error("노트 수정 오류:", error);

    return NextResponse.json(
      { success: false, message: "수정 실패" },
      { status: 500 },
    );
  }
}

// 노트 삭제 (기존 deleteOneEditorServer 서버 액션을 API 라우트로 이전)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> },
) {
  try {
    const session = await auth();

    if (!session || session.user?.role !== "admin") {
      return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
    }

    const { noteId } = await params;
    const numericNoteId = parseInt(noteId);

    await prisma.developNote.delete({ where: { noteId: numericNoteId } });

    revalidatePath("/note");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("노트 삭제 오류:", error);

    return NextResponse.json(
      { success: false, message: "삭제 실패" },
      { status: 500 },
    );
  }
}