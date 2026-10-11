// app/api/factory/key-passwords/route.ts
// 감독 프로그램이 통제실에서 등록한 업로드 키 비밀번호를 가져가는 주소(워커 토큰만).
// /api/factory/next 응답에 keyPasswordsPending: true 가 있을 때만 부른다.
//
// GET  → { items: [ { keyRef, version, storeName, keyName, store, key } ] }  (값은 이 응답에만. 로그에 남기지 않는다)
// POST { ack: [ { keyRef, version } ] } → secrets.env 에 저장했다는 확인. 서버의 암호화 값을 지운다(등록 기록만 남음).
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { ackKeyPasswords, pendingKeyPasswords } from "@/lib/factory/keyPasswords";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  try {
    return NextResponse.json({ items: await pendingKeyPasswords() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[factory] 키 비밀번호 내주기 실패"); // 값·오류 객체는 남기지 않는다
    return fail(500, "처리에 실패했습니다.");
  }
}

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const body = (await req.json().catch(() => null)) as { ack?: unknown } | null;
  if (!body) return fail(400, "JSON 형식이 아닙니다.");

  try {
    return NextResponse.json({ ok: true, deleted: await ackKeyPasswords(body.ack) });
  } catch {
    console.error("[factory] 키 비밀번호 확인 처리 실패");
    return fail(500, "처리에 실패했습니다.");
  }
}
