import type { BoardVariant } from "@/components/board/BoardListPage";
import PostWrite from "@/components/board/PostWrite";

// 글쓰기 본문. "app" 은 감싸는 여백 없이, "site" 는 기존 프로젝트 게시판 여백 그대로.
export default function BoardWritePage({
  variant,
  name,
  postType,
}: {
  variant: BoardVariant;
  name: string;
  postType: string;
}) {
  const write = <PostWrite appName={name} postType={postType} />;

  if (variant === "app") return write;

  return <div className="flex flex-col w-full space-y-8 pr-4">{write}</div>;
}
