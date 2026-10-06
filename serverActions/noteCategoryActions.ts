// serverActions/noteCategoryActions.ts
"use server";

import { revalidatePath } from "next/cache";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth/get-sesstion";
import {
  CATEGORY_LIMITS,
  GRADIENT_KEYS,
  PLATFORM_VALUES,
  RESERVED_SLUGS,
  SLUG_PATTERN,
  parseList,
} from "@/lib/note/categoryUtils";

// 관리자 화면에서 보내는 카테고리 입력값
export interface CategoryInput {
  slug?: string; // 추가할 때만 사용 (수정할 때는 바꿀 수 없음)
  name: string;
  description: string;
  icon: string;
  platform: string | null;
  gradient: string | null;
  imageUrl: string | null;
  tags: string[];
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string[];
  order?: number;
  isPublished?: boolean;
}

export interface CategoryResult {
  success: boolean;
  error?: string;
}

export interface CategoryOption {
  slug: string;
  name: string;
  icon: string;
}

async function requireAdmin(): Promise<boolean> {
  const session = await auth();

  return session?.user?.role === "admin";
}

function revalidateCategory(slug?: string) {
  revalidatePath("/note");
  revalidatePath("/admin/categories");
  if (slug) revalidatePath(`/note/${slug}`);
}

// 입력값 검증 + 정리. 문제가 있으면 error 문구를 돌려준다.
function normalize(input: CategoryInput):
  | { error: string }
  | {
      data: {
        name: string;
        description: string;
        icon: string;
        platform: string | null;
        gradient: string | null;
        imageUrl: string | null;
        tags: string[];
        metaTitle: string | null;
        metaDescription: string | null;
        metaKeywords: string[];
      };
    } {
  const L = CATEGORY_LIMITS;

  const name = (input.name ?? "").trim().replace(/\s+/g, " ");

  if (!name) return { error: "카테고리 이름을 입력해주세요." };
  if (name.length > L.name) {
    return { error: `이름은 ${L.name}자 이하로 입력해주세요.` };
  }

  const description = (input.description ?? "").trim();

  if (description.length > L.description) {
    return { error: `설명은 ${L.description}자 이하로 입력해주세요.` };
  }

  const icon = (input.icon ?? "").trim();

  if (!icon) return { error: "아이콘(이모지)을 입력해주세요." };
  if ([...icon].length > L.icon) {
    return { error: "아이콘은 이모지 1~2개만 입력해주세요." };
  }

  const platform = input.platform || null;

  if (platform && !PLATFORM_VALUES.includes(platform)) {
    return { error: "올바르지 않은 플랫폼입니다." };
  }

  const gradient = input.gradient || null;

  if (gradient && !GRADIENT_KEYS.includes(gradient)) {
    return { error: "올바르지 않은 색상입니다." };
  }

  const imageUrl = (input.imageUrl ?? "").trim() || null;

  if (imageUrl) {
    const okPrefix = imageUrl.startsWith("https://") || imageUrl.startsWith("/");

    if (!okPrefix || imageUrl.length > L.imageUrl) {
      return { error: "이미지 주소가 올바르지 않습니다." };
    }
  }

  const metaTitle = (input.metaTitle ?? "").trim() || null;

  if (metaTitle && metaTitle.length > L.metaTitle) {
    return { error: `SEO 제목은 ${L.metaTitle}자 이하로 입력해주세요.` };
  }

  const metaDescription = (input.metaDescription ?? "").trim() || null;

  if (metaDescription && metaDescription.length > L.metaDescription) {
    return {
      error: `SEO 설명은 ${L.metaDescription}자 이하로 입력해주세요.`,
    };
  }

  return {
    data: {
      name,
      description,
      icon,
      platform,
      gradient,
      imageUrl,
      tags: parseList(input.tags, L.tags, L.tag),
      metaTitle,
      metaDescription,
      metaKeywords: parseList(input.metaKeywords, L.metaKeywords, L.metaKeyword),
    },
  };
}

// 모든 카테고리 가져오기 (관리자용 - 비공개 포함)
export async function fetchAllCategories() {
  return prisma.noteCategory.findMany({
    orderBy: { order: "asc" },
  });
}

// 공개된 카테고리만 가져오기 (일반 사용자용)
export async function fetchPublishedCategories() {
  return prisma.noteCategory.findMany({
    where: { isPublished: true },
    orderBy: { order: "asc" },
  });
}

// 글쓰기 화면의 "메인 카테고리" 선택 목록 (비공개 카테고리에도 글을 쓸 수 있어야 하므로 전체)
export async function fetchCategoryOptions(): Promise<CategoryOption[]> {
  if (!(await requireAdmin())) return [];

  const rows = await prisma.noteCategory.findMany({
    orderBy: { order: "asc" },
    select: { slug: true, name: true, icon: true },
  });

  return rows;
}

// 카테고리 추가
export async function createCategory(
  input: CategoryInput,
): Promise<CategoryResult> {
  if (!(await requireAdmin())) {
    return { success: false, error: "권한이 없습니다." };
  }

  const slug = (input.slug ?? "").trim().toLowerCase();

  if (!slug) return { success: false, error: "슬러그를 입력해주세요." };
  if (slug.length > CATEGORY_LIMITS.slug) {
    return {
      success: false,
      error: `슬러그는 ${CATEGORY_LIMITS.slug}자 이하로 입력해주세요.`,
    };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return {
      success: false,
      error: "슬러그는 영문 소문자, 숫자, 하이픈(-)만 쓸 수 있습니다. 예: kotlin-compose",
    };
  }
  if (RESERVED_SLUGS.includes(slug)) {
    return { success: false, error: `'${slug}'는 사용할 수 없는 슬러그입니다.` };
  }

  const parsed = normalize(input);

  if ("error" in parsed) return { success: false, error: parsed.error };

  try {
    const exists = await prisma.noteCategory.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (exists) {
      return { success: false, error: "이미 같은 슬러그의 카테고리가 있습니다." };
    }

    let order = input.order;

    if (order === undefined || Number.isNaN(order)) {
      const last = await prisma.noteCategory.aggregate({ _max: { order: true } });

      order = (last._max.order ?? 0) + 1;
    }

    await prisma.noteCategory.create({
      data: {
        slug,
        ...parsed.data,
        order,
        // 글이 쌓이기 전에는 비공개로 시작하는 것이 기본
        isPublished: input.isPublished ?? false,
      },
    });

    revalidateCategory(slug);

    return { success: true };
  } catch (error) {
    console.error("[createCategory] 실패:", error);

    return { success: false, error: "카테고리 저장 중 오류가 발생했습니다." };
  }
}

// 카테고리 수정 (슬러그는 글과 주소가 연결돼 있어 바꿀 수 없다)
export async function updateCategory(
  id: string,
  input: CategoryInput,
): Promise<CategoryResult> {
  if (!(await requireAdmin())) {
    return { success: false, error: "권한이 없습니다." };
  }

  const parsed = normalize(input);

  if ("error" in parsed) return { success: false, error: parsed.error };

  try {
    const current = await prisma.noteCategory.findUnique({
      where: { id },
      select: { slug: true },
    });

    if (!current) return { success: false, error: "카테고리를 찾을 수 없습니다." };

    await prisma.noteCategory.update({
      where: { id },
      data: {
        ...parsed.data,
        ...(input.order !== undefined && !Number.isNaN(input.order)
          ? { order: input.order }
          : {}),
        ...(input.isPublished !== undefined
          ? { isPublished: input.isPublished }
          : {}),
      },
    });

    revalidateCategory(current.slug);

    return { success: true };
  } catch (error) {
    console.error("[updateCategory] 실패:", error);

    return { success: false, error: "카테고리 수정 중 오류가 발생했습니다." };
  }
}

// 카테고리 공개/비공개 토글
export async function toggleCategoryPublish(id: string) {
  if (!(await requireAdmin())) {
    throw new Error("권한이 없습니다.");
  }

  const category = await prisma.noteCategory.findUnique({
    where: { id },
    select: { isPublished: true, slug: true },
  });

  const updated = await prisma.noteCategory.update({
    where: { id },
    data: { isPublished: !category?.isPublished },
  });

  revalidateCategory(category?.slug);

  return updated;
}

// 카테고리 삭제 (글이나 서브 카테고리가 남아 있으면 막는다)
export async function deleteCategory(id: string): Promise<CategoryResult> {
  if (!(await requireAdmin())) {
    return { success: false, error: "권한이 없습니다." };
  }

  try {
    const category = await prisma.noteCategory.findUnique({
      where: { id },
      select: { slug: true },
    });

    if (!category) return { success: false, error: "카테고리를 찾을 수 없습니다." };

    const noteCount = await prisma.developNote.count({
      where: { mainCategory: category.slug },
    });

    if (noteCount > 0) {
      return {
        success: false,
        error: `이 카테고리에 글이 ${noteCount}개 있어 삭제할 수 없습니다. 대신 비공개로 바꿔 주세요.`,
      };
    }

    // 서브 카테고리는 글이 없을 때만 함께 정리한다
    await prisma.noteSubCategory.deleteMany({
      where: { mainCategory: category.slug },
    });
    await prisma.noteCategory.delete({ where: { id } });

    revalidateCategory(category.slug);

    return { success: true };
  } catch (error) {
    console.error("[deleteCategory] 실패:", error);

    return { success: false, error: "카테고리 삭제 중 오류가 발생했습니다." };
  }
}

// 카테고리별 노트 개수 조회 (공개된 노트만)
export async function getCategoryNoteCounts() {
  const categories = await prisma.noteCategory.findMany({
    where: { isPublished: true },
    orderBy: { order: "asc" },
  });

  return Promise.all(
    categories.map(async (category) => {
      const count = await prisma.developNote.count({
        where: {
          mainCategory: category.slug,
          isPublished: true,
        },
      });

      return {
        ...category,
        noteCount: count,
      };
    }),
  );
}