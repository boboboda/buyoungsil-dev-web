// app/api/factory/secrets/route.ts
// 감독 프로그램이 통제실에서 입력한 외부 서비스 키를 가져가는 주소(워커 토큰만). lib/factory/secretEntries.ts
// /api/factory/next 응답에 secretsPending: true 가 있을 때만 GET 한다(예전 감독 프로그램은 이 신호를 몰라 아무것도 안 함).
//
// GET  → { items: [ { name, version, value } | { name, version, delete: true } ] }  (값은 이 응답에만. 로그에 남기지 않는다)
// POST { ack: [ { name, version, action: "store" | "delete" } ] } → secrets.env 에 반영했다는 확인. 서버 암호문을 지운다(저장 기록은 값 없이 남음).
// POST { names: [ "PIXELLAB_TOKEN", ... ] } → PC secrets.env 에 있는 이름만(값 없음) 알린다. 통제실 상태·list_secret_names 에 쓴다.
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { ackSecretEntries, pendingSecretEntries, savePcSecretNames } from "@/lib/factory/secretEntries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  try {
    return NextResponse.json({ items: await pendingSecretEntries() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[factory] 외부 서비스 키 내주기 실패"); // 값·오류 객체는 남기지 않는다
    return fail(500, "처리에 실패했습니다.");
  }
}

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const parsed = await readJson(req);
  if ("res" in parsed) return parsed.res;
  const body = (parsed as { body: unknown }).body as { ack?: unknown; names?: unknown } | null;
  if (!body || typeof body !== "object") return fail(400, "JSON 형식이 아닙니다.");

  try {
    const out: Record<string, unknown> = { ok: true };

    if (body.ack !== undefined) out.done = await ackSecretEntries(body.ack);
    if (body.names !== undefined) out.names = await savePcSecretNames(body.names);

    return NextResponse.json(out);
  } catch {
    console.error("[factory] 외부 서비스 키 확인 처리 실패");
    return fail(500, "처리에 실패했습니다.");
  }
}
