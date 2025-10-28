import { Metadata } from "next";
import Link from "next/link";
import { fetchAllProjects } from "@/serverActions/projects";
import ProjectListTable from "@/components/admin/projects/ProjectListTable";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "프로젝트 관리 | 관리자",
};

export default async function AdminProjectsPage() {
  const projects = await fetchAllProjects();

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">💼 프로젝트 관리</h1>
          <p className="text-gray-600 dark:text-gray-400">
            프로젝트를 생성하고 관리합니다
          </p>
        </div>
        <Link
          href="/admin/projects/create"
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          + 새 프로젝트 생성
        </Link>
      </div>

      <ProjectListTable projects={projects} />
    </div>
  );
}