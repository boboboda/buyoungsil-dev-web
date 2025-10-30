import PostWrite from "@/components/release/postComponent/PostWrite";

export default async function WritePage({
  params,
}: {
  params: Promise<{ postType: string; appName: string }>;
}) {
  const { postType, appName } = await params;

  console.log("Post Type:", postType);
  console.log("App Name:", appName);

  return (
    <div className="flex flex-col w-full space-y-8 pr-4">
      <PostWrite appName={appName} postType={postType} />
    </div>
  );
}
