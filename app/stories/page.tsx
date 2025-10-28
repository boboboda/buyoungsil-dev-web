import { Metadata } from "next";
import Link from "next/link";
import { fetchAllStories } from "@/serverActions/stories";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "비개발자 이야기 | 코딩천재 부영실",
  description: "비개발자 출신 개발자의 삽질기, 꿀팁, 일상 이야기를 공유합니다.",
  keywords: ["비개발자", "개발 입문", "프로그래밍 시작", "개발 삽질기", "개발 꿀팁"],
};

export default async function StoriesPage() {
  const stories = await fetchAllStories();

  // 카테고리별로 그룹화
  const categorized = {
    "삽질기": stories.filter(s => s.category === "삽질기"),
    "꿀팁": stories.filter(s => s.category === "꿀팁"),
    "일상": stories.filter(s => s.category === "일상")
  };

  const categoryEmoji = {
    "삽질기": "😅",
    "꿀팁": "💡",
    "일상": "☕"
  };

  const categoryDescription = {
    "삽질기": "개발하면서 겪은 시행착오와 실수들",
    "꿀팁": "개발 과정에서 발견한 유용한 팁들",
    "일상": "개발자의 일상과 생각들"
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* 헤더 */}
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold mb-4">😅 비개발자 이야기</h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          비전공자가 AI로 개발하면서 겪은 실제 경험담
        </p>
      </div>

      {/* 카테고리별 스토리 */}
      {Object.entries(categorized).map(([category, categoryStories]) => (
        <section key={category} className="mb-16">
          <div className="mb-6">
            <h2 className="text-3xl font-bold mb-2 flex items-center gap-3">
              <span className="text-4xl">{categoryEmoji[category as keyof typeof categoryEmoji]}</span>
              {category}
              <span className="text-sm font-normal text-gray-500">
                ({categoryStories.length})
              </span>
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              {categoryDescription[category as keyof typeof categoryDescription]}
            </p>
          </div>

          {categoryStories.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              아직 작성된 이야기가 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {categoryStories.map((story) => (
                <Link
                  key={story.id}
                  href={`/stories/${story.slug}`}
                  className="group"
                >
                  <article className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2 h-full flex flex-col">
                    {/* 카테고리 뱃지 */}
                    <div className="mb-3">
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                        {categoryEmoji[story.category]} {story.category}
                      </span>
                    </div>

                    {/* 제목 */}
                    <h3 className="text-xl font-bold mb-3 group-hover:text-blue-600 transition-colors line-clamp-2">
                      {story.title}
                    </h3>

                    {/* 요약 */}
                    {story.excerpt && (
                      <p className="text-gray-600 dark:text-gray-400 mb-4 line-clamp-3 flex-grow">
                        {story.excerpt}
                      </p>
                    )}

                    {/* 태그 */}
                    {story.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {story.tags.slice(0, 3).map((tag, index) => (
                          <span
                            key={index}
                            className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-400"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 메타 정보 */}
                    <div className="flex justify-between items-center text-sm text-gray-500 pt-4 border-t">
                      <span>👁️ {story.viewCount.toLocaleString()}</span>
                      <span>{story.createdAt}</span>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}