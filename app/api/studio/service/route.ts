// app/api/studio/service/route.ts
// 공용 스튜디오 [운영] → 서비스 운영: 관리자 세션이면 서비스 관리자 API 를 홈페이지 서버가 대신 부른다(권한 하나로). 접근 키 사용자는 쓸 수 없다.
//   GET  ?appSlug=…&what=health[&refresh=1]            → { health }                    (연결 상태. refresh=1 이면 [지금 확인], 아니면 10분 캐시)
//   GET  ?appSlug=…&what=pipeline|gen-log              → { state: ok|no-api|need-key|error, value|keyName|reason }
//   GET  ?appSlug=…&what=candidates&status=review|held|pending → 같은 모양 (그림 주소 포함)
//   POST { appSlug, action: schedule-on|schedule-off|run|approve|reject|retry, confirmed: true, id?, kind?, lines? } → 200 { message } / 404 서비스 API 없음 / 409 키 필요 / 502 서비스 실패
// 서비스 키(SERVICE_ADMIN_TOKEN_<앱>)는 서버 보관 키에서 서버 안에서만 읽는다. 브라우저·응답·로그에 값이 없다. 쓰기는 누가 언제 했는지 기록한다.
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth/get-sesstion";
import { requireAdmin } from "@/lib/factory/admin";
import { isSameOriginRequest } from "@/lib/studio/access";
import { serviceProfileOf } from "@/lib/studio/service";
import { getServiceHealth, resolveServiceBase } from "@/lib/studio/serviceHealth";
import { prismaAudit, readCandidates, readGenLog, readPipeline, readServiceActions, runServiceWrite } from "@/lib/studio/serviceOps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  const appSlug = q.get("appSlug") ?? "";

  if (!SLUG_RE.test(appSlug)) return json({ message: "appSlug 형식이 올바르지 않아요." }, 400);
  if (!serviceProfileOf(appSlug)) return json({ message: "이 프로젝트는 서비스 확인표가 없어요." }, 404);
  const what = q.get("what") ?? "health";

  try {
    if (what === "health") return json({ health: await getServiceHealth(appSlug, { force: q.get("refresh") === "1" }), actions: await readServiceActions(appSlug).catch(() => []) });
    const base = await resolveServiceBase(appSlug).catch(() => null);

    if (what === "pipeline") return json(await readPipeline({ appSlug, base }));
    if (what === "gen-log") return json(await readGenLog({ appSlug, base }));
    if (what === "candidates") return json(await readCandidates({ appSlug, base }, q.get("status") ?? "review"));
  } catch (e) {
    console.error("[studio] 서비스 읽기 실패:", e instanceof Error ? e.name : "unknown");

    return json({ state: "error", reason: "처리하지 못했어요. 잠시 뒤 다시 해 주세요." }, 500);
  }

  return json({ message: "알 수 없는 요청이에요." }, 400);
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  if (!isSameOriginRequest((n) => req.headers.get(n))) return json({ message: "관리자 화면에서 보낸 요청만 받아요." }, 403);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ message: "요청 형식이 올바르지 않아요." }, 400);
  const appSlug = typeof body.appSlug === "string" ? body.appSlug : "";

  if (!SLUG_RE.test(appSlug)) return json({ message: "appSlug 형식이 올바르지 않아요." }, 400);
  const session = await auth().catch(() => null);
  const who = session?.user?.name || session?.user?.email || "관리자";

  try {
    const base = await resolveServiceBase(appSlug).catch(() => null);
    const r = await runServiceWrite({ appSlug, base }, { action: body.action, confirmed: body.confirmed, who, id: body.id, kind: body.kind, lines: body.lines }, await prismaAudit());

    return r.ok === false ? json({ message: r.message, ...(r.noApi ? { noApi: true } : {}) }, r.status) : json({ message: r.message });
  } catch (e) {
    console.error("[studio] 서비스 쓰기 실패:", e instanceof Error ? e.name : "unknown");

    return json({ message: "처리하지 못했어요. 잠시 뒤 다시 해 주세요." }, 500);
  }
}
