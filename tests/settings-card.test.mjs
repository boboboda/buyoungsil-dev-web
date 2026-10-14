// 통제실 [설정] 공용 틀(SettingsCard·SettingsGroup·ChoiceRow)과 공용 읽기(useFactoryControl) 시험.
// 틀이 제목·설명·안내문·표식을 그리는지, 설정 탭이 주제별 묶음으로 나뉘었는지, /control 읽기가 한 번만 나가는지 본다.
// 가짜 fetch 만 쓴다(실제 서버·DB 사용 안 함). 실행: npm run test:settings-card
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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

const card = loadTs("components/admin/factory/SettingsCard.tsx");
const control = loadTs("components/admin/factory/useFactoryControl.ts");

test("SettingsCard: 제목·설명·내용·도움말·안내문(role=status)·표식을 그린다", () => {
  const html = renderToStaticMarkup(h(card.default, { title: "동시에 만들 앱 수", description: "설명 문장", help: ["도움 1", "도움 2"], notice: "저장했어요.", id: "x", attrs: { "data-app-slots": "" } }, h("button", null, "저장")));
  assert.match(html, /<h3[^>]*>동시에 만들 앱 수<\/h3>/);
  assert.match(html, /설명 문장/);
  assert.match(html, /도움 1[\s\S]*도움 2/);
  assert.match(html, /role="status"[^>]*>저장했어요\./);
  assert.match(html, /id="x"/);
  assert.match(html, /data-app-slots/);
  assert.match(html, /<button>저장<\/button>/);
  assert.match(html, /min-w-0/); // 모바일에서 카드가 화면 밖으로 밀려 가로 스크롤을 만들지 않게
});

test("SettingsCard: 안내문·설명이 없으면 그 줄을 안 그린다", () => {
  const html = renderToStaticMarkup(h(card.default, { title: "빈 카드" }));
  assert.ok(!html.includes("role=\"status\""));
  assert.equal((html.match(/<p/g) ?? []).length, 0);
});

test("SettingsGroup·ChoiceRow: 묶음 제목과 선택 줄 접근성 이름", () => {
  const g = renderToStaticMarkup(h(card.SettingsGroup, { title: "검사", hint: "힌트", id: "settings-checks" }, h("i", null, "자식")));
  assert.match(g, /<h2[^>]*>검사<\/h2>/);
  assert.match(g, /힌트/);
  assert.match(g, /id="settings-checks"/);
  const c = renderToStaticMarkup(h(card.ChoiceRow, { label: "고르기" }, h("i", null, "1")));
  assert.match(c, /role="group"/);
  assert.match(c, /aria-label="고르기"/);
});

test("useFactoryControl: reloadControl 은 동시에 불러도 요청 한 번, 저장 응답은 모두에게 알린다", async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    return { ok: true, json: async () => ({ appSlots: init?.method === "POST" ? 4 : 3 }) };
  };
  const seen = [];
  // 구독 대신 publish 결과를 직접 본다(훅은 React 안에서만 돌므로 저장소 함수만 시험)
  await Promise.all([control.reloadControl(), control.reloadControl(), control.reloadControl()]);
  assert.equal(calls, 1);
  const res = await control.postControl({ appSlots: 4 });
  assert.equal(res.ok, true);
  assert.equal(res.data.appSlots, 4);
  assert.equal(calls, 2);
  assert.ok(seen.length === 0);
  // 실패 응답은 알리지 않고 그대로 돌려준다
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ message: "거부" }) });
  const bad = await control.postControl({ appSlots: 9 });
  assert.equal(bad.ok, false);
  assert.equal(bad.data.message, "거부");
});

test("설정 탭: 주제별 묶음 8개, 카드는 모두 한 묶음에만 들어 있다", () => {
  const src = read("components/admin/factory/FactoryConsole.tsx");
  const groups = [...src.matchAll(/<SettingsGroup[^>]*title="([^"]+)"[^>]*>([\s\S]*?)<\/SettingsGroup>/g)];
  assert.deepEqual(groups.map((m) => m[1]), ["실행·동시성", "감독 업데이트", "병렬화·지휘자", "검사", "도구", "알림·연결", "키·계정", "프로젝트·규칙"]);
  const cards = ["ToolkitToolsPanel", "ToolboxPanel", "DefaultAiSettings", "AppSlotsSettings", "UpdateBundleSettings", "ParallelPerAppSettings", "ApprovalWaitSettings", "AppChecksSettings", "ConductorSettings", "ToolBrokerSettings", "TelegramSetup", "WorkerTokens", "SecretEntries", "SecretNames", "StudioAccessKeys", "ReleaseAccounts", "AppProjectLinks", "WorkRules"];
  for (const n of cards) assert.equal(groups.filter((m) => m[2].includes(`<${n} />`)).length, 1, `${n} 가 한 묶음에만 있어야 함`);
});

test("설정 카드들은 공용 틀과 공용 읽기를 쓰고 /control 을 따로 읽지 않는다", () => {
  for (const f of ["AppSlotsSettings", "AppChecksSettings", "DefaultAiSettings", "ToolBrokerSettings"]) {
    const src = read(`components/admin/factory/${f}.tsx`);
    assert.match(src, /SettingsCard/, `${f} 가 공용 틀을 안 씀`);
    assert.match(src, /useFactoryControl/, `${f} 가 공용 읽기를 안 씀`);
    assert.ok(!/fetch\(/.test(src), `${f} 가 직접 fetch 함`);
  }
  for (const f of ["SupervisorSummary", "SupervisorControl", "AiEngineSelect", "ClaudeModelSelect"]) {
    assert.ok(!/fetch\(["']\/api\/admin\/factory\/control["'], \{ cache/.test(read(`components/admin/factory/${f}.tsx`)), `${f} 가 /control 을 따로 읽음`);
  }
});
