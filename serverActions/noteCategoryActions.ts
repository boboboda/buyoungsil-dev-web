// serverActions/noteCategoryActions.ts
"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

// 모든 카테고리 가져오기 (관리자용 - 비공개 포함)
export async function fetchAllCategories() {
  const categories = await prisma.noteCategory.findMany({
    orderBy: { order: "asc" }
  });
  return categories;
}

// 공개된 카테고리만 가져오기 (일반 사용자용)
export async function fetchPublishedCategories() {
  const categories = await prisma.noteCategory.findMany({
    where: { isPublished: true },
    orderBy: { order: "asc" }
  });
  return categories;
}

// 카테고리 생성
export async function createCategory(data: {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  order?: number;
  isPublished?: boolean;
}) {
  const category = await prisma.noteCategory.create({
    data: {
      slug: data.slug,
      name: data.name,
      description: data.description,
      icon: data.icon,
      order: data.order ?? 0,
      isPublished: data.isPublished ?? false
    }
  });

  revalidatePath("/note");
  revalidatePath("/admin/categories");
  return category;
}

// 카테고리 수정
export async function updateCategory(id: string, data: Partial<{
  name: string;
  description: string;
  icon: string;
  order: number;
  isPublished: boolean;
}>) {
  const category = await prisma.noteCategory.update({
    where: { id },
    data
  });

  revalidatePath("/note");
  revalidatePath("/admin/categories");
  return category;
}

// 카테고리 공개/비공개 토글
export async function toggleCategoryPublish(id: string) {
  const category = await prisma.noteCategory.findUnique({
    where: { id },
    select: { isPublished: true }
  });

  const updated = await prisma.noteCategory.update({
    where: { id },
    data: { isPublished: !category?.isPublished }
  });

  revalidatePath("/note");
  revalidatePath("/admin/categories");
  return updated;
}

// 카테고리 삭제
export async function deleteCategory(id: string) {
  await prisma.noteCategory.delete({
    where: { id }
  });

  revalidatePath("/note");
  revalidatePath("/admin/categories");
}

// 카테고리별 노트 개수 조회 (공개된 노트만)
export async function getCategoryNoteCounts() {
  const categories = await prisma.noteCategory.findMany({
    where: { isPublished: true },
    orderBy: { order: "asc" }
  });

  const countsPromises = categories.map(async (category) => {
    const count = await prisma.developNote.count({
      where: {
        mainCategory: category.slug,
        isPublished: true
      }
    });

    return {
      ...category,
      noteCount: count
    };
  });

  const categoriesWithCounts = await Promise.all(countsPromises);
  return categoriesWithCounts;
}