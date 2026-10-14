// app/api/factory/tool-settings/route.ts
// 프로젝트 도구 설정을 일부만 바꾸는 감독 프로그램용 주소 (정비 일감이 규격 칸 크기 같은 값 하나를 고칠 때).
//   POST JSON { appSlug, patch: { spec: { cell_size: 128 } }, who?, note? }, 헤더 Authorization: Bearer <FACTORY_WORKER_TOKEN>
//   이미 저장된 설정이 있는 프로젝트만. 스키마 검증을 통과해야 하고, 저장하면 버전 +1·이력 한 줄(수정자 who, 기본 '정비').
//   응답 200 { ok, unchanged, version, message } / 404 저장된 설정 없음 / 400 형식 오류
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { patchProjectToolSettings, type SettingsDb } from "@/lib/factory/projectToolSettingsDb";
import { settingsLimitViolations } from "@/lib/factory/toolManifestDb";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const db = prisma as unknown as SettingsDb;

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  const body = (await req.json().catch(() => null)) as { appSlug?: unknown; patch?: unknown; who?: unknown; note?: unknown } | null;
  const appSlug = typeof body?.appSlug === "string" ? body.appSlug.trim() : "";
  const who = typeof body?.who === "string" && body.who.trim() ? body.who.trim().slice(0, 40) : "정비";
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 100) : "일부 수정";

  try {
    const res = await patchProjectToolSettings(db, appSlug, body?.patch, who, note, settingsLimitViolations);

    if (res.ok === false) return fail(res.status, res.errors.slice(0, 5).join(" / "));

    return NextResponse.json({ ok: true, unchanged: res.unchanged, version: res.record.version, message: res.message });
  } catch (error) {
    console.error("[factory] tool-settings 수정 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
