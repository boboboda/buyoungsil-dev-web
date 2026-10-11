// app/api/factory/key-report/route.ts
// 감독 프로그램의 키 점검 결과(통제실 [키 점검] → /next 의 keyScan: true 를 받으면 한 번 실행).
// 앱 폴더별 .jks/.keystore 경로·별칭·SHA-1 지문과 key.properties 의 storeFile·keyAlias, git 추적 여부만 온다. 비밀번호는 오지 않는다.
//
// 요청: POST JSON { only?: [appSlug], apps: [  (only 가 있으면 앱 하나 점검 결과: 그 앱 줄만 바꾼다. 앱 폴더가 없으면 { appSlug, missing: true })
//    { appSlug, keys: [ { path, type, aliases: [ { alias, sha1 } ], gitTracked, note } ], keyProperties: [ { path, storeFile, keyAlias, gitTracked } ] } ] }
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { saveKeyScan } from "@/lib/factory/release";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const read = await readJson(req);
  if (read.ok === false) return read.res;

  try {
    return NextResponse.json({ ok: true, saved: await saveKeyScan(read.body) });
  } catch (error) {
    console.error("[factory] 키 점검 결과 저장 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
