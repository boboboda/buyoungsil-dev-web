// app/api/admin/novel/works/[slug]/episodes/[number]/release-hold/route.ts
// 보류 해제 { note? }: 보류된 화를 revising 으로 돌린다(메모가 있으면 실행기에 전달). 관리자만.
import { NextRequest } from "next/server";

import {
  adminGate,
  bad,
  readSmallJson,
  resultResponse,
  validNumber,
  validSlug,
} from "@/lib/novel/adminHttp";
import { parseNote } from "@/lib/novel/rules";
import { releaseHold } from "@/lib/novel/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; number: string }> },
) {
  const denied = await adminGate(true);

  if (denied) return denied;
  const { slug, number } = await params;
  const n = validNumber(number);

  if (!validSlug(slug) || !n) return bad("주소가 올바르지 않아요.");
  const read = await readSmallJson(req);

  if (read.ok === false) return read.res;
  const note = parseNote(read.body.note, false);

  if (note.ok === false) return bad(note.reason);

  return resultResponse(await releaseHold(slug, n, note.value));
}
