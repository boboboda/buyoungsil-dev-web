// app/api/claude-status/route.ts
// 사용자 PC 의 Claude Code 훅이 작업 상태를 보내는 주소.
//
// 요청: POST, 헤더 Authorization: Bearer <CLAUDE_STATUS_TOKEN>, 본문 JSON
//   {
//     "event": "SessionStart | UserPromptSubmit | PreToolUse | PostToolUse | Notification | Stop | SubagentStop | SessionEnd",
//     "sessionId": "훅 입력의 session_id",
//     "project": "작업 폴더 이름(cwd 의 마지막 폴더)",
//     "device": "기기 이름",
//     "tool": "도구 이름 (선택, 도구 이벤트에만)",
//     "ts": 이벤트 시각 epoch ms (선택, 없으면 서버 시각),
//     "usage": { "input": 0, "output": 0, "cacheCreate": 0, "cacheRead": 0 }  // 세션 "누적" 토큰 (선택, SessionStart·Stop 에만)
//   }
// 프롬프트·코드 내용은 보내지 않는다. 정해진 필드 외의 값은 무시한다.
import { NextRequest, NextResponse } from "next/server";

import { isValidClaudeStatusToken } from "@/lib/claude-status/auth";
import { saveStatus, validatePayload } from "@/lib/claude-status/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_CHARS = 8 * 1024;
const WINDOW_MS = 60_000;
const MAX_PER_IP_PER_WINDOW = 600; // 도구 호출마다 쏘는 경우를 감안해 넉넉하게
const MAX_AUTH_FAILS_PER_WINDOW = 20;

const counters = new Map<string, { start: number; count: number }>();

function hit(id: string, limit: number): boolean {
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
  const ip = getClientIP(req);

  if (hit(`ip:${ip}`, MAX_PER_IP_PER_WINDOW))
    return fail(429, "요청이 너무 많습니다.");

  if (!isValidClaudeStatusToken(req.headers.get("authorization"))) {
    // 토큰을 계속 틀리는 요청은 따로 세어서 막는다.
    if (hit(`fail:${ip}`, MAX_AUTH_FAILS_PER_WINDOW))
      return fail(429, "요청이 너무 많습니다.");

    return fail(401, "권한이 없습니다.");
  }

  let body: unknown;

  try {
    const text = await req.text();

    if (text.length > MAX_BODY_CHARS) return fail(413, "요청이 너무 큽니다.");
    body = JSON.parse(text);
  } catch {
    return fail(400, "JSON 형식이 아닙니다.");
  }

  const result = validatePayload(body);

  if (result.ok === false) return fail(400, result.reason);

  try {
    await saveStatus(result.payload);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("[claude-status] 저장 실패:", error);

    return fail(500, "저장에 실패했습니다.");
  }
}
