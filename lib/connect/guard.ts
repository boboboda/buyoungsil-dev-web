// lib/connect/guard.ts
// 연결 키 API 공통 관문 도우미: 요청 수 제한(서버 프로세스 안에서만 셈)과 같은 사이트 요청 확인(CSRF).
const WINDOW_MS = 60_000;
const counters = new Map<string, { start: number; count: number }>();

/** 한도를 넘었으면 true. */
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

/** 관리자 화면에서 보낸 요청인지(CSRF 방어). 쿠키를 싣고 다른 사이트에서 보낸 요청은 거절한다. */
export function isSameOriginRequest(get: (name: string) => string | null): boolean {
  const site = get("sec-fetch-site");

  if (site) return site === "same-origin";
  const host = get("x-forwarded-host") || get("host");
  const source = get("origin") || get("referer");

  if (!host || !source) return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}
