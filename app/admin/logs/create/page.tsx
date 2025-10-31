import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { fetchAllProjects } from "@/serverActions/projects";
import { allFetchEditorServerAdmin } from "@/serverActions/editorServerAction";
import ProjectLogForm from "@/components/admin/projects/ProjectLogForm";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "개발 일지 작성 | 관리자",
};

export default async function CreateLogPage() {


  const projects = await fetchAllProjects();
  
  // 🔥 개발노트 목록 가져오기 (연결용)
  const notesData = await allFetchEditorServerAdmin();
  const notes = JSON.parse(notesData);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">📝 개발 일지 작성</h1>
      <ProjectLogForm projects={projects} notes={notes} />
    </div>
  );
}