"use server";

import { revalidatePath } from "next/cache";
import moment from "moment";
import prisma from "@/lib/prisma";

// ========================================
// 프로젝트 CRUD
// ========================================

export async function fetchAllProjects() {
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
    platform: p.platform,
    status: p.status,
    progress: p.progress,
    databaseId: p.databaseId,
    tags: p.tags,
    logCount: p.logs.length,
    revenue: p.revenues[0]?.total || 0,
    createdAt: moment(p.createdAt).format("YYYY-MM-DD"),
    updatedAt: moment(p.updatedAt).format("YYYY-MM-DD")
  }));
}

export async function fetchProjectByName(name: string) {
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
    platform: project.platform,
    status: project.status,
    progress: project.progress,
    databaseId: project.databaseId,
    tags: project.tags,
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
  platform: string;
  status: string;
  progress: number;
  databaseId?: string;
  tags: { name: string; color: string }[];
}) {
  const project = await prisma.project.create({
    data: {
      name: data.name,
      title: data.title,
      description: data.description,
      coverImage: data.coverImage,
      appLink: data.appLink,
      platform: data.platform,
      status: data.status,
      progress: data.progress,
      databaseId: data.databaseId,
      tags: {
        create: data.tags
      }
    },
    include: { tags: true }
  });

  revalidatePath('/admin/projects');
  revalidatePath('/project');
  return project;
}

export async function updateProject(id: string, data: any) {
  // 기존 태그 삭제
  await prisma.projectTag.deleteMany({
    where: { projectId: id }
  });

  // 프로젝트 업데이트
  const project = await prisma.project.update({
    where: { id },
    data: {
      name: data.name,
      title: data.title,
      description: data.description,
      coverImage: data.coverImage,
      appLink: data.appLink,
      platform: data.platform,
      status: data.status,
      progress: data.progress,
      databaseId: data.databaseId,
      tags: {
        create: data.tags
      }
    },
    include: { tags: true }
  });

  revalidatePath('/admin/projects');
  revalidatePath('/project');
  revalidatePath(`/project/${project.name}`);
  return project;
}

export async function deleteProject(id: string) {
  await prisma.project.delete({
    where: { id }
  });
  
  revalidatePath('/admin/projects');
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

  revalidatePath('/admin/projects');
  revalidatePath(`/project`);
  return log;
}

export async function fetchProjectLogs(projectId: string) {
  const logs = await prisma.projectLog.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' }
  });

  return logs.map(log => ({
    id: log.id,
    projectId: log.projectId,
    title: log.title,
    content: log.content,
    logType: log.logType,
    noteId: log.noteId,
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

  revalidatePath('/admin/projects');
  revalidatePath(`/project`);
  return revenue;
}

export async function fetchProjectRevenues(projectId: string) {
  const revenues = await prisma.revenue.findMany({
    where: { projectId },
    orderBy: { month: 'desc' }
  });

  return revenues.map(r => ({
    id: r.id,
    projectId: r.projectId,
    month: r.month,
    adsense: r.adsense,
    inapp: r.inapp,
    total: r.total,
    dau: r.dau,
    mau: r.mau,
    downloads: r.downloads,
    retention: r.retention,
    notes: r.notes,
    createdAt: moment(r.createdAt).format("YYYY-MM-DD"),
    updatedAt: moment(r.updatedAt).format("YYYY-MM-DD")
  }));
}