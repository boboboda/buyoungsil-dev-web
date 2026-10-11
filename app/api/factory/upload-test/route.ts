// app/api/factory/upload-test/route.ts
// 통제실 '업로드 시험'용 업로드 주소(워커 토큰만, 진행 중인 시험 id 가 있어야 함). store-video·store-image 와 같은 전달 코드
// (lib/factory/uploadStream.ts)로 업로드 서버 /upload/single 에 보내고 공개 주소를 돌려준다. 앱 데이터에는 아무것도 저장하지 않는다.
// 업로드 서버에는 삭제 API 가 없어 시험 파일은 남는다.
//
// 영상: POST /api/factory/upload-test?id=…&kind=video, 본문 = mp4 원본 바이트(Content-Length 필수, 120MB 이하) — store-video 와 같은 방식
// 이미지: POST /api/factory/upload-test?id=…&kind=image, multipart(file) png/jpg 10MB 이하 — store-image 와 같은 방식
// 응답: 200 { ok, url, upstreamStatus } / 실패 { message, stage: receive|upstream, upstreamStatus } (413 이면 크기 제한)
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { uploadTestActive } from "@/lib/factory/uploadTest";
import { forwardBuffer, forwardStream, isMp4Head, readHead, uploadBase } from "@/lib/factory/uploadStream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// store-video 의 MAX_VIDEO, store-image 의 큰 칸과 같다
const MAX_VIDEO = 120 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;

function sniffImage(buf: Uint8Array): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";

  return null;
}

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const base = uploadBase();
  if (!base) return fail(500, "업로드 서버 주소를 알 수 없습니다.", { stage: "upstream" });
  const id = req.nextUrl.searchParams.get("id");
  const kind = req.nextUrl.searchParams.get("kind");

  try {
    if (kind === "video") {
      if (!(await uploadTestActive(id, "video-file"))) return fail(409, "진행 중인 업로드 시험이 아니에요.", { stage: "receive" });
      const size = Number(req.headers.get("content-length") ?? "0");

      if (!Number.isInteger(size) || size <= 0) return fail(411, "Content-Length 가 필요합니다.", { stage: "receive" });
      if (size > MAX_VIDEO) return fail(413, `영상은 ${MAX_VIDEO / 1024 / 1024}MB 이하여야 해요(홈페이지 코드 한도).`, { stage: "receive" });
      if (!req.body) return fail(400, "본문이 없습니다.", { stage: "receive" });
      const { head, reader } = await readHead(req.body, 12);

      if (!isMp4Head(head)) {
        await reader.cancel().catch(() => {});

        return fail(400, "mp4 만 올릴 수 있어요.", { stage: "receive" });
      }
      const sent = await forwardStream(base, head, reader, { filename: `upload-test-${id}-${size}.mp4`, type: "video/mp4", expect: size, max: MAX_VIDEO });

      if (sent.ok === false) return fail(sent.status, sent.message, { stage: sent.stage, upstreamStatus: sent.upstreamStatus });

      return NextResponse.json({ ok: true, url: sent.url, upstreamStatus: sent.upstreamStatus });
    }
    if (kind === "image") {
      if (!(await uploadTestActive(id, "image-file"))) return fail(409, "진행 중인 업로드 시험이 아니에요.", { stage: "receive" });
      let form: FormData;

      try {
        form = await req.formData();
      } catch {
        return fail(400, "multipart 형식이 아닙니다.", { stage: "receive" });
      }
      const file = form.get("file");

      if (!(file instanceof Blob) || file.size === 0) return fail(400, "file 이 필요합니다.", { stage: "receive" });
      if (file.size > MAX_IMAGE) return fail(413, "이미지는 10MB 이하여야 해요(홈페이지 코드 한도).", { stage: "receive" });
      const buf = new Uint8Array(await file.arrayBuffer());
      const type = sniffImage(buf);

      if (!type) return fail(400, "png, jpg 만 올릴 수 있어요.", { stage: "receive" });
      const sent = await forwardBuffer(base, buf, type, `upload-test-${id}.${type === "image/png" ? "png" : "jpg"}`);

      if (sent.ok === false) return fail(sent.status, sent.message, { stage: sent.stage, upstreamStatus: sent.upstreamStatus });

      return NextResponse.json({ ok: true, url: sent.url, upstreamStatus: sent.upstreamStatus });
    }

    return fail(400, "kind 는 video 또는 image 예요.", { stage: "receive" });
  } catch (error) {
    console.error("[factory] upload-test 실패:", error instanceof Error ? error.message : error);

    return fail(500, "처리에 실패했습니다.", { stage: "receive" });
  }
}
