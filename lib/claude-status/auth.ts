import { createHash, timingSafeEqual } from "crypto";

// Claude Code 훅이 보내는 상태 이벤트용 토큰 검사.
// 서버 환경변수 CLAUDE_STATUS_TOKEN 과 Authorization 헤더 값을 비교한다.
// "Authorization: Bearer <토큰>" 과 "Authorization: <토큰>" 둘 다 허용한다. (초안함 토큰과 같은 방식)
export function isValidClaudeStatusToken(
  authorization: string | null,
): boolean {
  const expected = process.env.CLAUDE_STATUS_TOKEN;

  if (!expected || expected.length < 24) return false; // 토큰이 없거나 너무 짧으면 수신 자체를 막는다

  const header = authorization?.trim();

  if (!header) return false;

  const match = header.match(/^Bearer\s+(.+)$/i);
  const candidate = (match ? match[1] : header).trim();

  // 해시로 길이를 맞춘 뒤 상수 시간 비교
  const given = createHash("sha256").update(candidate).digest();
  const want = createHash("sha256").update(expected).digest();

  return timingSafeEqual(new Uint8Array(given), new Uint8Array(want));
}
