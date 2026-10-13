// app/api/admin/novel/works/[slug]/episodes/[number]/revise/route.ts
// 수정 요청 { note }(필수, 2000자): 승인 대기 화를 revising 으로 돌리고 메모를 남긴다. 실행기가 sync 로 받아 다시 쓴다. 관리자만.
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
import { reviseEpisode } from "@/lib/novel/store";

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
  const note = parseNote(read.body.note, true);

  if (note.ok === false) return bad(note.reason);

  return resultResponse(await reviseEpisode(slug, n, note.value as string));
}
