// app/api/admin/factory/secrets/route.ts
// 통제실 "외부 서비스 키(환경변수)": 목록(값 없음)·등록/교체·삭제 요청과 AI 도구 상태. 관리자만. lib/factory/secretEntries.ts
// 값은 POST 로 들어오기만 하고 어떤 응답·로그에도 다시 나가지 않는다(로그에는 이름과 동작만).
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { hit } from "@/lib/factory/http";
import { clearProvision, provisionStatuses, requestProvision } from "@/lib/factory/keyProvision";
import { checkSecretName, registerSecretEntry, requestSecretDelete, secretEntryStatuses } from "@/lib/factory/secretEntries";
import { getSupervisorRuntime, type SupervisorRuntime } from "@/lib/factory/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_WRITES_PER_MINUTE = 30;
const MAX_BODY_BYTES = 8 * 1024; // 값 4096자 + 이름·설명

const tooMany = () => NextResponse.json({ message: "요청이 너무 많아요. 잠시 뒤 다시 해 주세요." }, { status: 429 });

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const [list, rt, provision] = await Promise.all([
    secretEntryStatuses(),
    getSupervisorRuntime().catch(() => ({}) as SupervisorRuntime),
    provisionStatuses().catch(() => ({ names: null, at: null, records: {} })),
  ]);

  return NextResponse.json(
    { ...list, provision, aiTools: { claude: rt.claudeTool ?? null, codex: rt.codexTool ?? null, at: rt.aiToolsAt ?? null }, memory: rt.memory ?? "" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (hit("admin:secrets", MAX_WRITES_PER_MINUTE)) return tooMany();

  const text = await req.text().catch(() => "");
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return NextResponse.json({ message: "요청이 너무 커요." }, { status: 413 });
  let body: { name?: unknown; description?: unknown; value?: unknown; action?: unknown } | null = null;

  try {
    body = JSON.parse(text);
  } catch {
    /* 아래에서 거절 */
  }
  if (!body || typeof body !== "object") return NextResponse.json({ message: "JSON 형식이 아니에요." }, { status: 400 });

  // [다시 반영]: 값은 받지 않는다(PC secrets.env 또는 서버 보관 값을 쓴다). 반영 대상 이름일 때만.
  if (body.action === "provision") {
    const n = checkSecretName(body.name);

    if ("message" in n) return NextResponse.json({ message: n.message }, { status: 400 });
    const keyName = n.value;
    const state = (await secretEntryStatuses()).items.find((i) => i.name === keyName)?.state;

    if (!state || state === "missing" || state === "delete_pending") return NextResponse.json({ message: "값이 있는 키만 서버에 반영할 수 있어요." }, { status: 400 });
    if (!(await requestProvision(keyName))) return NextResponse.json({ message: "서버 반영 대상이 아닌 키예요." }, { status: 400 });
    console.info(`[factory] 외부 서비스 키 서버 반영 다시 요청: ${keyName}`);

    return NextResponse.json({ ok: true, message: `${keyName} 서버 반영을 요청했어요. 작업 PC 가 곧 실행해요.` });
  }

  try {
    const r = await registerSecretEntry(body.name, body.description, body.value);
    const name = String(body.name).trim();
    // 반영 대상 이름(app-kit key-map.json)이면 서버 반영 요청을 남긴다. 아니면 아무 일도 없다
    const provisioning = r.ok ? await requestProvision(name) : false;

    if (r.ok) console.info(`[factory] 외부 서비스 키 ${r.replaced ? "교체" : "등록"}: ${name}${provisioning ? " (서버 반영 요청)" : ""}`);

    return NextResponse.json({ ok: r.ok, message: provisioning ? `${r.message} 서버 반영도 곧 자동으로 해요.` : r.message }, { status: r.status });
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

    if (r.ok) {
      await clearProvision(String(name).trim()); // 서버(.env)는 건드리지 않고 반영 기록만 지운다
      console.info(`[factory] 외부 서비스 키 삭제 요청: ${String(name).trim()}`);
    }

    return NextResponse.json({ ok: r.ok, message: r.message }, { status: r.status });
  } catch {
    console.error("[factory] 외부 서비스 키 삭제 요청 실패");
    return NextResponse.json({ message: "처리에 실패했어요." }, { status: 500 });
  }
}
