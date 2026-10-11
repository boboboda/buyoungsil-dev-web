// app/api/factory/store-assets/route.ts
// 감독 프로그램이 스토어 자료 검사 결과(단계별 상태·경로·크기·영상 길이·문구)와 Play 업로드 결과를 보내는 주소(출시 2단계).
// 파일은 받지 않는다(이미지는 /api/factory/store-image, 영상은 서버로 보내지 않음).
//
// 요청: POST JSON (lib/factory/storeAssets.ts receiveStoreReport 참고), 헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>
// 응답: 200 { ok, message } / 실행 중이 아니면 409
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { receiveStoreReport } from "@/lib/factory/storeAssets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const read = await readJson(req);
  if (read.ok === false) return read.res;
  if (!read.body || typeof read.body !== "object" || Array.isArray(read.body)) return fail(400, "JSON 객체가 아닙니다.");

  try {
    const r = await receiveStoreReport(read.body as Record<string, unknown>);

    return r.ok ? NextResponse.json({ ok: true, message: r.message }) : fail(r.status, r.message);
  } catch (error) {
    console.error("[factory] store-assets 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
