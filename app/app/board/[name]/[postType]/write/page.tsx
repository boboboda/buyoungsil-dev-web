import BoardWritePage from "@/components/board/BoardWritePage";

export default async function AppWritePage({
  params,
}: {
  params: Promise<{ name: string; postType: string }>;
}) {
  const { name, postType } = await params;

  return <BoardWritePage name={name} postType={postType} variant="app" />;
}
