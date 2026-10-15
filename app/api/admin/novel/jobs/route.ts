// app/api/admin/novel/jobs/route.ts
// 소설 실행 일감 만들기(7-1). POST { workSlug, episode, mode: 'check'|'revise'|'fresh' } → 승인 대기(자동 승인 규칙이 켜져 있으면 [검수만]은 바로 승인). 관리자만.
// GET ?workSlug&episode: 그 화의 최근 작업 목록.
import { NextRequest } from "next/server";

import { adminGate, bad, json, readSmallJson, validNumber, validSlug } from "@/lib/novel/adminHttp";
import { isJobMode } from "@/lib/novel/jobRules";
import { createJob, listJobs } from "@/lib/novel/jobStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await adminGate();

  if (denied) return denied;
  const slug = req.nextUrl.searchParams.get("workSlug") ?? "";
  const n = validNumber(req.nextUrl.searchParams.get("episode") ?? "");

  if (!validSlug(slug) || !n) return bad("workSlug 와 episode 가 필요해요.");

  return json({ jobs: await listJobs(slug, n, 20) });
}

export async function POST(req: NextRequest) {
  const denied = await adminGate(true);

  if (denied) return denied;
  const read = await readSmallJson(req);

  if (read.ok === false) return read.res;
  const { workSlug, episode, mode } = read.body;
  const n = validNumber(String(episode ?? ""));

  if (typeof workSlug !== "string" || !validSlug(workSlug) || !n) return bad("작품 이름과 화 번호가 올바르지 않아요.");
  if (!isJobMode(mode)) return bad("mode 는 check, revise, fresh 중 하나예요.");
  const r = await createJob({ workSlug, episode: n, mode, requestedBy: "web" });

  return r.ok === false ? json({ message: r.message, ...(r.extra ?? {}) }, r.status) : json({ ok: true, job: r.value, message: r.message });
}
