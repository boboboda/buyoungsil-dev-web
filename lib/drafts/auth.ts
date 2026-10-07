import { createHash, timingSafeEqual } from "crypto";

// 초안 수신용 토큰 검사. 서버 환경변수 DRAFT_API_TOKEN 과 Authorization: Bearer 값을 비교한다.
export function isValidDraftToken(authorization: string | null): boolean {
  const expected = process.env.DRAFT_API_TOKEN;
  if (!expected || expected.length < 24) return false; // 토큰이 없거나 너무 짧으면 수신 자체를 막는다

  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  // 해시로 길이를 맞춘 뒤 상수 시간 비교
  const given = createHash("sha256").update(match[1].trim()).digest();
  const want = createHash("sha256").update(expected).digest();

  return timingSafeEqual(new Uint8Array(given), new Uint8Array(want));
}
