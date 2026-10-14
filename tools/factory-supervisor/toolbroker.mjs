// 도구 요청 중계기 (감독 프로그램 안에서만 돈다)
// AI(Claude·Codex)는 앱 폴더의 .factory/requests/<id>.json 에 요청서만 쓰고, 감독 프로그램이 허용 목록의 도구만 대신 실행해
// .factory/responses/<id>.json 과 .factory/assets/ 로 결과를 돌려준다. AI 의 샌드박스·네트워크 정책은 바꾸지 않는다.
// - 임의 셸 명령은 없다. 도구는 고정 배열로 실행하고(shell:false) 경로는 앱 폴더 안으로만 받는다.
// - 비밀값은 도구 프로세스의 환경변수로만 넘기고 요청·응답·로그·이벤트에는 남기지 않는다.
// 사용법·규약: docs/ai-harness.md 의 "도구 요청 중계" 절.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { maskText } from "./release.mjs";
import { loadManifestIndex, manifestMethod, manifestSecretNames, secretsForMethod } from "./toolmanifest.mjs";

const IS_WIN = process.platform === "win32";

export const TOOL_MODES = ["off", "report", "allow"];
export const TOOL_MODE_LABELS = { off: "꺼짐", report: "보고만", allow: "허용" };
// 통제실 설정이 없거나 이상하면 이 값을 쓴다. maxRequests·toolTimeoutSec 의 0 = 제한 없음(기본)
// 제한 없음이어도 일감이 끝나거나 취소되거나 감독 프로그램이 꺼지면 stop() 이 돌던 도구를 끈다
export const BROKER_DEFAULTS = { mode: "off", maxRequests: 0, toolTimeoutSec: 0 };
const LIMITS = {
  maxRequestsCap: 200,
  toolTimeoutCapSec: 900,
  requestBytes: 16 * 1024,
  manifestBytes: 64 * 1024,
  outputBytes: 64 * 1024,
  outputSummary: 1500,
  files: 50,
  pollMs: 3000,
};
export const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TOOL_NAME_RE = /^[a-z][a-z0-9_.-]{0,39}$/;
const SUBCOMMAND_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const ARG_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const TOOLREQ_PATH = fileURLToPath(new URL("./toolreq.mjs", import.meta.url));

/** /api/factory/next 의 toolBroker 값 → 정리된 설정. 없거나 이상하면 꺼짐(예전 서버 포함). 수치가 없거나 0 이하면 제한 없음(0) */
export function brokerSettings(v) {
  const o = v && typeof v === "object" && !Array.isArray(v) ? v : {};
  const int = (x, d, lo, hi) => (Number.isInteger(x) ? (x <= 0 ? 0 : Math.min(hi, Math.max(lo, x))) : d);
  return {
    mode: TOOL_MODES.includes(o.mode) ? o.mode : BROKER_DEFAULTS.mode,
    maxRequests: int(o.maxRequests, BROKER_DEFAULTS.maxRequests, 1, LIMITS.maxRequestsCap),
    toolTimeoutSec: int(o.toolTimeoutSec, BROKER_DEFAULTS.toolTimeoutSec, 5, LIMITS.toolTimeoutCapSec),
  };
}

// ───────── 경로 ─────────
const isLink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** 앱 폴더 안의 실제 디렉터리(.factory/<name>)를 만든다. 중간 경로가 심볼릭 링크·파일이면 거부 */
export function factoryDir(appDir, name) {
  const base = path.join(appDir, ".factory");
  for (const p of [base, path.join(base, name)]) {
    if (fs.existsSync(p) || isLink(p)) {
      const s = fs.lstatSync(p);
      if (s.isSymbolicLink() || !s.isDirectory()) throw new Error(`${path.relative(appDir, p)} 는 실제 폴더여야 해요.`);
    } else fs.mkdirSync(p);
  }
  return path.join(base, name);
}

// 프로젝트 도구 설정: 홈페이지가 일감과 같이 내려 준 설정을 앱 폴더의 이 파일에 쓰고, pixel-art 호출에 settings 인자가 없으면 이 파일을 자동으로 붙인다
export const PROJECT_SETTINGS_REL = ".factory/project-settings.json";
const PROJECT_SETTINGS_MAX_BYTES = 16 * 1024;

// 도트 그림 저장소: 홈페이지가 내려 준 '승인' 그림 목록을 프로젝트 설정의 references.approved 에 합치고(툴킷이 ②대상 이름 ③결과 종류로 고름),
// 이번 일감에서 '참고로 고른' 그림(picked)은 .factory/art-refs.json 에 두었다가 pixel-art 호출에 refs 로 자동으로 붙인다. 후보·반려 그림은 서버가 애초에 보내지 않는다.
export const ART_REFS_REL = ".factory/art-refs.json";
const ART_KINDS = ["image-prop", "image-scene", "motion-game", "motion-clip"];
const MAX_ART_REFS = 4;
const MAX_APPROVED_ENTRIES = 24;
const httpUrl = (u) => typeof u === "string" && u.length <= 500 && /^https?:\/\/[^\s]+$/.test(u);

/** 서버가 준 목록 → 정리된 [{ url, subject, kind, approvedAt? }] (형식이 이상한 항목은 버린다) */
export function cleanArtList(list, max) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e === "object" && httpUrl(e.url) && typeof e.subject === "string" && e.subject.trim() && e.subject.length <= 60 && ART_KINDS.includes(e.kind))
    .map((e) => ({ url: e.url, subject: e.subject.trim(), kind: e.kind, ...(typeof e.approvedAt === "string" ? { approvedAt: e.approvedAt.slice(0, 40) } : {}) }))
    .slice(0, max);
}

/**
 * 설정에 승인 그림을 합친다(lib/factory/arts.ts mergeApprovedIntoSettings 와 같은 규칙): 승인 그림이 앞, 설정에 원래 있던 approved 항목은 뒤, 같은 path 는 한 번만.
 * 툴킷 항목은 { path, subject, kind } 만 쓴다(project 는 넣지 않는다: 이미 이 프로젝트의 목록이고, 넣으면 요청에 project 가 없을 때 걸러진다)
 */
export function mergeApprovedArts(settings, approved) {
  const arts = cleanArtList(approved, MAX_APPROVED_ENTRIES);
  if (!arts.length) return settings ?? null;
  const base = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : { version: 1 };
  const refs = base.references && typeof base.references === "object" && !Array.isArray(base.references) ? base.references : {};
  const stored = Array.isArray(refs.approved) ? refs.approved : [];
  const seen = new Set();
  const list = [...arts.map((a) => ({ path: a.url, subject: a.subject, kind: a.kind })), ...stored].filter((e) => e && typeof e.path === "string" && !seen.has(e.path) && !!seen.add(e.path));
  return { ...base, references: { ...refs, approved: list } };
}

/** picked 목록 → .factory/art-refs.json. 비면 파일을 지운다. 반환: 쓴 장수 */
export function writeArtRefs(appDir, picked, approved) {
  const file = path.join(appDir, ".factory", "art-refs.json");
  const pick = cleanArtList(picked, MAX_ART_REFS);
  try {
    if (!pick.length) {
      if (fs.existsSync(file) || isLink(file)) fs.rmSync(file, { force: true });
      return 0;
    }
    factoryDir(appDir, "assets"); // .factory 가 실제 폴더인지 확인
    if (isLink(file)) fs.rmSync(file, { force: true });
    fs.writeFileSync(file, JSON.stringify({ picked: pick, approved: cleanArtList(approved, MAX_APPROVED_ENTRIES) }, null, 2) + "\n", { mode: 0o600 });
    return pick.length;
  } catch {
    return 0;
  }
}

/** 자동으로 붙일 picked URL 들(.factory/art-refs.json). 없거나 이상하면 [] */
export function readPickedRefs(appDir) {
  try {
    const file = path.join(appDir, ".factory", "art-refs.json");
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile() || st.size > 32 * 1024) return [];
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    return cleanArtList(j?.picked, MAX_ART_REFS).map((e) => e.url);
  } catch {
    return [];
  }
}

/**
 * 일감의 projectToolSettings({ version, settings }) + 승인 그림 목록 → <앱 폴더>/.factory/project-settings.json. 없거나 이상하면 예전 파일을 지운다(다른 일감의 설정이 남지 않게).
 * 승인 그림이 있으면 설정이 없어도 { version: 1, references: { approved } } 만으로 쓴다. 16KB 를 넘으면 승인 그림을 뒤에서부터 줄인다.
 * 반환: "written" | "removed" | "none" | "invalid"  (값은 기록에 남기지 않는다)
 */
export function writeProjectSettings(appDir, projectToolSettings, approvedArts = []) {
  const file = path.join(appDir, ".factory", "project-settings.json");
  const remove = () => {
    try {
      if (fs.existsSync(file) || isLink(file)) {
        fs.rmSync(file, { force: true });
        return true;
      }
    } catch {
      /* 못 지워도 일감은 계속 */
    }
    return false;
  };
  const given = projectToolSettings?.settings;
  const hasGiven = given && typeof given === "object" && !Array.isArray(given) && Object.keys(given).some((k) => k !== "version" && k !== "$schema");
  let arts = cleanArtList(approvedArts, MAX_APPROVED_ENTRIES);
  let s;
  let text = "";
  for (;;) {
    s = mergeApprovedArts(hasGiven ? given : null, arts);
    if (!s || !Object.keys(s).some((k) => k !== "version" && k !== "$schema")) return remove() ? "removed" : "none";
    text = JSON.stringify(s, null, 2) + "\n";
    if (Buffer.byteLength(text) <= PROJECT_SETTINGS_MAX_BYTES) break;
    if (!arts.length) return remove() ? "removed" : "invalid"; // 승인 그림을 다 빼도 크면 쓰지 않는다
    arts = arts.slice(0, -1);
  }
  try {
    factoryDir(appDir, "assets"); // .factory 가 실제 폴더인지 확인(심볼릭 링크면 던짐)
    if (isLink(file)) fs.rmSync(file, { force: true });
    fs.writeFileSync(file, text, { mode: 0o600 });
    return "written";
  } catch {
    return "invalid";
  }
}

/** 자동으로 붙일 프로젝트 설정 파일이 앱 폴더에 있으면 { rel, settings }, 아니면 null */
export function readProjectSettings(appDir) {
  try {
    const file = path.join(appDir, ".factory", "project-settings.json");
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile() || st.size > PROJECT_SETTINGS_MAX_BYTES) return null;
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    return s && typeof s === "object" && !Array.isArray(s) ? { rel: PROJECT_SETTINGS_REL, settings: s } : null;
  } catch {
    return null;
  }
}

/** AI 가 준 상대 경로 → 앱 폴더 안의 정규화된 상대 경로. 절대경로·..·심볼릭 링크(있는 부분)는 거부 */
export function safeAppPath(appDir, rel) {
  if (typeof rel !== "string" || !rel || rel.length > 300) return { ok: false, reason: "경로는 1~300자 문자열이어야 해요." };
  if (/[\0\r\n]/.test(rel)) return { ok: false, reason: "경로에 허용하지 않는 문자가 있어요." };
  if (path.isAbsolute(rel) || path.win32.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.startsWith("\\\\")) return { ok: false, reason: "절대 경로는 쓸 수 없어요." };
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some((p) => p === ".." || p === ".")) return { ok: false, reason: "경로에 . 이나 .. 은 쓸 수 없어요." };
  if (parts[0] === ".git") return { ok: false, reason: ".git 안은 쓸 수 없어요." };
  const root = path.resolve(appDir);
  const full = path.resolve(root, ...parts);
  if (!full.startsWith(root + path.sep)) return { ok: false, reason: "앱 폴더 밖 경로예요." };
  let cur = root;
  for (const p of parts) {
    cur = path.join(cur, p);
    if (isLink(cur)) return { ok: false, reason: "심볼릭 링크 경로는 쓸 수 없어요." };
    if (!fs.existsSync(cur)) break;
  }
  return { ok: true, rel: parts.join("/"), full };
}

// ───────── 요청서 ─────────
/** 요청서 파일 → { ok, req } | { ok:false, reason }. 파일 이름의 id 와 본문 id 가 같아야 한다 */
export function readRequest(file, fileId) {
  let st;
  try {
    st = fs.lstatSync(file);
  } catch {
    return { ok: false, reason: "요청서를 읽지 못했어요." };
  }
  if (st.isSymbolicLink() || !st.isFile()) return { ok: false, reason: "요청서는 실제 파일이어야 해요(심볼릭 링크 거부)." };
  if (st.size > LIMITS.requestBytes) return { ok: false, reason: `요청서가 너무 커요(${LIMITS.requestBytes}바이트까지).` };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return { ok: false, reason: "요청서가 JSON 형식이 아니에요." };
  }
  return validateRequest(raw, fileId);
}

export function validateRequest(raw, fileId) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "요청서는 { id, tool, args } 객체여야 해요." };
  const extra = Object.keys(raw).filter((k) => !["id", "tool", "args"].includes(k));
  if (extra.length) return { ok: false, reason: `모르는 항목: ${extra.slice(0, 5).join(", ")}` };
  if (typeof raw.id !== "string" || !REQUEST_ID_RE.test(raw.id) || raw.id !== fileId) return { ok: false, reason: "id 는 파일 이름과 같아야 해요(영문·숫자·_-, 64자까지)." };
  if (typeof raw.tool !== "string" || !TOOL_NAME_RE.test(raw.tool)) return { ok: false, reason: "tool 이름 형식이 올바르지 않아요." };
  if (!Object.hasOwn(ADAPTERS, raw.tool)) return { ok: false, reason: `허용 목록에 없는 도구예요: ${raw.tool} (허용: ${Object.keys(ADAPTERS).join(", ")})` };
  const args = raw.args === undefined ? {} : raw.args;
  if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, reason: "args 는 객체여야 해요." };
  return { ok: true, req: { id: raw.id, tool: raw.tool, args } };
}

// ───────── 게임 툴킷 목록(tools.json) ─────────
/** factory/game-toolkit/tools.json 을 읽고 검증한다. 없으면 { ok:false, missing:true } */
export function loadToolkitManifest(toolkitDir) {
  const file = path.join(toolkitDir || "", "tools.json");
  if (!toolkitDir || !fs.existsSync(toolkitDir) || !fs.existsSync(file)) return { ok: false, missing: true, reason: "툴킷이 없어요(game-toolkit/tools.json 을 찾지 못했어요)." };
  try {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile()) return { ok: false, reason: "tools.json 은 실제 파일이어야 해요." };
    if (st.size > LIMITS.manifestBytes) return { ok: false, reason: "tools.json 이 너무 커요." };
    return validateManifest(JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")), toolkitDir);
  } catch (e) {
    return { ok: false, reason: `tools.json 을 읽지 못했어요: ${maskText(e.message).slice(0, 200)}` };
  }
}

export function validateManifest(m, toolkitDir) {
  if (!m || typeof m !== "object" || m.version !== 1 || !m.tools || typeof m.tools !== "object" || Array.isArray(m.tools)) {
    return { ok: false, reason: 'tools.json 형식: { "version": 1, "tools": { ... } }' };
  }
  const tools = {};
  for (const [name, t] of Object.entries(m.tools)) {
    const bad = (why) => ({ ok: false, reason: `tools.json 의 '${String(name).slice(0, 40)}': ${why}` });
    if (!SUBCOMMAND_RE.test(name)) return bad("하위 명령 이름은 영문 소문자·숫자·_- 40자까지예요.");
    if (!t || typeof t !== "object") return bad("객체여야 해요.");
    if (typeof t.entry !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,99}\.py$/.test(t.entry) || t.entry.split("/").some((p) => p === ".." || p === "." || !p)) return bad("entry 는 툴킷 폴더 안의 .py 상대 경로여야 해요.");
    const entryFull = path.resolve(toolkitDir, ...t.entry.split("/"));
    if (!entryFull.startsWith(path.resolve(toolkitDir) + path.sep)) return bad("entry 가 툴킷 폴더 밖이에요.");
    const args = [];
    for (const a of t.args ?? []) {
      if (!a || typeof a !== "object" || !ARG_NAME_RE.test(a.name ?? "")) return bad("args 의 name 은 영문 소문자·숫자·_ 40자까지예요.");
      if (!["string", "int", "path"].includes(a.type)) return bad(`args '${a.name}' 의 type 은 string|int|path 예요.`);
      if (args.some((x) => x.name === a.name)) return bad(`args '${a.name}' 가 두 번 있어요.`);
      args.push({ name: a.name, type: a.type, required: a.required === true });
    }
    if (t.args !== undefined && !Array.isArray(t.args)) return bad("args 는 배열이어야 해요.");
    const secrets = t.secrets ?? [];
    if (!Array.isArray(secrets) || secrets.some((s) => typeof s !== "string" || !SECRET_NAME_RE.test(s))) return bad("secrets 는 키 이름(대문자·숫자·_) 배열이에요.");
    const timeoutSec = t.timeoutSec === undefined ? 120 : t.timeoutSec;
    if (!Number.isInteger(timeoutSec) || timeoutSec < 1 || timeoutSec > LIMITS.toolTimeoutCapSec) return bad(`timeoutSec 는 1~${LIMITS.toolTimeoutCapSec} 정수예요.`);
    const optional = t.optionalSecrets ?? [];
    if (!Array.isArray(optional) || optional.some((s) => typeof s !== "string" || !SECRET_NAME_RE.test(s))) return bad("optionalSecrets 는 키 이름(대문자·숫자·_) 배열이에요.");
    tools[name] = { entry: t.entry, entryFull, args, timeoutSec, network: t.network === true, enabled: t.enabled !== false, manual: t.manual === true, layer: t.layer === "studio" || t.layer === "internal" ? t.layer : "", secrets: [...new Set(secrets)], optionalSecrets: [...new Set(optional)].filter((n) => !secrets.includes(n)) };
  }
  return { ok: true, tools, studioTools: readStudioDefaults(m.studioTools) };
}

/** tools.json 최상위 studioTools → { 도구: { 결과 종류: 기본 방식 } }. 없거나 깨졌으면 {} (옛 tools.json 은 지금처럼 동작) */
function readStudioDefaults(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, t] of Object.entries(raw)) {
    if (!SUBCOMMAND_RE.test(id) || !t || typeof t !== "object" || !t.kinds || typeof t.kinds !== "object" || Array.isArray(t.kinds)) continue;
    out[id] = {};
    for (const [kind, k] of Object.entries(t.kinds)) {
      if (SUBCOMMAND_RE.test(kind) && k && typeof k === "object" && typeof k.defaultMethod === "string" && ARG_NAME_RE.test(k.defaultMethod)) out[id][kind] = k.defaultMethod;
    }
  }
  return out;
}

/** 프로젝트 설정의 결과 종류별 방식: methods.<kind>.default, 없으면 allowed 의 첫 방식. 없으면 "" */
export function projectDefaultMethod(settings, kind) {
  const m = settings?.methods && typeof settings.methods === "object" ? settings.methods[kind] : null;
  if (!m || typeof m !== "object") return "";
  if (typeof m.default === "string") return m.default;
  return Array.isArray(m.allowed) && typeof m.allowed[0] === "string" ? m.allowed[0] : "";
}

/** 이 호출의 방법: 요청의 method 인자 > 프로젝트 설정(자동으로 붙는 settings 파일의 기본 방식) > 툴킷이 알려 준 결과 종류의 기본 방식. 없으면 "" */
export function callMethod(command, given, studioDefaults = {}, projectSettings = null) {
  return typeof given.method === "string" && given.method ? given.method : (projectDefaultMethod(projectSettings, given.kind) || (studioDefaults[command]?.[given.kind] ?? ""));
}

/**
 * 이 호출에서 실제로 필요한 선택 키 이름 — 설명서(tools/manifests)의 '방법 → 키'와 tools.json 의 optionalSecrets 를 합쳐 한 곳(toolmanifest.mjs secretsForMethod)에서 정한다.
 * projectSettings 는 settings 인자가 자동으로 붙는 호출에서만 넘긴다(AI 가 다른 settings 파일을 주면 툴킷이 판단하므로 읽지 않는다)
 */
export function neededOptionalSecrets(command, tool, given, studioDefaults = {}, projectSettings = null, manifest = null) {
  if (!tool.optionalSecrets?.length && !manifest) return [];
  const method = callMethod(command, given, studioDefaults, projectSettings);
  return method ? secretsForMethod(tool, method, manifest) : [];
}

/** 툴킷 목록에 선언된 비밀값 이름(중계가 켜져 있으면 AI 환경에서 빼고 도구에만 준다) */
/** 일감(자동 실행) 안에서 쓸 수 있는 도구만: enabled=false(꺼짐)·manual=true(사람이 직접 쓰는 도구)는 뺀다. 필드가 없으면 허용 */
export function jobUsableTools(tools) {
  return Object.fromEntries(Object.entries(tools).filter(([, t]) => t.enabled !== false && t.manual !== true));
}

export function toolkitSecretNames(toolkitDir) {
  const m = loadToolkitManifest(toolkitDir);
  const fromTools = m.ok ? Object.values(m.tools).flatMap((t) => [...t.secrets, ...t.optionalSecrets]) : [];
  return [...new Set([...fromTools, ...manifestSecretNames(toolkitDir)])]; // 설명서에만 적힌 키도 도구 전용
}

// ───────── 도구 어댑터 ─────────
// 어댑터 인터페이스: { name, cost(args) → 비용 단위(정수), validate(args, ctx) → { ok, value } | { ok:false, reason, status? }, run(value, ctx) → 응답 }
// run 의 결과: { status: ok|failed|timeout, message, files?: [상대경로], output?, result? }. 비밀값은 ctx.secretsFor 로만 받는다.
// PixelLab 같은 외부 서비스는 다음 단계에 이 인터페이스로 추가한다(이번 단계에는 없음).
const echoAdapter = {
  name: "echo",
  cost: () => 0,
  validate(args) {
    const text = JSON.stringify(args);
    if (text.length > 4000) return { ok: false, reason: "echo 의 args 는 4000자까지예요." };
    return { ok: true, value: args };
  },
  async run(value) {
    return { status: "ok", message: "echo: 받은 args 를 그대로 돌려줘요(중계 경로 확인용).", result: value };
  },
};

const toolkitAdapter = {
  name: "toolkit.run",
  cost: () => 1,
  validate(args, ctx) {
    const keys = Object.keys(args);
    if (keys.some((k) => !["command", "args"].includes(k))) return { ok: false, reason: 'toolkit.run 의 args 는 { "command", "args" } 만 받아요.' };
    if (typeof args.command !== "string" || !SUBCOMMAND_RE.test(args.command)) return { ok: false, reason: "command(하위 명령 이름) 형식이 올바르지 않아요." };
    const manifest = loadToolkitManifest(ctx.toolkitDir);
    if (!manifest.ok) return { ok: false, status: manifest.missing ? "failed" : "denied", reason: manifest.reason };
    const tool = Object.hasOwn(manifest.tools, args.command) ? manifest.tools[args.command] : null;
    if (!tool) return { ok: false, reason: `tools.json 에 없는 하위 명령이에요: ${args.command}` };
    if (tool.enabled === false) return { ok: false, reason: `꺼져 있는 도구라 실행할 수 없어요: ${args.command}` };
    if (tool.manual === true) return { ok: false, reason: `사람이 직접 쓰는 도구라 일감 안에서는 실행할 수 없어요: ${args.command}` };
    const given = args.args === undefined ? {} : args.args;
    if (!given || typeof given !== "object" || Array.isArray(given)) return { ok: false, reason: "toolkit.run 의 args.args 는 객체여야 해요." };
    const unknown = Object.keys(given).filter((k) => !tool.args.some((a) => a.name === k));
    if (unknown.length) return { ok: false, reason: `선언되지 않은 인자: ${unknown.slice(0, 5).join(", ")}` };
    const argv = [];
    for (const a of tool.args) {
      const v = given[a.name];
      if (v === undefined || v === null) {
        if (a.required) return { ok: false, reason: `필수 인자가 없어요: ${a.name}` };
        continue;
      }
      if (a.type === "int") {
        if (!Number.isSafeInteger(v)) return { ok: false, reason: `${a.name} 은 정수여야 해요.` };
        argv.push(`--${a.name}=${v}`);
      } else if (a.type === "path") {
        const p = safeAppPath(ctx.appDir, v);
        if (!p.ok) return { ok: false, reason: `${a.name}: ${p.reason}` };
        argv.push(`--${a.name}=${p.rel}`);
      } else {
        if (typeof v !== "string" || v.length > 500 || /[\0\r\n]/.test(v)) return { ok: false, reason: `${a.name} 은 줄바꿈 없는 500자 이하 문자열이어야 해요.` };
        argv.push(`--${a.name}=${v}`);
      }
    }
    // settings 인자가 없으면 프로젝트 설정 파일(.factory/project-settings.json)을 자동으로 붙인다(요청의 인자 > 프로젝트 설정 > 도구 기본값)
    let autoSettings = null;
    if (tool.layer === "studio" && tool.args.some((a) => a.name === "settings" && a.type === "path") && (given.settings === undefined || given.settings === null)) {
      autoSettings = readProjectSettings(ctx.appDir);
      if (autoSettings) argv.push(`--settings=${autoSettings.rel}`);
    }
    // refs 인자가 없으면 이번 일감에서 '참고로 고른' 승인 그림(.factory/art-refs.json)을 자동으로 붙인다(먼저 참고됨, 최대 4장). 요청에 refs 를 적었으면 그 값을 따른다
    if (tool.layer === "studio" && tool.args.some((a) => a.name === "refs" && a.type !== "path" && a.type !== "int") && (given.refs === undefined || given.refs === null)) {
      const urls = [];
      for (const u of readPickedRefs(ctx.appDir)) if ([...urls, u].join(",").length <= 500) urls.push(u);
      if (urls.length) argv.push(`--refs=${urls.join(",")}`);
    }
    // 네트워크·비밀값이 필요한 도구는 '허용' 모드이면서 이 일감의 requiredSecrets 에 이름이 있을 때만
    // 선택 키(optionalSecrets)는 이 호출에 실제로 필요할 때(pixel-art 의 method=pixellab)만 필수 키처럼 검사하고 넘긴다
    const toolManifest = loadManifestIndex(ctx.toolkitDir)[args.command] ?? null;
    const optional = neededOptionalSecrets(args.command, tool, given, manifest.studioTools, autoSettings?.settings ?? null, toolManifest);
    const need = [...tool.secrets, ...optional];
    if (tool.network || need.length) {
      if (ctx.mode !== "allow") return { ok: false, reason: "네트워크·키가 필요한 도구는 '허용' 모드에서만 실행해요." };
      const missing = need.filter((n) => !ctx.requiredSecrets.includes(n));
      if (missing.length) {
        const m = toolManifest ? manifestMethod(toolManifest, callMethod(args.command, given, manifest.studioTools, autoSettings?.settings ?? null)) : null;
        return { ok: false, reason: `이 일감에 허용되지 않은 키가 필요해요: ${missing.join(", ")} (일감의 필요한 키에 넣어야 해요${m ? ` — 도구 설명서: ${m.id} 방법에 필요한 키` : ""})` };
      }
      const absent = need.filter((n) => !ctx.hasSecret(n));
      if (absent.length) return { ok: false, status: "failed", reason: `이 PC 의 키 파일에 없는 키: ${absent.join(", ")}` };
    }
    if (!fs.existsSync(tool.entryFull) || isLink(tool.entryFull)) return { ok: false, status: "failed", reason: `툴킷 진입점이 없어요: ${tool.entry}` };
    return { ok: true, value: { command: args.command, tool, argv, need } };
  },
  async run({ command, tool, argv, need = tool.secrets }, ctx) {
    const assets = factoryDir(ctx.appDir, "assets");
    const env = { PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", FACTORY_APP_DIR: ctx.appDir, FACTORY_ASSETS_DIR: assets, FACTORY_REQUEST_ID: ctx.requestId };
    // AI·감독 프로그램의 환경(토큰 등)은 물려주지 않는다. 실행에 필요한 최소 변수 + 이 도구에 선언된 키만
    for (const k of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "LANG"]) {
      if (process.env[k] !== undefined) env[k] = process.env[k];
    }
    Object.assign(env, ctx.secretsFor(need));
    // 통제실 제한 시간이 0(제한 없음)이면 tools.json 에 도구가 선언한 시간만 쓴다
    const timeoutSec = ctx.toolTimeoutSec > 0 ? Math.min(tool.timeoutSec, ctx.toolTimeoutSec) : tool.timeoutSec;
    const started = Date.now();
    const r = await runFixed(ctx.pythonCmd, [tool.entryFull, command, ...argv], { cwd: ctx.appDir, env, timeoutMs: timeoutSec * 1000, spawnImpl: ctx.spawnImpl, onChild: ctx.onChild });
    const files = listNewFiles(ctx.appDir, assets, started);
    const output = ctx.redact(r.output).slice(-LIMITS.outputSummary);
    if (r.timedOut) return { status: "timeout", message: `도구 실행 시간 초과(${timeoutSec}초)`, files, output };
    if (r.error) return { status: "failed", message: `도구를 실행하지 못했어요: ${ctx.redact(r.error).slice(0, 300)}`, files, output };
    const art = tool.layer === "studio" ? summarizeStudioResult(ctx.appDir, argv, r.code === 0, r.output) : null;
    const confirm = art?.needsConfirmation ? " (PixelLab 비용 한도 초과 — 승인 필요)" : "";
    // 그림 저장소에 후보로 올릴 원본 정보(result.json 전체 요약). 응답 파일·보고에는 싣지 않고 onArt 로만 넘긴다
    const artSource = tool.layer === "studio" && r.code === 0 ? readStudioArtSource(ctx.appDir, argv) : null;
    return { status: r.code === 0 ? "ok" : "failed", message: r.code === 0 ? `${command} 완료` : `${command} 실패(종료 코드 ${r.code})${confirm}`, files, output, ...(art ? { art } : {}), ...(artSource ? { artSource } : {}) };
  },
};

const RESULT_JSON_BYTES = 256 * 1024;
const clipText = (v, n) => maskText(String(v ?? "")).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

/**
 * 스튜디오 도구(pixel-art) 실행 결과 요약: output_dir/result.json 에서 대상 이름·결과 종류·방식·참고 그림·비용만 뽑는다(프롬프트·경로·키는 담지 않는다).
 * 실패했는데 출력에 needs_confirmation:true 가 있으면 PixelLab 비용 한도 초과(승인 필요)로 표시한다. 읽을 게 없으면 null
 */
export function summarizeStudioResult(appDir, argv, ok, output) {
  if (!ok) return /"needs_confirmation"\s*:\s*true/.test(String(output ?? "")) ? { needsConfirmation: true } : null;
  const dirArg = argv.find((a) => a.startsWith("--output_dir="));
  if (!dirArg) return null;
  const p = safeAppPath(appDir, `${dirArg.slice("--output_dir=".length)}/result.json`);
  if (!p.ok) return null;
  try {
    const st = fs.lstatSync(p.full);
    if (st.isSymbolicLink() || !st.isFile() || st.size > RESULT_JSON_BYTES) return null;
    const j = JSON.parse(fs.readFileSync(p.full, "utf8").replace(/^\uFEFF/, ""));
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    const refs = Array.isArray(j.refs) ? j.refs : [];
    const cost = typeof j.cost === "number" ? j.cost : typeof j.cost?.pixellab_calls === "number" ? j.cost.pixellab_calls : typeof j.cost?.calls === "number" ? j.cost.calls : 0;
    return {
      subject: clipText(j.subject, 60),
      kind: /^[a-z][a-z0-9_-]{0,39}$/.test(j.kind ?? "") ? j.kind : "",
      method: /^[a-z][a-z0-9_]{0,39}$/.test(j.method ?? "") ? j.method : "",
      refs: refs.length,
      refReasons: [...new Set(refs.map((r) => (typeof r?.reason === "string" ? r.reason : "")).filter((x) => /^[①②③④A-Za-z0-9_-]{1,24}$/.test(x)))].slice(0, 4),
      refsFallback: clipText(j.refs_fallback, 100),
      cost: Number.isFinite(cost) && cost >= 0 ? Math.min(cost, 100000) : 0,
    };
  } catch {
    return null;
  }
}

/**
 * 그림 저장소에 후보로 올릴 정보: output_dir/result.json 의 project·subject·kind·method·outputs(앱 폴더 기준 경로)와 steps·refs·cost 요약.
 * 프롬프트·인자 값·키는 담지 않는다(steps 는 도구 이름만). 읽을 게 없거나 subject·kind 가 없으면 null
 */
export function readStudioArtSource(appDir, argv) {
  const dirArg = argv.find((a) => a.startsWith("--output_dir="));
  if (!dirArg) return null;
  const p = safeAppPath(appDir, `${dirArg.slice("--output_dir=".length)}/result.json`);
  if (!p.ok) return null;
  try {
    const st = fs.lstatSync(p.full);
    if (st.isSymbolicLink() || !st.isFile() || st.size > RESULT_JSON_BYTES) return null;
    const j = JSON.parse(fs.readFileSync(p.full, "utf8").replace(/^﻿/, ""));
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    const subject = clipText(j.subject, 60);
    if (!subject || !ART_KINDS.includes(j.kind)) return null;
    const refs = Array.isArray(j.refs) ? j.refs : [];
    const cost = typeof j.cost === "number" ? j.cost : typeof j.cost?.pixellab_calls === "number" ? j.cost.pixellab_calls : typeof j.cost?.calls === "number" ? j.cost.calls : 0;
    return {
      project: typeof j.project === "string" ? j.project.trim().slice(0, 40) : "",
      subject,
      kind: j.kind,
      method: /^[a-z][a-z0-9_]{0,39}$/.test(j.method ?? "") ? j.method : "",
      outputs: (Array.isArray(j.outputs) ? j.outputs : []).filter((o) => typeof o === "string" && o.length <= 300).slice(0, 40),
      summary: {
        steps: (Array.isArray(j.steps) ? j.steps : []).map((s) => (typeof s?.tool === "string" ? s.tool : "")).filter((x) => /^[A-Za-z0-9_.-]{1,40}$/.test(x)).slice(0, 12),
        refs: refs.map((r) => (typeof r?.reason === "string" ? r.reason : "")).filter((x) => /^[①②③④A-Za-z0-9_-]{1,24}$/.test(x)).slice(0, 8),
        refsFallback: clipText(j.refs_fallback, 100),
        cost: Number.isFinite(cost) && cost >= 0 ? Math.min(Math.floor(cost), 100000) : 0,
      },
    };
  } catch {
    return null;
  }
}

export const ADAPTERS = Object.freeze({ echo: echoAdapter, "toolkit.run": toolkitAdapter });

function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    if (IS_WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 5000 });
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    /* 이미 끝남 */
  }
}

// 셸 없이 고정 배열로 실행. 출력은 뒤쪽 64KB 만 모은다
function runFixed(command, args, { cwd, env, timeoutMs, spawnImpl = spawn, onChild = () => {} }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(command, args, { cwd, env, shell: false, windowsHide: true, detached: !IS_WIN, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ error: e.message, output: "" });
      return;
    }
    onChild(child);
    let output = "";
    let timedOut = false;
    let done = false;
    const add = (d) => {
      output = (output + d).slice(-LIMITS.outputBytes);
    };
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const end = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      onChild(null);
      resolve({ output, timedOut, ...v });
    };
    child.on("error", (e) => end({ error: e.message }));
    child.on("close", (code) => end({ code }));
  });
}

function listNewFiles(appDir, dir, since) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 4 || out.length >= LIMITS.files) return;
    let names = [];
    try {
      names = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of names) {
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile()) {
        try {
          if (fs.statSync(full).mtimeMs >= since - 1000) out.push(path.relative(appDir, full).split(path.sep).join("/"));
        } catch {
          /* 사라짐 */
        }
      }
      if (out.length >= LIMITS.files) return;
    }
  };
  walk(dir, 0);
  return out.sort();
}

// ───────── 중계기 ─────────
let toolBusy = false; // 이 PC 전체에서 도구는 한 번에 하나만 돈다(여러 일감이 동시에 돌아도)

/**
 * 일감 하나의 중계기. 일감의 AI 프로세스가 도는 동안 start() 로 몇 초마다 요청을 확인하고, 끝나면 stop().
 * opts: { appDir, jobId, engine, getSettings() → brokerSettings, toolkitDir, pythonCmd, requiredSecrets, secrets(이름→값, 이 일감에 허용된 것만),
 *         redact(s), log(m), onChange(), onResult(rec) (요청 하나가 끝날 때마다, rec.status 가 ok 면 결과 파일이 생겼을 수 있음), spawnImpl }
 */
export function createBroker(opts) {
  const { appDir, jobId, engine = "claude", toolkitDir, pythonCmd = IS_WIN ? "python" : "python3", requiredSecrets = [], secrets = {}, onChange = () => {}, spawnImpl } = opts;
  const getSettings = opts.getSettings ?? (() => brokerSettings(null));
  const redactBase = opts.redact ?? ((s) => s);
  const secretValues = Object.values(secrets).filter((v) => typeof v === "string" && v.length >= 4);
  // 비밀값은 어떤 경로로든 다시 한 번 가린다
  const redact = (s) => maskText(secretValues.reduce((acc, v) => acc.split(v).join("***"), redactBase(String(s ?? ""))));
  const log = opts.log ?? (() => {});
  const onResult = opts.onResult ?? (() => {});
  const onArt = opts.onArt ?? (() => {}); // pixel-art 결과(후보로 올릴 그림 정보)
  const refreshArts = opts.refreshArts ?? null; // async () => void : 스튜디오 도구 실행 직전에 승인 그림 목록을 최신으로 갈아 끼운다
  const seen = new Set();
  const records = []; // 통제실에 보일 목록: { id, tool, command?, status, at, ms, message }
  let timer = null;
  let ticking = null;
  let stopped = false;
  let child = null;
  let handled = 0;

  const event = (rec) => {
    try {
      const file = path.join(appDir, ".factory", "ai-events.jsonl");
      if (isLink(file)) return;
      fs.appendFileSync(file, JSON.stringify({ engine, phase: "tool-request", taskId: jobId, requestId: rec.id, tool: rec.tool, status: rec.status, ms: rec.ms, at: rec.at }) + "\n", { mode: 0o600 });
    } catch {
      /* 기록 실패는 무시 */
    }
  };

  const respond = (id, tool, body, startedAt, command = null, artSource = null) => {
    const dir = factoryDir(appDir, "responses");
    const file = path.join(dir, `${id}.json`);
    if (isLink(file)) throw new Error("응답 파일 자리에 심볼릭 링크가 있어요.");
    const finishedAt = new Date();
    const out = JSON.parse(JSON.stringify({ id, tool, ...body, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString() }, (_k, v) => (typeof v === "string" ? redact(v) : v)));
    const tmp = path.join(dir, `.${id}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, file);
    const rec = { id, tool: tool ?? "?", ...(command ? { command } : {}), ...(out.art ? { art: out.art } : {}), status: out.status, at: startedAt.toISOString(), ms: finishedAt - startedAt, message: String(out.message ?? "").slice(0, 200) };
    records.push(rec);
    if (records.length > 100) records.shift();
    event(rec);
    log(`도구 요청 ${id} (${rec.tool}): ${rec.status}${rec.status === "ok" ? "" : ` - ${rec.message}`}`);
    onChange();
    try {
      onResult({ ...rec });
    } catch {
      /* 결과 알림 실패는 중계에 영향 없음 */
    }
    if (artSource && out.status === "ok") {
      try {
        onArt(artSource);
      } catch {
        /* 그림 등록 실패는 중계에 영향 없음 */
      }
    }
    return out;
  };

  async function handle(id, file) {
    const startedAt = new Date();
    const settings = getSettings();
    handled++; // 거부된 요청도 센다
    if (settings.maxRequests > 0 && handled > settings.maxRequests) return respond(id, null, { status: "denied", message: `이 일감의 도구 요청 상한(${settings.maxRequests}개)을 넘었어요.`, files: [] }, startedAt);
    const parsed = readRequest(file, id);
    if (!parsed.ok) return respond(id, null, { status: "denied", message: parsed.reason, files: [] }, startedAt);
    const { req } = parsed;
    const adapter = ADAPTERS[req.tool];
    const ctx = {
      appDir,
      requestId: id,
      mode: settings.mode,
      toolkitDir,
      pythonCmd,
      requiredSecrets,
      toolTimeoutSec: settings.toolTimeoutSec,
      hasSecret: (n) => requiredSecrets.includes(n) && typeof secrets[n] === "string" && secrets[n] !== "",
      secretsFor: (names) => Object.fromEntries(names.filter((n) => requiredSecrets.includes(n) && typeof secrets[n] === "string").map((n) => [n, secrets[n]])),
      redact,
      spawnImpl,
      onChild: (c) => {
        child = c;
      },
    };
    // 기록에는 하위 명령 이름만 남긴다(인자 값은 남기지 않음)
    const command = req.tool === "toolkit.run" && typeof req.args?.command === "string" && SUBCOMMAND_RE.test(req.args.command) ? req.args.command : null;
    // 스튜디오 도구를 부르기 전에 승인 그림 목록을 최신으로(그 사이에 승인·반려했을 수 있다). 실패해도 일감 시작 때 받은 목록으로 계속한다
    if (refreshArts && req.tool === "toolkit.run" && command) {
      try {
        await refreshArts();
      } catch {
        /* 못 받으면 기존 목록 */
      }
    }
    const v = adapter.validate(req.args, ctx);
    if (!v.ok) return respond(id, req.tool, { status: v.status ?? "denied", message: v.reason, files: [] }, startedAt, command);
    if (settings.mode === "report") return respond(id, req.tool, { status: "denied", message: "보고만 모드: 요청은 기록했지만 실행하지 않았어요.", files: [] }, startedAt, command);
    const r = await adapter.run(v.value, ctx);
    return respond(id, req.tool, { status: r.status, message: r.message, files: r.files ?? [], ...(r.output ? { output: r.output } : {}), ...(r.result !== undefined ? { result: r.result } : {}), ...(r.art ? { art: r.art } : {}), cost: adapter.cost(req.args) }, startedAt, command, r.artSource ?? null);
  }

  /** 한 번 확인: 응답이 없는 새 요청을 처리한다(꺼짐 모드면 아무것도 하지 않는다) */
  async function tick() {
    if (stopped || ticking) return ticking;
    ticking = (async () => {
      if (getSettings().mode === "off") return;
      const reqDir = path.join(appDir, ".factory", "requests");
      if (!fs.existsSync(reqDir) && !isLink(reqDir)) return;
      let names;
      try {
        factoryDir(appDir, "requests");
        names = fs.readdirSync(reqDir).filter((n) => n.endsWith(".json")).sort();
      } catch (e) {
        log(`도구 요청 폴더를 읽지 못했어요: ${redact(e.message)}`);
        return;
      }
      for (const name of names) {
        if (stopped) return;
        if (seen.has(name)) continue;
        const id = name.slice(0, -5);
        if (!REQUEST_ID_RE.test(id)) {
          seen.add(name);
          log(`도구 요청 파일 이름이 올바르지 않아 건너뛰어요: ${name.slice(0, 80)}`);
          continue;
        }
        if (fs.existsSync(path.join(appDir, ".factory", "responses", `${id}.json`))) {
          seen.add(name); // 이미 응답함(지난 실행 포함)
          continue;
        }
        if (getSettings().mode === "off") return;
        if (toolBusy) return; // 다른 일감의 도구가 도는 중: 다음 확인 때
        seen.add(name);
        toolBusy = true;
        try {
          await handle(id, path.join(reqDir, name));
        } catch (e) {
          try {
            respond(id, null, { status: "failed", message: `중계 오류: ${redact(e.message).slice(0, 300)}`, files: [] }, new Date());
          } catch {
            log(`도구 요청 ${id} 응답을 쓰지 못했어요: ${redact(e.message)}`);
          }
        } finally {
          toolBusy = false;
          child = null;
        }
      }
    })().finally(() => {
      ticking = null;
    });
    return ticking;
  }

  return {
    tick,
    start(pollMs = LIMITS.pollMs) {
      if (!timer && !stopped) timer = setInterval(() => void tick(), pollMs);
      return this;
    },
    /** 일감이 끝나거나 취소되면: 확인을 멈추고 돌던 도구도 끈다 */
    stop() {
      stopped = true;
      clearInterval(timer);
      timer = null;
      killTree(child);
    },
    list: () => records.map((r) => ({ ...r })),
  };
}

/** 툴킷 tools.json 에 실제로 있는 이미지 도구만 골라 안내한다(없는 도구 이름을 가리키지 않게). 툴킷이 없거나 이미지 도구가 없으면 "" */
export function imageToolRules(toolkitDir) {
  if (!toolkitDir) return "";
  const m = loadToolkitManifest(toolkitDir);
  if (!m.ok) return "";
  const usable = jobUsableTools(m.tools);
  const gen = ["pixel-codex", "pixel-generate"].filter((n) => Object.hasOwn(usable, n));
  if (!gen.length) return "";
  const lines = [
    `- 작업 중 이미지가 필요하면 toolkit.run 으로 ${gen.map((n) => `\`${n}\``).join(" 또는 ")} 를 요청하세요. 결과는 .factory/assets/(git 무시)에 생기고 통제실 일감 상세에서 볼 수 있어요.`,
    "- 결과 파일과 report.json 을 확인해서 이상하면(채움 비율 낮음, 색 수·크기 문제, 그림이 어색함) 설명이나 인자를 바꿔 다시 요청하세요(일감당 요청 한도 안에서). 같은 인자로 반복하지 마세요.",
  ];
  if (Object.hasOwn(usable, "asset-export")) {
    lines.push("- 좋으면 직접 복사하지 말고 `asset-export` 도구로 앱의 assets 폴더에 넣은 뒤, 코드에서 그 경로를 쓰고 커밋하세요. .factory/ 안 파일은 커밋되지 않아요.");
  }
  return lines.join("\n") + "\n";
}

/** 앱 폴더 작업 규칙(CLAUDE.md 공장 블록)에 붙일 사용법. 중계가 꺼져 있으면 붙이지 않는다. toolkitDir 을 주면 툴킷에 있는 이미지 도구 안내도 붙인다 */
export function brokerRules(mode, toolkitDir) {
  if (mode !== "report" && mode !== "allow") return "";
  const cli = TOOLREQ_PATH.replace(/\\/g, "/");
  return `
## 도구 요청 (감독 프로그램 중계${mode === "report" ? ", 지금은 보고만 모드라 실행되지 않음" : ""})
- 외부 서비스·게임 툴킷이 필요하면 직접 실행하거나 키를 찾지 말고 요청서를 보내세요. 감독 프로그램이 허용된 도구만 대신 실행해요.
- args 를 JSON 파일로 쓴 뒤 한 줄로: \`node "${cli}" submit --tool <echo|toolkit.run> --args-file <json파일>\` (응답이 올 때까지 기다렸다가 상태와 응답 파일 경로를 출력해요. 기본 5분)
- 이 명령은 오래 걸릴 수 있으니 명령 제한 시간을 넉넉히(예: 360000ms) 주세요. 중간에 끊겼으면 \`node "${cli}" wait --id <요청ID>\` 로 이어서 기다리세요.
- toolkit.run 의 args: { "command": "<tools.json 의 하위 명령>", "args": { 이름: 값 } }. 경로 인자는 앱 폴더 안 상대 경로만 돼요.
- 방식·규격·스타일은 프로젝트 설정을 따르고 사람에게 묻지 않아요. \`pixel-art\` 는 settings 인자를 안 주면 프로젝트 설정(.factory/project-settings.json)이 자동으로 붙어요(요청에 적은 값 > 프로젝트 설정 > 도구 기본값). 묻는 경우는 PixelLab 비용 한도 초과(needs_confirmation)뿐이에요. 참고 그림도 자동이에요: 부영실이 승인한 그림(같은 대상 이름 → 같은 결과 종류)과 이번 일감에 '참고로 고른' 그림이 붙으니 refs 를 직접 찾지 않아도 돼요. 결과 그림은 후보로 자동 등록되고 부영실이 스튜디오에서 승인해야 이후 참고로 쓰여요.
- 결과: .factory/responses/<요청ID>.json(status ok|denied|failed|timeout, message, files), 만든 파일은 .factory/assets/ 아래. denied 면 이유를 읽고 같은 요청을 반복하지 마세요.
${imageToolRules(toolkitDir)}`;
}
