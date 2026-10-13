import { title } from "@/components/primitives";
import PostBoard from "@/components/board/PostBoard";
import PostTable from "@/components/board/PostTable";
import { fetchPosts } from "@/serverActions/posts";

// 게시판 목록 본문. 두 주소가 같이 쓴다.
// - "app": /app/board/[name]/[postType] (출시된 앱 WebView 가 들어오는 주소, 좁은 화면용)
// - "site": /project/[name]/board/[postType] (홈페이지 안의 게시판)
export type BoardVariant = "app" | "site";

export default async function BoardListPage({
  variant,
  name,
  postType,
}: {
  variant: BoardVariant;
  name: string;
  postType: string;
}) {
  const response = await fetchPosts(name, postType);
  const fetchedPosts = response?.posts ?? [];

  if (variant === "app") {
    const postTitle = postType === "notice" ? "공지사항" : "문의사항";

    return (
      <div className="flex w-full min-w-0 flex-col gap-y-4 px-4 py-5 box-border">
        <h1
          className={title({ size: "xs", position: "center", fullWidth: true })}
        >
          {postTitle}
        </h1>
        <PostBoard appName={name} postType={postType} posts={fetchedPosts} />
      </div>
    );
  }

  const postTitle = postType === "notice" ? "공지사항" : "문의 게시판";

  return (
    <div className="container flex w-full pl-5 py-5 flex-col items-center justify-center gap-y-3 pr-4">
      <h1 className={title()}>{postTitle}</h1>
      <PostTable appName={name} postType={postType} posts={fetchedPosts} />
    </div>
  );
}
