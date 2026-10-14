// app/api/admin/factory/tool-settings/route.ts
// 통제실 스튜디오 프로젝트의 "도구 설정"(pixel-art 의 settings). 관리자만.
//   GET  ?appSlug=…                       → { record | null, history, schemaWarning, firstValues }
//   PUT  { appSlug, settings }            → 스키마 검증 후 저장(버전 +1, 이력 한 줄)
//   POST { appSlug, revert: 버전 번호 }    → 이력의 그 버전 내용을 새 버전으로 다시 저장
// 저장된 설정은 일감이 시작될 때 /api/factory/next 가 job.projectToolSettings 로 감독 프로그램에 내려 준다.
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { auth } from "@/lib/auth/get-sesstion";
import { schemaWarning } from "@/lib/factory/projectToolSettings";
import { getProjectToolSettings, getProjectToolSettingsHistory, revertProjectToolSettings, saveProjectToolSettings, schemaHash, type SettingsDb } from "@/lib/factory/projectToolSettingsDb";
import { readToolkitView } from "@/lib/factory/toolkit";
import { settingsLimitViolations } from "@/lib/factory/toolManifestDb";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const db = prisma as unknown as SettingsDb;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

async function adminName(): Promise<string> {
  const session = await auth().catch(() => null);

  return session?.user?.name || session?.user?.email || "관리자";
}

async function snapshot(appSlug: string) {
  const [record, history, view] = await Promise.all([getProjectToolSettings(db, appSlug), getProjectToolSettingsHistory(db, appSlug), readToolkitView(prisma).catch(() => null)]);

  return { appSlug, record, history, schemaWarning: schemaWarning(view?.info?.settingsSchemaHash, schemaHash()) };
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const appSlug = req.nextUrl.searchParams.get("appSlug") ?? "";

  if (!SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 형식이 올바르지 않아요." }, { status: 400 });

  return NextResponse.json(await snapshot(appSlug));
}

async function knownApp(appSlug: string): Promise<boolean> {
  return !!(await prisma.factoryJob.findFirst({ where: { appSlug }, select: { id: true } })) || !!(await getProjectToolSettings(db, appSlug));
}

export async function PUT(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { appSlug?: unknown; settings?: unknown } | null;
  const appSlug = typeof body?.appSlug === "string" ? body.appSlug.trim() : "";

  if (!SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 형식이 올바르지 않아요." }, { status: 400 });
  if (!(await knownApp(appSlug))) return NextResponse.json({ message: "홈페이지가 모르는 앱이에요." }, { status: 400 });
  const res = await saveProjectToolSettings(db, appSlug, body?.settings, await adminName(), "저장", settingsLimitViolations);

  if (res.ok === false) return NextResponse.json({ message: `설정을 저장하지 못했어요: ${res.errors.slice(0, 5).join(" / ")}`, errors: res.errors }, { status: res.status });

  return NextResponse.json({ message: res.message, unchanged: res.unchanged, ...(await snapshot(appSlug)) });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { appSlug?: unknown; revert?: unknown } | null;
  const appSlug = typeof body?.appSlug === "string" ? body.appSlug.trim() : "";

  if (!SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 형식이 올바르지 않아요." }, { status: 400 });
  const res = await revertProjectToolSettings(db, appSlug, body?.revert, await adminName(), settingsLimitViolations);

  if (res.ok === false) return NextResponse.json({ message: res.errors[0], errors: res.errors }, { status: res.status });

  return NextResponse.json({ message: res.message.replace("저장했어요", "되돌려 저장했어요"), unchanged: res.unchanged, ...(await snapshot(appSlug)) });
}
