// 앱 공장 지시 처리 로직. 상태 전환은 모두 여기서만 한다.
//
// 상태: pending(등록됨) → approved(승인) → running(실행 중) → done | failed, 어느 단계에서든 cancelled.
// running 은 임대(leaseUntil)로 관리한다. 가져갈 때와 보고할 때마다 10분씩 연장하고,
// 만료되면 시도 횟수가 남았을 때 approved 로 되돌리고 아니면 failed 로 바꾼다.
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

export const LEASE_MS = 10 * 60 * 1000;
export const MAX_LOGS_PER_JOB = 500;
export const MAX_LOG_MESSAGE = 2000;
export const MAX_LOGS_PER_REPORT = 50;
export const MAX_SUMMARY = 4000;
export const MAX_FAIL_REASON = 2000;
export const MAX_SCREENSHOTS_PER_JOB = 30;
export const MAX_SLOTS = 4;

export const WORKER_RE = /^[A-Za-z0-9._-]{1,60}$/;
export const LABEL_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
// 앱 폴더 이름. 소문자·숫자·하이픈 3~40자, 양 끝은 하이픈 불가. (폴더 이름이자 Claude 훅의 project 값)
export const APP_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const MAX_PLAN = 60_000;
export const MIN_PLAN = 50;
export const MAX_PENDING_JOBS = 30;
export const STACKS = ["flutter"] as const;

export const ACTIVE_STATUSES = ["pending", "approved", "running"] as const;
export const JOB_STATUSES = ["pending", "approved", "running", "done", "failed", "cancelled"] as const;
export const LOG_LEVELS = ["info", "warn", "error"] as const;

// 제어문자를 지우고(줄바꿈·탭은 둔다) 길이를 자른다.
function cleanText(v: unknown, max: number, keepNewlines = false): string | null {
  if (typeof v !== "string") return null;
  const re = keepNewlines ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g;
  const t = v.replace(re, "").trim().slice(0, max);
  return t.length > 0 ? t : null;
}

// DB 컬럼(TIMESTAMP, 시간대 없음)과 직접 비교하도록 UTC 시각을 문자열로 넘긴다.
const ts = (d: Date) => Prisma.sql`${d.toISOString().replace("T", " ").replace("Z", "")}::timestamp`;

// ───────────── 가져가기 ─────────────

// 임대가 만료된 running 을 정리한다. next 를 부를 때마다 먼저 실행한다. (별도 크론 없음)
export async function releaseExpiredLeases(now = new Date()): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "factory_jobs"
    SET "status" = 'approved', "workerId" = NULL, "leaseUntil" = NULL, "phase" = NULL, "updatedAt" = ${ts(now)}
    WHERE "status" = 'running' AND "leaseUntil" < ${ts(now)} AND "attempts" < "maxAttempts"`);

  await prisma.$executeRaw(Prisma.sql`
    UPDATE "factory_jobs"
    SET "status" = 'failed', "failReason" = '임대 만료(시도 횟수 소진)', "leaseUntil" = NULL,
        "finishedAt" = ${ts(now)}, "updatedAt" = ${ts(now)}
    WHERE "status" = 'running' AND "leaseUntil" < ${ts(now)} AND "attempts" >= "maxAttempts"`);
}

export interface ClaimedJob {
  id: string;
  appSlug: string;
  title: string;
  kind: string;
  parentJobId: string | null;
  stack: string;
  priority: number;
  requiredSecrets: string[];
  planMarkdown: string;
  attempts: number;
}

// approved 중 우선순위 높은 순(같으면 먼저 등록한 순)으로 최대 slots 개를 running 으로 바꿔 돌려준다.
// 한 문장으로 바꾸고 SKIP LOCKED 를 써서, 동시에 불러도 같은 지시를 두 번 가져가지 않는다.
export async function claimJobs(worker: string, slots: number): Promise<ClaimedJob[]> {
  const now = new Date();
  const lease = new Date(now.getTime() + LEASE_MS);

  const rows = await prisma.$queryRaw<ClaimedJob[]>(Prisma.sql`
    UPDATE "factory_jobs"
    SET "status" = 'running', "workerId" = ${worker}, "leaseUntil" = ${ts(lease)},
        "attempts" = "attempts" + 1, "startedAt" = COALESCE("startedAt", ${ts(now)}),
        "phase" = NULL, "failReason" = NULL, "updatedAt" = ${ts(now)}
    WHERE "id" IN (
      SELECT "id" FROM "factory_jobs"
      WHERE "status" = 'approved'
      ORDER BY "priority" DESC, "createdAt" ASC
      LIMIT ${slots}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "appSlug", "title", "kind", "parentJobId", "stack", "priority",
              "requiredSecrets", "planMarkdown", "attempts"`);

  rows.sort((a, b) => b.priority - a.priority);

  if (rows.length > 0) {
    await prisma.factoryJobLog.createMany({
      data: rows.map((r) => ({
        jobId: r.id,
        level: "info",
        message: `${worker} 가 가져감 (시도 ${r.attempts})`,
      })),
    });
  }

  return rows;
}

// ───────────── 보고 ─────────────

export interface ReportInput {
  jobId: string;
  phase?: string | null; // undefined 이면 그대로 둔다
  logs: { level: string; message: string }[];
  status?: "done" | "failed";
  summary?: string | null;
  failReason?: string | null;
}

export type ParseResult = { ok: true; value: ReportInput } | { ok: false; reason: string };

export function parseReport(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, reason: "요청 형식이 올바르지 않습니다." };
  }
  const b = body as Record<string, unknown>;

  const jobId = typeof b.jobId === "string" ? b.jobId : "";
  if (!ID_RE.test(jobId)) return { ok: false, reason: "jobId 형식이 올바르지 않습니다." };

  let status: "done" | "failed" | undefined;
  if (b.status !== undefined) {
    if (b.status !== "done" && b.status !== "failed") {
      return { ok: false, reason: "status 는 done 또는 failed 만 보낼 수 있습니다." };
    }
    status = b.status;
  }

  let phase: string | null | undefined;
  if (b.phase !== undefined) phase = b.phase === null ? null : cleanText(b.phase, 40);

  const logs: { level: string; message: string }[] = [];
  if (b.logs !== undefined) {
    if (!Array.isArray(b.logs)) return { ok: false, reason: "logs 는 배열이어야 합니다." };
    if (b.logs.length > MAX_LOGS_PER_REPORT) {
      return { ok: false, reason: `logs 는 한 번에 ${MAX_LOGS_PER_REPORT}개까지 보낼 수 있습니다.` };
    }
    for (const item of b.logs) {
      if (typeof item !== "object" || item === null) return { ok: false, reason: "logs 항목 형식이 올바르지 않습니다." };
      const rec = item as Record<string, unknown>;
      const message = cleanText(rec.message, MAX_LOG_MESSAGE, true);
      if (!message) continue;
      const level = typeof rec.level === "string" && (LOG_LEVELS as readonly string[]).includes(rec.level) ? rec.level : "info";
      logs.push({ level, message });
    }
  }

  return {
    ok: true,
    value: {
      jobId,
      phase,
      logs,
      status,
      summary: cleanText(b.summary, MAX_SUMMARY, true),
      failReason: cleanText(b.failReason, MAX_FAIL_REASON, true),
    },
  };
}

export type ReportOutcome =
  | { kind: "ok"; status: string; leaseUntil: Date | null }
  | { kind: "not_found" }
  | { kind: "conflict"; status: string; cancelled: boolean };

async function conflictOf(jobId: string): Promise<ReportOutcome> {
  const now = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!now) return { kind: "not_found" };
  return { kind: "conflict", status: now.status, cancelled: now.status === "cancelled" };
}

// 진행 보고. running 이 아닌 지시에는 conflict 를 돌려준다. (취소되면 cancelled: true)
export async function reportJob(input: ReportInput): Promise<ReportOutcome> {
  const now = new Date();
  const lease = new Date(now.getTime() + LEASE_MS);

  const data: Prisma.FactoryJobUpdateManyMutationInput = { leaseUntil: lease };
  if (input.phase !== undefined) data.phase = input.phase;

  if (input.status === "done") {
    data.status = "done";
    data.summary = input.summary ?? null;
    data.finishedAt = now;
    data.leaseUntil = null;
  } else if (input.status === "failed") {
    data.status = "failed";
    data.failReason = input.failReason ?? "실패(사유 없음)";
    data.finishedAt = now;
    data.leaseUntil = null;
  }

  // running 일 때만 바꾼다. 취소가 먼저 들어왔으면 0건이라 conflict 가 된다.
  const res = await prisma.factoryJob.updateMany({ where: { id: input.jobId, status: "running" }, data });
  if (res.count === 0) return conflictOf(input.jobId);

  if (input.logs.length > 0) {
    await prisma.factoryJobLog.createMany({
      data: input.logs.map((l) => ({ jobId: input.jobId, level: l.level, message: l.message })),
    });
    await trimLogs(input.jobId);
  }

  return { kind: "ok", status: input.status ?? "running", leaseUntil: data.leaseUntil === null ? null : lease };
}

// 지시당 로그는 최근 500줄만 남긴다.
async function trimLogs(jobId: string): Promise<void> {
  const cutoff = await prisma.factoryJobLog.findMany({
    where: { jobId },
    orderBy: { id: "desc" },
    skip: MAX_LOGS_PER_JOB,
    take: 1,
    select: { id: true },
  });
  if (cutoff.length > 0) {
    await prisma.factoryJobLog.deleteMany({ where: { jobId, id: { lte: cutoff[0].id } } });
  }
}

// 스크린샷 업로드 전에 running 인지 확인하고 임대를 연장한다.
export async function touchRunningJob(jobId: string): Promise<ReportOutcome> {
  const res = await prisma.factoryJob.updateMany({
    where: { id: jobId, status: "running" },
    data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (res.count === 0) return conflictOf(jobId);
  return { kind: "ok", status: "running", leaseUntil: null };
}

// ───────────── 관리자 동작 ─────────────

export type ActionResult = { status: number; message: string; ok: boolean };

const done = (message: string): ActionResult => ({ status: 200, ok: true, message });
const refuse = (status: number, message: string): ActionResult => ({ status, ok: false, message });

async function explainNoChange(id: string, wanted: string): Promise<ActionResult> {
  const job = await prisma.factoryJob.findUnique({ where: { id }, select: { status: true } });
  if (!job) return refuse(404, "없는 지시예요.");
  return refuse(409, `지금 상태(${job.status})에서는 ${wanted} 할 수 없어요.`);
}

export async function adminAction(id: string, body: Record<string, unknown>): Promise<ActionResult> {
  const now = new Date();

  switch (body.action) {
    case "approve": {
      const res = await prisma.factoryJob.updateMany({
        where: { id, status: "pending" },
        data: { status: "approved", approvedAt: now },
      });
      return res.count > 0 ? done("승인했어요.") : explainNoChange(id, "승인");
    }

    case "cancel": {
      const res = await prisma.factoryJob.updateMany({
        where: { id, status: { in: [...ACTIVE_STATUSES] } },
        data: { status: "cancelled", finishedAt: now, leaseUntil: null },
      });
      return res.count > 0 ? done("취소했어요.") : explainNoChange(id, "취소");
    }

    case "retry": {
      const job = await prisma.factoryJob.findUnique({ where: { id }, select: { status: true, appSlug: true } });
      if (!job) return refuse(404, "없는 지시예요.");
      if (job.status !== "failed") return refuse(409, `지금 상태(${job.status})에서는 재시도할 수 없어요. 실패한 지시만 돼요.`);

      const clash = await prisma.factoryJob.count({
        where: { appSlug: job.appSlug, id: { not: id }, status: { in: [...ACTIVE_STATUSES] } },
      });
      if (clash > 0) return refuse(409, "같은 앱 이름의 진행 중인 지시가 있어서 재시도할 수 없어요.");

      const res = await prisma.factoryJob.updateMany({
        where: { id, status: "failed" },
        data: {
          status: "approved",
          attempts: 0,
          approvedAt: now,
          failReason: null,
          phase: null,
          workerId: null,
          leaseUntil: null,
          startedAt: null,
          finishedAt: null,
        },
      });
      return res.count > 0 ? done("재시도하도록 승인했어요.") : explainNoChange(id, "재시도");
    }

    case "set-priority": {
      const p = body.priority;
      if (typeof p !== "number" || !Number.isInteger(p) || p < -100 || p > 100) {
        return refuse(400, "priority 는 -100 에서 100 사이 정수예요.");
      }
      const res = await prisma.factoryJob.updateMany({
        where: { id, status: { in: ["pending", "approved"] } },
        data: { priority: p },
      });
      return res.count > 0 ? done("우선순위를 바꿨어요.") : explainNoChange(id, "우선순위 변경");
    }

    default:
      return refuse(400, "알 수 없는 동작이에요.");
  }
}

// ───────────── 관리자 조회 ─────────────

const n = (v: bigint | null | undefined) => Number(v ?? 0);

// 같은 앱 이름(project)이고 지시를 가져간 감독 프로그램 이름(device)과 같은 Claude 세션·토큰 합계를 붙인다.
export async function claudeUsageFor(appSlug: string, workerId: string | null) {
  const where = { project: appSlug, ...(workerId ? { device: workerId } : {}) };

  const [sessions, usage] = await Promise.all([
    prisma.claudeSession.findMany({
      where,
      orderBy: { lastEventAt: "desc" },
      take: 10,
      select: {
        id: true,
        device: true,
        status: true,
        lastEvent: true,
        lastTool: true,
        startedAt: true,
        lastEventAt: true,
        inputTokens: true,
        outputTokens: true,
        cacheCreateTokens: true,
        cacheReadTokens: true,
      },
    }),
    prisma.claudeDailyUsage.aggregate({
      where,
      _sum: { inputTokens: true, outputTokens: true, cacheCreateTokens: true, cacheReadTokens: true },
    }),
  ]);

  return {
    sessions: sessions.map((s) => ({
      ...s,
      inputTokens: n(s.inputTokens),
      outputTokens: n(s.outputTokens),
      cacheCreateTokens: n(s.cacheCreateTokens),
      cacheReadTokens: n(s.cacheReadTokens),
    })),
    totals: {
      input: n(usage._sum.inputTokens),
      output: n(usage._sum.outputTokens),
      cacheCreate: n(usage._sum.cacheCreateTokens),
      cacheRead: n(usage._sum.cacheReadTokens),
    },
  };
}
