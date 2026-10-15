// app/api/admin/novel/jobs/[id]/route.ts
// GET: 작업 상태·진행 로그(logTail). POST { action: 'approve' | 'cancel', force?: boolean }: 승인(하루 비용 한도를 넘었으면 force 로 한 번 더 확인)·취소. 관리자만.
import { NextRequest } from "next/server";

import { adminGate, bad, json, readSmallJson } from "@/lib/novel/adminHttp";
import { approveJob, cancelJob, getJob } from "@/lib/novel/jobStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await adminGate();

  if (denied) return denied;
  const { id } = await params;

  if (!ID_RE.test(id)) return bad("주소가 올바르지 않아요.");
  const job = await getJob(id);

  return job ? json({ job }) : bad("없는 작업이에요.", 404);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await adminGate(true);

  if (denied) return denied;
  const { id } = await params;

  if (!ID_RE.test(id)) return bad("주소가 올바르지 않아요.");
  const read = await readSmallJson(req);

  if (read.ok === false) return read.res;
  const { action } = read.body;

  if (action !== "approve" && action !== "cancel") return bad("action 은 approve 또는 cancel 이에요.");
  const r = action === "approve" ? await approveJob(id, read.body.force === true) : await cancelJob(id);

  return r.ok === false ? json({ message: r.message, ...(r.extra ?? {}) }, r.status) : json({ ok: true, job: r.value, message: r.message });
}
