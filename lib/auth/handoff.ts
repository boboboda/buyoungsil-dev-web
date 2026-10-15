import { randomBytes } from "node:crypto";

import { SignJWT } from "jose";

// 블로그(OAuth 로그인) → 통제실(factory.buyoungsilcoding.com) 로그인 넘김용 1회용 토큰.
// 통제실의 /auth/enter 가 같은 약속(발급자·대상·용도·비밀값)으로 검증한다.
export const HANDOFF_ISSUER = "buyoungsil-blog";
export const HANDOFF_AUDIENCE = "buyoungsil-control";
export const HANDOFF_PURPOSE = "control-handoff";
export const HANDOFF_TTL_SECONDS = 60;
export const HANDOFF_DEFAULT_TO = "/admin/factory";
export const HANDOFF_PATH = "/api/admin/handoff";

const DEFAULT_CONTROL_URL = "https://factory.buyoungsilcoding.com";
const TO_RE = /^\/(admin\/factory|studio)(\/|\?|$)/;

export type HandoffUser = { id: string; email: string; name: string };

// 통제실에서 열 수 있는 경로만 허용한다. 그 밖(외부 주소·// 시작 포함)은 기본 경로로 바꾼다.
export function safeHandoffTo(raw: string | null | undefined): string {
  if (!raw || !TO_RE.test(raw) || raw.includes("\\") || /[\r\n]/.test(raw)) return HANDOFF_DEFAULT_TO;

  return raw;
}

export function controlBaseUrl(): string {
  return (process.env.CONTROL_PUBLIC_URL || DEFAULT_CONTROL_URL).replace(/\/+$/, "");
}

// 비밀값이 없거나 짧으면 발급하지 않고 오류를 던진다.
export async function signHandoffTicket(user: HandoffUser, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const secret = process.env.CONTROL_HANDOFF_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("CONTROL_HANDOFF_SECRET 이 없거나 너무 짧습니다.");
  }

  return new SignJWT({
    purpose: HANDOFF_PURPOSE,
    email: user.email,
    name: user.name,
    role: "admin",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(HANDOFF_ISSUER)
    .setAudience(HANDOFF_AUDIENCE)
    .setSubject(user.id)
    .setJti(randomBytes(16).toString("hex"))
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + HANDOFF_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
}

export function handoffUrl(ticket: string, to: string): string {
  return `${controlBaseUrl()}/auth/enter?ticket=${ticket}&to=${encodeURIComponent(to)}`;
}
