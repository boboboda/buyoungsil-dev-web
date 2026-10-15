import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/get-sesstion";

// 관리자 API 공통 관문. 관리자이면 null, 아니면 보낼 응답.
export async function requireAdmin(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
  }
  return null;
}
