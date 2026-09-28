// components/editor/utils/categoryToCodeLanguage.ts
//
// 노트의 메인 카테고리 -> 코드블록 기본 언어 매핑.
// 여기 키는 CodeActionMenuPlugin/ToolbarPlugin의 언어 옵션(Prism 기준 값)과
// 맞춰뒀다. 카테고리를 추가하면 이 표에도 한 줄 추가해주면 된다.
import type { NoteCategory } from "@/types/index";

export const CATEGORY_DEFAULT_LANGUAGE: Record<NoteCategory, string> = {
  "kotlin-compose": "kotlin",
  "swift-swiftui": "swift",
  "flutter": "dart",
  "nextjs-heroui": "typescript",
  "react": "typescript",
  "nestjs-typescript": "typescript",
  "nodejs": "javascript",
  "python-crawling": "python",
  // 특정 언어에 종속되지 않는 일반 글: 거짓으로 특정 언어를 붙이지 않고 plain 유지
  "basics": "plain",
};

export function getLanguageForCategory(
  category?: NoteCategory | null,
): string {
  if (!category) return "javascript";
  return CATEGORY_DEFAULT_LANGUAGE[category] ?? "javascript";
}
