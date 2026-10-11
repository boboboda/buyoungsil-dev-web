// app/api/admin/factory/release/route.ts
// 통제실 "출시 패키지": 배포 계정 A/B, 앱별 출시 상태, 출시 준비 일감 보내기. 관리자만.
// 키·비밀번호 값은 여기로 오가지 않는다(PC 경로와 키 "이름"만).
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { APP_SLUG_RE, adminAction } from "@/lib/factory/jobs";
import { enqueueReleaseJob } from "@/lib/factory/mcp";
import { releaseOverview, removeAppRelease, saveReleaseAccount, updateAppRelease } from "@/lib/factory/release";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await releaseOverview());
}

// 본문: { action: "saveAccount", ...계정 } | { action: "updateApp", appSlug, releaseAccountId?, releaseStatus?, packageName?, firstUploadDone? }
//       | { action: "enqueueRelease", appSlug, runNow? }
//       | { action: "removeApps", appSlugs: string[] }  (출시 패키지 목록에서만 지움. 지시 기록·앱 소스·PC 파일은 그대로)
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
    // 커넥터 도구(enqueue_release_job)와 같은 함수: 지시문은 배포 계정 정보로 서버가 만든다
    const r = await enqueueReleaseJob({ appSlug, source: "통제실 출시 패키지" });
    const message = r.content[0]?.text ?? "";

    if (r.isError) return NextResponse.json({ message }, { status: 409 });
    const id = /id: ([A-Za-z0-9_-]+)/.exec(message)?.[1];

    if (body?.runNow === true && id) {
      const approved = await adminAction(id, { action: "approve" });

      res = { ok: true, status: 200, message: approved.ok ? "출시 준비 일감을 보내고 바로 승인했어요." : message };
    } else {
      res = { ok: true, status: 200, message: "출시 준비 일감을 보냈어요. 승인하면 시작해요." };
    }
  } else if (action === "removeApps") {
    const slugs = Array.isArray(body?.appSlugs) ? body.appSlugs.filter((s): s is string => typeof s === "string").map((s) => s.trim()) : [];

    if (slugs.length > 50 || slugs.some((s) => !APP_SLUG_RE.test(s))) return NextResponse.json({ message: "appSlugs 가 올바르지 않아요." }, { status: 400 });
    res = await removeAppRelease(slugs);
  } else {
    return NextResponse.json({ message: "action 은 saveAccount, updateApp, enqueueRelease, removeApps 중 하나예요." }, { status: 400 });
  }

  return NextResponse.json({ message: res.message, ...(res.ok ? await releaseOverview() : {}) }, { status: res.status });
}
