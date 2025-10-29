import { Metadata } from "next";
import Link from "next/link";
import { fetchAllStories } from "@/serverActions/stories";
import { PageHero } from "@/components/common/PageHero";
import StoryCard from "@/components/stories/StoryCard";

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

  const categoryGradient = {
    "삽질기": "from-orange-500 to-red-500",
    "꿀팁": "from-yellow-500 to-orange-500",
    "일상": "from-blue-500 to-purple-500"
  };

  return (
    <div className="w-full">
      {/* Hero 섹션 */}
      <PageHero
        icon="😅"
        title="비개발자 이야기"
        description="비전공자가 AI로 개발하면서 겪은 실제 경험담"
        gradient="from-orange-500 to-pink-500"
      />

      <div className="container mx-auto px-4 py-12 max-w-7xl">
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
              <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-8">
                {categoryStories.map((story) => (
                  <StoryCard 
                    key={story.id} 
                    story={story}
                    gradient={categoryGradient[category as keyof typeof categoryGradient]}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}