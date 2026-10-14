// app/api/factory/report/route.ts
// 감독 프로그램이 진행 단계, 로그, 완료, 실패를 보고하는 주소. 보고할 때마다 임대가 10분 연장된다.
//
// 요청: POST, 헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>, 본문 JSON
//   { "jobId": "cm…", "phase": "build", "logs": [ { "level": "info", "message": "빌드 시작" } ] }
//   { "jobId": "cm…", "status": "done", "summary": "홈, 결과 화면 완료. 빌드 통과." }
//   { "jobId": "cm…", "status": "failed", "failReason": "빌드 오류: …" }
//   { "jobId": "cm…", "status": "review", "summary": "…" }
//   { "jobId": "cm…", "status": "linkwait", "summary": "…" }   (스토어 수정: 홍보 영상을 만들고 반영까지 끝낸 뒤 YouTube 링크 대기)   (출시 일감: 자료를 만들고 검토 대기로. 검토가 필요한 일감은 승인 전 done 도 review 로 둔다)
//   완료 때 "build": { versionName, versionCode, aabPath, aabSize, tests, track, uploaded, uploadNote } (앱 업데이트 빌드 결과, 선택)
// 재전송 대기열(배포 중 쌓았다 다시 보냄)의 중복 방지: 헤더 X-Request-Id 가 같으면 한 번만 처리하고 나머지는 200 { ok, duplicate: true }
// 응답: 200 { ok, status, finalCheck? } (finalCheck: { appSlug, group } = 지휘자가 묶은 그룹의 마지막 일감이 완료됨. 감독 프로그램이 앱 전체 검사를 돌려 /api/factory/conductor 로 알린다) / running 이 아닌 지시는 409 (취소된 경우 { cancelled: true 포함 })
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { parseReport, reportJob } from "@/lib/factory/jobs";
import { markRequest, requestIdOf, seenRequest } from "@/lib/factory/requestSeen";
import { notifyJobEvent } from "@/lib/factory/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const read = await readJson(req);
  if (read.ok === false) return read.res;

  const parsed = parseReport(read.body);
  if (parsed.ok === false) return fail(400, parsed.reason);

  // 재전송 대기열이 같은 보고를 다시 보낸 것이면(X-Request-Id) 다시 처리하지 않는다
  const requestId = requestIdOf(req);
  if (await seenRequest(requestId)) return NextResponse.json({ ok: true, duplicate: true });

  try {
    const out = await reportJob(parsed.value);

    if (out.kind === "not_found") return fail(404, "없는 지시입니다.");
    if (out.kind === "conflict") {
      return fail(409, `지시가 실행 중이 아닙니다(${out.status}).`, { cancelled: out.cancelled, status: out.status });
    }

    await markRequest(requestId);

    // 끝났거나 실패했으면 텔레그램으로 알린다. (실패해도 보고 응답에는 영향 없음)
    if (out.status === "done" || out.status === "failed" || out.status === "review" || out.status === "linkwait" || out.status === "needs_confirmation") void notifyJobEvent(parsed.value.jobId, out.status);

    return NextResponse.json({ ok: true, status: out.status, leaseUntil: out.leaseUntil, ...(out.finalCheck ? { finalCheck: out.finalCheck } : {}) });
  } catch (error) {
    console.error("[factory] report 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
