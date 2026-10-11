// app/api/admin/factory/rules/route.ts
// 감독 프로그램이 Claude 에게 주는 작업 규칙(구역별) 보기·고치기. 관리자만.
// 주의: 이 글은 작업 PC 에서 Bash 를 쓸 수 있는 Claude 에게 그대로 전달된다.
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { DEFAULT_RULES, RULE_SECTIONS, getRuleOverrides, setRuleOverride } from "@/lib/factory/rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function view() {
  const overrides = await getRuleOverrides();

  return {
    sections: RULE_SECTIONS.map((s) => ({
      id: s.id,
      label: s.label,
      default: DEFAULT_RULES[s.id],
      text: overrides[s.id] ?? DEFAULT_RULES[s.id],
      custom: overrides[s.id] !== undefined,
    })),
  };
}

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await view());
}

// 본문: { section, text: string | null }  (null 이면 기본값으로)
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { section?: unknown; text?: unknown } | null;

  if (typeof body?.section !== "string" || (body.text !== null && typeof body.text !== "string")) {
    return NextResponse.json({ message: "section 과 text(문자열 또는 null)가 필요해요." }, { status: 400 });
  }
  const r = await setRuleOverride(body.section, body.text as string | null);

  return NextResponse.json({ message: r.message, ...(r.ok ? await view() : {}) }, { status: r.ok ? 200 : 400 });
}
