import PostListMobile from "./PostListMobile";
import PostTable from "./PostTable";

import { PostSummary } from "@/types";

// 화면 폭에 따라 보여줄 목록을 나눈다.
// md(768px) 이상은 기존 표, 그보다 좁으면 모바일용 리스트.
// 글 데이터는 props 로 받으므로 두 컴포넌트를 함께 그려도 추가 요청이 없다.
export default function PostBoard({
  posts,
  appName,
  postType,
}: {
  posts: PostSummary[];
  appName: string;
  postType: string;
}) {
  return (
    <>
      <div className="hidden md:block">
        <PostTable appName={appName} postType={postType} posts={posts} />
      </div>
      <div className="md:hidden">
        <PostListMobile appName={appName} postType={postType} posts={posts} />
      </div>
    </>
  );
}