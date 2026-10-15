// app/api/admin/factory/palette/route.ts
// 명령 팔레트(5-3)가 검색할 자료: 앱·일감·정비·카드·템플릿. 관리자만(읽기 전용). 항목 조립은 lib/factory/palette.ts.
import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/factory/admin";
import { listTemplates } from "@/lib/factory/jobTemplatesDb";
import { buildItems } from "@/lib/factory/palette";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;
  const [doneRows, jobs, threads, cards, templates] = await Promise.all([
    prisma.factoryJob.findMany({ where: { status: "done" }, orderBy: { finishedAt: "desc" }, take: 300, select: { appSlug: true, title: true, kind: true } }).catch(() => []),
    prisma.factoryJob.findMany({ orderBy: { createdAt: "desc" }, take: 40, select: { id: true, appSlug: true, title: true, status: true, kind: true } }).catch(() => []),
    prisma.factoryMaintenance.findMany({ orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, title: true, status: true } }).catch(() => []),
    prisma.factoryCard.findMany({ where: { enabled: true }, orderBy: [{ appSlug: "asc" }, { name: "asc" }], take: 300, select: { id: true, appSlug: true, name: true } }).catch(() => []),
    listTemplates().catch(() => []),
  ]);
  const seen = new Set<string>();
  const apps = doneRows.filter((r) => r.kind !== "lab" && r.kind !== "tool" && !seen.has(r.appSlug) && !!seen.add(r.appSlug)).map((r) => ({ appSlug: r.appSlug, title: r.title }));
  const data = { apps, jobs, threads, cards, templates: templates.map((t) => ({ id: t.id, name: t.name, kind: t.kind, description: t.description })) };

  return NextResponse.json({ items: buildItems(data), apps, cards: data.cards }, { headers: { "Cache-Control": "no-store" } });
}
