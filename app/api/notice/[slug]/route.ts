// app/api/notice/[slug]/route.ts
import { NextRequest, NextResponse } from "next/server";

import { fetchPosts } from "@/serverActions/posts";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const resolvedParams = await params;
    const { slug } = resolvedParams;

    const notice = await fetchPosts(slug, "notice");

    // 최신 데이터는 배열의 첫 번째 요소입니다.
    const latestNotice = notice.posts[0];

    if (!latestNotice) {
      return NextResponse.json(
        { message: "최신 공지사항이 없습니다." },
        { status: 404 },
      );
    }

    const response = {
      message: `성공`,
      data: latestNotice,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("데이터베이스 오류:", error);

    return NextResponse.json({ message: `실패` }, { status: 500 });
  }
}
