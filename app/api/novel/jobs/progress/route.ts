// app/api/novel/jobs/progress/route.ts
// 소설 실행기가 진행 로그(표준출력 끝 200줄)를 보내는 주소(7-1). 작업 PC 토큰 인증. 소식이 10분 끊기면 서버가 실패로 정리한다(하트비트 겸용).
// POST { id, logTail } → { ok, cancel }  cancel=true 면 사람이 취소했거나 이미 끝난 작업이니 실행기가 cycle.sh 를 멈춘다.
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { tailLines } from "@/lib/novel/jobRules";
import { reportProgress } from "@/lib/novel/jobStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  const read = await readJson(req, 128 * 1024);

  if (read.ok === false) return read.res;
  const b = read.body as { id?: unknown; logTail?: unknown } | null;

  if (!b || typeof b.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(b.id)) return fail(400, "id 가 필요해요.");
  try {
    const r = await reportProgress(b.id, tailLines(typeof b.logTail === "string" ? b.logTail : ""));

    return r.found ? NextResponse.json({ ok: true, cancel: r.cancel }) : fail(404, "없는 작업이에요.");
  } catch (error) {
    console.error("[novel-jobs] progress 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
