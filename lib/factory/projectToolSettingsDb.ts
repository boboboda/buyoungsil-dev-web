// lib/factory/projectToolSettingsDb.ts
// 프로젝트별 도구 설정의 저장·이력·되돌리기·감독 프로그램 전달. 형식·검증은 projectToolSettings.ts.
// - 현재 값: factory_project_tool_settings (appSlug 당 한 줄, version·수정 시각·수정자)
// - 이력: factory_project_tool_setting_history (저장·되돌리기마다 한 줄, 앱마다 최근 HISTORY_KEEP 개만 남긴다)
// - 설정이 없는 프로젝트는 한 줄도 없다(= 도구 기본값). 지우기(비우기)는 빈 설정 { version: 1 } 저장이다.
import { createHash } from "node:crypto";

import { cleanProjectSettings, changedGroups, HISTORY_LIMIT, isEmptySettings, readStoredSettings, type ProjectToolSettings } from "@/lib/factory/projectToolSettings";
import { PROJECT_SETTINGS_SCHEMA } from "@/lib/factory/projectToolSettingsSchema";

export const HISTORY_KEEP = 30;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v);

/** 이 홈페이지 사본 스키마의 지문(감독 프로그램의 projectSettingsSchemaHash 와 같은 방식) */
export function schemaHash(schema: unknown = PROJECT_SETTINGS_SCHEMA): string {
  return createHash("sha256").update(JSON.stringify(stable(schema))).digest("hex").slice(0, 16);
}

export interface ProjectSettingsRecord {
  appSlug: string;
  version: number;
  settings: ProjectToolSettings;
  updatedAt: string;
  updatedBy: string;
}

export interface ProjectSettingsHistoryItem {
  version: number;
  note: string;
  createdAt: string;
  createdBy: string;
  changed: string[]; // 바로 앞 버전과 달라진 묶음 이름
  empty: boolean;
}

interface Row {
  appSlug: string;
  version: number;
  settings: string;
  updatedAt: Date;
  updatedBy: string;
}
interface HistoryRow {
  appSlug: string;
  version: number;
  settings: string;
  note: string;
  createdAt: Date;
  createdBy: string;
}

/** 필요한 만큼만 쓰는 DB 모양(시험에서 가짜로 바꿀 수 있게). 실제 값은 prisma 클라이언트 */
export interface SettingsDb {
  factoryProjectToolSetting: {
    findUnique(args: { where: { appSlug: string } }): Promise<Row | null>;
    findMany(args: { where: { appSlug: { in: string[] } } }): Promise<Row[]>;
    upsert(args: { where: { appSlug: string }; create: Omit<Row, "updatedAt">; update: { version: number; settings: string; updatedBy: string; updatedAt: Date } }): Promise<unknown>;
  };
  factoryProjectToolSettingHistory: {
    findMany(args: { where: { appSlug: string }; orderBy: { version: "desc" }; take: number }): Promise<HistoryRow[]>;
    findFirst(args: { where: { appSlug: string; version: number } }): Promise<HistoryRow | null>;
    create(args: { data: Omit<HistoryRow, "createdAt"> }): Promise<unknown>;
    deleteMany(args: { where: { appSlug: string; version: { lte: number } } }): Promise<unknown>;
  };
}

const toRecord = (r: Row): ProjectSettingsRecord | null => {
  const settings = readStoredSettings(r.settings);

  return settings ? { appSlug: r.appSlug, version: r.version, settings, updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedBy } : null;
};

export async function getProjectToolSettings(db: SettingsDb, appSlug: string): Promise<ProjectSettingsRecord | null> {
  if (!SLUG_RE.test(appSlug)) return null;
  const row = await db.factoryProjectToolSetting.findUnique({ where: { appSlug } });

  return row ? toRecord(row) : null;
}

/** 최근 이력(최신이 위). 각 항목에 바로 앞 버전과 달라진 묶음 이름을 붙인다 */
export async function getProjectToolSettingsHistory(db: SettingsDb, appSlug: string, limit = HISTORY_LIMIT): Promise<ProjectSettingsHistoryItem[]> {
  if (!SLUG_RE.test(appSlug)) return [];
  const rows = await db.factoryProjectToolSettingHistory.findMany({ where: { appSlug }, orderBy: { version: "desc" }, take: limit + 1 });

  return rows.slice(0, limit).map((r, i) => {
    const prev = rows[i + 1];
    const cur = readStoredSettings(r.settings);

    return {
      version: r.version,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy,
      changed: prev ? changedGroups(readStoredSettings(prev.settings), cur) : changedGroups(null, cur),
      empty: isEmptySettings(cur),
    };
  });
}

export type SaveResult = { ok: true; record: ProjectSettingsRecord; unchanged: boolean; message: string } | { ok: false; errors: string[]; status: number };

/** 저장 직전 추가 검사(예: 도구 설명서의 한계). 어긋난 이유 목록을 돌려주고, 비어 있지 않으면 저장하지 않는다 */
export type SettingsGuard = (settings: ProjectToolSettings) => Promise<string[]> | string[];

async function writeVersion(db: SettingsDb, appSlug: string, settings: ProjectToolSettings, who: string, note: string, guard?: SettingsGuard): Promise<SaveResult> {
  const violations = guard ? await guard(settings) : [];

  if (violations.length) return { ok: false, errors: violations, status: 400 };
  const cur = await db.factoryProjectToolSetting.findUnique({ where: { appSlug } });
  const curSettings = cur ? readStoredSettings(cur.settings) : null;

  if (cur && curSettings && JSON.stringify(curSettings) === JSON.stringify(settings)) {
    const record = toRecord(cur);

    return record ? { ok: true, record, unchanged: true, message: "바뀐 것이 없어서 저장하지 않았어요." } : { ok: false, errors: ["저장된 값을 읽지 못했어요."], status: 500 };
  }
  const version = (cur?.version ?? 0) + 1;
  const text = JSON.stringify(settings);
  const by = who.slice(0, 80);

  await db.factoryProjectToolSetting.upsert({ where: { appSlug }, create: { appSlug, version, settings: text, updatedBy: by }, update: { version, settings: text, updatedBy: by, updatedAt: new Date() } });
  await db.factoryProjectToolSettingHistory.create({ data: { appSlug, version, settings: text, note: note.slice(0, 120), createdBy: by } });
  if (version > HISTORY_KEEP) await db.factoryProjectToolSettingHistory.deleteMany({ where: { appSlug, version: { lte: version - HISTORY_KEEP } } });

  return {
    ok: true,
    unchanged: false,
    record: { appSlug, version, settings, updatedAt: new Date().toISOString(), updatedBy: by },
    message: `${appSlug} 의 도구 설정을 저장했어요(버전 ${version}). 새로 시작하는 일감부터 적용돼요.`,
  };
}

/** 저장: 스키마 검증을 통과해야 한다(통과 못 하면 오류 목록). 같은 값이면 버전을 올리지 않는다 */
export async function saveProjectToolSettings(db: SettingsDb, appSlug: string, raw: unknown, who: string, note = "저장", guard?: SettingsGuard): Promise<SaveResult> {
  if (!SLUG_RE.test(appSlug)) return { ok: false, errors: ["appSlug 형식이 올바르지 않아요."], status: 400 };
  const cleaned = cleanProjectSettings(raw);

  if (cleaned.ok === false) return { ok: false, errors: cleaned.errors, status: 400 };

  return writeVersion(db, appSlug, cleaned.settings, who, note, guard);
}

/** 일부만 바꾸기: 지금 저장된 설정(없으면 빈 설정)의 묶음별로 patch 의 항목만 덮어쓴다. 나머지 값은 그대로. 이미 저장된 프로젝트만(정비·감독 프로그램용) */
export async function patchProjectToolSettings(db: SettingsDb, appSlug: string, patch: unknown, who: string, note = "일부 수정", guard?: SettingsGuard): Promise<SaveResult> {
  if (!SLUG_RE.test(appSlug)) return { ok: false, errors: ["appSlug 형식이 올바르지 않아요."], status: 400 };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, errors: ["patch 는 묶음별 객체여야 해요."], status: 400 };
  const cur = await db.factoryProjectToolSetting.findUnique({ where: { appSlug } });
  const base = cur ? readStoredSettings(cur.settings) : null;

  if (!base) return { ok: false, errors: ["저장된 설정이 없어요."], status: 404 };
  const next: Record<string, unknown> = { ...base };

  for (const [group, value] of Object.entries(patch as Record<string, unknown>)) {
    const old = next[group];

    next[group] = value && typeof value === "object" && !Array.isArray(value) && old && typeof old === "object" && !Array.isArray(old) ? { ...(old as object), ...value } : value;
  }
  const cleaned = cleanProjectSettings(next);

  if (cleaned.ok === false) return { ok: false, errors: cleaned.errors, status: 400 };

  return writeVersion(db, appSlug, cleaned.settings, who, note, guard);
}

/** 되돌리기:이력의 옛 버전 내용을 '새 버전'으로 다시 저장한다(이력은 지우지 않는다) */
export async function revertProjectToolSettings(db: SettingsDb, appSlug: string, version: unknown, who: string, guard?: SettingsGuard): Promise<SaveResult> {
  if (!SLUG_RE.test(appSlug)) return { ok: false, errors: ["appSlug 형식이 올바르지 않아요."], status: 400 };
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return { ok: false, errors: ["되돌릴 버전 번호를 확인해 주세요."], status: 400 };
  const row = await db.factoryProjectToolSettingHistory.findFirst({ where: { appSlug, version } });
  const settings = row ? readStoredSettings(row.settings) : null;

  if (!row || !settings) return { ok: false, errors: ["그 버전은 이력에 없어요(오래된 이력은 지워져요)."], status: 404 };

  return writeVersion(db, appSlug, settings, who, `되돌리기: 버전 ${version}`, guard);
}

/** 감독 프로그램에 같이 내려 줄 설정: appSlug → { version, settings }. 비어 있거나 없는 프로젝트는 넣지 않는다 */
export async function projectSettingsForNext(db: SettingsDb, appSlugs: readonly string[]): Promise<Map<string, { version: number; settings: ProjectToolSettings }>> {
  const out = new Map<string, { version: number; settings: ProjectToolSettings }>();
  const slugs = [...new Set(appSlugs.filter((s) => SLUG_RE.test(s)))];

  if (!slugs.length) return out;
  for (const row of await db.factoryProjectToolSetting.findMany({ where: { appSlug: { in: slugs } } })) {
    const rec = toRecord(row);

    if (rec && !isEmptySettings(rec.settings)) out.set(row.appSlug, { version: rec.version, settings: rec.settings });
  }

  return out;
}
