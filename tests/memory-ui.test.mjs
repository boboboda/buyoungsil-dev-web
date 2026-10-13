// 작업 메모리(.factory/memory/)의 서버·통제실 쪽 시험: 보고 저장 정리, 인계 기록 칸 안의 현재 일감 요약, 설정의 폴더별 한 줄, /next 쿼리.
// 감독 프로그램 쪽(갱신 블록·색인·크기·Git 푸시·주입)은 tools/factory-supervisor/tests/memory.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
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
const handoffLib = loadTs("lib/factory/handoff.ts", { "@/lib/factory/mask": mask });
const memoryReport = loadTs("lib/factory/memory-report.ts");
const HandoffBox = loadTs("components/admin/factory/HandoffBox.tsx", { "@/lib/factory/handoff": handoffLib, "@/lib/factory/memory-report": memoryReport }).default;
const MemoryStatus = loadTs("components/admin/factory/MemoryStatus.tsx", { "@/lib/factory/memory-report": memoryReport }).default;

const entry = {
  v: 1, kind: "maintenance", taskId: "turn1", title: "로그인 수정", engine: "codex", model: "기본", at: "2026-10-13T09:00:00.000Z", status: "done",
  request: "로그인 화면 오류를 고쳐 줘", hasAiBlock: true, doneWhen: "", done: "login.tsx 수정", remaining: "", caution: "",
  files: { committed: { list: ["a.ts"], more: 0 }, uncommitted: { list: [], more: 0 } }, checks: [], git: { head: "a6bed92b6f2a4f1f3c2f5f9f6e6d2e8c1a1b2c3d", branch: "main", dirty: false },
};
const memory = { current: "# 현재 일감 요약\n- 요청: 로그인 고치기", updatedAt: "2026-10-13T09:00:00.000Z", projectBytes: 3000, push: "none", needsCompact: false };

test("cleanHandoff: 작업 메모리는 current 본문(6KB 상한)과 크기·시각·상태만 저장하고, 비밀값·PC 경로는 가린다", () => {
  const dirty = { ...memory, current: `# 현재 일감 요약\n- 요청: storePassword=hunter2 로 서명, C:\\Users\\kju90\\dev\\x\n${"가".repeat(9000)}`, push: "failed", needsCompact: true, error: "ssh 실패", project: "PROJECT-BODY" };
  const out = handoffLib.cleanHandoff({ ...entry, memory: dirty });
  assert.ok(out.memory);
  assert.deepEqual(Object.keys(out.memory).sort(), ["current", "error", "needsCompact", "projectBytes", "push", "updatedAt"]);
  assert.ok(out.memory.current.length <= 6000 && out.memory.current.includes("\n"));
  const text = JSON.stringify(out);
  for (const bad of ["hunter2", "kju90", "PROJECT-BODY"]) assert.ok(!text.includes(bad), `${bad} 가 남았어요`);
  assert.ok(Buffer.byteLength(text) <= 12000);
  assert.equal(handoffLib.cleanHandoff({ ...entry, memory: { ...memory, push: "weird" } }).memory, undefined);
  assert.equal(handoffLib.cleanHandoff({ ...entry, memory: "x" }).memory, undefined);
  assert.equal(handoffLib.cleanHandoff({ ...entry, memory: { ...memory, updatedAt: "어제" } }).memory, undefined);
});

test("인계 기록 칸 안에 현재 일감 요약이 보이고, 예전 항목(요약 없음)은 칸이 없다", () => {
  const html = renderToStaticMarkup(React.createElement(HandoffBox, { entry: { ...entry, memory } }));
  assert.match(html, /data-memory-current/);
  assert.match(html, /로그인 고치기/);
  assert.match(html, /원격 미설정/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(HandoffBox, { entry })), /data-memory-current/);
});

test("설정의 작업 메모리: 폴더별 한 줄(갱신 시각 · project.md 크기 · 서버2 푸시 결과), 잘못된 줄은 버린다", () => {
  const line = renderToStaticMarkup(React.createElement(MemoryStatus, { report: "selfdev|2026-10-13T09:10:20.000Z|6|ok|0;app|2026-10-12T21:00:00.000Z|22|failed|1;bad|row;x|2026-10-12T21:00:00.000Z|1|weird|0;n|2026-10-12T21:00:00.000Z|2|none|0;g|2026-10-12T21:00:00.000Z|2|blocked|0" }));
  assert.match(line, /selfdev/);
  assert.match(line, /서버2 푸시 성공/);
  assert.match(line, /서버2 푸시 실패/);
  assert.match(line, /원격 미설정/);
  assert.match(line, /푸시 거부/);
  assert.match(line, /요약 정리 필요/);
  assert.equal((line.match(/project\.md/g) ?? []).length, 4);
  assert.match(renderToStaticMarkup(React.createElement(MemoryStatus, { report: "" })), /아직 기록 없음/);
});

test("/next 는 memory 쿼리를 모양이 맞는 줄만 받아 실행 정보에 저장하고, 설정 API 가 돌려준다", () => {
  const route = read("app/api/factory/next/route.ts");
  assert.match(route, /param\("memory", 600\)/);
  assert.match(route, /\.\.\.\(memory \? \{ memory \} : \{\}\)/); // 안 보낸 응답에서는 지난 값을 그대로 둔다
  assert.match(read("app/api/admin/factory/secrets/route.ts"), /memory: rt\.memory \?\? ""/);
});
