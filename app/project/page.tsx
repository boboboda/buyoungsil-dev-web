import { Metadata } from "next";
import { fetchAllProjects } from "@/serverActions/projects";
import ProjectCard from "@/components/project/ProjectCard";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "프로젝트 | 코딩천재 부영실",
  description: "AI로 만든 모바일/웹 프로젝트 모음. 출시된 앱부터 개발 중인 프로젝트까지 모두 공개합니다.",
  keywords: ["프로젝트", "앱 개발", "웹 개발", "Flutter", "Next.js", "AI 개발"],
};

export default async function ProjectPage() {
  const projects = await fetchAllProjects();

  // 상태별로 그룹화
  const releasedProjects = projects.filter(p => p.status === 'released');
  const inProgressProjects = projects.filter(p => p.status === 'in-progress');
  const backendProjects = projects.filter(p => p.status === 'backend');

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold mb-4">💼 프로젝트</h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          AI로 만든 모바일/웹 프로젝트를 공유합니다
        </p>
      </div>

      {/* 출시된 프로젝트 */}
      {releasedProjects.length > 0 && (
        <section className="mb-16">
          <h2 className="text-3xl font-bold mb-6 flex items-center gap-2">
            🚀 출시된 프로젝트
            <span className="text-sm font-normal text-gray-500">
              ({releasedProjects.length})
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {releasedProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      )}

      {/* 개발 중인 프로젝트 */}
      {inProgressProjects.length > 0 && (
        <section className="mb-16">
          <h2 className="text-3xl font-bold mb-6 flex items-center gap-2">
            🔨 개발 중
            <span className="text-sm font-normal text-gray-500">
              ({inProgressProjects.length})
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {inProgressProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      )}

      {/* 백엔드 프로젝트 */}
      {backendProjects.length > 0 && (
        <section className="mb-16">
          <h2 className="text-3xl font-bold mb-6 flex items-center gap-2">
            ⚙️ 백엔드
            <span className="text-sm font-normal text-gray-500">
              ({backendProjects.length})
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {backendProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      )}

      {projects.length === 0 && (
        <div className="text-center py-20 text-gray-500">
          아직 등록된 프로젝트가 없습니다.
        </div>
      )}
    </div>
  );
}