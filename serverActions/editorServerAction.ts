"use server"

import prisma from "@/lib/prisma"
import { Note } from "@/store/editorSotre"
import { cache } from 'react';

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
        subCategory: JSON.parse(JSON.stringify(note.subCategory)) || null,
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

export const allFetchEdtiorServer = cache(async () => {
  console.log("에디터서버 db 로드 실행")

  try {
    console.time('서버')
    
    // 모든 노트 조회
    const notes = await prisma.developNote.findMany({
      orderBy: {
        noteId: 'asc'
      }
    })

    console.timeEnd('서버')
    
    return JSON.stringify(notes)
  } catch (error) {
    console.error('db 에러', error)
    throw error
  }
})

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
        subCategory: note.subCategory || null,
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