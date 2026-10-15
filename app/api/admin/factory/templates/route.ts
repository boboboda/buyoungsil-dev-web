// app/api/admin/factory/templates/route.ts
// 일감 템플릿(5-3)과 자동 승인 규칙. 관리자만.
//   GET                                                     → { templates, rules, apps, cards }  (apps = 완성된 앱, cards = 카드 이름 목록)
//   POST { action: "enqueue", template, values?, appSlug?, priority?, aiEngine?, approve? }   → 템플릿으로 일감 등록('통제실' 출처, approve 면 바로 승인)
//   POST { action: "save", template: {name, kind, body, …}, id? }  → 내 템플릿 만들기·고치기
//   POST { action: "delete", id }                            → 내 템플릿 지우기(기본 템플릿은 못 지움)
//   POST { action: "rules", rules: {lab, tool, docs, template, templateIds} } → 자동 승인 규칙 저장(기본 모두 꺼짐)
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/factory/admin";
import { isAiEngine } from "@/lib/factory/ai";
import { getAutoRules, setAutoRules } from "@/lib/factory/autoApproveDb";
import { deleteTemplate, enqueueFromTemplate, listTemplates, saveTemplate } from "@/lib/factory/jobTemplatesDb";
import { templateVars } from "@/lib/factory/jobTemplates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

async function snapshot() {
  const [templates, rules, doneRows, cards] = await Promise.all([
    listTemplates(),
    getAutoRules(),
    prisma.factoryJob.findMany({ where: { status: "done" }, orderBy: { finishedAt: "desc" }, take: 300, select: { appSlug: true, title: true, kind: true } }),
    prisma.factoryCard.findMany({ orderBy: [{ appSlug: "asc" }, { name: "asc" }], take: 300, select: { appSlug: true, name: true } }).catch(() => []),
  ]);
  const seen = new Set<string>();
  const apps = doneRows.filter((r) => r.kind !== "lab" && r.kind !== "tool" && !seen.has(r.appSlug) && !!seen.add(r.appSlug)).map((r) => ({ appSlug: r.appSlug, title: r.title }));

  return { templates: templates.map((t) => ({ ...t, vars: templateVars(t.body) })), rules, apps, cards };
}

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await snapshot(), { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "요청 형식이 올바르지 않아요." }, { status: 400 });

  switch (body.action) {
    case "enqueue": {
      if (typeof body.template !== "string") return NextResponse.json({ message: "템플릿을 골라 주세요." }, { status: 400 });
      if (body.aiEngine !== undefined && body.aiEngine !== "default" && !isAiEngine(body.aiEngine)) return NextResponse.json({ message: "작업 AI가 올바르지 않아요." }, { status: 400 });
      if (body.priority !== undefined && (typeof body.priority !== "number" || !Number.isInteger(body.priority) || body.priority < -100 || body.priority > 100)) return NextResponse.json({ message: "우선순위는 -100~100 사이 정수예요." }, { status: 400 });
      const r = await enqueueFromTemplate({
        template: body.template,
        values: body.values,
        appSlug: typeof body.appSlug === "string" ? body.appSlug : undefined,
        priority: body.priority as number | undefined,
        aiEngine: body.aiEngine === "default" ? undefined : body.aiEngine,
        approve: body.approve === true,
        source: "통제실",
      });

      if (r.ok === false) return NextResponse.json({ message: r.message }, { status: r.status });

      return NextResponse.json({ jobId: r.jobId, message: r.message }, { headers: NO_STORE });
    }
    case "save": {
      const r = await saveTemplate(body.template, typeof body.id === "string" ? body.id : undefined);

      if (r.ok === false) return NextResponse.json({ message: r.message }, { status: r.status });

      return NextResponse.json({ message: "템플릿을 저장했어요.", ...(await snapshot()) }, { headers: NO_STORE });
    }
    case "delete": {
      const r = await deleteTemplate(typeof body.id === "string" ? body.id : "");

      return r.ok ? NextResponse.json({ message: r.message, ...(await snapshot()) }, { headers: NO_STORE }) : NextResponse.json({ message: r.message }, { status: r.status });
    }
    case "rules": {
      const rules = await setAutoRules(body.rules);
      const on = [rules.lab && "실험", rules.tool && "도구", rules.docs && "문서", rules.template && rules.templateIds.length > 0 && "템플릿"].filter(Boolean);

      return NextResponse.json({ message: on.length ? `자동 승인 규칙을 저장했어요(켜짐: ${on.join("·")}). 출시 일감과 배포는 늘 사람이 승인해요.` : "자동 승인 규칙을 모두 껐어요.", ...(await snapshot()) }, { headers: NO_STORE });
    }
    default:
      return NextResponse.json({ message: "알 수 없는 동작이에요." }, { status: 400 });
  }
}
