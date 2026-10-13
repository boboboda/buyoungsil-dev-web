// app/project/[name]/board/[postType]/detail/[postId]/page.tsx
import BoardDetailPage from "@/components/board/BoardDetailPage";

export default async function DetailPage({
  params,
}: {
  params: Promise<{ postType: string; name: string; postId: string }>;
}) {
  const { name, postId, postType } = await params;

  return (
    <BoardDetailPage
      name={name}
      postId={postId}
      postType={postType}
      variant="site"
    />
  );
}
