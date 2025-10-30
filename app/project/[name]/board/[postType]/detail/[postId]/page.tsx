// app/project/[name]/board/[postType]/detail/[postId]/page.tsx
import PostDetail from "@/components/release/postComponent/PostDetail";
import { fetchAPost } from "@/serverActions/posts";

export default async function DetailPage({
  params,
}: {
  params: Promise<{ postType: string; name: string; postId: string }>;  // ✅ appName → name
}) {
  const { name, postId, postType } = await params;  // ✅ appName → name

  console.log("Project Name:", name);
  console.log("Post ID:", postId);

  const post = await fetchAPost(name, postId, postType);  // ✅ appName → name

  console.log("Fetched Post:", post);

  return (
    <div className="flex flex-col w-full space-y-8">
      <PostDetail
        appName={name}  // ✅ PostDetail에는 appName prop으로 전달
        post={post}
        postId={postId}
        postType={postType}
      />
    </div>
  );
}