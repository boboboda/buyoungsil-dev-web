// app/api/admin/factory/arts/route.ts
// 통제실 스튜디오 프로젝트 상세의 "그림" 카드(도트 그림 저장소, lib/factory/arts.ts). 관리자만.
//   GET  ?appSlug=…                         → { arts, aliases }   (후보·승인·반려 모두, 대상 별칭은 프로젝트 도구 설정의 aliases)
//   POST { id, action: approve|reject|reset } → 상태 전환(승인자·시각 기록)
//   POST { id, note }                        → 메모
// 승인된 그림만 이후 일감에 자동 참고 목록으로 내려간다(/api/factory/next 의 approvedArts).
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { auth } from "@/lib/auth/get-sesstion";
import { decideArt, listArts, setArtNote, type ArtDb } from "@/lib/factory/arts";
import { getProjectToolSettings, type SettingsDb } from "@/lib/factory/projectToolSettingsDb";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const db = prisma as unknown as ArtDb;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

async function adminName(): Promise<string> {
  const session = await auth().catch(() => null);

  return session?.user?.name || session?.user?.email || "관리자";
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const appSlug = req.nextUrl.searchParams.get("appSlug") ?? "";

  if (!SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 형식이 올바르지 않아요." }, { status: 400 });
  const [arts, settings] = await Promise.all([listArts(db, appSlug), getProjectToolSettings(prisma as unknown as SettingsDb, appSlug).catch(() => null)]);

  return NextResponse.json({ arts, aliases: settings?.settings?.aliases ?? {} });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown; note?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";

  if (body && Object.hasOwn(body, "note") && body.action === undefined) {
    const r = await setArtNote(db, id, body.note);

    return r.ok === false ? NextResponse.json({ message: r.message }, { status: r.status }) : NextResponse.json({ message: "메모를 저장했어요.", art: r.art });
  }
  const r = await decideArt(db, id, body?.action, await adminName());

  if (r.ok === false) return NextResponse.json({ message: r.message }, { status: r.status });
  const label = r.art.status === "approved" ? "승인했어요. 이후 일감부터 자동 참고 그림으로 쓰여요." : r.art.status === "rejected" ? "반려했어요. 자동 참고에 쓰지 않아요." : "후보로 되돌렸어요.";

  return NextResponse.json({ message: `${r.art.subject}: ${label}`, art: r.art });
}
