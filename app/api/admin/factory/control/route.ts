// app/api/admin/factory/control/route.ts
// 감독 프로그램 켜기/끄기(일시 정지), 자동 업데이트 켜고 끄기, 지금 업데이트, 재시작, 연결 상태. 관리자만.
// 홈페이지는 PC 의 프로그램을 직접 켤 수 없다. 정해진 신호만 남긴다(lib/factory/supervisor.ts).
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { runSupervisorAction, supervisorSnapshot, type SupervisorAction } from "@/lib/factory/supervisor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await supervisorSnapshot());
}

// 본문: { enabled: boolean } | { autoUpdate: boolean } | { autoDeploy: boolean } | { updateNow: true } | { restart: true }
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    enabled?: unknown;
    autoUpdate?: unknown;
    autoDeploy?: unknown;
    updateNow?: unknown;
    restart?: unknown;
  } | null;

  let action: SupervisorAction | null = null;

  if (body?.restart === true) action = "restart";
  else if (body?.updateNow === true) action = "update_now";
  else if (typeof body?.autoDeploy === "boolean") action = body.autoDeploy ? "auto_deploy_on" : "auto_deploy_off";
  else if (typeof body?.autoUpdate === "boolean") action = body.autoUpdate ? "auto_update_on" : "auto_update_off";
  else if (typeof body?.enabled === "boolean") action = body.enabled ? "resume" : "pause";

  if (!action) {
    return NextResponse.json(
      { message: "enabled 또는 autoUpdate 는 true/false, updateNow·restart 는 true 여야 해요." },
      { status: 400 },
    );
  }

  const { message, snapshot } = await runSupervisorAction(action);

  return NextResponse.json({ ...snapshot, message });
}
