// app/api/factory/pc-status/route.ts
// 감독 프로그램이 배포 계정의 서명 키·서비스 계정 키 파일이 PC 에 "있는지"만 알려 주는 주소. 파일 내용은 오지 않는다.
// 확인할 경로는 /api/factory/next 응답의 pcPaths 로 내려간다(통제실에 등록된 경로만).
//
// 요청: POST JSON { items: [ { key, path, exists, size, mtime } ] }
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { savePcPathStatus } from "@/lib/factory/release";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const body = (await req.json().catch(() => null)) as { items?: unknown } | null;
  if (!body) return fail(400, "JSON 형식이 아닙니다.");

  try {
    const saved = await savePcPathStatus(body.items);

    return NextResponse.json({ ok: true, saved });
  } catch (error) {
    console.error("[factory] pc-status 저장 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
