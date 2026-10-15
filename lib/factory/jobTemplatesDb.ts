// lib/factory/jobTemplatesDb.ts
// 일감 템플릿(5-3)의 저장·목록·등록. 기본 템플릿은 코드(jobTemplates.ts), 사람이 만든 것은 factory_job_templates.
// 등록은 기존 등록 함수(enqueueWithId·enqueueLabJob·enqueueToolJob)를 그대로 불러서 같은 검사를 받는다. 템플릿 id 는 서버 안에서만 일감에 붙인다.
import { randomBytes } from "node:crypto";

import prisma from "@/lib/prisma";
import { BUILTIN_TEMPLATES, cleanTemplateInput, fillTemplate, instructionFromTemplate, isBuiltinTemplateId, templateVars, type TemplateDef, type TemplateKind, type ApprovalMode } from "@/lib/factory/jobTemplates";
import { enqueueLabJob, enqueueWithId } from "@/lib/factory/mcp";
import { enqueueToolJob } from "@/lib/factory/toolJobsDb";

type Row = { id: string; name: string; kind: string; body: string; description: string; priority: number; requiredSecrets: string[]; approvalMode: string; cardName: string | null; toolCount: number | null };

const fromRow = (r: Row): TemplateDef => ({
  id: r.id,
  name: r.name,
  kind: r.kind as TemplateKind,
  body: r.body,
  description: r.description,
  priority: r.priority,
  requiredSecrets: r.requiredSecrets,
  approvalMode: r.approvalMode as ApprovalMode,
  cardName: r.cardName,
  toolCount: r.toolCount,
  builtin: false,
});

/** 기본 템플릿 + 사람이 만든 템플릿(이름순) */
export async function listTemplates(): Promise<TemplateDef[]> {
  const rows = await prisma.factoryJobTemplate.findMany({ orderBy: { name: "asc" }, take: 200 }).catch(() => [] as Row[]);

  return [...BUILTIN_TEMPLATES, ...rows.map(fromRow)];
}

/** id 또는 이름으로 한 개 */
export async function getTemplate(ref: string): Promise<TemplateDef | null> {
  const key = (ref ?? "").trim();

  if (!key) return null;
  const builtin = BUILTIN_TEMPLATES.find((t) => t.id === key || t.name === key);

  if (builtin) return builtin;
  const row = await prisma.factoryJobTemplate.findFirst({ where: { OR: [{ id: key }, { name: key }] } });

  return row ? fromRow(row) : null;
}

export async function saveTemplate(raw: unknown, id?: string): Promise<{ ok: true; template: TemplateDef } | { ok: false; message: string; status: number }> {
  const check = cleanTemplateInput(raw);

  if (check.ok === false) return { ok: false, message: check.message, status: 400 };
  if (id && isBuiltinTemplateId(id)) return { ok: false, message: "기본 템플릿은 고칠 수 없어요. 복사해서 새 이름으로 저장하세요.", status: 400 };
  const dup = await prisma.factoryJobTemplate.findFirst({ where: { name: check.value.name, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });

  if (dup) return { ok: false, message: "같은 이름의 템플릿이 이미 있어요.", status: 409 };
  const data = { ...check.value };

  if (id) {
    const res = await prisma.factoryJobTemplate.updateMany({ where: { id }, data });

    if (!res.count) return { ok: false, message: "없는 템플릿이에요.", status: 404 };

    return { ok: true, template: { ...data, id, builtin: false } };
  }
  const total = await prisma.factoryJobTemplate.count();

  if (total >= 100) return { ok: false, message: "템플릿은 100개까지예요. 안 쓰는 것을 지워 주세요.", status: 409 };
  const created = await prisma.factoryJobTemplate.create({ data: { id: `tpl_${randomBytes(8).toString("hex")}`, ...data } });

  return { ok: true, template: fromRow(created) };
}

export async function deleteTemplate(id: string): Promise<{ ok: boolean; message: string; status: number }> {
  if (isBuiltinTemplateId(id)) return { ok: false, message: "기본 템플릿은 지울 수 없어요.", status: 400 };
  const res = await prisma.factoryJobTemplate.deleteMany({ where: { id } });

  if (!res.count) return { ok: false, message: "없는 템플릿이에요.", status: 404 };
  // 자동 승인 규칙에 지정돼 있었다면 함께 뺀다
  const { getAutoRules, setAutoRules } = await import("@/lib/factory/autoApproveDb");
  const rules = await getAutoRules();

  if (rules.templateIds.includes(id)) await setAutoRules({ ...rules, templateIds: rules.templateIds.filter((x) => x !== id) });

  return { ok: true, message: "템플릿을 지웠어요.", status: 200 };
}

export interface EnqueueFromTemplateInput {
  template: string; // id 또는 이름
  values?: unknown; // { 빈칸 이름: 값 }
  appSlug?: string; // 수정·도구 템플릿에 필요
  priority?: number;
  aiEngine?: unknown;
  approve?: boolean; // true 면 등록 직후 승인(통제실 [바로 승인])
  source: string;
}

export type EnqueueFromTemplateResult = { ok: true; jobId: string; message: string } | { ok: false; message: string; status: number };

export async function enqueueFromTemplate(input: EnqueueFromTemplateInput): Promise<EnqueueFromTemplateResult> {
  const tpl = await getTemplate(input.template);

  if (!tpl) return { ok: false, status: 404, message: "그런 템플릿이 없어요. 목록(list_templates)에서 이름이나 id 를 확인하세요." };
  const filled = fillTemplate(tpl.body, input.values);

  if (filled.ok === false) return { ok: false, status: 400, message: `빈칸을 채워 주세요: ${filled.missing.join(", ")}` };
  const appSlug = (input.appSlug ?? "").trim();
  const source = input.source;
  const priority = input.priority === undefined ? tpl.priority : input.priority;
  let jobId: string | undefined;
  let message = "";

  if (tpl.kind === "revision") {
    if (!appSlug) return { ok: false, status: 400, message: "수정 템플릿은 앱(appSlug)을 골라야 해요." };
    const last = await prisma.factoryJob.findFirst({ where: { appSlug, status: "done" }, orderBy: { finishedAt: "desc" }, select: { title: true } });

    if (!last) return { ok: false, status: 404, message: "완성된 앱만 고칠 수 있어요." };
    const r = await enqueueWithId({ appSlug, title: last.title, kind: "revision", planMarkdown: instructionFromTemplate(tpl, filled.text), priority, requiredSecrets: tpl.requiredSecrets, source, aiEngine: input.aiEngine }, { templateId: tpl.id });

    if (r.isError || !r.jobId) return { ok: false, status: 409, message: r.content[0]?.text ?? "등록하지 못했어요." };
    jobId = r.jobId;
    message = r.content[0]?.text ?? "";
  } else if (tpl.kind === "lab") {
    const firstValue = templateVars(tpl.body).map((v) => (input.values && typeof input.values === "object" ? String((input.values as Record<string, unknown>)[v.name] ?? "") : "")).find((v) => v.trim()) ?? "";
    const title = `${tpl.name}${firstValue ? `: ${firstValue.replace(/\s+/g, " ").trim()}` : ""}`.slice(0, 80);
    const r = await enqueueLabJob({ title, planMarkdown: instructionFromTemplate(tpl, filled.text), aiEngine: input.aiEngine, source }, { templateId: tpl.id });

    if (r.isError || !r.jobId) return { ok: false, status: 409, message: r.content[0]?.text ?? "등록하지 못했어요." };
    jobId = r.jobId;
    message = r.content[0]?.text ?? "";
  } else {
    if (!appSlug) return { ok: false, status: 400, message: "도구 템플릿은 카드가 있는 프로젝트(appSlug)를 골라야 해요." };
    const r = await enqueueToolJob({ appSlug, card: tpl.cardName, subject: filled.text, count: tpl.toolCount ?? 1 }, { source, templateId: tpl.id });

    if (r.ok === false) return { ok: false, status: 400, message: r.message };
    jobId = r.id;
    message = r.message;
  }

  const approved = await maybeApprove(jobId, tpl, input.approve === true);

  return { ok: true, jobId, message: approved ? `${message} ${approved}` : message };
}

async function maybeApprove(jobId: string, tpl: TemplateDef, approve: boolean): Promise<string> {
  const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { status: true } });

  if (!approve || job?.status !== "pending") return "";
  const { adminAction } = await import("@/lib/factory/jobs");
  const choice = tpl.approvalMode === "plan" ? { planFirst: true } : tpl.approvalMode === "now" ? { planFirst: false } : {};
  const r = await adminAction(jobId, { action: "approve", ...choice });

  return r.ok ? "바로 승인했어요." : "";
}
