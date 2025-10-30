import { Metadata } from "next";
import moment from "moment";
import { fetchAllProjects } from "@/serverActions/projects";
import ProjectListTable from "@/components/admin/projects/ProjectListTable";
import AdminProjectsHeader from "@/components/admin/projects/AdminProjectsHeader";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "프로젝트 관리 | 관리자",
};

export default async function AdminProjectsPage() {
  const rawProjects = await fetchAllProjects();

  // 🔥 Date를 string으로 변환
  const projects = rawProjects.map(project => ({
    ...project,
    createdAt: moment(project.createdAt).format("YYYY-MM-DD"),
    updatedAt: moment(project.updatedAt).format("YYYY-MM-DD")
  }));

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <AdminProjectsHeader />
      <ProjectListTable projects={projects} />
    </div>
  );
}