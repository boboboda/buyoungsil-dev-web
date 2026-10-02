// app/project/[name]/board/[postType]/detail/[postId]/page.tsx
import { notFound } from "next/navigation";

import PostDetail from "@/components/release/postComponent/PostDetail";
import { fetchAPost } from "@/serverActions/posts";

export default async function DetailPage({
  params,
}: {
  params: Promise<{ postType: string; name: string; postId: string }>;
}) {
  const { name, postId, postType } = await params;

  const post = await fetchAPost(name, postId, postType);

  // 없는 글(삭제됨, 잘못된 주소)이면 클라이언트 컴포넌트가 null 을 읽다 죽지 않도록 404 처리
  if (!post) {
    notFound();
  }

  return (
    <div className="flex flex-col w-full space-y-8">
      <PostDetail
        appName={name}
        post={post}
        postId={postId}
        postType={postType}
      />
    </div>
  );
}