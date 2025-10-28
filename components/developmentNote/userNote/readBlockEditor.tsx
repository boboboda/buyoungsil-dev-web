"use client";
import { EditorContent } from "@tiptap/react";
import React, { useEffect, useRef, startTransition } from "react";

import { useBlockEditor } from "@/hooks/useBlockEditor";
import "@/styles/index.css";
import { Note } from "@/store/editorSotre";

export const ReadBlockEditor = ({ note }: { note?: Note }) => {
  const menuContainerRef = useRef(null);
  const { editor } = useBlockEditor({ clientID: "kim", readState: false });

  useEffect(() => {
    // 🔥 수정: editor와 note 모두 확인
    if (editor && note && note.content) {
      startTransition(() => {
        editor.commands.clearContent();
        editor.commands.setContent(note.content!);
      });
    }
  }, [editor, note]);

  // 🔥 수정: 에디터나 노트가 없을 때 로딩 표시
  if (!editor) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-gray-500">에디터를 불러오는 중...</div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-gray-500">노트를 불러오는 중...</div>
      </div>
    );
  }

  return (
    <div ref={menuContainerRef} className="flex h-full w-full">
      <div className="relative flex flex-col w-full h-full overflow-hidden">
        <EditorContent className="w-full" editor={editor} />
      </div>
    </div>
  );
};

export default ReadBlockEditor;
