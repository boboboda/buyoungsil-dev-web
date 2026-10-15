// 4-2 시험(홈페이지 쪽): 통제실 [설정]의 에이전트 정의 목록은 읽기 전용이다.
//  - 서버 모듈이 정의 폴더를 읽어 종류별 요약·흐름·거절 이유를 만든다 / 화면에 종류 10개·흐름·거절된 정의가 나온다
//  - 화면에는 고치는 단추·입력·요청이 없고, API 는 관리자만·GET 만 있다 / 비밀 값·PC 경로가 나오지 않는다
// 감독 프로그램 쪽(스냅샷·권한 상한)은 tools/factory-supervisor/tests/agentspec.test.mjs. 실행: node tests/agent-defs.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const specMod = await import(pathToFileURL(path.join(repo, "tools/factory-supervisor/agentspec.mjs")).href);
const agentsLib = loadTs("lib/factory/agents.ts", { "../../tools/factory-supervisor/agentspec.mjs": specMod });
const panel = loadTs("components/admin/factory/AgentDefsPanel.tsx", { "@/lib/factory/agents": agentsLib });
const realDir = path.join(repo, "tools", "factory-supervisor", "agents");

test("서버 모듈: 정의 폴더를 읽어 종류 10개·흐름 6개를 순서대로 요약한다", () => {
  const view = agentsLib.readAgentsView(realDir);
  assert.deepEqual(view.errors, []);
  assert.deepEqual(view.agents.map((a) => a.id), ["C1", "A1", "A2", "A3", "A4", "R1", "L1", "T", "M1", "H1"]);
  assert.equal(view.flows.length, 6);
  const rev = view.flows.find((f) => f.id === "app-revision");
  assert.deepEqual(rev.steps.map((s) => s.agent ?? s.gate), ["C1", "A2", "merge-check", "approval", "deploy"]);
  assert.equal(view.agents.find((a) => a.id === "C1").readOnly, true);
  assert.equal(view.agents.find((a) => a.id === "M1").migrated, false);
});

test("서버 모듈: 폴더가 없거나 정의가 거절되면 던지지 않고 이유를 돌려준다", () => {
  const none = agentsLib.readAgentsView(path.join(os.tmpdir(), "없는-에이전트-폴더"));
  assert.equal(none.agents.length, 0);
  assert.ok(none.errors.length >= 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentview-"));
  try {
    for (const f of fs.readdirSync(realDir).filter((n) => n.endsWith(".json"))) fs.copyFileSync(path.join(realDir, f), path.join(dir, f));
    const bad = JSON.parse(fs.readFileSync(path.join(dir, "lab.json"), "utf8"));
    bad.hooks = [];
    fs.writeFileSync(path.join(dir, "lab.json"), JSON.stringify(bad));
    const view = agentsLib.readAgentsView(dir);
    assert.equal(view.agents.some((a) => a.id === "L1"), false);
    assert.ok(view.errors.some((e) => e.file === "lab.json" && /권한 상한/.test(e.message)));
    const html = renderToStaticMarkup(h(panel.AgentDefsView, { view }));
    assert.match(html, /거절된 정의 1건|거절된 정의 \d+건/);
    assert.match(html, /예전 코드 그대로/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("화면: 종류별 요약과 흐름이 나오고 정의로 실행/기록용이 구분된다", () => {
  const html = renderToStaticMarkup(h(panel.AgentDefsView, { view: agentsLib.readAgentsView(realDir) }));
  assert.match(html, /data-agent-count="10"/);
  for (const id of ["C1", "A1", "A2", "A3", "A4", "R1", "L1", "T", "M1", "H1"]) assert.match(html, new RegExp(`data-agent-id="${id}"`), id);
  assert.match(html, /정의로 실행 8개/);
  assert.match(html, /기록용 2개/);
  assert.match(html, /data-agent-migrated="no"/);
  assert.match(html, /읽기 전용/);
  assert.match(html, /data-flow-id="app-revision"/);
  assert.match(html, /지휘자/);
  assert.match(html, /합치기 검사/);
  assert.match(html, /같은 앱에 승인된 수정이 2개 이상일 때/);
  assert.match(html, /정의는 감독 훅·금지 규칙의 상한을 넓힐 수 없어요/);
});

test("화면은 읽기 전용이다: 단추·입력·폼·요청 코드가 없다", () => {
  const html = renderToStaticMarkup(h(panel.AgentDefsView, { view: agentsLib.readAgentsView(realDir) }));
  assert.doesNotMatch(html, /<(button|input|textarea|select|form)\b/i);
  const src = read("components/admin/factory/AgentDefsPanel.tsx");
  assert.doesNotMatch(src, /fetch\(|useState|onClick|"use client"/);
});

test("화면에 비밀 값·PC 경로가 나오지 않는다", () => {
  const html = renderToStaticMarkup(h(panel.AgentDefsView, { view: agentsLib.readAgentsView(realDir) }));
  assert.doesNotMatch(html, /C:\\|\/Users\/|secrets\.env|ghp_|sk-[A-Za-z0-9]{10}/);
});

test("못 읽었을 때 화면: '확인 못 함'으로 뜨고 통제실은 계속 뜬다", () => {
  const html = renderToStaticMarkup(h(panel.AgentDefsView, { failed: true, view: { agents: [], flows: [], errors: [] } }));
  assert.match(html, /확인 못 함/);
});

test("연결: 설정 탭에 에이전트 정의 묶음이 있고, API 는 관리자만·읽기(GET)만 있다", () => {
  const consoleSrc = read("components/admin/factory/FactoryConsole.tsx");
  assert.match(consoleSrc, /tab === "settings"[\s\S]*?<SettingsGroup[^>]*id="settings-project"[^>]*>[\s\S]*?<WorkRules \/>\s*<AgentDefsPanel \/>\s*<\/SettingsGroup>/);
  const route = read("app/api/admin/factory/agents/route.ts");
  assert.match(route, /requireAdmin/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(route, /readAgentsView/);
});
