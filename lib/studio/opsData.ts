// lib/studio/opsData.ts
// 공용 스튜디오 [운영] 탭(3-3)의 읽기·쓰기(서버 전용). 계산은 lib/studio/ops.ts · service.ts.
// - 읽기: 그림 저장소 · 카드 · 내보낸 기록 · 참고로 쓴 일감 · 프로젝트 연결(내보낼 곳·기능 스위치) · 생성 일정 · 서비스 운영 요약.
// - 쓰기(관리자만, 호출하는 라우트가 막는다): 검수 행동(승인·반려·되돌림·다시 요청·기본 그림) · 내보내기 · 일정 저장 · 일정 실행.
// - 앱 폴더는 직접 고치지 않는다(내보내기는 앱 수정 일감으로만). 서비스 DB 는 건드리지 않는다(API 만). 키 값은 읽어도 밖으로 내지 않는다.
import { randomBytes } from "node:crypto";

import prisma from "@/lib/prisma";
import { ART_PICKS_PREFIX, decideArt, listArts, type ArtDb, type ArtView } from "@/lib/factory/arts";
import { listCards, updateCard } from "@/lib/factory/cardsDb";
import { getProjectToolSettings, type SettingsDb } from "@/lib/factory/projectToolSettingsDb";
import { enqueueWithId } from "@/lib/factory/mcp";
import { enqueueToolJob } from "@/lib/factory/toolJobsDb";
import { parseSubjects } from "@/lib/studio/make";
import {
  archiveGroups,
  buildExportItems,
  buildExportPlan,
  EXPORT_LIMIT,
  exportJobTitle,
  filterChoices,
  isDue,
  kstNow,
  nextRunLabel,
  overlapWarning,
  pickIds,
  redoGroups,
  scheduleError,
  usageHistory,
  type ArchiveGroup,
  type ExportRecord,
  type FilterChoices,
  type ReviewAction,
  type ScheduleInput,
  type UsageEvent,
} from "@/lib/studio/ops";
import { buildServiceView, callService, reviewKeyName, serviceOrigin, serviceProfileOf, serviceAdminKeyName, type ServiceCallDeps, type ServiceView } from "@/lib/studio/service";
import { getServiceHealth, type HealthDeps } from "@/lib/studio/serviceHealth";
import { readServiceActions, type ServiceActionView } from "@/lib/studio/serviceOps";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const ART_LIMIT = 300;
const STUDIO_SOURCE = "스튜디오";
const SCHEDULE_SOURCE = "스튜디오 일정";

export interface OpsLink {
  exportKind: string | null;
  exportPath: string | null;
  studioBatch: boolean;
  studioService: boolean;
}

export interface OpsScheduleView {
  cardId: string;
  cardName: string;
  cardEnabled: boolean;
  enabled: boolean;
  hour: number;
  count: number;
  subjects: string;
  extra: string;
  lastRunKey: string;
  lastRunAt: string | null;
  lastJobId: string | null;
  lastMessage: string;
  next: string;
  saved: boolean; // false = 아직 저장한 적 없는 기본값(꺼짐)
}

export interface OpsData {
  appSlug: string;
  arts: ArtView[];
  aliases: unknown;
  cards: { id: string; name: string; enabled: boolean; defaultArtId: string | null }[];
  choices: FilterChoices;
  archive: ArchiveGroup[];
  history: Record<string, UsageEvent[]>; // 그림 id → 사용 이력
  exportsByArt: Record<string, ExportRecord[]>;
  link: OpsLink;
  schedules: OpsScheduleView[];
  overlap: string | null;
  uploadSupported: boolean; // 서비스 업로드 API가 있는지(없으면 '서비스 업로드 미지원')
  service: ServiceView | null;
  serviceActions: ServiceActionView[]; // 서비스 쓰기 동작 기록(누가 언제 무엇을)
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** 내보낸 기록의 상태: 앱 수정 일감이 끝났으면 보냄, 실패·취소면 실패로 보여 준다(기록 줄은 그대로) */
export function exportStatus(stored: string, jobStatus: string | undefined): string {
  if (stored !== "requested" || !jobStatus) return stored;
  if (jobStatus === "done") return "done";
  if (jobStatus === "failed" || jobStatus === "cancelled") return "failed";

  return "requested";
}

export async function readOpsData(appSlug: string, deps: { readReviewCount?: boolean; serviceDeps?: ServiceCallDeps; healthDeps?: HealthDeps; includeService?: boolean } = {}): Promise<OpsData | null> {
  if (!SLUG_RE.test(appSlug)) return null;
  const [arts, settingsRow, cards, exportRows, conn, scheduleRows, jobRows] = await Promise.all([
    listArts(prisma as unknown as ArtDb, appSlug, ART_LIMIT),
    getProjectToolSettings(prisma as unknown as SettingsDb, appSlug).catch(() => null),
    listCards(appSlug),
    prisma.factoryArtExport.findMany({ where: { appSlug }, orderBy: { createdAt: "desc" }, take: 600 }),
    prisma.factoryAppConnection.findUnique({ where: { appSlug }, select: { exportKind: true, exportPath: true, studioBatch: true, studioService: true, domain: true } }),
    prisma.factoryGenSchedule.findMany({ where: { appSlug } }),
    prisma.factoryJob.findMany({ where: { kind: "tool", appSlug }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, title: true, createdAt: true } }),
  ]);
  const aliases = (settingsRow?.settings as { aliases?: unknown } | undefined)?.aliases;
  const jobIds = [...new Set(exportRows.map((e) => e.jobId).filter((x): x is string => !!x))];
  const [exportJobs, pickRows] = await Promise.all([
    jobIds.length ? prisma.factoryJob.findMany({ where: { id: { in: jobIds } }, select: { id: true, status: true } }) : Promise.resolve([]),
    jobRows.length ? prisma.factorySetting.findMany({ where: { key: { in: jobRows.map((j) => `${ART_PICKS_PREFIX}${j.id}`) } } }) : Promise.resolve([]),
  ]);
  const jobStatus = new Map(exportJobs.map((j) => [j.id, j.status]));
  const exportsByArt: Record<string, ExportRecord[]> = {};

  for (const e of exportRows) {
    (exportsByArt[e.artId] ??= []).push({ id: e.id, artId: e.artId, kind: e.kind, status: exportStatus(e.status, e.jobId ? jobStatus.get(e.jobId) : undefined), jobId: e.jobId, dest: e.dest, note: e.note, who: e.who, createdAt: new Date(e.createdAt).toISOString() });
  }
  const usedIn = new Map<string, { jobId: string; title: string; at: string }[]>();

  for (const p of pickRows) {
    const job = jobRows.find((j) => `${ART_PICKS_PREFIX}${j.id}` === p.key);
    let ids: unknown = [];

    try {
      ids = JSON.parse(p.value);
    } catch {
      /* 깨진 값은 무시 */
    }
    if (!job || !Array.isArray(ids)) continue;
    for (const id of ids) if (typeof id === "string") usedIn.set(id, [...(usedIn.get(id) ?? []), { jobId: job.id, title: job.title, at: new Date(job.createdAt).toISOString() }]);
  }
  const cardNames = new Map(cards.map((c) => [c.id, c.name]));
  const history: Record<string, UsageEvent[]> = {};

  for (const a of arts) history[a.id] = usageHistory({ art: a, cardName: (a.cardId && cardNames.get(a.cardId)) || "", exports: exportsByArt[a.id] ?? [], usedAsRefIn: usedIn.get(a.id) });
  const link: OpsLink = { exportKind: conn?.exportKind ?? null, exportPath: conn?.exportPath ?? null, studioBatch: conn?.studioBatch ?? false, studioService: conn?.studioService ?? false };
  const now = Date.now();
  const schedules: OpsScheduleView[] = cards.map((c) => {
    const s = scheduleRows.find((r) => r.cardId === c.id);
    const base = { enabled: s?.enabled ?? false, hour: s?.hour ?? 9, count: s?.count ?? 1, subjects: s?.subjects ?? "", extra: s?.extra ?? "", lastRunKey: s?.lastRunKey ?? "" };

    return { cardId: c.id, cardName: c.name, cardEnabled: c.enabled, ...base, lastRunAt: iso(s?.lastRunAt), lastJobId: s?.lastJobId ?? null, lastMessage: s?.lastMessage ?? "", next: nextRunLabel(base, now), saved: !!s };
  });
  const profile = serviceProfileOf(appSlug);
  const showService = !!profile && (link.studioService || deps.includeService === true); // 관리자 세션이면 연결 설정의 스위치와 상관없이 서비스 운영을 연다

  return {
    appSlug,
    arts,
    aliases,
    cards: cards.map((c) => ({ id: c.id, name: c.name, enabled: c.enabled, defaultArtId: c.refRules.defaultArtId })),
    choices: filterChoices(arts, cardNames, aliases),
    archive: archiveGroups(arts, aliases),
    history,
    exportsByArt,
    link,
    schedules,
    overlap: overlapWarning(profile, link.studioService),
    uploadSupported: !!profile?.capabilities.some((c) => c.key === "upload" && c.api),
    service: showService ? await readServiceView(appSlug, conn?.domain ?? null, deps.serviceDeps, deps.healthDeps) : null,
    serviceActions: showService ? await readServiceActions(appSlug).catch(() => []) : [],
  };
}

// ───────── 서비스 운영 ─────────

/** 서비스 주소: 출시 카드의 검수 페이지 주소(https) 호스트 → 없으면 프로젝트 연결의 도메인 */
export async function serviceBase(appSlug: string, domain: string | null): Promise<string | null> {
  const app = await prisma.factoryApp.findUnique({ where: { appSlug }, select: { reviewUrl: true } }).catch(() => null);

  if (app?.reviewUrl) {
    try {
      return new URL(app.reviewUrl).origin;
    } catch {
      /* 아래로 */
    }
  }

  return domain;
}

export async function readServiceView(appSlug: string, domain: string | null, deps: ServiceCallDeps = {}, healthDeps?: HealthDeps): Promise<ServiceView | null> {
  const profile = serviceProfileOf(appSlug);

  if (!profile) return null;
  const base = await serviceBase(appSlug, domain);
  const names = [...new Set(profile.capabilities.flatMap((c) => (c.api ? [c.api.auth === "review" ? reviewKeyName(appSlug) : serviceAdminKeyName(appSlug)] : [])).concat(serviceAdminKeyName(appSlug)))];
  const stored = await prisma.factorySecretEntry.findMany({ where: { name: { in: names }, status: "stored" }, select: { name: true } }).catch(() => []);
  let reviewCount: ServiceView["reviewCount"] = null;

  if (profile.capabilities.some((c) => c.key === "review-count" && c.api)) {
    if (!serviceOrigin(base).ok) reviewCount = { state: "unavailable", text: "서비스 주소가 없어서 확인하지 않았어요." };
    else {
      const r = await callService(profile, "review-count", base, deps);
      const d = r.state === "ok" ? (r.data as Record<string, unknown>) : null;

      if (d && Number.isInteger(d.review) && Number.isInteger(d.held) && Number.isInteger(d.pending)) reviewCount = { state: "ok", review: d.review as number, held: d.held as number, pending: d.pending as number };
      else reviewCount = { state: "unavailable", text: r.state === "need-key" ? `키 등록 필요: ${r.keyName}` : r.state === "no-api" ? "서비스에 API 없음" : r.state === "blocked" || r.state === "error" ? `확인 못 함 — ${r.reason}` : "확인 못 함 — 응답 형식 오류" };
    }
  }

  const health = await getServiceHealth(appSlug, { deps: { fetchImpl: deps.fetchImpl, readSecret: deps.readSecret, lookupImpl: deps.lookupImpl, base, ...healthDeps } }).catch(() => null);

  return buildServiceView({ profile, base, keysReady: new Set(stored.map((s) => s.name)), reviewCount, health });
}

// ───────── 검수 행동 ─────────

export type OpsResult = { ok: true; message: string; jobIds?: string[]; changed?: number } | { ok: false; status: number; message: string; needsConfirm?: { reason: string; estimatedCost: number } };

const fail = (status: number, message: string): OpsResult => ({ ok: false, status, message });

async function loadArts(appSlug: string, ids: readonly string[]) {
  const rows = await prisma.factoryArt.findMany({ where: { appSlug, id: { in: [...ids] } } });

  return rows;
}

/** 승인·반려·후보로 되돌림: 고른 그림 모두(이 프로젝트 그림만). 상태 전환은 통제실과 같은 decideArt */
export async function decideMany(appSlug: string, rawIds: unknown, action: ReviewAction, who: string): Promise<OpsResult> {
  const picked = pickIds(rawIds);

  if (picked.ok === false) return fail(400, picked.message);
  if (action !== "approve" && action !== "reject" && action !== "reset") return fail(400, "승인·반려·되돌림만 한꺼번에 처리해요.");
  const rows = await loadArts(appSlug, picked.ids);

  if (!rows.length) return fail(404, "고른 그림이 이 프로젝트에 없어요.");
  let changed = 0;

  for (const r of rows) {
    const res = await decideArt(prisma as unknown as ArtDb, r.id, action, who);

    if (res.ok) changed++;
  }
  const label = action === "approve" ? "승인" : action === "reject" ? "반려" : "후보로 되돌림";

  return { ok: true, changed, message: `${changed}장을 ${label}했어요.${action === "approve" ? " 이후 일감부터 자동 참고 그림으로 쓰여요." : ""}${rows.length < picked.ids.length ? ` (${picked.ids.length - rows.length}장은 이 프로젝트 그림이 아니어서 건너뜀)` : ""}` };
}

/** 다시 요청: 같은 카드·같은 대상으로 도구 일감을 다시 만든다. 비용 한도를 넘으면 확인을 요구(confirmed 로 다시) */
export async function redoMany(appSlug: string, rawIds: unknown, confirmed: boolean): Promise<OpsResult> {
  const picked = pickIds(rawIds, 16);

  if (picked.ok === false) return fail(400, picked.message);
  const rows = await loadArts(appSlug, picked.ids);

  if (!rows.length) return fail(404, "고른 그림이 이 프로젝트에 없어요.");
  const { groups, skipped } = redoGroups(rows.map((r) => ({ id: r.id, cardId: r.cardId, subject: r.subject })));

  if (!groups.length) return fail(400, "카드로 만든 그림이 아니어서 다시 요청할 수 없어요. [제작] 탭에서 카드를 골라 새로 만들어 주세요.");
  const jobIds: string[] = [];

  for (const g of groups) {
    const r = await enqueueToolJob({ appSlug, card: g.cardId, subjects: [g.subject], count: g.count, confirmed }, { source: STUDIO_SOURCE, askLimit: true });

    if (r.ok === false) {
      const done = jobIds.length ? ` (앞의 ${jobIds.length}건은 이미 등록했어요)` : "";

      return r.needsConfirm ? { ok: false, status: 409, message: `${r.message}${done}`, needsConfirm: { reason: r.needsConfirm.reason, estimatedCost: r.needsConfirm.estimatedCost } } : fail(400, `${r.message}${done}`);
    }
    jobIds.push(r.id);
  }

  return { ok: true, jobIds, changed: groups.reduce((n, g) => n + g.count, 0), message: `같은 카드로 도구 일감 ${jobIds.length}건을 등록했어요(${groups.map((g) => `${g.subject} ${g.count}장`).join(", ")}).${skipped.length ? ` 카드 없이 만든 ${skipped.length}장은 건너뜀.` : ""}` };
}

/** 기본 그림으로 지정: 승인된 그림 하나를 그 그림을 만든 카드의 defaultArtId 로 */
export async function setDefaultArt(appSlug: string, artId: unknown, who: string): Promise<OpsResult> {
  if (typeof artId !== "string") return fail(400, "그림 하나를 골라 주세요.");
  const [art] = await loadArts(appSlug, [artId]);

  if (!art) return fail(404, "이 프로젝트에 없는 그림이에요.");
  if (art.status !== "approved") return fail(400, "승인된 그림만 기본 그림으로 지정할 수 있어요.");
  if (!art.cardId) return fail(400, "카드 없이 만든 그림이라 지정할 카드가 없어요. [구성] 탭의 카드 고치기에서 기본 그림을 골라 주세요.");
  const card = (await listCards(appSlug)).find((c) => c.id === art.cardId);

  if (!card) return fail(404, "그림을 만든 카드가 없어졌어요.");
  const res = await updateCard(appSlug, card.id, { refRules: { ...card.refRules, defaultArtId: art.id } }, "통제실", who, "스튜디오 검수에서 기본 그림 지정");

  if (res.ok === false) return fail(res.status, res.errors.join(" "));

  return { ok: true, message: res.unchanged ? `이미 '${card.name}' 카드의 기본 그림이에요.` : `'${card.name}' 카드의 기본 그림으로 지정했어요(판 ${res.card.version}). 새로 시작하는 일감부터 적용돼요.` };
}

// ───────── 내보내기 ─────────

const newId = (prefix: string) => `${prefix}_${randomBytes(10).toString("hex")}`;

/** 승인 그림 → 프로젝트 연결 설정에 정해 둔 곳으로. folder = 앱 수정 일감 하나, upload = 서비스 업로드 API(없으면 '미지원'으로 기록) */
export async function exportArts(appSlug: string, rawIds: unknown, who: string, deps: { serviceDeps?: ServiceCallDeps } = {}): Promise<OpsResult> {
  const picked = pickIds(rawIds, EXPORT_LIMIT);

  if (picked.ok === false) return fail(400, picked.message);
  const conn = await prisma.factoryAppConnection.findUnique({ where: { appSlug }, select: { exportKind: true, exportPath: true, domain: true } });

  if (!conn?.exportKind) return fail(400, "내보낼 곳이 정해져 있지 않아요. 통제실의 프로젝트 연결 설정에서 '승인 그림을 내보낼 곳'을 먼저 정해 주세요.");
  const rows = (await loadArts(appSlug, picked.ids)).filter((r) => r.status === "approved");

  if (!rows.length) return fail(400, "승인된 그림만 내보낼 수 있어요.");
  const arts = rows.map((r) => ({ id: r.id, appSlug: r.appSlug, subject: r.subject, kind: r.kind, status: r.status, url: r.url }) as unknown as ArtView);
  const note = rows.length < picked.ids.length ? `${picked.ids.length - rows.length}장은 승인 그림이 아니어서 뺐어요. ` : "";

  if (conn.exportKind === "folder") {
    if (!conn.exportPath) return fail(400, "앱 폴더 경로가 정해져 있지 않아요(프로젝트 연결 설정).");
    const prior = await prisma.factoryArtExport.findMany({ where: { appSlug, kind: "folder", artId: { in: arts.map((a) => a.id) }, status: { in: ["requested", "done"] } }, select: { artId: true, dest: true, jobId: true } });
    const { items, skipped } = buildExportItems(arts, conn.exportPath);
    const fresh = items.filter((it) => !prior.some((p) => p.artId === it.artId && p.dest === it.path));
    const already = items.length - fresh.length;

    if (!fresh.length) return fail(409, `${note}이미 같은 곳으로 내보낸 그림이에요.${skipped.length ? ` (제외 ${skipped.length}장: ${skipped[0].reason})` : ""}`);
    const r = await enqueueWithId({ appSlug, title: exportJobTitle(fresh.length), kind: "revision", planMarkdown: buildExportPlan(appSlug, fresh), source: STUDIO_SOURCE });

    if (r.isError || !r.jobId) return fail(409, (r.content[0]?.text ?? "앱 수정 일감을 만들지 못했어요.").slice(0, 300));
    for (const it of fresh) await prisma.factoryArtExport.create({ data: { id: newId("exp"), artId: it.artId, appSlug, kind: "folder", status: "requested", jobId: r.jobId, dest: it.path, who: who.slice(0, 80) } });

    return { ok: true, jobIds: [r.jobId], changed: fresh.length, message: `${note}앱 수정 일감 1건을 등록했어요(그림 ${fresh.length}장 → ${conn.exportPath}). 승인하면 작업 PC가 앱 폴더에 넣어요.${already ? ` 이미 보낸 ${already}장은 뺐어요.` : ""}${skipped.length ? ` 제외 ${skipped.length}장.` : ""}` };
  }
  // upload
  const profile = serviceProfileOf(appSlug);
  const cap = profile?.capabilities.find((c) => c.key === "upload");

  if (!profile || !cap?.api) {
    for (const a of arts) await prisma.factoryArtExport.create({ data: { id: newId("exp"), artId: a.id, appSlug, kind: "upload", status: "unsupported", dest: profile?.name ?? "서비스", note: "서비스 업로드 미지원", who: who.slice(0, 80) } });

    return fail(501, `${note}서비스 업로드 미지원 — 이 서비스에 그림을 받는 API가 없어요. 필요한 API 모양은 docs/studio-service-api.md 에 적어 뒀어요. 지금은 내보낼 곳을 '앱 폴더 경로'로 바꾸면 앱 수정 일감으로 넣을 수 있어요.`);
  }
  const base = await serviceBase(appSlug, conn.domain);
  const res = await callService(profile, "upload", base, deps.serviceDeps, { items: arts.map((a) => ({ url: a.url, subject: a.subject, kind: a.kind, fileName: `${a.id}.png` })) });
  const status = res.state === "ok" ? "done" : res.state === "no-api" ? "unsupported" : "failed";
  const text = res.state === "ok" ? "보냄" : res.state === "need-key" ? `키 등록 필요: ${res.keyName}` : res.state === "no-api" ? "서비스 업로드 미지원" : res.reason;

  for (const a of arts) await prisma.factoryArtExport.create({ data: { id: newId("exp"), artId: a.id, appSlug, kind: "upload", status, dest: profile.name, note: res.state === "ok" ? "" : text.slice(0, 200), who: who.slice(0, 80) } });
  try {
    await prisma.factoryServiceAction.create({ data: { appSlug, action: "upload", target: `${arts.length}장`, who: who.slice(0, 80), ok: res.state === "ok", message: (res.state === "ok" ? `서비스 업로드: ${arts.length}장을 보냈어요.` : `서비스 업로드 실패 — ${text}`).slice(0, 300) } });
  } catch {
    /* 기록이 안 돼도 결과는 돌려준다 */
  }
  if (res.state === "no-api") return fail(501, `${note}서비스 업로드 미지원 — 이 서비스에 그림을 받는 API(/api/admin/art-upload)가 아직 없어요. 필요한 API 모양은 docs/studio-service-api.md 에 적어 뒀어요. 지금은 내보낼 곳을 '앱 폴더 경로'로 바꾸면 앱 수정 일감으로 넣을 수 있어요.`);

  return res.state === "ok" ? { ok: true, changed: arts.length, message: `${note}서비스(${profile.name})로 ${arts.length}장을 보냈어요.` } : fail(502, `${note}서비스 업로드에 실패했어요 — ${text}`);
}

// ───────── 생성 일정 ─────────

export async function saveSchedule(appSlug: string, cardId: unknown, input: ScheduleInput, who: string): Promise<OpsResult> {
  if (typeof cardId !== "string") return fail(400, "카드를 골라 주세요.");
  const card = (await listCards(appSlug)).find((c) => c.id === cardId);

  if (!card) return fail(404, "이 프로젝트에 없는 카드예요.");
  const err = scheduleError(input);

  if (err) return fail(400, err);
  if (input.enabled && !card.enabled) return fail(400, "꺼진 카드로는 일정을 켤 수 없어요. 먼저 카드를 켜 주세요.");
  const subjects = parseSubjects(input.subjects).join(", ");
  const data = { enabled: input.enabled, hour: input.hour, count: input.count, subjects, extra: input.extra.trim(), updatedAt: new Date(), updatedBy: who.slice(0, 80) };

  await prisma.factoryGenSchedule.upsert({ where: { appSlug_cardId: { appSlug, cardId } }, create: { id: newId("sch"), appSlug, cardId, ...data }, update: data });

  return { ok: true, message: input.enabled ? `'${card.name}' 일정을 켰어요: 매일 ${String(input.hour).padStart(2, "0")}시(한국 시간)에 ${subjects} 각 ${input.count}장.` : `'${card.name}' 일정을 껐어요.` };
}

/** 정해진 시각이 지났고 오늘 아직 안 만든 일정마다 도구 일감을 하나씩 만든다. 하루 한 번(먼저 오늘 날짜를 찍고 만들어서 두 곳에서 동시에 불러도 한 번만) */
export async function runDueSchedules(now: Date = new Date()): Promise<{ ran: number; skipped: number }> {
  const rows = await prisma.factoryGenSchedule.findMany({ where: { enabled: true } });
  const today = kstNow(now).key;
  let ran = 0;
  let skipped = 0;

  for (const s of rows) {
    if (!isDue(s, now)) continue;
    const claim = await prisma.factoryGenSchedule.updateMany({ where: { id: s.id, enabled: true, NOT: { lastRunKey: today } }, data: { lastRunKey: today, lastRunAt: now } });

    if (!claim.count) continue;
    const r = await enqueueToolJob({ appSlug: s.appSlug, card: s.cardId, subjects: parseSubjects(s.subjects), count: s.count, extra: s.extra }, { source: SCHEDULE_SOURCE, askLimit: true });
    const message = r.ok === true ? r.message : r.needsConfirm ? `비용 한도를 넘어서 오늘은 만들지 않았어요: ${r.needsConfirm.reason}` : r.message;

    await prisma.factoryGenSchedule.update({ where: { id: s.id }, data: { lastJobId: r.ok === true ? r.id : null, lastMessage: message.slice(0, 300) } });
    if (r.ok === true) ran++;
    else skipped++;
  }

  return { ran, skipped };
}

let lastTick = 0;

/** 다른 요청 길목에서 부르는 가벼운 확인(1분에 한 번만, 실패해도 던지지 않음) */
export async function tickSchedules(now: Date = new Date(), force = false): Promise<void> {
  if (!force && now.getTime() - lastTick < 60_000) return;
  lastTick = now.getTime();
  try {
    await runDueSchedules(now);
  } catch (e) {
    console.error("[studio] 생성 일정 확인 실패:", e instanceof Error ? e.name : "unknown");
  }
}
