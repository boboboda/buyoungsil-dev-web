// app/api/novel/jobs/recover/route.ts
// 감독 프로그램이 시작할 때 한 번: 이 PC 에서 running 으로 남은 소설 작업을 failed 로 정리한다(7-1). 작업 PC 토큰 인증.
// POST {} → { ok, failed }  재시작 뒤 같은 작업이 중복 실행되거나 영원히 running 으로 남지 않게 한다.
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { recoverRunning } from "@/lib/novel/jobStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  try {
    return NextResponse.json({ ok: true, failed: await recoverRunning() });
  } catch (error) {
    console.error("[novel-jobs] recover 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
