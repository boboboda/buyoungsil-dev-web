// app/api/factory/tool-manifests/route.ts
// 감독 프로그램(도구 중계)이 툴킷의 도구 설명서(tools/manifests/<도구>.json)를 읽어 보내는 주소. 시작할 때와 툴킷 커밋·설명서가 바뀌었을 때.
// 요청: POST JSON { commit: "툴킷 커밋", tools: [설명서…] }  (설명서 파일이 없는 도구는 감독이 만든 최소 설명서, source: "fallback")
// 키는 이름만 받는다. 저장은 factory_settings 한 칸(도구마다 최신 설명서 하나).
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { validateManifestReport } from "@/lib/factory/toolManifest";
import { saveManifestReport } from "@/lib/factory/toolManifestDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  const body = await readJson(req);

  if (body.ok === false) return body.res;
  const parsed = validateManifestReport(body.body);

  if (parsed.ok === false) return fail(400, parsed.reason);
  try {
    await saveManifestReport(parsed.report);

    return NextResponse.json({ ok: true, tools: Object.keys(parsed.report.tools).length, commit: parsed.report.commit });
  } catch (error) {
    console.error("[factory] tool-manifests 저장 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
