// lib/factory/toolManifest.ts
// 도구 설명서(game-toolkit/tools/manifests/<도구>.json) 보고의 검사·정리와, 설명서를 쓰는 규칙(키 자동 결정·한계 검사). 순수 함수·상수만 둔다(prisma 없음, 저장은 toolManifestDb.ts).
// - 감독 프로그램(도구 중계)이 툴킷에서 읽어 POST /api/factory/tool-manifests 로 보낸다. 시작할 때와 툴킷 커밋·설명서 내용이 바뀌었을 때.
//   설명서 파일이 없는 도구는 감독이 도구함 정보(tools.json)로 최소 설명서를 만들어 보낸다(source: "fallback").
// - 키는 이름만 받는다(대문자·숫자·_). 값은 받지도 저장하지도 않는다. 글은 길이를 줄이고 비밀번호 모양을 가린다.
import { maskSecrets } from "@/lib/factory/mask";

export const TOOL_MANIFESTS_KEY = "toolManifests";
export const MAX_MANIFEST_TOOLS = 40;
export const MAX_AUTO_SECRETS = 10; // enqueue_app_job 의 requiredSecrets 상한과 같다

const NAME_RE = /^[a-z][a-z0-9_.-]{0,39}$/;
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const SECRET_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const COMMIT_RE = /^[0-9a-f]{7,40}$/;

export type ManifestSource = "file" | "fallback";
export type NumRange = { min?: number; max?: number; allowed?: number[]; note?: string };

export interface ManifestLimits {
  size?: NumRange;
  maxImagesPerCall?: number;
  frames?: { min?: number; max?: number; evenOnly?: boolean; default?: number };
  maxCallsPerJob?: number | null;
  timeoutSec?: number;
}

export interface ManifestMethod {
  id: string;
  label: string;
  secrets: string[];
  network: boolean;
  limits: ManifestLimits;
  cost?: { unit: string; perCall?: number; note?: string };
  notes?: string;
}

export interface ManifestInput {
  name: string;
  label: string;
  type: "string" | "int" | "path";
  required: boolean;
  default?: string | number;
  range?: { min?: number; max?: number };
  choices?: (string | number)[];
  methods?: string[];
  description: string;
}

export interface ToolManifestEntry {
  name: string;
  label: string;
  description: string;
  layer: "studio" | "internal" | "";
  version: number;
  source: ManifestSource;
  methods: ManifestMethod[];
  inputs: ManifestInput[];
  outputs: { formats: string[]; files: string[]; resultFile: string; resultFields: string[] };
}

export interface ManifestReport {
  commit: string; // 툴킷 git 커밋(짧게). 읽지 못하면 ""
  reportedAt: string;
  tools: Record<string, ToolManifestEntry>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown, n: number): string => (typeof v === "string" ? maskSecrets(v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n)) : "");

const int = (v: unknown, lo = -1_000_000, hi = 1_000_000): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;

const strList = (v: unknown, n: number, max: number): string[] => (Array.isArray(v) ? v.map((x) => str(x, n)).filter(Boolean).slice(0, max) : []);

function cleanRange(v: unknown): NumRange | undefined {
  if (!isRecord(v)) return undefined;
  const out: NumRange = {};
  const min = int(v.min);
  const max = int(v.max);

  if (min !== undefined) out.min = min;
  if (max !== undefined) out.max = max;
  if (Array.isArray(v.allowed)) {
    const a = v.allowed.map((x) => int(x)).filter((x): x is number => x !== undefined).slice(0, 20);

    if (a.length) out.allowed = a;
  }
  const note = str(v.note, 300);

  if (note) out.note = note;

  return Object.keys(out).length ? out : undefined;
}

function cleanLimits(v: unknown): ManifestLimits {
  const out: ManifestLimits = {};

  if (!isRecord(v)) return out;
  const size = cleanRange(v.size);

  if (size) out.size = size;
  const images = int(v.maxImagesPerCall, 1, 1000);

  if (images !== undefined) out.maxImagesPerCall = images;
  if (isRecord(v.frames)) {
    const f: NonNullable<ManifestLimits["frames"]> = {};
    const min = int(v.frames.min);
    const max = int(v.frames.max);
    const def = int(v.frames.default);

    if (min !== undefined) f.min = min;
    if (max !== undefined) f.max = max;
    if (def !== undefined) f.default = def;
    if (v.frames.evenOnly === true) f.evenOnly = true;
    if (Object.keys(f).length) out.frames = f;
  }
  if (v.maxCallsPerJob === null) out.maxCallsPerJob = null;
  else {
    const calls = int(v.maxCallsPerJob, 1, 100000);

    if (calls !== undefined) out.maxCallsPerJob = calls;
  }
  const timeout = int(v.timeoutSec, 1, 86400);

  if (timeout !== undefined) out.timeoutSec = timeout;

  return out;
}

function cleanMethod(v: unknown): ManifestMethod | null {
  if (!isRecord(v) || typeof v.id !== "string" || !ID_RE.test(v.id)) return null;
  const secrets = Array.isArray(v.secrets) ? [...new Set(v.secrets.filter((s): s is string => typeof s === "string" && SECRET_RE.test(s)))].slice(0, 8) : [];
  const out: ManifestMethod = { id: v.id, label: str(v.label, 60) || v.id, secrets, network: v.network === true, limits: cleanLimits(v.limits) };

  if (isRecord(v.cost) && typeof v.cost.unit === "string" && v.cost.unit.trim()) {
    const perCall = int(v.cost.perCall, 0, 1_000_000);

    out.cost = { unit: str(v.cost.unit, 60), ...(perCall !== undefined ? { perCall } : {}), ...(str(v.cost.note, 400) ? { note: str(v.cost.note, 400) } : {}) };
  }
  const notes = str(v.notes, 400);

  if (notes) out.notes = notes;

  return out;
}

function cleanInput(v: unknown): ManifestInput | null {
  if (!isRecord(v) || typeof v.name !== "string" || !/^[a-z][a-z0-9_]{0,39}$/.test(v.name)) return null;
  const type = v.type === "int" || v.type === "path" ? v.type : "string";
  const out: ManifestInput = { name: v.name, label: str(v.label, 60) || v.name, type, required: v.required === true, description: str(v.description, 400) };

  if (typeof v.default === "string") out.default = str(v.default, 100);
  else if (typeof v.default === "number" && Number.isFinite(v.default)) out.default = v.default;
  if (isRecord(v.range)) {
    const min = int(v.range.min);
    const max = int(v.range.max);

    if (min !== undefined || max !== undefined) out.range = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  }
  if (Array.isArray(v.choices)) {
    const c = v.choices.filter((x): x is string | number => (typeof x === "string" && x.length <= 60) || (typeof x === "number" && Number.isFinite(x))).slice(0, 20);

    if (c.length) out.choices = c;
  }
  if (Array.isArray(v.methods)) out.methods = v.methods.filter((x): x is string => typeof x === "string" && ID_RE.test(x)).slice(0, 10);

  return out;
}

/** 설명서 한 개(보고의 tools 원소) → 정리된 항목. 이름·방법이 없으면 null */
export function cleanManifest(v: unknown): ToolManifestEntry | null {
  if (!isRecord(v) || typeof v.name !== "string" || !NAME_RE.test(v.name)) return null;
  const methods = (Array.isArray(v.methods) ? v.methods : []).map(cleanMethod).filter((m): m is ManifestMethod => m !== null);

  if (!methods.length) return null;
  const seen = new Set<string>();
  const uniqueMethods = methods.filter((m) => !seen.has(m.id) && !!seen.add(m.id)).slice(0, 10);
  const o = isRecord(v.outputs) ? v.outputs : {};

  return {
    name: v.name,
    label: str(v.label, 80) || v.name,
    description: str(v.description, 600),
    layer: v.layer === "studio" || v.layer === "internal" ? v.layer : "",
    version: int(v.version, 1, 1000) ?? 1,
    source: v.source === "fallback" ? "fallback" : "file",
    methods: uniqueMethods,
    inputs: (Array.isArray(v.inputs) ? v.inputs : []).map(cleanInput).filter((x): x is ManifestInput => x !== null).slice(0, 30),
    outputs: { formats: strList(o.formats, 40, 12), files: strList(o.files, 120, 12), resultFile: str(o.resultFile, 60), resultFields: strList(o.resultFields, 40, 30) },
  };
}

/** 감독 프로그램의 보고 본문 { commit, tools:[설명서…] } → 정리된 보고. 이름이 겹치면 앞의 것만. 하나도 못 읽으면 실패 */
export function validateManifestReport(body: unknown, now = new Date()): { ok: true; report: ManifestReport } | { ok: false; reason: string } {
  if (!isRecord(body) || !Array.isArray(body.tools)) return { ok: false, reason: "tools 목록이 필요해요." };
  const commit = typeof body.commit === "string" && COMMIT_RE.test(body.commit) ? body.commit.slice(0, 12) : "";
  const tools: Record<string, ToolManifestEntry> = {};

  for (const raw of body.tools.slice(0, MAX_MANIFEST_TOOLS)) {
    const m = cleanManifest(raw);

    if (m && !Object.hasOwn(tools, m.name)) tools[m.name] = m;
  }
  if (!Object.keys(tools).length && body.tools.length > 0) return { ok: false, reason: "읽을 수 있는 설명서가 없어요." };

  return { ok: true, report: { commit, reportedAt: now.toISOString(), tools } };
}

/** 저장된 글 → 보고. 이상하면 null */
export function parseStoredManifests(text: string | null | undefined): ManifestReport | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as unknown;

    if (!isRecord(raw) || !isRecord(raw.tools)) return null;
    const checked = validateManifestReport({ commit: raw.commit, tools: Object.values(raw.tools) }, new Date(typeof raw.reportedAt === "string" ? raw.reportedAt : 0));

    return checked.ok ? checked.report : null;
  } catch {
    return null;
  }
}

// ───────── 키 자동 결정 ─────────

/** 설명서에서 방법 → 필요한 키 이름. 방법 id 는 소문자로 비교한다 */
export function methodSecrets(manifest: ToolManifestEntry, methodId: string): string[] {
  const m = manifest.methods.find((x) => x.id.toLowerCase() === methodId.toLowerCase());

  return m ? m.secrets : [];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, word: string) => new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(word)}(?![A-Za-z0-9_-])`, "i").test(text);

/** 지시문이 도구를 어떤 방법으로 부르는지 짐작: 방법 이름(id·표시 이름)이 지시문에 나오고 그 방법이 키를 요구하면 그 키. 설명서가 file 인 도구만 본다(최소 설명서는 기존 규칙 그대로) */
export function autoSecretsForPlan(plan: string, tools: Record<string, ToolManifestEntry>, projectMethods: Record<string, string> = {}): { name: string; tool: string; method: string }[] {
  const out: { name: string; tool: string; method: string }[] = [];

  for (const t of Object.values(tools)) {
    if (t.source !== "file") continue;
    const toolNamed = mentions(plan, t.name);

    for (const m of t.methods) {
      if (!m.secrets.length) continue;
      const named = mentions(plan, m.id) || (m.label.length >= 4 && !/[ ()]/.test(m.label) && mentions(plan, m.label));
      const byProject = toolNamed && projectMethods[t.name]?.toLowerCase() === m.id.toLowerCase();

      if (named || byProject) for (const name of m.secrets) if (!out.some((x) => x.name === name)) out.push({ name, tool: t.name, method: m.id });
    }
  }

  return out;
}

// ───────── 한계 검사 ─────────

/** 값 하나를 한계에 맞춰 본다. 어긋나면 이유 문장 */
export function checkRange(label: string, value: number, r: NumRange | undefined, methodLabel: string): string | null {
  if (!r) return null;
  if (r.allowed?.length) return r.allowed.includes(value) ? null : `${label} ${value} 은(는) ${methodLabel} 이 받는 값(${r.allowed.join("·")})이 아니에요.`;
  if (r.max !== undefined && value > r.max) return `${label} ${value} > ${methodLabel} 최대 ${r.max}`;
  if (r.min !== undefined && value < r.min) return `${label} ${value} < ${methodLabel} 최소 ${r.min}`;

  return null;
}

function checkFrames(value: number, f: ManifestLimits["frames"], methodLabel: string): string | null {
  if (!f) return null;
  const range = checkRange("프레임 수", value, { min: f.min, max: f.max }, methodLabel);

  if (range) return range;

  return f.evenOnly && value % 2 !== 0 ? `프레임 수 ${value} 은(는) ${methodLabel} 에서 짝수여야 해요.` : null;
}

/** 한 방법에 대해 { size, frames } 값을 검사. 어긋난 이유 목록(비면 통과) */
export function checkValues(manifest: ToolManifestEntry, methodId: string, values: { size?: number; frames?: number }): string[] {
  const m = manifest.methods.find((x) => x.id.toLowerCase() === methodId.toLowerCase());

  if (!m) return [];
  const who = `${manifest.label}의 ${m.label}`;
  const out: string[] = [];

  if (values.size !== undefined) {
    const e = checkRange("크기", values.size, m.limits.size, who);

    if (e) out.push(e);
  }
  if (values.frames !== undefined) {
    const e = checkFrames(values.frames, m.limits.frames, who);

    if (e) out.push(e);
  }

  return out;
}

/**
 * 프로젝트 도구 설정(settings)이 설명서 한계를 넘는지: 결과 종류별 기본 방식(methods.<종류>.default, 없으면 허용 목록의 첫 방식)으로 spec.cell_size(크기)와 motion.frames(프레임 수)를 본다.
 * 결과 종류를 정하지 않은 방식, 설명서가 없는 방식은 건너뛴다(도구가 알아서 처리). 이름이 pixel-art 인 도구의 방법을 기준으로 한다.
 */
export function checkSettingsLimits(settings: unknown, tools: Record<string, ToolManifestEntry>, toolName = "pixel-art"): string[] {
  const manifest = tools[toolName];

  if (!manifest || !isRecord(settings)) return [];
  const methods = isRecord(settings.methods) ? settings.methods : {};
  const spec = isRecord(settings.spec) ? settings.spec : {};
  const motion = isRecord(settings.motion) ? settings.motion : {};
  const out: string[] = [];
  const cell = typeof spec.cell_size === "number" ? spec.cell_size : undefined;
  const frames = typeof motion.frames === "number" ? motion.frames : undefined;

  for (const [kind, m] of Object.entries(methods)) {
    if (!isRecord(m)) continue;
    const method = typeof m.default === "string" ? m.default : Array.isArray(m.allowed) && typeof m.allowed[0] === "string" ? m.allowed[0] : "";
    // 크기(cell_size)는 소품·시트 칸이라 장면(image-scene)에는 적용하지 않는다
    const sizeApplies = kind !== "image-scene" && kind !== "motion-clip";
    const framesApply = kind === "motion-game" || kind === "motion-clip";
    const errors = method ? checkValues(manifest, method, { size: sizeApplies ? cell : undefined, frames: framesApply ? frames : undefined }) : [];

    for (const e of errors) out.push(`설정(${kind}): ${e}`);
  }

  return [...new Set(out)];
}

const SIZE_PATTERN = /(?:cell_size|셀\s*크기|칸\s*크기|크기|size)\s*(?:[:=는은]|\s)\s*(\d{1,5})(?!\d)/i;
const FRAMES_PATTERN = /(?:frames|프레임\s*수?)\s*(?:[:=는은]|\s)\s*(\d{1,3})(?!\d)/i;

/**
 * 일감 지시문이 설명서 한계를 넘는지: 줄 하나에 방법 이름이 정확히 하나만 나오고 그 줄에 '크기 N'·'frames N' 꼴이 있을 때만 본다(애매하면 통과).
 * 예) "pixellab 으로 크기 256 도트" → 크기 256 > 최대 128 로 거절.
 */
export function checkPlanLimits(plan: string, tools: Record<string, ToolManifestEntry>): string[] {
  const out: string[] = [];

  for (const line of plan.split(/\r?\n/)) {
    for (const t of Object.values(tools)) {
      if (t.source !== "file") continue;
      const hit = t.methods.filter((m) => mentions(line, m.id) && (m.limits.size || m.limits.frames));

      if (hit.length !== 1 || t.methods.some((m) => m !== hit[0] && mentions(line, m.id))) continue;
      const size = SIZE_PATTERN.exec(line);
      const frames = FRAMES_PATTERN.exec(line);

      for (const e of checkValues(t, hit[0].id, { size: size ? Number(size[1]) : undefined, frames: frames ? Number(frames[1]) : undefined })) out.push(e);
    }
  }

  return [...new Set(out)];
}

// ───────── 화면용 ─────────

export interface MethodView extends ManifestMethod {
  secretStates: { name: string; ready: boolean }[]; // ready = 키 이름이 등록돼 있음(값은 보지 않는다)
  ready: boolean;
}
export interface ToolManifestView extends Omit<ToolManifestEntry, "methods"> {
  methods: MethodView[];
}
export interface ManifestsView {
  commit: string;
  reportedAt: string | null;
  tools: ToolManifestView[];
}

export function buildManifestsView(report: ManifestReport | null, registeredNames: ReadonlySet<string>): ManifestsView {
  if (!report) return { commit: "", reportedAt: null, tools: [] };

  return {
    commit: report.commit,
    reportedAt: report.reportedAt,
    tools: Object.values(report.tools).map((t) => ({
      ...t,
      methods: t.methods.map((m) => {
        const secretStates = m.secrets.map((name) => ({ name, ready: registeredNames.has(name) }));

        return { ...m, secretStates, ready: secretStates.every((s) => s.ready) };
      }),
    })),
  };
}

/** 한계를 사람이 읽는 한 줄로 */
export function limitLines(m: ManifestMethod): string[] {
  const l = m.limits;
  const out: string[] = [];

  if (l.size) out.push(`크기 ${l.size.allowed?.length ? l.size.allowed.join("·") : `${l.size.min ?? "?"}~${l.size.max ?? "?"}`}${l.size.note ? ` (${l.size.note})` : ""}`);
  if (l.frames) out.push(`프레임 ${l.frames.min ?? "?"}~${l.frames.max ?? "?"}${l.frames.evenOnly ? " 짝수" : ""}${l.frames.default ? ` (기본 ${l.frames.default})` : ""}`);
  if (l.maxImagesPerCall !== undefined) out.push(`한 번에 ${l.maxImagesPerCall}장`);
  if (l.maxCallsPerJob !== undefined) out.push(l.maxCallsPerJob === null ? "일감당 호출 제한 없음" : `일감당 최대 ${l.maxCallsPerJob}회`);
  if (l.timeoutSec !== undefined) out.push(`제한 시간 ${l.timeoutSec}초`);

  return out;
}
