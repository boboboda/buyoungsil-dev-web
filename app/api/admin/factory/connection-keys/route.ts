// app/api/admin/factory/connection-keys/route.ts
// 블로그 설정 "연결 키": 목록·만들기(원문은 이 응답에서 한 번만)·폐기. 관리자만(requireAdmin), 쓰기는 같은 사이트 요청만(CSRF).
// 로그에는 동작·관리자만 남긴다(키·해시·헤더 값 없음). lib/connect/adminKeys.ts
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth/get-sesstion";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createConnectionKey, listConnectionKeys, revokeConnectionKey } from "@/lib/connect/adminKeys";
import { hit } from "@/lib/factory/http";
import { isSameOriginRequest } from "@/lib/studio/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

async function guardWrite(req: NextRequest): Promise<{ who: string } | { res: NextResponse }> {
  const denied = await requireAdmin();

  if (denied) return { res: denied };
  if (!isSameOriginRequest((n) => req.headers.get(n))) return { res: reply(403, { message: "관리자 화면에서만 할 수 있어요." }) };
  if (hit("admin:connection-keys", 20)) return { res: reply(429, { message: "요청이 너무 많아요. 잠시 뒤 다시 해 주세요." }) };
  const session = await auth().catch(() => null);

  return { who: session?.user?.email || session?.user?.id || "admin" };
}

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;
  try {
    return reply(200, await listConnectionKeys());
  } catch {
    console.error("[connect] 연결 키 목록 조회 실패");
    return reply(500, { message: "목록을 읽지 못했어요." });
  }
}

export async function POST(req: NextRequest) {
  const g = await guardWrite(req);

  if ("res" in g) return g.res;
  const label = ((await req.json().catch(() => null)) as { label?: unknown } | null)?.label;

  try {
    const r = await createConnectionKey(label, g.who);

    if ("message" in r) return reply(r.status, { message: r.message });
    console.info(`[connect] 연결 키 생성: id=${r.id} by=${g.who}`);

    return reply(200, { ok: true, id: r.id, label: r.label, prefix: r.prefix, key: r.key });
  } catch {
    console.error(`[connect] 연결 키 생성 실패 by=${g.who}`);
    return reply(500, { message: "만들지 못했어요." });
  }
}

export async function DELETE(req: NextRequest) {
  const g = await guardWrite(req);

  if ("res" in g) return g.res;
  const id = ((await req.json().catch(() => null)) as { id?: unknown } | null)?.id;

  try {
    const r = await revokeConnectionKey(id);

    if ("message" in r) return reply(r.status, { message: r.message });
    console.info(`[connect] 연결 키 폐기: id=${String(id)} by=${g.who}`);

    return reply(200, { ok: true });
  } catch {
    console.error(`[connect] 연결 키 폐기 실패 by=${g.who}`);
    return reply(500, { message: "폐기하지 못했어요." });
  }
}
