// app/api/factory/release/route.ts
// 감독 프로그램이 출시 준비 일감(kind=release)이 만든 패키지(.factory/outbox/release.json)를 보내는 주소.
// 실행 중인 출시 준비 일감에서만 받는다. AAB 는 경로·크기·버전·빌드 시각만(파일은 PC 에만).
//
// 요청: POST JSON { jobId, storeListing?, dataSafety?, contentRating?, checklist?, privacyPolicyDraft?, sdks?, notes?, aab? }
// 응답: 200 { ok, message } / 일감이 없으면 404 / 출시 준비 일감이 아니면 400 / 실행 중이 아니면 409
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { receiveReleasePackage } from "@/lib/factory/release";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > 300 * 1024) return fail(413, "패키지가 너무 큽니다.");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail(400, "JSON 형식이 아닙니다.");

  try {
    const r = await receiveReleasePackage(body);

    if (!r.ok) return fail(r.status, r.message);

    return NextResponse.json({ ok: true, message: r.message });
  } catch (error) {
    console.error("[factory] release 패키지 저장 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
