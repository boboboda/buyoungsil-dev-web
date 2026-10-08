import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fetchStoryBySlug } from "@/serverActions/stories";

// 글을 고치거나 올릴 때마다 바로 반영되도록, 이전에 만든 페이지를 재사용하지 않는다
export const dynamic = "force-dynamic";

interface StoryDetailPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export async function generateMetadata({ params }: StoryDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const story = await fetchStoryBySlug(slug);

  if (!story) {
    return {
      title: "이야기를 찾을 수 없습니다",
    };
  }

  return {
    title: story.metaTitle || `${story.title} | 비개발자 이야기`,
    description: story.metaDescription || story.excerpt || story.title,
    keywords: story.tags,
  };
}

export default async function StoryDetailPage({ params }: StoryDetailPageProps) {
  const { slug } = await params;
  const story = await fetchStoryBySlug(slug);

  if (!story) {
    notFound();
  }

  const categoryEmoji = {
    "삽질기": "😅",
    "꿀팁": "💡",
    "일상": "☕"
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* 뒤로가기 */}
      <Link 
        href="/stories" 
        className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-6"
      >
        ← 목록으로
      </Link>

      {/* 헤더 */}
      <article className="prose prose-lg dark:prose-invert max-w-none">
        <div className="mb-8">
          {/* 카테고리 */}
          <div className="mb-4">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              <span className="text-xl">{categoryEmoji[story.category]}</span>
              {story.category}
            </span>
          </div>

          {/* 제목 */}
          <h1 className="text-4xl font-bold mb-4">{story.title}</h1>

          {/* 메타 정보 */}
          <div className="flex items-center gap-6 text-gray-600 dark:text-gray-400 text-sm">
            <span>📅 {story.createdAt}</span>
            <span>👁️ {story.viewCount.toLocaleString()} views</span>
          </div>
        </div>

        {/* 태그 */}
        {story.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            {story.tags.map((tag, index) => (
              <span
                key={index}
                className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-sm text-gray-700 dark:text-gray-300"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* 내용 */}
        <div 
          className="mt-8"
          dangerouslySetInnerHTML={{ __html: story.content }}
        />
      </article>

      {/* 공유 & 댓글 (선택사항) */}
      <div className="mt-12 pt-8 border-t">
        <p className="text-center text-gray-600 dark:text-gray-400">
          이 글이 도움이 되셨나요? 궁금한 점이 있다면{" "}
          <a
            href="https://open.kakao.com/o/ss0BBmVb"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            카카오톡 오픈채팅
          </a>
          으로 문의해주세요!
        </p>
      </div>
    </div>
  );
}