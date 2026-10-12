// app/api/factory/test-apk/route.ts
// 감독 프로그램이 출시 패키지 '시험용 APK'(서명된 release APK)를 올리는 주소(워커 토큰만). 실행 중인 시험용 APK 일감만.
// APK 는 공개 업로드 서버가 아니라 DB 에 조각으로 둔다(관리자만 내려받기, 앱당 최근 5개). 조각 크기는 TEST_APK_CHUNK(기본 512KB)
// 하나로 정하고 시작 응답 chunkSize 로 알려 준다. nginx `location /` 기본 본문 한도(1MB)에 걸리지 않게 작게 둔다.
//
// 1) POST JSON { jobId, size, sha256, versionName?, versionCode?, builtAt?, gitCommit?, signerSha256?, keyLabel? } → 200 { apkId, chunkSize, count }
// 2) PUT ?apkId=…&idx=0..count-1, 본문 = 조각(application/octet-stream, chunkSize 크기, 마지막만 작음) → 200 { complete }
//    마지막 조각까지 받으면 서버가 SHA-256 을 다시 재서 맞을 때만 내려받기 목록에 올린다(틀리면 지우고 422).
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { TEST_APK_CHUNK_MAX, receiveTestApkChunk, startTestApk } from "@/lib/factory/testApk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOO_BIG = `조각이 너무 큽니다(${TEST_APK_CHUNK_MAX / 1024 / 1024}MB 이하).`;

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

  if (Number(req.headers.get("content-length") ?? "0") > TEST_APK_CHUNK_MAX) return fail(413, TOO_BIG);

  try {
    const buf = new Uint8Array(await req.arrayBuffer());

    if (buf.length > TEST_APK_CHUNK_MAX) return fail(413, TOO_BIG);
    const r = await receiveTestApkChunk(apkId, idx, buf);

    return r.ok ? NextResponse.json({ ok: true, message: r.message, complete: r.complete === true }) : fail(r.status, r.message);
  } catch (error) {
    console.error("[factory] 시험용 APK 조각 받기 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
