// app/api/factory/service-token/route.ts
// 감독 프로그램(serverctl service-token)이 서비스 관리자 토큰을 키 보관함에 넣거나 되돌리는 주소(워커 토큰만). lib/factory/serviceToken.ts
// 이름은 SERVICE_ADMIN_TOKEN_* 만. 값은 요청 본문에만 있고 응답·로그에 남기지 않는다.
//
// POST { name, value }                      → 200 { ok: true, version, replaced }   (암호화해 서버 보관 키로 저장, 되돌리기용 이전 상태 한 단계 보관)
// POST { name, rollback: true, version }    → 200 { ok: true, restored: "previous" | "deleted" }   (그 version 저장을 되돌림. 그 사이 바뀌었으면 409)
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { putServiceToken, rollbackServiceToken } from "@/lib/factory/serviceToken";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const parsed = await readJson(req);
  if (parsed.ok === false) return parsed.res;
  const body = parsed.body as { name?: unknown; value?: unknown; rollback?: unknown; version?: unknown } | null;
  if (!body || typeof body !== "object") return fail(400, "JSON 형식이 아닙니다.");

  try {
    if (body.rollback === true) {
      const r = await rollbackServiceToken(body.name, body.version);

      if (r.ok === false) return fail(r.status, r.message);

      return NextResponse.json({ ok: true, restored: r.restored });
    }
    const r = await putServiceToken(body.name, body.value);

    if (r.ok === false) return fail(r.status, r.message);

    return NextResponse.json({ ok: true, version: r.version, replaced: r.replaced });
  } catch {
    console.error("[factory] 서비스 관리자 토큰 보관 처리 실패"); // 값·오류 객체는 남기지 않는다
    return fail(500, "처리에 실패했습니다.");
  }
}
