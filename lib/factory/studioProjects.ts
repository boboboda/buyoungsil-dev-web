// lib/factory/studioProjects.ts
// 통제실 [스튜디오] 탭의 프로젝트 설정: 프로젝트(= 공장 앱 appSlug)마다 종류(게임/앱)·연결한 도구·스튜디오 주소를 정한다.
// - 저장: factory_settings 의 studioProjects 한 칸(JSON). 새 테이블 없음.
//   { [appSlug]: { kind: "game" | "app" | "none", tools: [도구 id…], templateId?: string, studioUrl?: "https://…", links?: [{ name, url }…] } }
// - 스튜디오 분류(kind): 게임 / 앱 / 미분류(none). 관리자가 지정할 때만 game·app 이 된다(자동 분류 없음). 저장값이 없거나 none 이면 '미분류'.
//   (앱 역할 '제품 / 도구·플랫폼' = lib/factory/appRoles.ts 와는 별개: 역할은 스튜디오 목록에 나오느냐, 분류는 어느 스튜디오에 묶이느냐)
// - 바로가기: studioUrl = [스튜디오 열기] 한 개, links = 이름+주소 목록(관리자 페이지·공개 주소 등, 최대 MAX_STUDIO_LINKS).
// - 도구 id 는 감독 프로그램이 보고한 tools.json 목록 안에서만, 손으로 해야 하는 도구(MANUAL_TOOL_IDS)는 연결할 수 없다.
import { resolveAppRole, type AppRoles } from "@/lib/factory/appRoles";
import type { Purpose } from "@/lib/factory/toolkit";

export const STUDIO_PROJECTS_KEY = "studioProjects";
export const MAX_STUDIO_PROJECTS = 200;
export const MAX_STUDIO_TOOLS = 40;
export const MAX_STUDIO_URL = 200;

export const MAX_STUDIO_LINKS = 8;
export const MAX_LINK_NAME = 30;

export const STUDIO_KINDS = ["game", "app", "none"] as const;
export type StudioKind = (typeof STUDIO_KINDS)[number];
/** 게임·앱 스튜디오에 묶이는 분류(미분류 제외) */
export type ClassifiedKind = Exclude<StudioKind, "none">;
export const STUDIO_KIND_LABELS: Record<StudioKind, string> = { game: "게임", app: "앱", none: "미분류" };
export const isStudioKind = (v: unknown): v is StudioKind => v === "game" || v === "app" || v === "none";

/** 사람이 직접 해야 해서 스튜디오에 연결할 수 없는 도구 */
export const MANUAL_TOOL_IDS: readonly string[] = ["setup-runtime"];
export const isManualTool = (id: string) => MANUAL_TOOL_IDS.includes(id);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const TOOL_ID_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const TEMPLATE_RE = /^[a-z][a-z0-9_-]{0,39}$/;

export interface StudioProject {
  kind: StudioKind;
  tools: string[];
  templateId?: string;
  studioUrl?: string;
  links?: StudioLink[];
}

export interface StudioLink {
  name: string;
  url: string;
}

export type StudioProjects = Record<string, StudioProject>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 스튜디오 주소: https 만, 길이 제한, 아이디·비밀번호 포함 금지. 통과하면 정리된 주소, 아니면 null */
export function cleanStudioUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();

  if (!s || s.length > MAX_STUDIO_URL || /[\u0000- \u007f]/.test(s)) return null;
  try {
    const u = new URL(s);

    if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;

    return u.href.length <= MAX_STUDIO_URL ? u.href : null;
  } catch {
    return null;
  }
}

/** 바로가기 목록: 이름(1~30자)+https 주소만, 같은 주소 중복 제거, 최대 8개. 이상한 항목은 버린다 */
export function cleanLinks(v: unknown): StudioLink[] {
  if (!Array.isArray(v)) return [];
  const out: StudioLink[] = [];

  for (const x of v) {
    if (!isRecord(x) || typeof x.name !== "string") continue;
    const name = x.name.trim().replace(/\s+/g, " ");
    const url = cleanStudioUrl(x.url);

    if (!name || name.length > MAX_LINK_NAME || !url || out.some((l) => l.url === url)) continue;
    out.push({ name, url });
    if (out.length >= MAX_STUDIO_LINKS) break;
  }

  return out;
}

/** 저장된 JSON → 프로젝트 설정. 이상한 항목은 버린다 */
export function readStudioProjects(raw: string | null | undefined): StudioProjects {
  if (!raw) return {};
  try {
    const o: unknown = JSON.parse(raw);

    if (!isRecord(o)) return {};
    const out: StudioProjects = {};

    for (const [slug, v] of Object.entries(o).slice(0, MAX_STUDIO_PROJECTS)) {
      if (!SLUG_RE.test(slug) || !isRecord(v) || !isStudioKind(v.kind)) continue;
      const tools = Array.isArray(v.tools) ? [...new Set(v.tools.filter((t): t is string => typeof t === "string" && TOOL_ID_RE.test(t)))].slice(0, MAX_STUDIO_TOOLS) : [];
      const studioUrl = cleanStudioUrl(v.studioUrl);
      const links = cleanLinks(v.links);

      out[slug] = {
        kind: v.kind,
        tools,
        ...(typeof v.templateId === "string" && TEMPLATE_RE.test(v.templateId) ? { templateId: v.templateId } : {}),
        ...(studioUrl ? { studioUrl } : {}),
        ...(Array.isArray(v.links) ? { links } : {}),
      };
    }

    return out;
  } catch {
    return {};
  }
}

export type StudioPatchResult = { ok: true; projects: StudioProjects; message: string } | { ok: false; message: string };

/**
 * 관리자 입력 한 건을 현재 설정에 합친다. 본문에 있는 칸만 바꾼다.
 * { appSlug, kind?: game|app|none, tools?, studioUrl?: string | null, links?: [{ name, url }] | null, templateId?: string | null }
 * knownSlugs = 홈페이지가 아는 앱 이름, reportedTools = 보고된 도구 id.
 * 처음 도구를 연결할 때는 kind(game|app)가 꼭 있어야 한다. 주소·바로가기만 보내면 미분류(none)로 만들어진다.
 */
export function applyStudioPatch(cur: StudioProjects, raw: unknown, knownSlugs: ReadonlySet<string>, reportedTools: ReadonlySet<string>): StudioPatchResult {
  if (!isRecord(raw)) return { ok: false, message: "스튜디오 설정 본문이 올바르지 않아요." };
  const slug = typeof raw.appSlug === "string" ? raw.appSlug.trim() : "";

  if (!SLUG_RE.test(slug)) return { ok: false, message: "appSlug 형식이 올바르지 않아요(영문 소문자·숫자·하이픈)." };
  if (!knownSlugs.has(slug) && !cur[slug]) return { ok: false, message: "홈페이지가 모르는 앱이에요." };

  const prev = cur[slug];
  let kind = prev?.kind;

  if (Object.hasOwn(raw, "kind")) {
    if (!isStudioKind(raw.kind)) return { ok: false, message: "종류는 game(게임)·app(앱)·none(미분류) 중 하나여야 해요." };
    kind = raw.kind;
  }
  if (!kind && !Object.hasOwn(raw, "tools") && (Object.hasOwn(raw, "studioUrl") || Object.hasOwn(raw, "links"))) kind = "none"; // 주소·바로가기만 먼저 적는 미분류 프로젝트
  if (!kind) return { ok: false, message: "먼저 종류(게임/앱)를 정해 주세요." };

  let tools = prev?.tools ?? [];

  if (Object.hasOwn(raw, "tools")) {
    if (!Array.isArray(raw.tools) || raw.tools.length > MAX_STUDIO_TOOLS) return { ok: false, message: "도구는 목록(최대 40개)으로 보내 주세요." };
    const ids: string[] = [];

    for (const t of raw.tools) {
      if (typeof t !== "string" || !TOOL_ID_RE.test(t)) return { ok: false, message: "도구 이름 형식이 올바르지 않아요." };
      if (isManualTool(t)) return { ok: false, message: `${t} 는 직접 해야 하는 도구라 연결할 수 없어요.` };
      if (!reportedTools.has(t)) return { ok: false, message: `${t} 는 보고된 도구 목록에 없어요.` };
      if (!ids.includes(t)) ids.push(t);
    }
    tools = ids;
  }

  let studioUrl = prev?.studioUrl;

  if (Object.hasOwn(raw, "studioUrl")) {
    if (raw.studioUrl === null || (typeof raw.studioUrl === "string" && raw.studioUrl.trim() === "")) studioUrl = undefined;
    else {
      const url = cleanStudioUrl(raw.studioUrl);

      if (!url) return { ok: false, message: `스튜디오 주소는 https:// 로 시작하는 ${MAX_STUDIO_URL}자 이하 주소여야 해요.` };
      studioUrl = url;
    }
  }

  let links = prev?.links;

  if (Object.hasOwn(raw, "links")) {
    if (raw.links === null) links = undefined;
    else if (!Array.isArray(raw.links) || raw.links.length > MAX_STUDIO_LINKS) return { ok: false, message: `바로가기는 목록(최대 ${MAX_STUDIO_LINKS}개)으로 보내 주세요.` };
    else {
      const cleaned = cleanLinks(raw.links);

      if (cleaned.length !== raw.links.length) return { ok: false, message: `바로가기는 이름(${MAX_LINK_NAME}자 이하)과 https:// 주소(${MAX_STUDIO_URL}자 이하)가 있어야 하고, 같은 주소는 한 번만 쓸 수 있어요.` };
      links = cleaned.length ? cleaned : undefined;
    }
  }

  let templateId = prev?.templateId;

  if (Object.hasOwn(raw, "templateId")) {
    if (raw.templateId === null) templateId = undefined;
    else if (typeof raw.templateId === "string" && TEMPLATE_RE.test(raw.templateId)) templateId = raw.templateId;
    else return { ok: false, message: "템플릿 이름 형식이 올바르지 않아요." };
  }

  if (!prev && Object.keys(cur).length >= MAX_STUDIO_PROJECTS) return { ok: false, message: `스튜디오 프로젝트는 ${MAX_STUDIO_PROJECTS}개까지 저장해요.` };

  const next: StudioProject = { kind, tools, ...(templateId ? { templateId } : {}), ...(studioUrl ? { studioUrl } : {}), ...(links ? { links } : {}) };

  return { ok: true, projects: { ...cur, [slug]: next }, message: `${slug} 의 스튜디오 설정을 저장했어요(${STUDIO_KIND_LABELS[kind]} · 도구 ${tools.length}개).` };
}

/** 이 스튜디오에서 먼저 보여 줄 용도: 게임 스튜디오는 게임용·공용, 앱 스튜디오는 움짤·컷용·공용 */
export const FIRST_PURPOSES: Record<StudioKind, readonly Purpose[]> = { game: ["game", "common"], app: ["cut", "common"], none: ["common"] };

/** 도구를 이 스튜디오 종류에 맞는 것부터 정렬(나머지도 모두 남긴다). 같은 묶음 안은 원래 순서 */
export function orderToolsFor<T extends { purpose: Purpose }>(kind: StudioKind, rows: readonly T[]): T[] {
  const first = FIRST_PURPOSES[kind];

  return [...rows.filter((r) => first.includes(r.purpose)), ...rows.filter((r) => !first.includes(r.purpose))];
}

export interface StudioAppInfo {
  appSlug: string;
  title: string;
  stack: string;
  status: string; // 가장 최근 일감 상태
  finishedAt: string | null; // 가장 최근 일감 완료 시각(ISO)
  done: boolean; // 완료된 일감이 한 번이라도 있는가
}

/** 일감(최신순) → 앱 목록. 앱마다 가장 최근 일감 한 건을 쓰고, 완료된 앱이 먼저 */
export function buildStudioApps(jobs: readonly { appSlug: string; title: string; stack: string; status: string; finishedAt: Date | string | null; kind?: string }[]): StudioAppInfo[] {
  const apps = new Map<string, StudioAppInfo>();

  for (const j of jobs) {
    const hasDone = j.status === "done";
    const seen = apps.get(j.appSlug);

    if (seen) {
      if (hasDone) seen.done = true;
      continue;
    }
    apps.set(j.appSlug, {
      appSlug: j.appSlug,
      title: j.title,
      stack: j.stack,
      status: j.status,
      finishedAt: j.finishedAt ? new Date(j.finishedAt).toISOString() : null,
      done: hasDone,
    });
  }

  return [...apps.values()].sort((a, b) => Number(b.done) - Number(a.done));
}

/** 앱 목록 → 제품(스튜디오 프로젝트 목록에 나옴)과 도구·플랫폼(이름만 접어서 보임). 저장된 studioProjects 값은 건드리지 않는다 */
export function splitStudioApps<T extends { appSlug: string }>(apps: readonly T[], roles: AppRoles): { products: T[]; toolApps: T[] } {
  return {
    products: apps.filter((a) => resolveAppRole(roles, a.appSlug) === "product"),
    toolApps: apps.filter((a) => resolveAppRole(roles, a.appSlug) === "tool"),
  };
}

/**
 * 코드에서 확인한 바로가기 기본값(저장된 값이 없을 때만 화면에 채워 넣는다. 저장하면 저장값이 이긴다).
 * 확인 방법은 각 항목 주석. 추측한 주소는 넣지 않는다.
 */
export const DEFAULT_STUDIO_SHORTCUTS: Record<string, { studioUrl?: string; links?: StudioLink[] }> = {
  // 새싹 허브 게임 Studio(app-kit 일감 보고에 나온 주소). 공개 주소를 부르면 로그인 전이라 401 이 나오는 것으로 존재를 확인
  "saessak-hub": { studioUrl: "https://studio.buyoungsilcoding.com/p/hub/studio/" },
  // 하찮은 한 컷: 관리자(검수) 페이지는 /admin(토큰 로그인, 공개 주소에서 401), 앱 서버 API 는 /today 가 200 (one-tiny-frame docs/api.md · app-flutter/README.md 의 API_BASE)
  "one-tiny-frame": {
    links: [
      { name: "관리자 페이지", url: "https://hancut.buyoungsilcoding.com/admin" },
      { name: "앱 서버 API", url: "https://hancut.buyoungsilcoding.com/today" },
    ],
  },
};

/** 저장된 설정 위에 코드 기본 바로가기를 얹는다(저장값이 있는 칸은 건드리지 않음). 설정이 없는 프로젝트는 미분류로 보인다 */
export function withDefaultShortcuts(projects: StudioProjects, slugs: readonly string[]): StudioProjects {
  const out: StudioProjects = { ...projects };

  for (const slug of slugs) {
    const d = DEFAULT_STUDIO_SHORTCUTS[slug];

    if (!d) continue;
    const cur = out[slug] ?? { kind: "none" as const, tools: [] };

    out[slug] = { ...cur, ...(cur.studioUrl || !d.studioUrl ? {} : { studioUrl: d.studioUrl }), ...(cur.links || !d.links ? {} : { links: d.links }) };
  }

  return out;
}
