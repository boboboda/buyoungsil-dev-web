// app/api/studio/make/route.ts
// 공용 스튜디오 [제작] 탭의 [생성]: 카드로 도구 일감(kind=tool, 2-3)을 등록한다. 관리자 로그인만(접근 키 사용자는 읽기 전용).
//   POST { appSlug, card, subjects[], count?, extra?, refArtIds?, confirmed? }
//     → 201 { message, jobId, autoApproved }
//     → 409 { needsConfirm: { reason, estimatedCost, usage }, message }  일·월 비용 한도를 넘어서 확인이 필요함. confirmed:true 로 다시 보내면 등록(통제실 [그대로 진행]과 같은 효과)
//     → 400 { message }  입력·카드 문제(2-3 등록 검사와 같다)
// 승인 규칙은 2-3 설정(비용 한도 안이면 자동 승인)을 그대로 따른다. 키 값은 오가지 않는다.
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { enqueueToolJob } from "@/lib/factory/toolJobsDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const STUDIO_SOURCE = "스튜디오";

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "요청 형식이 올바르지 않아요." }, { status: 400, headers: NO_STORE });
  const { appSlug, card, subjects, count, extra, refArtIds, confirmed } = body;
  const r = await enqueueToolJob({ appSlug, card, subjects, count, extra, refArtIds, confirmed: confirmed === true }, { source: STUDIO_SOURCE, askLimit: true });

  if (r.ok === false) return NextResponse.json({ message: r.message, ...(r.needsConfirm ? { needsConfirm: r.needsConfirm } : {}) }, { status: r.needsConfirm ? 409 : 400, headers: NO_STORE });

  return NextResponse.json({ message: r.message, jobId: r.id, autoApproved: r.autoApproved }, { status: 201, headers: NO_STORE });
}
