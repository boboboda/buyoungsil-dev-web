import { title } from "@/components/primitives";
import PostTable from "@/components/release/postComponent/PostTable";
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

  // items-stretch(기본값)로 두어 표가 화면 폭 안에서만 늘어나게 한다.
  // 좌우 여백은 px-4 로 대칭이다.
  return (
    <div className="flex w-full min-w-0 flex-col gap-y-4 px-4 py-5 box-border">
      <h1 className={title({ size: "xs", position: "center", fullWidth: true })}>
        {postTitle}
      </h1>
      <PostTable appName={name} postType={postType} posts={fetchedPosts} />
    </div>
  );
}