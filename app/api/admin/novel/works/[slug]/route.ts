// app/api/admin/novel/works/[slug]/route.ts
// GET: 작품과 화 목록(본문 제외)·최근 30일 지표 / PATCH: { paused?, approvalMode?, publishPerDay?, status? }. 관리자만.
import { NextRequest } from "next/server";

import {
  adminGate,
  bad,
  json,
  readSmallJson,
  resultResponse,
  validSlug,
} from "@/lib/novel/adminHttp";
import { parseWorkPatch } from "@/lib/novel/rules";
import { getWorkForAdmin, patchWork, workMetrics } from "@/lib/novel/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const denied = await adminGate();

  if (denied) return denied;
  const { slug } = await params;

  if (!validSlug(slug)) return bad("작품 주소가 올바르지 않아요.");

  const work = await getWorkForAdmin(slug);

  if (!work) return bad("없는 작품이에요.", 404);
  const metrics = await workMetrics(slug).catch((e) => {
    console.error("[novel] 지표 집계 실패:", e);

    return { available: false, rows: [] };
  });

  return json({ work, metrics });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const denied = await adminGate(true);

  if (denied) return denied;
  const { slug } = await params;

  if (!validSlug(slug)) return bad("작품 주소가 올바르지 않아요.");
  const read = await readSmallJson(req);

  if (read.ok === false) return read.res;
  const patch = parseWorkPatch(read.body);

  if (patch.ok === false) return bad(patch.reason);

  return resultResponse(await patchWork(slug, patch.value));
}
