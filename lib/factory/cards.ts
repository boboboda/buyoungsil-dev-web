// lib/factory/cards.ts
// 결과물 카드(2-2)의 형식·검사·설정 만들기. 순수 함수·상수만 둔다(prisma 없음, 저장은 cardsDb.ts).
// - 카드 = 프로젝트 안의 이름 붙은 "이런 결과물을 이렇게 만든다": 도구·방법·옵션(설명서 입력 항목)·참고 규칙·카드가 갖는 설정 묶음.
// - 일감이 카드를 부르면 compileCardSettings 가 카드 → pixel-art 프로젝트 설정(JSON)으로 합쳐서 감독 프로그램에 내려 준다(.factory/project-settings.json).
// - 키는 저장하지 않는다. 방법에 필요한 키는 도구 설명서(toolManifest.ts methodSecrets)에서 그때그때 정한다.
// - 저장할 때 설명서의 한계(크기·프레임 수)를 검사한다(validateCard).
import { cleanProjectSettings, RESULT_KINDS, RESULT_KIND_LABELS, type ProjectToolSettings } from "@/lib/factory/projectToolSettings";
import { checkSettingsLimits, checkValues, methodSecrets, type ManifestInput, type ManifestMethod, type NumRange, type ToolManifestEntry } from "@/lib/factory/toolManifest";

export const CARD_SOURCES = ["통제실", "채팅", "정비"] as const;
export type CardSource = (typeof CARD_SOURCES)[number];
export const DEFAULT_CARD_NAME = "기본 카드";
export const MAX_CARDS_PER_APP = 30;
export const MAX_CARD_NAME = 40;
export const MAX_CARD_DESCRIPTION = 300;
export const CARD_HISTORY_LIMIT = 10;
export const CARD_HISTORY_KEEP = 40;
export const CARD_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const DEFAULT_TOOL = "pixel-art";
export const MAX_REFS = 4; // 툴킷 REFS_MAX(arts.ts 와 같다)

const TOOL_RE = /^[a-z][a-z0-9_.-]{0,39}$/;
const METHOD_RE = /^[a-z][a-z0-9_]{0,39}$/;

export type OptionValue = string | number;
export type CardOptions = Record<string, OptionValue>;

export interface RefRules {
  pinDefault: boolean; // 기본 그림을 1순위로 고정
  defaultArtId: string | null; // 기본 그림(승인된 그림 id)
  sameSubject: boolean; // 같은 대상의 승인 그림 참고(②)
  sameKind: boolean; // 같은 종류의 승인 그림 참고(③)
  maxRefs: number | null; // 참고 그림 최대 장 수(고정 그림 포함, 0~4). null = 설정 값을 따른다
}

export const DEFAULT_REF_RULES: RefRules = { pinDefault: false, defaultArtId: null, sameSubject: true, sameKind: true, maxRefs: null };

/** 카드 내용(저장·이력·화면 공통). settings 는 카드가 직접 갖는 설정 묶음(없으면 null) */
export interface CardData {
  name: string;
  description: string;
  tool: string;
  method: string;
  options: CardOptions;
  refRules: RefRules;
  settings: ProjectToolSettings | null;
  enabled: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneLine = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

// ───────── 입력칸(설명서에서 자동으로 생긴다) ─────────

export interface CardField {
  name: string;
  label: string;
  type: "string" | "int";
  choices?: { value: string | number; label: string }[];
  range?: { min?: number; max?: number };
  description: string;
  source: "input" | "limit"; // input = 설명서의 입력 항목, limit = 방법의 한계에서 만든 칸(크기)
}

/** 일감마다 바뀌는 값이라 카드 옵션으로 두지 않는 설명서 입력 항목 */
const RUNTIME_INPUTS = new Set(["subject", "prompt", "project", "refs", "settings", "input", "output_dir", "method"]);
const BACKGROUND_CHOICES = [
  { value: "transparent", label: "투명" },
  { value: "scene", label: "있음" },
];
const KIND_LABEL = (v: string | number) => (Object.hasOwn(RESULT_KIND_LABELS, String(v)) ? RESULT_KIND_LABELS[v as keyof typeof RESULT_KIND_LABELS] : String(v));

function rangeOf(r: NumRange | undefined): { min?: number; max?: number } | undefined {
  if (!r) return undefined;
  const out: { min?: number; max?: number } = {};

  if (r.min !== undefined) out.min = r.min;
  if (r.max !== undefined) out.max = r.max;

  return Object.keys(out).length ? out : undefined;
}

function fieldFromInput(i: ManifestInput, m: ManifestMethod | undefined): CardField {
  const field: CardField = { name: i.name, label: i.label || i.name, type: i.type === "int" ? "int" : "string", description: i.description, source: "input" };

  if (i.choices?.length) field.choices = i.choices.map((c) => ({ value: c, label: i.name === "kind" ? KIND_LABEL(c) : String(c) }));
  if (i.range) field.range = i.range;
  // 프레임 수는 방법마다 범위가 다르다(설명서 한계)
  if (i.name === "frames" && m?.limits.frames) field.range = rangeOf({ min: m.limits.frames.min, max: m.limits.frames.max });

  return field;
}

/** 설명서가 없을 때(감독이 아직 보고 전) 쓰는 기본 입력칸 */
const FALLBACK_FIELDS: CardField[] = [
  { name: "kind", label: "결과 종류", type: "string", choices: RESULT_KINDS.map((k) => ({ value: k, label: RESULT_KIND_LABELS[k] })), description: "만들 결과물 종류", source: "input" },
  { name: "frames", label: "프레임 수", type: "int", range: { min: 2, max: 64 }, description: "motion 종류에서 쓰는 프레임 수", source: "input" },
  { name: "preset", label: "모션 프리셋", type: "string", choices: ["walk", "idle", "bounce", "sway"].map((v) => ({ value: v, label: v })), description: "motion-game 용", source: "input" },
];

/** 도구 + 방법을 고르면 나오는 입력칸. 설명서가 없으면 기본 칸 */
export function cardFields(manifest: ToolManifestEntry | null | undefined, methodId: string): CardField[] {
  const method = manifest?.methods.find((m) => m.id.toLowerCase() === methodId.toLowerCase());
  const fields = manifest ? manifest.inputs.filter((i) => !RUNTIME_INPUTS.has(i.name)).map((i) => fieldFromInput(i, method)) : [...FALLBACK_FIELDS];
  const size = method?.limits.size;

  if (!manifest || method?.limits.size || !method) {
    const f: CardField = { name: "size", label: "크기(한 변 px)", type: "int", description: size?.note || "도트 칸 크기(settings.spec.cell_size)", source: "limit" };

    if (size?.allowed?.length) f.choices = size.allowed.map((v) => ({ value: v, label: `${v}px` }));
    else if (size) f.range = rangeOf(size) ?? { min: 8, max: 256 };
    else f.range = { min: 8, max: 256 };
    fields.push(f);
  }
  fields.push({ name: "background", label: "배경", type: "string", choices: BACKGROUND_CHOICES, description: "그림 배경(스타일 메모로 전달돼요)", source: "limit" });

  return fields;
}

// ───────── 검사·정리 ─────────

export function cleanRefRules(raw: unknown): { ok: true; rules: RefRules } | { ok: false; errors: string[] } {
  const o = isRecord(raw) ? raw : {};
  const errors: string[] = [];
  const bool = (k: string, def: boolean) => {
    if (o[k] === undefined || o[k] === null) return def;
    if (typeof o[k] !== "boolean") errors.push(`참고 규칙 ${k}: true/false 여야 해요.`);

    return o[k] === true;
  };
  const rules: RefRules = { ...DEFAULT_REF_RULES };

  rules.pinDefault = bool("pinDefault", false);
  rules.sameSubject = bool("sameSubject", true);
  rules.sameKind = bool("sameKind", true);
  if (o.defaultArtId !== undefined && o.defaultArtId !== null && o.defaultArtId !== "") {
    if (typeof o.defaultArtId !== "string" || !CARD_ID_RE.test(o.defaultArtId)) errors.push("참고 규칙 defaultArtId: 그림 id 형식이 아니에요.");
    else rules.defaultArtId = o.defaultArtId;
  }
  if (o.maxRefs !== undefined && o.maxRefs !== null && o.maxRefs !== "") {
    if (typeof o.maxRefs !== "number" || !Number.isInteger(o.maxRefs) || o.maxRefs < 0 || o.maxRefs > MAX_REFS) errors.push(`참고 규칙 maxRefs: 0~${MAX_REFS} 정수여야 해요.`);
    else rules.maxRefs = o.maxRefs;
  }

  return errors.length ? { ok: false, errors } : { ok: true, rules };
}

/** 옵션 정리: 설명서 입력칸에 있는 이름만, 형식·선택지·범위를 맞춰서. 빈 값은 버린다 */
export function cleanOptions(raw: unknown, fields: readonly CardField[]): { ok: true; options: CardOptions } | { ok: false; errors: string[] } {
  if (raw === undefined || raw === null) return { ok: true, options: {} };
  if (!isRecord(raw)) return { ok: false, errors: ["옵션은 { 이름: 값 } 묶음이어야 해요."] };
  const errors: string[] = [];
  const options: CardOptions = {};

  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined || value === null || value === "") continue;
    const f = fields.find((x) => x.name === name);

    if (!f) {
      errors.push(`옵션 ${name.slice(0, 30)}: 이 도구·방법의 입력 항목에 없어요(쓸 수 있는 항목: ${fields.map((x) => x.name).join(", ")}).`);
      continue;
    }
    if (f.type === "int") {
      const n = typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : value;

      if (typeof n !== "number" || !Number.isSafeInteger(n)) errors.push(`옵션 ${f.label}: 정수여야 해요.`);
      else if (f.choices && !f.choices.some((c) => c.value === n)) errors.push(`옵션 ${f.label}: ${f.choices.map((c) => c.value).join("·")} 중 하나여야 해요.`);
      else if (f.range?.min !== undefined && n < f.range.min) errors.push(`옵션 ${f.label}: ${f.range.min} 이상이어야 해요.`);
      else if (f.range?.max !== undefined && n > f.range.max) errors.push(`옵션 ${f.label}: ${f.range.max} 이하여야 해요.`);
      else options[name] = n;
    } else if (typeof value !== "string" || /[\u0000-\u001f]/.test(value) || value.length > 200) errors.push(`옵션 ${f.label}: 한 줄 200자 이하 글자여야 해요.`);
    else if (f.choices && !f.choices.some((c) => String(c.value) === value)) errors.push(`옵션 ${f.label}: ${f.choices.map((c) => c.value).join(" | ")} 중 하나여야 해요.`);
    else options[name] = value;
  }

  return errors.length ? { ok: false, errors } : { ok: true, options };
}

export type CardInput = Partial<Omit<CardData, "settings">> & { settings?: unknown };

export type CardCheck = { ok: true; data: CardData; secrets: string[] } | { ok: false; errors: string[] };

/**
 * 저장 전 검사: 입력 → 정리된 카드. base 가 있으면 보내지 않은 칸은 base 값을 쓴다(일부 수정).
 * tools 는 도구 설명서(비어 있으면 설명서 검사는 건너뛴다). 설명서가 있으면 도구·방법 이름, 옵션 형식, 한계(크기·프레임 수)를 검사한다.
 */
export function validateCard(input: CardInput, tools: Record<string, ToolManifestEntry>, base?: CardData | null): CardCheck {
  const errors: string[] = [];
  const pick = <K extends keyof CardInput>(k: K) => (input[k] !== undefined ? input[k] : undefined);
  const name = oneLine(pick("name") ?? base?.name ?? "", MAX_CARD_NAME);
  const description = oneLine(pick("description") ?? base?.description ?? "", MAX_CARD_DESCRIPTION);
  const tool = String(pick("tool") ?? base?.tool ?? DEFAULT_TOOL).trim();
  const method = String(pick("method") ?? base?.method ?? "").trim();
  const enabled = input.enabled === undefined ? (base?.enabled ?? true) : input.enabled === true;

  if (!name) errors.push("카드 이름이 필요해요(한국어 40자 이하).");
  if (!TOOL_RE.test(tool)) errors.push("도구 이름 형식이 올바르지 않아요.");
  const hasTools = Object.keys(tools).length > 0;
  const manifest = tools[tool] ?? null;

  if (hasTools && !manifest && TOOL_RE.test(tool)) errors.push(`도구 설명서에 없는 도구예요: ${tool}. 쓸 수 있는 도구: ${Object.keys(tools).join(", ")}`);
  if (!hasTools && tool !== DEFAULT_TOOL) errors.push(`도구 설명서가 아직 없어서 ${DEFAULT_TOOL} 만 쓸 수 있어요.`);
  if (method) {
    if (!METHOD_RE.test(method)) errors.push("방법 이름 형식이 올바르지 않아요.");
    else if (manifest && !manifest.methods.some((m) => m.id.toLowerCase() === method.toLowerCase())) errors.push(`${manifest.label}에 없는 방법이에요: ${method}. 쓸 수 있는 방법: ${manifest.methods.map((m) => m.id).join(", ")}`);
  }
  const fields = cardFields(manifest, method);
  const opts = cleanOptions(input.options !== undefined ? input.options : base?.options, fields);

  if (opts.ok === false) errors.push(...opts.errors);
  const rules = cleanRefRules(input.refRules !== undefined ? input.refRules : base?.refRules);

  if (rules.ok === false) errors.push(...rules.errors);
  let settings: ProjectToolSettings | null = base?.settings ?? null;

  if (input.settings !== undefined) {
    if (input.settings === null || input.settings === "" || (isRecord(input.settings) && !Object.keys(input.settings).length)) settings = null;
    else {
      const cleaned = cleanProjectSettings(input.settings);

      if (cleaned.ok === false) errors.push(...cleaned.errors.map((e) => `설정 묶음: ${e}`));
      else settings = Object.keys(cleaned.settings).some((k) => k !== "version") ? cleaned.settings : null;
    }
  }
  if (errors.length || opts.ok === false || rules.ok === false) return { ok: false, errors: [...new Set(errors)].slice(0, 12) };
  const data: CardData = { name, description, tool, method, options: opts.options, refRules: rules.rules, settings, enabled };

  // 설명서의 한계: 옵션의 크기·프레임 수는 방법의 한계로, 카드가 갖는 설정 묶음은 결과 종류별 기본 방식의 한계로
  if (manifest && method) {
    const size = typeof data.options.size === "number" ? data.options.size : undefined;
    const frames = typeof data.options.frames === "number" ? data.options.frames : undefined;

    errors.push(...checkValues(manifest, method, { size, frames }));
  }
  if (manifest) {
    const compiled = compileCardSettings({ ...data, options: typeof data.options.kind === "string" ? { kind: data.options.kind } : {} });

    if (compiled.ok === false) errors.push(...compiled.errors);
    else errors.push(...checkSettingsLimits(compiled.settings, tools, tool).map((e) => `카드 설정 묶음: ${e}`));
  } else {
    const compiled = compileCardSettings(data);

    if (compiled.ok === false) errors.push(...compiled.errors);
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)].slice(0, 12) };

  return { ok: true, data, secrets: manifest && method ? methodSecrets(manifest, method) : [] };
}

// ───────── 카드 → 프로젝트 설정 ─────────

const BACKGROUND_NOTE: Record<string, string> = { transparent: "배경: 투명", scene: "배경: 있음(환경 속 장면)" };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * 카드 → pixel-art 프로젝트 설정(JSON). 순서: 카드가 갖는 설정 묶음(바탕) → 방법(그 결과 종류의 허용·기본 방식) → 옵션(종류·크기·프레임·프리셋·배경) → 참고 규칙(auto_max).
 * 승인 그림 목록(references.approved)은 일감 시작 때 감독 프로그램이 합친다(참고 규칙의 sameSubject·sameKind 에 맞게). 결과는 cleanProjectSettings 를 통과해야 한다.
 */
export function compileCardSettings(card: Pick<CardData, "method" | "options" | "refRules" | "settings">): { ok: true; settings: ProjectToolSettings } | { ok: false; errors: string[] } {
  const s: Record<string, unknown> = card.settings ? clone(card.settings) : { version: 1 };
  const group = (k: string): Record<string, unknown> => (isRecord(s[k]) ? (s[k] as Record<string, unknown>) : (s[k] = {}) as Record<string, unknown>);
  const o = card.options;
  const kindOpt = typeof o.kind === "string" && (RESULT_KINDS as readonly string[]).includes(o.kind) ? o.kind : "";
  const baseResults = isRecord(s.results) ? s.results : {};
  const kind = kindOpt || (typeof baseResults.default_kind === "string" ? baseResults.default_kind : "image-prop");

  if (kindOpt) {
    const r = group("results");

    r.allowed_kinds = [kindOpt];
    r.default_kind = kindOpt;
  }
  if (card.method) {
    const m = group("methods");

    m[kind] = { allowed: [card.method], default: card.method };
  }
  if (typeof o.size === "number") group("spec").cell_size = o.size;
  if (typeof o.frames === "number") group("motion").frames = o.frames;
  if (typeof o.preset === "string" && o.preset) group("motion").preset = o.preset;
  if (typeof o.background === "string" && BACKGROUND_NOTE[o.background]) {
    const style = group("style");
    const note = BACKGROUND_NOTE[o.background];
    const before = typeof style.notes === "string" ? style.notes.trim() : "";

    style.notes = (before ? `${before.slice(0, 1000 - note.length - 2)}. ${note}` : note).slice(0, 1000);
  }
  const rules = card.refRules;

  if (rules.maxRefs !== null || !rules.sameSubject || !rules.sameKind || rules.pinDefault) {
    const refs = group("references");
    const total = rules.maxRefs ?? (typeof refs.auto_max === "number" ? refs.auto_max + (rules.pinDefault ? 1 : 0) : MAX_REFS);
    const pinned = rules.pinDefault && rules.defaultArtId ? 1 : 0;

    refs.auto_max = !rules.sameSubject && !rules.sameKind ? 0 : Math.max(0, Math.min(MAX_REFS, total - pinned));
  }
  const cleaned = cleanProjectSettings(s);

  return cleaned.ok === false ? { ok: false, errors: cleaned.errors.map((e) => `카드 설정: ${e}`) } : { ok: true, settings: cleaned.settings };
}

// ───────── 이력·화면 ─────────

export const CARD_FIELD_LABELS: Record<string, string> = {
  name: "이름",
  description: "설명",
  tool: "도구",
  method: "방법",
  options: "옵션",
  refRules: "참고 규칙",
  settings: "설정 묶음",
  enabled: "사용",
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 두 판 사이에 바뀐 칸의 이름 목록 */
export function changedCardFields(prev: Partial<CardData> | null, next: Partial<CardData>): string[] {
  return Object.keys(CARD_FIELD_LABELS)
    .filter((k) => !prev || !same((prev as Record<string, unknown>)[k], (next as Record<string, unknown>)[k]))
    .map((k) => CARD_FIELD_LABELS[k]);
}

/** 저장된 글자·JSON → 카드 내용(이상한 값은 안전한 기본값으로). 읽기용이라 한계 검사는 하지 않는다 */
export function readCardData(row: { name: string; description: string; tool: string; method: string; options: unknown; refRules: unknown; settings: string; enabled: boolean }): CardData {
  const options: CardOptions = {};

  if (isRecord(row.options)) for (const [k, v] of Object.entries(row.options)) if (typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) options[k] = v;
  const rules = cleanRefRules(row.refRules);
  let settings: ProjectToolSettings | null = null;

  if (row.settings) {
    try {
      const cleaned = cleanProjectSettings(JSON.parse(row.settings));

      if (cleaned.ok && Object.keys(cleaned.settings).some((k) => k !== "version")) settings = cleaned.settings;
    } catch {
      settings = null;
    }
  }

  return { name: row.name, description: row.description, tool: row.tool, method: row.method, options, refRules: rules.ok ? rules.rules : { ...DEFAULT_REF_RULES }, settings, enabled: row.enabled };
}

/** 이력에 넣는 카드 내용(JSON) */
export const cardSnapshot = (d: CardData) => ({ name: d.name, description: d.description, tool: d.tool, method: d.method, options: d.options, refRules: d.refRules, settings: d.settings, enabled: d.enabled });

/** 이력 snapshot → 카드 내용(없는 칸은 기본값). 이력은 이미 저장 때 검사를 통과한 값이다 */
export function readSnapshot(v: unknown): CardData | null {
  if (!isRecord(v) || typeof v.name !== "string") return null;

  return readCardData({
    name: v.name,
    description: typeof v.description === "string" ? v.description : "",
    tool: typeof v.tool === "string" ? v.tool : DEFAULT_TOOL,
    method: typeof v.method === "string" ? v.method : "",
    options: v.options,
    refRules: v.refRules,
    settings: isRecord(v.settings) ? JSON.stringify(v.settings) : typeof v.settings === "string" ? v.settings : "", // 마이그레이션이 옮긴 첫 판은 설정이 글자로 들어 있다
    enabled: v.enabled !== false,
  });
}

/** 카드를 일감·커넥터가 이름이나 id 로 부를 때의 참조 문자열 정리 */
export const cardRef = (v: unknown): string => (typeof v === "string" ? oneLine(v, MAX_CARD_NAME) : "");
