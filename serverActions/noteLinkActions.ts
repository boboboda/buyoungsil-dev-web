// serverActions/noteLinkActions.ts
"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth/get-sesstion";

export interface NoteLinkOption {
  noteId: number;
  title: string;
  mainCategory: string;
  isPublished: boolean;
}

// 글쓰기 화면에서 "연결할 글"을 고를 때 쓰는 목록 (관리자 전용, 비공개 글 포함)
export async function fetchNoteLinkOptions(): Promise<NoteLinkOption[]> {
  const session = await auth();

  if (!session || session.user?.role !== "admin") {
    return [];
  }

  const notes = await prisma.developNote.findMany({
    where: { mainCategory: { not: null } },
    orderBy: { noteId: "desc" },
    select: {
      noteId: true,
      title: true,
      mainCategory: true,
      isPublished: true,
    },
  });

  return notes.map((note) => ({
    noteId: note.noteId,
    title: note.title || "(제목 없음)",
    mainCategory: note.mainCategory as string,
    isPublished: note.isPublished,
  }));
}