// "모든 기기에서 로그아웃": 내 계정의 세션 버전을 올려서, 지금까지 발급된 모든 로그인(쿠키)을 무효로 만든다.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth/get-sesstion";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { sessionVersion: { increment: 1 } },
      select: { id: true },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("모든 기기 로그아웃 실패:", error);
    return NextResponse.json({ message: "처리하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
