// components/project/ProjectDetailClient.tsx
"use client";

interface DevelopNote {
  noteId: number;
  title: string | null;
  mainCategory: string | null;
}

interface ProjectLog {
  id: string;
  title: string;
  content: string;
  logType: string;
  noteId?: number | null;
  createdAt: string;
  note?: DevelopNote | null; // 🔥 개발노트 정보 추가
}

interface Project {
  id: string;
  name: string;
  title: string;
  description: string;
  coverImage?: string | null;
  appLink?: string | null;
  status: string;
  progress: number;
  tags: Array<{ id: string; name: string; color: string }>;
  logs?: ProjectLog[];
  logCount?: number;
  revenue?: number;
  createdAt: string;
  updatedAt: string;
}

interface ProjectDetailClientProps {
  project: Project;
}

export default function ProjectDetailClient({ project }: ProjectDetailClientProps) {
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
    <>
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

      {/* 🔥 개발 로그 (클릭하면 개발노트 페이지로 이동) */}
      {project.logs && project.logs.length > 0 && (
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">📝 개발 로그 ({project.logs.length})</h2>
          <div className="space-y-4">
            {project.logs.map((log) => {
              const logTypeConfig = {
                progress: { icon: "📈", label: "진행", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
                issue: { icon: "🐛", label: "이슈", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
                solution: { icon: "✅", label: "해결", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
                milestone: { icon: "🎉", label: "마일스톤", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" }
              };
              
              const config = logTypeConfig[log.logType] || { icon: "📝", label: "기타", color: "bg-gray-100 text-gray-800" };
              
              return (
                <div key={log.id} className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow hover:shadow-lg transition-shadow border border-gray-200 dark:border-gray-700">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${config.color}`}>
                        {config.icon} {config.label}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(log.createdAt).toLocaleDateString('ko-KR', { 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        })}
                      </span>
                    </div>
                  </div>
                  
                  <h3 className="text-lg font-semibold mb-2">{log.title}</h3>
                  <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap text-sm mb-4">
                    {log.content}
                  </p>

                  {/* 🔥 연결된 개발노트 정보 표시 */}
                  {log.note && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-gray-500 mb-1">📚 관련 개발 가이드</p>
                          <p className="font-semibold text-blue-600 dark:text-blue-400">
                            {log.note.title || `노트 #${log.note.noteId}`}
                          </p>
                          {log.note.mainCategory && (
                            <p className="text-xs text-gray-500 mt-1">
                              카테고리: {log.note.mainCategory}
                            </p>
                          )}
                        </div>
                        <a
                          href={`/note/${log.note.mainCategory}`}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium whitespace-nowrap"
                        >
                          가이드 보기 →
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 수익 정보 */}
      {project.revenue && project.revenue > 0 && (
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
    </>
  );
}