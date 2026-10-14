// lib/studio/data.ts
// 공용 스튜디오가 화면에 쓰는 자료 읽기(서버 전용). 계산은 lib/studio/dashboard.ts.
// 쓰는 자료: 일감(앱 목록) · 스튜디오 분류(studioProjects) · 앱 역할 · 프로젝트 연결(1-6, 기능 플래그) · 결과물 카드(2-2) · 도구 설명서(2-1) · 그림 저장소(승인 그림·카드별 생성 수·비용).
// 키는 이름과 등록 여부만 나오고 값은 읽지 않는다. 한 군데 읽기가 실패해도 가능한 만큼 보여 주도록 호출하는 쪽이 감싼다.
import prisma from "@/lib/prisma";
import { APP_ROLES_KEY, readAppRoles } from "@/lib/factory/appRoles";
import { listCards, type CardView } from "@/lib/factory/cardsDb";
import { readLinksView } from "@/lib/factory/projectLinksDb";
import type { LinkRow } from "@/lib/factory/projectLinks";
import { readManifestsView } from "@/lib/factory/toolManifestDb";
import type { ManifestsView } from "@/lib/factory/toolManifest";
import { buildStudioApps, readStudioProjects, splitStudioApps, STUDIO_KIND_LABELS, STUDIO_PROJECTS_KEY, withDefaultShortcuts } from "@/lib/factory/studioProjects";
import { sortOverview, summarizeUsage, summaryCost, USAGE_DAYS, type CardUsage, type OverviewRow } from "@/lib/studio/dashboard";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const DAY = 24 * 3600 * 1000;

export interface StudioOverview {
  rows: OverviewRow[];
  toolApps: string[]; // 도구·플랫폼으로 접어 둔 앱 이름
}

/** /studio 첫 화면: 프로젝트마다 카드 수·검수 대기·최근 생성·비용 */
export async function readStudioOverview(now = Date.now()): Promise<StudioOverview> {
  const since = new Date(now - USAGE_DAYS * DAY);
  const [jobs, projSetting, rolesSetting, cardRows, candidates, recentArts] = await Promise.all([
    prisma.factoryJob.findMany({ where: { kind: { not: "lab" } }, orderBy: { createdAt: "desc" }, take: 500, select: { appSlug: true, title: true, stack: true, status: true, finishedAt: true, kind: true } }),
    prisma.factorySetting.findUnique({ where: { key: STUDIO_PROJECTS_KEY } }),
    prisma.factorySetting.findUnique({ where: { key: APP_ROLES_KEY } }),
    prisma.factoryCard.findMany({ select: { appSlug: true, enabled: true }, take: 3000 }),
    prisma.factoryArt.findMany({ where: { status: "candidate" }, select: { appSlug: true }, take: 5000 }),
    prisma.factoryArt.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, select: { appSlug: true, createdAt: true, summary: true }, take: 5000 }),
  ]);
  const { products, toolApps } = splitStudioApps(buildStudioApps(jobs), readAppRoles(rolesSetting?.value));
  const classes = withDefaultShortcuts(readStudioProjects(projSetting?.value), products.map((a) => a.appSlug));
  const count = <K extends string>(keys: readonly K[]) => {
    const m = new Map<K, number>();

    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);

    return m;
  };
  const cards = count(cardRows.map((c) => c.appSlug));
  const enabled = count(cardRows.filter((c) => c.enabled).map((c) => c.appSlug));
  const pending = count(candidates.map((a) => a.appSlug));
  const last = new Map<string, string>();
  const cost = new Map<string, number>();

  for (const a of recentArts) {
    const at = new Date(a.createdAt).toISOString();

    if (!last.has(a.appSlug) || at > last.get(a.appSlug)!) last.set(a.appSlug, at);
    cost.set(a.appSlug, (cost.get(a.appSlug) ?? 0) + summaryCost(a.summary));
  }
  const rows: OverviewRow[] = products.map((p) => {
    const kind = classes[p.appSlug]?.kind ?? "none";

    return {
      appSlug: p.appSlug,
      title: p.title,
      kind,
      kindLabel: STUDIO_KIND_LABELS[kind],
      cardCount: cards.get(p.appSlug) ?? 0,
      enabledCards: enabled.get(p.appSlug) ?? 0,
      pendingReview: pending.get(p.appSlug) ?? 0,
      lastGeneratedAt: last.get(p.appSlug) ?? null,
      cost30d: cost.get(p.appSlug) ?? 0,
    };
  });

  return { rows: sortOverview(rows), toolApps: toolApps.map((a) => a.appSlug) };
}

export interface ApprovedArtLite {
  id: string;
  subject: string;
  kind: string;
  url: string;
}

export interface StudioProjectData {
  appSlug: string;
  title: string;
  kind: "game" | "app" | "none";
  kindLabel: string;
  link: LinkRow | null;
  cards: CardView[];
  manifest: ManifestsView;
  usage: CardUsage[];
  pendingReview: number;
  approvedArts: ApprovedArtLite[];
  studioUrl: string | null;
}

/** /studio/<앱> 자료. 홈페이지가 모르는 앱이면 null */
export async function readStudioProject(appSlug: string, now = Date.now()): Promise<StudioProjectData | null> {
  if (!SLUG_RE.test(appSlug)) return null;
  const since = new Date(now - USAGE_DAYS * DAY);
  const [latestJob, projSetting, cards, conn] = await Promise.all([
    prisma.factoryJob.findFirst({ where: { appSlug, kind: { not: "lab" } }, orderBy: { createdAt: "desc" }, select: { title: true } }),
    prisma.factorySetting.findUnique({ where: { key: STUDIO_PROJECTS_KEY } }),
    listCards(appSlug),
    prisma.factoryAppConnection.findUnique({ where: { appSlug }, select: { appSlug: true } }),
  ]);
  const saved = readStudioProjects(projSetting?.value);

  if (!latestJob && !cards.length && !conn && !saved[appSlug]) return null;
  const classes = withDefaultShortcuts(saved, [appSlug]);
  const kind = classes[appSlug]?.kind ?? "none";
  const [links, manifest, arts, pendingReview, approved] = await Promise.all([
    readLinksView().catch(() => null),
    readManifestsView().catch(() => ({ commit: "", reportedAt: null, tools: [] }) as ManifestsView),
    prisma.factoryArt.findMany({ where: { appSlug, cardId: { not: null }, createdAt: { gte: since } }, select: { cardId: true, status: true, createdAt: true, summary: true }, take: 3000 }),
    prisma.factoryArt.count({ where: { appSlug, status: "candidate" } }),
    prisma.factoryArt.findMany({ where: { appSlug, status: "approved" }, orderBy: { decidedAt: "desc" }, select: { id: true, subject: true, kind: true, url: true }, take: 200 }),
  ]);

  return {
    appSlug,
    title: latestJob?.title ?? appSlug,
    kind,
    kindLabel: STUDIO_KIND_LABELS[kind],
    link: links?.rows.find((r) => r.appSlug === appSlug) ?? null,
    cards,
    manifest,
    usage: summarizeUsage(arts, cards.map((c) => c.id), now),
    pendingReview,
    approvedArts: approved,
    studioUrl: classes[appSlug]?.studioUrl ?? null,
  };
}
