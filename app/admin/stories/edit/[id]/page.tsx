import { Metadata } from "next";
import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import StoryForm from "@/components/admin/stories/StoryForm";
import moment from "moment";

interface EditStoryPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const metadata: Metadata = {
  title: "스토리 수정 | 관리자",
};

export default async function EditStoryPage({ params }: EditStoryPageProps) {
  const { id } = await params;
  
  const story = await prisma.story.findUnique({
    where: { id }
  });

  if (!story) {
    notFound();
  }

  const formattedStory = {
    id: story.id,
    slug: story.slug,
    title: story.title,
    content: story.content,
    excerpt: story.excerpt,
    category: story.category as any,
    tags: story.tags as string[],
    isPublished: story.isPublished,
    metaTitle: story.metaTitle,
    metaDescription: story.metaDescription,
    viewCount: story.viewCount,
    createdAt: moment(story.createdAt).format("YYYY-MM-DD"),
    updatedAt: moment(story.updatedAt).format("YYYY-MM-DD")
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">✏️ 스토리 수정</h1>
      <StoryForm story={formattedStory} />
    </div>
  );
}