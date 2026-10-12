import { NextRequest, NextResponse } from "next/server";
import { fail, guardWorker, readJson } from "@/lib/factory/http";
import { getDefaultAiEngine } from "@/lib/factory/settings";
import { hookThreadStatus, parseHookSubmission, submitHookTask } from "@/lib/factory/hook-tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;
  const threadId = req.nextUrl.searchParams.get("threadId");
  try {
    if (threadId !== null) {
      const thread = await hookThreadStatus(threadId);
      return thread ? NextResponse.json({ thread }) : fail(404, "없는 정비예요.");
    }
    return NextResponse.json({ defaultAiEngine: await getDefaultAiEngine(), approvalRequired: true });
  } catch { return fail(500, "훅 연결 상태를 확인하지 못했어요."); }
}

export async function POST(req: NextRequest) {
  const blocked = await guardWorker(req);
  if (blocked) return blocked;
  const json = await readJson(req);
  if (json.ok === false) return json.res;
  const body = parseHookSubmission(json.body);
  if (!body) return fail(400, "훅 지시 형식이 올바르지 않아요. 승인·배포 요청은 통제실에서 처리하세요.");
  try {
    const result = await submitHookTask(body);
    return NextResponse.json(result, { status: result.status });
  } catch { return fail(500, "정비 지시를 등록하지 못했어요. 같은 요청 ID로 다시 시도할 수 있어요."); }
}
