// app/api/factory/screenshot/route.ts
// 감독 프로그램이 스크린샷 파일 하나를 올리는 주소.
// 받은 파일을 기존 업로드 서버(FACTORY_UPLOAD_URL/upload/single)에 전달하고, 돌려받은 URL 을 지시에 저장한다.
//
// 요청: POST multipart/form-data (jobId, label, file), 헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>
// 응답: 200 { ok, url } / running 이 아닌 지시는 409 (취소된 경우 { cancelled: true } 포함)
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { fail, guardWorker } from "@/lib/factory/http";
import { ID_RE, LABEL_RE, MAX_SCREENSHOTS_PER_JOB, touchRunningJob } from "@/lib/factory/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 업로드 서버의 한도와 같다
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;

  const base = process.env.FACTORY_UPLOAD_URL?.trim().replace(/\/+$/, "");
  if (!base) return fail(500, "FACTORY_UPLOAD_URL 이 설정되지 않았습니다.");

  // 본문이 너무 크면 읽기 전에 거절한다. (파일 10MB + 여유)
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_FILE_BYTES + 512 * 1024) return fail(413, "파일이 너무 큽니다.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "multipart 형식이 아닙니다.");
  }

  const jobId = form.get("jobId");
  const label = form.get("label");
  const file = form.get("file");

  if (typeof jobId !== "string" || !ID_RE.test(jobId)) return fail(400, "jobId 형식이 올바르지 않습니다.");
  if (typeof label !== "string" || !LABEL_RE.test(label)) return fail(400, "label 은 영문, 숫자, _, - 만 40자까지 쓸 수 있습니다.");
  if (!(file instanceof File)) return fail(400, "file 이 필요합니다.");
  if (file.size === 0 || file.size > MAX_FILE_BYTES) return fail(413, "파일 크기는 10MB 이하여야 합니다.");
  if (!ALLOWED_TYPES.includes(file.type)) return fail(400, "jpeg, png, gif, webp 만 올릴 수 있습니다.");

  try {
    const state = await touchRunningJob(jobId);
    if (state.kind === "not_found") return fail(404, "없는 지시입니다.");
    if (state.kind === "conflict") {
      return fail(409, `지시가 실행 중이 아닙니다(${state.status}).`, { cancelled: state.cancelled, status: state.status });
    }

    const count = await prisma.factoryJobImage.count({ where: { jobId } });
    if (count >= MAX_SCREENSHOTS_PER_JOB) return fail(400, `스크린샷은 지시당 ${MAX_SCREENSHOTS_PER_JOB}장까지입니다.`);

    const upstream = new FormData();
    upstream.append("file", file, file.name || `${label}.png`);

    const response = await fetch(`${base}/upload/single`, { method: "POST", body: upstream });
    if (!response.ok) {
      console.error("[factory] 업로드 서버 응답 오류:", response.status);
      return fail(502, "업로드 서버에 올리지 못했습니다.");
    }

    // NestJS 업로드 서버 응답: { filename, url, ... } 의 url 은 서버 기준 경로다. (service/mediaUpload.ts 와 같은 조합)
    const result = (await response.json()) as { filename?: string; url?: string };
    if (!result.filename || typeof result.url !== "string") return fail(502, "업로드 서버 응답이 올바르지 않습니다.");

    const url = `${base}${result.url}`;
    await prisma.factoryJobImage.create({ data: { jobId, label, url } });

    return NextResponse.json({ ok: true, url });
  } catch (error) {
    console.error("[factory] screenshot 실패:", error);
    return fail(500, "처리에 실패했습니다.");
  }
}
