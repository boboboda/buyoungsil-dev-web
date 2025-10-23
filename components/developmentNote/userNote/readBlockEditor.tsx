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
    if (editor && note) {
      // startTransition으로 우선순위가 낮은 업데이트로 처리
      startTransition(() => {
        editor.commands.clearContent();
        editor.commands.setContent(note.content!);
      });
    }
  }, [editor, note]);

  if (!editor) {
    return null; // 또는 원하는 로딩 인디케이터를 여기에 넣으세요
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
