import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";

export const APP_SESSION_COOKIE = "app_session";
export const APP_SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30일

// NestJS(exchange-rate-api)가 발급하는 입장 티켓
const TICKET_ISSUER = "exchange-rate-api";
const TICKET_AUDIENCE = "buyoungsil-web";

// 웹이 발급하는 앱 세션 쿠키 (티켓과 대상이 달라서 서로 대체할 수 없다)
const SESSION_ISSUER = "buyoungsil-web";
const SESSION_AUDIENCE = "buyoungsil-web-app-session";

export type AppViewer = {
  ownerKey: string; // Post.email 컬럼에 저장되는 소유자 키
  uid: string;
  name: string;
  provider: string;
};

function getSecret(): Uint8Array {
  const secret = process.env.WEB_TICKET_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("WEB_TICKET_SECRET 이 없거나 너무 짧습니다.");
  }

  return new TextEncoder().encode(secret);
}

function toViewer(payload: Record<string, unknown>): AppViewer | null {
  const { ownerKey, uid, name, provider } = payload;

  if (
    typeof ownerKey !== "string" ||
    ownerKey.length === 0 ||
    typeof uid !== "string" ||
    typeof name !== "string"
  ) {
    return null;
  }

  return {
    ownerKey,
    uid,
    name,
    provider: typeof provider === "string" ? provider : "app",
  };
}

// NestJS 티켓 검증: 서명, 발급자, 대상, 만료, 용도를 모두 확인한다.
export async function verifyTicket(ticket: string): Promise<AppViewer | null> {
  try {
    const { payload } = await jwtVerify(ticket, getSecret(), {
      issuer: TICKET_ISSUER,
      audience: TICKET_AUDIENCE,
      algorithms: ["HS256"],
    });

    if (payload.purpose !== "app-web-ticket") return null;

    return toViewer(payload);
  } catch (error) {
    console.warn("[app-session] 티켓 검증 실패:", (error as Error).message);

    return null;
  }
}

export async function signAppSession(viewer: AppViewer): Promise<string> {
  return new SignJWT({ purpose: "app-session", ...viewer })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${APP_SESSION_MAX_AGE}s`)
    .sign(getSecret());
}

// 서버 컴포넌트와 서버 액션에서 앱 사용자를 읽는다. 쿠키가 없으면 null.
export async function getAppViewer(): Promise<AppViewer | null> {
  const token = (await cookies()).get(APP_SESSION_COOKIE)?.value;

  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
      algorithms: ["HS256"],
    });

    if (payload.purpose !== "app-session") return null;

    return toViewer(payload);
  } catch {
    return null;
  }
}