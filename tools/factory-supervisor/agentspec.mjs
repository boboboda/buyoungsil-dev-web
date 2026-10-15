// 에이전트 블록 정의(AgentSpec)와 흐름(Flow)을 읽고 검사한다. 순수 함수만 있다(감독 프로그램·홈페이지 서버·시험이 같이 쓴다).
//   agents/*.json        에이전트 종류 하나당 정의 파일 하나 (A1 새 앱, A2 수정, A3 병행, A4 다시 맞추기, R1 출시, L1 실험, M1 정비, C1 지휘자, H1 정리, T 도구 일감)
//   agents/flows/*.json  일감 종류별 블록 순서와 조건
// 권한 상한(CEILING): 정의는 감독 훅·deny 규칙보다 넓힐 수 없다. 넓히는 정의는 읽을 때 거절하고(오류로 모음), 감독 프로그램은 그 종류를 예전 코드 그대로 돌린다.
import fs from "node:fs";
import path from "node:path";
import { SECRET_ENV_RE } from "./envfilter.mjs";

export const SCHEMA_VERSION = 1;

/** 에이전트 종류 번호 → 일감 쪽 이름 */
export const AGENT_IDS = { A1: "new", A2: "revision", A3: "parallel", A4: "realign", R1: "release", L1: "lab", M1: "maintenance", C1: "conductor", H1: "cleanup", T: "tool" };

// ───────── 허용 값 목록 ─────────
const ENGINES = ["claude", "codex", "none"];
const MODEL_SOURCES = ["job", "task", "config", "none"];
const WORKSPACES = ["app-folder", "app-worktree", "lab-folder", "tool-folder", "maintenance-checkout", "none"];
const CLI_STYLES = ["stream", "oneshot", "none"];
const OUTPUTS = ["stream-json", "json"];
const HOOKS = ["ssh-guard", "maintenance-guard"];
const KEY_DECISIONS = ["none", "job-required", "job-required+release-key", "tool-method"];
const TEMPLATES = ["app-new", "app-revision", "app-realign", "release", "lab", "conductor-verdict", "maintenance", "compact", "none"];
const RULE_FILES = ["app-rules-block", "maintenance-local", null];
const AFTER_STEPS = ["verify", "commit", "outbox", "compact", "merge", "lab-repo-check", "upload-outputs", "art-upload", "release-finish", "report", "none"];
const GATES = ["approval", "merge-check", "verify", "deploy", "report"];
const CONDITIONS = ["same-app-pending>=2", "grouped", "rebase-conflict", "cost-over-limit", "release-review-required"];
const ENV_SOURCES = ["job.id", "job.appSlug", "dir", "shared", "lockDir", "waitFile", "threadId", "turnId"];
const NO_PATHS = ["M1", "H1"]; // 경로 규칙을 이 정의가 아니라 각자의 코드(정비 설정 등)가 만든다: 이 두 종류만 managedBy 로 건너뛸 수 있다

/** 권한 상한 — 이 값들은 코드에 있고 정의 파일로는 바꿀 수 없다 */
export const CEILING = {
  tools: ["Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebFetch", "WebSearch"], // 기본 허용 도구 목록과 같다. Task·Agent·NotebookEdit·MCP 는 정의로 열 수 없다
  modes: ["default", "acceptEdits"],
  readOnlyIds: ["C1"],
  readOnlyTools: ["Read", "Glob", "Grep"],
  readOnlyBlocked: ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Agent"],
  allowTokens: ["read:@factory/**", "edit:@work/**", "edit:@shared/**", "Bash"],
  extraDirs: ["@shared"],
  denyFloor: ["edit:@protected/**", "edit:@factory/*.json", "edit:@factory/*.sh", "read:@factory/supervisor.config.json", "read:~/.ssh/**", "read:~/.aws/**"],
  denySecrets: { edit: ["edit:@factory/secrets.env", "edit:@factory/secrets.env*"], read: ["read:@factory/secrets.env", "read:@factory/secrets.env*"] },
  networkOnIds: ["L1"],
  maxTimeoutMs: 120 * 60_000,
  // 종류마다 작업 공간 종류와 폴더 이름은 코드(보호 규칙·정리 코드)가 전제로 삼는 값이라 정의로 옮길 수 없다
  workspaces: { A1: "app-folder", A2: "app-folder", A3: "app-worktree", A4: "app-worktree", R1: "app-folder", L1: "lab-folder", T: "tool-folder", C1: "app-folder", M1: "maintenance-checkout", H1: "app-folder" },
  roots: { L1: "lab", T: "tooljobs", A3: ".worktrees", A4: ".worktrees" },
  // 도구 일감 입력 한도는 서버(lib/factory/toolJobs.ts) 한도보다 크게 둘 수 없다
  toolInput: { maxSubjects: 8, maxCount: 8, maxTotal: 16 },
};

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.length > 0 && v.length <= 300;
const strList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 200);
const SAFE_NAME = /^[A-Za-z0-9._-]{1,40}$/;
const SAFE_REL = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._{}-]+(?:\/[A-Za-z0-9._{}-]+){0,3}$/;
const TOKEN_RE = /^(?!.*\.\.)(?:Bash|(?:edit|read):(?:@entries|@protected\/\*\*|@(?:factory|work|shared)\/[A-Za-z0-9._*/-]+|~\/[A-Za-z0-9._*/-]+))$/;

function oneOf(errors, label, value, list) {
  if (!list.includes(value)) errors.push(`${label}: 허용하지 않는 값이에요(${String(value).slice(0, 40)})`);
}
function listOf(errors, label, value, list) {
  if (!strList(value)) return errors.push(`${label}: 글 목록이어야 해요`);
  for (const v of value) if (!list.includes(v)) errors.push(`${label}: 허용하지 않는 항목이에요(${v.slice(0, 40)})`);
}

/** 에이전트 정의 하나 검사. 반환: 오류 문장 목록(비어 있으면 통과) */
export function validateAgent(spec) {
  const errors = [];
  if (!isObj(spec)) return ["정의가 객체가 아니에요"];
  if (spec.schema !== SCHEMA_VERSION) errors.push(`schema 는 ${SCHEMA_VERSION} 이어야 해요`);
  if (spec.type !== "agent") errors.push("type 은 agent 여야 해요");
  if (!Object.hasOwn(AGENT_IDS, spec.id)) errors.push(`id 가 올바르지 않아요(${String(spec.id).slice(0, 20)})`);
  else if (spec.kind !== AGENT_IDS[spec.id]) errors.push(`kind 는 ${AGENT_IDS[spec.id]} 여야 해요`);
  if (!isStr(spec.label)) errors.push("label 이 필요해요");
  if (typeof spec.migrated !== "boolean") errors.push("migrated 는 true/false 여야 해요");
  if (errors.length && !Object.hasOwn(AGENT_IDS, spec.id)) return errors;

  // 엔진·모델 규칙
  const eng = spec.engine;
  if (!isObj(eng)) errors.push("engine 이 필요해요");
  else {
    listOf(errors, "engine.allowed", eng.allowed, ENGINES);
    if (strList(eng.allowed) && !eng.allowed.includes(eng.default)) errors.push("engine.default 는 allowed 안에 있어야 해요");
    if (!isObj(eng.model)) errors.push("engine.model 이 필요해요");
    else for (const [k, v] of Object.entries(eng.model)) { if (!ENGINES.includes(k)) errors.push(`engine.model.${k}: 알 수 없는 엔진이에요`); oneOf(errors, `engine.model.${k}`, v, MODEL_SOURCES); }
  }
  // 작업 공간
  const ws = spec.workspace;
  if (!isObj(ws)) errors.push("workspace 가 필요해요");
  else {
    oneOf(errors, "workspace.type", ws.type, WORKSPACES);
    if (ws.root !== undefined && (typeof ws.root !== "string" || !SAFE_NAME.test(ws.root))) errors.push("workspace.root 는 폴더 이름 하나여야 해요");
    if (CEILING.workspaces[spec.id] && ws.type !== CEILING.workspaces[spec.id]) errors.push(`권한 상한: ${spec.id} 의 작업 공간은 ${CEILING.workspaces[spec.id]} 여야 해요`);
    if (CEILING.roots[spec.id] && ws.root !== CEILING.roots[spec.id]) errors.push(`권한 상한: ${spec.id} 의 workspace.root 는 ${CEILING.roots[spec.id]} 여야 해요`);
    if (!CEILING.roots[spec.id] && ws.root !== undefined) errors.push(`권한 상한: ${spec.id} 는 workspace.root 를 둘 수 없어요`);
  }
  // 허용·금지 도구
  const tools = spec.tools;
  if (!isObj(tools)) errors.push("tools 가 필요해요");
  else {
    oneOf(errors, "tools.mode", tools.mode, CEILING.modes.concat(["none"]));
    if (tools.mode !== "none" && !CEILING.modes.includes(tools.mode)) errors.push(`권한 상한: tools.mode 는 ${CEILING.modes.join("·")} 만 쓸 수 있어요`);
    listOf(errors, "tools.allow", tools.allow, CEILING.tools);
    if (strList(tools.allow)) for (const t of tools.allow) if (!CEILING.tools.includes(t)) errors.push(`권한 상한: 도구 ${t.slice(0, 30)} 는 정의로 열 수 없어요`);
    if (!strList(tools.deny ?? [])) errors.push("tools.deny 는 글 목록이어야 해요");
    if (tools.only !== undefined && tools.only !== null) listOf(errors, "tools.only", tools.only, CEILING.tools);
    if (typeof tools.allowFromConfig !== "boolean") errors.push("tools.allowFromConfig 는 true/false 여야 해요");
  }
  // 명령줄
  const cli = spec.cli;
  if (!isObj(cli)) errors.push("cli 가 필요해요");
  else {
    oneOf(errors, "cli.style", cli.style, CLI_STYLES);
    if (cli.output !== undefined) oneOf(errors, "cli.output", cli.output, OUTPUTS);
    for (const k of ["strictMcp", "noSessionPersistence"]) if (cli[k] !== undefined && typeof cli[k] !== "boolean") errors.push(`cli.${k} 는 true/false 여야 해요`);
  }
  // 쓰기·읽기 경로
  const paths = spec.paths;
  if (!isObj(paths)) errors.push("paths 가 필요해요");
  else if (paths.managedBy !== undefined) {
    if (!NO_PATHS.includes(spec.id)) errors.push(`권한 상한: ${spec.id} 는 paths.managedBy 로 경로 규칙을 건너뛸 수 없어요`);
    if (!isStr(paths.managedBy)) errors.push("paths.managedBy 가 이상해요");
  } else {
    for (const key of ["allow", "deny"]) {
      if (!Array.isArray(paths[key] ?? []) || !(paths[key] ?? []).every((t) => typeof t === "string" && TOKEN_RE.test(t))) errors.push(`paths.${key}: 규칙 글자가 올바르지 않아요`);
    }
    for (const t of paths.allow ?? []) if (!CEILING.allowTokens.includes(t)) errors.push(`권한 상한: 허용 경로 ${String(t).slice(0, 50)} 는 정의로 열 수 없어요`);
    for (const d of paths.additionalDirectories ?? []) if (!CEILING.extraDirs.includes(d)) errors.push(`권한 상한: 추가 폴더 ${String(d).slice(0, 30)} 는 쓸 수 없어요`);
    if (paths.entriesExcept !== undefined && !(strList(paths.entriesExcept) && paths.entriesExcept.every((n) => SAFE_NAME.test(n)))) errors.push("paths.entriesExcept 가 이상해요");
    if (paths.settingsFile !== undefined && (typeof paths.settingsFile !== "string" || !SAFE_REL.test(paths.settingsFile))) errors.push("paths.settingsFile 이 올바르지 않아요");
    const usesClaude = strList(spec.engine?.allowed) && spec.engine.allowed.includes("claude");
    const deny = paths.deny ?? [];
    if (usesClaude && spec.tools?.allow?.some((t) => ["Bash", "Edit", "Write"].includes(t))) {
      for (const need of CEILING.denyFloor) if (!deny.includes(need)) errors.push(`권한 상한: 금지 규칙 ${need} 를 뺄 수 없어요`);
      for (const [verb, any] of Object.entries(CEILING.denySecrets)) if (!any.some((t) => deny.includes(t))) errors.push(`권한 상한: 키 파일(${verb}) 금지 규칙을 뺄 수 없어요`);
      if (!paths.settingsFile) errors.push("paths.settingsFile 이 필요해요(권한 설정 파일)");
    }
  }
  // 네트워크
  const net = spec.network;
  if (!isObj(net)) errors.push("network 가 필요해요");
  else {
    if (net.codex !== undefined) oneOf(errors, "network.codex", net.codex, ["on", "off"]);
    if (net.codex === "on" && !CEILING.networkOnIds.includes(spec.id)) errors.push(`권한 상한: ${spec.id} 는 Codex 네트워크를 켤 수 없어요`);
    if (net.writableRoots !== undefined && !(strList(net.writableRoots) && net.writableRoots.every((r) => CEILING.extraDirs.includes(r)))) errors.push("권한 상한: network.writableRoots 는 @shared 만 쓸 수 있어요");
  }
  // 훅
  if (!strList(spec.hooks ?? null)) errors.push("hooks 는 글 목록이어야 해요");
  else {
    for (const h of spec.hooks) if (!HOOKS.includes(h)) errors.push(`권한 상한: 알 수 없는 훅이에요(${h.slice(0, 30)})`);
    const usesBash = strList(spec.engine?.allowed) && spec.engine.allowed.includes("claude") && spec.tools?.allow?.includes("Bash");
    const need = spec.id === "M1" ? "maintenance-guard" : "ssh-guard";
    if (usesBash && !spec.hooks.includes(need)) errors.push(`권한 상한: Bash 를 쓰는 종류는 ${need} 훅을 뺄 수 없어요`);
  }
  // 환경변수 거르기
  const env = spec.env;
  if (!isObj(env)) errors.push("env 가 필요해요");
  else {
    if (env.filter !== "safeEnv") errors.push("권한 상한: env.filter 는 safeEnv 여야 해요(키·토큰 변수 거르기를 끌 수 없어요)");
    if (!isObj(env.set ?? {})) errors.push("env.set 은 객체여야 해요");
    for (const [name, value] of Object.entries(env.set ?? {})) {
      if (!/^FACTORY_[A-Z_]+$/.test(name) || SECRET_ENV_RE.test(name)) errors.push(`권한 상한: 환경변수 ${name.slice(0, 40)} 는 정의로 넘길 수 없어요`);
      if (typeof value !== "string" || value.length > 60) errors.push(`env.set.${name}: 값이 이상해요`);
      else if (value.startsWith("@") && !ENV_SOURCES.includes(value.slice(1))) errors.push(`env.set.${name}: 알 수 없는 값(${value})이에요`);
    }
  }
  // 키 결정 방식
  if (!isObj(spec.keys)) errors.push("keys 가 필요해요");
  else {
    oneOf(errors, "keys.decision", spec.keys.decision, KEY_DECISIONS);
    if (CEILING.readOnlyIds.includes(spec.id) && spec.keys.decision !== "none") errors.push(`권한 상한: ${spec.id} 는 키를 받을 수 없어요`);
  }
  // 지시 틀·규칙 파일
  if (!isObj(spec.prompt)) errors.push("prompt 가 필요해요");
  else {
    oneOf(errors, "prompt.template", spec.prompt.template, TEMPLATES);
    oneOf(errors, "prompt.rules", spec.prompt.rules ?? null, RULE_FILES);
  }
  // 끝난 뒤 처리, 한도, 다음 연결
  listOf(errors, "after", spec.after, AFTER_STEPS);
  const lim = spec.limits;
  if (!isObj(lim)) errors.push("limits 가 필요해요");
  else {
    if (lim.timeoutMs !== undefined && !(Number.isInteger(lim.timeoutMs) && lim.timeoutMs >= 1000 && lim.timeoutMs <= CEILING.maxTimeoutMs)) errors.push("limits.timeoutMs 는 1초~120분이어야 해요");
    if (lim.timeoutFrom !== undefined && lim.timeoutFrom !== "config.jobTimeoutMin") errors.push("limits.timeoutFrom 이 이상해요");
    if (lim.input !== undefined) {
      if (spec.id !== "T") errors.push("limits.input 은 도구 일감(T)만 쓸 수 있어요");
      else if (!isObj(lim.input) || Object.entries(lim.input).some(([k, n]) => !Number.isInteger(n) || n < 1 || n > (CEILING.toolInput[k] ?? 0))) errors.push(`권한 상한: limits.input 은 ${Object.entries(CEILING.toolInput).map(([k, n]) => `${k}≤${n}`).join(" ")} 안의 정수여야 해요`);
    }
  }
  if (!Array.isArray(spec.next) || !spec.next.every((n) => typeof n === "string" && (Object.hasOwn(AGENT_IDS, n) || GATES.includes(n)))) errors.push("next 는 에이전트 번호나 단계 이름 목록이어야 해요");
  // 읽기 전용 종류는 상한을 더 좁게
  if (CEILING.readOnlyIds.includes(spec.id) && isObj(tools)) {
    if (strList(tools.allow) && tools.allow.some((t) => !CEILING.readOnlyTools.includes(t))) errors.push(`권한 상한: ${spec.id} 는 읽기 도구(${CEILING.readOnlyTools.join("·")})만 열 수 있어요`);
    const deny = Array.isArray(tools.deny) ? tools.deny : [];
    for (const b of CEILING.readOnlyBlocked) if (!deny.includes(b)) errors.push(`권한 상한: ${spec.id} 의 금지 도구 ${b} 를 뺄 수 없어요`);
    if (strList(tools.only ?? null) && tools.only.some((t) => !CEILING.readOnlyTools.includes(t))) errors.push(`권한 상한: ${spec.id} 의 tools.only 가 읽기 도구 밖이에요`);
  }
  if (spec.engine?.allowed?.includes("none") && spec.engine.allowed.length > 1) errors.push("engine.allowed 에 none 은 혼자만 써야 해요");
  return errors;
}

/** 흐름 하나 검사. agentIds: 같이 읽은 에이전트 번호 집합(없으면 번호 존재 검사를 건너뜀) */
export function validateFlow(flow, agentIds = null) {
  const errors = [];
  if (!isObj(flow)) return ["흐름이 객체가 아니에요"];
  if (flow.schema !== SCHEMA_VERSION) errors.push(`schema 는 ${SCHEMA_VERSION} 이어야 해요`);
  if (flow.type !== "flow") errors.push("type 은 flow 여야 해요");
  if (typeof flow.id !== "string" || !SAFE_NAME.test(flow.id)) errors.push("id 가 올바르지 않아요");
  if (!isStr(flow.label)) errors.push("label 이 필요해요");
  if (!isObj(flow.appliesTo) || !isStr(flow.appliesTo.jobKind)) errors.push("appliesTo.jobKind 가 필요해요");
  if (!Array.isArray(flow.steps) || !flow.steps.length || flow.steps.length > 20) return [...errors, "steps 는 1~20개여야 해요"];
  const seen = new Set();
  const checkAgent = (id, where) => {
    if (!Object.hasOwn(AGENT_IDS, id)) errors.push(`${where}: 알 수 없는 에이전트(${String(id).slice(0, 20)})`);
    else if (agentIds && !agentIds.has(id)) errors.push(`${where}: 정의가 없거나 거절된 에이전트(${id})`);
  };
  for (const [i, step] of flow.steps.entries()) {
    const where = `steps[${i}]`;
    if (!isObj(step)) { errors.push(`${where}: 객체가 아니에요`); continue; }
    if (typeof step.id !== "string" || !SAFE_NAME.test(step.id)) errors.push(`${where}.id 가 올바르지 않아요`);
    else if (seen.has(step.id)) errors.push(`${where}.id 가 겹쳐요(${step.id})`);
    else seen.add(step.id);
    if (!isStr(step.label)) errors.push(`${where}.label 이 필요해요`);
    const kinds = ["agent", "gate"].filter((k) => step[k] !== undefined);
    if (kinds.length !== 1) errors.push(`${where}: agent 와 gate 중 하나만 있어야 해요`);
    if (step.agent !== undefined) checkAgent(step.agent, `${where}.agent`);
    if (step.gate !== undefined) oneOf(errors, `${where}.gate`, step.gate, GATES);
    if (step.optional !== undefined && typeof step.optional !== "boolean") errors.push(`${where}.optional 은 true/false 여야 해요`);
    if (step.when !== undefined) oneOf(errors, `${where}.when`, step.when, CONDITIONS);
    if (step.variants !== undefined) {
      if (step.agent === undefined || !Array.isArray(step.variants)) errors.push(`${where}.variants 는 agent 단계의 목록이어야 해요`);
      else for (const [j, v] of step.variants.entries()) {
        if (!isObj(v)) { errors.push(`${where}.variants[${j}] 가 객체가 아니에요`); continue; }
        oneOf(errors, `${where}.variants[${j}].when`, v.when, CONDITIONS);
        checkAgent(v.agent, `${where}.variants[${j}].agent`);
      }
    }
  }
  return errors;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/**
 * 폴더의 정의를 모두 읽는다. 던지지 않는다.
 * 반환: { agents: Map(id → 정의), flows: [흐름], errors: [{ file, message }] } — 거절된 정의는 agents/flows 에 들어가지 않는다.
 */
export function parseAgentDir(dir) {
  const agents = new Map();
  const flows = [];
  const errors = [];
  const list = (d) => { try { return fs.readdirSync(d).filter((f) => f.endsWith(".json")).sort(); } catch { return null; } };
  const files = list(dir);
  if (files === null) return { agents, flows, errors: [{ file: path.basename(dir), message: "정의 폴더를 읽지 못했어요" }] };
  for (const f of files) {
    let spec;
    try { spec = readJson(path.join(dir, f)); } catch (e) { errors.push({ file: f, message: `JSON 을 읽지 못했어요: ${String(e.message).slice(0, 100)}` }); continue; }
    const problems = validateAgent(spec);
    if (problems.length) { for (const m of problems) errors.push({ file: f, message: m }); continue; }
    if (agents.has(spec.id)) { errors.push({ file: f, message: `에이전트 ${spec.id} 정의가 두 개예요` }); continue; }
    agents.set(spec.id, spec);
  }
  const flowDir = path.join(dir, "flows");
  const flowFiles = list(flowDir);
  const ids = new Set(agents.keys());
  for (const f of flowFiles ?? []) {
    let flow;
    try { flow = readJson(path.join(flowDir, f)); } catch (e) { errors.push({ file: `flows/${f}`, message: `JSON 을 읽지 못했어요: ${String(e.message).slice(0, 100)}` }); continue; }
    const problems = validateFlow(flow, ids);
    if (problems.length) { for (const m of problems) errors.push({ file: `flows/${f}`, message: m }); continue; }
    flows.push(flow);
  }
  return { agents, flows, errors };
}

/** 통제실 표시용 요약(읽기 전용): 정의에서 사람이 볼 것만 */
export function summarizeAgent(spec) {
  return {
    id: spec.id,
    kind: spec.kind,
    label: spec.label,
    summary: typeof spec.summary === "string" ? spec.summary : "",
    migrated: spec.migrated,
    engines: spec.engine.allowed,
    workspace: spec.workspace.type + (spec.workspace.root ? ` (${spec.workspace.root}/)` : ""),
    tools: spec.tools.allow,
    blockedTools: spec.tools.deny ?? [],
    readOnly: CEILING.readOnlyIds.includes(spec.id),
    network: spec.network.codex === "on" ? "Codex 인터넷 허용" : "기본(Codex 인터넷 꺼짐)",
    hooks: spec.hooks,
    keys: spec.keys.decision,
    prompt: spec.prompt.template,
    after: spec.after,
    next: spec.next,
  };
}
export function summarizeFlow(flow, agents) {
  return {
    id: flow.id,
    label: flow.label,
    jobKind: flow.appliesTo.jobKind,
    steps: flow.steps.map((s) => ({
      id: s.id,
      label: s.label,
      optional: s.optional === true,
      when: s.when ?? null,
      agent: s.agent ?? null,
      gate: s.gate ?? null,
      variants: (s.variants ?? []).map((v) => ({ when: v.when, agent: v.agent })),
      agentLabel: s.agent ? agents.get(s.agent)?.label ?? null : null,
    })),
  };
}
