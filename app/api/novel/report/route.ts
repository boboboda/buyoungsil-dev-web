// app/api/novel/report/route.ts
// 소설 실행기(작업 PC)가 작품 설정·화 진행을 보고하는 주소. 작업 PC 토큰 인증(guardWorker).
//
// 요청: POST, 헤더 Authorization: Bearer <작업 PC 토큰>, 본문 JSON (최대 256KB: 본문 10만 자가 들어가서 이 라우트만 크게)
//   { "kind": "setup", "slug": "my-novel", "title": "…", "genre": "…", "logline": "…", "setupSummary": "마크다운 …" }
//   { "kind": "episode", "slug": "my-novel", "number": 12, "status": "pending_approval", "title": "…", "body": "…",
//     "summary": "…", "attempts": 1, "checkResult": { "pass": true, "issues": [] }, "tokens": { "writer": { "model": "opus", "in": 0, "out": 0 } },
//     "logs": [ { "level": "info", "message": "검수 시작" } ] }
// 응답: 200 { ok, status } / 검증 실패 400 / 없는 작품 404 / 이미 승인됐거나 사람 차례인 화 409 { status }
// (작품, 화 번호) 기준으로 덮어써서 재전송해도 안전하다. lib/novel/
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { notifyNovel } from "@/lib/novel/notify";
import { MAX_REPORT_BYTES, parseNovelReport } from "@/lib/novel/rules";
import { reportNovel } from "@/lib/novel/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;

  let body: unknown;

  try {
    const text = await req.text();

    if (new TextEncoder().encode(text).length > MAX_REPORT_BYTES)
      return fail(413, "요청이 너무 큽니다.");
    body = JSON.parse(text);
  } catch {
    return fail(400, "JSON 형식이 아닙니다.");
  }

  const parsed = parseNovelReport(body);

  if (parsed.ok === false) return fail(400, parsed.reason);

  try {
    const out = await reportNovel(parsed.value);

    if (out.kind === "not_found")
      return fail(404, "없는 작품입니다. 먼저 설정(kind: setup)을 보고하세요.");
    if (out.kind === "rejected")
      return fail(
        out.code,
        out.reason,
        out.status ? { status: out.status } : undefined,
      );

    notifyNovel(out.notify, out.workTitle, out.number);

    return NextResponse.json({ ok: true, status: out.status });
  } catch (error) {
    console.error("[novel] report 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
