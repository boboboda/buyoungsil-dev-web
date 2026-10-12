"use server"

import { NoteLevel } from "@/components/developmentNote/NoteEditorHeader";
import prisma from "@/lib/prisma"
import { Note } from "@/store/editorSotre"
import { NoteCategory } from "@/types";
import moment from "moment";
import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/assertAdmin";

export async function findOneEditorServer(noteId: string) {
  await assertAdmin();
  try {
    const numbericNoteId = parseInt(noteId)

    // 특정 노트 조회
    const note = await prisma.developNote.findUnique({
      where: { noteId: numbericNoteId }
    })

    if (!note) {
      return null
    }

    return JSON.stringify(note)
  } catch (error) {
    console.error('db 에러', error)
    throw error
  }
}


// 🔥 추가: 모든 개발노트 가져오기 (공개된 것만)
export async function fetchAllDevelopNotes(): Promise<Note[]> {
  const notes = await prisma.developNote.findMany({
    where: {
      isPublished: true
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  return notes.map(note => {
    // Json 타입을 파싱
    let subCategory = null;
    if (note.subCategory) {
      try {
        const parsed = typeof note.subCategory === 'string' 
          ? JSON.parse(note.subCategory) 
          : note.subCategory;
        subCategory = parsed;
      } catch (e) {
        subCategory = null;
      }
    }

    return {
      noteId: note.noteId,
      title: note.title || null,
      mainCategory: note.mainCategory as NoteCategory, // 🔥 타입 캐스팅
      subCategory: subCategory,
      level: note.level as NoteLevel, // 🔥 타입 캐스팅
      content: note.content as any, // 🔥 타입 캐스팅
      isPublished: note.isPublished,
      metaTitle: note.metaTitle || null,
      metaDescription: note.metaDescription || null,
      createdAt: moment(note.createdAt).format("YYYY-MM-DD"),
      updatedAt: moment(note.updatedAt).format("YYYY-MM-DD")
    };
  });
}

// 공개된 노트만 가져오기 (일반 사용자용)
export async function fetchPublishedNotes(): Promise<string> {
  const notes = await prisma.developNote.findMany({
    where: { isPublished: true },
    orderBy: { noteId: "asc" }
  });
  return JSON.stringify(notes);
}

// 노트 ID로 단일 노트 가져오기
export async function fetchNoteById(noteId: number) {
  await assertAdmin();
  const note = await prisma.developNote.findUnique({
    where: { noteId }
  });
  return note;
}


// serverActions/editorServerAction.ts

// ... 기존 코드 ...

// 🔥 노트 공개/비공개 토글
export async function toggleNotePublish(noteId: number) {
  "use server";
  await assertAdmin();
  
  try {
    const note = await prisma.developNote.findUnique({
      where: { noteId },
      select: { isPublished: true }
    });

    if (!note) {
      throw new Error("노트를 찾을 수 없습니다");
    }

    const updated = await prisma.developNote.update({
      where: { noteId },
      data: { isPublished: !note.isPublished }
    });

    revalidatePath("/note");
    revalidatePath("/admin/notes");

    return updated;
  } catch (error) {
    console.error("Toggle note publish error:", error);
    throw error;
  }

  
}

// 🔥 새로 추가: 관리자용 (모든 노트 가져오기)
export async function allFetchEditorServerAdmin() {
  await assertAdmin();
  const notes = await prisma.developNote.findMany({
    orderBy: {
      noteId: "desc"  // 최신순으로 정렬
    }
  });
  
  return JSON.stringify(notes);
}

// 기존 함수 유지 (일반 사용자용)
export async function allFetchEdtiorServer() {
  const notes = await prisma.developNote.findMany({
    where: {
      isPublished: true
    },
    orderBy: {
      noteId: "asc"
    }
  });
  
  return JSON.stringify(notes);
}
