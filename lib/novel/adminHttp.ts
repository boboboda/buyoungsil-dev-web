// lib/novel/adminHttp.ts
// 소설 관리자 API 공용: 관리자 확인(requireAdmin)·요청 수 제한·주소 값 검사·작은 JSON 읽기·결과 응답.
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { hit } from "@/lib/factory/http";
import { MAX_NUMBER, SLUG_RE } from "@/lib/novel/rules";
import { type AdminResult } from "@/lib/novel/store";

const MAX_WRITES_PER_MINUTE = 60;
const MAX_BODY_BYTES = 16 * 1024;

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export const bad = (message: string, status = 400) => json({ message }, status);

/** 관리자가 아니면 403, 쓰기 요청이 너무 많으면 429 */
export async function adminGate(write = false): Promise<NextResponse | null> {
  const denied = await requireAdmin();

  if (denied) return denied;
  if (write && hit("admin:novel", MAX_WRITES_PER_MINUTE))
    return bad("요청이 너무 많아요. 잠시 뒤 다시 해 주세요.", 429);

  return null;
}

export const validSlug = (s: string) => SLUG_RE.test(s);

export function validNumber(s: string): number | null {
  if (!/^\d{1,4}$/.test(s)) return null;
  const n = Number(s);

  return n >= 1 && n <= MAX_NUMBER ? n : null;
}

/** 본문이 없어도 되는 요청은 {} 로 */
export async function readSmallJson(
  req: NextRequest,
): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; res: NextResponse }
> {
  const text = await req.text().catch(() => "");

  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES)
    return { ok: false, res: bad("요청이 너무 커요.", 413) };
  if (!text.trim()) return { ok: true, body: {} };
  try {
    const body = JSON.parse(text);

    return body && typeof body === "object" && !Array.isArray(body)
      ? { ok: true, body }
      : { ok: false, res: bad("JSON 객체가 아니에요.") };
  } catch {
    return { ok: false, res: bad("JSON 형식이 아니에요.") };
  }
}

export const resultResponse = <T>(r: AdminResult<T>) =>
  r.ok === false
    ? bad(r.message, r.status)
    : json({ ok: true, ...(r.value ?? {}) });
