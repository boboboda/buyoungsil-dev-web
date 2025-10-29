"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface WorkRequestFormData {
  name: string;
  email: string;
  company?: string;
  phone?: string;
  projectType: string;
  budget: string;
  timeline: string;
  title: string;
  description: string;
  requirements?: string;
  reference?: string;
}

// 외주 신청 생성
export async function createWorkRequest(data: WorkRequestFormData) {
  try {
    const workRequest = await prisma.workRequest.create({
      data: {
        ...data,
        status: "pending"
      }
    });

    revalidatePath("/admin/works");
    
    return {
      success: true,
      data: workRequest
    };
  } catch (error) {
    console.error("외주 신청 생성 실패:", error);
    return {
      success: false,
      error: "외주 신청 중 오류가 발생했습니다."
    };
  }
}

// 모든 외주 신청 조회
export async function fetchAllWorkRequests() {
  try {
    const workRequests = await prisma.workRequest.findMany({
      orderBy: { createdAt: 'desc' }
    });

    return workRequests;
  } catch (error) {
    console.error("외주 신청 목록 조회 실패:", error);
    return [];
  }
}

// 특정 외주 신청 조회
export async function fetchWorkRequestById(id: string) {
  try {
    const workRequest = await prisma.workRequest.findUnique({
      where: { id }
    });

    return workRequest;
  } catch (error) {
    console.error("외주 신청 조회 실패:", error);
    return null;
  }
}

// 외주 신청 상태 업데이트
export async function updateWorkRequestStatus(
  id: string, 
  status: string, 
  adminNote?: string
) {
  try {
    const workRequest = await prisma.workRequest.update({
      where: { id },
      data: {
        status,
        ...(adminNote && { adminNote })
      }
    });

    revalidatePath("/admin/works");
    
    return {
      success: true,
      data: workRequest
    };
  } catch (error) {
    console.error("상태 업데이트 실패:", error);
    return {
      success: false,
      error: "상태 업데이트 중 오류가 발생했습니다."
    };
  }
}

// 외주 신청 삭제
export async function deleteWorkRequest(id: string) {
  try {
    await prisma.workRequest.delete({
      where: { id }
    });

    revalidatePath("/admin/works");
    
    return {
      success: true
    };
  } catch (error) {
    console.error("외주 신청 삭제 실패:", error);
    return {
      success: false,
      error: "삭제 중 오류가 발생했습니다."
    };
  }
}