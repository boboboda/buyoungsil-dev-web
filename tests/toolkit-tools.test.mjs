// 통제실 '툴킷 도구 상세' 시험: lib/factory/toolkit.ts(보고 검증·용도 추정·저장) + ToolkitToolsView(그림).
// 가짜 DB(메모리)로 돌린다. 실행: npm run test:toolkit-tools
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
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const mask = loadTs("lib/factory/mask.ts");
const lib = loadTs("lib/factory/toolkit.ts", { "@/lib/factory/mask": mask });
const select = loadTs("components/admin/factory/ToolkitPurposeSelect.tsx", { "@/lib/factory/toolkit": lib });
const toolBroker = loadTs("lib/factory/toolBroker.ts", { "@/lib/factory/mask": mask });
const toolbox = loadTs("lib/factory/toolbox.ts", { "@/lib/factory/toolBroker": toolBroker });
const { ToolkitToolsView } = loadTs("components/admin/factory/ToolkitToolsPanel.tsx", { "@/lib/prisma": { __esModule: true, default: null }, "@/lib/factory/toolkit": lib, "@/lib/factory/toolbox": toolbox, "./ToolkitPurposeSelect": select });

const tool = (id, over = {}) => ({ id, desc: `${id} 설명`, entry: "cli.py", script: "toolkit/x.py", dir: "toolkit", doc: "맨 위", opts: ["a"], a: ["input:path*", "out:string"], out: ["out"], tags: [], net: false, sec: [], to: 60, en: true, mod: "2026-10-12", ...over });
const report = (tools, over = {}) => ({ state: "ok", count: tools.length, manifestMod: "2026-10-13", tools, ...over });
const fakeDb = (settings = {}) => ({
  settings,
  factorySetting: {
    async findUnique({ where }) {
      return Object.hasOwn(settings, where.key) ? { value: settings[where.key] } : null;
    },
    async upsert({ where, create }) {
      settings[where.key] = create.value;
    },
  },
});

test("용도 추정: 시트·아틀라스·타일맵 → 게임용, gif·webp·apng·컷 → 움짤·컷용, 둘 다면 공용, 없으면 미분류", () => {
  assert.equal(lib.guessPurpose({ tags: ["sheet"] }), "game");
  assert.equal(lib.guessPurpose({ tags: ["atlas"] }), "game");
  assert.equal(lib.guessPurpose({ tags: ["tilemap"] }), "game");
  assert.equal(lib.guessPurpose({ tags: ["gif"] }), "cut");
  assert.equal(lib.guessPurpose({ tags: ["apng"] }), "cut");
  assert.equal(lib.guessPurpose({ tags: ["cut"] }), "cut");
  assert.equal(lib.guessPurpose({ tags: ["sheet", "gif"] }), "common");
  assert.equal(lib.guessPurpose({ tags: [] }), "unclassified");
});

test("보고 검증: 이상한 항목·이름은 버리고, 키는 이름만, 경로·비밀번호 모양은 가린다", () => {
  const v = lib.validateToolkitReport(
    report([tool("good", { sec: ["PIXELLAB_TOKEN", "lower", "has space"], desc: "password=hunter2 로 C:\\Users\\x\\key.txt 를 읽음" }), tool("Bad Name"), { id: 5 }, tool("good")]),
  );
  assert.ok(v.ok);
  assert.deepEqual(v.info.tools.map((t) => t.id), ["good"]);
  assert.deepEqual(v.info.tools[0].secrets, ["PIXELLAB_TOKEN"]);
  assert.ok(!/hunter2|C:\\\\/.test(JSON.stringify(v.info)));
  assert.equal(lib.validateToolkitReport({ state: "nope" }).ok, false);
  assert.equal(lib.validateToolkitReport(null).ok, false);
  assert.equal(lib.validateToolkitReport({ state: "missing" }).ok, true);
});

test("저장: 보고서 저장·되읽기, 같은 내용은 10분 안에 다시 쓰지 않는다", async () => {
  const db = fakeDb();
  const info = lib.validateToolkitReport(report([tool("pixel-anim", { tags: ["gif"] })]), new Date(0)).info;
  assert.equal(await lib.saveToolkitInfo(db, info, 1000), true);
  assert.equal(await lib.saveToolkitInfo(db, { ...info, receivedAt: new Date(60_000).toISOString() }, 60_000), false);
  assert.equal(await lib.saveToolkitInfo(db, { ...info, receivedAt: new Date(11 * 60_000).toISOString() }, 11 * 60_000), true);
  const view = await lib.readToolkitView(db);
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].purpose, "cut");
  assert.equal(view.rows[0].purposeSource, "guess");
});

test("용도 저장: 바꾸면 저장값이 우선, null 이면 추정으로 되돌림, 이상한 값은 읽을 때 버림", async () => {
  const db = fakeDb();
  await lib.saveToolkitInfo(db, lib.validateToolkitReport(report([tool("pixel-anim", { tags: ["gif"] })])).info);
  await lib.setToolPurpose(db, "pixel-anim", "game");
  let row = (await lib.readToolkitView(db)).rows[0];
  assert.deepEqual([row.purpose, row.purposeSource], ["game", "saved"]);
  await lib.setToolPurpose(db, "pixel-anim", null);
  row = (await lib.readToolkitView(db)).rows[0];
  assert.deepEqual([row.purpose, row.purposeSource], ["cut", "guess"]);
  assert.deepEqual(lib.readPurposes(JSON.stringify({ ok: "game", "Bad Id": "game", x: "weird" })), { ok: "game" });
  assert.equal(lib.isPurpose("weird"), false);
  assert.equal(lib.isToolId("pixel-anim"), true);
});

test("읽기 실패는 던지지 않고 failed 로 알린다", async () => {
  const db = { factorySetting: { findUnique: async () => { throw new Error("db down SECRET"); }, upsert: async () => {} } };
  const orig = console.error;
  console.error = () => {};
  try {
    const view = await lib.readToolkitView(db);
    assert.equal(view.failed, true);
    assert.match(renderToStaticMarkup(h(ToolkitToolsView, { view })), /확인 못 함/);
  } finally {
    console.error = orig;
  }
});

test("화면: 도구 수·용도(추정) 표시·펼침 상세·용도 고르기, 비밀값 없음", () => {
  const info = lib.validateToolkitReport(report([tool("pixel-slice", { tags: ["sheet", "sprite"], sec: ["PIXELLAB_TOKEN"], net: true }), tool("env-doctor")]), new Date(0)).info;
  const html = renderToStaticMarkup(h(ToolkitToolsView, { view: lib.buildToolkitView(info, { "env-doctor": "common" }) }));
  assert.match(html, /보고된 도구 <b>2개<\/b>/);
  assert.match(html, /data-toolkit-tool="pixel-slice"/);
  assert.match(html, /게임용<span class="fx-muted"> \(추정\)/);
  assert.match(html, /공용/);
  assert.match(html, /<details>/);
  assert.match(html, /python cli\.py pixel-slice --input=&lt;path&gt;\* --out=&lt;string&gt;/);
  assert.match(html, /필요한 키 이름: PIXELLAB_TOKEN/);
  assert.match(html, /toolkit\/x\.py/);
  assert.match(html, /<select/);
  assert.match(html, /data-purpose-source="saved"/);
  assert.match(html, /\(관리자가 정함\)/);
  const empty = renderToStaticMarkup(h(ToolkitToolsView, { view: lib.buildToolkitView(null, {}) }));
  assert.match(empty, /아직 못 받았어요/);
  const missing = renderToStaticMarkup(h(ToolkitToolsView, { view: lib.buildToolkitView(lib.validateToolkitReport({ state: "missing" }).info, {}) }));
  assert.match(missing, /tools\.json 이 없어요/);
});

test("서버 경로: device-stats 는 toolkit 을 작업 PC 토큰으로만 받고, control 은 관리자 검사 뒤 용도를 저장", () => {
  const ds = read("app/api/factory/device-stats/route.ts");
  assert.match(ds, /"toolkit" in body[\s\S]*isValidFactoryWorkerToken/);
  const ctl = read("app/api/admin/factory/control/route.ts");
  assert.ok(ctl.indexOf("requireAdmin()") < ctl.indexOf("toolPurpose"));
});

test("도구별 사용 기록: 명령 이름별 30일 횟수·미상·기록 없음·읽기 실패", () => {
  const at = (d) => new Date(Date.UTC(2026, 9, 13) - d * 86400_000).toISOString().replace(/\.\d+Z$/, ".000Z");
  const rec = (id, tool, status, d, command) => ({ id, tool, status, at: at(d), ms: 5, message: null, ...(command ? { command } : {}) });
  const since = Date.UTC(2026, 9, 13) - 30 * 86400_000;
  const usage = toolbox.countCommandUsage(
    [
      [rec("a1", "toolkit.run", "ok", 1, "pixel-slice"), rec("a2", "toolkit.run", "failed", 2, "pixel-slice"), rec("a3", "toolkit.run", "denied", 2, "pixel-codex"), rec("a4", "toolkit.run", "ok", 3), rec("a5", "echo", "ok", 1), rec("a6", "toolkit.run", "ok", 40, "pixel-slice")],
      "깨진 값",
    ],
    since,
  );
  assert.deepEqual(usage["pixel-slice"], { total: 2, ok: 1, denied: 0, failed: 1 }, "30일 밖은 뺀다");
  assert.deepEqual(usage["pixel-codex"], { total: 1, ok: 0, denied: 1, failed: 0 });
  assert.deepEqual(usage["?"], { total: 1, ok: 1, denied: 0, failed: 0 }, "명령 이름 없는 예전 기록은 미상");
  assert.equal(usage.echo, undefined, "toolkit.run 만 센다");
  // 저장 단계: 명령 이름 형식만 통과, 인자 모양은 버림
  const cleaned = toolBroker.cleanToolRequests([rec("b1", "toolkit.run", "ok", 1, "pixel-slice"), { ...rec("b2", "toolkit.run", "ok", 1), command: "bad value --x=1" }]);
  assert.equal(cleaned[0].command, "pixel-slice");
  assert.equal(cleaned[1].command, undefined);

  const info = lib.validateToolkitReport(report([tool("pixel-slice"), tool("env-doctor")]), new Date(0)).info;
  const view = lib.buildToolkitView(info, {});
  const html = renderToStaticMarkup(h(ToolkitToolsView, { view, usage }));
  assert.match(html, /data-tool-usage="pixel-slice"[^>]*>최근 30일 2회 \(성공 1 · 거절 0 · 실패 1\)/);
  assert.match(html, /data-tool-usage="env-doctor"[^>]*>기록 없음/);
  assert.match(html, /미상\(명령 이름이 기록되기 전의 toolkit\.run\): 최근 30일 1회/);
  assert.match(html, /입력 → 출력: /);
  assert.match(renderToStaticMarkup(h(ToolkitToolsView, { view, usage: null })), /최근 30일: 확인 못 함/);
  assert.doesNotMatch(renderToStaticMarkup(h(ToolkitToolsView, { view })), /data-tool-usage/, "usage 를 안 주면 칸이 없다");
});
