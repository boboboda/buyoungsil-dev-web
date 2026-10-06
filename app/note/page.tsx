// app/note/page.tsx
import { Metadata } from "next";

import { getCategoryNoteCounts } from "@/serverActions/noteCategoryActions";
import NoteCategoryGrid from "@/components/note/NoteCategoryGrid";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "개발노트 | 코딩천재 부영실",
  description: "실전 개발 경험과 노하우를 기술 스택별로 정리한 개발노트입니다",
};

export default async function NotePage() {
  // 공개된 카테고리 + 각 카테고리의 공개된 글 개수
  // (카테고리 페이지에도 공개된 글만 보이므로 개수가 서로 맞는다)
  const categories = await getCategoryNoteCounts();

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto max-w-7xl px-4 py-16">
        {/* 헤더 */}
        <div className="mb-16 text-center">
          <h1 className="mb-4 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-5xl font-bold text-transparent">
            📚 개발노트
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400">
            실전 개발 경험과 노하우를 기술 스택별로 정리했습니다
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-500">
            💡 레벨별 접근: 🟢초급(전체) 🟡중급(회원) 🔴고급(후원자)
          </p>
        </div>

        {/* 카테고리 그리드 */}
        {categories.length > 0 ? (
          <NoteCategoryGrid categories={categories} />
        ) : (
          <div className="py-20 text-center">
            <div className="mb-4 text-6xl">📭</div>
            <h3 className="mb-2 text-2xl font-bold text-gray-700 dark:text-gray-300">
              준비 중입니다
            </h3>
            <p className="text-gray-500 dark:text-gray-400">
              곧 유익한 개발 노트로 찾아뵙겠습니다!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}