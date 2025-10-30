import { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/get-sesstion";
import prisma from "@/lib/prisma";
import WorkRequestTable from "@/components/admin/works/WorkRequestTable";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "외주 신청 관리 | 관리자",
};

export default async function AdminWorksPage() {

  // 모든 외주 신청 가져오기
  const workRequests = await prisma.workRequest.findMany({
    orderBy: { createdAt: 'desc' }
  });

  return (
    <div className="w-full min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            📋 외주 신청 관리
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            접수된 프로젝트 의뢰를 확인하고 관리합니다
          </p>
        </div>

        <WorkRequestTable workRequests={workRequests} />
      </div>
    </div>
  );
}