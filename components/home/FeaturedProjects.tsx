import Link from "next/link";
import type { Project } from "@/types";
import ProjectCard from "@/components/project/ProjectCard";

interface FeaturedProjectsProps {
  projects: Project[];
}

// 홈 '만든 앱·프로젝트': /project 와 같은 카드(출시 상태·스토어 링크)를 최근 것만 보여 준다
export default function FeaturedProjects({ projects }: FeaturedProjectsProps) {
  if (projects.length === 0) return null;

  return (
    <section className="w-full py-16 md:py-20 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-900">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="text-center mb-10 md:mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            💼 만든 앱·프로젝트
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            직접 만들어 출시했거나 개발 중인 프로젝트입니다
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>

        <div className="text-center">
          <Link
            href="/project"
            className="inline-flex items-center gap-2 px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold text-lg shadow-lg hover:shadow-xl"
          >
            전체 보기 →
          </Link>
        </div>
      </div>
    </section>
  );
}
