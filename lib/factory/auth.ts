import { createHash, timingSafeEqual } from "crypto";

// 감독 프로그램(내 PC)이 보내는 요청용 토큰 검사.
// 서버 환경변수 FACTORY_WORKER_TOKEN 과 Authorization 헤더 값을 비교한다.
// "Authorization: Bearer <토큰>" 과 "Authorization: <토큰>" 둘 다 허용한다. (초안함 토큰과 같은 방식)
// 초안함(DRAFT_API_TOKEN)·상태 수신(CLAUDE_STATUS_TOKEN) 토큰과 같은 값이면 거부한다.
// (토큰 하나가 새도 다른 통로가 같이 열리지 않게)
const sha = (v: string) => createHash("sha256").update(v).digest();

export function isValidFactoryWorkerToken(authorization: string | null): boolean {
  const expected = process.env.FACTORY_WORKER_TOKEN;
  if (!expected || expected.length < 24) return false;

  for (const other of [process.env.DRAFT_API_TOKEN, process.env.CLAUDE_STATUS_TOKEN]) {
    if (other && other === expected) return false;
  }

  const header = authorization?.trim();
  if (!header) return false;

  const match = header.match(/^Bearer\s+(.+)$/i);
  const candidate = (match ? match[1] : header).trim();

  return timingSafeEqual(new Uint8Array(sha(candidate)), new Uint8Array(sha(expected)));
}
