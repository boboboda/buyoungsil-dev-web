import { Metadata } from "next";
import { fetchAllProjects } from "@/serverActions/projects";
import ProjectListTable from "@/components/admin/projects/ProjectListTable";
import AdminProjectsHeader from "@/components/admin/projects/AdminProjectsHeader";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "프로젝트 관리 | 관리자",
};

export default async function AdminProjectsPage() {
  const projects = await fetchAllProjects();

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <AdminProjectsHeader />
      <ProjectListTable projects={projects} />
    </div>
  );
}