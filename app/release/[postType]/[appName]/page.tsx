import { title } from "@/components/primitives";
import PostTable from "@/components/release/postComponent/PostTable";
import { fetchPosts } from "@/serverActions/posts";

export default async function noticeBoardPage({
  params,
}: {
  params: Promise<{ appName: string; postType: string }>;
}) {
  const { appName, postType } = await params;

  const response = await fetchPosts(appName, postType);

  const fetchedNotices = response?.posts ?? [];

  const postTitle = postType === "notice" ? "공지사항" : "문의 게시판";

  return (
    <>
      <div className="container flex w-full pl-5 py-5 flex-col items-center justify-center gap-y-3">
        <h1 className={title()}>{postTitle}</h1>
        <PostTable
          appName={appName}
          postType={postType}
          posts={fetchedNotices}
        />
      </div>
    </>
  );
}
