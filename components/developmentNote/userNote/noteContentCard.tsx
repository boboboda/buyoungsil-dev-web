"use client";

import { Card, Image } from "@heroui/react";
import { useRouter } from "next/navigation";

interface CategoryItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string;
  topics: string[];
  noteCount: number;
  order: number;
  isPublished: boolean;
}

interface DynamicNoteContentCardProps {
  categories: CategoryItem[];
}

export default function DynamicNoteContentCard({ categories }: DynamicNoteContentCardProps) {
  const router = useRouter();

  // 🔥 공개된 카테고리만 필터링 + 정렬
  const visibleCategories = categories
    .filter(cat => cat.isPublished)
    .sort((a, b) => a.order - b.order);

  return (
    <div className="max-w-[1000px] px-4 mt-[20px]">
      <div className="w-full gap-3 grid grid-cols-12 grid-rows-2">
        {visibleCategories.map((category, index) => {
          // 🔥 첫 번째 카드는 col-span-12 (전체 너비)
          const isFirst = index === 0;
          const colSpan = isFirst ? "col-span-12" : getColSpan(index);

          return (
            <Card
              key={category.id}
              isPressable
              className={`custom-shadow ${colSpan} h-[250px] bg-slate-800 hover:cursor-pointer hover:bg-gray-600 flex justify-start gap-4 pt-2`}
              onClick={() => router.push(`/note/${category.slug}`)}
            >
              {/* 제목 */}
              <div className="flex w-full h-[50px] items-center justify-center">
                <h4 className="text-white font-medium md:text-[24px] text-[20px]">
                  {category.name}
                </h4>
              </div>

              {/* 내용 */}
              <div className="flex flex-row h-full">
                {/* 이미지 */}
                <div className={`flex ${isFirst ? 'w-[50%]' : 'md:w-[45%] w-[40%]'} items-center justify-center ${isFirst ? 'justify-end me-10' : ''}`}>
                  <Image
                    removeWrapper
                    alt={`${category.name} 로고`}
                    className={`object-contain ${isFirst ? 'md:w-[200px] w-[150px]' : 'md:w-[70%] w-[80%]'}`}
                    src={category.imageUrl || '/default-category.png'}
                  />
                </div>

                {/* 토픽 리스트 */}
                <div className={`flex flex-col ${isFirst ? 'w-[50%]' : 'md:w-[55%] w-[60%]'} h-full mt-[5px] justify-start gap-2 pe-2`}>
                  {category.topics.slice(0, 5).map((topic, idx) => (
                    <h4
                      key={idx}
                      className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left"
                    >
                      {idx + 1}. {topic}
                    </h4>
                  ))}
                  
                  {/* 노트 개수 표시 */}
                  {category.noteCount > 0 && (
                    <p className="text-gray-400 text-xs ms-2 mt-auto">
                      📝 {category.noteCount}개의 노트
                    </p>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// 🔥 반응형 col-span 계산
function getColSpan(index: number): string {
  // 첫 번째는 이미 col-span-12로 처리됨
  // 2번째 카드부터 계산
  const adjustedIndex = index - 1;
  
  // 2번째, 3번째 → col-span-6 (PC에서 반반)
  if (adjustedIndex < 2) {
    return "col-span-12 sm:col-span-6";
  }
  
  // 4번째 → col-span-8 (PC에서 2/3)
  if (adjustedIndex === 2) {
    return "col-span-12 sm:col-span-8";
  }
  
  // 5번째 → col-span-4 (PC에서 1/3)
  return "col-span-12 sm:col-span-4";
}