// lib/factory/requestSeen.ts
// 감독 프로그램의 재전송 대기열(배포 중 홈페이지가 응답하지 않는 동안 쌓았다가 순서대로 다시 보냄)이 같은 보고를 두 번 보내도
// 한 번만 처리되게 한다. 요청 번호는 헤더 X-Request-Id(감독 프로그램이 보고마다 새로 만들고, 다시 보낼 때는 같은 번호).
// 처리에 성공한 뒤에만 번호를 남긴다(처리 도중 실패한 요청은 다시 보내면 처리된다). 번호가 없으면(예전 감독 프로그램) 아무것도 하지 않는다.
import type { NextRequest } from "next/server";

import prisma from "@/lib/prisma";

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const KEEP_MS = 24 * 60 * 60 * 1000;
let lastCleanup = 0;

export function requestIdOf(req: NextRequest): string | null {
  const v = req.headers.get("x-request-id");

  return v && REQUEST_ID_RE.test(v) ? v : null;
}

/** 이미 처리한 요청 번호인가. DB 가 안 되면 false(그냥 처리한다). */
export async function seenRequest(id: string | null): Promise<boolean> {
  if (!id) return false;
  try {
    return !!(await prisma.factoryRequestSeen.findUnique({ where: { id }, select: { id: true } }));
  } catch {
    return false;
  }
}

/** 처리를 끝냈다고 남긴다. 실패해도 응답에는 영향 없음. */
export async function markRequest(id: string | null): Promise<void> {
  if (!id) return;
  try {
    await prisma.factoryRequestSeen.upsert({ where: { id }, create: { id }, update: {} });
    if (Date.now() - lastCleanup > 60 * 60 * 1000) {
      lastCleanup = Date.now();
      await prisma.factoryRequestSeen.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_MS) } } });
    }
  } catch {
    /* 기록 실패는 무시 */
  }
}
