// app/api/visitor-record/route.ts
// 방문자 집계 API. components/main/visitorTracker.tsx 가 브라우저에서 하루 1회 호출한다.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { format } from "date-fns";

import { recordVisit } from "@/serverActions/visitor";

const VISITOR_LOG_COOKIE_KEY = "visited_today_";

// 사람이 아닌 클라이언트 (UA 기반). 헤드리스 브라우저, 크롤러, 스크립트 도구 등.
const BOT_UA_PATTERN =
  /bot|crawl|spider|slurp|scan|monitor|uptime|headless|phantom|lighthouse|preview|fetch|curl|wget|python|go-http|java\/|okhttp|axios|node-fetch|httpclient|libwww|fasthttp|postman|insomnia/i;

// IP당 하루 최대 집계 횟수 (학교/회사 공용 IP 대비 여유를 둠)
const MAX_COUNTS_PER_IP_PER_DAY = 30;
const ipCounts = new Map<string, { date: string; count: number }>();

function getClientIP(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");

  if (forwardedFor) return forwardedFor.split(",")[0].trim();

  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

// 브라우저가 같은 사이트에서 보낸 요청인지 확인
function isSameSiteRequest(req: NextRequest): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");

  if (fetchSite) return fetchSite === "same-origin";

  // sec-fetch-site 를 보내지 않는 구형 브라우저는 Origin/Referer 의 호스트로 판단
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const source = req.headers.get("origin") || req.headers.get("referer");

  if (!host || !source) return false;

  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

function isOverIpLimit(ip: string, today: string): boolean {
  // 메모리 누수 방지: 날짜가 지난 항목 정리
  if (ipCounts.size > 5000) {
    for (const [key, value] of ipCounts) {
      if (value.date !== today) ipCounts.delete(key);
    }
  }

  const record = ipCounts.get(ip);

  if (!record || record.date !== today) {
    ipCounts.set(ip, { date: today, count: 1 });

    return false;
  }

  record.count += 1;

  return record.count > MAX_COUNTS_PER_IP_PER_DAY;
}

// 집계 대상이 아닌 요청은 204 로 조용히 종료 (봇에게 정보를 주지 않음)
const ignored = () => new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  const today = format(new Date(), "yyyy-MM-dd");

  // 1. 봇 / 비브라우저 / 외부 출처 요청 제외
  const userAgent = req.headers.get("user-agent") || "";

  if (!userAgent || BOT_UA_PATTERN.test(userAgent)) return ignored();
  if (!isSameSiteRequest(req)) return ignored();

  // 2. 쿠키로 당일 중복 방지
  const cookieStore = await cookies();

  if (cookieStore.get(VISITOR_LOG_COOKIE_KEY)?.value === today) {
    return new NextResponse("Already visited today.", { status: 200 });
  }

  // 3. IP 단위 상한 (쿠키를 버리며 반복 호출하는 클라이언트 대비)
  if (isOverIpLimit(getClientIP(req), today)) return ignored();

  try {
    await recordVisit();

    const endOfToday = new Date();

    endOfToday.setHours(23, 59, 59, 999);

    // 프록시 뒤에서 HTTP 로 들어오는 경우 secure 쿠키는 브라우저가 저장하지 않아
    // 매 요청이 신규 방문으로 집계되므로, 실제 접속 프로토콜 기준으로 결정한다.
    const proto =
      req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
      req.nextUrl.protocol.replace(":", "");

    cookieStore.set({
      name: VISITOR_LOG_COOKIE_KEY,
      value: today,
      expires: endOfToday,
      path: "/",
      httpOnly: true,
      secure: proto === "https",
      sameSite: "lax",
    });

    return new NextResponse("Visit recorded successfully.", { status: 200 });
  } catch (error) {
    console.error("Error recording visit:", error);

    return new NextResponse("Error recording visit.", { status: 500 });
  }
}