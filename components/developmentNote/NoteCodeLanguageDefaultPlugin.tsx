// components/developmentNote/NoteCodeLanguageDefaultPlugin.tsx
"use client";

import { useEffect } from "react";

import { useNoteStore } from "@/components/providers/editor-provider";
import { setDefaultCodeLanguage } from "@/components/editor/utils/defaultCodeLanguage";
import { getLanguageForCategory } from "@/components/editor/utils/categoryToCodeLanguage";

/**
 * 노트의 "메인 카테고리"가 바뀔 때마다, 앞으로 새로 만들어질 코드블록의
 * 기본 언어를 그 카테고리에 맞게 갱신한다. (예: kotlin-compose 글이면
 * 코드블록을 그냥 만들어도 'javascript'가 아니라 'kotlin'으로 시작)
 *
 * 실제 언어 지정은 $createCodeNode() 호출부(ToolbarPlugin/utils.ts,
 * ComponentPickerPlugin)에서 getDefaultCodeLanguage()를 읽어 처리한다.
 */
export default function NoteCodeLanguageDefaultPlugin() {
  const mainCategory = useNoteStore((state) => state.mainCategory);

  useEffect(() => {
    setDefaultCodeLanguage(getLanguageForCategory(mainCategory));

    // 언마운트 시 원복 — /editor 플레이그라운드 등 노트와 무관한 화면에
    // 영향이 남지 않도록 함
    return () => setDefaultCodeLanguage("javascript");
  }, [mainCategory]);

  return null;
}
