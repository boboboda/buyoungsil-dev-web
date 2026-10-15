// 에이전트 블록 정의(4-2) 시험: 정의 파일 읽기·검사, 권한 상한, 흐름, 그리고 종류마다
// "바뀌기 전 코드가 만든 실행 설정"(tests/fixtures/agent-golden.json)과 "정의에서 만든 실행 설정"이 완전히 같은지 비교하는 스냅샷.
// 비교 항목: 명령 인자 · 설정 파일 내용 · 환경변수 이름(과 FACTORY_* 값) · 작업 폴더 · 훅.
// 실제 AI·네트워크 없이 임시 폴더만 쓴다. 실행: node tools/factory-supervisor/tests/agentspec.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_IDS, CEILING, parseAgentDir, summarizeAgent, summarizeFlow, validateAgent, validateFlow } from "../agentspec.mjs";
import { AGENTS_DIR, agentSpec, cfgOf, codexOptionsOf, envOf, oneshotArgs, resetAgents, settingsOf, workspaceDirOf, writeSettings } from "../agentrun.mjs";
import { conductorArgs } from "../conductor.mjs";
import { invocation } from "../ai-runner.mjs";
import { labCodexOptions, writeLabClaudeSettings } from "../lab.mjs";
import { toolJobDirOf } from "../tooljob.mjs";
import { worktreePath } from "../worktree.mjs";
import { AI_SECRETS, BASE_ENV, CFG, JOB_ID, SESSION, makeFixture, normalizer } from "./fixtures/agent-scenarios.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "agent-golden.json"), "utf8"));
const supSource = (f) => fs.readFileSync(path.join(here, "..", f), "utf8").replace(/\r\n/g, "\n");
const load = () => parseAgentDir(AGENTS_DIR);
const specOf = (id) => structuredClone(load().agents.get(id));
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const factoryVals = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => /^FACTORY_/.test(k) && !(k in BASE_ENV)).sort(([a], [b]) => a.localeCompare(b)));

/** 정의에서 만든 실행 설정을 기준 파일과 같은 모양으로 뽑는다 */
function fromSpec() {
  resetAgents();
  const fx = makeFixture();
  const norm = normalizer(fx.base);
  const cfg = { ...CFG, workDir: fx.workDir, selfdevDir: fx.selfdevDir };
  const protectedDirs = [fx.selfdevDir, fx.supervisorSrc];
  const spec = (id) => {
    const s = agentSpec(id);
    assert.ok(s, `${id} 정의를 읽어야 해요`);
    return s;
  };
  const shape = (engine, inv, settingsFile, env, cwd) => {
    const settings = settingsFile ? readJson(settingsFile) : null;
    return norm({ engine, command: inv.command, args: inv.args, settings, hooks: settings?.hooks ?? null, envNames: Object.keys(env).sort(), envFactory: factoryVals(env), cwd });
  };
  const out = {};
  // C1 지휘자
  {
    const s = spec("C1");
    const env = envOf(s, BASE_ENV, {}, {});
    out.C1 = norm({ engine: "claude", command: "claude", args: conductorArgs("haiku", s), settings: null, hooks: null, envNames: Object.keys(env).sort(), envFactory: factoryVals(env), cwd: path.join(fx.workDir, "app-a"), timeoutMs: s.limits.timeoutMs });
  }
  // L1 실험
  {
    const s = spec("L1");
    const dir = workspaceDirOf(s, fx.workDir, JOB_ID);
    const shared = path.join(fx.workDir, "lab", "shared");
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(shared, { recursive: true });
    const settings = writeLabClaudeSettings({ workDir: fx.workDir, dir, shared, jobId: JOB_ID, extraProtected: protectedDirs, spec: s });
    const env = envOf(s, BASE_ENV, { jobId: JOB_ID, dir, shared });
    const labCfg = cfgOf(s, cfg);
    out.L1 = shape("claude", invocation("claude", labCfg, { model: "opus", settings }), settings, env, dir);
    out.L1_codex = norm({ engine: "codex", ...invocation("codex", labCfg, { lab: labCodexOptions(shared, s) }), settings: null, hooks: null, envNames: Object.keys(env).sort(), envFactory: factoryVals(env), cwd: dir });
  }
  // T 도구 일감
  {
    const s = spec("T");
    out.T = norm({ engine: "none", command: null, args: [], settings: null, hooks: null, envNames: [], envFactory: {}, cwd: workspaceDirOf(s, fx.workDir, JOB_ID) });
  }
  // A1~A4, R1
  {
    const appDir = path.join(fx.workDir, "app-a");
    const run = (id, { model, sessionId, extra = {}, worktree = false } = {}) => {
      const s = spec(id);
      const settings = writeSettings(s, { workDir: fx.workDir, protectedDirs });
      const wt = path.join(fx.workDir, s.workspace.root ?? "", `app-a-${JOB_ID}`);
      const ctx = { jobId: JOB_ID, appSlug: "app-a", lockDir: path.join(fx.workDir, ".locks"), waitFile: path.join(wt, ".factory", "lock-wait.json") };
      const env = envOf(s, BASE_ENV, ctx, { ...AI_SECRETS, ...extra });
      return shape("claude", invocation("claude", cfgOf(s, cfg), { settings, model, sessionId }), settings, env, worktree ? wt : appDir);
    };
    out.A1 = run("A1", { model: null });
    out.A2 = run("A2", { model: "sonnet" });
    out.A3 = run("A3", { model: "sonnet", worktree: true });
    out.A4 = run("A4", { model: "sonnet", sessionId: SESSION, worktree: true });
    out.R1 = run("R1", { model: "opus", extra: { ANDROID_KEYSTORE_PASSWORD: "x", ANDROID_KEY_ALIAS: "y" } });
    const s = spec("A2");
    const env = envOf(s, BASE_ENV, { jobId: JOB_ID, appSlug: "app-a" }, AI_SECRETS);
    out.A2_codex = norm({ engine: "codex", ...invocation("codex", cfgOf(s, cfg), {}), settings: null, hooks: null, envNames: Object.keys(env).sort(), envFactory: factoryVals(env), cwd: appDir });
    // 작업 사본 폴더 이름은 worktree.mjs 가 정한다: 정의의 root 와 같아야 한다
    assert.equal(path.resolve(worktreePath(fx.workDir, "app-a", JOB_ID)), path.resolve(path.join(fx.workDir, spec("A3").workspace.root, `app-a-${JOB_ID}`)));
    assert.equal(path.resolve(toolJobDirOf(fx.workDir, JOB_ID)), path.resolve(workspaceDirOf(spec("T"), fx.workDir, JOB_ID)));
  }
  fs.rmSync(fx.base, { recursive: true, force: true });
  return out;
}

// ───────── 정의 파일 ─────────
test("정의 폴더: 에이전트 10종과 흐름 6개가 오류 없이 읽힌다", () => {
  const r = load();
  assert.deepEqual(r.errors, []);
  assert.deepEqual([...r.agents.keys()].sort(), Object.keys(AGENT_IDS).sort());
  assert.deepEqual(r.flows.map((f) => f.id).sort(), ["app-new", "app-revision", "lab", "maintenance", "release", "tool"]);
  for (const [id, spec] of r.agents) assert.equal(spec.kind, AGENT_IDS[id]);
});

test("옮긴 종류와 남긴 종류: M1 정비·H1 정리는 정의만 있고 읽어 쓰지 않는다", () => {
  const migrated = [...load().agents.values()].filter((s) => s.migrated).map((s) => s.id).sort();
  assert.deepEqual(migrated, ["A1", "A2", "A3", "A4", "C1", "L1", "R1", "T"]);
  resetAgents();
  assert.equal(agentSpec("M1"), null);
  assert.equal(agentSpec("H1"), null);
  assert.ok(agentSpec("C1"));
  // 정비 코드는 에이전트 정의를 부르지 않는다
  assert.doesNotMatch(supSource("maintenance.mjs"), /agentrun|agentspec|agentSpec/);
  assert.doesNotMatch(supSource("compact.mjs"), /agentrun|agentspec|agentSpec/);
});

test("정의 파일의 필드: 요구한 항목(엔진·작업 공간·도구·경로·네트워크·훅·환경변수·키·지시 틀·끝난 뒤·한도·다음)이 모두 있다", () => {
  for (const spec of load().agents.values()) {
    for (const key of ["engine", "workspace", "tools", "paths", "network", "hooks", "env", "keys", "prompt", "after", "limits", "next"]) assert.ok(key in spec, `${spec.id}.${key}`);
    assert.ok(spec.prompt.template);
    assert.ok("rules" in spec.prompt);
  }
});

// ───────── 스냅샷: 예전 코드가 만든 설정 == 정의에서 만든 설정 ─────────
test("스냅샷: 모든 종류의 실행 설정이 예전 코드가 만든 것과 완전히 같다", () => {
  const now = fromSpec();
  for (const key of Object.keys(golden).filter((k) => k !== "_source")) {
    assert.deepEqual(now[key], golden[key], `${key}: 정의에서 만든 설정이 예전 코드의 설정과 달라요`);
  }
  assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).filter((k) => k !== "_source").sort());
});

test("스냅샷 항목별: 인자·설정 파일·환경변수 이름·작업 폴더·훅을 따로도 확인한다", () => {
  const now = fromSpec();
  for (const key of Object.keys(now)) {
    const g = golden[key];
    assert.deepEqual(now[key].args, g.args, `${key} 명령 인자`);
    assert.deepEqual(now[key].settings, g.settings, `${key} 설정 파일 내용`);
    assert.deepEqual(now[key].envNames, g.envNames, `${key} 환경변수 이름`);
    assert.deepEqual(now[key].envFactory, g.envFactory, `${key} FACTORY_* 값`);
    assert.equal(now[key].cwd, g.cwd, `${key} 작업 폴더`);
    assert.deepEqual(now[key].hooks, g.hooks, `${key} 훅`);
  }
  // 키·토큰 모양 변수는 어느 종류에도 넘어가지 않는다(앱 일감의 일감 키만 예외)
  for (const [key, c] of Object.entries(now)) {
    for (const bad of ["GITHUB_TOKEN", "MY_API_KEY", "DB_PASSWORD", "SERVERCTL_VALUE"]) assert.equal(c.envNames.includes(bad), false, `${key}: ${bad}`);
  }
});

test("예전 코드 경로(정의 없음)도 기준 파일과 같다: 정의를 못 쓸 때 그대로 돈다", () => {
  const fx = makeFixture();
  const norm = normalizer(fx.base);
  const protectedDirs = [fx.selfdevDir, fx.supervisorSrc];
  const dir = path.join(fx.workDir, "lab", JOB_ID);
  const shared = path.join(fx.workDir, "lab", "shared");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(shared, { recursive: true });
  // 지휘자: 예전 상수
  assert.deepEqual(conductorArgs("haiku", null), golden.C1.args);
  // 실험: 예전 설정 파일 코드
  const file = writeLabClaudeSettings({ workDir: fx.workDir, dir, shared, jobId: JOB_ID, extraProtected: protectedDirs, spec: null });
  assert.deepEqual(norm(readJson(file)), golden.L1.settings);
  assert.deepEqual(norm(labCodexOptions(shared, null)), norm({ writableRoots: [shared.replace(/\\/g, "/")], network: true }));
  assert.deepEqual(norm(labCodexOptions(shared, null)), norm(labCodexOptions(shared, agentSpec("L1"))));
  fs.rmSync(fx.base, { recursive: true, force: true });
});

test("거절된 정의는 쓰지 않는다: 상한을 넘는 정의가 든 폴더에서는 그 종류만 null(예전 코드), 나머지는 그대로", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentdir-"));
  try {
    for (const f of fs.readdirSync(AGENTS_DIR).filter((n) => n.endsWith(".json"))) fs.copyFileSync(path.join(AGENTS_DIR, f), path.join(dir, f));
    const bad = specOf("L1");
    bad.paths.allow.push("edit:@factory/**"); // 공장 폴더 전체 쓰기를 열려는 정의
    bad.hooks = [];
    fs.writeFileSync(path.join(dir, "lab.json"), JSON.stringify(bad));
    const warns = [];
    resetAgents();
    assert.equal(agentSpec("L1", { dir, warn: (m) => warns.push(m) }), null);
    assert.ok(agentSpec("C1", { dir, warn: () => {} }), "다른 종류는 그대로 읽힌다");
    assert.ok(warns.some((m) => /lab\.json/.test(m) && /권한 상한/.test(m)), "거절 이유를 경고로 남긴다");
    // 같은 경고를 되풀이하지 않는다
    const before = warns.length;
    agentSpec("L1", { dir, warn: (m) => warns.push(m) });
    assert.equal(warns.length, before);
    // 정의 없이 쓰기 설정을 만들면 예전 코드 경로(기준 파일과 같음)
    const fx = makeFixture();
    const d = path.join(fx.workDir, "lab", JOB_ID);
    const shared = path.join(fx.workDir, "lab", "shared");
    fs.mkdirSync(d, { recursive: true });
    fs.mkdirSync(shared, { recursive: true });
    const file = writeLabClaudeSettings({ workDir: fx.workDir, dir: d, shared, jobId: JOB_ID, extraProtected: [fx.selfdevDir, fx.supervisorSrc], spec: agentSpec("L1", { dir, warn: () => {} }) });
    assert.deepEqual(normalizer(fx.base)(readJson(file)), golden.L1.settings);
    fs.rmSync(fx.base, { recursive: true, force: true });
  } finally {
    resetAgents();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("깨진 JSON·없는 폴더·두 번 정의된 종류도 던지지 않고 오류로 모은다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentdir-"));
  try {
    fs.writeFileSync(path.join(dir, "a.json"), "{ 깨짐");
    fs.writeFileSync(path.join(dir, "b.json"), JSON.stringify(specOf("C1")));
    fs.writeFileSync(path.join(dir, "c.json"), JSON.stringify(specOf("C1")));
    const r = parseAgentDir(dir);
    assert.equal(r.agents.size, 1);
    assert.ok(r.errors.some((e) => e.file === "a.json" && /JSON/.test(e.message)));
    assert.ok(r.errors.some((e) => e.file === "c.json" && /두 개/.test(e.message)));
    assert.equal(parseAgentDir(path.join(dir, "없음")).errors.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ───────── 권한 상한 ─────────
function rejects(id, mutate, pattern) {
  const spec = specOf(id);
  mutate(spec);
  const errors = validateAgent(spec);
  assert.ok(errors.length > 0, `${id}: 넓힌 정의가 통과했어요`);
  assert.ok(errors.some((e) => pattern.test(e)), `${id}: ${pattern} 오류가 없어요 → ${errors.join(" | ")}`);
}

test("권한 상한: 도구·방식을 넓히는 정의는 거절한다", () => {
  rejects("A2", (s) => s.tools.allow.push("Task"), /권한 상한/);
  rejects("A2", (s) => s.tools.allow.push("NotebookEdit"), /권한 상한|허용하지 않는/);
  rejects("A2", (s) => (s.tools.mode = "bypassPermissions"), /권한 상한|허용하지 않는/);
  rejects("A2", (s) => (s.tools.mode = "dontAsk"), /권한 상한|허용하지 않는/);
  rejects("C1", (s) => s.tools.allow.push("Bash"), /권한 상한/);
  rejects("C1", (s) => (s.tools.deny = s.tools.deny.filter((t) => t !== "Bash")), /권한 상한/);
  rejects("C1", (s) => (s.tools.only = ["Read", "Edit"]), /권한 상한|허용하지 않는/);
  rejects("C1", (s) => (s.keys.decision = "job-required"), /권한 상한/);
});

test("권한 상한: 훅을 빼거나 금지 규칙을 줄이는 정의는 거절한다", () => {
  rejects("A1", (s) => (s.hooks = []), /ssh-guard/);
  rejects("L1", (s) => (s.hooks = ["maintenance-guard"]), /ssh-guard/);
  rejects("A2", (s) => (s.hooks = ["아무거나"]), /훅/);
  for (const need of CEILING.denyFloor) rejects("A2", (s) => (s.paths.deny = s.paths.deny.filter((t) => t !== need)), /금지 규칙/);
  rejects("A2", (s) => (s.paths.deny = s.paths.deny.filter((t) => !/secrets/.test(t) || !t.startsWith("read:"))), /키 파일/);
  rejects("L1", (s) => (s.paths.deny = s.paths.deny.filter((t) => !/secrets/.test(t) || !t.startsWith("edit:"))), /키 파일/);
  rejects("L1", (s) => s.paths.allow.push("edit:@factory/**"), /권한 상한/);
  rejects("L1", (s) => s.paths.allow.push("read:~/.ssh/**"), /권한 상한/);
  rejects("L1", (s) => (s.paths.additionalDirectories = ["@work"]), /권한 상한/);
  rejects("A2", (s) => (s.paths = { managedBy: "내 코드" }), /managedBy/);
  rejects("A2", (s) => (s.paths.deny = ["edit:@factory/../x"]), /규칙 글자/);
});

test("권한 상한: 네트워크·환경변수·작업 공간·입력 한도를 넓히는 정의는 거절한다", () => {
  rejects("A2", (s) => (s.network.codex = "on"), /네트워크/);
  rejects("L1", (s) => (s.network.writableRoots = ["@work"]), /writableRoots/);
  rejects("A2", (s) => (s.env.filter = "none"), /safeEnv/);
  rejects("A2", (s) => (s.env.set.GITHUB_TOKEN = "x"), /환경변수/);
  rejects("A2", (s) => (s.env.set.FACTORY_API_KEY = "x"), /환경변수/);
  rejects("A2", (s) => (s.env.set.FACTORY_X = "@secrets"), /알 수 없는 값/);
  rejects("A2", (s) => (s.workspace.type = "lab-folder"), /작업 공간/);
  rejects("C1", (s) => (s.workspace = { type: "lab-folder", root: "lab" }), /작업 공간/);
  rejects("L1", (s) => (s.workspace.root = "."), /workspace\.root/);
  rejects("T", (s) => (s.limits.input.maxTotal = 17), /limits\.input/);
  rejects("A2", (s) => (s.limits.input = { maxTotal: 1 }), /도구 일감/);
  rejects("A2", (s) => (s.limits.timeoutMs = 9 * 60 * 60_000), /timeoutMs/);
  rejects("A2", (s) => (s.paths.settingsFile = "../밖.json"), /settingsFile/);
});

test("권한 상한: 모양이 틀린 정의도 거절한다(빠진 필드·알 수 없는 값)", () => {
  assert.ok(validateAgent(null).length);
  assert.ok(validateAgent({}).length);
  rejects("A2", (s) => delete s.hooks, /hooks/);
  rejects("A2", (s) => delete s.env, /env/);
  rejects("A2", (s) => (s.prompt.template = "내 지시"), /prompt\.template/);
  rejects("A2", (s) => (s.after = ["rm -rf"]), /after/);
  rejects("A2", (s) => (s.next = ["어딘가"]), /next/);
  rejects("A2", (s) => (s.id = "A9"), /id/);
  rejects("A2", (s) => (s.kind = "lab"), /kind/);
  rejects("T", (s) => (s.engine.allowed = ["none", "claude"]), /none/);
});

test("권한 상한 비교: 정의가 만드는 deny 규칙은 예전 코드의 규칙을 하나도 잃지 않는다(앱·실험)", () => {
  const fx = makeFixture();
  const norm = normalizer(fx.base);
  const protectedDirs = [fx.selfdevDir, fx.supervisorSrc];
  const dir = path.join(fx.workDir, "lab", JOB_ID);
  const shared = path.join(fx.workDir, "lab", "shared");
  for (const id of ["A1", "A2", "A3", "A4", "R1", "L1"]) {
    const s = specOf(id);
    const got = norm(settingsOf(s, { workDir: fx.workDir, dir, shared, protectedDirs }));
    const want = golden[id === "L1" ? "L1" : "A2"].settings;
    for (const rule of want.permissions.deny) assert.ok(got.permissions.deny.includes(rule), `${id}: ${rule}`);
    assert.ok(got.permissions.deny.every((r) => want.permissions.deny.includes(r)), `${id}: 새 규칙이 늘었어요`);
    assert.deepEqual(got.hooks, want.hooks);
  }
  fs.rmSync(fx.base, { recursive: true, force: true });
});

// ───────── 흐름 ─────────
test("흐름: 수정 = 지휘자(선택) → 작업자 → 합치기 검사 → 승인 → 배포", () => {
  const r = load();
  const flow = r.flows.find((f) => f.id === "app-revision");
  assert.deepEqual(flow.steps.map((s) => s.agent ?? s.gate), ["C1", "A2", "merge-check", "approval", "deploy"]);
  assert.equal(flow.steps[0].optional, true);
  assert.equal(flow.steps[0].when, "same-app-pending>=2");
  assert.deepEqual(flow.steps[1].variants, [{ when: "grouped", agent: "A3" }, { when: "rebase-conflict", agent: "A4" }]);
  const sum = summarizeFlow(flow, r.agents);
  assert.equal(sum.steps[0].agentLabel, "지휘자");
  assert.equal(sum.steps[1].agentLabel, "수정");
});

test("흐름 검사: 없는 에이전트·겹친 단계·둘 다 있는 단계·모르는 조건은 거절한다", () => {
  const base = () => structuredClone(load().flows.find((f) => f.id === "app-revision"));
  const ids = new Set(Object.keys(AGENT_IDS));
  assert.deepEqual(validateFlow(base(), ids), []);
  const bad = (mutate, pattern, agents = ids) => {
    const f = base();
    mutate(f);
    const errors = validateFlow(f, agents);
    assert.ok(errors.some((e) => pattern.test(e)), `${pattern} → ${errors.join(" | ")}`);
  };
  bad((f) => (f.steps[1].agent = "A9"), /알 수 없는 에이전트/);
  bad(() => {}, /거절된 에이전트/, new Set(["A2"]));
  bad((f) => (f.steps[2].id = f.steps[1].id), /겹쳐요/);
  bad((f) => (f.steps[2].agent = "A2"), /하나만/);
  bad((f) => delete f.steps[2].gate, /하나만/);
  bad((f) => (f.steps[2].gate = "직접배포"), /gate/);
  bad((f) => (f.steps[0].when = "언제나"), /when/);
  bad((f) => (f.steps = []), /steps/);
  bad((f) => (f.steps[1].variants = [{ when: "grouped", agent: "Z" }]), /알 수 없는 에이전트/);
  bad((f) => (f.type = "agent"), /type/);
});

test("흐름이 거절된 에이전트를 가리키면 그 흐름도 거절된다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentdir-"));
  try {
    fs.mkdirSync(path.join(dir, "flows"));
    fs.writeFileSync(path.join(dir, "flows", "x.json"), JSON.stringify(load().flows.find((f) => f.id === "lab")));
    const r = parseAgentDir(dir);
    assert.equal(r.flows.length, 0);
    assert.ok(r.errors.some((e) => e.file === "flows/x.json" && /거절된 에이전트/.test(e.message)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ───────── 통제실 표시·감독 연결 ─────────
test("요약: 통제실에 보일 항목만 뽑고 비밀·경로 값은 넣지 않는다", () => {
  for (const spec of load().agents.values()) {
    const s = summarizeAgent(spec);
    assert.equal(s.id, spec.id);
    assert.equal(typeof s.label, "string");
    assert.ok(Array.isArray(s.tools) && Array.isArray(s.hooks));
    assert.doesNotMatch(JSON.stringify(s), /Users|secrets\.env|password|token/i);
  }
  assert.equal(summarizeAgent(specOf("C1")).readOnly, true);
  assert.equal(summarizeAgent(specOf("L1")).network, "Codex 인터넷 허용");
});

test("감독 프로그램 연결: 지휘자·실험·도구·앱 일감이 정의를 읽고, 정의가 없을 때의 예전 코드도 남아 있다", () => {
  const sup = supSource("supervisor.mjs");
  assert.match(sup, /agentSpec\("L1"\)/);
  assert.match(sup, /agentSpec\(appSpecId\(job/);
  assert.match(sup, /function appSpecId\(job, st\)/);
  assert.match(sup, /st\.realign = true/);
  assert.match(supSource("conductor.mjs"), /agentSpec\("C1"\)/);
  assert.match(supSource("tooljob.mjs"), /agentSpec\("T"\)/);
  assert.match(supSource("lab.mjs"), /agentSpec\("L1"\)/);
  // 예전 코드도 그대로: 정의를 못 쓸 때의 경로
  assert.match(sup, /safeEnv\(process\.env, \{ \.\.\.aiSecrets, FACTORY_APP_SLUG/);
  assert.match(supSource("conductor.mjs"), /BLOCKED_TOOLS\.join/);
});

test("정의에서 만든 지휘자 인자: 모델은 허용 목록만, 읽기 도구만 열린다", () => {
  const s = agentSpec("C1");
  assert.deepEqual(oneshotArgs(s, "haiku"), golden.C1.args);
  assert.throws(() => conductorArgs("gpt-9", s), /허용하지 않는/);
  const args = conductorArgs("opus", s);
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Glob,Grep");
  assert.equal(args.includes("Bash,Edit,Write") , false);
});

test("정의가 정한 사용자 설정 우선순위: 앱은 사용자 설정(allowedTools)이 우선, 실험은 정의가 고정", () => {
  const app = agentSpec("A2");
  const lab = agentSpec("L1");
  assert.equal(cfgOf(app, { allowedTools: "Read" }).allowedTools, "Read");
  assert.equal(cfgOf(app, {}).allowedTools, "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch");
  assert.equal(cfgOf(lab, { allowedTools: "Bash,Edit,Write" }).allowedTools, "Bash,Read,Glob,Grep,WebFetch,WebSearch");
  assert.equal(cfgOf(lab, { permissionMode: "default" }).permissionMode, "default");
  assert.deepEqual(codexOptionsOf(lab, { shared: "/a/b" }), { writableRoots: ["/a/b"].map((p) => path.resolve(p).replace(/\\/g, "/")), network: true });
});
