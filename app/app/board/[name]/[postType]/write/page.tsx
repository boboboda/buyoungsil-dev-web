import PostWrite from "@/components/release/postComponent/PostWrite";

export default async function AppWritePage({
  params,
}: {
  params: Promise<{ name: string; postType: string }>;
}) {
  const { name, postType } = await params;

  return <PostWrite appName={name} postType={postType} />;
}