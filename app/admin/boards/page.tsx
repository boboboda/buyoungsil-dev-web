import { Metadata } from "next";
import Link from "next/link";
import { fetchAllProjects } from "@/serverActions/projects";
import { fetchPostsCount } from "@/serverActions/posts";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "앱·프로젝트별 공지/문의 게시판 관리 | 관리자",
};

export default async function AdminBoardsPage() {
  const projects = await fetchAllProjects();

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">💬 앱·프로젝트별 공지/문의 게시판 관리</h1>
        <p className="text-gray-600 dark:text-gray-400">
          프로젝트별 공지사항과 문의게시판을 관리합니다
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects.map((project) => (
          <ProjectBoardCard key={project.id} project={project} />
        ))}
      </div>
    </div>
  );
}

async function ProjectBoardCard({ project }: { project: any }) {
  // 게시글 수 가져오기
  const noticeCount = await fetchPostsCount(project.name, "notice");
  const postCount = await fetchPostsCount(project.name, "post");

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* 프로젝트 헤더 */}
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-xl font-bold mb-2">{project.title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {project.name}
        </p>
      </div>

      {/* 게시판 링크 */}
      <div className="p-6 space-y-3">
        {/* 공지사항 */}
        <Link
          href={`/admin/boards/${project.name}/notice`}
          className="block p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📢</span>
              <div>
                <p className="font-semibold text-blue-600 dark:text-blue-400">
                  공지사항
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {noticeCount}개의 게시글
                </p>
              </div>
            </div>
            <span className="text-gray-400">→</span>
          </div>
        </Link>

        {/* 문의게시판 */}
        <Link
          href={`/admin/boards/${project.name}/post`}
          className="block p-4 rounded-lg bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">💬</span>
              <div>
                <p className="font-semibold text-purple-600 dark:text-purple-400">
                  문의게시판
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {postCount}개의 게시글
                </p>
              </div>
            </div>
            <span className="text-gray-400">→</span>
          </div>
        </Link>
      </div>
    </div>
  );
}