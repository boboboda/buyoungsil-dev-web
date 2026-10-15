// app/api/admin/novel/job-settings/route.ts
// 소설 실행 설정: 하루 비용 한도(기본 $8)·[검수만] 자동 승인 규칙(기본 꺼짐), 오늘(최근 24시간) 쓴 비용. 관리자만.
// GET → { capUsd, capIsDefault, spentUsd, over, autoApproveCheck }   PUT { capUsd?: number, autoApproveCheck?: boolean }
import { NextRequest } from "next/server";

import { adminGate, bad, json, readSmallJson } from "@/lib/novel/adminHttp";
import { cleanCap } from "@/lib/novel/jobRules";
import { costStatus, getAutoApproveCheck, setAutoApproveCheck, setCapUsd } from "@/lib/novel/jobStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const view = async () => ({ ...(await costStatus()), autoApproveCheck: await getAutoApproveCheck() });

export async function GET() {
  const denied = await adminGate();

  if (denied) return denied;

  return json(await view());
}

export async function PUT(req: NextRequest) {
  const denied = await adminGate(true);

  if (denied) return denied;
  const read = await readSmallJson(req);

  if (read.ok === false) return read.res;
  if (read.body.capUsd !== undefined) {
    const cap = cleanCap(read.body.capUsd);

    if (cap === null) return bad("하루 비용 한도는 0 이상 1000 이하 숫자예요.");
    await setCapUsd(cap);
  }
  if (read.body.autoApproveCheck !== undefined) {
    if (typeof read.body.autoApproveCheck !== "boolean") return bad("autoApproveCheck 는 true/false 예요.");
    await setAutoApproveCheck(read.body.autoApproveCheck);
  }

  return json({ ok: true, ...(await view()) });
}
