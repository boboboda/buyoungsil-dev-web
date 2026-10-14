// app/api/factory/conductor/route.ts
// 지휘자(병렬화 단계 C-2) 결과를 감독 프로그램이 알리는 주소. 헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>
//   { action: "verdict", appSlug, key, model?, verdict: { jobs: [{ id, files, areas, confidence, note }], groups: [{ jobIds, reason }], sequential: [{ jobIds, reason }] }, usage?: { ms, costUsd, tokens } }
//     AI 가 낸 판단. 서버가 다시 검사해서(겹침·확신도·공용 파일·우선순위) 안전한 묶음만 '같이 돌리기'로 묶는다.
//   { action: "fail", appSlug, key, model?, reason, usage? }  판단하지 못함(AI 실행 실패·읽기 전용 위반·시간 초과). 순서대로 두고 사유를 남긴다.
//   { action: "skip", appSlug, key }  지금은 판단하지 못함(앱 폴더에서 다른 일감이 돌고 있음). 기록 없이 다음 확인 때 다시 받는다.
//   { action: "final", appSlug, group, ok, detail? }  묶음의 마지막 일감까지 합친 뒤 기본 브랜치 최신 상태에서 돌린 앱 전체 검사 결과.
//     실패하면 '그룹 최종 점검 실패'로 통제실에 남기고 텔레그램으로 알린다(이미 합친 커밋은 되돌리지 않음).
// 응답: 200 { ok, message } (verdict 가 낡았으면 stale: true)
import { NextRequest, NextResponse } from "next/server";

import { applyVerdict, failVerdict, getSharedFiles, isAutoGroupEnabled, MODEL_RE, skipVerdict } from "@/lib/factory/conductor";
import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { APP_SLUG_RE } from "@/lib/factory/jobs";
import { completeFinalCheck, GROUP_RE } from "@/lib/factory/parallel";
import { getAppSlots, getParallelPerApp } from "@/lib/factory/settings";
import { notifyText } from "@/lib/factory/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  const read = await readJson(req);

  if (read.ok === false) return read.res;
  const b = read.body as Record<string, unknown> | null;

  if (!b || typeof b !== "object" || Array.isArray(b)) return fail(400, "요청 형식이 올바르지 않습니다.");
  const appSlug = typeof b.appSlug === "string" ? b.appSlug : "";

  if (!APP_SLUG_RE.test(appSlug)) return fail(400, "앱 이름이 올바르지 않습니다.");

  try {
    if (b.action === "final") {
      if (typeof b.group !== "string" || !GROUP_RE.test(b.group) || typeof b.ok !== "boolean") return fail(400, "group, ok 를 확인해 주세요.");
      const res = await completeFinalCheck({ appSlug, group: b.group, ok: b.ok, detail: typeof b.detail === "string" ? b.detail : "" });

      if (res.ok === false) return fail(res.status, res.message);
      if (res.notify) void notifyText(res.notify, "/admin/factory");

      return NextResponse.json({ ok: true, message: b.ok ? "최종 점검 통과를 남겼어요." : "그룹 최종 점검 실패를 남겼어요." });
    }
    if (b.action === "skip") {
      await skipVerdict();

      return NextResponse.json({ ok: true, message: "다음 확인 때 다시 판단해요." });
    }
    const key = typeof b.key === "string" && /^[a-f0-9]{8,40}$/.test(b.key) ? b.key : "";

    if (!key) return fail(400, "key 가 올바르지 않습니다.");
    const model = typeof b.model === "string" && MODEL_RE.test(b.model) ? b.model : null;
    const [autoGroup, perApp, slots, shared] = await Promise.all([isAutoGroupEnabled(), getParallelPerApp(), getAppSlots(), getSharedFiles()]);
    const args = { appSlug, key, model, usage: b.usage, shared: shared.value, settings: { autoGroup, perApp: perApp.value, appSlots: slots.value } };

    if (b.action === "verdict") {
      const res = await applyVerdict(b.verdict, args);

      return NextResponse.json({ ...res, ...(res.ok ? {} : { ok: false }) }, { status: 200 });
    }
    if (b.action === "fail") {
      const res = await failVerdict(typeof b.reason === "string" ? b.reason : "알 수 없는 이유", args);

      return NextResponse.json(res, { status: 200 });
    }

    return fail(400, "알 수 없는 동작입니다.");
  } catch (error) {
    console.error("[factory] conductor 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
