// lib/factory/autoApproveDb.ts
// 자동 승인 규칙(5-3)의 저장·적용. 규칙은 factory_settings 한 칸(JSON)에 둔다. 기본은 모두 꺼짐.
// maybeAutoApprove: 일감이 등록된 직후 부르면, 켜진 규칙에 맞을 때 평소 승인과 같은 길(adminAction approve)로 승인한다.
// 절대 던지지 않는다(실패하면 그냥 승인 대기로 남는다).
import prisma from "@/lib/prisma";
import { anyRuleOn, autoApproveNotice, autoRuleLabel, cleanAutoRules, decideAutoApprove, DEFAULT_AUTO_RULES, type AutoApproveRules } from "@/lib/factory/autoApprove";
import { notifyText } from "@/lib/factory/telegram";

const KEY = "autoApproveRules";

export async function getAutoRules(): Promise<AutoApproveRules> {
  const row = await prisma.factorySetting.findUnique({ where: { key: KEY } }).catch(() => null);

  if (!row) return DEFAULT_AUTO_RULES;
  try {
    return cleanAutoRules(JSON.parse(row.value));
  } catch {
    return DEFAULT_AUTO_RULES;
  }
}

export async function setAutoRules(raw: unknown): Promise<AutoApproveRules> {
  const rules = cleanAutoRules(raw);
  const value = JSON.stringify(rules);

  await prisma.factorySetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });

  return rules;
}

/** 방금 등록된 대기 일감이 규칙에 맞으면 승인한다. 승인했으면 규칙 이름, 아니면 null */
export async function maybeAutoApprove(jobId: string, facts: { toolWithinLimit?: boolean } = {}): Promise<string | null> {
  try {
    const rules = await getAutoRules();

    if (!anyRuleOn(rules)) return null;
    const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { id: true, appSlug: true, title: true, kind: true, releaseKind: true, status: true, templateId: true, planMarkdown: true } });

    if (!job || job.status !== "pending") return null;
    const decision = decideAutoApprove({ kind: job.kind, releaseKind: job.releaseKind, templateId: job.templateId, planMarkdown: job.planMarkdown, toolWithinLimit: facts.toolWithinLimit }, rules);

    if (!decision) return null;
    const template = job.templateId ? await (await import("@/lib/factory/jobTemplatesDb")).getTemplate(job.templateId).catch(() => null) : null;
    const planChoice = template?.approvalMode === "plan" ? { planFirst: true } : template?.approvalMode === "now" ? { planFirst: false } : {};
    const { adminAction } = await import("@/lib/factory/jobs");
    const r = await adminAction(job.id, { action: "approve", ...planChoice });

    if (!r.ok) return null;
    await prisma.factoryJob.updateMany({ where: { id: job.id }, data: { autoApprovedBy: decision.rule } });
    await prisma.factoryJobLog.create({ data: { jobId: job.id, level: "info", message: `자동 승인: '${decision.label}' 규칙에 맞아 승인 없이 대기열에 넣었어요.` } }).catch(() => undefined);
    void notifyText(autoApproveNotice(job.title, job.appSlug, decision.label), "/admin/factory?tab=jobs");

    return decision.rule;
  } catch (e) {
    console.error("[auto-approve] 처리 실패:", e instanceof Error ? e.name : "unknown");

    return null;
  }
}

export interface AutoApprovedView {
  id: string;
  appSlug: string;
  title: string;
  kind: string;
  status: string;
  rule: string;
  label: string; // 규칙 이름(화면이 그대로 쓴다)
  at: string;
}

/** [현황]에 보일 최근 자동 승인 일감(하루 안, 최대 8개) */
export async function recentAutoApproved(now = Date.now()): Promise<AutoApprovedView[]> {
  const rows = await prisma.factoryJob
    .findMany({
      where: { autoApprovedBy: { not: null }, approvedAt: { gte: new Date(now - 24 * 3600 * 1000) } },
      orderBy: { approvedAt: "desc" },
      take: 8,
      select: { id: true, appSlug: true, title: true, kind: true, status: true, autoApprovedBy: true, approvedAt: true },
    })
    .catch(() => []);

  return rows.map((r) => ({ id: r.id, appSlug: r.appSlug, title: r.title, kind: r.kind, status: r.status, rule: r.autoApprovedBy ?? "", label: autoRuleLabel(r.autoApprovedBy) ?? r.autoApprovedBy ?? "", at: (r.approvedAt ?? new Date(now)).toISOString() }));
}
