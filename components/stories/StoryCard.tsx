"use client";

import Link from "next/link";
import { Story } from "@/types";
import { GradientCard } from "@/components/common/GradientCard";

interface StoryCardProps {
  story: Story;
  gradient?: string;
}

const categoryEmoji: Record<string, string> = {
  "삽질기": "😅",
  "꿀팁": "💡",
  "일상": "☕"
};

export default function StoryCard({ story, gradient = "from-blue-500 to-purple-500" }: StoryCardProps) {
  // 🔥 날짜 포맷 수정 (02025 문제 해결)
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  return (
    <Link href={`/stories/${story.slug}`} className="block w-full">  {/* ⭐ w-full 추가 */}
      <GradientCard
        isPressable
        gradient={gradient}
        className="hover:-translate-y-2 transition-transform h-[420px] flex flex-col w-full" 
      >
        {/* 카테고리 뱃지 */}
        <div className="mb-4 flex-shrink-0">
          <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium bg-gradient-to-r ${gradient} text-white`}>
            <span className="text-lg">{categoryEmoji[story.category]}</span>
            {story.category}
          </span>
        </div>

        {/* 제목 - 고정 높이 */}
        <h3 className="text-xl font-bold mb-3 group-hover:bg-gradient-to-r group-hover:from-blue-600 group-hover:to-purple-600 group-hover:bg-clip-text group-hover:text-transparent transition-all line-clamp-2 h-[56px] flex-shrink-0">
          {story.title}
        </h3>

        {/* 요약 - 고정 높이 */}
        <div className="mb-4 flex-grow">
          {story.excerpt ? (
            <p className="text-gray-600 dark:text-gray-400 line-clamp-4">
              {story.excerpt}
            </p>
          ) : (
            <p className="text-gray-400 italic">요약 없음</p>
          )}
        </div>

        {/* 태그 영역 - 고정 높이 */}
        <div className="flex flex-wrap gap-2 mb-4 h-[32px] overflow-hidden flex-shrink-0">
          {story.tags && story.tags.length > 0 ? (
            <>
              {story.tags.slice(0, 3).map((tag, index) => (
                <span
                  key={index}
                  className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-400 h-fit"
                >
                  #{tag}
                </span>
              ))}
              {story.tags.length > 3 && (
                <span className="text-xs text-gray-400 h-fit">
                  +{story.tags.length - 3}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-gray-400">태그 없음</span>
          )}
        </div>

        {/* 메타 정보 - 맨 아래 고정 */}
        <div className="flex justify-between items-center text-sm text-gray-500 border-t border-gray-200 dark:border-gray-700 pt-3 mt-auto flex-shrink-0">
          <span>👁️ {story.viewCount.toLocaleString()}</span>
          <span>{formatDate(story.createdAt)}</span>  {/* ⭐ 날짜 포맷 수정 */}
        </div>
      </GradientCard>
    </Link>
  );
}