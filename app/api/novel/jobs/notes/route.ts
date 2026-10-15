// app/api/novel/jobs/notes/route.ts
// 소설 실행기의 메모 조회·반영 표시(7-1). 작업 PC 토큰 인증.
// GET ?slug&episode → { notes: [{ id, line, kind, text, memoLine }] }(열린 메모)   POST { slug, episode, ids: [...] } → { ok, applied }(applied 처리)
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { NOVEL_SLUG_RE, memoLine, validEpisode } from "@/lib/novel/jobRules";
import { markNotesApplied, openNotes } from "@/lib/novel/jobStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  const slug = req.nextUrl.searchParams.get("slug") ?? "";
  const episode = Number(req.nextUrl.searchParams.get("episode"));

  if (!NOVEL_SLUG_RE.test(slug) || !validEpisode(episode)) return fail(400, "slug 와 episode 가 필요해요.");
  try {
    const notes = await openNotes(slug, episode);

    return NextResponse.json({ notes: notes.map((n) => ({ id: n.id, line: n.line, kind: n.kind, text: n.text, memoLine: memoLine(n) })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[novel-jobs] notes 조회 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  const read = await readJson(req);

  if (read.ok === false) return read.res;
  const b = read.body as { slug?: unknown; episode?: unknown; ids?: unknown } | null;

  if (!b || typeof b.slug !== "string" || !NOVEL_SLUG_RE.test(b.slug) || !validEpisode(b.episode) || !Array.isArray(b.ids)) return fail(400, "slug, episode, ids 가 필요해요.");
  const ids = b.ids.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x));

  try {
    return NextResponse.json({ ok: true, applied: await markNotesApplied(b.slug, b.episode, ids) });
  } catch (error) {
    console.error("[novel-jobs] notes 반영 표시 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
