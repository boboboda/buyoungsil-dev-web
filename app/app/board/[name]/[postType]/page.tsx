import AppPostList from "@/components/app/AppPostList";
import { fetchPosts } from "@/serverActions/posts";

export const dynamic = "force-dynamic";

export default async function AppBoardPage({
  params,
}: {
  params: Promise<{ name: string; postType: string }>;
}) {
  const { name, postType } = await params;

  const response = await fetchPosts(name, postType);

  return (
    <AppPostList
      appName={name}
      postType={postType}
      posts={response?.posts ?? []}
    />
  );
}