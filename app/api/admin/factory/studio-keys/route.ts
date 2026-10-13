// app/api/admin/factory/studio-keys/route.ts
// 통제실 "Studio 접근 키": 앱별 상태 목록·발급(원문은 이 응답에서 한 번만)·폐기. 관리자만, 같은 사이트 요청만(CSRF). lib/studio/access.ts
// 로그에는 앱 이름·관리자·동작만 남긴다(키·해시·헤더 값 없음).
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth/get-sesstion";
import { hit } from "@/lib/factory/http";
import { isSameOriginRequest, issueStudioKey, listStudioKeys, revokeStudioKey } from "@/lib/studio/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_WRITES_PER_MINUTE = 20;
const NO_STORE = { "Cache-Control": "no-store" };

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

// 관리자면 식별(이메일 또는 id), 아니면 null
async function adminId(): Promise<string | null> {
  const session = await auth().catch(() => null);

  if (session?.user?.role !== "admin") return null;

  return session.user.email || session.user.id || "admin";
}

async function guardWrite(req: NextRequest): Promise<{ who: string } | { res: NextResponse }> {
  const who = await adminId();

  if (!who) return { res: reply(403, { message: "권한이 없습니다." }) };
  if (!isSameOriginRequest((n) => req.headers.get(n))) return { res: reply(403, { message: "통제실 화면에서만 할 수 있어요." }) };
  if (hit("admin:studio-keys", MAX_WRITES_PER_MINUTE)) return { res: reply(429, { message: "요청이 너무 많아요. 잠시 뒤 다시 해 주세요." }) };

  return { who };
}

const readApp = async (req: NextRequest) => ((await req.json().catch(() => null)) as { app?: unknown } | null)?.app;

export async function GET() {
  if (!(await adminId())) return reply(403, { message: "권한이 없습니다." });
  try {
    return reply(200, await listStudioKeys());
  } catch {
    console.error("[studio] 키 목록 조회 실패");
    return reply(500, { message: "목록을 읽지 못했어요. 마이그레이션이 적용됐는지 확인하세요." });
  }
}

export async function POST(req: NextRequest) {
  const g = await guardWrite(req);

  if ("res" in g) return g.res;
  const app = await readApp(req);

  try {
    const r = await issueStudioKey(app, g.who);

    if ("message" in r) {
      console.warn(`[studio] 키 발급 거절: ${r.status} by=${g.who}`);
      return reply(r.status, { message: r.message });
    }
    console.info(`[studio] 키 발급: app=${r.app} by=${g.who}${r.replaced ? " (이전 키 폐기)" : ""}`);

    return reply(200, { ok: true, app: r.app, key: r.key, createdAt: r.createdAt.toISOString(), replaced: r.replaced > 0 });
  } catch {
    console.error(`[studio] 키 발급 실패 by=${g.who}`);
    return reply(500, { message: "발급하지 못했어요." });
  }
}

export async function DELETE(req: NextRequest) {
  const g = await guardWrite(req);

  if ("res" in g) return g.res;
  const app = await readApp(req);

  try {
    const r = await revokeStudioKey(app);

    if ("message" in r) {
      console.warn(`[studio] 키 폐기 거절: ${r.status} by=${g.who}`);
      return reply(r.status, { message: r.message });
    }
    console.info(`[studio] 키 폐기: app=${r.app} by=${g.who}`);

    return reply(200, { ok: true, app: r.app });
  } catch {
    console.error(`[studio] 키 폐기 실패 by=${g.who}`);
    return reply(500, { message: "폐기하지 못했어요." });
  }
}
