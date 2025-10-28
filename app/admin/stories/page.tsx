import { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/prisma";
import StoryListTable from "@/components/admin/stories/StoryListTable";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "스토리 관리 | 관리자",
};

export default async function AdminStoriesPage() {
  // 모든 스토리 가져오기 (공개/비공개 모두)
  const stories = await prisma.story.findMany({
    orderBy: { createdAt: 'desc' }
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">📝 스토리 관리</h1>
          <p className="text-gray-600 dark:text-gray-400">
            비개발자 이야기를 작성하고 관리합니다
          </p>
        </div>
        <Link
          href="/admin/stories/create"
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          + 새 스토리 작성
        </Link>
      </div>

      <StoryListTable stories={stories} />
    </div>
  );
}