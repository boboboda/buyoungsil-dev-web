// lib/factory/runStatsDb.ts
// 블록별 비용·시간 통계(4-4)의 DB 쪽: 일감·정비 지시·지휘자 판단이 끝날 때 한 줄을 남기고(recordXxx), 모아서 읽는다(readUsageByBlock).
// 기록은 어떤 경우에도 던지지 않는다(실패하면 통계 한 줄만 빠지고 본래 보고는 그대로 처리). 비밀값은 다루지 않는다.
import prisma from "@/lib/prisma";
import { loadDeployWindows } from "@/lib/factory/deployWindow";
import {
  aggregate,
  agentOf,
  classifyResult,
  cleanStat,
  externalOf,
  shareTokens,
  timingOf,
  weekSummaries,
  ZERO_TOKENS,
  type GroupBy,
  type Period,
  type RunStat,
  type TokenSum,
  type UsageByBlock,
} from "@/lib/factory/runStats";

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const KEEP_DAYS = 200; // 이보다 오래된 줄은 기록할 때 가끔 지운다
const READ_DAYS = 180;

async function eventTokens(where: { sessionId?: string; project?: string; device?: string | null }, from: Date, to: Date): Promise<TokenSum> {
  try {
    const s = await prisma.claudeEvent.aggregate({
      where: { at: { gt: from, lte: to }, ...(where.sessionId ? { sessionId: where.sessionId } : { session: { project: where.project, ...(where.device ? { device: where.device } : {}) } }) },
      _sum: { inputDelta: true, outputDelta: true, cacheCreateDelta: true, cacheReadDelta: true },
    });

    return { input: n(s._sum.inputDelta), output: n(s._sum.outputDelta), cacheCreate: n(s._sum.cacheCreateDelta), cacheRead: n(s._sum.cacheReadDelta) };
  } catch {
    return { ...ZERO_TOKENS };
  }
}

async function save(stat: RunStat): Promise<void> {
  const data = {
    agent: stat.agent,
    appSlug: stat.appSlug,
    cardId: stat.cardId,
    tool: stat.tool,
    method: stat.method,
    result: stat.result,
    inputTokens: BigInt(stat.tokens.input),
    outputTokens: BigInt(stat.tokens.output),
    cacheCreate: BigInt(stat.tokens.cacheCreate),
    cacheRead: BigInt(stat.tokens.cacheRead),
    waitMs: stat.waitMs,
    runMs: stat.runMs,
    pausedMs: stat.pausedMs,
    redoCount: stat.redoCount,
    externalCost: stat.externalCost,
    externalLabel: stat.externalLabel,
    at: new Date(stat.at),
  };

  await prisma.factoryRunStat.upsert({ where: { kind_refId: { kind: stat.kind, refId: stat.refId } }, create: { kind: stat.kind, refId: stat.refId, ...data }, update: data });

  if (Math.random() < 0.02) await prisma.factoryRunStat.deleteMany({ where: { at: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
}

/** 일감이 끝났을 때(done·failed) 또는 비용 한도 때문에 멈췄을 때(needs_confirmation) 한 줄을 남긴다 */
export async function recordJobStat(jobId: string, status: string): Promise<void> {
  try {
    const job = await prisma.factoryJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        kind: true,
        releaseKind: true,
        parallelGroup: true,
        appSlug: true,
        cardId: true,
        status: true,
        aiEngine: true,
        workerId: true,
        attempts: true,
        failStage: true,
        failReason: true,
        parallelInfo: true,
        toolResult: true,
        toolRequests: true,
        createdAt: true,
        approvedAt: true,
        startedAt: true,
      },
    });

    if (!job) return;
    const now = new Date();
    const started = job.startedAt ?? now;
    const windows = await loadDeployWindows(started, now.getTime());
    const timing = timingOf({ queuedAt: (job.approvedAt ?? job.createdAt).getTime(), startedAt: started.getTime(), endedAt: now.getTime(), windows });
    const isTool = job.kind === "tool";
    let tokens: TokenSum = { ...ZERO_TOKENS };

    if (!isTool && job.aiEngine === "claude") {
      const raw = await eventTokens({ project: job.appSlug, device: job.workerId }, started, now);
      // 같은 앱에서 겹쳐 돈 다른 일감이 있으면 나눠 센다
      const others = await prisma.factoryJob.count({ where: { appSlug: job.appSlug, id: { not: job.id }, startedAt: { lt: now }, OR: [{ finishedAt: null }, { finishedAt: { gt: started } }], status: { in: ["running", "done", "failed", "review"] } } });

      tokens = shareTokens(raw, others);
    }

    const card = job.cardId ? await prisma.factoryCard.findUnique({ where: { id: job.cardId }, select: { tool: true, method: true } }) : null;
    const relayed = Array.isArray(job.toolRequests) ? (job.toolRequests as { tool?: unknown }[]).find((r) => r && typeof r.tool === "string") : undefined;
    const rebases = Number((job.parallelInfo as { rebases?: unknown } | null)?.rebases ?? 0);
    const ext = externalOf(job.kind, job.toolResult);

    await save(
      cleanStat({
        kind: "job",
        refId: `${job.id}:${job.attempts}`,
        agent: agentOf(job),
        appSlug: job.appSlug,
        cardId: job.cardId,
        tool: card?.tool ?? (typeof relayed?.tool === "string" ? relayed.tool : null),
        method: card?.method || null,
        result: classifyResult(status, job.failStage, job.failReason),
        tokens,
        ...timing,
        redoCount: Number.isFinite(rebases) ? rebases : 0,
        externalCost: ext.cost,
        externalLabel: ext.label,
        at: now.getTime(),
      }),
    );
  } catch (error) {
    console.error("[run-stats] 일감 통계 기록 실패:", error instanceof Error ? error.message : error);
  }
}

/** 정비 지시가 끝났을 때(done 보고) 한 줄. 토큰은 Claude 세션이 있을 때만 센다(Codex 는 집계 없음) */
export async function recordMaintenanceStat(turn: { id: string; aiEngine: string; createdAt: Date; startedAt: Date | null }, ok: boolean, sessionId: string | undefined): Promise<void> {
  try {
    const now = new Date();
    const started = turn.startedAt ?? now;
    const windows = await loadDeployWindows(started, now.getTime());
    const timing = timingOf({ queuedAt: turn.createdAt.getTime(), startedAt: started.getTime(), endedAt: now.getTime(), windows });
    const tokens = turn.aiEngine === "claude" && sessionId ? await eventTokens({ sessionId }, started, now) : { ...ZERO_TOKENS };

    await save(cleanStat({ kind: "maintenance", refId: turn.id, agent: "M1", result: ok ? "success" : "failed", tokens, ...timing, at: now.getTime() }));
  } catch (error) {
    console.error("[run-stats] 정비 통계 기록 실패:", error instanceof Error ? error.message : error);
  }
}

/** 지휘자 판단 한 번(비용 기록과 같은 순간) */
export async function recordConductorStat(rec: { at: string; appSlug: string; ok: boolean; ms: number | null; tokens: TokenSum | null }): Promise<void> {
  try {
    await save(
      cleanStat({
        kind: "conductor",
        refId: `${rec.at}:${rec.appSlug}`,
        agent: "C1",
        appSlug: rec.appSlug,
        result: rec.ok ? "success" : "failed",
        tokens: rec.tokens ?? ZERO_TOKENS,
        runMs: rec.ms ?? 0,
        at: Date.parse(rec.at) || Date.now(),
      }),
    );
  } catch (error) {
    console.error("[run-stats] 지휘자 통계 기록 실패:", error instanceof Error ? error.message : error);
  }
}

// ───────── 읽기 ─────────
export async function readRunStats(now = Date.now(), days = READ_DAYS): Promise<RunStat[]> {
  try {
    const rows = await prisma.factoryRunStat.findMany({ where: { at: { gt: new Date(now - days * 86_400_000) } }, orderBy: { at: "desc" }, take: 20_000 });

    return rows.map((r) => ({
      kind: r.kind as RunStat["kind"],
      refId: r.refId,
      agent: r.agent,
      appSlug: r.appSlug,
      cardId: r.cardId,
      tool: r.tool,
      method: r.method,
      result: r.result as RunStat["result"],
      tokens: { input: n(r.inputTokens), output: n(r.outputTokens), cacheCreate: n(r.cacheCreate), cacheRead: n(r.cacheRead) },
      waitMs: r.waitMs,
      runMs: r.runMs,
      pausedMs: r.pausedMs,
      redoCount: r.redoCount,
      externalCost: r.externalCost,
      externalLabel: r.externalLabel,
      at: r.at.getTime(),
    }));
  } catch {
    return []; // 표가 아직 없으면(마이그레이션 전) 빈 통계
  }
}

/** 카드 id → 이름, 에이전트 번호 → 이름 같은 표시 글자를 붙여 집계한다 */
export async function readUsageByBlock(by: GroupBy, period: Period, now = Date.now(), appSlug?: string): Promise<UsageByBlock> {
  const stats = await readRunStats(now);
  const names = new Map<string, string>();

  if (by === "card") {
    const cards = await prisma.factoryCard.findMany({ select: { id: true, name: true, appSlug: true } }).catch(() => []);

    for (const c of cards) names.set(c.id, `${c.name} (${c.appSlug})`);
  } else if (by === "agent") {
    const { readAgentsView } = await import("@/lib/factory/agents");

    for (const a of readAgentsView().agents) names.set(a.id, `${a.id} ${a.label}`);
  }

  return aggregate(stats, { by, period, now, filter: appSlug ? (s) => s.appSlug === appSlug : undefined, labelOf: (b, key) => (b === "tool" ? key.replace("/", " · ") : (names.get(key) ?? key)) });
}

/** 지도·스튜디오 블록에 붙일 7일 요약 줄 */
export async function readWeekLines(now = Date.now()) {
  const stats = await readRunStats(now, 8);

  return { agent: weekSummaries(stats, "agent", now), app: weekSummaries(stats, "app", now), card: weekSummaries(stats, "card", now), tool: weekSummaries(stats, "tool", now), toolOnly: toolOnlyLines(stats, now) };
}

// 지도의 도구 블록은 이름만 있어서(방법 없음) 방법을 떼고 도구 이름 기준으로 따로 합친다
function toolOnlyLines(stats: readonly RunStat[], now: number): Map<string, string> {
  return weekSummaries(
    stats.filter((s) => s.tool).map((s) => ({ ...s, method: null })),
    "tool",
    now,
  );
}
