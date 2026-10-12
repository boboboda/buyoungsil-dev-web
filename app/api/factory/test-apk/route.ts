// app/api/factory/test-apk/route.ts
// 감독 프로그램이 출시 패키지 '시험용 APK'(서명된 release APK)를 올리는 주소(워커 토큰만). 실행 중인 시험용 APK 일감만.
// APK 는 공개 업로드 서버가 아니라 DB 에 조각으로 둔다(관리자만 내려받기, 앱당 최근 5개). 조각 하나가 8MB 라 프록시 본문 한도에 걸리지 않는다.
//
// 1) POST JSON { jobId, size, sha256, versionName?, versionCode?, builtAt?, gitCommit?, signerSha256?, keyLabel? } → 200 { apkId, chunkSize, count }
// 2) PUT ?apkId=…&idx=0..count-1, 본문 = 조각(application/octet-stream, 8MB 이하) → 200 { complete }
//    마지막 조각까지 받으면 서버가 SHA-256 을 다시 재서 맞을 때만 내려받기 목록에 올린다(틀리면 지우고 422).
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { TEST_APK_CHUNK, receiveTestApkChunk, startTestApk } from "@/lib/factory/testApk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const read = await readJson(req);
  if (read.ok === false) return read.res;
  if (!read.body || typeof read.body !== "object" || Array.isArray(read.body)) return fail(400, "JSON 객체가 아닙니다.");

  try {
    const r = await startTestApk(read.body as Record<string, unknown>);

    return r.ok ? NextResponse.json({ ok: true, message: r.message, apkId: r.apkId, chunkSize: r.chunkSize, count: r.count }) : fail(r.status, r.message);
  } catch (error) {
    console.error("[factory] 시험용 APK 시작 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}

export async function PUT(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const q = req.nextUrl.searchParams;
  const apkId = q.get("apkId") ?? "";
  const idx = Number(q.get("idx"));

  if (Number(req.headers.get("content-length") ?? "0") > TEST_APK_CHUNK) return fail(413, "조각이 너무 큽니다(8MB 이하).");

  try {
    const buf = new Uint8Array(await req.arrayBuffer());

    if (buf.length > TEST_APK_CHUNK) return fail(413, "조각이 너무 큽니다(8MB 이하).");
    const r = await receiveTestApkChunk(apkId, idx, buf);

    return r.ok ? NextResponse.json({ ok: true, message: r.message, complete: r.complete === true }) : fail(r.status, r.message);
  } catch (error) {
    console.error("[factory] 시험용 APK 조각 받기 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
