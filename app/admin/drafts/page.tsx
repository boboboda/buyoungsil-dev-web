import { Metadata } from "next";
import prisma from "@/lib/prisma";
import DraftInbox from "@/components/admin/drafts/DraftInbox";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "초안함 | 관리자",
};

export default async function AdminDraftsPage() {
  const [drafts, categories, subCategories] = await Promise.all([
    prisma.draft.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.noteCategory.findMany({
      orderBy: { order: "asc" },
      select: { slug: true, name: true },
    }),
    prisma.noteSubCategory.findMany({
      orderBy: { order: "asc" },
      select: { mainCategory: true, name: true },
    }),
  ]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">📥 초안함</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Claude 가 보낸 글 초안이에요. 보낼 곳을 고르면 비공개 글로 저장되고, 에디터에서 다듬은 뒤 공개하면 돼요.
        </p>
      </div>

      <DraftInbox
        drafts={drafts.map((d) => ({
          id: d.id,
          title: d.title,
          markdown: d.markdown,
          recommendedTarget: d.recommendedTarget,
          recommendedSection: d.recommendedSection,
          recommendedCategory: d.recommendedCategory,
          level: d.level,
          tags: d.tags,
          source: d.source,
          createdAt: d.createdAt.toISOString(),
        }))}
        categories={categories}
        subCategories={subCategories}
      />
    </div>
  );
}
