import BoardDetailPage from "@/components/board/BoardDetailPage";

export const dynamic = "force-dynamic";

export default async function AppDetailPage({
  params,
}: {
  params: Promise<{ name: string; postType: string; postId: string }>;
}) {
  const { name, postType, postId } = await params;

  return (
    <BoardDetailPage
      name={name}
      postId={postId}
      postType={postType}
      variant="app"
    />
  );
}
