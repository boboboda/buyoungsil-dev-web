// lib/factory/toolkit.ts
// 통제실 도구함의 '툴킷 도구 상세'(읽기 전용) 자료: 작업 PC 의 game-toolkit/tools.json 을 감독 프로그램이 읽어 보낸 도구별 상세와,
// 관리자가 도구마다 정해 두는 '용도'(게임용 / 움짤·컷용 / 공용 / 미분류).
// - 받는 쪽: POST /api/factory/device-stats 의 { device:"main-pc", toolkit:{…} } (작업 PC 토큰, 본문 8KB 이하). 도구는 실행하지 않고 목록만 읽는다.
// - 저장: factory_settings 의 toolkitInfo(보고서) · toolPurposes(관리자가 바꾼 용도). 새 테이블 없음.
// - 용도 자동 추정은 이름·설명·출력 형식 표시(tags)로 하고 '추정'이라고 보여 준다. 관리자가 바꾸면 저장값이 우선한다.
// 비밀값은 받지도 않는다: 키는 이름(대문자·숫자·_)만, 절대 경로 모양은 버린다.
import { maskSecrets } from "@/lib/factory/mask";

export const TOOLKIT_INFO_KEY = "toolkitInfo";
export const TOOL_PURPOSES_KEY = "toolPurposes";
export const MAX_TOOLKIT_TOOLS = 40;
export const MAX_PURPOSES = 100;

export const PURPOSES = ["game", "cut", "common", "unclassified"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const PURPOSE_LABELS: Record<Purpose, string> = { game: "게임용", cut: "움짤·컷용", common: "공용", unclassified: "미분류" };
export const isPurpose = (v: unknown): v is Purpose => typeof v === "string" && (PURPOSES as readonly string[]).includes(v);

const ID_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const SECRET_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const ARG_RE = /^[a-z][a-z0-9_]{0,39}:(?:string|int|path)\*?$/;
const OPT_RE = /^[A-Za-z0-9_-]{1,40}$/;
const REL_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,99}$/;
const TAGS = ["sheet", "atlas", "tilemap", "sprite", "gif", "webp", "apng", "cut"] as const;
const GAME_TAGS = ["sheet", "atlas", "tilemap", "sprite"];
const CUT_TAGS = ["gif", "webp", "apng", "cut"];

/** 도구의 모드(예: pixel-codex 의 sprite·sheet·scene·frames). 읽기 전용 표시용 */
export interface ToolkitMode {
  id: string;
  purpose: Purpose;
  desc: string; // 한 줄 설명(언제 쓰나)
  legacy: string; // 예전 호출 매핑
  io: string;
}

const MAX_MODES = 8;
const MODE_ID_RE = /^[a-z][a-z0-9_]{0,39}$/;

export type ToolLayer = "internal" | "studio" | "";

/** 스튜디오 도구의 결과 종류 하나(예: pixel-art 의 image-prop). 읽기 전용 표시용 */
export interface StudioKind {
  id: string;
  label: string;
  output: string;
  background: string;
  defaultMethod: string;
  methods: string[];
}

/** tools.json 최상위 studioTools 의 도구 하나(예: pixel-art). 없으면 빈 목록 */
export interface StudioToolInfo {
  id: string;
  title: string;
  desc: string;
  methodOrder: string[];
  refOrder: string[];
  refsMax: number;
  kinds: StudioKind[];
}

export interface ToolkitTool {
  id: string;
  desc: string;
  entry: string;
  script: string;
  dir: string;
  doc: string;
  opts: string[];
  args: string[]; // "이름:종류" (필수면 끝에 *)
  argsMore: number;
  out: string[]; // 결과 파일 위치를 받는 인자 이름
  tags: string[];
  net: boolean;
  secrets: string[]; // 이름만
  optionalSecrets: string[]; // 그 호출에 실제로 필요할 때만 쓰는 선택 키(이름만). 옛 보고는 빈 배열
  layer: ToolLayer; // studio = 사람이 스튜디오에서 쓰는 도구, internal = 내부 단계, "" = 옛 tools.json(구분 없음)
  timeoutSec: number;
  enabled: boolean;
  modes: ToolkitMode[]; // 없으면 빈 배열(모드 없는 도구·옛 형식)
  modified: string; // YYYY-MM-DD
}

/** 보고의 m 배열 → 모드 목록. 깨진 항목은 버리고 나머지는 살린다 */
function readModes(v: unknown): ToolkitMode[] {
  if (!Array.isArray(v)) return [];
  const out: ToolkitMode[] = [];

  for (const m of v.slice(0, MAX_MODES)) {
    if (!isRecord(m) || typeof m.id !== "string" || !MODE_ID_RE.test(m.id) || out.some((x) => x.id === m.id)) continue;
    out.push({ id: m.id, purpose: isPurpose(m.p) ? m.p : "unclassified", desc: text(m.w, 200), legacy: text(m.lg, 200), io: text(m.io, 120) });
  }

  return out;
}

export interface ToolkitInfo {
  studioTools: StudioToolInfo[]; // 옛 보고(저장값 포함)는 빈 배열
  state: "ok" | "missing" | "error";
  reason: string;
  count: number;
  omitted: number;
  manifestModified: string;
  receivedAt: string; // 서버가 받은 시각(ISO)
  tools: ToolkitTool[];
}

const METHOD_RE = /^[a-z][a-z0-9_]{0,39}$/;
const LABEL_RE = /^[A-Za-z0-9가-힣①②③④_-]{1,24}$/;

/** 보고의 studio 배열 → 스튜디오 도구 목록. 깨진 항목은 버리고 나머지는 살린다 */
function readStudioTools(v: unknown): StudioToolInfo[] {
  if (!Array.isArray(v)) return [];
  const out: StudioToolInfo[] = [];

  for (const s of v.slice(0, 4)) {
    if (!isRecord(s) || typeof s.id !== "string" || !ID_RE.test(s.id) || out.some((x) => x.id === s.id)) continue;
    const kinds: StudioKind[] = [];

    for (const k of Array.isArray(s.k) ? s.k.slice(0, 8) : []) {
      if (!isRecord(k) || typeof k.id !== "string" || !ID_RE.test(k.id) || kinds.some((x) => x.id === k.id)) continue;
      kinds.push({
        id: k.id,
        label: text(k.l, 60),
        output: text(k.o, 80),
        background: text(k.bg, 20),
        defaultMethod: typeof k.def === "string" && METHOD_RE.test(k.def) ? k.def : "",
        methods: strList(k.m, METHOD_RE, 6),
      });
    }
    out.push({ id: s.id, title: text(s.title, 80) || s.id, desc: text(s.desc, 300), methodOrder: strList(s.mo, LABEL_RE, 8), refOrder: strList(s.ro, LABEL_RE, 8), refsMax: nonNeg(s.rm, 20), kinds });
  }

  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
// 글: 비밀번호 모양 가림 + 줄바꿈 정리 + 길이. 절대 경로(C:\…, /home/…)처럼 보이는 조각은 지운다
const text = (v: unknown, max: number) =>
  typeof v === "string"
    ? maskSecrets(v)
        .replace(/[\u0000-\u001f]/g, " ")
        .replace(/\b[A-Za-z]:[\\/][^\s,;)]*/g, "<경로>")
        .trim()
        .slice(0, max)
    : "";
const strList = (v: unknown, re: RegExp, max: number) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && re.test(s)).slice(0, max) : []);
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const nonNeg = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.floor(v)) : 0);

/** 감독 프로그램이 보낸 toolkit 값 → 정리된 보고서. 형식이 크게 틀리면 { ok:false } */
export function validateToolkitReport(raw: unknown, now = new Date()): { ok: true; info: ToolkitInfo } | { ok: false; reason: string } {
  if (!isRecord(raw)) return { ok: false, reason: "toolkit 은 객체여야 해요." };
  const state = raw.state === "ok" || raw.state === "missing" || raw.state === "error" ? raw.state : null;

  if (!state) return { ok: false, reason: "toolkit.state 는 ok·missing·error 중 하나예요." };
  if (state === "ok" && !Array.isArray(raw.tools)) return { ok: false, reason: "toolkit.tools 는 배열이어야 해요." };

  const tools: ToolkitTool[] = [];
  const seen = new Set<string>();

  for (const t of Array.isArray(raw.tools) ? raw.tools.slice(0, MAX_TOOLKIT_TOOLS) : []) {
    if (!isRecord(t) || typeof t.id !== "string" || !ID_RE.test(t.id) || seen.has(t.id)) continue;
    seen.add(t.id);
    const entry = typeof t.entry === "string" && REL_RE.test(t.entry) ? t.entry : "";
    const script = typeof t.script === "string" && REL_RE.test(t.script) ? t.script : entry;

    tools.push({
      id: t.id,
      desc: text(t.desc, 400),
      entry,
      script,
      dir: typeof t.dir === "string" && (t.dir === "." || REL_RE.test(t.dir)) ? t.dir : "",
      doc: text(t.doc, 400),
      opts: strList(t.opts, OPT_RE, 40),
      args: strList(t.a, ARG_RE, 40),
      argsMore: nonNeg(t.aMore, 1000),
      out: strList(t.out, OPT_RE, 8),
      tags: strList(t.tags, /^[a-z]+$/, 8).filter((x) => (TAGS as readonly string[]).includes(x)),
      net: t.net === true,
      secrets: strList(t.sec, SECRET_RE, 8),
      optionalSecrets: strList(t.osec, SECRET_RE, 8),
      layer: t.ly === "studio" || t.ly === "internal" ? t.ly : "",
      timeoutSec: nonNeg(t.to, 3600),
      enabled: t.en !== false,
      modes: readModes(t.m),
      modified: date(t.mod),
    });
  }

  return {
    ok: true,
    info: {
      studioTools: readStudioTools(raw.studio),
      state,
      reason: text(raw.reason, 200),
      count: Math.max(tools.length, nonNeg(raw.count, 1000)),
      omitted: nonNeg(raw.omitted, 1000),
      manifestModified: date(raw.manifestMod),
      receivedAt: now.toISOString(),
      tools,
    },
  };
}

/** 사람이 읽는 실행 명령 모양: `python cli.py <id> --이름=<종류>` (필수는 *) — 값은 넣지 않는다 */
export function commandOf(t: Pick<ToolkitTool, "id" | "entry" | "args">): string {
  const parts = t.args.map((a) => {
    const [name, rest] = a.split(":");

    return `--${name}=<${rest.replace("*", "")}>${rest.endsWith("*") ? "*" : ""}`;
  });

  return [`python ${t.entry || "(진입 파일 모름)"}`, t.id, ...parts].join(" ");
}

/** 인자 이름·종류 → 입력 종류 / 출력 종류 한 줄씩 */
export function ioOf(t: Pick<ToolkitTool, "args" | "out" | "tags">): { input: string; output: string } {
  const input = t.args
    .filter((a) => !t.out.includes(a.split(":")[0]))
    .map((a) => {
      const [name, rest] = a.split(":");

      return `${name}(${rest.replace("*", "")})${rest.endsWith("*") ? "*" : ""}`;
    })
    .join(", ");
  const output = [t.out.length ? `경로 인자: ${t.out.join(", ")}` : "결과 위치는 도구가 정해요(앱의 .factory/assets 등)", t.tags.length ? `형식 표시: ${t.tags.join(", ")}` : ""].filter(Boolean).join(" · ");

  return { input: input || "없음", output };
}

/** 이름·설명·출력 형식 표시로 용도 추정. 게임 표시와 컷 표시가 같이 있으면 공용, 둘 다 없으면 미분류 */
export function guessPurpose(t: Pick<ToolkitTool, "tags">): Purpose {
  const game = t.tags.some((x) => GAME_TAGS.includes(x));
  const cut = t.tags.some((x) => CUT_TAGS.includes(x));

  if (game && cut) return "common";
  if (game) return "game";
  if (cut) return "cut";

  return "unclassified";
}

/** 저장된 용도 JSON → { 도구 id: 용도 }. 이상한 항목은 버린다 */
export function readPurposes(raw: string | null | undefined): Record<string, Purpose> {
  if (!raw) return {};
  try {
    const o: unknown = JSON.parse(raw);

    if (!isRecord(o)) return {};
    const out: Record<string, Purpose> = {};

    for (const [k, v] of Object.entries(o).slice(0, MAX_PURPOSES)) if (ID_RE.test(k) && isPurpose(v)) out[k] = v;

    return out;
  } catch {
    return {};
  }
}

export interface ToolkitRow extends ToolkitTool {
  command: string;
  input: string;
  output: string;
  purpose: Purpose;
  purposeSource: "saved" | "guess";
}

/** 스튜디오에서 사람이 고르는 도구. layer 구분이 있는 툴킷이면 studio 만, 옛 툴킷(구분 없음)이면 전부 */
export function studioToolRows<T extends { layer: ToolLayer }>(rows: readonly T[]): T[] {
  return rows.some((r) => r.layer !== "") ? rows.filter((r) => r.layer === "studio") : [...rows];
}

/**
 * 스튜디오에 연결·[일감 보내기]로 쓸 수 있는 도구 id: 스튜디오 도구(pixel-art) + 이미 연결돼 있던 내부 도구 이름(읽기 호환, 새로 고를 수는 없다).
 * connected = 그 프로젝트에 지금 저장된 연결 목록
 */
export function allowedStudioToolIds(rows: readonly { id: string; layer: ToolLayer }[], connected: readonly string[] = []): Set<string> {
  const studio = studioToolRows(rows).map((r) => r.id);
  const legacy = internalToolRows(rows).filter((r) => connected.includes(r.id)).map((r) => r.id);

  return new Set([...studio, ...legacy]);
}

/** 내부 단계 도구(layer=internal). 옛 툴킷이면 빈 목록 */
export function internalToolRows<T extends { layer: ToolLayer }>(rows: readonly T[]): T[] {
  return rows.some((r) => r.layer !== "") ? rows.filter((r) => r.layer === "internal") : [];
}

export interface ToolkitView {
  info: ToolkitInfo | null; // null = 아직 한 번도 못 받음(또는 읽기 실패)
  rows: ToolkitRow[];
  failed: boolean;
}

export function buildToolkitView(info: ToolkitInfo | null, purposes: Record<string, Purpose>): ToolkitView {
  const rows = (info?.tools ?? []).map((t) => {
    const saved = purposes[t.id];
    const { input, output } = ioOf(t);

    return { ...t, command: commandOf(t), input, output, purpose: saved ?? guessPurpose(t), purposeSource: saved ? ("saved" as const) : ("guess" as const) };
  });

  return { info, rows, failed: false };
}

/** 저장된 보고서 JSON → 보고서(깨졌으면 null). 저장할 때 이미 검증한 모양이라 필수 칸만 확인한다 */
export function parseStoredInfo(raw: string | null | undefined): ToolkitInfo | null {
  if (!raw) return null;
  try {
    const o: unknown = JSON.parse(raw);

    if (!isRecord(o) || !Array.isArray(o.tools) || (o.state !== "ok" && o.state !== "missing" && o.state !== "error")) return null;

    const tools = (o.tools as ToolkitTool[]).filter((t) => isRecord(t) && typeof t.id === "string" && Array.isArray(t.args)).map((t) => ({ ...t, modes: Array.isArray(t.modes) ? t.modes : [], optionalSecrets: Array.isArray(t.optionalSecrets) ? t.optionalSecrets : [], layer: (t.layer === "studio" || t.layer === "internal" ? t.layer : "") as ToolLayer })); // 모드·layer 가 생기기 전에 저장된 값도 읽는다

    return { ...(o as unknown as ToolkitInfo), studioTools: Array.isArray(o.studioTools) ? (o.studioTools as StudioToolInfo[]) : [], tools };
  } catch {
    return null;
  }
}

export interface ToolkitDb {
  factorySetting: {
    findUnique(args: { where: { key: string } }): PromiseLike<{ value: string } | null>;
    upsert(args: { where: { key: string }; create: { key: string; value: string }; update: { value: string } }): PromiseLike<unknown>;
  };
}

/** 보고서를 저장한다. 도구 내용이 그대로면(받은 시각만 다르면) 10분 안에는 다시 쓰지 않는다. 바뀌어서 썼으면 true */
export async function saveToolkitInfo(db: ToolkitDb, info: ToolkitInfo, now = Date.now()): Promise<boolean> {
  const before = await db.factorySetting.findUnique({ where: { key: TOOLKIT_INFO_KEY } });
  const prev = parseStoredInfo(before?.value);
  const strip = (i: ToolkitInfo | null) => JSON.stringify(i && { ...i, receivedAt: "" });

  if (prev && strip(prev) === strip(info) && now - Date.parse(prev.receivedAt) < 10 * 60_000) return false;
  const value = JSON.stringify(info);

  await db.factorySetting.upsert({ where: { key: TOOLKIT_INFO_KEY }, create: { key: TOOLKIT_INFO_KEY, value }, update: { value } });

  return true;
}

/** 관리자가 도구 하나의 용도를 바꾼다. purpose=null 이면 저장값을 지우고 자동 추정으로 되돌린다 */
export async function setToolPurpose(db: ToolkitDb, id: string, purpose: Purpose | null): Promise<Record<string, Purpose>> {
  const cur = readPurposes((await db.factorySetting.findUnique({ where: { key: TOOL_PURPOSES_KEY } }))?.value);

  if (purpose === null) delete cur[id];
  else cur[id] = purpose;
  const value = JSON.stringify(cur);

  await db.factorySetting.upsert({ where: { key: TOOL_PURPOSES_KEY }, create: { key: TOOL_PURPOSES_KEY, value }, update: { value } });

  return cur;
}

export const isToolId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);

/** DB 에서 읽어 화면용 자료로. 읽기에 실패해도 던지지 않고 failed 로 알린다 */
export async function readToolkitView(db: ToolkitDb): Promise<ToolkitView> {
  try {
    const [info, purposes] = await Promise.all([db.factorySetting.findUnique({ where: { key: TOOLKIT_INFO_KEY } }), db.factorySetting.findUnique({ where: { key: TOOL_PURPOSES_KEY } })]);

    return buildToolkitView(parseStoredInfo(info?.value), readPurposes(purposes?.value));
  } catch (error) {
    console.error("[toolkit] 도구 상세 읽기 실패:", error instanceof Error ? error.name : "unknown");

    return { info: null, rows: [], failed: true };
  }
}
