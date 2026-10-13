// app/api/novel/sync/route.ts
// 소설 실행기(작업 PC)가 폴링해서 일시정지·설정 승인·승인 방식·행동이 필요한 화(최근 승인, 수정 요청 메모, 승인 대기, 보류)를 가져간다.
// 홈페이지가 PC 로 들어가지 않으므로 사람의 승인·수정 요청은 모두 여기로 전달된다. 중단·완결 작품은 빠진다.
// 응답: { works: [ { slug, status, paused, setupApproved, approvalMode, publishPerDay, episodes: [ { number, status, revisionNote? } ] } ] }
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { syncNovels } from "@/lib/novel/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;

  try {
    return NextResponse.json(await syncNovels(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[novel] sync 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
