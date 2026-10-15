// app/api/admin/novel/works/[slug]/episodes/[number]/draft/route.ts
// 화 원고 화면(7-1): 줄 번호 본문·검수(필수/권장 표)·열린 메모·최근 작업·비용. ?from&to 로 줄 범위. 관리자만.
import { NextRequest } from "next/server";

import { adminGate, bad, json, validNumber, validSlug } from "@/lib/novel/adminHttp";
import { episodeDraftView } from "@/lib/novel/jobStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string; number: string }> }) {
  const denied = await adminGate();

  if (denied) return denied;
  const { slug, number } = await params;
  const n = validNumber(number);

  if (!validSlug(slug) || !n) return bad("주소가 올바르지 않아요.");
  const q = req.nextUrl.searchParams;
  const from = q.get("from") ? Number(q.get("from")) : undefined;
  const to = q.get("to") ? Number(q.get("to")) : undefined;
  const data = await episodeDraftView(slug, n, { from, to });

  return data ? json(data) : bad("없는 화예요.", 404);
}
