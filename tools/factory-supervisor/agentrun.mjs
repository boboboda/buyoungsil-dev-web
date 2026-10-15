// 에이전트 정의(agents/*.json)에서 실행 설정을 만든다: 권한 설정 파일(--settings), 환경변수, 명령 인자, Codex 옵션.
// 정의가 없거나 거절됐으면(agentSpec 이 null) 부르는 쪽이 예전 코드 그대로 돌린다. 이 파일의 결과는 스냅샷 시험(tests/agentspec.test.mjs)이 예전 코드의 결과와 비교한다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAgentDir } from "./agentspec.mjs";
import { safeEnv } from "./envfilter.mjs";
import { guardHookSettings } from "./serveraccess.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const AGENTS_DIR = path.join(HERE, "agents");

let loaded = null;
const warned = new Set();

/** 정의를 한 번 읽어 둔다(거절된 정의는 오류로만 남는다). 시험은 dir 로 다른 폴더를 줄 수 있다 */
export function loadAgents(dir = AGENTS_DIR, { force = false } = {}) {
  if (!loaded || force || loaded.dir !== dir) loaded = { dir, ...parseAgentDir(dir) };
  return loaded;
}
export function resetAgents() { loaded = null; warned.clear(); }

/** 에이전트 정의 하나. 없거나 거절됐거나 migrated 가 false 면 null(= 예전 코드 그대로). 거절 이유는 한 번만 경고로 남긴다 */
export function agentSpec(id, { dir, warn = (m) => console.warn(m) } = {}) {
  const all = loadAgents(dir);
  const spec = all.agents.get(id) ?? null;
  for (const e of all.errors) {
    const key = `${e.file}:${e.message}`;
    if (!warned.has(key)) { warned.add(key); warn(`[에이전트 정의] 거절: ${e.file} — ${e.message}`); }
  }
  return spec && spec.migrated ? spec : null;
}

// ───────── 경로 규칙 ─────────
export const slash = (p) => path.resolve(p).replace(/\\/g, "/");
// Claude 권한 규칙의 절대 경로는 //경로. 윈도우 경로는 POSIX 꼴로(C:\Users\x → //c/Users/x)
export const ruleAbs = (p) => slash(p).replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase()).replace(/^\/+/, "");

/**
 * 경로 규칙 글자 하나 → Claude 권한 규칙 목록.
 *   edit:/read: + @factory/<경로>(공장 폴더) | @work/<경로>(작업 폴더) | @shared/<경로>(공용 폴더) | ~/<경로> | @protected/**(보호 폴더들) | @entries(공장 폴더 직속 항목)
 * ctx: { workDir, dir, shared, protectedDirs, entriesExcept }
 */
export function rulesOf(token, ctx) {
  if (token === "Bash") return ["Bash"];
  const m = /^(edit|read):(.+)$/.exec(token);
  if (!m) throw new Error(`경로 규칙 글자가 올바르지 않아요: ${token}`);
  const verb = m[1] === "edit" ? "Edit" : "Read";
  const pat = m[2];
  if (pat === "@entries") {
    let entries = [];
    try { entries = fs.readdirSync(ctx.workDir, { withFileTypes: true }); } catch { /* 읽을 수 없으면 공통 규칙만 */ }
    const base = ruleAbs(ctx.workDir);
    return entries.filter((e) => !(ctx.entriesExcept ?? []).includes(e.name)).map((e) => (e.isDirectory() ? `${verb}(//${base}/${e.name}/**)` : `${verb}(//${base}/${e.name})`));
  }
  if (pat === "@protected/**") return (ctx.protectedDirs ?? []).map((d) => `${verb}(//${ruleAbs(d)}/**)`);
  if (pat.startsWith("~/")) return [`${verb}(${pat})`];
  const root = pat.startsWith("@factory/") ? ctx.workDir : pat.startsWith("@work/") ? ctx.dir : pat.startsWith("@shared/") ? ctx.shared : null;
  if (!root) throw new Error(`경로 규칙 글자가 올바르지 않아요: ${token}`);
  return [`${verb}(//${ruleAbs(root)}/${pat.slice(pat.indexOf("/") + 1)})`];
}

const HOOK_BUILDERS = { "ssh-guard": () => guardHookSettings() };

/** 정의 → Claude 설정 파일 내용 { permissions: { allow?, deny, additionalDirectories? }, hooks } */
export function settingsOf(spec, ctx) {
  const p = spec.paths;
  const c = { ...ctx, entriesExcept: p.entriesExcept ?? [] };
  const allow = (p.allow ?? []).flatMap((t) => rulesOf(t, c));
  const deny = [...new Set((p.deny ?? []).flatMap((t) => rulesOf(t, c)))];
  const permissions = {};
  if (allow.length) permissions.allow = allow;
  permissions.deny = deny;
  if (p.additionalDirectories?.length) permissions.additionalDirectories = p.additionalDirectories.map((d) => slash(ctx[d.slice(1)]));
  const hooks = {};
  for (const h of spec.hooks) {
    const build = HOOK_BUILDERS[h];
    if (!build) throw new Error(`이 종류에서 쓸 수 없는 훅이에요: ${h}`); // maintenance-guard 는 정비(M1)가 자기 코드로 붙인다
    Object.assign(hooks, build());
  }
  return { permissions, hooks };
}

/** 권한 설정 파일을 쓰고 경로(슬래시)를 돌려준다. 설정 파일은 공장 폴더 안(spec.paths.settingsFile, {jobId} 자리표시 가능)에 둔다 */
export function writeSettings(spec, ctx) {
  const rel = String(spec.paths.settingsFile).replace("{jobId}", ctx.jobId ?? "");
  if (rel.includes("{")) throw new Error("설정 파일 이름의 자리표시를 채우지 못했어요.");
  const file = path.join(ctx.workDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settingsOf(spec, ctx), null, 2));
  return slash(file);
}

// ───────── 환경변수 ─────────
/** 정의 → AI 에게 넘길 환경. extra(키 결정이 정한 값)는 먼저, 정의의 FACTORY_* 값은 그 뒤에 얹어 비밀 이름으로 덮어쓸 수 없게 한다 */
export function envOf(spec, base, ctx, extra = {}) {
  const set = {};
  for (const [name, value] of Object.entries(spec.env.set ?? {})) {
    if (value.startsWith("@")) {
      const v = value === "@job.id" ? ctx.jobId : value === "@job.appSlug" ? ctx.appSlug : ctx[value.slice(1)];
      if (v === undefined || v === null) continue; // 이번 실행에 없는 값(예: 잠금 표시 파일)은 넣지 않는다
      set[name] = v;
    } else set[name] = value;
  }
  return safeEnv(base, { ...extra, ...set });
}

// ───────── 명령 인자 ─────────
/** startAi 에 넘길 cfg: 정의의 권한 방식·허용 도구를 기본값으로 깐다. 사용자 설정(cfg)이 우선인지는 tools.allowFromConfig 가 정한다 */
export function cfgOf(spec, cfg = {}) {
  const out = { ...cfg };
  if (!out.permissionMode) out.permissionMode = spec.tools.mode;
  if (!(spec.tools.allowFromConfig && out.allowedTools)) out.allowedTools = spec.tools.allow.join(",");
  return out;
}

/** 한 번 묻고 끝나는 읽기 전용 실행(지휘자)의 claude 인자. 프롬프트는 표준입력으로 간다 */
export function oneshotArgs(spec, model) {
  const t = spec.tools;
  const args = ["-p", "--output-format", spec.cli.output, "--permission-mode", t.mode];
  if (t.only) args.push("--tools", t.only.join(","));
  args.push("--allowedTools", t.allow.join(","));
  if (t.deny?.length) args.push("--disallowedTools", t.deny.join(","));
  if (spec.cli.strictMcp) args.push("--strict-mcp-config");
  if (spec.cli.noSessionPersistence) args.push("--no-session-persistence");
  args.push("--model", model);
  return args;
}

/** Codex 옵션(실험): 쓰기 가능한 추가 폴더와 네트워크 */
export function codexOptionsOf(spec, ctx) {
  return { writableRoots: (spec.network.writableRoots ?? []).map((r) => slash(ctx[r.slice(1)])), network: spec.network.codex === "on" };
}

/** 정의의 작업 공간 폴더: <공장>/<root>/<id> (실험·도구 일감처럼 일감마다 폴더가 있는 종류) */
export function workspaceDirOf(spec, workDir, id) {
  return path.join(workDir, spec.workspace.root, id);
}
