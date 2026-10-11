// app/api/admin/factory/release/route.ts
// 통제실 "출시 패키지": 배포 계정 A/B, 앱별 출시 상태, 출시 준비 일감 보내기. 관리자만.
// 키·비밀번호 값은 여기로 오가지 않는다(PC 경로와 키 "이름"만).
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { APP_SLUG_RE, adminAction } from "@/lib/factory/jobs";
import { enqueue } from "@/lib/factory/mcp";
import { buildReleasePlan, releaseOverview, saveReleaseAccount, updateAppRelease } from "@/lib/factory/release";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await releaseOverview());
}

// 본문: { action: "saveAccount", ...계정 } | { action: "updateApp", appSlug, releaseAccountId?, releaseStatus?, packageName?, firstUploadDone? }
//       | { action: "enqueueRelease", appSlug, runNow? }
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  const appSlug = typeof body?.appSlug === "string" ? body.appSlug.trim() : "";
  let res: { ok: boolean; status: number; message: string };

  if (action === "saveAccount") {
    res = await saveReleaseAccount(body ?? {});
  } else if (action === "updateApp") {
    if (!APP_SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 가 올바르지 않아요." }, { status: 400 });
    res = await updateAppRelease(appSlug, body ?? {});
  } else if (action === "enqueueRelease") {
    if (!APP_SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 가 올바르지 않아요." }, { status: 400 });
    const plan = await buildReleasePlan(appSlug);

    if ("message" in plan) return NextResponse.json({ message: plan.message }, { status: 400 });
    const overview = await releaseOverview();
    const title = overview.apps.find((a) => a.appSlug === appSlug)?.title ?? appSlug;
    const r = await enqueue({
      appSlug,
      title: `${title} (출시 준비)`,
      kind: "release",
      planMarkdown: plan.plan,
      requiredSecrets: plan.requiredSecrets,
      source: "통제실 출시 패키지",
    });
    const message = r.content[0]?.text ?? "";

    if (r.isError) return NextResponse.json({ message }, { status: 409 });
    const id = /id: ([A-Za-z0-9_-]+)/.exec(message)?.[1];

    if (body?.runNow === true && id) {
      const approved = await adminAction(id, { action: "approve" });

      res = { ok: true, status: 200, message: approved.ok ? "출시 준비 일감을 보내고 바로 승인했어요." : message };
    } else {
      res = { ok: true, status: 200, message: "출시 준비 일감을 보냈어요. 승인하면 시작해요." };
    }
  } else {
    return NextResponse.json({ message: "action 은 saveAccount, updateApp, enqueueRelease 중 하나예요." }, { status: 400 });
  }

  return NextResponse.json({ message: res.message, ...(res.ok ? await releaseOverview() : {}) }, { status: res.status });
}
