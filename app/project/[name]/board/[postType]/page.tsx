// app/project/[name]/board/[postType]/page.tsx
import BoardListPage from "@/components/board/BoardListPage";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ name: string; postType: string }>;
}) {
  const { name, postType } = await params;

  return <BoardListPage name={name} postType={postType} variant="site" />;
}
