// lib/factory/planFirst.ts
// 계획 먼저 승인 (5-1). 앱 일감마다 승인 방식을 '바로 시작'(기본)과 '계획 먼저' 중에서 고른다.
//   '계획 먼저': 승인하면 작업자가 일을 시작하기 전에 읽기 전용 AI 턴(지휘자와 같은 읽기 도구·가벼운 모델)이 계획(3~6줄)을 낸다
//     → 통제실 할 일·텔레그램에 계획을 보여 준다 → 사람이 [이대로 진행] · [수정 지시] · [취소] 중에서 고른다
//     → 진행하면 계획을 지시문 끝에 붙여 작업자에게 넘긴다(withPlan).
// 상태는 일감 status 를 늘리지 않고 planStatus 한 칸으로 따로 둔다(일감 status 는 계속 approved):
//   requested(계획 만들 차례) → running(감독 프로그램이 만드는 중) → ready(사람 선택 대기) → approved(이대로 진행 → 평소처럼 대기열)
//   ready·failed 에서 [수정 지시]를 하면 다시 requested. 계획을 못 만들면 failed(계획 없이 진행 / 다시 계획 / 취소).
//   running 이 오래 멈춰 있으면(감독 프로그램이 꺼짐 등) 다시 requested 로 본다.
// 이 파일의 판단 함수는 가짜 DB 로 시험한다(tests/plan-first.test.mjs).
import prisma from "@/lib/prisma";
import { maskSecrets } from "@/lib/factory/mask";
import type { PlanStatus } from "@/lib/factory/planLabels";

export const PLAN_KINDS: readonly string[] = ["new", "revision"]; // 계획 단계를 쓸 수 있는 일감 종류(출시·실험·도구는 아님)
export { PLAN_LABELS, PLAN_STATUSES, type PlanStatus } from "@/lib/factory/planLabels";
export const MAX_PLAN_TEXT = 2400;
export const MAX_PLAN_NOTE = 1000;
export const MAX_PLAN_ROUNDS = 5; // [수정 지시]로 계획을 다시 받을 수 있는 횟수
export const PLAN_STALE_MS = 8 * 60_000; // 계획 턴이 이만큼 지나도 결과가 없으면 다시 내준다(읽기 전용 턴 제한 시간 4분의 두 배)
const DEFAULT_KEY = "planFirstDefault";

/** 계획 선택을 기다리느라 가져가면 안 되는 일감인가(approved 상태에서만 의미 있음) */
export const waitsForPlan = (j: { kind: string; planFirst?: boolean | null; planStatus?: string | null }): boolean => !!j.planFirst && PLAN_KINDS.includes(j.kind) && j.planStatus !== "approved";

/** 제어문자를 지우고 비밀번호를 가리고 길이를 자른다. 비면 null */
export function cleanPlanText(v: unknown, max = MAX_PLAN_TEXT): string | null {
  if (typeof v !== "string") return null;
  const t = maskSecrets(v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n/g, "\n").trim()).slice(0, max).trim();

  return t.length ? t : null;
}

/** 작업자에게 넘기는 지시문 끝에 승인된 계획을 붙인다. 계획이 없으면 그대로 */
export function withPlan(instruction: string, plan: string | null | undefined): string {
  const p = (plan ?? "").trim();

  if (!p) return instruction;

  return `${instruction}\n\n## 승인된 작업 계획 (사람이 확인함)\n${p}\n\n위 계획을 기준으로 진행하세요. 실제 코드를 보고 계획과 달라져야 하면 이유를 최종 답변에 적으세요.`;
}

/** 기본값(설정): 새 승인에서 '계획 먼저'가 기본으로 켜져 있나. 정한 적 없으면 꺼짐(바로 시작) */
export async function getPlanFirstDefault(): Promise<{ value: boolean; isDefault: boolean }> {
  const row = await prisma.factorySetting.findUnique({ where: { key: DEFAULT_KEY } });

  return row?.value === "1" || row?.value === "0" ? { value: row.value === "1", isDefault: false } : { value: false, isDefault: true };
}

export async function setPlanFirstDefault(on: boolean): Promise<void> {
  const value = on ? "1" : "0";

  await prisma.factorySetting.upsert({ where: { key: DEFAULT_KEY }, create: { key: DEFAULT_KEY, value }, update: { value } });
}

/**
 * 승인할 때 쓸 값. body.planFirst 가 true/false 면 일감별 선택, 없으면 설정 기본값.
 * 계획 단계를 쓸 수 없는 종류(출시·실험·도구)는 항상 바로 시작.
 */
export function approveData(kind: string, planFirstChoice: unknown, defaultOn: boolean) {
  const want = typeof planFirstChoice === "boolean" ? planFirstChoice : defaultOn;

  if (!want || !PLAN_KINDS.includes(kind)) return { planFirst: false, planStatus: null, planText: null, planNote: null, planInfo: null };

  return { planFirst: true, planStatus: "requested" as const, planText: null, planNote: null, planInfo: null };
}

// ───────────── 감독 프로그램에 계획 만들 일 내주기 (/next) ─────────────

export interface PlanTask {
  jobId: string;
  appSlug: string;
  title: string;
  kind: string;
  stack: string;
  model: string;
  instruction: string; // 기획서/지시문(길면 잘라서)
  previousPlan: string | null; // 수정 지시를 받았다면 이전 계획
  note: string | null; // 사람이 적은 수정 지시
  round: number; // 1 = 첫 계획
}

const MAX_INSTRUCTION = 12_000;

interface PlanRow {
  id: string;
  appSlug: string;
  title: string;
  kind: string;
  stack: string;
  planMarkdown: string;
  planStatus: string | null;
  planText: string | null;
  planNote: string | null;
  planInfo: unknown;
  approvedAt: Date | null;
  createdAt: Date;
}

const infoOf = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * 계획을 만들 일을 하나 내준다(공장 전체 동시에 1개: 감독 프로그램이 plan=1 을 보낼 때만 부른다). 없으면 null.
 * requested 이거나, running 인데 PLAN_STALE_MS 가 지나 멈춘 것을 오래된 승인 순으로 하나 골라 running 으로 바꾼다(조건부 갱신: 두 번 내주지 않는다).
 */
export async function planTaskForNext(model: string, now = Date.now()): Promise<PlanTask | null> {
  const rows = (await prisma.factoryJob.findMany({
    where: { status: "approved", planFirst: true, planStatus: { in: ["requested", "running"] }, kind: { in: [...PLAN_KINDS] } },
    select: { id: true, appSlug: true, title: true, kind: true, stack: true, planMarkdown: true, planStatus: true, planText: true, planNote: true, planInfo: true, approvedAt: true, createdAt: true },
  })) as PlanRow[];
  const ready = rows
    .filter((r) => r.planStatus === "requested" || now - Date.parse(String(infoOf(r.planInfo).startedAt ?? "")) > PLAN_STALE_MS || !Number.isFinite(Date.parse(String(infoOf(r.planInfo).startedAt ?? ""))))
    .sort((a, b) => (a.approvedAt ?? a.createdAt).getTime() - (b.approvedAt ?? b.createdAt).getTime());

  for (const r of ready) {
    const info = infoOf(r.planInfo);
    const rounds = typeof info.rounds === "number" ? info.rounds : 1;
    const claimed = await prisma.factoryJob.updateMany({
      where: { id: r.id, status: "approved", planFirst: true, planStatus: r.planStatus },
      data: { planStatus: "running", planInfo: { ...info, rounds, startedAt: new Date(now).toISOString() } as never },
    });

    if (claimed.count === 0) continue;

    return {
      jobId: r.id,
      appSlug: r.appSlug,
      title: r.title,
      kind: r.kind,
      stack: r.stack,
      model,
      instruction: (r.planMarkdown ?? "").slice(0, MAX_INSTRUCTION),
      previousPlan: r.planText,
      note: r.planNote,
      round: rounds,
    };
  }

  return null;
}

export interface PlanResult {
  ok: boolean;
  message: string;
  status: number;
  notify?: boolean; // 계획이 준비돼 사람에게 알릴 차례
}

const usageOf = (u: unknown) => {
  const o = infoOf(u);
  const num = (x: unknown, max = 1e9) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.min(x, max) : null);
  const t = infoOf(o.tokens);

  return { ms: num(o.ms, 3_600_000), costUsd: num(o.costUsd, 1000), tokens: o.tokens ? { input: num(t.input) ?? 0, output: num(t.output) ?? 0, cacheCreate: num(t.cacheCreate) ?? 0, cacheRead: num(t.cacheRead) ?? 0 } : null };
};

/** 감독 프로그램이 낸 계획(또는 실패)을 저장한다. running 인 일감에만(늦게 온 결과가 사람이 이미 고른 상태를 덮지 않는다) */
export async function recordPlan(jobId: string, body: { ok: boolean; plan?: unknown; reason?: unknown; usage?: unknown; model?: unknown }, now = new Date()): Promise<PlanResult> {
  const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { planStatus: true, planInfo: true, status: true } });

  if (!job) return { ok: false, status: 404, message: "없는 지시예요." };
  if (job.status !== "approved" || job.planStatus !== "running") return { ok: false, status: 409, message: `계획을 받을 상태가 아니에요(${job.planStatus ?? "계획 단계 없음"}).` };
  const info = infoOf(job.planInfo);
  const base = { ...info, ...usageOf(body.usage), model: typeof body.model === "string" ? body.model.slice(0, 20) : (info.model ?? null), at: now.toISOString() };
  const plan = body.ok ? cleanPlanText(body.plan) : null;

  if (body.ok && plan) {
    const res = await prisma.factoryJob.updateMany({ where: { id: jobId, status: "approved", planStatus: "running" }, data: { planStatus: "ready", planText: plan, planInfo: { ...base, reason: null } as never } });

    return res.count ? { ok: true, status: 200, message: "계획을 저장했어요.", notify: true } : { ok: false, status: 409, message: "이미 다른 상태예요." };
  }
  const reason = cleanPlanText(typeof body.reason === "string" ? body.reason : "계획이 비어 있어요", 300) ?? "계획을 만들지 못했어요";
  const res = await prisma.factoryJob.updateMany({ where: { id: jobId, status: "approved", planStatus: "running" }, data: { planStatus: "failed", planInfo: { ...base, reason } as never } });

  return res.count ? { ok: true, status: 200, message: "계획을 못 만든 것을 남겼어요.", notify: true } : { ok: false, status: 409, message: "이미 다른 상태예요." };
}

/** 감독 프로그램이 지금은 계획할 수 없다고 알릴 때(앱 폴더에서 다른 일감이 돌고 있음 등): 기록 없이 차례만 되돌려 다음 확인 때 다시 받게 한다 */
export async function releasePlan(jobId: string): Promise<PlanResult> {
  const res = await prisma.factoryJob.updateMany({ where: { id: jobId, status: "approved", planFirst: true, planStatus: "running" }, data: { planStatus: "requested" } });

  return res.count ? { ok: true, status: 200, message: "다음 확인 때 다시 계획해요." } : { ok: false, status: 409, message: "이미 다른 상태예요." };
}

// ───────────── 사람의 선택 ─────────────

export type PlanChoice = "go" | "revise" | "redo";

/**
 * [이대로 진행](go): ready·failed → approved (failed 면 계획 없이 진행).
 * [수정 지시](revise): ready·failed → requested, 말(note)을 남기고 횟수를 센다(최대 MAX_PLAN_ROUNDS). failed 에서는 말 없이도 다시 계획(redo).
 * 취소는 일감 취소(adminAction cancel)를 쓴다.
 */
export async function choosePlan(jobId: string, choice: PlanChoice, noteRaw?: unknown): Promise<PlanResult> {
  const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { status: true, planFirst: true, planStatus: true, planInfo: true } });

  if (!job) return { ok: false, status: 404, message: "없는 지시예요." };
  if (job.status !== "approved" || !job.planFirst) return { ok: false, status: 409, message: "계획 승인을 기다리는 일감이 아니에요." };
  if (job.planStatus !== "ready" && job.planStatus !== "failed") {
    return { ok: false, status: 409, message: job.planStatus === "approved" ? "이미 계획을 승인했어요." : "계획을 아직 만드는 중이에요. 끝나면 고를 수 있어요." };
  }

  if (choice === "go") {
    const res = await prisma.factoryJob.updateMany({ where: { id: jobId, status: "approved", planFirst: true, planStatus: { in: ["ready", "failed"] } }, data: { planStatus: "approved" } });

    return res.count ? { ok: true, status: 200, message: job.planStatus === "failed" ? "계획 없이 진행하도록 했어요." : "계획대로 진행하도록 했어요." } : { ok: false, status: 409, message: "이미 처리됐어요." };
  }
  const note = cleanPlanText(noteRaw, MAX_PLAN_NOTE);

  if (!note && job.planStatus === "ready") return { ok: false, status: 400, message: "수정 지시를 적어 주세요." };
  const info = infoOf(job.planInfo);
  const rounds = typeof info.rounds === "number" ? info.rounds : 1;

  if (rounds >= MAX_PLAN_ROUNDS) return { ok: false, status: 409, message: `계획을 ${MAX_PLAN_ROUNDS}번 받았어요. 이대로 진행하거나 취소해 주세요(지시를 고쳐서 다시 등록할 수도 있어요).` };
  const res = await prisma.factoryJob.updateMany({
    where: { id: jobId, status: "approved", planFirst: true, planStatus: { in: ["ready", "failed"] } },
    data: { planStatus: "requested", planNote: note, planInfo: { ...info, rounds: rounds + 1, startedAt: null } as never },
  });

  return res.count ? { ok: true, status: 200, message: "계획을 다시 만들게 했어요." } : { ok: false, status: 409, message: "이미 처리됐어요." };
}

/** 가져가기 직전: 승인된 계획이 있는 일감의 지시문 끝에 계획을 붙인다(DB 의 기획서는 그대로 두고 내려 주는 값만 바꾼다) */
export async function attachApprovedPlans<T extends { id: string; planMarkdown: string }>(rows: T[]): Promise<void> {
  if (!rows.length) return;
  const found = await prisma.factoryJob.findMany({ where: { id: { in: rows.map((r) => r.id) }, planFirst: true, planStatus: "approved" }, select: { id: true, planText: true } });
  const by = new Map(found.map((f) => [f.id, f.planText]));

  for (const r of rows) {
    const plan = by.get(r.id);

    if (plan) r.planMarkdown = withPlan(r.planMarkdown, plan);
  }
}

// ───────────── 화면용 요약 ─────────────

export interface PlanView {
  id: string;
  appSlug: string;
  title: string;
  kind: string;
  status: PlanStatus;
  plan: string | null;
  reason: string | null;
  round: number;
  at: string | null;
}

/** 통제실 할 일에 보일 '계획 승인 대기'(ready·failed) 목록 */
export async function planReviews(): Promise<PlanView[]> {
  const rows = await prisma.factoryJob.findMany({
    where: { status: "approved", planFirst: true, planStatus: { in: ["ready", "failed"] } },
    orderBy: { updatedAt: "asc" },
    take: 50,
    select: { id: true, appSlug: true, title: true, kind: true, planStatus: true, planText: true, planInfo: true, updatedAt: true },
  });

  return rows.map((r) => {
    const info = infoOf(r.planInfo);

    return {
      id: r.id,
      appSlug: r.appSlug,
      title: r.title,
      kind: r.kind,
      status: r.planStatus as PlanStatus,
      plan: r.planText,
      reason: typeof info.reason === "string" ? info.reason : null,
      round: typeof info.rounds === "number" ? info.rounds : 1,
      at: r.updatedAt.toISOString(),
    };
  });
}

/** 텔레그램 알림 글(계획 3~6줄은 길이만 줄인다) */
export function planNoticeText(v: { title: string; appSlug: string; status: PlanStatus; plan: string | null; reason: string | null; round: number }): string {
  if (v.status === "failed") return `⚠️ 계획을 못 만들었어요\n${v.title} (${v.appSlug})\n${(v.reason ?? "").slice(0, 200)}\n계획 없이 진행하거나, 다시 계획하거나, 취소할 수 있어요(통제실).`;
  const plan = (v.plan ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8).join("\n").slice(0, 1200);

  return `📝 계획 승인 대기${v.round > 1 ? ` (${v.round}번째)` : ""}\n${v.title} (${v.appSlug})\n\n${plan}`;
}
