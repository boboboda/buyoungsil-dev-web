"use server";

import { revalidatePath } from "next/cache";
import moment from "moment";

import { App } from "@/types/index";
import prisma from "@/lib/prisma";

function formatAppData(app: any): App {
  return {
    id: app.id,
    name: app.name,
    title: app.title,
    description: app.description,
    appLink: app.appLink,
    coverImage: app.coverImage || null,
    databaseId: app.databaseId || null,
    tags: app.tags || [],
    createdAt:
      app.createdAt instanceof Date
        ? moment(app.createdAt).format("YYYY-MM-DD HH:mm:ss")
        : app.createdAt,
    updatedAt:
      app.updatedAt instanceof Date
        ? moment(app.updatedAt).format("YYYY-MM-DD HH:mm:ss")
        : app.updatedAt,
  };
}

// 통합된 앱 등록 함수 - 파일 업로드 및 DB 저장 모두 처리
// 수정된 addApp 함수 (이미지 업로드 부분 제거)
export async function addApp(formData: FormData) {
  try {
    // FormData에서 값 추출
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const appLink = formData.get("appLink") as string;
    const databaseId = formData.get("databaseId") as string;
    const tagsJSON = formData.get("tags") as string;
    const tags = JSON.parse(tagsJSON);

    // 이미지 URL만 받기 (이미 업로드된 상태)
    const imageUrl = formData.get("imageUrl") as string;

    // 앱 이름 생성
    const name = title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\-]+/g, "");

    // 앱 데이터 저장
    const newApp = await prisma.app.create({
      data: {
        name,
        title,
        description,
        appLink,
        coverImage: imageUrl || undefined, // URL 그대로 저장
        databaseId: databaseId || undefined,
        tags: {
          create: tags.map((tag: any) => ({
            name: tag.name,
            color: tag.color,
          })),
        },
      },
      include: {
        tags: true,
      },
    });

    revalidatePath("/release");

    return {
      success: true,
      data: formatAppData(newApp),
    };
  } catch (error) {
    console.error("앱 등록 실패:", error);
    throw new Error("앱을 등록하는 중 오류가 발생했습니다.");
  }
}

// 모든 앱 정보 가져오기
export async function fetchApps(): Promise<{ apps: App[] }> {
  console.log("모든 앱 정보 가져오기 실행됨");
  try {
    const apps = await prisma.app.findMany({
      orderBy: {
        createdAt: "desc", // 최신순으로 정렬
      },
      include: {
        tags: true,
      },
    });

    // 포맷팅된 앱 데이터 반환
    const formattedApps = apps.map(formatAppData);

    return { apps: formattedApps };
  } catch (error) {
    console.error("앱 목록 조회 실패:", error);

    return { apps: [] };
  }
}

// 단일 앱 정보 가져오기
export async function fetchAppByName(name: string): Promise<App | null> {
  try {
    const app = await prisma.app.findUnique({
      where: { name },
      include: {
        tags: true,
      },
    });

    if (!app) {
      return null;
    }

    return formatAppData(app);
  } catch (error) {
    console.error("앱 조회 실패:", error);

    return null;
  }
}

// 앱 삭제하기
export async function deleteApp(id: string): Promise<App | null> {
  try {
    // 앱 존재 여부 확인
    const app = await prisma.app.findUnique({
      where: { id },
      include: { tags: true },
    });

    if (!app) {
      return null;
    }

    // 앱 삭제 (관계된 태그는 cascade로 자동 삭제)
    await prisma.app.delete({
      where: { id },
    });

    revalidatePath("/release");

    return formatAppData(app);
  } catch (error) {
    console.error("앱 삭제 실패:", error);

    return null;
  }
}

// 앱 정보 수정하기
export async function updateApp({
  id,
  title,
  description,
  appLink,
  coverImage,
  tags,
  databaseId,
}: {
  id: string;
  title?: string;
  description?: string;
  appLink?: string;
  coverImage?: string;
  tags?: { name: string; color: string }[];
  databaseId?: string;
}): Promise<App | null> {
  try {
    // 앱 존재 여부 확인
    const existingApp = await prisma.app.findUnique({
      where: { id },
      include: { tags: true },
    });

    if (!existingApp) {
      return null;
    }

    let updateData: any = {};

    // 빈 값이 아닌 필드만 업데이트
    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (appLink) updateData.appLink = appLink;
    if (coverImage !== undefined) updateData.coverImage = coverImage;
    if (databaseId !== undefined) updateData.databaseId = databaseId;

    // 태그 처리
    let tagUpdateOps = {};

    if (tags && tags.length > 0) {
      // 기존 태그 삭제 후 새 태그 생성
      tagUpdateOps = {
        deleteMany: {},
        create: tags.map((tag) => ({
          name: tag.name,
          color: tag.color,
        })),
      };
    }

    // 앱 업데이트
    const updatedApp = await prisma.app.update({
      where: { id },
      data: {
        ...updateData,
        tags: tagUpdateOps,
      },
      include: {
        tags: true,
      },
    });

    revalidatePath("/release");

    return formatAppData(updatedApp);
  } catch (error) {
    console.error("앱 수정 실패:", error);

    return null;
  }
}
