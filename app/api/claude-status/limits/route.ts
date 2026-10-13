// app/api/claude-status/limits/route.ts
// 작업 PC 가 AI 구독 한도 사용률을 보내는 주소. 인증은 상태 훅과 같은 토큰(CLAUDE_STATUS_TOKEN).
//
// 요청: POST, 헤더 Authorization: Bearer <CLAUDE_STATUS_TOKEN>, 본문 JSON
//   {
//     "provider": "claude | codex",
//     "device": "기기 이름",
//     "status": "ok | failed",   // 선택, 기본 ok. failed 면 창 값 없이 실패 시각과 짧은 사유(reason)만 남긴다
//     "source": "statusline | auto | stream",  // 선택. 없으면 claude=statusline, codex=auto
//     "measuredAt": 유닉스 초,   // 선택, 작업 PC 가 읽은 시각. 저장된 값보다 오래됐으면 버린다(응답 saved:false)
//     "fiveHour": { "usedPct": 23.5, "resetsAt": 유닉스 초 },  // 선택
//     "sevenDay": { "usedPct": 41.2, "resetsAt": 유닉스 초 },  // 선택 (ok 이면 둘 중 하나는 있어야 함)
//     "extra": [{ "key": "seven_day_opus", "usedPct": 3, "resetsAt": 유닉스 초 | null }]  // 선택, 모델별 주간 한도 등
//   }
// 사용률과 초기화 시각만 받는다. 정해진 필드 외의 값은 무시한다.
import { NextRequest, NextResponse } from "next/server";

import { isValidClaudeStatusToken } from "@/lib/claude-status/auth";
import { saveLimits, validateLimitsPayload } from "@/lib/claude-status/limits";
import { getClientIP, hit } from "@/lib/factory/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_CHARS = 4 * 1024;
const MAX_PER_IP_PER_WINDOW = 120;
const MAX_AUTH_FAILS_PER_WINDOW = 20;

const fail = (status: number, message: string) =>
  NextResponse.json({ message }, { status });

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);

  if (hit(`limits-ip:${ip}`, MAX_PER_IP_PER_WINDOW))
    return fail(429, "요청이 너무 많습니다.");

  if (!isValidClaudeStatusToken(req.headers.get("authorization"))) {
    if (hit(`limits-fail:${ip}`, MAX_AUTH_FAILS_PER_WINDOW))
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

  const result = validateLimitsPayload(body);

  if (result.ok === false) return fail(400, result.reason);

  try {
    const { saved } = await saveLimits(result.payload);

    return NextResponse.json({ ok: true, saved }, { status: 200 });
  } catch (error) {
    console.error("[claude-status] 한도 저장 실패:", error);

    return fail(500, "저장에 실패했습니다.");
  }
}
