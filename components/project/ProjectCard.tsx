"use client";

import Link from "next/link";
import { Project } from "@/types";
import { GradientCard } from "@/components/common/GradientCard";
import { Progress } from "@heroui/react";

interface ProjectCardProps {
  project: Project;
}

export default function ProjectCard({ project }: ProjectCardProps) {
  const statusConfig = {
    released: {
      emoji: "🚀",
      label: "출시됨",
      gradient: "from-green-500 to-emerald-500"
    },
    "in-progress": {
      emoji: "🔨",
      label: "개발 중",
      gradient: "from-yellow-500 to-orange-500"
    },
    backend: {
      emoji: "⚙️",
      label: "백엔드",
      gradient: "from-blue-500 to-purple-500"
    }
  };

  // 알 수 없는 상태값이 들어와도 카드가 깨지지 않게 '개발 중'으로 보여 준다
  const config =
    statusConfig[project.status as keyof typeof statusConfig] ?? statusConfig["in-progress"];
  const store = project.appLink ? storeLabel(project.appLink) : null;

  return (
    // 스토어 링크는 카드 링크 안에 넣을 수 없어서(링크 중첩) 같은 자리에 겹쳐 올린다
    <div className="relative w-full h-full">
      <Link href={`/project/${project.name}`} className="block w-full h-full">
        <GradientCard
          isPressable
          gradient={config.gradient}
          className="hover:-translate-y-2 transition-transform h-full w-full flex flex-col"
        >
          {/* 커버 이미지 영역 */}
          <div className="mb-4 rounded-lg overflow-hidden -mx-6 -mt-6 h-48 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 flex-shrink-0">
            {project.coverImage ? (
              <img
                src={project.coverImage}
                alt={project.title}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-7xl">{config.emoji}</span>
              </div>
            )}
          </div>

          {/* 상태 뱃지 */}
          <div className="mb-3 flex-shrink-0">
            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-gradient-to-r ${config.gradient} text-white`}>
              {config.emoji} {config.label}
            </span>
          </div>

          {/* 제목 - 2줄 제한 */}
          <h3 className="text-xl font-bold mb-3 group-hover:bg-gradient-to-r group-hover:from-blue-600 group-hover:to-purple-600 group-hover:bg-clip-text group-hover:text-transparent transition-all line-clamp-2 flex-shrink-0">
            {project.title}
          </h3>

          {/* 설명 - 3줄 제한 */}
          <p className="text-gray-600 dark:text-gray-400 mb-4 line-clamp-3 flex-shrink-0">
            {project.description}
          </p>

          {/* 태그 영역 - 자동 높이 */}
          <div className="flex flex-wrap gap-2 mb-4 flex-shrink-0">
            {project.tags && project.tags.length > 0 ? (
              <>
                {project.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag.id}
                    className="px-2 py-1 rounded text-xs font-medium"
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
              </>
            ) : (
              <span className="text-xs text-gray-400">태그 없음</span>
            )}
          </div>

          {/* 진행률 영역 */}
          {project.status === "in-progress" && (
            <div className="mb-4 flex-shrink-0">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600 dark:text-gray-400">진행률</span>
                <span className="font-bold">{project.progress}%</span>
              </div>
              <Progress 
                value={project.progress}
                color="warning"
                size="sm"
                className="max-w-full"
              />
            </div>
          )}

          {/* 하단 정보 - 맨 아래 고정. 로그가 없거나 수익 데이터가 없으면 그 줄은 숨긴다 */}
          {((project.logCount ?? 0) > 0 || (project.revenue ?? 0) > 0) && (
            <div className="flex justify-between items-center text-sm text-gray-500 border-t border-gray-200 dark:border-gray-700 pt-3 mt-auto flex-shrink-0">
              {(project.logCount ?? 0) > 0 ? (
                <span>📝 로그 {project.logCount}개</span>
              ) : (
                <span />
              )}
              {(project.revenue ?? 0) > 0 && (
                <span className="font-medium text-green-600 dark:text-green-400">
                  💰 {project.revenue!.toLocaleString()}원
                </span>
              )}
            </div>
          )}
        </GradientCard>
      </Link>
      {project.appLink && store && (
        <a
          aria-label={`${project.title} ${store} 열기`}
          className="absolute top-3 right-3 z-20 inline-flex items-center gap-1 rounded-full bg-black/75 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-black"
          href={project.appLink}
          rel="noopener noreferrer"
          target="_blank"
        >
          {store} ↗
        </a>
      )}
    </div>
  );
}

// 앱 링크 주소로 스토어 이름을 정한다 (예전 /release 목록의 '앱 바로가기' 버튼 대신)
function storeLabel(url: string) {
  if (url.includes("play.google.com")) return "▶ Google Play";
  if (url.includes("apps.apple.com")) return "🍎 App Store";
  return "🔗 바로가기";
}