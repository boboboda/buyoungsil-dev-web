"use server";

import { revalidatePath } from "next/cache";
import moment from "moment";
import prisma from "@/lib/prisma";
import type { Story, StoryCategory } from "@/types";

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
    excerpt: story.excerpt,
    category: story.category as StoryCategory,
    tags: story.tags as string[],
    isPublished: story.isPublished,
    metaTitle: story.metaTitle,
    metaDescription: story.metaDescription,
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
    excerpt: story.excerpt,
    category: story.category as StoryCategory,
    tags: story.tags as string[],
    isPublished: story.isPublished,
    metaTitle: story.metaTitle,
    metaDescription: story.metaDescription,
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
    excerpt: story.excerpt,
    category: story.category as StoryCategory,
    tags: story.tags as string[],
    isPublished: story.isPublished,
    metaTitle: story.metaTitle,
    metaDescription: story.metaDescription,
    viewCount: story.viewCount,
    createdAt: moment(story.createdAt).format("YYYY-MM-DD"),
    updatedAt: moment(story.updatedAt).format("YYYY-MM-DD")
  }));
}

export async function createStory(data: {
  slug: string;
  title: string;
  content: string;
  excerpt?: string;
  category: string;
  tags: string[];
  isPublished?: boolean;
  metaTitle?: string;
  metaDescription?: string;
}) {
  const story = await prisma.story.create({
    data: {
      ...data,
      tags: data.tags,
      isPublished: data.isPublished || false,
      viewCount: 0
    }
  });

  revalidatePath('/stories');
  return story;
}

export async function updateStory(id: string, data: any) {
  const story = await prisma.story.update({
    where: { id },
    data
  });

  revalidatePath('/stories');
  revalidatePath(`/stories/${story.slug}`);
  return story;
}

export async function deleteStory(id: string) {
  await prisma.story.delete({ where: { id } });
  revalidatePath('/stories');
}

export async function toggleStoryPublish(id: string) {
  const story = await prisma.story.findUnique({
    where: { id },
    select: { isPublished: true }
  });

  const updated = await prisma.story.update({
    where: { id },
    data: { isPublished: !story?.isPublished }
  });

  revalidatePath('/stories');
  return updated;
}