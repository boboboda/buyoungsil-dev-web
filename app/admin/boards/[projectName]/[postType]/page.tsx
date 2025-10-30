import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fetchPosts } from "@/serverActions/posts";
import { fetchAllProjects } from "@/serverActions/projects";
import AdminBoardTable from "@/components/admin/boards/AdminBoardTable";

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectName: string; postType: string }>;
}): Promise<Metadata> {
  const { projectName, postType } = await params;
  const postTitle = postType === "notice" ? "공지사항" : "문의게시판";
  
  return {
    title: `${postTitle} 관리 | 관리자`,
  };
}

export default async function AdminProjectBoardPage({
  params,
}: {
  params: Promise<{ projectName: string; postType: string }>;
}) {
  const { projectName, postType } = await params;

  // 프로젝트 정보 가져오기
  const projects = await fetchAllProjects();
  const project = projects.find(p => p.name === projectName);
  
  if (!project) {
    notFound();
  }

  // 게시글 목록 가져오기
  const response = await fetchPosts(projectName, postType);
  const posts = response?.posts ?? [];

  const postTitle = postType === "notice" ? "공지사항" : "문의게시판";
  const postIcon = postType === "notice" ? "📢" : "💬";

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* 헤더 */}
      <div className="mb-8">
        {/* 브레드크럼 */}
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-4">
          <Link href="/admin/boards" className="hover:text-blue-600">
            게시판 관리
          </Link>
          <span>/</span>
          <span>{project.title}</span>
          <span>/</span>
          <span className="text-gray-900 dark:text-white">{postTitle}</span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              {postIcon} {project.title} - {postTitle}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              총 {posts.length}개의 게시글
            </p>
          </div>
        </div>
      </div>

      {/* 게시글 테이블 */}
      <AdminBoardTable
        posts={posts}
        projectName={projectName}
        postType={postType}
      />
    </div>
  );
}