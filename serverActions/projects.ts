// serverActions/projects.ts
"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { ensureAnalyticsApp } from "@/lib/analytics/registerApp";
import { assertAdmin } from "@/lib/auth/assertAdmin";
import {
  createProjectRecord,
  normalizePrivacyPolicy,
  type CreateProjectData,
} from "@/lib/projects/createProjectRecord";

// ========================================
// 프로젝트 CRUD
// ========================================

// Project 생성 (본체는 lib/projects/createProjectRecord.ts, 앱 공장도 같이 씀)
export async function createProject(data: CreateProjectData) {
  await assertAdmin();
  return createProjectRecord(data);
}

// Project 수정
// serverActions/projects.ts - updateProject 함수 수정

// Project 수정
export async function updateProject(
  id: string,
  data: Partial<CreateProjectData>
) {
  await assertAdmin();
  try {
    // ❌ 기존: tags를 제외하고 업데이트만 함
    // const { tags, ...updateData } = data;

    // ✅ 수정: tags 처리 추가
    const { tags, privacyPolicy, ...updateData } = data;

    // 기본 필드 업데이트
    const updateOperation: any = {
      ...updateData,
      updatedAt: new Date()
    };

      // 🔥 출시됨 상태면 진행률은 항상 100
    if (data.status === "released") {
      updateOperation.progress = 100;
    }

    // 🔥 개인정보처리방침: 내용이 실제로 바뀐 경우에만 시행일 갱신
    if (privacyPolicy !== undefined) {
      const nextPolicy = normalizePrivacyPolicy(privacyPolicy);
      const current = await prisma.project.findUnique({
        where: { id },
        select: { privacyPolicy: true }
      });

      if (nextPolicy !== (current?.privacyPolicy ?? null)) {
        updateOperation.privacyPolicy = nextPolicy;
        updateOperation.privacyUpdatedAt = nextPolicy ? new Date() : null;
      }
    }

    // ✅ 태그가 있으면 기존 태그 삭제 후 새로 생성
    if (tags !== undefined) {
      updateOperation.tags = {
        deleteMany: {},  // 기존 태그 전부 삭제
        create: tags.map(tag => ({
          name: tag.name,
          color: tag.color
        }))
      };
    }

    const project = await prisma.project.update({
      where: { id },
      data: updateOperation,
      include: {
        tags: true
      }
    });

    // 제목이 바뀌면 분석 앱 표시 이름도 맞춘다 (수집 키는 그대로)
    await ensureAnalyticsApp(project);

    revalidatePath("/project");
    revalidatePath(`/project/${project.name}`);
    revalidatePath(`/project/${project.name}/privacy`);
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
  await assertAdmin();
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


// name(slug)으로 Project 가져오기
export async function fetchProjectByName(name: string) {
  try {
    const project = await prisma.project.findUnique({
      where: { name },
      include: {
        tags: true,
        logs: true,
        revenues: true
      }
    });

    return project;
  } catch (error) {
    console.error("Project 조회 실패:", error);
    return null;
  }
}



// ========================================
// 프로젝트 로그 CRUD
// ========================================

interface CreateProjectLogData {
  projectId: string;
  title: string;
  content: string;
  logType: "progress" | "issue" | "solution" | "milestone";
  noteId?: number;
}

export async function createProjectLog(data: CreateProjectLogData) {
  await assertAdmin();
  try {
    const log = await prisma.projectLog.create({
      data: {
        projectId: data.projectId,
        title: data.title,
        content: data.content,
        logType: data.logType,
        noteId: data.noteId
      }
    });

    revalidatePath(`/project/${data.projectId}`);
    revalidatePath("/admin/projects");

    return {
      success: true,
      data: log
    };
  } catch (error) {
    console.error("ProjectLog 생성 실패:", error);
    throw new Error("프로젝트 로그 생성 중 오류가 발생했습니다.");
  }
}

export async function deleteProjectLog(id: string) {
  await assertAdmin();
  try {
    await prisma.projectLog.delete({
      where: { id }
    });

    revalidatePath("/admin/projects");

    return { success: true };
  } catch (error) {
    console.error("ProjectLog 삭제 실패:", error);
    throw new Error("프로젝트 로그 삭제 중 오류가 발생했습니다.");
  }
}

// ========================================
// 수익 데이터 CRUD
// ========================================

interface RevenueData {
  projectId: string;
  month: string;
  adsense: number;
  inapp: number;
  dau?: number;
  mau?: number;
  downloads?: number;
  retention?: number;
  notes?: string;
}

export async function createOrUpdateRevenue(data: RevenueData) {
  await assertAdmin();
  try {
    const total = data.adsense + data.inapp;

    const revenue = await prisma.revenue.upsert({
      where: {
        projectId_month: {
          projectId: data.projectId,
          month: data.month
        }
      },
      create: {
        projectId: data.projectId,
        month: data.month,
        adsense: data.adsense,
        inapp: data.inapp,
        total: total,
        dau: data.dau,
        mau: data.mau,
        downloads: data.downloads,
        retention: data.retention,
        notes: data.notes
      },
      update: {
        adsense: data.adsense,
        inapp: data.inapp,
        total: total,
        dau: data.dau,
        mau: data.mau,
        downloads: data.downloads,
        retention: data.retention,
        notes: data.notes,
        updatedAt: new Date()
      }
    });

    revalidatePath(`/project/${data.projectId}`);
    revalidatePath("/admin/revenues");

    return {
      success: true,
      data: revenue
    };
  } catch (error) {
    console.error("Revenue 저장 실패:", error);
    throw new Error("수익 데이터 저장 중 오류가 발생했습니다.");
  }
}

export async function deleteRevenue(id: string) {
  await assertAdmin();
  try {
    await prisma.revenue.delete({
      where: { id }
    });

    revalidatePath("/admin/revenues");

    return { success: true };
  } catch (error) {
    console.error("Revenue 삭제 실패:", error);
    throw new Error("수익 데이터 삭제 중 오류가 발생했습니다.");
  }
}

// ========================================
// 태그 관리
// ========================================

export async function addProjectTag(projectId: string, name: string, color: string) {
  await assertAdmin();
  try {
    const tag = await prisma.projectTag.create({
      data: {
        projectId,
        name,
        color
      }
    });

    revalidatePath(`/project/${projectId}`);
    revalidatePath("/admin/projects");

    return { success: true, data: tag };
  } catch (error) {
    console.error("Tag 추가 실패:", error);
    throw new Error("태그 추가 중 오류가 발생했습니다.");
  }
}

export async function deleteProjectTag(tagId: string) {
  await assertAdmin();
  try {
    await prisma.projectTag.delete({
      where: { id: tagId }
    });

    revalidatePath("/admin/projects");

    return { success: true };
  } catch (error) {
    console.error("Tag 삭제 실패:", error);
    throw new Error("태그 삭제 중 오류가 발생했습니다.");
  }
}

// serverActions/projects.ts - fetchAllProjects 함수 수정

// 모든 Project 가져오기 (카드 뷰용 - revenue 합계 포함)
export async function fetchAllProjects() {
  try {
    const projects = await prisma.project.findMany({
      include: {
        tags: true,
        _count: {
          select: {
            logs: true  // 로그 개수
          }
        },
        revenues: {  // ✅ 수익 데이터 포함
          select: {
            total: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // ✅ 수익 합계 계산하여 반환
    return projects.map(project => ({
      ...project,
      logCount: project._count.logs,
      revenue: project.revenues.reduce((sum, r) => sum + r.total, 0), // 총 수익 계산
      // revenues 배열은 제거 (목록에서는 필요 없음)
      revenues: undefined,
      _count: undefined
    }));
  } catch (error) {
    console.error("Projects 조회 실패:", error);
    return [];
  }
}

// 출시된 프로젝트만 가져오기 (revenue 포함)
export async function fetchReleasedProjects() {
  try {
    const projects = await prisma.project.findMany({
      where: { status: 'released' },
      include: {
        tags: true,
        _count: {
          select: {
            logs: true
          }
        },
        revenues: {  // ✅ 수익 데이터 포함
          select: {
            total: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // ✅ 수익 합계 계산하여 반환
    return projects.map(project => ({
      ...project,
      logCount: project._count.logs,
      revenue: project.revenues.reduce((sum, r) => sum + r.total, 0),
      revenues: undefined,
      _count: undefined
    }));
  } catch (error) {
    console.error("Released Projects 조회 실패:", error);
    return [];
  }
}