"use server";

import prisma from "@/lib/prisma";

export async function fetchLatestUserData(email: string) {
  console.log("서버 db 유저 로드 실행", email);

  if (!email) {
    console.log("No email provided");

    return null;
  }

  try {
    // Prisma를 사용하여 사용자 데이터 가져오기
    const user = await prisma.user.findUnique({
      where: { email },
    });

    console.log("user data:", user);

    if (!user) {
      console.log("User not found for email:", email);

      return null;
    }

    return user;
  } catch (error) {
    console.error("Error fetching user data:", error);

    // 오류를 던지지 않고 null 반환
    return null;
  }
}

export async function fetchTotalUserCount(): Promise<number> {
  console.log("서버 DB 총 유저 수 조회 실행");

  try {
    // prisma.user.count() 메서드를 사용하여 user 테이블의 모든 레코드 수를 가져옵니다.
    const totalUsers = await prisma.user.count();

    console.log(`총 유저 수: ${totalUsers}`);

    return totalUsers;
  } catch (error) {
    console.error("총 유저 수 조회 실패:", error);

    // 오류 발생 시 0을 반환하거나, 오류를 던지는 로직을 추가할 수 있습니다.
    return 0;
  }
}
