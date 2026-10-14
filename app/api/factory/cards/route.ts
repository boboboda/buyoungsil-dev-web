// app/api/factory/cards/route.ts
// 결과물 카드의 감독 프로그램용 주소 (lib/factory/cardsDb.ts). 읽기만.
//   GET ?appSlug=…  → { cards: [{ id, name, version, tool, method, settings, rules, pinned }] }  (켜진 카드만. settings 는 카드로 만든 pixel-art 프로젝트 설정)
//   감독 프로그램이 pixel-art 를 부르기 직전에 받아 .factory/cards/ 에 두고, 호출의 card 인자(카드 id 또는 이름)로 그 설정을 --settings 로 붙인다.
//   헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>. 키 값은 없다(설명서가 정한 키 이름도 싣지 않는다: 키는 일감의 requiredSecrets 가 정한다).
import { NextRequest, NextResponse } from "next/server";

import { cardRunsForApp } from "@/lib/factory/cardsDb";
import { fail, guardWorker } from "@/lib/factory/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  const appSlug = req.nextUrl.searchParams.get("appSlug") ?? "";

  try {
    return NextResponse.json({ cards: await cardRunsForApp(appSlug) });
  } catch (error) {
    console.error("[factory] cards 목록 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
