// middleware.ts
import type { NextRequest } from "next/server";

import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { format } from "date-fns";

const VISITOR_LOG_COOKIE_KEY = "visited_today_";

// 봇 탐지 함수
function isBot(userAgent: string): boolean {
  const botPatterns = [
    "Googlebot",
    "Bingbot",
    "Slurp",
    "DuckDuckBot",
    "Baiduspider",
    "YandexBot",
    "facebookexternalhit",
    "Twitterbot",
    "LinkedInBot",
    "WhatsApp",
    "TelegramBot",
    "crawler",
    "spider",
    "bot",
    "Bot",
    "Crawl",
    "Spider",
    "HeadlessChrome",
    "PhantomJS",
    "SlimerJS",
    "HtmlUnit",
    "selenium",
    "webdriver",
    "headless",
    "ZZ; Linux",        // 공격 봇 차단
    "fasthttp",         // 공격 봇 차단
    "python-requests",  // 공격 봇 차단
  ];

  return botPatterns.some((pattern) =>
    userAgent.toLowerCase().includes(pattern.toLowerCase()),
  );
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  console.log("미들웨어 엔드포인트:", pathname);

  // 봇 체크 - 방문자 카운트에서 제외
  const userAgent = request.headers.get("user-agent") || "";

  if (isBot(userAgent)) {
    console.log("[Middleware] 봇 탐지됨:", userAgent);
    // 인증 로직은 여전히 실행하되, 방문자 카운트는 건너뜀
  } else {
    console.log("[Middleware] 일반 사용자 접근:", userAgent);
  }

  const secret = process.env.AUTH_SECRET;

  // 🔥 getToken 함수에 쿠키 이름과 보안 옵션을 명시적으로 전달
  const isProduction =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";
  const cookieName = isProduction
    ? "__Secure-authjs.session-token"
    : "next-auth.session-token";

  const session = await getToken({
    req: request,
    secret: secret,
    cookieName: cookieName,
    secureCookie: isProduction, // HTTPS 환경에서만 true
  });

  // 1. next-auth 인증 및 권한 로직
  if (session && (pathname === "/signup" || pathname === "/signin")) {
    console.log("인증된 사용자 리다이렉트:", session.email ?? "알 수 없음");

    return NextResponse.redirect(new URL("/", request.url));
  }
  if (pathname.startsWith("/admin")) {
    if (!session) {
      console.log("어드민 페이지 접근 시도: 세션 없음");

      return NextResponse.redirect(new URL("/signin", request.url));
    }
    if (session.role !== "admin") {
      console.log("어드민 페이지 접근 시도: 권한 없음");

      return NextResponse.redirect(new URL("/", request.url));
    }
    console.log("어드민 페이지 접근 허용:", session.email);
  }

  // 2. 방문자 기록 로직 - 봇이 아닌 경우에만 실행
  if (!isBot(userAgent)) {
    const today = format(new Date(), "yyyy-MM-dd");
    const hasVisitedToday =
      request.cookies.get(VISITOR_LOG_COOKIE_KEY)?.value === today;

    if (!hasVisitedToday) {
      console.log("[Middleware] 방문 쿠키 없음. 새로운 방문을 기록합니다.");
      const visitRecordApiUrl = new URL("/api/visitor-record", request.url);

      const apiResponse = await fetch(visitRecordApiUrl, {
        method: "POST",
        headers: {
          Cookie: request.headers.get("cookie") || "",
        },
      });

      const finalResponse = NextResponse.next();
      const setCookieHeaders = apiResponse.headers.getSetCookie();

      if (setCookieHeaders.length > 0) {
        setCookieHeaders.forEach((cookie) => {
          finalResponse.headers.append("Set-Cookie", cookie);
        });
        console.log("[Middleware] 방문 기록 및 쿠키 설정 성공.");

        return finalResponse;
      }
    } else {
      console.log(
        "[Middleware] 방문 쿠키 존재. 오늘 방문은 이미 기록되었습니다.",
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/note/:path*",
    "/release/:path*",
    "/admin/:path*",
    "/signin",
    "/signup",
  ],
};