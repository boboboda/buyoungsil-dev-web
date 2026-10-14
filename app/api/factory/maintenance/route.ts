// app/api/factory/maintenance/route.ts
// 감독 프로그램 ↔ 공장 정비. 작업 PC 토큰으로만.
//   { action: "start", turnId }                                   대기 중인 정비 지시를 시작으로 표시
//   { action: "report", turnId, logs?: string[], done?: { ok, text, sessionId?, pushedCommit?, needsDeploy? } }
//   { action: "deploy_start", threadId, commit }                  사람이 누른 배포를 시작
//   { action: "deploy_done", threadId, ok, output }               배포 결과
//   { action: "server_change", turnId?, text }                    serverctl 이 서버 설정을 바꿀 때 기록(값 없음)
// report 는 헤더 X-Request-Id 가 같으면 한 번만 처리한다(감독 프로그램의 재전송 대기열 중복 방지).
// 다음 지시와 배포 요청은 /api/factory/next 응답의 maintenance, maintenanceDeploy 로 내려간다.
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { markRequest, requestIdOf, seenRequest } from "@/lib/factory/requestSeen";
import { deployFinished, deployStarted, noteServerChange, reportTurn, startTurn } from "@/lib/factory/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ID = /^[A-Za-z0-9_-]{1,40}$/;

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > 256 * 1024) return fail(413, "너무 큽니다.");
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail(400, "JSON 형식이 아닙니다.");

  try {
    let r;

    if (body.action === "start" && typeof body.turnId === "string" && ID.test(body.turnId)) r = await startTurn(body.turnId, body.aiEngine === undefined ? "claude" : body.aiEngine);
    else if (body.action === "report") {
      // 재전송 대기열이 같은 보고를 다시 보낸 것이면(X-Request-Id) 다시 처리하지 않는다
      const requestId = requestIdOf(req);

      if (await seenRequest(requestId)) return NextResponse.json({ ok: true, duplicate: true });
      r = await reportTurn(body);
      if (r.ok) await markRequest(requestId);
    }
    else if (body.action === "deploy_start" && typeof body.threadId === "string" && ID.test(body.threadId) && typeof body.commit === "string") {
      r = await deployStarted(body.threadId, body.commit);
    } else if (body.action === "deploy_done" && typeof body.threadId === "string" && ID.test(body.threadId)) {
      r = await deployFinished(body.threadId, body.ok === true, typeof body.output === "string" ? body.output : "");
    } else if (body.action === "server_change" && typeof body.text === "string") {
      r = await noteServerChange(typeof body.turnId === "string" && ID.test(body.turnId) ? body.turnId : null, body.text);
    } else return fail(400, "action 이 올바르지 않습니다.");

    if (!r.ok) return fail(r.status, r.message);

    return NextResponse.json({ ok: true, message: r.message });
  } catch (error) {
    console.error("[factory] maintenance 처리 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
