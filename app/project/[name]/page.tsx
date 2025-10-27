import { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchProjectByName } from "@/serverActions/projects";
import Link from "next/link";

export const dynamic = 'force-dynamic';

interface ProjectDetailPageProps {
  params: Promise<{  // 🔥 Promise 추가
    name: string;
  }>;
}

export async function generateMetadata({ params }: ProjectDetailPageProps): Promise<Metadata> {
  const { name } = await params;  // 🔥 await 추가
  const project = await fetchProjectByName(name);
  
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
  const { name } = await params;  // 🔥 await 추가
  const project = await fetchProjectByName(name);

  if (!project) {
    notFound();
  }

  const statusEmoji = {
    released: "🚀",
    "in-progress": "🔨",
    backend: "⚙️"
  };

  const statusLabel = {
    released: "출시됨",
    "in-progress": "개발중",
    backend: "백엔드"
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

      {/* 헤더 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">{statusEmoji[project.status]}</span>
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            {statusLabel[project.status]}
          </span>
        </div>
        <h1 className="text-4xl font-bold mb-4">{project.title}</h1>
        <p className="text-xl text-gray-600 dark:text-gray-400">
          {project.description}
        </p>
      </div>

      {/* 커버 이미지 */}
      {project.coverImage && (
        <div className="mb-8 rounded-lg overflow-hidden">
          <img
            src={project.coverImage}
            alt={project.title}
            className="w-full h-auto object-cover"
          />
        </div>
      )}

      {/* 진행률 (개발중인 경우) */}
      {project.status === "in-progress" && (
        <div className="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="flex justify-between text-lg mb-2">
            <span className="font-medium">진행률</span>
            <span className="font-bold text-blue-600">{project.progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 dark:bg-gray-700">
            <div
              className="bg-blue-600 h-3 rounded-full transition-all"
              style={{ width: `${project.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* 태그 */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-4">🏷️ 기술 스택</h2>
        <div className="flex flex-wrap gap-3">
          {project.tags.map((tag) => (
            <span
              key={tag.id}
              className="px-4 py-2 rounded-lg font-medium"
              style={{ backgroundColor: tag.color + "20", color: tag.color }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      </div>

      {/* 앱 링크 */}
      {project.appLink && (
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">🔗 링크</h2>
          <a
            href={project.appLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            앱 다운로드 / 웹사이트 방문 →
          </a>
        </div>
      )}

      {/* 개발 로그 */}
      {project.logCount > 0 && (
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">📝 개발 로그</h2>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 text-center">
            <p className="text-gray-600 dark:text-gray-400">
              총 {project.logCount}개의 개발 로그가 있습니다
            </p>
            <p className="text-sm text-gray-500 mt-2">
              (개발 로그 상세 페이지는 곧 추가됩니다)
            </p>
          </div>
        </div>
      )}

      {/* 수익 정보 */}
      {project.revenue > 0 && (
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">💰 최근 수익</h2>
          <div className="bg-green-50 dark:bg-green-900 rounded-lg p-6">
            <p className="text-3xl font-bold text-green-600 dark:text-green-400">
              {project.revenue.toLocaleString()}원
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
              최근 월 수익
            </p>
          </div>
        </div>
      )}

      {/* 메타 정보 */}
      <div className="border-t pt-6 text-sm text-gray-500">
        <div className="flex justify-between">
          <span>생성일: {project.createdAt}</span>
          <span>최종 업데이트: {project.updatedAt}</span>
        </div>
      </div>
    </div>
  );
}