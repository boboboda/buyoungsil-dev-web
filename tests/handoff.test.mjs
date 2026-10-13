// 인계 기록(Claude Code ↔ Codex 공유)의 서버·통제실 쪽 시험: 보고 저장 정리, 읽기 전용 접이식 칸, 호출 지점 연결.
// 감독 프로그램 쪽(만들기·크기·주입)은 tools/factory-supervisor/tests/handoff.test.mjs.
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
const HandoffBox = loadTs("components/admin/factory/HandoffBox.tsx", { "@/lib/factory/handoff": handoffLib }).default;

const entry = {
  v: 1, kind: "maintenance", taskId: "turn1", threadId: "th1", title: "로그인 수정", engine: "codex", model: "기본", at: "2026-10-13T09:00:00.000Z", status: "done",
  request: "로그인 화면 오류를 고쳐 줘", hasAiBlock: true, doneWhen: "빌드 통과", done: "login.tsx 수정", remaining: "비밀번호 찾기는 아직", caution: "API 주소는 그대로",
  files: { committed: { list: ["a.ts", "b.ts"], more: 3 }, uncommitted: { list: [], more: 0 } },
  checks: [{ name: "감독 문법·타입 검사", result: "통과" }, { name: "앱 빌드", result: "건너뜀", detail: "Mac 필요" }],
  git: { head: "a6bed92b6f2a4f1f3c2f5f9f6e6d2e8c1a1b2c3d", branch: "main", dirty: true, fingerprint: "SHOULD-NOT-PASS" },
  planMarkdown: "SECRET-PLAN", token: "SECRET-TOKEN", prompt: "SECRET-PROMPT", diff: "SECRET-DIFF",
};

test("cleanHandoff: 정해진 칸만 남기고(기획서·토큰·프롬프트·diff·지문 제외), 비밀번호 모양과 PC 경로는 가린다", () => {
  const dirty = { ...entry, request: "storePassword=hunter2 로 서명, C:\\Users\\kju90\\dev\\x 에서", failReason: "keyPassword: abc123 거부" };
  const out = handoffLib.cleanHandoff(dirty);
  assert.ok(out);
  const text = JSON.stringify(out);
  for (const bad of ["SECRET-PLAN", "SECRET-TOKEN", "SECRET-PROMPT", "SECRET-DIFF", "SHOULD-NOT-PASS", "hunter2", "abc123", "kju90"]) assert.ok(!text.includes(bad), `${bad} 가 남았어요`);
  assert.deepEqual(Object.keys(out).sort(), ["at", "caution", "checks", "done", "doneWhen", "engine", "failReason", "files", "git", "hasAiBlock", "kind", "model", "remaining", "request", "status", "taskId", "threadId", "title", "v"]);
  assert.deepEqual(Object.keys(out.git).sort(), ["branch", "dirty", "head"]);
  assert.match(out.request, /~/);
});

test("cleanHandoff: 형식이 틀리거나 너무 크면 저장하지 않는다(null)", () => {
  assert.equal(handoffLib.cleanHandoff(null), null);
  assert.equal(handoffLib.cleanHandoff("x"), null);
  assert.equal(handoffLib.cleanHandoff([]), null);
  assert.equal(handoffLib.cleanHandoff({ ...entry, kind: "other" }), null);
  assert.equal(handoffLib.cleanHandoff({ ...entry, status: "weird" }), null);
  assert.equal(handoffLib.cleanHandoff({ ...entry, at: "어제" }), null);
  const huge = handoffLib.cleanHandoff({ ...entry, checks: Array.from({ length: 50 }, () => ({ name: "x".repeat(500), result: "통과", detail: "y".repeat(5000) })), request: "z".repeat(100000) });
  assert.ok(Buffer.byteLength(JSON.stringify(huge)) <= 6000); // 잘려서 상한 안에 들어간다
  assert.equal(huge.checks.length, 6);
});

test("parseReport: 인계 항목을 정리해 싣고, 없으면 null(예전 감독 프로그램)", () => {
  const jobs = loadTs("lib/factory/jobs.ts", {
    "@/lib/prisma": { __esModule: true, default: {} },
    "@/lib/factory/ai": loadTs("lib/factory/ai.ts"),
    "@/lib/factory/project": { ensureProjectForJob: async () => {} },
    "@/lib/factory/reviewVideo": { deleteReviewVideo: async () => {} },
    "@/lib/factory/mask": mask,
    "@/lib/factory/toolBroker": { cleanToolRequests: () => null },
    "@/lib/factory/handoff": handoffLib,
    "@/lib/factory/settings": { getDefaultClaudeModel: async () => null },
  });
  const withIt = jobs.parseReport({ jobId: "cjob000000000000001", status: "done", summary: "ok", handoff: entry });
  assert.equal(withIt.ok, true);
  assert.equal(withIt.value.handoff.title, "로그인 수정");
  assert.ok(!JSON.stringify(withIt.value.handoff).includes("SECRET"));
  const without = jobs.parseReport({ jobId: "cjob000000000000001", status: "done", summary: "ok" });
  assert.equal(without.value.handoff, null);
});

test("정비 결과 보고(reportTurn): 결과 메시지에 인계 항목을 저장하고, 개요에는 결과 메시지에만 실린다", async () => {
  const created = [];
  const turn = { id: "turn", role: "user", status: "running", maintenanceId: "thread", aiEngine: "codex", aiModel: null, startedAt: new Date(), createdAt: new Date() };
  const empty = { findMany: async () => [], findFirst: async () => null, count: async () => 0 };
  const maint = loadTs("lib/factory/maintenance.ts", {
    "@/lib/prisma": {
      __esModule: true,
      default: {
        factoryMaintenanceMessage: { ...empty, findUnique: async () => turn, update: async () => ({}), create: async ({ data }) => { created.push(data); return {}; }, createMany: async () => ({}) },
        factoryMaintenance: { ...empty, findUnique: async () => ({ id: "thread", deployRequestedAt: null }), update: async () => ({}) },
        factoryDeploy: empty,
      },
    },
    "@/lib/factory/ai": loadTs("lib/factory/ai.ts"),
    "@/lib/factory/mask": mask,
    "@/lib/factory/handoff": handoffLib,
    "@/lib/factory/telegram": { notifyDeployReady: async () => {}, notifyMaintenance: async () => {}, notifyText: async () => {} },
    "@/lib/factory/settings": { getDefaultAiEngine: async () => "claude", getDefaultClaudeModel: async () => null, getSettingValue: async () => null, isAutoDeployEnabled: async () => false, setSettingValue: async () => {} },
  });
  await maint.reportTurn({ turnId: "turn", done: { ok: true, text: "끝", handoff: entry } });
  const assistant = created.find((d) => d.role === "assistant");
  assert.equal(assistant.handoff.title, "로그인 수정");
  assert.ok(!JSON.stringify(assistant.handoff).includes("SECRET"));
  created.length = 0;
  await maint.reportTurn({ turnId: "turn", done: { ok: false, text: "실패", handoff: { not: "valid" } } }); // 형식이 틀리면 저장하지 않고 결과는 그대로
  assert.ok(!("handoff" in created.find((d) => d.role === "assistant")));
});

test("인계 기록 칸: 접이식·읽기 전용, ①~⑤ 항목이 보이고 비밀 칸은 없다", () => {
  const html = renderToStaticMarkup(React.createElement(HandoffBox, { entry: handoffLib.cleanHandoff(entry) }));
  assert.match(html, /<details[^>]*data-handoff/);
  assert.doesNotMatch(html, /<details[^>]*\sopen/); // 기본은 접힘
  assert.match(html, /인계 기록/);
  for (const text of ["로그인 화면 오류를 고쳐 줘", "빌드 통과", "login.tsx 수정", "a.ts, b.ts 외 3개", "감독 문법·타입 검사", "통과", "건너뜀", "Mac 필요", "비밀번호 찾기는 아직", "API 주소는 그대로", "main", "a6bed92", "Codex", "커밋 안 된 변경 있음"]) assert.ok(html.includes(text), `${text} 가 안 보여요`);
  assert.doesNotMatch(html, /SECRET|<input|<textarea|<button/); // 읽기 전용
  assert.doesNotMatch(html, /data-handoff-missing/);
});

test("인계 기록 칸: AI 블록이 없으면 '인계 요약 없음', 기록이 없으면 칸을 그리지 않는다", () => {
  const missing = renderToStaticMarkup(React.createElement(HandoffBox, { entry: handoffLib.cleanHandoff({ ...entry, hasAiBlock: false, doneWhen: "", done: "", remaining: "", caution: "", status: "failed", failReason: "필수 검증 실패" }) }));
  assert.match(missing, /data-handoff-missing/);
  assert.match(missing, /인계 요약 없음/);
  assert.match(missing, /실패 사유/);
  assert.equal(renderToStaticMarkup(React.createElement(HandoffBox, { entry: null })), "");
  assert.equal(renderToStaticMarkup(React.createElement(HandoffBox, { entry: undefined })), "");
});

test("연결 지점: 일감 상세·정비 대화에 칸이 있고, 일감 상세 API 는 관리자만, 정비 개요는 결과 메시지에만 싣는다", () => {
  assert.match(read("components/admin/factory/FactoryControl.tsx"), /<HandoffBox entry=\{job\.handoff\} \/>/);
  assert.match(read("components/admin/factory/MaintenancePanel.tsx"), /m\.role === "assistant" && m\.handoff/);
  const detail = read("app/api/admin/factory/jobs/[id]/route.ts");
  assert.match(detail.split("export async function POST")[0], /requireAdmin\(\)/);
  assert.match(read("lib/factory/maintenance.ts"), /handoff: m\.role === "assistant" \? m\.handoff : null/);
  // 공개 화면·상태바 등 다른 곳은 인계 기록을 읽지 않는다
  for (const rel of ["app/api/factory/next/route.ts"]) assert.doesNotMatch(read(rel), /handoff/);
});

test("연결 지점: 정비·앱 일감·터미널이 끝날 때 인계 기록을 쓰고, 앱 일감은 이전 기록을 읽는다", () => {
  const maintenance = read("tools/factory-supervisor/maintenance.mjs");
  assert.match(maintenance, /kind: "maintenance"[^\n]*checks/);
  assert.match(maintenance, /done\.handoff = saveHandoff\(/);
  const supervisor = read("tools/factory-supervisor/supervisor.mjs");
  assert.match(supervisor, /makeHandoffEntry\(st\.dir/);
  assert.match(supervisor, /handoffPrompt\(dir, promptFor\(job\), \{ appScope: true \}\)/);
  assert.match(supervisor, /kind: "job"/);
  assert.match(read("tools/factory-supervisor/ai.mjs"), /handoff: \{ kind: "terminal"/);
  // 실패한 일감도 기록(검증 실패 → failed 항목), 검사는 감독이 직접 돌린 결과만(AI 의 말은 증거 아님)
  assert.match(supervisor, /필수 검증 실패/);
});

test("마이그레이션은 열만 추가하고 데이터를 지우지 않는다", () => {
  const dir = fs.readdirSync(path.join(repo, "prisma/migrations")).find((d) => d.endsWith("add_handoff_columns"));
  const sql = read(`prisma/migrations/${dir}/migration.sql`).replace(/--.*$/gm, "").trim();
  assert.match(sql, /ALTER TABLE "factory_jobs" ADD COLUMN IF NOT EXISTS "handoff" JSONB;/);
  assert.match(sql, /ALTER TABLE "factory_maintenance_messages" ADD COLUMN IF NOT EXISTS "handoff" JSONB;/);
  assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE|UPDATE|NOT NULL/i);
});
