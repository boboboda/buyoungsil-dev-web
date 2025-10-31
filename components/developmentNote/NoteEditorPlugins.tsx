// components/developmentNote/NoteEditorPlugins.tsx
"use client";

import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot } from 'lexical';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { EditorState } from 'lexical';

import { Note } from "@/store/editorSotre";
import { NoteEditorType } from "@/types";
import { useNoteStore } from "@/components/providers/editor-provider";

interface NoteEditorPluginsProps {
  note?: Note;
  editorType: NoteEditorType;
  fetchNotes: Note[];
}

export default function NoteEditorPlugins({ 
  note, 
  editorType,
  fetchNotes 
}: NoteEditorPluginsProps) {
  const [editor] = useLexicalComposerContext();
  const { setContent, saveToLocal, setHasLocalChanges } = useNoteStore(
    (state) => state
  );

  // 에디터 상태 변경 감지
  const handleEditorChange = (editorState: EditorState) => {
    editorState.read(() => {
      const root = $getRoot();
      const json = editorState.toJSON();
      
      // Zustand store에 저장
      setContent({
        ...note,
        content: json,
      });
      
      setHasLocalChanges(true);
      
      // 로컬 스토리지에 자동 저장
      saveToLocal();
      
      console.log('Editor content changed:', json);
    });
  };

  return (
    <>
      <OnChangePlugin onChange={handleEditorChange} />
    </>
  );
}