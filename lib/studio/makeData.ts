// lib/studio/makeData.ts
// 공용 스튜디오 [제작] 탭이 쓰는 자료 읽기(서버 전용). 계산은 lib/studio/make.ts.
// 쓰는 자료: 카드(2-2) · 도구 설명서의 호출당 비용(2-1) · 이 프로젝트의 도구 일감(kind=tool, 2-3)과 마지막 로그 · 일감이 만든 그림(카드 이름·판 번호·참고) · 별칭 · 비용 한도 설정.
// 키 값은 읽지 않는다.
import prisma from "@/lib/prisma";
import { ART_PICKS_PREFIX, parseSummary } from "@/lib/factory/arts";
import { listCards } from "@/lib/factory/cardsDb";
import { getProjectToolSettings, type SettingsDb } from "@/lib/factory/projectToolSettingsDb";
import { cleanToolResult, perCallCost, readToolInput, TOOL_KIND, type ToolSettings } from "@/lib/factory/toolJobs";
import { getToolSettings, toolUsage } from "@/lib/factory/toolJobsDb";
import { readManifestTools } from "@/lib/factory/toolManifestDb";
import { buildMakeJob, sortMakeJobs, subjectNames, type MakeArt, type MakeJob } from "@/lib/studio/make";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const MAKE_JOB_LIMIT = 30;

export interface MakeCard {
  id: string;
  name: string;
  description: string;
  version: number;
  tool: string;
  method: string;
  perCall: number; // 한 장(호출)당 PixelLab 호출 수. 0 = 비용 표기 없음
  warnings: string[];
}

export interface MakeData {
  appSlug: string;
  cards: MakeCard[];
  jobs: MakeJob[];
  names: string[]; // 대상 이름 자동완성 후보(별칭 + 승인 그림 대상)
  approved: { id: string; subject: string; url: string }[]; // 직접 고를 수 있는 참고 그림(승인 그림)
  limits: Pick<ToolSettings, "autoApprove" | "autoApproveMaxCost" | "dailyLimit" | "monthlyLimit">;
  usage: { day: number; month: number };
}

export async function readMakeData(appSlug: string): Promise<MakeData | null> {
  if (!SLUG_RE.test(appSlug)) return null;
  const [cards, settings, usage, tools, jobRows, approved, project] = await Promise.all([
    listCards(appSlug),
    getToolSettings(),
    toolUsage().catch(() => ({ day: 0, month: 0 })),
    readManifestTools().catch(() => ({}) as Awaited<ReturnType<typeof readManifestTools>>),
    prisma.factoryJob.findMany({
      where: { kind: TOOL_KIND, appSlug },
      orderBy: { createdAt: "desc" },
      take: MAKE_JOB_LIMIT,
      select: { id: true, title: true, status: true, phase: true, cardId: true, createdAt: true, finishedAt: true, failReason: true, toolInput: true, toolResult: true },
    }),
    prisma.factoryArt.findMany({ where: { appSlug, status: "approved" }, orderBy: { decidedAt: "desc" }, select: { id: true, subject: true, url: true }, take: 200 }),
    getProjectToolSettings(prisma as unknown as SettingsDb, appSlug).catch(() => null),
  ]);
  const ids = jobRows.map((j) => j.id);
  const cardName = new Map(cards.map((c) => [c.id, c.name]));
  const [artRows, logRows, pickRows] = ids.length
    ? await Promise.all([
        prisma.factoryArt.findMany({ where: { appSlug, jobId: { in: ids } }, orderBy: { createdAt: "asc" }, select: { id: true, url: true, subject: true, status: true, cardId: true, cardVersion: true, summary: true, jobId: true }, take: 400 }),
        // 일감마다 마지막 로그 한 줄: 진행 중이거나 멈춘 일감만 읽는다
        prisma.factoryJobLog.findMany({ where: { jobId: { in: jobRows.filter((j) => j.status === "running" || j.status === "needs_confirmation").map((j) => j.id) } }, orderBy: { at: "desc" }, select: { jobId: true, message: true }, take: 200 }),
        prisma.factorySetting.findMany({ where: { key: { in: ids.map((id) => `${ART_PICKS_PREFIX}${id}`) } } }),
      ])
    : [[], [], []];
  const approvedById = new Map(approved.map((a) => [a.id, a]));
  const lastLog = new Map<string, string>();

  for (const l of logRows) if (!lastLog.has(l.jobId)) lastLog.set(l.jobId, l.message);
  const picksOf = new Map<string, { id: string; url: string; subject: string }[]>();

  for (const p of pickRows) {
    let list: unknown = [];

    try {
      list = JSON.parse(p.value);
    } catch {
      /* 깨진 값은 무시 */
    }
    const jobId = p.key.slice(ART_PICKS_PREFIX.length);

    picksOf.set(jobId, (Array.isArray(list) ? list : []).map((x) => (typeof x === "string" ? approvedById.get(x) : undefined)).filter((x): x is { id: string; url: string; subject: string } => !!x));
  }
  const artsOf = new Map<string, MakeArt[]>();

  for (const a of artRows) {
    if (!a.jobId) continue;
    const s = parseSummary(a.summary);
    const view: MakeArt = {
      id: a.id,
      url: a.url,
      subject: a.subject,
      status: a.status,
      cardId: a.cardId,
      cardName: (a.cardId && cardName.get(a.cardId)) || "",
      cardVersion: a.cardVersion,
      refs: s?.refs ?? [],
      refsFallback: s?.refsFallback ?? "",
      cost: s?.cost ?? 0,
    };

    artsOf.set(a.jobId, [...(artsOf.get(a.jobId) ?? []), view]);
  }
  const jobs = sortMakeJobs(
    jobRows.map((r) =>
      buildMakeJob({
        row: { ...r, input: readToolInput(r.toolInput), result: cleanToolResult(r.toolResult) },
        cardName: (r.cardId && cardName.get(r.cardId)) || "",
        lastLog: lastLog.get(r.id),
        arts: (artsOf.get(r.id) ?? []).map((a) => ({ ...a, cardName: a.cardName || ((r.cardId && cardName.get(r.cardId)) || "") })),
        picked: picksOf.get(r.id),
      }),
    ),
  );
  const aliases = (project?.settings as { aliases?: unknown } | undefined)?.aliases;

  return {
    appSlug,
    cards: cards
      .filter((c) => c.enabled)
      .map((c) => ({ id: c.id, name: c.name, description: c.description, version: c.version, tool: c.tool, method: c.method, perCall: perCallCost(tools[c.tool], c.method), warnings: c.warnings })),
    jobs,
    names: subjectNames(aliases, approved.map((a) => a.subject)),
    approved,
    limits: { autoApprove: settings.autoApprove, autoApproveMaxCost: settings.autoApproveMaxCost, dailyLimit: settings.dailyLimit, monthlyLimit: settings.monthlyLimit },
    usage,
  };
}
