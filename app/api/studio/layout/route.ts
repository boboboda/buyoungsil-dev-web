// app/api/studio/layout/route.ts
// 공용 스튜디오 [제작] > [배치] 편집기의 행동: 저장(판 번호 +1) · 옛 판으로 되돌림 · 기존 배치 불러오기 · 내보내기. 관리자 로그인만(접근 키 사용자는 읽기 전용).
//   POST { appSlug, action: save, board, baseVersion, note? }       → 200 { message, version } | 409 { message, currentVersion }
//   POST { appSlug, action: restore, version, baseVersion }          → 200 { message, version }
//   POST { appSlug, action: import, baseVersion, json? | fromService: true } → 200 { message, version, warnings }
//   POST { appSlug, action: export, version? }                       → 201 { message, jobId? } | 501 서비스 API 미지원
// 앱 폴더는 직접 고치지 않는다(내보내기는 앱 수정 일감으로만). 서비스 쪽은 설정한 경로로 읽기·내보내기만 한다. 키 값은 오가지 않는다.
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth/get-sesstion";
import { requireAdmin } from "@/lib/factory/admin";
import { exportLayout, importLayout, restoreLayout, saveLayout, type LayoutResult } from "@/lib/studio/layoutData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const MAX_BODY = 400 * 1024;

const send = (r: LayoutResult, okStatus = 200) =>
  r.ok === false
    ? NextResponse.json({ message: r.message, ...(r.currentVersion !== undefined ? { currentVersion: r.currentVersion } : {}) }, { status: r.status, headers: NO_STORE })
    : NextResponse.json({ message: r.message, ...(r.version !== undefined ? { version: r.version } : {}), ...(r.warnings ? { warnings: r.warnings } : {}), ...(r.jobId ? { jobId: r.jobId } : {}) }, { status: okStatus, headers: NO_STORE });

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const len = Number(req.headers.get("content-length") ?? 0);

  if (len > MAX_BODY) return NextResponse.json({ message: "요청이 너무 커요." }, { status: 413, headers: NO_STORE });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "요청 형식이 올바르지 않아요." }, { status: 400, headers: NO_STORE });
  const appSlug = typeof body.appSlug === "string" ? body.appSlug : "";

  if (!SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 형식이 올바르지 않아요." }, { status: 400, headers: NO_STORE });
  const session = await auth().catch(() => null);
  const who = session?.user?.name || session?.user?.email || "관리자";

  try {
    if (body.action === "save") return send(await saveLayout(appSlug, body.board, body.baseVersion, who, typeof body.note === "string" ? body.note : ""));
    if (body.action === "restore") return send(await restoreLayout(appSlug, body.version, body.baseVersion, who));
    if (body.action === "import") return send(await importLayout(appSlug, body.json !== undefined ? { json: body.json } : { fromService: body.fromService === true }, body.baseVersion, who));
    if (body.action === "export") return send(await exportLayout(appSlug, body.version, who), 201);
  } catch (e) {
    console.error("[studio] 배치 행동 실패:", e instanceof Error ? e.name : "unknown");

    return NextResponse.json({ message: "처리하지 못했어요. 잠시 뒤 다시 해 주세요." }, { status: 500, headers: NO_STORE });
  }

  return NextResponse.json({ message: "알 수 없는 행동이에요." }, { status: 400, headers: NO_STORE });
}
