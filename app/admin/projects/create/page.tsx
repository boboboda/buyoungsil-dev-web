import { Metadata } from "next";
import ProjectForm from "@/components/admin/projects/ProjectForm";

export const metadata: Metadata = {
  title: "프로젝트 생성 | 관리자",
};

export default function CreateProjectPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">💼 새 프로젝트 생성</h1>
      <ProjectForm />
    </div>
  );
}