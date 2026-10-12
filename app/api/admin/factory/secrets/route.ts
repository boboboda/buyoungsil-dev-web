// app/api/admin/factory/secrets/route.ts
// 통제실 "외부 서비스 키(환경변수)": 목록(값 없음)·등록/교체·삭제 요청과 AI 도구 상태. 관리자만. lib/factory/secretEntries.ts
// 값은 POST 로 들어오기만 하고 어떤 응답·로그에도 다시 나가지 않는다(로그에는 이름과 동작만).
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { hit } from "@/lib/factory/http";
import { registerSecretEntry, requestSecretDelete, secretEntryStatuses } from "@/lib/factory/secretEntries";
import { getSupervisorRuntime, type SupervisorRuntime } from "@/lib/factory/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_WRITES_PER_MINUTE = 30;
const MAX_BODY_BYTES = 8 * 1024; // 값 4096자 + 이름·설명

const tooMany = () => NextResponse.json({ message: "요청이 너무 많아요. 잠시 뒤 다시 해 주세요." }, { status: 429 });

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const [list, rt] = await Promise.all([secretEntryStatuses(), getSupervisorRuntime().catch(() => ({}) as SupervisorRuntime)]);

  return NextResponse.json(
    { ...list, aiTools: { claude: rt.claudeTool ?? null, codex: rt.codexTool ?? null, at: rt.aiToolsAt ?? null } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (hit("admin:secrets", MAX_WRITES_PER_MINUTE)) return tooMany();

  const text = await req.text().catch(() => "");
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return NextResponse.json({ message: "요청이 너무 커요." }, { status: 413 });
  let body: { name?: unknown; description?: unknown; value?: unknown } | null = null;

  try {
    body = JSON.parse(text);
  } catch {
    /* 아래에서 거절 */
  }
  if (!body || typeof body !== "object") return NextResponse.json({ message: "JSON 형식이 아니에요." }, { status: 400 });

  try {
    const r = await registerSecretEntry(body.name, body.description, body.value);

    if (r.ok) console.info(`[factory] 외부 서비스 키 ${r.replaced ? "교체" : "등록"}: ${String(body.name).trim()}`);

    return NextResponse.json({ ok: r.ok, message: r.message }, { status: r.status });
  } catch {
    console.error("[factory] 외부 서비스 키 등록 실패"); // 값·오류 객체는 남기지 않는다
    return NextResponse.json({ message: "처리에 실패했어요." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (hit("admin:secrets", MAX_WRITES_PER_MINUTE)) return tooMany();

  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = body?.name ?? req.nextUrl.searchParams.get("name");

  try {
    const r = await requestSecretDelete(name);

    if (r.ok) console.info(`[factory] 외부 서비스 키 삭제 요청: ${String(name).trim()}`);

    return NextResponse.json({ ok: r.ok, message: r.message }, { status: r.status });
  } catch {
    console.error("[factory] 외부 서비스 키 삭제 요청 실패");
    return NextResponse.json({ message: "처리에 실패했어요." }, { status: 500 });
  }
}
