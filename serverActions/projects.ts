"use server";

import { revalidatePath } from "next/cache";
import moment from "moment";
import prisma from "@/lib/prisma";
import type { Project, ProjectLog, ProjectStatus, ProjectType, Revenue } from "@/types";

// ========================================
// 프로젝트 CRUD
// ========================================

export async function fetchAllProjects(): Promise<Project[]> {
  const projects = await prisma.project.findMany({
    include: {
      tags: true,
      logs: { select: { id: true } },
      revenues: {
        orderBy: { month: 'desc' },
        take: 1
      }
    },
    orderBy: { updatedAt: 'desc' }
  });

  return projects.map(p => ({
    id: p.id,
    name: p.name,
    title: p.title,
    description: p.description,
    coverImage: p.coverImage,
    appLink: p.appLink,
    status: p.status as ProjectStatus,  // 🔥 타입 캐스팅
    progress: p.progress,
    type: p.type as ProjectType,  // 🔥 타입 캐스팅
    databaseId: p.databaseId,
    tags: p.tags.map(t => ({
      id: t.id,
      name: t.name,
      color: t.color
    })),
    logCount: p.logs.length,
    revenue: p.revenues[0]?.total || 0,
    createdAt: moment(p.createdAt).format("YYYY-MM-DD"),
    updatedAt: moment(p.updatedAt).format("YYYY-MM-DD")
  }));
}

export async function fetchProjectByName(name: string): Promise<Project | null> {
  const project = await prisma.project.findUnique({
    where: { name },
    include: {
      tags: true,
      logs: { orderBy: { createdAt: 'desc' } },
      revenues: { orderBy: { month: 'desc' } }
    }
  });

  if (!project) return null;

  return {
    id: project.id,
    name: project.name,
    title: project.title,
    description: project.description,
    coverImage: project.coverImage,
    appLink: project.appLink,
    status: project.status as ProjectStatus,  // 🔥 타입 캐스팅
    progress: project.progress,
    type: project.type as ProjectType,  // 🔥 타입 캐스팅
    databaseId: project.databaseId,
    tags: project.tags.map(t => ({
      id: t.id,
      name: t.name,
      color: t.color
    })),
    logCount: project.logs.length,
    revenue: project.revenues[0]?.total || 0,
    createdAt: moment(project.createdAt).format("YYYY-MM-DD"),
    updatedAt: moment(project.updatedAt).format("YYYY-MM-DD")
  };
}

export async function createProject(data: {
  name: string;
  title: string;
  description: string;
  coverImage?: string;
  appLink?: string;
  status: string;
  progress: number;
  type: string;
  tags: { name: string; color: string }[];
}) {
  const project = await prisma.project.create({
    data: {
      ...data,
      tags: { create: data.tags }
    }
  });

  revalidatePath('/project');
  return project;
}

export async function updateProject(id: string, data: any) {
  const project = await prisma.project.update({
    where: { id },
    data
  });

  revalidatePath('/project');
  return project;
}

export async function deleteProject(id: string) {
  await prisma.project.delete({ where: { id } });
  revalidatePath('/project');
}

// ========================================
// 프로젝트 로그 CRUD
// ========================================

export async function createProjectLog(data: {
  projectId: string;
  title: string;
  content: string;
  logType: string;
  noteId?: number;
}) {
  const log = await prisma.projectLog.create({
    data
  });

  revalidatePath('/project');
  return log;
}

export async function fetchProjectLogs(projectId: string) {
  const logs = await prisma.projectLog.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' }
  });

  return logs.map(log => ({
    ...log,
    createdAt: moment(log.createdAt).format("YYYY-MM-DD HH:mm"),
    updatedAt: moment(log.updatedAt).format("YYYY-MM-DD HH:mm")
  }));
}

// ========================================
// 수익 데이터 CRUD
// ========================================

export async function createOrUpdateRevenue(data: {
  projectId: string;
  month: string;
  adsense: number;
  inapp: number;
  dau?: number;
  mau?: number;
  downloads?: number;
  notes?: string;
}) {
  const total = data.adsense + data.inapp;

  const revenue = await prisma.revenue.upsert({
    where: {
      projectId_month: {
        projectId: data.projectId,
        month: data.month
      }
    },
    update: {
      adsense: data.adsense,
      inapp: data.inapp,
      total,
      dau: data.dau,
      mau: data.mau,
      downloads: data.downloads,
      notes: data.notes
    },
    create: {
      projectId: data.projectId,
      month: data.month,
      adsense: data.adsense,
      inapp: data.inapp,
      total,
      dau: data.dau,
      mau: data.mau,
      downloads: data.downloads,
      notes: data.notes
    }
  });

  revalidatePath('/project');
  return revenue;
}

export async function fetchProjectRevenues(projectId: string) {
  const revenues = await prisma.revenue.findMany({
    where: { projectId },
    orderBy: { month: 'desc' }
  });

  return revenues.map(r => ({
    ...r,
    createdAt: moment(r.createdAt).format("YYYY-MM-DD"),
    updatedAt: moment(r.updatedAt).format("YYYY-MM-DD")
  }));
}