// lib/factory/projectToolSettings.ts
// 프로젝트(= 공장 앱 appSlug)별 도구 설정(pixel-art 의 settings 인자로 읽는 JSON)의 형식·검증·변경 요약. DB 없음(저장은 projectToolSettingsDb.ts).
// - 형식은 툴킷 스키마(projectToolSettingsSchema.ts 의 사본)와 같다. 홈페이지는 그 스키마로 검증하고, 툴킷 스키마와 사본이 다르면 경고만 한다.
// - 적용 우선순위: 요청에 적은 말 > 프로젝트 설정 > 도구 기본값. 설정이 비어 있으면(저장 안 함) 도구 기본값.
import { PROJECT_SETTINGS_SCHEMA } from "@/lib/factory/projectToolSettingsSchema";

export const MAX_SETTINGS_BYTES = 16 * 1024;
export const MAX_APPROVED_REFS = 50;
export const MAX_ALIAS_SUBJECTS = 50;
export const MAX_ALIASES_PER_SUBJECT = 20;
export const MAX_ALIAS_LENGTH = 60;
export const HISTORY_LIMIT = 10;
export const PROJECT_SETTINGS_FILE = ".factory/project-settings.json";

export const RESULT_KINDS = ["image-prop", "image-scene", "motion-game", "motion-clip"] as const;
export type ResultKind = (typeof RESULT_KINDS)[number];
export const RESULT_KIND_LABELS: Record<ResultKind, string> = { "image-prop": "소품·캐릭터", "image-scene": "장면", "motion-game": "게임 애니메이션", "motion-clip": "움짤" };
export const METHODS = ["codex", "pixellab", "claude", "manual"] as const;
export type MethodId = (typeof METHODS)[number];
export const METHOD_LABELS: Record<MethodId, string> = { codex: "Codex", pixellab: "PixelLab", claude: "Claude", manual: "직접(수동)" };

/** 편집 화면의 묶음(= 스키마의 최상위 항목) */
export const SETTING_GROUPS = [
  { key: "methods", label: "방식" },
  { key: "results", label: "결과" },
  { key: "spec", label: "규격" },
  { key: "style", label: "스타일" },
  { key: "motion", label: "모션" },
  { key: "cost", label: "비용" },
  { key: "references", label: "참고 그림" },
  { key: "aliases", label: "대상 별칭" },
] as const;

export type ProjectToolSettings = Record<string, unknown>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

type Schema = Record<string, unknown>;

function resolveRef(root: Schema, ref: string): Schema | null {
  if (!ref.startsWith("#/")) return null;
  let cur: unknown = root;

  for (const part of ref.slice(2).split("/")) {
    if (!isRecord(cur) || !Object.hasOwn(cur, part)) return null;
    cur = cur[part];
  }

  return isRecord(cur) ? cur : null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** JSON 스키마(이 스키마가 쓰는 키워드만: type·const·enum·properties·additionalProperties·required·items·uniqueItems·minimum·maximum·maxLength·pattern·$ref)로 검증. 오류 문장 목록(비면 통과) */
export function validateAgainstSchema(root: Schema, schema: Schema, value: unknown, at = "", errors: string[] = []): string[] {
  if (errors.length >= 20) return errors;
  const where = at || "설정";

  if (typeof schema.$ref === "string") {
    const target = resolveRef(root, schema.$ref);

    if (!target) {
      errors.push(`${where}: 스키마 참조를 찾지 못했어요.`);
      return errors;
    }

    return validateAgainstSchema(root, target, value, at, errors);
  }
  if (Object.hasOwn(schema, "const") && !same(schema.const, value)) {
    errors.push(`${where}: ${JSON.stringify(schema.const)} 이어야 해요.`);
    return errors;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => same(e, value))) {
    errors.push(`${where}: ${schema.enum.join(" | ")} 중 하나여야 해요.`);
    return errors;
  }
  const type = schema.type;

  if (type === "string") {
    if (typeof value !== "string") errors.push(`${where}: 글자여야 해요.`);
    else {
      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${where}: ${schema.maxLength}자 이하여야 해요.`);
      if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) errors.push(`${where}: 형식이 올바르지 않아요.`);
    }
  } else if (type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) errors.push(`${where}: 정수여야 해요.`);
    else {
      if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${where}: ${schema.minimum} 이상이어야 해요.`);
      if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${where}: ${schema.maximum} 이하여야 해요.`);
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) errors.push(`${where}: 목록이어야 해요.`);
    else {
      if (schema.uniqueItems === true && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errors.push(`${where}: 같은 값이 두 번 있어요.`);
      if (isRecord(schema.items)) value.forEach((v, i) => validateAgainstSchema(root, schema.items as Schema, v, `${at}[${i}]`, errors));
    }
  } else if (type === "object") {
    if (!isRecord(value)) errors.push(`${where}: 묶음(객체)이어야 해요.`);
    else {
      const props = isRecord(schema.properties) ? schema.properties : {};

      for (const req of Array.isArray(schema.required) ? schema.required : []) {
        if (typeof req === "string" && !Object.hasOwn(value, req)) errors.push(`${at ? `${at}.` : ""}${req}: 꼭 필요해요.`);
      }
      for (const [k, v] of Object.entries(value)) {
        const sub = Object.hasOwn(props, k) ? props[k] : undefined;
        const path = at ? `${at}.${k}` : k;

        if (isRecord(sub)) validateAgainstSchema(root, sub, v, path, errors);
        else if (schema.additionalProperties === false) errors.push(`${path}: 모르는 항목이에요.`);
        else if (isRecord(schema.additionalProperties)) validateAgainstSchema(root, schema.additionalProperties, v, path, errors);
      }
    }
  }

  return errors;
}

export type CleanSettingsResult = { ok: true; settings: ProjectToolSettings } | { ok: false; errors: string[] };

/**
 * 편집 화면·가져오기에서 받은 값 → 저장할 설정. 스키마 검증 + 스키마가 못 잡는 연결 검사(기본 ∈ 허용, 별칭 길이 등).
 * 비어 있는 묶음({})·빈 문자열은 버리고, $schema 는 빼고 version 은 1 로 맞춘다. 전부 비면 { version: 1 } (= 도구 기본값)
 */
export function cleanProjectSettings(raw: unknown): CleanSettingsResult {
  if (!isRecord(raw)) return { ok: false, errors: ["설정은 묶음(객체)이어야 해요."] };
  const pruned = prune(raw) as Record<string, unknown>;

  delete pruned.$schema;
  pruned.version = 1;
  const errors = validateAgainstSchema(PROJECT_SETTINGS_SCHEMA, PROJECT_SETTINGS_SCHEMA, pruned);

  if (errors.length) return { ok: false, errors };
  const extra = crossChecks(pruned);

  if (extra.length) return { ok: false, errors: extra };
  const text = JSON.stringify(pruned);

  if (new TextEncoder().encode(text).length > MAX_SETTINGS_BYTES) return { ok: false, errors: [`설정이 너무 커요(${MAX_SETTINGS_BYTES / 1024}KB 이하).`] };

  return { ok: true, settings: canonical(pruned) as ProjectToolSettings };
}

/** 객체 키를 정렬(version 이 맨 앞)해서 같은 내용이면 같은 글자가 되게 한다. 값 비교·이력 비교에 쓴다 */
function canonical(v: unknown, top = true): unknown {
  if (Array.isArray(v)) return v.map((x) => canonical(x, false));
  if (!isRecord(v)) return v;
  const keys = Object.keys(v).sort((a, b) => (top && a === "version" ? -1 : top && b === "version" ? 1 : a < b ? -1 : a > b ? 1 : 0));

  return Object.fromEntries(keys.map((k) => [k, canonical(v[k], false)]));
}

/** 빈 문자열·빈 목록·빈 묶음을 지운다(빈 칸 = 도구 기본값). approved 는 빈 목록도 남기지 않는다 */
function prune(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(prune).filter((x) => x !== undefined && x !== "");
  if (isRecord(v)) {
    const out: Record<string, unknown> = {};

    for (const [k, x] of Object.entries(v)) {
      const p = prune(x);

      if (p === undefined || p === "" || (isRecord(p) && !Object.keys(p).length)) continue;
      if (Array.isArray(p) && !p.length) continue;
      out[k] = p;
    }

    return out;
  }

  return v;
}

function crossChecks(s: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const methods = isRecord(s.methods) ? s.methods : {};

  for (const [kind, m] of Object.entries(methods)) {
    if (!isRecord(m)) continue;
    const allowed = Array.isArray(m.allowed) ? (m.allowed as string[]) : null;

    if (allowed && m.default !== undefined && !allowed.includes(m.default as string)) errors.push(`methods.${kind}: 기본 방식이 허용 방식 안에 있어야 해요.`);
  }
  const results = isRecord(s.results) ? s.results : {};
  const kinds = Array.isArray(results.allowed_kinds) ? (results.allowed_kinds as string[]) : null;

  if (kinds && results.default_kind !== undefined && !kinds.includes(results.default_kind as string)) errors.push("results: 기본 종류가 허용 종류 안에 있어야 해요.");
  const refs = isRecord(s.references) ? s.references : {};

  if (Array.isArray(refs.approved) && refs.approved.length > MAX_APPROVED_REFS) errors.push(`references.approved: ${MAX_APPROVED_REFS}개까지예요.`);
  for (const a of Array.isArray(refs.approved) ? refs.approved : []) {
    const p = isRecord(a) && typeof a.path === "string" ? a.path : "";

    if (!p || p.length > 300 || /[\u0000-\u001f]/.test(p)) errors.push("references.approved: 경로는 1~300자 한 줄이어야 해요.");
  }
  const aliases = isRecord(s.aliases) ? s.aliases : {};

  if (Object.keys(aliases).length > MAX_ALIAS_SUBJECTS) errors.push(`aliases: 대상은 ${MAX_ALIAS_SUBJECTS}개까지예요.`);
  for (const [name, list] of Object.entries(aliases)) {
    const label = `aliases.${name.slice(0, 20)}`;

    if (name.length > MAX_ALIAS_LENGTH || /[\u0000-\u001f]/.test(name)) errors.push(`${label}: 이름은 한 줄 ${MAX_ALIAS_LENGTH}자 이하예요.`);
    if (Array.isArray(list)) {
      if (list.length > MAX_ALIASES_PER_SUBJECT) errors.push(`${label}: 별칭은 ${MAX_ALIASES_PER_SUBJECT}개까지예요.`);
      if (list.some((x) => typeof x !== "string" || !x.trim() || x.length > MAX_ALIAS_LENGTH || /[\u0000-\u001f]/.test(x))) errors.push(`${label}: 별칭은 한 줄 ${MAX_ALIAS_LENGTH}자 이하 글자예요.`);
    }
  }

  return errors;
}

/** 설정이 비었나(= 도구 기본값). version 만 있으면 비었다 */
export const isEmptySettings = (s: unknown) => !isRecord(s) || Object.keys(s).every((k) => k === "version" || k === "$schema");

/** 두 설정에서 달라진 묶음 이름 목록(이력에 한 줄로 보여 줄 때). 순서는 SETTING_GROUPS */
export function changedGroups(prev: unknown, next: unknown): string[] {
  const a = isRecord(prev) ? prev : {};
  const b = isRecord(next) ? next : {};

  return SETTING_GROUPS.filter((g) => !same(a[g.key], b[g.key])).map((g) => g.label);
}

/** 저장된 문자열 → 설정. 이상하면 null (읽기용이라 다시 검증해 통과한 것만) */
export function readStoredSettings(text: string | null | undefined): ProjectToolSettings | null {
  if (!text) return null;
  try {
    const r = cleanProjectSettings(JSON.parse(text));

    return r.ok ? r.settings : null;
  } catch {
    return null;
  }
}

/** 툴킷 스키마 지문(보고)과 이 사본의 지문 비교 → 경고 문장(같거나 보고가 없으면 null). 경고만 하고 저장은 막지 않는다 */
export function schemaWarning(reported: string | null | undefined, ours: string): string | null {
  if (!reported) return null;

  return reported === ours ? null : "툴킷의 설정 형식(스키마)이 홈페이지에 있는 사본과 달라요. 저장은 되지만 툴킷이 거절하는 항목이 있을 수 있어요. 홈페이지 사본을 툴킷에 맞춰 갱신해야 해요.";
}
