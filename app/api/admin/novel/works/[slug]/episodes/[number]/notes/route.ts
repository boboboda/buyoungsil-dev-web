// app/api/admin/novel/works/[slug]/episodes/[number]/notes/route.ts
// 줄 메모(7-1). POST { line?, kind: '필수'|'권장', text } 추가, DELETE ?id=… 열린 메모 삭제. 관리자만.
import { NextRequest } from "next/server";

import { adminGate, bad, json, readSmallJson, validNumber, validSlug } from "@/lib/novel/adminHttp";
import { parseNoteInput } from "@/lib/novel/jobRules";
import { addNote, deleteNote } from "@/lib/novel/jobStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string; number: string }> }) {
  const denied = await adminGate(true);

  if (denied) return denied;
  const { slug, number } = await params;
  const n = validNumber(number);

  if (!validSlug(slug) || !n) return bad("주소가 올바르지 않아요.");
  const read = await readSmallJson(req);

  if (read.ok === false) return read.res;
  const note = parseNoteInput(read.body);

  if (note.ok === false) return bad(note.reason);
  const r = await addNote({ workSlug: slug, episode: n, ...note.value, createdBy: "admin" });

  return r.ok === false ? bad(r.message, r.status) : json({ ok: true, id: r.value.id });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string; number: string }> }) {
  const denied = await adminGate(true);

  if (denied) return denied;
  const { slug, number } = await params;
  const id = req.nextUrl.searchParams.get("id") ?? "";

  if (!validSlug(slug) || !validNumber(number) || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return bad("주소가 올바르지 않아요.");
  const r = await deleteNote(id);

  return r.ok === false ? bad(r.message, r.status) : json({ ok: true });
}
