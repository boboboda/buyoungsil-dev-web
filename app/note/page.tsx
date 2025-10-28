// app/note/page.tsx
import { Metadata } from "next";
import { fetchPublishedCategories } from "@/serverActions/noteCategoryActions";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { noteCategoryInfo } from "@/types";

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
          // isPublished 체크 안함!
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {categoriesWithCount.map((category) => {
              const info = noteCategoryInfo[category.slug as keyof typeof noteCategoryInfo];
              
              return (
                <Link
                  key={category.id}
                  href={`/note/${category.slug}`}
                  className="group"
                >
                  <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-md hover:shadow-2xl transition-all duration-300 border-2 border-gray-100 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-400 h-full">
                    {/* 아이콘 */}
                    <div className="text-6xl mb-6">{category.icon}</div>
                    
                    {/* 카테고리 이름 */}
                    <h3 className="text-2xl font-bold mb-3 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {category.name}
                    </h3>
                    
                    {/* 설명 */}
                    <p className="text-gray-600 dark:text-gray-400 mb-6 line-clamp-2">
                      {category.description}
                    </p>
                    
                    {/* 태그 */}
                    {info && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {info.tags.map((tag, idx) => (
                          <span
                            key={idx}
                            className="text-xs px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    {/* 노트 개수 */}
                    <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
                      <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                        📝 {category.noteCount}개의 노트
                      </span>
                      <span className="text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        →
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
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