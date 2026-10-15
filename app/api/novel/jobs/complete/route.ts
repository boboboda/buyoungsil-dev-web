// app/api/novel/jobs/complete/route.ts
// 소설 실행기의 완료 보고(7-1). 작업 PC 토큰 인증.
// POST { id, ok, verdict?, mustCount?, recCount?, charCount?, costUsd?, summary?, logTail?, chapter?, review?, appliedNoteIds? }
//   chapter(chapters/NNN.md)·review(reviews/NNN.md)를 주면 화 원고·검수 사본에 저장한다(공개 본문·화 상태는 건드리지 않음). appliedNoteIds 는 applied 로.
// 응답 200 { ok, status } / 404 / 409(실행 중이 아님)
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { parseComplete } from "@/lib/novel/jobRules";
import { completeJob } from "@/lib/novel/jobStore";
import { MAX_REPORT_BYTES } from "@/lib/novel/rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  let body: unknown;

  try {
    const text = await req.text();

    if (new TextEncoder().encode(text).length > MAX_REPORT_BYTES * 2) return fail(413, "요청이 너무 큽니다.");
    body = JSON.parse(text);
  } catch {
    return fail(400, "JSON 형식이 아닙니다.");
  }
  const id = (body as { id?: unknown } | null)?.id;

  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return fail(400, "id 가 필요해요.");
  const parsed = parseComplete(body);

  if (parsed.ok === false) return fail(400, parsed.reason);
  try {
    const r = await completeJob(id, parsed.value);

    return r.ok === false ? fail(r.status, r.message) : NextResponse.json({ ok: true, status: r.value.status });
  } catch (error) {
    console.error("[novel-jobs] complete 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
