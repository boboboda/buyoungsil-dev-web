// lib/studio/dashboard.ts
// 공용 스튜디오(/studio, /studio/<앱>)의 순수 계산: 탭·하위 메뉴, 블록 그림 배치(프로젝트 → 결과물 카드 → 도구 → 방법), 카드별 사용량 집계, 프로젝트 목록 한 줄.
// DB·화면 없음(읽기는 lib/studio/data.ts, 그리기는 components/studio/*). 키 값은 다루지 않는다(이름과 등록 여부만).

export const STUDIO_TABS = [
  { key: "config", label: "구성" },
  { key: "make", label: "제작" },
  { key: "ops", label: "운영" },
] as const;
export type StudioTab = (typeof STUDIO_TABS)[number]["key"];

/** 모르는 값이면 [구성] */
export function parseStudioTab(raw: string | string[] | undefined | null): StudioTab {
  const v = Array.isArray(raw) ? raw[0] : raw;

  return STUDIO_TABS.some((t) => t.key === v) ? (v as StudioTab) : "config";
}

export interface StudioFeatureFlags {
  studioBatch: boolean; // 프로젝트 연결 설정의 스튜디오 기능: 배치
  studioService: boolean; // 스튜디오 기능: 서비스 운영
}

/** [운영] 하위 메뉴. feature 가 있으면 프로젝트 연결 설정에서 그 기능이 켜져 있을 때만 보인다 */
export const OPS_MENU = [
  { key: "review", label: "검수" },
  { key: "schedule", label: "생성 일정", feature: "studioBatch" },
  { key: "service", label: "서비스 운영", feature: "studioService" },
  { key: "export", label: "내보내기" },
] as const satisfies readonly { key: string; label: string; feature?: keyof StudioFeatureFlags }[];

export function visibleOpsMenu(flags: StudioFeatureFlags): { key: string; label: string }[] {
  return OPS_MENU.filter((m) => !("feature" in m) || flags[m.feature]).map((m) => ({ key: m.key, label: m.label }));
}

/** [구성] 안의 구역(한 화면에 차례로 보인다) */
export const CONFIG_MENU = [
  { key: "dashboard", label: "대시보드" },
  { key: "blocks", label: "도구 블록 연결" },
  { key: "cards", label: "카드 옵션" },
  { key: "keys", label: "키 상태" },
] as const;

// ───────── 블록 그림 ─────────

export type BlockType = "project" | "card" | "tool" | "method";
export type Tone = "ok" | "warn" | "muted";

export interface BlockBadge {
  text: string;
  tone: Tone;
}

export interface BlockNode {
  id: string;
  type: BlockType;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string;
  badges: BlockBadge[];
  dim: boolean; // 꺼진 카드 등
}

export interface BlockEdge {
  from: string;
  to: string;
}

export interface BlockGraph {
  nodes: BlockNode[];
  edges: BlockEdge[];
  width: number;
  height: number;
}

export interface GraphCard {
  id: string;
  name: string;
  version: number;
  tool: string;
  method: string;
  enabled: boolean;
  warnings: string[];
}

export interface GraphTool {
  name: string;
  label: string;
  source: "file" | "fallback";
  version: number;
  methods: { id: string; label: string; secrets: { name: string; ready: boolean }[] }[];
}

export const NODE_W = 176;
export const NODE_H = 72;
export const COL_GAP = 56;
export const ROW_GAP = 14;
export const PAD = 8;

export const blockId = {
  project: (slug: string) => `project:${slug}`,
  card: (id: string) => `card:${id}`,
  tool: (name: string) => `tool:${name}`,
  method: (tool: string, method: string) => `method:${tool}:${method || "default"}`,
};

/** 방법 블록의 키 상태 한 줄(값 없이): 필요 없음 / 등록됨 / 없음 n개 */
export function keyBadge(secrets: readonly { name: string; ready: boolean }[]): BlockBadge {
  if (!secrets.length) return { text: "키 필요 없음", tone: "muted" };
  const missing = secrets.filter((s) => !s.ready).length;

  return missing === 0 ? { text: "키 등록됨", tone: "ok" } : { text: `키 없음 ${missing}개`, tone: "warn" };
}

/** 프로젝트 → 카드 → 도구 → 방법. 카드가 쓰는 도구·방법만 그린다(안 쓰는 도구는 그림에 나오지 않는다) */
export function buildBlockGraph(input: { appSlug: string; title: string; kindLabel: string; cards: readonly GraphCard[]; tools: readonly GraphTool[]; toolkitCommit: string }): BlockGraph {
  const toolOf = new Map(input.tools.map((t) => [t.name, t]));
  const cols: BlockNode[][] = [[], [], [], []];
  const edges: BlockEdge[] = [];
  const seen = new Set<string>();
  const make = (col: number, n: Omit<BlockNode, "col" | "x" | "y" | "w" | "h">) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    cols[col].push({ ...n, col, x: 0, y: 0, w: NODE_W, h: NODE_H });
  };
  const link = (from: string, to: string) => {
    if (!edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to });
  };
  const pid = blockId.project(input.appSlug);

  make(0, { id: pid, type: "project", title: input.title || input.appSlug, sub: `${input.appSlug} · ${input.kindLabel}`, badges: [], dim: false });

  for (const c of input.cards) {
    const cid = blockId.card(c.id);
    const badges: BlockBadge[] = [{ text: `판 ${c.version}`, tone: "muted" }];

    if (c.warnings.length) badges.push({ text: `경고 ${c.warnings.length}`, tone: "warn" });
    if (!c.enabled) badges.push({ text: "꺼짐", tone: "muted" });
    make(1, { id: cid, type: "card", title: c.name, sub: `${c.tool}${c.method ? ` · ${c.method}` : ""}`, badges, dim: !c.enabled });
    link(pid, cid);

    const tid = blockId.tool(c.tool);
    const tool = toolOf.get(c.tool);

    make(2, {
      id: tid,
      type: "tool",
      title: tool?.label || c.tool,
      sub: c.tool,
      badges: tool
        ? [
            { text: tool.source === "file" ? "설명서 file" : "설명서 fallback", tone: tool.source === "file" ? "ok" : "warn" },
            { text: `툴킷 ${input.toolkitCommit || "판 미확인"}`, tone: input.toolkitCommit ? "muted" : "warn" },
          ]
        : [{ text: "설명서 없음", tone: "warn" }],
      dim: false,
    });
    link(cid, tid);

    const method = tool?.methods.find((m) => m.id.toLowerCase() === c.method.toLowerCase());
    const mid = blockId.method(c.tool, method?.id ?? c.method);

    make(3, {
      id: mid,
      type: "method",
      title: method?.label || c.method || "기본 방식",
      sub: method?.id || (c.method ? c.method : "설정의 기본 방식"),
      badges: method ? [keyBadge(method.secrets)] : c.method ? [{ text: "설명서에 없는 방법", tone: "warn" }] : [{ text: "키는 설정에 따름", tone: "muted" }],
      dim: false,
    });
    link(tid, mid);
  }

  const rows = Math.max(...cols.map((c) => c.length), 1);
  const height = PAD * 2 + rows * NODE_H + (rows - 1) * ROW_GAP;
  const width = PAD * 2 + 4 * NODE_W + 3 * COL_GAP;

  cols.forEach((list, col) => {
    const used = list.length * NODE_H + Math.max(0, list.length - 1) * ROW_GAP;
    const top = PAD + (height - PAD * 2 - used) / 2;

    list.forEach((n, i) => {
      n.x = PAD + col * (NODE_W + COL_GAP);
      n.y = top + i * (NODE_H + ROW_GAP);
    });
  });

  return { nodes: cols.flat(), edges, width, height };
}

// ───────── 사용량 ─────────

export const USAGE_DAYS = 30;

export interface UsageArt {
  cardId: string | null;
  status: string;
  createdAt: Date | string;
  summary: string;
}

export interface CardUsage {
  cardId: string;
  recent: number; // 최근 USAGE_DAYS 일에 만든 그림 수(후보·승인·반려 모두)
  approved: number;
  cost: number; // 그림 요약에 적힌 PixelLab 호출 수 합
  lastAt: string | null;
}

/** 그림 요약(JSON 글자)의 cost(호출 수). 이상하면 0 */
export function summaryCost(text: string): number {
  if (!text) return 0;
  try {
    const o = JSON.parse(text) as { cost?: unknown };

    return typeof o.cost === "number" && Number.isFinite(o.cost) && o.cost > 0 ? o.cost : 0;
  } catch {
    return 0;
  }
}

/** 카드별 최근 생성 수·비용. 카드 없이 만든 그림은 세지 않는다(카드 표에 없다) */
export function summarizeUsage(arts: readonly UsageArt[], cardIds: readonly string[], now = Date.now()): CardUsage[] {
  const since = now - USAGE_DAYS * 24 * 3600 * 1000;
  const map = new Map<string, CardUsage>(cardIds.map((id) => [id, { cardId: id, recent: 0, approved: 0, cost: 0, lastAt: null }]));

  for (const a of arts) {
    const u = a.cardId ? map.get(a.cardId) : undefined;
    const at = new Date(a.createdAt).getTime();

    if (!u || !Number.isFinite(at) || at < since) continue;
    u.recent += 1;
    if (a.status === "approved") u.approved += 1;
    u.cost += summaryCost(a.summary);
    if (!u.lastAt || at > Date.parse(u.lastAt)) u.lastAt = new Date(at).toISOString();
  }

  return [...map.values()];
}

// ───────── 프로젝트 목록 ─────────

/** 화면에 쓰는 시각(UTC). 없으면 "아직 없음" */
export const shortDate = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace("T", " ")}(UTC)` : "아직 없음");

export interface OverviewRow {
  appSlug: string;
  title: string;
  kind: "game" | "app" | "none";
  kindLabel: string;
  cardCount: number;
  enabledCards: number;
  pendingReview: number; // 검수 대기(후보 그림) 수
  lastGeneratedAt: string | null;
  cost30d: number; // 최근 30일 PixelLab 호출 수
}

/** 분류 순서: 게임 → 앱 → 미분류, 같은 분류 안은 최근 생성이 있는 것 먼저, 그다음 이름 */
export function sortOverview(rows: readonly OverviewRow[]): OverviewRow[] {
  const rank = { game: 0, app: 1, none: 2 } as const;

  return [...rows].sort((a, b) => rank[a.kind] - rank[b.kind] || (b.lastGeneratedAt ?? "").localeCompare(a.lastGeneratedAt ?? "") || a.appSlug.localeCompare(b.appSlug));
}
