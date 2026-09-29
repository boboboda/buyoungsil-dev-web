// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";


// 🔒 악성 패턴 감지 (완화됨)
const MALICIOUS_PATTERNS = [
  /curl.*\|.*sh/i,
  /wget.*\|.*sh/i,
  /bash.*-c/i,
  /repositorylinux/i,
  /linuxsys/i,
];

// 🤖 허용할 봇 (AdMob 등)
const ALLOWED_BOTS = [
  "Googlebot",
  "Mediapartners-Google",
  "AdsBot-Google",
  "Bingbot",
];

// 🚫 차단할 봇
const BLOCKED_BOTS = [
  "ZZ; Linux",
  "fasthttp",
  "python-requests",
  "curl/",
  "wget/",
];

// 🌐 악성 IP 차단
const blockedIPs = new Set<string>([
  "82.23.183.171",
  "217.144.184.100",
]);

// IP별 공격 시도 카운트
const attackAttempts = new Map<string, { count: number; lastAttempt: number }>();

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  const realIP = request.headers.get("x-real-ip");
  if (realIP) {
    return realIP.trim();
  }

  return "unknown";
}

// 🏠 로컬 IP 체크 (차단하면 안 됨!)
function isLocalIP(ip: string): boolean {
  return (
    ip === "unknown" ||
    ip.includes("127.0.0.1") ||
    ip.includes("localhost") ||
    ip.includes("192.168.") ||
    ip.includes("10.0.") ||
    ip.includes("172.16.") ||
    ip.includes("::1") ||
    ip.includes("::ffff:192.168.") ||
    ip.includes("::ffff:10.0.") ||
    ip.includes("::ffff:172.16.")
  );
}

function isAllowedBot(userAgent: string): boolean {
  return ALLOWED_BOTS.some((pattern) =>
    userAgent.toLowerCase().includes(pattern.toLowerCase())
  );
}

function isBlockedBot(userAgent: string): boolean {
  return BLOCKED_BOTS.some((pattern) =>
    userAgent.toLowerCase().includes(pattern.toLowerCase())
  );
}

function containsMaliciousPattern(text: string): boolean {
  return MALICIOUS_PATTERNS.some((pattern) => pattern.test(text));
}

function recordAttack(ip: string): boolean {
  // 로컬 IP는 차단하지 않음
  if (isLocalIP(ip)) {
    console.log(`⚠️ [SECURITY] 로컬 IP에서 의심스러운 활동 감지: ${ip}`);
    return false;
  }

  const now = Date.now();
  const record = attackAttempts.get(ip) || { count: 0, lastAttempt: now };

  // 1시간이 지났으면 초기화
  if (now - record.lastAttempt > 60 * 60 * 1000) {
    record.count = 1;
    record.lastAttempt = now;
  } else {
    record.count++;
    record.lastAttempt = now;
  }

  attackAttempts.set(ip, record);

  // 10번 이상 공격 시도하면 영구 차단
  if (record.count >= 10) {
    blockedIPs.add(ip);
    console.log(`🚨 [SECURITY] IP ${ip} 영구 차단됨`);
    return true;
  }

  return false;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const searchParams = request.nextUrl.search;
  const fullUrl = pathname + searchParams;
  const userAgent = request.headers.get("user-agent") || "";
  const clientIP = getClientIP(request);

  console.log("미들웨어 엔드포인트:", pathname);

  // 🔍 헤더 디버깅 (signin 페이지만)
  if (pathname === '/signin') {
    console.log('=== HEADERS DEBUG ===');
    console.log('x-forwarded-proto:', request.headers.get('x-forwarded-proto'));
    console.log('x-forwarded-host:', request.headers.get('x-forwarded-host'));
    console.log('host:', request.headers.get('host'));
    console.log('url:', request.url);
    console.log('protocol:', request.nextUrl.protocol);
    console.log('====================');
  }

  // ========================================
  // 1️⃣ 보안 체크 (최우선)
  // ========================================

  // IP 차단 확인 (단, 로컬 IP는 제외)
  if (!isLocalIP(clientIP) && blockedIPs.has(clientIP)) {
    console.log(`🚫 [SECURITY] 차단된 IP: ${clientIP}`);
    return new NextResponse("Forbidden", { status: 403 });
  }

  // 악성 봇 차단
  if (isBlockedBot(userAgent)) {
    console.log(`🤖 [SECURITY] 차단된 봇: ${userAgent}`);
    recordAttack(clientIP);
    return new NextResponse("Forbidden", { status: 403 });
  }

  // URL에서 악성 패턴 감지
  if (containsMaliciousPattern(fullUrl)) {
    console.log(`🚨 [SECURITY] 악성 URL 패턴 감지: ${fullUrl} from IP: ${clientIP}`);
    recordAttack(clientIP);
    return new NextResponse("Forbidden", { status: 403 });
  }

  // POST 요청의 Body 검사 (API 경로만)
  if ((request.method === "POST" || request.method === "PUT") && pathname.startsWith("/api/")) {
    try {
      const clonedRequest = request.clone();
      const body = await clonedRequest.text();

      if (containsMaliciousPattern(body)) {
        console.log(`🚨 [SECURITY] 악성 Body 패턴 감지 from IP: ${clientIP}`);
        recordAttack(clientIP);

        // 로컬 IP가 아닐 때만 차단
        if (!isLocalIP(clientIP)) {
          return new NextResponse("Forbidden", { status: 403 });
        }
      }
    } catch (e) {
      // Body 읽기 실패는 무시
    }
  }

  // ========================================
  // 2️⃣ 봇 분류 (허용된 봇은 통과)
  // ========================================

  const isAllowedBotRequest = isAllowedBot(userAgent);

  if (isAllowedBotRequest) {
    console.log("[Middleware] 허용된 봇 (AdMob 등):", userAgent);
  }

  // ========================================
  // 3️⃣ 인증 로직
  // ========================================

  const secret = process.env.AUTH_SECRET;
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
    secureCookie: isProduction,
  });

  // 🔍 임시 디버그: /admin 요청일 때만 상세 로그
  if (pathname.startsWith("/admin")) {
    console.log("=== ADMIN AUTH DEBUG ===");
    console.log("NODE_ENV:", process.env.NODE_ENV);
    console.log("VERCEL_ENV:", process.env.VERCEL_ENV);
    console.log("isProduction:", isProduction);
    console.log("찾고 있는 쿠키 이름:", cookieName);
    console.log(
      "들어온 쿠키 목록:",
      request.cookies.getAll().map((c) => c.name),
    );
    console.log("AUTH_SECRET 존재 여부:", !!secret);
    console.log("getToken 결과:", session);
    console.log("========================");
  }

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

    // ========================================
  // 4️⃣ 방문자 기록
  // ========================================
  // 방문 집계는 미들웨어가 아니라 브라우저에서 JS가 실행된 뒤
  // components/main/visitorTracker.tsx 가 /api/visitor-record 를 1회 호출한다.
  // (미들웨어에서 세면 쿠키 없는 봇/스캐너 요청이 전부 방문자로 집계됨)

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