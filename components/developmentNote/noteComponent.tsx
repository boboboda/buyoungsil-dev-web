// components/developmentNote/noteComponent.tsx
"use client";

import { useState, useEffect } from "react";
import dynamic from 'next/dynamic';

import { NoteEditorType } from "@/types";
import { Note } from "@/store/editorSotre";
import { allFetchEdtiorServer } from "@/serverActions/editorServerAction";
import { SettingsContext } from '@/components/editor/context/SettingsContext';
import { FlashMessageContext } from '@/components/editor/context/FlashMessageContext';

// NoteEditor 동적 import로 SSR 방지
const NoteEditorApp = dynamic(() => import('./NoteEditorApp'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <div className="text-gray-500">에디터를 불러오는 중...</div>
    </div>
  )
});

export default function NoteComponent({
  editNote,
  editorType,
}: {
  editNote?: Note;
  editorType: NoteEditorType;
}) {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const noteRes = await allFetchEdtiorServer();
      const notes = JSON.parse(noteRes);
      setNotes(notes);
    };

    fetchData();
  }, []);

  return (
    <div className="w-full">
      <SettingsContext>
        <FlashMessageContext>
          <NoteEditorApp 
            editorType={editorType} 
            fetchNotes={notes} 
            note={editNote} 
          />
        </FlashMessageContext>
      </SettingsContext>
    </div>
  );
}