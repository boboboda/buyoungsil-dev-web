import { createHash, timingSafeEqual } from "crypto";

import prisma from "@/lib/prisma";

// 감독 프로그램(내 PC)이 보내는 요청용 토큰 검사.
// 1순위: 통제실에서 발급한 토큰. DB 에는 sha256 해시만 있고, 요청 토큰의 해시로 찾는다.
// 2순위(예비): 서버 환경변수 FACTORY_WORKER_TOKEN. 있으면 계속 통한다.
// "Authorization: Bearer <토큰>" 과 "Authorization: <토큰>" 둘 다 허용한다. (초안함 토큰과 같은 방식)
// 환경변수 토큰은 초안함(DRAFT_API_TOKEN)·상태 수신(CLAUDE_STATUS_TOKEN) 토큰과 같은 값이면 거부한다.
const sha = (v: string) => createHash("sha256").update(v).digest();
const TOUCH_MS = 60_000; // 마지막 접속 시각은 1분에 한 번만 갱신한다

export const hashWorkerToken = (token: string) => createHash("sha256").update(token).digest("hex");

function extractCandidate(authorization: string | null): string | null {
  const header = authorization?.trim();
  if (!header) return null;

  const match = header.match(/^Bearer\s+(.+)$/i);
  const candidate = (match ? match[1] : header).trim();

  return candidate.length >= 16 && candidate.length <= 200 ? candidate : null;
}

function matchesEnvToken(candidate: string): boolean {
  const expected = process.env.FACTORY_WORKER_TOKEN;
  if (!expected || expected.length < 24) return false;

  for (const other of [process.env.DRAFT_API_TOKEN, process.env.CLAUDE_STATUS_TOKEN]) {
    if (other && other === expected) return false;
  }

  return timingSafeEqual(new Uint8Array(sha(candidate)), new Uint8Array(sha(expected)));
}

export async function isValidFactoryWorkerToken(authorization: string | null): Promise<boolean> {
  const candidate = extractCandidate(authorization);
  if (!candidate) return false;

  if (matchesEnvToken(candidate)) return true;

  try {
    const row = await prisma.factoryWorkerToken.findUnique({
      where: { tokenHash: hashWorkerToken(candidate) },
      select: { id: true, lastUsedAt: true },
    });
    if (!row) return false;

    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_MS) {
      await prisma.factoryWorkerToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    }

    return true;
  } catch (error) {
    console.error("[factory] 토큰 확인 실패:", error);

    return false;
  }
}
