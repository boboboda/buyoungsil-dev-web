import { Metadata } from "next";
import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import ProjectForm from "@/components/admin/projects/ProjectForm";
import moment from "moment";

interface EditProjectPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const metadata: Metadata = {
  title: "프로젝트 수정 | 관리자",
};

export default async function EditProjectPage({ params }: EditProjectPageProps) {
  const { id } = await params;
  
  const project = await prisma.project.findUnique({
    where: { id },
    include: { tags: true }
  });

  if (!project) {
    notFound();
  }

  const formattedProject = {
  id: project.id,
  name: project.name,
  title: project.title,
  description: project.description,
  coverImage: project.coverImage,
  appLink: project.appLink,
  status: project.status as any,
  progress: project.progress,
  platform: project.platform as any,
  techStack: project.techStack, // 🔥 이 줄 추가!
  databaseId: project.databaseId,
  tags: project.tags,
  createdAt: moment(project.createdAt).format("YYYY-MM-DD"),
  updatedAt: moment(project.updatedAt).format("YYYY-MM-DD")
};

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">✏️ 프로젝트 수정</h1>
      <ProjectForm project={formattedProject} />
    </div>
  );
}