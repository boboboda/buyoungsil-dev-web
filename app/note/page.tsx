// app/note/page.tsx
import { Metadata } from "next";
import { fetchPublishedCategories } from "@/serverActions/noteCategoryActions";
import prisma from "@/lib/prisma";
import { noteCategoryInfo } from "@/types";
import NoteCategoryGrid from "@/components/note/NoteCategoryGrid";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "개발노트 | 코딩천재 부영실",
  description: "실전 개발 경험과 노하우를 기술 스택별로 정리한 개발노트입니다",
};

export default async function NotePage() {
  // 🔥 공개된 카테고리만 가져오기 (isPublished: true)
  const publishedCategories = await fetchPublishedCategories();

  // 🔥 각 카테고리별 전체 노트 개수 (isPublished 무관)
  const categoriesWithCount = await Promise.all(
    publishedCategories.map(async (category) => {
      const noteCount = await prisma.developNote.count({
        where: {
          mainCategory: category.slug
        }
      });

      return {
        ...category,
        noteCount
      };
    })
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-16 max-w-7xl">
        {/* 헤더 */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            📚 개발노트
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400">
            실전 개발 경험과 노하우를 기술 스택별로 정리했습니다
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
            💡 레벨별 접근: 🟢초급(전체) 🟡중급(회원) 🔴고급(후원자)
          </p>
        </div>

        {/* 카테고리 그리드 */}
        {publishedCategories.length > 0 ? (
          <NoteCategoryGrid 
            categories={categoriesWithCount}
            categoryInfo={noteCategoryInfo}
          />
        ) : (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📭</div>
            <h3 className="text-2xl font-bold text-gray-700 dark:text-gray-300 mb-2">
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