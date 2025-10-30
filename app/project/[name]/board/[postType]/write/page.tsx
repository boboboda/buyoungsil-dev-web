// app/project/[name]/board/[postType]/write/page.tsx
import PostWrite from "@/components/release/postComponent/PostWrite";

export default async function WritePage({
  params,
}: {
  params: Promise<{ postType: string; name: string }>;  // ✅ appName → name
}) {
  const { postType, name } = await params;  // ✅ appName → name

  console.log("Post Type:", postType);
  console.log("Project Name:", name);

  return (
    <div className="flex flex-col w-full space-y-8 pr-4">
      <PostWrite appName={name} postType={postType} />  {/* ✅ appName → name */}
    </div>
  );
}