import BoardListPage from "@/components/board/BoardListPage";

export const dynamic = "force-dynamic";

export default async function AppBoardPage({
  params,
}: {
  params: Promise<{ name: string; postType: string }>;
}) {
  const { name, postType } = await params;

  return <BoardListPage name={name} postType={postType} variant="app" />;
}
