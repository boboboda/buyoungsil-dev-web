// app/api/visitor-record/route.ts (수정된 최종 버전)
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { format } from "date-fns";

// DB 기록 로직을 담은 Server Action을 임포트합니다.
import { recordVisit } from "@/serverActions/visitor"; // <-- 이 임포트가 필요합니다.

const VISITOR_LOG_COOKIE_KEY = "visited_today_";

export async function POST(req: NextRequest) {
  const today = format(new Date(), "yyyy-MM-dd");
  const cookieStore = await cookies();
  const hasVisitedToday =
    cookieStore.get(VISITOR_LOG_COOKIE_KEY)?.value === today;

  // 쿠키가 존재하면 바로 리턴
  if (hasVisitedToday) {
    console.log("[API/visitor-record] Already visited today.");

    return new NextResponse("Already visited today.", { status: 200 });
  }

  try {
    // !!! 이 부분이 누락되었었습니다. recordVisit() 호출을 복구합니다. !!!
    // 1. recordVisit() Server Action을 호출하여 DB에 기록합니다.
    await recordVisit();

    // 2. 방문 기록 쿠키 설정
    const endOfToday = new Date();

    endOfToday.setHours(23, 59, 59, 999);
    cookieStore.set({
      name: VISITOR_LOG_COOKIE_KEY,
      value: today,
      expires: endOfToday,
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    console.log("[API/visitor-record] Visit recorded successfully.");

    return new NextResponse("Visit recorded successfully.", { status: 200 });
  } catch (error) {
    console.error("Error recording visit:", error);

    return new NextResponse("Error recording visit.", { status: 500 });
  }
}
