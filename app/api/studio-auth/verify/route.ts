// app/api/studio-auth/verify/route.ts
// 서버1 nginx 의 auth_request 가 /studio/ 요청마다 부르는 주소. 로그인 없이 열려 있고 이 일만 한다. docs/studio-access.md
// - 키: Authorization: Basic 의 비밀번호 칸(아이디 무시), 앱: X-Studio-App. 쿼리로는 받지 않는다.
// - 맞으면 204, 아니면 이유 구별 없이 401 + WWW-Authenticate. 한 주소가 10분에 10번 틀리면 15분 429.
// - 키·헤더 값은 로그·응답에 남기지 않는다.
import { NextRequest, NextResponse } from "next/server";

import { basicPassword, createFailLimiter, studioClientIp, verifyStudioKey } from "@/lib/studio/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = createFailLimiter();
const NO_STORE = { "Cache-Control": "no-store" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const deny = () => new NextResponse(null, { status: 401, headers: { ...NO_STORE, "WWW-Authenticate": 'Basic realm="Studio", charset="UTF-8"' } });

export async function GET(req: NextRequest) {
  const get = (n: string) => req.headers.get(n);
  const ip = studioClientIp(get);
  const blocked = limiter.blockedFor(ip);

  if (blocked > 0) {
    return new NextResponse(null, { status: 429, headers: { ...NO_STORE, "Retry-After": String(Math.ceil(blocked / 1000)) } });
  }
  const app = get("x-studio-app")?.trim() ?? "";
  const key = basicPassword(get("authorization"));

  // 키를 아직 안 보낸 첫 요청(브라우저가 입력 창을 띄우기 전)은 실패로 세지 않는다
  if (get("authorization") === null) return deny();

  let ok = false;

  try {
    ok = key !== null && (await verifyStudioKey(app, key));
  } catch {
    console.error("[studio] 키 확인 중 오류"); // 오류 객체에 값이 섞일 수 있어 남기지 않는다
    return new NextResponse(null, { status: 503, headers: NO_STORE });
  }
  if (ok) return new NextResponse(null, { status: 204, headers: NO_STORE });

  const slow = limiter.fail(ip, /^[a-z0-9-]{3,40}$/.test(app) ? app : "?");

  if (slow) await sleep(slow);

  return deny();
}
