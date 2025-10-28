import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { fetchAllProjects } from "@/serverActions/projects";
import RevenueForm from "@/components/admin/projects/RevenueForm";

export const metadata: Metadata = {
  title: "수익 데이터 입력 | 관리자",
};

export default async function CreateRevenuePage() {

  const projects = await fetchAllProjects();
  const releasedProjects = projects.filter(p => p.status === 'released');

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">💰 수익 데이터 입력</h1>
      <RevenueForm projects={releasedProjects} />
    </div>
  );
}