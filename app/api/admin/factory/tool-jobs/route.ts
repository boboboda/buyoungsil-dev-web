// app/api/admin/factory/tool-jobs/route.ts
// 통제실 스튜디오의 도구 일감(2-3): AI 없이 카드로 바로 생성. 관리자만.
//   GET  ?appSlug=…                          → { settings, usage: { day, month }, jobs: [최근 도구 일감 10개] }
//   POST { action: "settings", settings: { autoApprove?, autoApproveMaxCost?, concurrency?, dailyLimit?, monthlyLimit? } } → 설정 저장
//   POST { action: "create", appSlug, card, subject|subjects, count?, extra?, refArtIds? }                              → 도구 일감 등록('통제실' 출처)
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/factory/admin";
import { cleanToolResult, readToolInput, TOOL_KIND } from "@/lib/factory/toolJobs";
import { enqueueToolJob, getToolSettings, setToolSettings, toolUsage } from "@/lib/factory/toolJobsDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const NO_STORE = { "Cache-Control": "no-store" };

async function snapshot(appSlug: string) {
  const [settings, usage, rows] = await Promise.all([
    getToolSettings(),
    toolUsage(),
    SLUG_RE.test(appSlug) ? prisma.factoryJob.findMany({ where: { kind: TOOL_KIND, appSlug }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, title: true, status: true, cardId: true, createdAt: true, finishedAt: true, failReason: true, toolInput: true, toolResult: true } }) : Promise.resolve([]),
  ]);

  return {
    settings,
    usage,
    jobs: rows.map((r) => ({ id: r.id, title: r.title, status: r.status, cardId: r.cardId, createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, failReason: r.failReason, input: readToolInput(r.toolInput), result: cleanToolResult(r.toolResult) })),
  };
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await snapshot(req.nextUrl.searchParams.get("appSlug") ?? ""), { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "요청 형식이 올바르지 않아요." }, { status: 400 });
  if (body.action === "settings") {
    await setToolSettings(body.settings);

    return NextResponse.json({ message: "도구 일감 설정을 저장했어요.", ...(await snapshot(typeof body.appSlug === "string" ? body.appSlug : "")) }, { headers: NO_STORE });
  }
  if (body.action === "create") {
    const r = await enqueueToolJob(body, { source: "통제실" });

    if (r.ok === false) return NextResponse.json({ message: r.message }, { status: 400 });

    return NextResponse.json({ message: r.message, jobId: r.id, ...(await snapshot(typeof body.appSlug === "string" ? body.appSlug : "")) }, { headers: NO_STORE });
  }

  return NextResponse.json({ message: "알 수 없는 동작이에요." }, { status: 400 });
}
