// lib/factory/appRoles.ts
// 앱 역할: 제품(앱·게임, 기본값) / 도구·플랫폼(제품을 만들거나 운영하는 쪽). [스튜디오] 프로젝트 목록에는 제품만 나온다.
// - 저장: factory_settings 의 appRoles 한 칸(JSON) { [appSlug]: "product" | "tool" }. 앱 레코드(FactoryApp)가 없는 앱도 저장할 수 있고 마이그레이션이 필요 없다.
// - 값이 없으면 product. 단 DEFAULT_TOOL_APPS 는 관리자가 따로 정하기 전까지 tool. 관리자가 저장한 값이 항상 이긴다.
export const APP_ROLES_KEY = "appRoles";
export const MAX_APP_ROLES = 500;

export const APP_ROLES = ["product", "tool"] as const;
export type AppRole = (typeof APP_ROLES)[number];
export const APP_ROLE_LABELS: Record<AppRole, string> = { product: "제품", tool: "도구·플랫폼" };
export const isAppRole = (v: unknown): v is AppRole => v === "product" || v === "tool";

/** 관리자가 정하기 전까지 도구·플랫폼으로 보는 앱 */
export const DEFAULT_TOOL_APPS: readonly string[] = ["game-toolkit", "app-kit"];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export type AppRoles = Record<string, AppRole>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 저장된 JSON → 역할 표. 이상한 항목은 버린다 */
export function readAppRoles(raw: string | null | undefined): AppRoles {
  if (!raw) return {};
  try {
    const o: unknown = JSON.parse(raw);

    if (!isRecord(o)) return {};
    const out: AppRoles = {};

    for (const [slug, v] of Object.entries(o).slice(0, MAX_APP_ROLES)) {
      if (SLUG_RE.test(slug) && isAppRole(v)) out[slug] = v;
    }

    return out;
  } catch {
    return {};
  }
}

/** 저장값 → 코드 기본 목록 → product 순으로 정한다 */
export function resolveAppRole(roles: AppRoles, appSlug: string): AppRole {
  if (Object.hasOwn(roles, appSlug)) return roles[appSlug];

  return DEFAULT_TOOL_APPS.includes(appSlug) ? "tool" : "product";
}

export type AppRolePatchResult = { ok: true; roles: AppRoles; message: string } | { ok: false; message: string };

/** 관리자 입력 { appSlug, role } 한 건을 합친다. knownSlugs 에 없는 앱도 이미 저장돼 있거나 기본 목록에 있으면 허용 */
export function applyAppRolePatch(cur: AppRoles, raw: unknown, knownSlugs: ReadonlySet<string>): AppRolePatchResult {
  if (!isRecord(raw)) return { ok: false, message: "앱 역할 본문이 올바르지 않아요." };
  const slug = typeof raw.appSlug === "string" ? raw.appSlug.trim() : "";

  if (!SLUG_RE.test(slug)) return { ok: false, message: "appSlug 형식이 올바르지 않아요(영문 소문자·숫자·하이픈)." };
  if (!isAppRole(raw.role)) return { ok: false, message: "역할은 product(제품) 또는 tool(도구·플랫폼) 이어야 해요." };
  if (!knownSlugs.has(slug) && !Object.hasOwn(cur, slug) && !DEFAULT_TOOL_APPS.includes(slug)) return { ok: false, message: "홈페이지가 모르는 앱이에요." };
  if (!Object.hasOwn(cur, slug) && Object.keys(cur).length >= MAX_APP_ROLES) return { ok: false, message: `앱 역할은 ${MAX_APP_ROLES}개까지 저장해요.` };

  return { ok: true, roles: { ...cur, [slug]: raw.role }, message: `${slug} 의 역할을 '${APP_ROLE_LABELS[raw.role]}'(으)로 저장했어요.` };
}
