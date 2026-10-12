"use server";

import { revalidatePath } from "next/cache";
import moment from "moment";
import prisma from "@/lib/prisma";
import { assertAdmin } from "@/lib/auth/assertAdmin";
import type { Story, StoryCategory } from "@/types";
import { generateSlug } from "@/lib/utils/slugify"; // ⭐ 추가

// ========================================
// Stories CRUD
// ========================================

export async function fetchAllStories(): Promise<Story[]> {
  const stories = await prisma.story.findMany({
    where: { isPublished: true },
    orderBy: { createdAt: 'desc' }
  });

  return stories.map(story => ({
    id: story.id,
    slug: story.slug,
    title: story.title,
    content: story.content,
    excerpt: story.excerpt || "",
    category: story.category as StoryCategory,
    tags: story.tags as string[],
    isPublished: story.isPublished,
    metaTitle: story.metaTitle || "",
    metaDescription: story.metaDescription || "",
    viewCount: story.viewCount,
    createdAt: moment(story.createdAt).format("YYYY-MM-DD"),
    updatedAt: moment(story.updatedAt).format("YYYY-MM-DD")
  }));
}

export async function fetchStoryBySlug(slug: string): Promise<Story | null> {
  const story = await prisma.story.findUnique({
    where: { slug }
  });

  if (!story) return null;

  // 조회수 증가
  await prisma.story.update({
    where: { id: story.id },
    data: { viewCount: { increment: 1 } }
  });

  return {
    id: story.id,
    slug: story.slug,
    title: story.title,
    content: story.content,
    excerpt: story.excerpt || "",
    category: story.category as StoryCategory,
    tags: story.tags as string[],
    isPublished: story.isPublished,
    metaTitle: story.metaTitle || "",
    metaDescription: story.metaDescription || "",
    viewCount: story.viewCount + 1,
    createdAt: moment(story.createdAt).format("YYYY-MM-DD"),
    updatedAt: moment(story.updatedAt).format("YYYY-MM-DD")
  };
}

export async function fetchStoriesByCategory(category: StoryCategory): Promise<Story[]> {
  const stories = await prisma.story.findMany({
    where: {
      isPublished: true,
      category
    },
    orderBy: { createdAt: 'desc' }
  });

  return stories.map(story => ({
    id: story.id,
    slug: story.slug,
    title: story.title,
    content: story.content,
    excerpt: story.excerpt || "",
    category: story.category as StoryCategory,
    tags: story.tags as string[],
    isPublished: story.isPublished,
    metaTitle: story.metaTitle || "",
    metaDescription: story.metaDescription || "",
    viewCount: story.viewCount,
    createdAt: moment(story.createdAt).format("YYYY-MM-DD"),
    updatedAt: moment(story.updatedAt).format("YYYY-MM-DD")
  }));
}

// 🔥 관리자용 - 모든 스토리 (공개/비공개 포함)
export async function fetchAllStoriesAdmin() {
  await assertAdmin();
  const stories = await prisma.story.findMany({
    orderBy: { createdAt: 'desc' }
  });

  return stories.map(story => ({
    id: story.id,
    slug: story.slug,
    title: story.title,
    content: story.content,
    excerpt: story.excerpt || "",
    category: story.category as StoryCategory,
    tags: story.tags as string[],
    isPublished: story.isPublished,
    metaTitle: story.metaTitle || "",
    metaDescription: story.metaDescription || "",
    viewCount: story.viewCount,
    createdAt: moment(story.createdAt).format("YYYY-MM-DD"),
    updatedAt: moment(story.updatedAt).format("YYYY-MM-DD")
  }));
}

// ✅ 수정된 createStory 함수 - ID 기반 고유 slug 생성
export async function createStory(data: {
  title: string;
  content: string;
  excerpt?: string;
  category: StoryCategory;
  tags: string[];
  isPublished?: boolean;
  metaTitle?: string;
  metaDescription?: string;
}) {
  await assertAdmin();
  // 1단계: 임시 slug로 먼저 생성
  const story = await prisma.story.create({
    data: {
      slug: 'temp', // 임시 slug
      title: data.title,
      content: data.content,
      excerpt: data.excerpt,
      category: data.category,
      tags: data.tags,
      isPublished: data.isPublished || false,
      metaTitle: data.metaTitle,
      metaDescription: data.metaDescription,
      viewCount: 0
    }
  });

  // 2단계: ID를 사용하여 실제 slug 생성
  const finalSlug = generateSlug(data.title, story.id);

  // 3단계: slug 업데이트
  const updatedStory = await prisma.story.update({
    where: { id: story.id },
    data: { slug: finalSlug }
  });

  revalidatePath('/stories');
  revalidatePath('/admin/stories');
  
  return updatedStory;
}

export async function updateStory(id: string, data: Partial<{
  slug: string;
  title: string;
  content: string;
  excerpt: string;
  category: StoryCategory;
  tags: string[];
  isPublished: boolean;
  metaTitle: string;
  metaDescription: string;
}>) {
  await assertAdmin();
  const story = await prisma.story.update({
    where: { id },
    data: {
      ...data,
      updatedAt: new Date()
    }
  });

  revalidatePath('/stories');
  revalidatePath(`/stories/${story.slug}`);
  revalidatePath('/admin/stories');
  
  return story;
}

export async function deleteStory(id: string) {
  await assertAdmin();
  await prisma.story.delete({ where: { id } });
  revalidatePath('/stories');
  revalidatePath('/admin/stories');
}

export async function toggleStoryPublish(id: string) {
  await assertAdmin();
  const story = await prisma.story.findUnique({
    where: { id },
    select: { isPublished: true }
  });

  const updated = await prisma.story.update({
    where: { id },
    data: { isPublished: !story?.isPublished }
  });

  revalidatePath('/stories');
  revalidatePath('/admin/stories');
  
  return updated;
}