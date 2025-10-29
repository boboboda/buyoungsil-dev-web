// app/project/[name]/page.tsx (Server Component)
import { Metadata } from "next";
import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import ProjectDetailClient from "@/components/project/ProjectDetailClient";

export const dynamic = 'force-dynamic';

interface ProjectDetailPageProps {
  params: Promise<{
    name: string;
  }>;
}

export async function generateMetadata({ params }: ProjectDetailPageProps): Promise<Metadata> {
  const { name } = await params;
  
  const project = await prisma.project.findUnique({
    where: { name },
    include: { tags: true }
  });
  
  if (!project) {
    return {
      title: "프로젝트를 찾을 수 없습니다",
    };
  }

  return {
    title: `${project.title} | 코딩천재 부영실`,
    description: project.description,
  };
}

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { name } = await params;
  
  // 프로젝트와 로그, 수익 데이터 가져오기
  const project = await prisma.project.findUnique({
    where: { name },
    include: { 
      tags: true,
      logs: {
        orderBy: {
          createdAt: 'desc'
        }
      },
      revenues: {  // 🔥 수익 데이터 추가
        orderBy: {
          month: 'desc'
        }
      }
    }
  });

  if (!project) {
    notFound();
  }

  // 🔥 로그에 noteId가 있으면 해당 노트 정보 조회
  const logsWithNotes = await Promise.all(
    project.logs.map(async (log) => {
      if (log.noteId) {
        const note = await prisma.developNote.findUnique({
          where: { noteId: log.noteId },
          select: {
            noteId: true,
            title: true,
            mainCategory: true
          }
        });
        
        return {
          ...log,
          note
        };
      }
      
      return {
        ...log,
        note: null
      };
    })
  );

  // 데이터 포맷팅
  const formattedProject = {
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    logs: logsWithNotes.map(log => ({
      id: log.id,
      title: log.title,
      content: log.content,
      logType: log.logType,
      noteId: log.noteId,
      createdAt: log.createdAt.toISOString(),
      note: log.note
    })),
    revenues: project.revenues.map(rev => ({  // 🔥 revenues 포맷팅 추가
      id: rev.id,
      month: rev.month,
      adsense: rev.adsense,
      inapp: rev.inapp,
      total: rev.total,
      dau: rev.dau,
      mau: rev.mau,
      downloads: rev.downloads,
      retention: rev.retention,
      notes: rev.notes
    }))
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* 뒤로가기 */}
      <Link 
        href="/project" 
        className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-6"
      >
        ← 프로젝트 목록으로
      </Link>

      {/* Client Component로 분리 */}
      <ProjectDetailClient project={formattedProject} />
    </div>
  );
}