// app/api/factory/store-video/route.ts
// 감독 프로그램이 출시 검토용 홍보 영상(mp4)을 올리는 고정 주소. store-image 와 같은 업로드 서버(/upload/single)에 전달하고,
// 돌려받은 URL 을 앱의 storeAssets.reviewVideo 에 저장한다(통제실 검토 화면에서 <video> 로 재생).
// 영상은 크므로 메모리에 통째로 올리지 않고 받는 대로 업로드 서버로 흘려 보낸다. 상한 120MB(넘으면 감독 프로그램이 ffmpeg 로 줄인다).
// 업로드 서버에는 삭제 API 가 없어 올린 영상은 서버에 남는다(주소를 아는 사람만 볼 수 있음).
//
// 요청: POST /api/factory/store-video?jobId=…, 본문 = mp4 원본 바이트(Content-Type video/mp4, Content-Length 필수),
//   헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>. 실행 중인 '검토 단계가 있는' 출시 일감만.
// 응답: 200 { ok, url } / 형식 400 / 실행 중이 아니면 409 / 크면 413 / 업로드 서버 오류 502
import { NextRequest, NextResponse } from "next/server";

import { uploadConfig } from "@/config/upload";
import { fail, guardWorker } from "@/lib/factory/http";
import { touchRunningJob } from "@/lib/factory/jobs";
import { saveStoreReviewVideoUrl, storeVideoJob } from "@/lib/factory/storeAssets";
import { isMp4Head, multipartStream, readHead } from "@/lib/factory/uploadStream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// 감독 프로그램 store.mjs 의 STORE_VIDEO_MAX 와 같다
const MAX_VIDEO = 120 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const base = (process.env.FACTORY_UPLOAD_URL?.trim() || uploadConfig.customServerUrl || "").replace(/\/+$/, "");
  if (!base) return fail(500, "업로드 서버 주소를 알 수 없습니다.");
  const size = Number(req.headers.get("content-length") ?? "0");

  if (!Number.isInteger(size) || size <= 0) return fail(411, "Content-Length 가 필요합니다.");
  if (size > MAX_VIDEO) return fail(413, `영상은 ${MAX_VIDEO / 1024 / 1024}MB 이하여야 해요.`);
  if (!req.body) return fail(400, "본문이 없습니다.");

  try {
    const found = await storeVideoJob(req.nextUrl.searchParams.get("jobId"));

    if (found.error) return fail(found.error.status, found.error.message);
    const { job } = found;
    const state = await touchRunningJob(job.id);

    if (state.kind !== "ok") return fail(409, "지시가 실행 중이 아닙니다.", state.kind === "conflict" ? { cancelled: state.cancelled, status: state.status } : undefined);

    // 형식은 앞부분(ftyp)으로 확인한다(Content-Type 만 믿지 않음)
    const { head, reader } = await readHead(req.body, 12);

    if (!isMp4Head(head)) {
      await reader.cancel().catch(() => {});

      return fail(400, "mp4 만 올릴 수 있어요.");
    }
    const body = multipartStream(head, reader, { filename: `${job.appSlug}-review-${job.id}.mp4`, type: "video/mp4", expect: size, max: MAX_VIDEO });
    let response: Response;

    try {
      response = await fetch(`${base}/upload/single`, {
        method: "POST",
        headers: { "Content-Type": body.contentType },
        body: body.stream,
        duplex: "half",
        cache: "no-store",
      } as RequestInit & { duplex: "half" });
    } catch (error) {
      console.error("[factory] store-video 전달 실패:", error instanceof Error ? error.message : error);

      return fail(body.received() !== size ? 400 : 502, body.received() !== size ? "영상을 끝까지 받지 못했어요." : "업로드 서버에 올리지 못했습니다.");
    }
    if (!response.ok) {
      console.error("[factory] store-video 업로드 서버 응답 오류:", response.status);

      return fail(response.status === 413 ? 413 : 502, response.status === 413 ? "업로드 서버가 파일이 너무 크다고 거절했어요." : "업로드 서버에 올리지 못했습니다.");
    }
    const result = (await response.json()) as { filename?: string; url?: string };

    if (!result.filename || typeof result.url !== "string") return fail(502, "업로드 서버 응답이 올바르지 않습니다.");
    const url = `${base}${result.url}`;

    await saveStoreReviewVideoUrl(job.appSlug, job.id, url, size);

    return NextResponse.json({ ok: true, url });
  } catch (error) {
    console.error("[factory] store-video 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
