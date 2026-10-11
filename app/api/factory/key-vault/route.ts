// app/api/factory/key-vault/route.ts
// 감독 프로그램이 키 보관함 일(/next 의 keyTasks: 공용 키 만들기·키 파일 조회)의 결과를 보내는 주소(워커 토큰만).
// 경로·크기·형식·별칭·SHA-1 지문·git 추적 여부와 한국어 오류만 온다. 비밀번호·개인키 내용은 오지 않는다(오류 글은 서버가 한 번 더 가림).
//
// 요청: POST JSON { results: [ { id, op: "create"|"check", ok, pending?, error?, info?: { exists, size, mtime, type, aliases: [{alias, sha1}],
//         aliasFound, passwordOk, inApp, gitTracked, note } } ] }
// 응답: 200 { ok, saved }
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { receiveKeyResults } from "@/lib/factory/keyVault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const read = await readJson(req);
  if (read.ok === false) return read.res;

  try {
    return NextResponse.json({ ok: true, saved: await receiveKeyResults((read.body as { results?: unknown })?.results) });
  } catch {
    console.error("[factory] 키 보관함 결과 저장 실패"); // 오류 객체에 경로 외 값이 섞일 수 있어 남기지 않는다
    return fail(500, "처리에 실패했습니다.");
  }
}
