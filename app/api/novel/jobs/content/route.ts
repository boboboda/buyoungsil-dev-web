// app/api/novel/jobs/content/route.ts
// 소설 실행기가 작업 PC 폴더의 원고·검수를 웹에 올리는 주소(7-1). 작업 없이도 쓴다(시작 때·주기적 동기화). 작업 PC 토큰 인증.
// POST { slug, episode, title?, chapter?, review?, verdict?, mustCount?, recCount?, charCount? } → { ok, created, changed }
// 공개 본문(body)·화 상태·예약 발행은 건드리지 않고 원고·검수 사본(draft*)에만 쓴다. 없는 작품은 설정 승인 전(setup)·일시 정지로 만든다.
import { NextRequest, NextResponse } from "next/server";

import { fail, guardWorker } from "@/lib/factory/http";
import { MAX_CHAPTER_CHARS, MAX_REVIEW_CHARS, NOVEL_SLUG_RE, parseVerdict, validEpisode } from "@/lib/novel/jobRules";
import { saveDraft } from "@/lib/novel/jobStore";
import { MAX_REPORT_BYTES } from "@/lib/novel/rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const int = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);

  if (blocked) return blocked;
  let b: Record<string, unknown> | null;

  try {
    const text = await req.text();

    if (new TextEncoder().encode(text).length > MAX_REPORT_BYTES * 2) return fail(413, "요청이 너무 큽니다.");
    const parsed = JSON.parse(text);

    b = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return fail(400, "JSON 형식이 아닙니다.");
  }
  if (!b || typeof b.slug !== "string" || !NOVEL_SLUG_RE.test(b.slug) || !validEpisode(b.episode)) return fail(400, "slug 와 episode 가 필요해요.");
  const chapter = typeof b.chapter === "string" ? b.chapter.slice(0, MAX_CHAPTER_CHARS) : null;
  const review = typeof b.review === "string" ? b.review.slice(0, MAX_REVIEW_CHARS) : null;

  if (chapter === null && review === null) return fail(400, "chapter 나 review 가 필요해요.");
  try {
    const r = await saveDraft({
      slug: b.slug,
      episode: b.episode,
      title: typeof b.title === "string" ? b.title : null,
      chapter,
      review,
      verdict: typeof b.verdict === "string" && ["PASS", "FAIL", "UNKNOWN"].includes(b.verdict) ? b.verdict : review ? parseVerdict(review) : null,
      must: int(b.mustCount, 9999),
      rec: int(b.recCount, 9999),
      chars: int(b.charCount, 200_000),
    });

    return r.ok === false ? fail(r.status, r.message) : NextResponse.json({ ok: true, ...r.value });
  } catch (error) {
    console.error("[novel-jobs] content 실패:", error);

    return fail(500, "처리에 실패했습니다.");
  }
}
