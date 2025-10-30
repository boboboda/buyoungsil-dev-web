// serverActions/projects.ts (추가 또는 수정)
"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { generateSlug } from "@/lib/utils/slugify";  // ⭐ 추가

interface CreateProjectData {
  title: string;
  description: string;
  status: "released" | "in-progress" | "backend";
  platform?: string;
  coverImage?: string;
  appLink?: string;
  githubLink?: string;
  progress?: number;
  tags?: Array<{ name: string; color: string }>;
}

// Project 생성
export async function createProject(data: CreateProjectData) {
  try {
    // ⭐ 1단계: slug 없이 먼저 생성
    const project = await prisma.project.create({
      data: {
        name: 'temp', // 임시 name
        title: data.title,
        description: data.description,
        status: data.status,
        platform: data.platform,
        coverImage: data.coverImage,
        appLink: data.appLink,
        progress: data.progress || 0,
        tags: {
          create: data.tags || []
        }
      },
      include: {
        tags: true
      }
    });

    // ⭐ 2단계: ID로 실제 name(slug) 생성
    const finalName = generateSlug(data.title, project.id);

    // ⭐ 3단계: name 업데이트
    const updatedProject = await prisma.project.update({
      where: { id: project.id },
      data: { name: finalName },
      include: {
        tags: true
      }
    });

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

// Project 수정
export async function updateProject(
  id: string,
  data: Partial<CreateProjectData>
) {
  try {
    // tags 제외하고 업데이트
    const { tags, ...updateData } = data;

    const project = await prisma.project.update({
      where: { id },
      data: {
        ...updateData,
        updatedAt: new Date()
      },
      include: {
        tags: true
      }
    });

    revalidatePath("/project");
    revalidatePath(`/project/${project.name}`);
    revalidatePath("/admin/projects");

    return {
      success: true,
      data: project
    };
  } catch (error) {
    console.error("Project 수정 실패:", error);
    throw new Error("프로젝트 수정 중 오류가 발생했습니다.");
  }
}

// Project 삭제
export async function deleteProject(id: string) {
  try {
    await prisma.project.delete({
      where: { id }
    });

    revalidatePath("/project");
    revalidatePath("/admin/projects");

    return { success: true };
  } catch (error) {
    console.error("Project 삭제 실패:", error);
    throw new Error("프로젝트 삭제 중 오류가 발생했습니다.");
  }
}

// 모든 Project 가져오기
export async function fetchAllProjects() {
  try {
    const projects = await prisma.project.findMany({
      include: {
        tags: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return projects;
  } catch (error) {
    console.error("Projects 조회 실패:", error);
    return [];
  }
}

// name(slug)으로 Project 가져오기
export async function fetchProjectByName(name: string) {
  try {
    const project = await prisma.project.findUnique({
      where: { name },
      include: {
        tags: true
      }
    });

    return project;
  } catch (error) {
    console.error("Project 조회 실패:", error);
    return null;
  }
}