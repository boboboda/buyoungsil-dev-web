import { notFound } from "next/navigation";

import PostDetail from "@/components/release/postComponent/PostDetail";
import { fetchAPost } from "@/serverActions/posts";

export const dynamic = "force-dynamic";

export default async function AppDetailPage({
  params,
}: {
  params: Promise<{ name: string; postType: string; postId: string }>;
}) {
  const { name, postType, postId } = await params;

  const post = await fetchAPost(name, postId, postType);

  if (!post) {
    notFound();
  }

  return (
    <PostDetail
      appName={name}
      post={post}
      postId={postId}
      postType={postType}
    />
  );
}