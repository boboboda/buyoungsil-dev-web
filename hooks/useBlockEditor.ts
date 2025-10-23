"use client";

import type { AnyExtension, Editor } from "@tiptap/core";

import { useEditor } from "@tiptap/react";
import { debounce } from "lodash";

import { ExtensionKit } from "@/lib/extensions/extension-kit";
import { useNoteStore } from "@/components/providers/editor-provider";

declare global {
  interface Window {
    editor: Editor | null;
  }
}

export const useBlockEditor = ({
  clientID,
  readState,
}: {
  clientID: string;
  readState: boolean;
}) => {
  // 에디터를 초기화하는 훅

  let { setContent, saveToLocal, content } = useNoteStore((state) => state);

  const debouncedUpdate = debounce((editor) => {
    setContent({ content: editor.getJSON() });

    saveToLocal();
  }, 500);

  const editor = useEditor({
    immediatelyRender: true, // 즉시 렌더링 여부
    shouldRerenderOnTransaction: false, // 트랜잭션마다 재렌더링 여부
    autofocus: true, // 자동 포커스
    editable: readState,
    onCreate: (ctx) => {
      // 에디터가 비어있는지 확인 후, 초기 콘텐츠 설정
      if (ctx.editor.isEmpty) {
        ctx.editor.commands.setContent(content);
        ctx.editor.commands.focus("start", { scrollIntoView: true });
      }
    },
    onUpdate: (ctx) => {
      if (readState) {
        debouncedUpdate(ctx.editor);
      }
    },
    extensions: [
      ...ExtensionKit({
        clientID,
      }),
    ].filter((e) => e !== undefined) as AnyExtension[], // 타입 단언으로 변경
    editorProps: {
      attributes: {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
      },
    },
  });

  // 에디터 객체를 전역 window 객체에 저장하여 개발 중에도 접근 가능하게 만듦
  window.editor = editor;

  // 에디터 반환
  return { editor };
};