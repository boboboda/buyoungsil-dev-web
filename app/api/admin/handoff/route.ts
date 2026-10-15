import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth/get-sesstion";
import { HANDOFF_PATH, handoffUrl, safeHandoffTo, signHandoffTicket } from "@/lib/auth/handoff";

export const dynamic = "force-dynamic";

// 프록시 뒤에서도 올바른 주소로 리다이렉트하도록 원래 호스트를 계산한다.
function getOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");

  return host ? `${proto}://${host}` : request.nextUrl.origin;
}

function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");

  return response;
}

// GET /api/admin/handoff?to=/admin/factory
// 관리자: 1회용 짧은 토큰을 만들어 통제실 /auth/enter 로 303. 비로그인: 로그인 뒤 이 주소로 돌아오게 /signin 으로. 그 밖: 403.
export async function GET(request: NextRequest) {
  const to = safeHandoffTo(request.nextUrl.searchParams.get("to"));
  const session = await auth();

  if (!session?.user) {
    const back = `${HANDOFF_PATH}?to=${encodeURIComponent(to)}`;

    return noStore(
      NextResponse.redirect(new URL(`/signin?callbackUrl=${encodeURIComponent(back)}`, getOrigin(request)), 303),
    );
  }

  const user = session.user as { id?: string; email?: string | null; name?: string | null; role?: string };

  if (user.role !== "admin" || !user.id || !user.email) {
    return noStore(NextResponse.json({ message: "권한이 없습니다." }, { status: 403 }));
  }

  try {
    const ticket = await signHandoffTicket({ id: user.id, email: user.email, name: user.name ?? user.email });

    return noStore(NextResponse.redirect(handoffUrl(ticket, to), 303));
  } catch (error) {
    // 토큰 값은 로그에 남기지 않는다(원인 메시지만)
    console.error("[handoff] 토큰 발급 실패:", (error as Error).message);

    return noStore(NextResponse.json({ message: "통제실 로그인 넘김이 아직 설정되지 않았습니다." }, { status: 503 }));
  }
}
