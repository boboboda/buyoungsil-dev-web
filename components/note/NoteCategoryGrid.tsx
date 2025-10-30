"use client";

import Link from "next/link";
import { GradientCard } from "@/components/common/GradientCard";

interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  noteCount: number;
}

interface NoteCategoryInfo {
  tags: string[];
}

interface NoteCategoryGridProps {
  categories: Category[];
  categoryInfo: Record<string, NoteCategoryInfo>;
}

export default function NoteCategoryGrid({ 
  categories, 
  categoryInfo 
}: NoteCategoryGridProps) {
  // 카테고리별 gradient 설정
  const getCategoryGradient = (slug: string) => {
    const gradients: Record<string, string> = {
      'kotlin-compose': 'from-purple-500 to-pink-500',
      'swift-swiftui': 'from-blue-500 to-cyan-500',
      'flutter': 'from-blue-400 to-indigo-500',
      'nextjs-heroui': 'from-gray-800 to-gray-600',
      'react': 'from-cyan-500 to-blue-500',
      'nestjs-typescript': 'from-red-500 to-pink-500',
      'nodejs': 'from-green-500 to-emerald-500',
      'python-crawling': 'from-yellow-500 to-orange-500',
      'basics': 'from-indigo-500 to-purple-500',
    };
    return gradients[slug] || 'from-blue-600 to-purple-600';
  };

  return (
    // ⭐ grid-cols를 명확히 지정하면 각 열의 폭이 동일해집니다!
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
      {categories.map((category) => {
        const info = categoryInfo[category.slug];
        
        return (
          <Link
            key={category.id}
            href={`/note/${category.slug}`}
            className="block w-full"  // ⭐ w-full로 그리드 셀 전체 폭 사용
          >
            <GradientCard
              isPressable
              gradient={getCategoryGradient(category.slug)}
              className="hover:-translate-y-2 transition-transform w-full"  // ⭐ w-full 추가
            >
              {/* 아이콘 */}
              <div className="text-6xl mb-6">{category.icon}</div>
              
              {/* 카테고리 이름 */}
              <h3 className="text-2xl font-bold mb-3 group-hover:bg-gradient-to-r group-hover:from-blue-600 group-hover:to-purple-600 group-hover:bg-clip-text group-hover:text-transparent transition-all">
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
            </GradientCard>
          </Link>
        );
      })}
    </div>
  );
}