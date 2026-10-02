// app/api/analytics/collect/route.ts
// 앱이 이벤트를 묶어서 보내는 주소. 헤더 x-analytics-key 로 어떤 앱인지 확인한다.
import { NextRequest, NextResponse } from "next/server";

import {
  findAppByKey,
  saveEvents,
  validatePayload,
} from "@/lib/analytics/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_CHARS = 100 * 1024;
const WINDOW_MS = 60_000;
const MAX_PER_IP_PER_WINDOW = 60;
const MAX_PER_KEY_PER_WINDOW = 300;

const counters = new Map<string, { start: number; count: number }>();

function isRateLimited(id: string, limit: number): boolean {
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

function getClientIP(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");

  if (forwardedFor) return forwardedFor.split(",")[0].trim();

  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

const fail = (status: number, message: string) =>
  NextResponse.json({ message }, { status });

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-analytics-key");

  if (!key) return fail(401, "수집 키가 없습니다.");

  if (
    isRateLimited(`ip:${getClientIP(req)}`, MAX_PER_IP_PER_WINDOW) ||
    isRateLimited(`key:${key}`, MAX_PER_KEY_PER_WINDOW)
  ) {
    return fail(429, "요청이 너무 많습니다.");
  }

  let app: { id: string; appId: string } | null;

  try {
    app = await findAppByKey(key);
  } catch (error) {
    console.error("[analytics] 키 확인 실패:", error);

    return fail(500, "서버 오류입니다.");
  }

  if (!app) return fail(401, "유효하지 않은 수집 키입니다.");

  let body: unknown;

  try {
    const text = await req.text();

    if (text.length > MAX_BODY_CHARS) return fail(413, "요청이 너무 큽니다.");
    body = JSON.parse(text);
  } catch {
    return fail(400, "JSON 형식이 아닙니다.");
  }

  const result = validatePayload(body);

  if ("reason" in result) return fail(400, result.reason);

  try {
    const { saved } = await saveEvents(app.id, result.payload);

    return NextResponse.json(
      {
        accepted: result.payload.events.length,
        saved,
        dropped: result.dropped,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[analytics] 이벤트 저장 실패:", error);

    return fail(500, "이벤트 저장에 실패했습니다.");
  }
}