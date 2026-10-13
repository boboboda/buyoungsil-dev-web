import { notFound } from "next/navigation";

import type { BoardVariant } from "@/components/board/BoardListPage";
import PostDetail from "@/components/board/PostDetail";
import { fetchAPost } from "@/serverActions/posts";

// 게시글 상세 본문. "app" 은 감싸는 여백 없이, "site" 는 기존 프로젝트 게시판 여백 그대로.
export default async function BoardDetailPage({
  variant,
  name,
  postType,
  postId,
}: {
  variant: BoardVariant;
  name: string;
  postType: string;
  postId: string;
}) {
  const post = await fetchAPost(name, postId, postType);

  // 없는 글(삭제됨, 잘못된 주소)이면 클라이언트 컴포넌트가 null 을 읽다 죽지 않도록 404 처리
  if (!post) {
    notFound();
  }

  const detail = (
    <PostDetail appName={name} post={post} postId={postId} postType={postType} />
  );

  if (variant === "app") return detail;

  return <div className="flex flex-col w-full space-y-8">{detail}</div>;
}
