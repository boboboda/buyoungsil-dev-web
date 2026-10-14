// app/api/factory/project-links/route.ts
// 감독 프로그램이 앱 폴더의 git 원격·브랜치와 서버 컨테이너 이름(읽기만 한 값)을 알려 주는 주소. 하루 1회와 통제실 [새로 읽기] 때.
// 요청: POST JSON { apps: [{ folder, isGit, branch, stack, remotes: [{ name, url }] }], servers: { serverpc|serverpc2: { state: "ok", names: [...] } | { state: "unknown" } } }
// 원격 주소의 자격 증명은 여기서 버린다. 저장은 factory_settings 한 칸.
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { validateReport } from "@/lib/factory/projectLinks";
import { saveReport } from "@/lib/factory/projectLinksDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  const body = await readJson(req);

  if (body.ok === false) return body.res;
  const parsed = validateReport(body.body);

  if (parsed.ok === false) return fail(400, parsed.reason);
  try {
    await saveReport(parsed.report);

    return NextResponse.json({ ok: true, apps: parsed.report.apps.length });
  } catch (error) {
    console.error("[factory] project-links 저장 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
