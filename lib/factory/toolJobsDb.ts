// lib/factory/toolJobsDb.ts
// 도구 일감(kind=tool, 2-3)의 DB 쪽: 설정, 등록(+자동 승인), 가져가기(앱 슬롯과 따로, 같은 카드 하나씩, 비용 한도), 감독에게 줄 입력. 순수 부분은 toolJobs.ts.
import { createHash, randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { LEASE_MS, type ClaimedJob } from "@/lib/factory/jobs";
import { MAX_PENDING_JOBS } from "@/lib/factory/jobs";
import { getDefaultAiEngine } from "@/lib/factory/settings";
import { resolvePicked, savePicks, type ArtDb } from "@/lib/factory/arts";
import { findCardRow, resolveCardForEnqueue } from "@/lib/factory/cardsDb";
import { readCardData } from "@/lib/factory/cards";
import { readManifestTools } from "@/lib/factory/toolManifestDb";
import { notifyJobEvent } from "@/lib/factory/telegram";
import {
  AI_TURN_METHODS,
  checkCostLimit,
  estimateToolCost,
  normalizeToolSettings,
  parseToolJobInput,
  pickToolClaims,
  readStoredToolSettings,
  readToolInput,
  shouldAutoApprove,
  sumUsage,
  TOOL_KIND,
  TOOL_SETTINGS_KEY,
  TOOL_STACK,
  TOOL_STATUS_CONFIRM,
  toolJobPlan,
  toolJobTitle,
  type CostRow,
  type ToolSettings,
  type Usage,
} from "@/lib/factory/toolJobs";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

// ───────── 설정 ─────────

export async function getToolSettings(): Promise<ToolSettings> {
  const row = await prisma.factorySetting.findUnique({ where: { key: TOOL_SETTINGS_KEY } });

  return readStoredToolSettings(row?.value);
}

export async function setToolSettings(input: unknown): Promise<ToolSettings> {
  const next = normalizeToolSettings(input, await getToolSettings());
  const value = JSON.stringify(next);

  await prisma.factorySetting.upsert({ where: { key: TOOL_SETTINGS_KEY }, create: { key: TOOL_SETTINGS_KEY, value }, update: { value } });

  return next;
}

// ───────── 비용 사용량 ─────────

/** 도구 일감이 이번 달에 쓴 PixelLab 호출 수(끝난 일감은 실제 비용, 진행 중은 예상 비용). 일·월 한도 계산용 */
export async function toolUsage(now = new Date(), exceptId?: string): Promise<Usage> {
  const monthStart = new Date(now.getTime() - 32 * 24 * 3600 * 1000); // 월 경계보다 넉넉히 가져와 sumUsage 가 자른다
  const rows = await prisma.factoryJob.findMany({
    where: { kind: TOOL_KIND, ...(exceptId ? { id: { not: exceptId } } : {}), OR: [{ status: "running" }, { startedAt: { gte: monthStart } }] },
    select: { status: true, startedAt: true, finishedAt: true, toolInput: true, toolResult: true },
    take: 3000,
  });
  const costs: CostRow[] = rows.map((r) => {
    const result = r.toolResult && typeof r.toolResult === "object" && !Array.isArray(r.toolResult) ? (r.toolResult as { cost?: unknown }) : null;
    const actual = typeof result?.cost === "number" ? result.cost : null;
    const est = readToolInput(r.toolInput)?.estimatedCost ?? 0;

    return { at: r.finishedAt ?? r.startedAt, cost: r.status === "running" ? Math.max(actual ?? 0, est) : (actual ?? 0) };
  });

  return sumUsage(costs, now);
}

// ───────── 등록 ─────────

export type ToolEnqueue = { ok: true; id: string; autoApproved: boolean; message: string } | { ok: false; message: string };

/**
 * 도구 일감 등록. args: { appSlug, card(이름 또는 id), count?, subject|subjects, extra?, refArtIds?, source? }
 * 카드·키·설명서를 검사하고(카드가 꺼져 있거나 AI 턴이 필요한 방법이면 거절), 설정이 허락하면 바로 승인 상태로 둔다.
 */
export async function enqueueToolJob(args: Record<string, unknown>, who: { source: string | null; autoApproveAllowed?: boolean } = { source: null }): Promise<ToolEnqueue> {
  const appSlug = typeof args.appSlug === "string" ? args.appSlug.trim() : "";

  if (!SLUG_RE.test(appSlug)) return { ok: false, message: "appSlug(카드가 있는 프로젝트 이름)가 필요해요." };
  if (typeof args.card !== "string" || !args.card.trim()) return { ok: false, message: "card(카드 이름 또는 id)가 필요해요. list_cards 로 확인하세요." };
  const input = parseToolJobInput(args);

  if (input.ok === false) return { ok: false, message: input.message };
  const found = await resolveCardForEnqueue(appSlug, args.card);

  if (found.ok === false) return { ok: false, message: found.message };
  const row = await findCardRow(appSlug, found.id);

  if (!row) return { ok: false, message: "카드를 읽지 못했어요." };
  const data = readCardData(row);

  if (AI_TURN_METHODS.has(data.method)) return { ok: false, message: `'${data.method}' 방법은 AI 턴이 필요해서 도구 일감으로는 아직 지원하지 않아요. enqueue_app_job 으로 보내세요.` };
  const tools = await readManifestTools();
  const manifest = tools[data.tool];

  if (!manifest) return { ok: false, message: `도구 설명서에 ${data.tool} 가 없어요(감독 프로그램이 설명서를 아직 보고하지 않았거나 도구 이름이 달라요).` };
  const picked = input.value.refArtIds.length ? await resolvePicked(prisma as unknown as ArtDb, appSlug, input.value.refArtIds) : [];

  if (picked.length !== input.value.refArtIds.length) return { ok: false, message: "고른 참고 그림 중 이 프로젝트의 '승인' 그림이 아닌 것이 있어요." };
  const estimated = estimateToolCost(manifest, data.method, input.value.count, input.value.subjects.length);
  const settings = await getToolSettings();
  const usage = estimated > 0 ? await toolUsage() : { day: 0, month: 0 };
  const auto = who.autoApproveAllowed !== false && shouldAutoApprove(settings, estimated, usage);
  const toolInput = { ...input.value, estimatedCost: estimated };
  const plan = toolJobPlan({ cardName: row.name, cardVersion: row.version, tool: data.tool, method: data.method, input: input.value, estimatedCost: estimated });
  const aiEngine = await getDefaultAiEngine().catch(() => "claude" as const);
  const now = new Date();

  const job = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"factory:tool-jobs"}))`;

    if ((await tx.factoryJob.count({ where: { status: "pending" } })) >= MAX_PENDING_JOBS) return null;

    return tx.factoryJob.create({
      data: {
        appSlug,
        title: toolJobTitle(row.name, input.value.subjects, input.value.count),
        kind: TOOL_KIND,
        planMarkdown: plan,
        planHash: createHash("sha256").update(plan + randomBytes(8).toString("hex")).digest("hex"), // 같은 요청을 연달아 보내도 막지 않는다
        stack: TOOL_STACK,
        aiEngine,
        requiredSecrets: found.secrets,
        source: who.source,
        cardId: found.id,
        toolInput,
        status: auto ? "approved" : "pending",
        approvedAt: auto ? now : null,
      },
      select: { id: true },
    });
  });

  if (!job) return { ok: false, message: `승인 대기 중인 지시가 ${MAX_PENDING_JOBS}개예요. 관리자가 정리한 뒤에 다시 보내세요.` };
  if (picked.length) await savePicks(prisma as unknown as Parameters<typeof savePicks>[0], job.id, picked.map((p) => p.id)).catch(() => undefined);
  if (!auto && who.source !== "통제실") void notifyJobEvent(job.id, "pending");

  return {
    ok: true,
    id: job.id,
    autoApproved: auto,
    message: auto
      ? `도구 일감을 등록하고 자동 승인했어요 (id: ${job.id}). 예상 비용 ${estimated}회. 곧 작업 PC 가 AI 없이 카드(${row.name})로 바로 만들어요.`
      : `도구 일감을 등록했어요 (id: ${job.id}). 승인 대기 상태예요(예상 비용 ${estimated}회). 관리자가 통제실·텔레그램에서 승인하면 AI 없이 카드(${row.name})로 바로 만들어요.`,
  };
}

// ───────── 가져가기 ─────────

/** 비용 한도에 걸려 멈추기: 일감을 확인 대기로 바꾸고 로그를 남긴다. 알림은 호출한 쪽이 보낸다(바뀐 일감만) */
async function holdForConfirmation(id: string, reason: string, now: Date): Promise<boolean> {
  const res = await prisma.factoryJob.updateMany({
    where: { id, status: "approved" },
    data: {
      status: TOOL_STATUS_CONFIRM,
      failReason: reason.slice(0, 1800),
      phase: TOOL_STATUS_CONFIRM,
      toolResult: { cost: 0, arts: [], message: reason.slice(0, 600), needsConfirmation: true } as Prisma.InputJsonObject,
      updatedAt: now,
    },
  });

  if (res.count > 0) await prisma.factoryJobLog.create({ data: { jobId: id, level: "warn", message: `비용 한도 확인이 필요해서 멈췄어요: ${reason}`.slice(0, 1900) } });

  return res.count > 0;
}

export interface ClaimedToolJob extends ClaimedJob {
  toolInput: unknown;
}

/**
 * 승인된 도구 일감을 가져간다(앱 슬롯과 따로). slots = 감독 프로그램이 지금 더 받을 수 있는 도구 일감 수.
 * 설정의 동시 실행 수 − 돌고 있는 수만큼, 같은 카드는 하나씩. 일·월 비용 한도를 넘는 일감은 가져가지 않고 확인 대기로 멈춘다(이미 확인된 일감은 통과).
 */
export async function claimToolJobs(worker: string, slots: number, now = new Date()): Promise<ClaimedToolJob[]> {
  if (slots <= 0) return [];
  const settings = await getToolSettings();
  const [approved, running] = await Promise.all([
    prisma.factoryJob.findMany({ where: { kind: TOOL_KIND, status: "approved" }, select: { id: true, cardId: true, approvedAt: true, createdAt: true, priority: true, toolInput: true }, take: 100 }),
    prisma.factoryJob.findMany({ where: { kind: TOOL_KIND, status: "running" }, select: { cardId: true } }),
  ]);

  if (!approved.length) return [];
  const usage = await toolUsage(now);
  const claimed: string[] = [];
  const held: string[] = [];
  let pool = approved;

  // 한도에 걸리는 일감은 슬롯을 쓰지 않고 멈춘 뒤, 다음 후보로 넘어간다
  for (let guard = 0; guard < 20; guard++) {
    const picks = pickToolClaims({ approved: pool, runningCardIds: [...running.map((r) => r.cardId), ...claimed.map((id) => approved.find((a) => a.id === id)?.cardId ?? null)], concurrency: settings.concurrency, slots: slots - claimed.length });

    if (!picks.length) break;
    pool = pool.filter((p) => !picks.includes(p.id));
    for (const id of picks) {
      const row = approved.find((a) => a.id === id);
      const input = readToolInput(row?.toolInput);
      const est = input?.estimatedCost ?? 0;
      const check = input?.confirmed ? ({ ok: true } as const) : checkCostLimit(usage, est, settings);

      if (check.ok === false) {
        if (await holdForConfirmation(id, check.reason, now)) held.push(id);
        continue;
      }
      claimed.push(id);
      usage.day += est;
      usage.month += est;
    }
    if (claimed.length >= slots) break;
  }
  for (const id of held) void notifyJobEvent(id, "needs_confirmation");
  if (!claimed.length) return [];
  const lease = new Date(now.getTime() + LEASE_MS);
  const won: string[] = [];

  for (const id of claimed) {
    const res = await prisma.factoryJob.updateMany({
      where: { id, status: "approved" },
      data: { status: "running", workerId: worker, leaseUntil: lease, attempts: { increment: 1 }, startedAt: now, phase: null, failReason: null, failStage: null, updatedAt: now },
    });

    if (res.count > 0) won.push(id);
  }
  if (!won.length) return [];
  const rows = await prisma.factoryJob.findMany({
    where: { id: { in: won } },
    select: { id: true, appSlug: true, title: true, kind: true, parentJobId: true, stack: true, priority: true, requiredSecrets: true, planMarkdown: true, attempts: true, aiEngine: true, aiModel: true, parallelGroup: true, cardId: true, toolInput: true },
  });

  await prisma.factoryJobLog.createMany({ data: rows.map((r) => ({ jobId: r.id, level: "info", message: `${worker} 가 가져감 (시도 ${r.attempts} · 도구 일감: AI 없이 카드로 바로 실행)` })) });

  return rows.map((r) => ({ ...r, aiEngine: r.aiEngine as ClaimedJob["aiEngine"] }));
}
