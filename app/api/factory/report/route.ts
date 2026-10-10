// app/api/factory/report/route.ts
// 감독 프로그램이 진행 단계, 로그, 완료, 실패를 보고하는 주소. 보고할 때마다 임대가 10분 연장된다.
//
// 요청: POST, 헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>, 본문 JSON
//   { "jobId": "cm…", "phase": "build", "logs": [ { "level": "info", "message": "빌드 시작" } ] }
//   { "jobId": "cm…", "status": "done", "summary": "홈, 결과 화면 완료. 빌드 통과." }
//   { "jobId": "cm…", "status": "failed", "failReason": "빌드 오류: …" }
// 응답: 200 { ok, status } / running 이 아닌 지시는 409 (취소된 경우 { cancelled: true 포함 })
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { parseReport, reportJob } from "@/lib/factory/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const read = await readJson(req);
  if (read.ok === false) return read.res;

  const parsed = parseReport(read.body);
  if (parsed.ok === false) return fail(400, parsed.reason);

  try {
    const out = await reportJob(parsed.value);

    if (out.kind === "not_found") return fail(404, "없는 지시입니다.");
    if (out.kind === "conflict") {
      return fail(409, `지시가 실행 중이 아닙니다(${out.status}).`, { cancelled: out.cancelled, status: out.status });
    }

    return NextResponse.json({ ok: true, status: out.status, leaseUntil: out.leaseUntil });
  } catch (error) {
    console.error("[factory] report 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
