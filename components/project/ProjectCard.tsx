import Link from "next/link";
import { Project } from "@/types";

interface ProjectCardProps {
  project: Project;
}

export default function ProjectCard({ project }: ProjectCardProps) {
  const statusEmoji = {
    released: "🚀",
    "in-progress": "🔨",
    backend: "⚙️"
  };

  const statusLabel = {
    released: "출시",
    "in-progress": "개발중",
    backend: "백엔드"
  };

  return (
    <Link href={`/project/${project.name}`}>
      <div className="border rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer h-full flex flex-col">
        {/* 커버 이미지 */}
        {project.coverImage && (
          <div className="mb-4 rounded-lg overflow-hidden">
            <img
              src={project.coverImage}
              alt={project.title}
              className="w-full h-48 object-cover"
            />
          </div>
        )}

        {/* 상태 뱃지 */}
        <div className="mb-3">
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            {statusEmoji[project.status]} {statusLabel[project.status]}
          </span>
        </div>

        {/* 제목 */}
        <h3 className="text-xl font-bold mb-2">{project.title}</h3>

        {/* 설명 */}
        <p className="text-gray-600 dark:text-gray-400 mb-4 flex-grow line-clamp-3">
          {project.description}
        </p>

        {/* 태그 */}
        <div className="flex flex-wrap gap-2 mb-4">
          {project.tags.slice(0, 3).map((tag) => (
            <span
              key={tag.id}
              className="px-2 py-1 rounded text-xs"
              style={{ backgroundColor: tag.color + "20", color: tag.color }}
            >
              {tag.name}
            </span>
          ))}
          {project.tags.length > 3 && (
            <span className="px-2 py-1 rounded text-xs text-gray-500">
              +{project.tags.length - 3}
            </span>
          )}
        </div>

        {/* 진행률 (개발중인 경우) */}
        {project.status === "in-progress" && (
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span>진행률</span>
              <span className="font-medium">{project.progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${project.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* 하단 정보 */}
        <div className="flex justify-between items-center text-sm text-gray-500 border-t pt-3">
          <span>📝 로그 {project.logCount || 0}개</span>
          {project.revenue ? (
            <span className="font-medium text-green-600">
              💰 {project.revenue.toLocaleString()}원
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}