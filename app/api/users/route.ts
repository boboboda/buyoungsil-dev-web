import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  try {
    // MongoDB 대신 Prisma 사용
    const users = await prisma.user.findMany();

    const response = {
      message: `오 왠일로 성공`,
      data: users,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("데이터베이스 오류:", error);

    const response = {
      message: `실패다 이자식아`,
      data: "읎다",
    };

    return NextResponse.json(response, { status: 400 });
  } finally {
    // 단일 요청 핸들러에서는 $disconnect()를 호출하지 않아도 됩니다.
    // Next.js API 라우트는 일반적으로 요청당 한 번 실행되기 때문입니다.
  }
}
