// app/project/[name]/board/[postType]/write/page.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";

import PostWrite from "@/components/release/postComponent/PostWrite";
import { authOptions } from "@/lib/auth/auth";

export default async function WritePage({
  params,
}: {
  params: Promise<{ postType: string; name: string }>;
}) {
  const { postType, name } = await params;

  // 로그인하지 않았다면 글쓰기 화면 대신 로그인 페이지로 보낸다.
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/signin");
  }

  return (
    <div className="flex flex-col w-full space-y-8 pr-4">
      <PostWrite appName={name} postType={postType} />
    </div>
  );
}