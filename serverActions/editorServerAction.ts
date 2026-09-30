"use server"

import { NoteLevel } from "@/components/developmentNote/NoteEditorHeader";
import prisma from "@/lib/prisma"
import { Note } from "@/store/editorSotre"
import { NoteCategory } from "@/types";
import moment from "moment";
import { revalidatePath } from "next/cache";
import { cache } from 'react';
import { Prisma } from "@prisma/client";

// Json 컬럼에 null 을 그대로 넣으면 Prisma 가 오류를 내므로 Prisma.DbNull 로 바꿔서 저장한다.
function toJsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!value) return Prisma.DbNull;

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function addEdtiorServer(reqData: string) {
  console.log("에디터서버 db 추가 실행")

  const note: Note = JSON.parse(reqData)
  
  try {
    // 노트 ID로 기존 문서 검색
    const existingNote = await prisma.developNote.findUnique({
      where: { noteId: note.noteId! }
    })

    if (existingNote) {
      throw new Error('이미 존재하는 문서입니다.')
    }

    // 새 노트 생성
    const result = await prisma.developNote.create({
      data: {
        noteId: note.noteId!,
        title: note.title,
        mainCategory: note.mainCategory || null,
        subCategory: toJsonOrDbNull(note.subCategory),
        level: note.level || 'BEGINNER',
        content: note.content
      }
    })

    return { success: true }
  } catch (error) {
    console.error('db 에러', error)
    return { success: false }
  }
}


export async function findOneEditorServer(noteId: string) {
  try {
    const numbericNoteId = parseInt(noteId)

    // 특정 노트 조회
    const note = await prisma.developNote.findUnique({
      where: { noteId: numbericNoteId }
    })

    console.log('server one data', note)

    if (!note) {
      return null
    }

    return JSON.stringify(note)
  } catch (error) {
    console.error('db 에러', error)
    throw error
  }
}

export async function findOneAndUpdateEditorServer(noteId: string, reqData: string) {
  try {
    const numbericNoteId = parseInt(noteId)
    const note = JSON.parse(reqData)

    console.log("노트아이디", numbericNoteId)

    // 노트 업데이트
    const updatedNote = await prisma.developNote.update({
      where: { noteId: numbericNoteId },
      data: {
        title: note.title,
        mainCategory: note.mainCategory || null,
        subCategory: toJsonOrDbNull(note.subCategory),
        level: note.level || 'BEGINNER',
        content: note.content
      }
    })

    console.log('update one data', updatedNote)

    return { success: true }
  } catch (error) {
    console.error('db 에러', error)
    return { success: false }
  }
}

export async function deleteOneEditorServer(noteId: string) {
  try {
    const numbericNoteId = parseInt(noteId)
    
    console.log("노트아이디", numbericNoteId)

    // 노트 삭제
    const result = await prisma.developNote.delete({
      where: { noteId: numbericNoteId }
    })

    console.log('delete one data', result)

    return { success: true }
  } catch (error) {
    console.error('db 에러', error)
    return { success: false }
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

export async function getMaxNoteId() {
  "use server";
  
  const maxNote = await prisma.developNote.findFirst({
    orderBy: {
      noteId: 'desc'  // 내림차순으로 정렬
    },
    select: {
      noteId: true
    }
  });
  
  return maxNote?.noteId || 0;
}