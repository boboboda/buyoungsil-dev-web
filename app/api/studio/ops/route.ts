// app/api/studio/ops/route.ts
// 공용 스튜디오 [운영] 탭의 행동: 검수(승인·반려·되돌림·다시 요청·기본 그림), 내보내기, 생성 일정 저장. 관리자 로그인만(접근 키 사용자는 읽기 전용).
//   POST { appSlug, action: approve|reject|reset, ids[] }  → 200 { message, changed }
//   POST { appSlug, action: redo, ids[], confirmed? }       → 201 { message, jobIds } | 409 { needsConfirm, message } (비용 한도 초과: confirmed:true 로 다시)
//   POST { appSlug, action: default, artId }                → 200 { message }
//   POST { appSlug, action: copy }                          → 200 { message, changed } 승인 그림을 업로드 서버로 복사([지금 복사], 원본 서버는 건드리지 않음)
//   POST { appSlug, action: export, ids[] }                 → 201 { message, jobIds } | 501 서비스 업로드 미지원
//   POST { appSlug, action: schedule, cardId, schedule: { enabled, hour, count, subjects, extra } } → 200 { message }
// 앱 폴더는 직접 고치지 않는다(내보내기는 앱 수정 일감으로만). 서비스 DB 는 건드리지 않는다. 키 값은 오가지 않는다.
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth/get-sesstion";
import { requireAdmin } from "@/lib/factory/admin";
import { copyAllArts, decideMany, exportArts, redoMany, saveSchedule, setDefaultArt, type OpsResult } from "@/lib/studio/opsData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

const send = (r: OpsResult, okStatus = 200) =>
  r.ok === false
    ? NextResponse.json({ message: r.message, ...(r.needsConfirm ? { needsConfirm: r.needsConfirm } : {}) }, { status: r.status, headers: NO_STORE })
    : NextResponse.json({ message: r.message, ...(r.jobIds ? { jobIds: r.jobIds } : {}), ...(r.changed !== undefined ? { changed: r.changed } : {}) }, { status: okStatus, headers: NO_STORE });

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "요청 형식이 올바르지 않아요." }, { status: 400, headers: NO_STORE });
  const appSlug = typeof body.appSlug === "string" ? body.appSlug : "";

  if (!SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 형식이 올바르지 않아요." }, { status: 400, headers: NO_STORE });
  const session = await auth().catch(() => null);
  const who = session?.user?.name || session?.user?.email || "관리자";
  const action = body.action;

  try {
    if (action === "approve" || action === "reject" || action === "reset") return send(await decideMany(appSlug, body.ids, action, who));
    if (action === "redo") return send(await redoMany(appSlug, body.ids, body.confirmed === true), 201);
    if (action === "default") return send(await setDefaultArt(appSlug, body.artId, who));
    if (action === "copy") return send(await copyAllArts(appSlug));
    if (action === "export") return send(await exportArts(appSlug, body.ids, who), 201);
    if (action === "schedule") {
      const s = (body.schedule ?? {}) as Record<string, unknown>;

      return send(await saveSchedule(appSlug, body.cardId, { enabled: s.enabled === true, hour: Number(s.hour), count: Number(s.count), subjects: typeof s.subjects === "string" ? s.subjects : "", extra: typeof s.extra === "string" ? s.extra : "" }, who));
    }
  } catch (e) {
    console.error("[studio] 운영 행동 실패:", e instanceof Error ? e.name : "unknown");

    return NextResponse.json({ message: "처리하지 못했어요. 잠시 뒤 다시 해 주세요." }, { status: 500, headers: NO_STORE });
  }

  return NextResponse.json({ message: "알 수 없는 행동이에요." }, { status: 400, headers: NO_STORE });
}
