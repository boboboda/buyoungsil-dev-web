import { Metadata } from "next";

import prisma from "@/lib/prisma";
import EduBoardAdmin from "@/components/admin/edu/EduBoardAdmin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "특수교육 도구함 게시판 | 관리자",
};

export default async function AdminEduPage() {
  const posts = await prisma.eduPost.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { replies: { orderBy: { createdAt: "asc" } } },
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">🧰 특수교육 도구함 게시판</h1>
        <p className="text-gray-600 dark:text-gray-400">
          edu 사이트에서 들어온 앱·도구 요청과 문의예요. 답변을 달면 작성자가
          글을 열었을 때 글 아래에 보여요. (최근 300개까지 표시)
        </p>
      </div>

      <EduBoardAdmin
        posts={posts.map((p) => ({
          id: p.id,
          board: p.board,
          nickname: p.nickname,
          title: p.title,
          content: p.content,
          isSecret: p.isSecret,
          status: p.status,
          createdAt: p.createdAt.toISOString(),
          replies: p.replies.map((r) => ({
            id: r.id,
            content: r.content,
            createdAt: r.createdAt.toISOString(),
          })),
        }))}
      />
    </div>
  );
}
