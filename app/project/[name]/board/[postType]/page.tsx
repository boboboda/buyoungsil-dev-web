// app/project/[name]/board/[postType]/page.tsx
import { title } from "@/components/primitives";
import PostTable from "@/components/release/postComponent/PostTable";
import { fetchPosts } from "@/serverActions/posts";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ name: string; postType: string }>;  // ✅ appName → name
}) {
  const { name, postType } = await params;  // ✅ appName → name

  const response = await fetchPosts(name, postType);  // ✅ appName → name

  const fetchedPosts = response?.posts ?? [];

  const postTitle = postType === "notice" ? "공지사항" : "문의 게시판";

  return (
    <>
      <div className="container flex w-full pl-5 py-5 flex-col items-center justify-center gap-y-3 pr-4">
        <h1 className={title()}>{postTitle}</h1>
        <PostTable
          appName={name}  // ✅ PostTable에는 appName prop으로 전달
          postType={postType}
          posts={fetchedPosts}
        />
      </div>
    </>
  );
}