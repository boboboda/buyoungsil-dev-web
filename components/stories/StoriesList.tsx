// 이야기 목록 (개발노트 '이야기' 탭에서 쓴다. 예전 /stories 목록 화면을 옮긴 것)
import { fetchAllStories } from "@/serverActions/stories";
import StoryCard from "@/components/stories/StoryCard";

export default async function StoriesList() {
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
    <div>
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
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
  );
}
