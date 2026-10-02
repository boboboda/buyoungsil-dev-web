import { NextRequest, NextResponse } from "next/server";

import {
  APP_SESSION_COOKIE,
  APP_SESSION_MAX_AGE,
  signAppSession,
  verifyTicket,
} from "@/lib/auth/app-session";

const DEFAULT_TARGET = "/app/board/dollarRecord/post";

// 이동 대상은 /app/board/... 형태만 허용한다. (외부 주소로 보내는 리다이렉트 방지)
function safeTarget(raw: string | null): string {
  if (!raw) return DEFAULT_TARGET;

  const ok = /^\/app\/board\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_\-/]*)?$/.test(raw);

  return ok ? raw : DEFAULT_TARGET;
}

// 프록시 뒤에서도 올바른 주소로 리다이렉트하도록 원래 호스트를 계산한다.
function getOrigin(request: NextRequest): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");

  return host ? `${proto}://${host}` : request.nextUrl.origin;
}

// GET /app/enter?ticket=...&to=/app/board/dollarRecord/post
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const ticket = searchParams.get("ticket");
  const target = safeTarget(searchParams.get("to"));

  // 티켓이 주소와 히스토리에 남지 않도록 항상 깨끗한 주소로 보낸다.
  const response = NextResponse.redirect(new URL(target, getOrigin(request)), 303);

  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");

  if (!ticket) return response;

  const viewer = await verifyTicket(ticket);

  // 검증에 실패해도 게시판은 읽기 전용으로 열어준다.
  if (!viewer) return response;

  response.cookies.set(APP_SESSION_COOKIE, await signAppSession(viewer), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: APP_SESSION_MAX_AGE,
  });

  return response;
}