// serverActions/noteSubCategoryActions.ts
"use server";

import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { authOptions } from "@/lib/auth/auth";
import { noteCategories, NoteCategory } from "@/types";

export interface SubCategoryOption {
  id: string;
  name: string;
}

// success 가 true 이면 subCategory 가, false 이면 error 가 채워진다.
export interface CreateSubCategoryResult {
  success: boolean;
  created?: boolean;
  subCategory?: SubCategoryOption;
  error?: string;
}

const MAX_NAME_LENGTH = 40;

function isValidMainCategory(value: string): value is NoteCategory {
  return (noteCategories as string[]).includes(value);
}

async function isAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;

  return role === "admin";
}

/**
 * 메인 카테고리에 속한 서브 카테고리 목록 (드롭다운용)
 */
export async function fetchSubCategories(
  mainCategory: string,
): Promise<SubCategoryOption[]> {
  if (!isValidMainCategory(mainCategory)) return [];

  return prisma.noteSubCategory.findMany({
    where: { mainCategory },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

/**
 * 서브 카테고리 추가 (즉시 DB 저장).
 * 같은 메인 카테고리에 같은 이름이 이미 있으면 새로 만들지 않고 기존 것을 돌려준다.
 */
export async function createSubCategory(
  mainCategory: string,
  rawName: string,
): Promise<CreateSubCategoryResult> {
  if (!(await isAdmin())) {
    return { success: false, error: "권한이 없습니다." };
  }

  if (!isValidMainCategory(mainCategory)) {
    return { success: false, error: "올바르지 않은 메인 카테고리입니다." };
  }

  // 앞뒤 공백 제거 + 연속 공백을 하나로
  const name = rawName.trim().replace(/\s+/g, " ");

  if (!name) {
    return { success: false, error: "카테고리 이름을 입력해주세요." };
  }

  if (name.length > MAX_NAME_LENGTH) {
    return {
      success: false,
      error: `카테고리 이름은 ${MAX_NAME_LENGTH}자 이하로 입력해주세요.`,
    };
  }

  const where = { mainCategory_name: { mainCategory, name } };
  const select = { id: true, name: true } as const;

  try {
    const existing = await prisma.noteSubCategory.findUnique({ where, select });

    if (existing) {
      return { success: true, created: false, subCategory: existing };
    }

    const last = await prisma.noteSubCategory.aggregate({
      where: { mainCategory },
      _max: { order: true },
    });

    const created = await prisma.noteSubCategory.create({
      data: {
        mainCategory,
        name,
        order: (last._max.order ?? -1) + 1,
      },
      select,
    });

    return { success: true, created: true, subCategory: created };
  } catch (error) {
    // 동시에 같은 이름이 만들어진 경우(unique 충돌) → 기존 것을 돌려준다
    if ((error as { code?: string }).code === "P2002") {
      const existing = await prisma.noteSubCategory.findUnique({ where, select });

      if (existing) {
        return { success: true, created: false, subCategory: existing };
      }
    }

    console.error("[createSubCategory] 실패:", error);

    return { success: false, error: "카테고리 저장 중 오류가 발생했습니다." };
  }
}