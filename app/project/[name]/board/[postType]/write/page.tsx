// app/project/[name]/board/[postType]/write/page.tsx
import BoardWritePage from "@/components/board/BoardWritePage";

export default async function WritePage({
  params,
}: {
  params: Promise<{ postType: string; name: string }>;
}) {
  const { postType, name } = await params;

  return <BoardWritePage name={name} postType={postType} variant="site" />;
}
