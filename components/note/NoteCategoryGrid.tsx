// components/note/NoteCategoryGrid.tsx
"use client";

import Link from "next/link";

import { GradientCard } from "@/components/common/GradientCard";
import { getGradientClasses } from "@/lib/note/categoryUtils";

interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  gradient: string | null;
  imageUrl: string | null;
  tags: string[];
  noteCount: number;
}

interface NoteCategoryGridProps {
  categories: Category[];
}

export default function NoteCategoryGrid({ categories }: NoteCategoryGridProps) {
  return (
    // grid-cols 를 명확히 지정하면 각 열의 폭이 동일해집니다
    <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
      {categories.map((category) => {
        const gradient = getGradientClasses(category.gradient);

        return (
          <Link
            key={category.id}
            className="block w-full"
            href={`/note/${category.slug}`}
          >
            <GradientCard
              isPressable
              className="w-full transition-transform hover:-translate-y-2"
              gradient={gradient}
            >
              {/* 대표 이미지 (없으면 아이콘) */}
              {category.imageUrl ? (
                <div className="-mx-3 -mt-3 mb-5 overflow-hidden rounded-t-xl bg-white/80 dark:bg-gray-900/50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={`${category.name} 대표 이미지`}
                    className="aspect-video w-full object-contain p-3"
                    loading="lazy"
                    src={category.imageUrl}
                  />
                </div>
              ) : (
                <div className="mb-6 text-6xl">{category.icon}</div>
              )}

              {/* 카테고리 이름 */}
              <h3 className="mb-3 text-2xl font-bold transition-all">
                {category.imageUrl && (
                  <span className="mr-2">{category.icon}</span>
                )}
                {category.name}
              </h3>

              {/* 설명 */}
              <p className="mb-6 line-clamp-2 text-gray-600 dark:text-gray-400">
                {category.description}
              </p>

              {/* 태그 */}
              {category.tags.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {category.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* 노트 개수 */}
              <div className="flex items-center justify-between border-t border-gray-200 pt-4 dark:border-gray-700">
                <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                  📝 {category.noteCount}개의 노트
                </span>
                <span className="text-gray-400 transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
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