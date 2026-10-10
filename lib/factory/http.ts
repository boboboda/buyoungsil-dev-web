// 앱 공장 워커 API 공용: 요청 수 제한, 인증, 응답 도우미.
import { NextRequest, NextResponse } from "next/server";

import { isValidFactoryWorkerToken } from "@/lib/factory/auth";

const WINDOW_MS = 60_000;
export const MAX_PER_IP_PER_WINDOW = 120;
export const MAX_AUTH_FAILS_PER_WINDOW = 20;
export const MAX_JSON_BYTES = 64 * 1024;

const counters = new Map<string, { start: number; count: number }>();

// 한도를 넘었으면 true. (같은 서버 프로세스 안에서만 센다. claude-status 와 같은 방식)
export function hit(id: string, limit: number): boolean {
  const now = Date.now();

  if (counters.size > 5000) {
    for (const [k, v] of counters) {
      if (now - v.start > WINDOW_MS) counters.delete(k);
    }
  }

  const entry = counters.get(id);

  if (!entry || now - entry.start > WINDOW_MS) {
    counters.set(id, { start: now, count: 1 });
    return false;
  }

  entry.count += 1;
  return entry.count > limit;
}

export function getClientIP(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export const fail = (status: number, message: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ message, ...extra }, { status });

// 워커 요청 공통 관문. 통과하면 null, 막히면 보낼 응답을 돌려준다.
export function guardWorker(req: NextRequest): NextResponse | null {
  const ip = getClientIP(req);

  if (hit(`ip:${ip}`, MAX_PER_IP_PER_WINDOW)) return fail(429, "요청이 너무 많습니다.");

  if (!isValidFactoryWorkerToken(req.headers.get("authorization"))) {
    // 토큰을 계속 틀리는 요청은 따로 세어서 막는다.
    if (hit(`fail:${ip}`, MAX_AUTH_FAILS_PER_WINDOW)) return fail(429, "요청이 너무 많습니다.");
    return fail(401, "권한이 없습니다.");
  }

  return null;
}

// JSON 본문을 64KB 안에서 읽는다. 실패하면 응답을 돌려준다.
export async function readJson(
  req: NextRequest,
): Promise<{ ok: true; body: unknown } | { ok: false; res: NextResponse }> {
  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) {
      return { ok: false, res: fail(413, "요청이 너무 큽니다.") };
    }
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, res: fail(400, "JSON 형식이 아닙니다.") };
  }
}
