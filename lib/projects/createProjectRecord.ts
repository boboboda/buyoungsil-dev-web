import { revalidatePath } from "next/cache";

import prisma from "@/lib/prisma";
import { generateSlug } from "@/lib/utils/slugify";
import { ensureAnalyticsApp } from "@/lib/analytics/registerApp";

// 프로젝트 생성 본체. 서버 액션 createProject(관리자 확인)와 앱 공장(lib/factory/project.ts)이 같이 쓴다.
// "use server" 파일이 아니므로 브라우저에서 직접 부를 수 없다.

export interface CreateProjectData {
  title: string;
  description: string;
  status: "released" | "in-progress" | "backend";
  platform: string;
  coverImage?: string;
  appLink?: string;
  progress?: number;
  techStack?: string[];
  privacyPolicy?: string;
  tags?: Array<{ name: string; color: string }>;
}

// 빈 문자열/공백만 있는 처리방침은 null 로 저장 (탭 숨김 판단 기준)
export function normalizePrivacyPolicy(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function createProjectRecord(data: CreateProjectData) {
  try {
    // 1단계: slug 없이 먼저 생성
    const project = await prisma.project.create({
      data: {
        name: 'temp', // 임시 name
        title: data.title,
        description: data.description,
        status: data.status,
        platform: data.platform,
        coverImage: data.coverImage,
        appLink: data.appLink,
        progress: data.status === "released" ? 100 : data.progress || 0,        techStack: data.techStack || [],
        privacyPolicy: normalizePrivacyPolicy(data.privacyPolicy),
        privacyUpdatedAt: normalizePrivacyPolicy(data.privacyPolicy) ? new Date() : null,
        tags: {
          create: data.tags || []
        }
      },
      include: {
        tags: true
      }
    });

    // 2단계: ID로 실제 name(slug) 생성
    const finalName = generateSlug(data.title, project.id);

    // 3단계: name 업데이트
    const updatedProject = await prisma.project.update({
      where: { id: project.id },
      data: { name: finalName },
      include: {
        tags: true
      }
    });

    // 분석 앱 자동 등록 (실패해도 프로젝트 생성은 그대로 성공)
    await ensureAnalyticsApp(updatedProject);

    revalidatePath("/project");
    revalidatePath("/admin/projects");

    return {
      success: true,
      data: updatedProject
    };
  } catch (error) {
    console.error("Project 생성 실패:", error);
    throw new Error("프로젝트 생성 중 오류가 발생했습니다.");
  }
}
