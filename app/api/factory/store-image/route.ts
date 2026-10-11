// app/api/factory/store-image/route.ts
// 감독 프로그램이 스토어 자료 이미지 한 장을 올리는 고정 주소(출시 2단계).
// 칸(slot)이 정해져 있다: icon(512x512, 1MB), feature(1024x500, 10MB), phone-01..phone-08(8MB). png/jpg 만. 영상은 받지 않는다.
// 받은 파일은 스크린샷과 같은 업로드 서버에 전달하고, 돌려받은 URL 을 앱의 storeAssets.images[slot].url 에 저장한다.
//
// 요청: POST multipart/form-data (jobId, slot, file), 헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>
//   실행 중인 '스토어 자료 수정' 출시 일감만 올릴 수 있다.
// 응답: 200 { ok, url } / 실행 중이 아니면 409
import { NextRequest, NextResponse } from "next/server";

import { uploadConfig } from "@/config/upload";
import { fail, guardWorker } from "@/lib/factory/http";
import { touchRunningJob } from "@/lib/factory/jobs";
import { STORE_IMAGE_SLOTS, STORE_IMAGE_TYPES, saveStoreImageUrl, storeImageJob } from "@/lib/factory/storeAssets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 10 * 1024 * 1024 + 512 * 1024;

// 파일 앞부분으로 형식을 확인한다(Content-Type 만 믿지 않음)
function sniff(buf: Uint8Array): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";

  return null;
}

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const base = (process.env.FACTORY_UPLOAD_URL?.trim() || uploadConfig.customServerUrl || "").replace(/\/+$/, "");
  if (!base) return fail(500, "업로드 서버 주소를 알 수 없습니다.");
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return fail(413, "파일이 너무 큽니다.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "multipart 형식이 아닙니다.");
  }
  const slot = form.get("slot");
  const file = form.get("file");

  if (typeof slot !== "string" || !STORE_IMAGE_SLOTS[slot]) return fail(400, `slot 은 ${Object.keys(STORE_IMAGE_SLOTS).join(", ")} 중 하나예요.`);
  if (!(file instanceof Blob)) return fail(400, "file 이 필요합니다.");
  const limit = STORE_IMAGE_SLOTS[slot].maxBytes;

  if (file.size === 0 || file.size > limit) return fail(413, `${STORE_IMAGE_SLOTS[slot].label} 파일은 ${Math.round(limit / 1024 / 1024)}MB 이하여야 해요.`);
  const buf = new Uint8Array(await file.arrayBuffer());
  const type = sniff(buf);

  if (!type || !STORE_IMAGE_TYPES.includes(type)) return fail(400, "png, jpg 만 올릴 수 있어요.");

  try {
    const found = await storeImageJob(form.get("jobId"));

    if (found.error) return fail(found.error.status, found.error.message);
    const { job } = found;
    const state = await touchRunningJob(job.id);

    if (state.kind !== "ok") return fail(409, "지시가 실행 중이 아닙니다.", state.kind === "conflict" ? { cancelled: state.cancelled, status: state.status } : undefined);

    const upstream = new FormData();
    upstream.append("file", new Blob([buf], { type }), `${job.appSlug}-${slot}.${type === "image/png" ? "png" : "jpg"}`);
    const response = await fetch(`${base}/upload/single`, { method: "POST", body: upstream });

    if (!response.ok) {
      console.error("[factory] store-image 업로드 서버 응답 오류:", response.status);
      return fail(502, "업로드 서버에 올리지 못했습니다.");
    }
    const result = (await response.json()) as { filename?: string; url?: string };

    if (!result.filename || typeof result.url !== "string") return fail(502, "업로드 서버 응답이 올바르지 않습니다.");
    const url = `${base}${result.url}`;

    await saveStoreImageUrl(job.appSlug, job.id, slot, url);

    return NextResponse.json({ ok: true, url });
  } catch (error) {
    console.error("[factory] store-image 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
