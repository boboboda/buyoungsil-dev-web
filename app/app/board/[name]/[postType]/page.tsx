import { title } from "@/components/primitives";
import PostBoard from "@/components/release/postComponent/PostBoard";
import { fetchPosts } from "@/serverActions/posts";

export const dynamic = "force-dynamic";

export default async function AppBoardPage({
  params,
}: {
  params: Promise<{ name: string; postType: string }>;
}) {
  const { name, postType } = await params;

  const response = await fetchPosts(name, postType);
  const fetchedPosts = response?.posts ?? [];

  const postTitle = postType === "notice" ? "공지사항" : "문의사항";

  return (
    <div className="flex w-full min-w-0 flex-col gap-y-4 px-4 py-5 box-border">
      <h1 className={title({ size: "xs", position: "center", fullWidth: true })}>
        {postTitle}
      </h1>
      <PostBoard appName={name} postType={postType} posts={fetchedPosts} />
    </div>
  );
}