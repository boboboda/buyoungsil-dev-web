import PostDetail from "@/components/project/postComponent/PostDetail";
import { fetchAPost } from "@/serverActions/posts";

// ✅ 수정: params를 Promise로 변경
export default async function DetailPage({
  params,
}: {
  params: Promise<{ postType: string; appName: string; postId: string }>;
}) {
  // ✅ 수정: await params 추가
  const { appName, postId, postType } = await params;

  console.log("App Name:", appName);
  console.log("Post ID:", postId);

  const post = await fetchAPost(appName, postId, postType);

  console.log("Fetched Post:", post);

  return (
    <div className="flex flex-col w-full space-y-8">
      <PostDetail
        appName={appName}
        post={post}
        postId={postId}
        postType={postType}
      />
    </div>
  );
}