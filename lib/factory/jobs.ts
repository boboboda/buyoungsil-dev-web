// 앱 공장 지시 처리 로직. 상태 전환은 모두 여기서만 한다.
//
// 상태: pending(등록됨) → approved(승인) → running(실행 중) → done | failed, 어느 단계에서든 cancelled.
// 출시 일감(첫 출시·스토어 수정)은 running → review(검토 대기, 임대 없음) → 사람의 결정: 진행·다시 만들기면 approved, 취소면 cancelled.
// running 은 임대(leaseUntil)로 관리한다. 가져갈 때와 보고할 때마다 10분씩 연장하고,
// 만료되면 시도 횟수가 남았을 때 approved 로 되돌리고 아니면 failed 로 바꾼다.
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { deleteReviewVideo } from "@/lib/factory/reviewVideo";
import { maskSecrets } from "@/lib/factory/mask";
import { AI_LABELS, isAiEngine, readModelChoice, type AiEngine } from "@/lib/factory/ai";
import { getDefaultClaudeModel } from "@/lib/factory/settings";
import { cleanToolRequests, type ToolRequestRecord } from "@/lib/factory/toolBroker";
import { cleanHandoff, type HandoffEntry } from "@/lib/factory/handoff";

// 실험 일감 종류 이름. 실험 결과 처리(lib/factory/lab.ts)는 보고에 lab 값이 있을 때만 불러온다(앱 일감 경로는 그 파일을 읽지 않는다)
const LAB_KIND = "lab";

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
// 앱 종류. 감독 프로그램(tools/factory-supervisor)이 종류별 작업 규칙을 붙인다. 늘릴 때는 거기 규칙도 같이 넣는다.
export const STACKS = ["flutter", "kotlin-compose", "swift-swiftui", "nextjs", "nestjs"] as const;
export const STACK_LABELS: Record<(typeof STACKS)[number], string> = {
  flutter: "Flutter 모바일 앱 (Android 우선)",
  "kotlin-compose": "Android 네이티브 앱 (Kotlin + Jetpack Compose)",
  "swift-swiftui": "iOS 네이티브 앱 (SwiftUI, 이 작업 PC는 Windows라 빌드는 못 하고 코드만)",
  nextjs: "웹 앱 (Next.js, App Router, TypeScript)",
  nestjs: "백엔드 API 서버 (NestJS, TypeScript)",
};

// 일감 종류. release = 출시 준비(완성된 앱만, 수정 지시처럼 기존 폴더에서 출시 자료를 만든다)
// lab = 실험(도구·방식이 되는지 확인하는 테스트. 앱 폴더가 아니라 lab<id> 에서 돈다. lib/factory/lab.ts)
export const JOB_KINDS = ["new", "revision", "release", "lab"] as const;
export const KIND_LABELS: Record<string, string> = { new: "새 앱", revision: "수정", release: "출시 준비", lab: "실험" };

export const ACTIVE_STATUSES = ["pending", "approved", "running"] as const;
// review = 출시 일감(첫 출시·스토어 수정)이 자료를 만든 뒤 사람의 검토를 기다리는 중. 작업 PC 를 붙잡지 않는다(ACTIVE 아님, 임대 없음, 자동 취소 없음)
// linkwait = 스토어 수정에서 홍보 영상을 만든 뒤, 사람이 YouTube 에 올린 링크를 기다리는 중(이미지·문구는 이미 반영). 다른 일감을 막지 않는다
export const JOB_STATUSES = ["pending", "approved", "running", "review", "linkwait", "done", "failed", "cancelled"] as const;
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
  aiEngine: AiEngine;
  aiModel: string | null; // Claude Code --model 별칭(Codex 는 null)
  priority: number;
  requiredSecrets: string[];
  planMarkdown: string;
  attempts: number;
}

// approved 중 우선순위 높은 순(같으면 먼저 등록한 순)으로 최대 slots 개를 running 으로 바꿔 돌려준다.
// 한 문장으로 바꾸고 status = 'approved' 조건을 UPDATE 에서 다시 확인해서, 동시에 불러도 같은 지시를 두 번 가져가지 않는다.
// 같은 앱(appSlug)은 한 번에 하나만: 이미 running 인 앱의 일감은 건너뛰고, 한 번에 가져가는 묶음에서도 앱마다 가장 앞선 하나만 고른다
// (동시 실행이 늘면 같은 앱 폴더를 두 일감이 쓰게 되는 걸 서버에서도 막는다. 건너뛴 일감은 approved 로 남아 앞 일감이 끝난 뒤 가져간다).
export async function claimJobs(worker: string, slots: number, engines: readonly AiEngine[] = ["claude"]): Promise<ClaimedJob[]> {
  if (!engines.length) return [];
  const now = new Date();
  const lease = new Date(now.getTime() + LEASE_MS);

  const rows = await prisma.$queryRaw<ClaimedJob[]>(Prisma.sql`
    UPDATE "factory_jobs"
    SET "status" = 'running', "workerId" = ${worker}, "leaseUntil" = ${ts(lease)},
        "attempts" = "attempts" + 1, "startedAt" = COALESCE("startedAt", ${ts(now)}),
        "phase" = NULL, "failReason" = NULL, "failStage" = NULL, "updatedAt" = ${ts(now)}
    WHERE "status" = 'approved' AND "id" IN (
      SELECT "id" FROM (
        SELECT j."id", j."priority", j."createdAt",
               ROW_NUMBER() OVER (PARTITION BY j."appSlug" ORDER BY j."priority" DESC, j."createdAt" ASC) AS "rn"
        FROM "factory_jobs" j
        WHERE j."status" = 'approved' AND j."aiEngine" IN (${Prisma.join(engines)})
          AND NOT EXISTS (SELECT 1 FROM "factory_jobs" r WHERE r."appSlug" = j."appSlug" AND r."status" = 'running')
      ) c
      WHERE c."rn" = 1
      ORDER BY c."priority" DESC, c."createdAt" ASC
      LIMIT ${slots}
    )
    RETURNING "id", "appSlug", "title", "kind", "parentJobId", "stack", "priority",
              "requiredSecrets", "planMarkdown", "attempts", "aiEngine", "aiModel"`);

  rows.sort((a, b) => b.priority - a.priority);
  await fillDefaultModel(rows);

  if (rows.length > 0) {
    await prisma.factoryJobLog.createMany({
      data: rows.map((r) => ({
        jobId: r.id,
        level: "info",
        message: `${worker} 가 가져감 (시도 ${r.attempts}${r.aiEngine === "claude" ? ` · 모델: ${r.aiModel ?? "Claude Code 기본"}` : ""})`,
      })),
    });
  }

  return rows;
}

// 승인 때 '기본 설정 사용'(aiModel NULL)이던 Claude 일감은 시작할 때 설정 탭의 기본 모델로 채운다(이력에 실제로 쓴 모델이 남게).
// 기본 모델이 없으면 NULL 그대로(--model 없이 예전처럼). Codex 는 건드리지 않는다. 읽기 실패는 기본 동작으로.
async function fillDefaultModel(rows: ClaimedJob[]): Promise<void> {
  const empty = rows.filter((r) => r.aiEngine === "claude" && !r.aiModel);

  if (!empty.length) return;
  const model = await getDefaultClaudeModel().catch(() => null);

  if (!model) return;
  await prisma.factoryJob.updateMany({ where: { id: { in: empty.map((r) => r.id) }, aiModel: null }, data: { aiModel: model } });
  for (const r of empty) r.aiModel = model;
}

// ───────────── 보고 ─────────────

export interface ReportInput {
  jobId: string;
  phase?: string | null; // undefined 이면 그대로 둔다
  logs: { level: string; message: string }[];
  status?: "done" | "failed" | "review" | "linkwait";
  summary?: string | null;
  build?: Prisma.InputJsonObject | null; // 앱 업데이트 빌드 결과(완료 때)
  failReason?: string | null;
  failStage?: string | null; // 실패한 단계(출시 일감: key, build, sign, upload, homepage, store …)
  toolRequests?: ToolRequestRecord[] | null; // 도구 요청 중계 목록(감독 프로그램이 전체를 보냄. null 이면 그대로 둔다)
  handoff?: HandoffEntry | null; // 인계 기록 항목(일감이 끝날 때만. null 이면 그대로 둔다)
  lab?: Record<string, unknown> | null; // 실험 일감 결과(건너뛴 파일·사후 검사). 아직 정리 전 값: 저장할 때 lib/factory/lab.ts cleanLabResult 로 정리하고, 실험 일감에만 저장한다
}

export type ParseResult = { ok: true; value: ReportInput } | { ok: false; reason: string };

export function parseReport(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, reason: "요청 형식이 올바르지 않습니다." };
  }
  const b = body as Record<string, unknown>;

  const jobId = typeof b.jobId === "string" ? b.jobId : "";
  if (!ID_RE.test(jobId)) return { ok: false, reason: "jobId 형식이 올바르지 않습니다." };

  let status: "done" | "failed" | "review" | "linkwait" | undefined;
  if (b.status !== undefined) {
    if (b.status !== "done" && b.status !== "failed" && b.status !== "review" && b.status !== "linkwait") {
      return { ok: false, reason: "status 는 done, failed, review, linkwait 만 보낼 수 있습니다." };
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
      // 비밀번호가 섞여 들어와도 저장 전에 가린다(감독 프로그램이 먼저 가리고, 여기서 한 번 더)
      const message = maskSecrets(cleanText(rec.message, MAX_LOG_MESSAGE, true));
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
      summary: maskSecrets(cleanText(b.summary, MAX_SUMMARY, true)),
      failReason: maskSecrets(cleanText(b.failReason, MAX_FAIL_REASON, true)),
      failStage: typeof b.failStage === "string" && /^[a-z_-]{1,40}$/.test(b.failStage) ? b.failStage : null,
      build: cleanBuild(b.build),
      toolRequests: cleanToolRequests(b.toolRequests),
      handoff: cleanHandoff(b.handoff),
      lab: b.lab && typeof b.lab === "object" && !Array.isArray(b.lab) ? (b.lab as Record<string, unknown>) : null,
    },
  };
}

// 앱 업데이트 빌드 결과(숫자·짧은 글만)
function cleanBuild(v: unknown): Prisma.InputJsonObject | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);

  return {
    versionName: cleanText(r.versionName, 40),
    versionCode: num(r.versionCode),
    aabPath: cleanText(r.aabPath, 300),
    aabSize: num(r.aabSize),
    tests: maskSecrets(cleanText(r.tests, 600, true)),
    track: cleanText(r.track, 20),
    uploaded: r.uploaded === true,
    uploadNote: maskSecrets(cleanText(r.uploadNote, 600, true)),
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
  if (input.toolRequests) data.toolRequests = input.toolRequests as unknown as Prisma.InputJsonArray;
  if (input.handoff) data.handoff = input.handoff as unknown as Prisma.InputJsonObject;

  // 검토가 필요한 출시 일감은 [이대로 진행] 전에는 완료가 될 수 없다(완료 보고가 와도 검토 대기로 둔다)
  let status = input.status;
  if (status === "done" || status === "review" || status === "linkwait") {
    const job = await prisma.factoryJob.findUnique({ where: { id: input.jobId }, select: { kind: true, reviewRequired: true, reviewApprovedAt: true } });
    if (job?.reviewRequired && !job.reviewApprovedAt) status = "review";
    else if (status === "review") status = "done"; // 검토가 없거나 이미 승인된 일감
    else if (status === "linkwait" && job?.kind !== "release") status = "done"; // 영상 링크 대기는 출시 일감만
  }

  if (status === "linkwait") {
    // 이미지·문구 반영은 끝났고 영상 링크만 기다린다(임대 없음, 자동 취소 없음)
    data.status = "linkwait";
    data.summary = input.summary ?? null;
    data.phase = "linkwait";
    data.leaseUntil = null;
  } else if (status === "review") {
    data.status = "review";
    data.summary = input.summary ?? null;
    data.reviewAt = now;
    data.phase = "review";
    data.leaseUntil = null;
  } else if (status === "done") {
    data.status = "done";
    data.summary = input.summary ?? null;
    data.finishedAt = now;
    data.leaseUntil = null;
    if (input.build) data.buildResult = input.build;
  } else if (status === "failed") {
    data.status = "failed";
    data.failReason = input.failReason ?? "실패(사유 없음)";
    data.failStage = input.failStage ?? input.phase ?? null;
    data.finishedAt = now;
    data.leaseUntil = null;
  }

  // running 일 때만 바꾼다. 취소가 먼저 들어왔으면 0건이라 conflict 가 된다.
  const res = await prisma.factoryJob.updateMany({ where: { id: input.jobId, status: "running" }, data });
  if (res.count === 0) return conflictOf(input.jobId);

  if (input.lab) {
    // 실험 일감만 저장한다(다른 종류가 lab 필드를 보내도 무시)
    const isLab = await prisma.factoryJob.count({ where: { id: input.jobId, kind: LAB_KIND } });

    if (isLab) {
      const { cleanLabResult, mergeLabResult } = await import("@/lib/factory/lab");
      const clean = cleanLabResult(input.lab);

      if (clean) await mergeLabResult(input.jobId, clean).catch(() => undefined);
    }
  }

  if (input.logs.length > 0) {
    await prisma.factoryJobLog.createMany({
      data: input.logs.map((l) => ({ jobId: input.jobId, level: l.level, message: l.message })),
    });
    await trimLogs(input.jobId);
  }

  return { kind: "ok", status: status ?? "running", leaseUntil: data.leaseUntil === null ? null : lease };
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
  if (body.aiEngine !== undefined && !isAiEngine(body.aiEngine)) return refuse(400, "작업 AI는 Claude Code 또는 Codex를 골라 주세요.");
  // Codex 로 바꾸면 고른 모델은 지운다(Codex 는 --model 을 쓰지 않음)
  const engineData = isAiEngine(body.aiEngine) ? { aiEngine: body.aiEngine, ...(body.aiEngine === "codex" ? { aiModel: null } : {}) } : {};
  // 모델(승인·재시도 때 고름): 허용 목록만. Codex 일감에는 고를 수 없다. 키가 없으면 승인은 '기본 설정 사용', 재시도는 그대로
  const choice = readModelChoice(body.aiModel);

  if (!choice.ok) return refuse(400, choice.message);
  if (choice.model) {
    const engine = isAiEngine(body.aiEngine) ? body.aiEngine : (await prisma.factoryJob.findUnique({ where: { id }, select: { aiEngine: true } }))?.aiEngine;

    if (engine === "codex") return refuse(400, "Codex 일감에는 모델을 고를 수 없어요(Claude Code 일감만).");
  }
  const modelData = body.aiEngine === "codex" ? {} : { aiModel: choice.model };

  switch (body.action) {
    case "approve": {
      const res = await prisma.factoryJob.updateMany({
        where: { id, status: "pending" },
        data: { status: "approved", approvedAt: now, ...modelData, ...engineData },
      });
      // 홈페이지 Project 는 여기서 만들지 않는다(출시 대상 앱만: 출시 패키지에 추가할 때 연결·생성)
      return res.count > 0 ? done(choice.model ? `승인했어요(모델: ${choice.model}).` : "승인했어요.") : explainNoChange(id, "승인");
    }

    case "cancel": {
      // 검토 대기(review) 일감도 취소할 수 있다(검토 영상은 지운다. PC 의 자료는 그대로)
      const res = await prisma.factoryJob.updateMany({
        where: { id, status: { in: [...ACTIVE_STATUSES, "review", "linkwait"] } },
        data: { status: "cancelled", finishedAt: now, leaseUntil: null },
      });
      if (res.count > 0) await deleteReviewVideo(id).catch(() => {});
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
          ...(Object.hasOwn(body, "aiModel") ? modelData : {}),
          ...engineData,
          status: "approved",
          attempts: 0,
          approvedAt: now,
          failReason: null,
          failStage: null,
          resumeFrom: null, // 일반 재시도는 처음부터(단계 재시도는 출시 패키지 화면의 재시도)
          resumeNote: null,
          phase: null,
          workerId: null,
          leaseUntil: null,
          startedAt: null,
          finishedAt: null,
        },
      });
      return res.count > 0 ? done("재시도하도록 승인했어요.") : explainNoChange(id, "재시도");
    }

    case "lab-delete-folder": {
      // 실험 폴더 지우기 요청. 감독 프로그램이 해당 lab<id> 만 지운다(shared 는 지우지 않음). 돌고 있는 실험은 안 된다
      const job = await prisma.factoryJob.findUnique({ where: { id }, select: { kind: true, status: true } });

      if (!job) return refuse(404, "없는 지시예요.");
      if (job.kind !== LAB_KIND) return refuse(409, "실험 일감만 폴더를 지울 수 있어요.");
      if (job.status === "running" || job.status === "approved" || job.status === "pending") return refuse(409, "끝나거나 취소된 실험만 폴더를 지울 수 있어요.");
      await prisma.factoryJob.update({ where: { id }, data: { labCleanupAt: now } });

      return done("폴더 지우기를 요청했어요. 작업 PC 가 곧 지워요.");
    }

    case "set-ai": {
      if (!isAiEngine(body.aiEngine)) return refuse(400, "작업 AI를 골라 주세요.");
      const res = await prisma.factoryJob.updateMany({
        where: { id, status: { in: ["pending", "approved", "failed"] } },
        data: engineData,
      });
      return res.count ? done(`작업 AI를 ${AI_LABELS[body.aiEngine]}로 바꿨어요.`) : explainNoChange(id, "작업 AI 변경");
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
