// app/api/factory/art/route.ts
// 도트 그림 저장소의 감독 프로그램용 주소 (lib/factory/arts.ts).
//   POST multipart (appSlug, subject, kind, method?, summary?, srcKey, jobId?, status?, note?, file) → 그림을 업로드 서버에 올리고 '후보'로 등록. 헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>
//        cardId·cardVersion(선택): 결과물 카드로 만든 그림이면 카드 id 와 그때의 판 번호를 같이 기록한다(2-2).
//        jobId 가 있으면 언제나 후보(승인 상태로는 등록 못 함). jobId 없이 status=approved 를 주는 건 손으로 올리는 처음 값뿐. 같은 srcKey 는 다시 올리지 않고 기존 것을 돌려준다.
//        응답 200 { ok, duplicate, art } / 실행 중이 아닌 일감은 409
//   GET  ?appSlug=…  → { approved: [{ url, subject, kind, approvedAt }] }  (이 프로젝트의 '승인' 그림만. 중계가 pixel-art 를 실행하기 직전에 최신 목록을 받는다)
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { uploadConfig } from "@/config/upload";
import { fail, guardWorker } from "@/lib/factory/http";
import { ID_RE, touchRunningJob } from "@/lib/factory/jobs";
import { approvedArtsFor, registerArt, toArtView, type ArtDb } from "@/lib/factory/arts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const db = prisma as unknown as ArtDb;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 업로드 서버의 한도와 같다
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export async function GET(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  const appSlug = req.nextUrl.searchParams.get("appSlug") ?? "";

  try {
    return NextResponse.json({ approved: await approvedArtsFor(db, appSlug) });
  } catch (error) {
    console.error("[factory] art 목록 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  const base = (process.env.FACTORY_UPLOAD_URL?.trim() || uploadConfig.customServerUrl || "").replace(/\/+$/, "");

  if (!base) return fail(500, "업로드 서버 주소를 알 수 없습니다.");
  const length = Number(req.headers.get("content-length") ?? "0");

  if (length > MAX_FILE_BYTES + 512 * 1024) return fail(413, "파일이 너무 큽니다.");
  let form: FormData;

  try {
    form = await req.formData();
  } catch {
    return fail(400, "multipart 형식이 아닙니다.");
  }
  const text = (k: string) => {
    const v = form.get(k);

    return typeof v === "string" ? v : "";
  };
  const file = form.get("file");
  const jobId = text("jobId");
  const srcKey = text("srcKey").trim();

  if (jobId && !ID_RE.test(jobId)) return fail(400, "jobId 형식이 올바르지 않습니다.");
  if (!(file instanceof Blob)) return fail(400, "file 이 필요합니다.");
  if (file.size === 0 || file.size > MAX_FILE_BYTES) return fail(413, "파일 크기는 10MB 이하여야 합니다.");
  if (!ALLOWED_TYPES.includes(file.type)) return fail(400, "jpeg, png, gif, webp 만 올릴 수 있습니다.");

  try {
    if (jobId) {
      const state = await touchRunningJob(jobId);

      if (state.kind === "not_found") return fail(404, "없는 지시입니다.");
      if (state.kind === "conflict") return fail(409, `지시가 실행 중이 아닙니다(${state.status}).`, { cancelled: state.cancelled, status: state.status });
    }
    // 이미 등록된 파일이면 업로드 서버에 또 올리지 않는다
    const existing = srcKey ? await db.factoryArt.findUnique({ where: { srcKey } }) : null;

    if (existing) return NextResponse.json({ ok: true, duplicate: true, art: toArtView(existing) });
    const upstream = new FormData();

    upstream.append("file", file, (file as { name?: string }).name || "art.png");
    const response = await fetch(`${base}/upload/single`, { method: "POST", body: upstream });

    if (!response.ok) {
      console.error("[factory] 그림 업로드 서버 응답 오류:", response.status);

      return fail(502, "업로드 서버에 올리지 못했습니다.");
    }
    const result = (await response.json()) as { filename?: string; url?: string };

    if (!result.filename || typeof result.url !== "string") return fail(502, "업로드 서버 응답이 올바르지 않습니다.");
    const registered = await registerArt(db, {
      appSlug: text("appSlug"),
      subject: text("subject"),
      kind: text("kind"),
      method: text("method"),
      summary: text("summary"),
      url: `${base}${result.url}`,
      jobId: jobId || null,
      srcKey,
      status: text("status") || undefined,
      note: text("note"),
      decidedBy: "처음 값",
      createdAt: text("createdAt"),
      decidedAt: text("decidedAt"),
      cardId: text("cardId") || undefined,
      cardVersion: /^\d{1,6}$/.test(text("cardVersion")) ? Number(text("cardVersion")) : undefined,
    });

    if (registered.ok === false) return fail(registered.status, registered.message);

    return NextResponse.json({ ok: true, duplicate: registered.duplicate, art: registered.art });
  } catch (error) {
    console.error("[factory] art 등록 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
