// actions/visitor.ts
"use server"; // 이 파일의 모든 함수는 서버에서만 실행됨을 명시

import { format } from "date-fns"; // 날짜 형식을 위해 date-fns 임포트

import prisma from "@/lib/prisma";

// 방문 기록을 저장할 쿠키 키 (이름은 원하는 대로 변경 가능)
const VISITOR_LOG_COOKIE_KEY = "visited_today_";

/**
 * 방문자 수를 기록합니다.
 * 쿠키를 사용하여 당일 중복 방문을 방지합니다.
 * * @returns 현재 오늘 방문자수와 총 방문자수 (성공 시), 또는 null (실패/에러 시)
 */
export async function recordVisit(): Promise<{
  todayCount: number;
  totalCount: number;
}> {
  const today = format(new Date(), "yyyy-MM-dd");

  try {
    // 1. 일일 방문자수 업데이트 (upsert)
    const dailyVisitor = await prisma.dailyVisitorCount.upsert({
      where: { date: today },
      update: { count: { increment: 1 } },
      create: { date: today, count: 1 },
    });

    // 2. 총 방문자수 업데이트 (단일 레코드)
    const totalVisitor = await prisma.totalVisitorCount.upsert({
      where: { id: "singleton" },
      update: { totalCount: { increment: 1 } },
      create: { id: "singleton", totalCount: 1 },
    });

    return {
      todayCount: dailyVisitor.count,
      totalCount: totalVisitor.totalCount,
    };
  } catch (error) {
    console.error(`[Visitor Action] DB 업데이트 실패: ${error}`, error);
    // 오류 발생 시에도 현재 카운트를 반환하거나, 오류를 던져 호출자(API 라우터)가 처리하도록 합니다.
    throw new Error("Failed to record visit in the database.");
  }
}

/**
 * 현재까지의 오늘 방문자수를 조회합니다.
 * @returns 오늘 방문자수
 */
export async function getTodayVisitorCount(): Promise<number> {
  "use server"; // 서버에서만 실행됨을 명시 (선택 사항, 파일 상단에 'use server'가 있으면 자동 적용)
  const today = format(new Date(), "yyyy-MM-dd");
  const record = await prisma.dailyVisitorCount.findUnique({
    where: { date: today },
  });

  return record?.count || 0;
}

/**
 * 총 방문자수를 조회합니다.
 * @returns 총 방문자수
 */
export async function getTotalVisitorCount(): Promise<number> {
  "use server"; // 서버에서만 실행됨을 명시
  const record = await prisma.totalVisitorCount.findUnique({
    where: { id: "singleton" },
  });

  return record?.totalCount || 0;
}
