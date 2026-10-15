// app/api/factory/plan/route.ts
// 계획 먼저 승인(5-1): 감독 프로그램이 읽기 전용 AI 턴으로 만든 계획을 알리는 주소. 헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>
//   { jobId, ok: true, plan, model?, usage? }       계획 3~6줄. 서버가 정리(제어문자·비밀번호·길이)해서 저장하고 통제실·텔레그램에 선택 단추를 보낸다
//   { jobId, action: "skip" }                      지금은 계획하지 못함(앱 폴더에서 다른 일감이 돌고 있음). 차례만 되돌려 다음 확인 때 다시 받는다
//   { jobId, ok: false, reason, model?, usage? }    계획을 못 만듦(AI 실행 실패·읽기 전용 위반·시간 초과). 사람이 계획 없이 진행/다시 계획/취소를 고른다
// 응답: 200 { ok, message } | 404 | 409(이미 사람이 고른 상태 등: 늦게 온 결과는 무시)
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { ID_RE } from "@/lib/factory/jobs";
import { recordPlan, releasePlan } from "@/lib/factory/planFirst";
import { notifyPlanReady } from "@/lib/factory/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  const read = await readJson(req);

  if (read.ok === false) return read.res;
  const b = read.body as Record<string, unknown> | null;

  if (!b || typeof b !== "object" || Array.isArray(b)) return fail(400, "요청 형식이 올바르지 않습니다.");
  const jobId = typeof b.jobId === "string" ? b.jobId : "";

  if (!ID_RE.test(jobId)) return fail(400, "jobId 형식이 올바르지 않습니다.");
  if (b.action === "skip") {
    const r = await releasePlan(jobId).catch(() => null);

    return NextResponse.json({ ok: !!r?.ok, message: r?.message ?? "처리하지 못했어요." }, { status: r?.status ?? 500 });
  }
  if (typeof b.ok !== "boolean") return fail(400, "ok 를 확인해 주세요.");

  try {
    const r = await recordPlan(jobId, { ok: b.ok, plan: b.plan, reason: b.reason, usage: b.usage, model: b.model });

    if (r.ok && r.notify) void notifyPlanReady(jobId);

    return NextResponse.json({ ok: r.ok, message: r.message }, { status: r.status });
  } catch (error) {
    console.error("[factory] plan 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
