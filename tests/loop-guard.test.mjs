// 일감 시간 낭비 막기(1-3) 서버·화면 쪽 시험:
// 설정 검증·저장(서버와 감독 프로그램의 정리 기준이 같음) · 관리자 API · 작업 규칙 문구(서버 기본값·감독 프로그램 rulesFor) ·
// 일감 크기 예상('예상 큼' 표시와 안내, 막지 않음) · 채팅 도구 설명 한 줄 · 통제실 설정 카드.
// 가짜 DB·가짜 요청으로만 돌린다(실제 DB·네트워크·Claude 사용 안 함). 실행: npm run test:loop-guard
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { NextRequest, NextResponse } = require("next/server");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");

function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : name === "./SettingsCard" ? loadTs("components/admin/factory/SettingsCard.tsx") : require(name)), module, module.exports);
  return module.exports;
}

const guard = await import(pathToFileURL(path.join(repo, "tools/factory-supervisor/loopguard.mjs")).href);

const SENTENCE = "중간 확인은 빌드·린트·단위 시험으로 한다. 스크린샷 e2e는 마지막에 한 번만 돌린다. 측정·시뮬레이션은 지시문이 요구할 때만, 요구한 범위만 한다.";
const TOOL_LINE = "측정·조사·시뮬레이션처럼 코드를 바꾸지 않는 일은 실험 일감으로 보내세요";

// ── 가짜 설정 저장소 ──
const store = new Map();
const prisma = {
  factorySetting: {
    findUnique: async ({ where }) => (store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null),
    upsert: async ({ where, create, update }) => (store.set(where.key, store.has(where.key) ? update.value : create.value), {}),
    deleteMany: async () => ({ count: 0 }),
  },
};
const settings = loadTs("lib/factory/settings.ts", { "@/lib/prisma": { __esModule: true, default: prisma }, "@/lib/factory/ai": { isAiEngine: () => true, isClaudeModel: () => true }, "@/lib/factory/toolBroker": { isToolBrokerMode: () => true, normalizeToolBroker: (v) => v, readStoredToolBroker: () => null, TOOL_BROKER_LIMITS_VERSION: 1 } });

test("설정 정리: 서버와 감독 프로그램의 기준이 같다(기본값·범위·이상한 값)", () => {
  assert.deepEqual(settings.DEFAULT_LOOP_GUARD, { ...guard.LOOPGUARD_DEFAULTS });
  for (const v of [undefined, null, {}, { repeatMax: 1 }, { repeatMax: 99 }, { repeatMax: "5" }, { judge: "result" }, { judge: "x" }, { enabled: false }, { enabled: 1 }, { screenshotMaxMin: 0 }, { screenshotMaxMin: 500 }, { minChangedFiles: -3 }, { minChangedFiles: "7" }, "abc", 5]) {
    assert.deepEqual(settings.cleanLoopGuard(v), guard.cleanLoopGuard(v), JSON.stringify(v));
  }
});

test("설정 저장: 정한 적 없으면 기본값(isDefault), 일부만 바꿔 저장, 이상한 값은 저장 안 함", async () => {
  store.clear();
  assert.deepEqual(await settings.getLoopGuard(), { value: { enabled: true, repeatMax: 3, judge: "any", minChangedFiles: 2, screenshotMaxMin: 15 }, isDefault: true });
  const ok = await settings.patchLoopGuard({ repeatMax: 5, screenshotMaxMin: 30 });
  assert.equal(ok.ok, true);
  assert.deepEqual((await settings.getLoopGuard()).value, { enabled: true, repeatMax: 5, judge: "any", minChangedFiles: 2, screenshotMaxMin: 30 });
  assert.equal((await settings.getLoopGuard()).isDefault, false);
  await settings.patchLoopGuard({ judge: "result", enabled: false });
  assert.deepEqual((await settings.getLoopGuard()).value, { enabled: false, repeatMax: 5, judge: "result", minChangedFiles: 2, screenshotMaxMin: 30 }, "앞서 저장한 항목은 그대로");
  const before = store.get("loopGuard");

  for (const bad of [{ repeatMax: 1 }, { repeatMax: 21 }, { repeatMax: 2.5 }, { repeatMax: "" }, { repeatMax: true }, { screenshotMaxMin: 0 }, { screenshotMaxMin: 121 }, { minChangedFiles: -1 }, { judge: "weird" }, { enabled: "yes" }, null, [], "x"]) {
    const r = await settings.patchLoopGuard(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.message.length > 0);
  }
  assert.equal(store.get("loopGuard"), before, "잘못된 값은 저장 안 함");
  store.set("loopGuard", "{깨진 글");
  assert.equal((await settings.getLoopGuard()).isDefault, true, "저장된 값이 깨졌으면 기본값");
  store.clear();
});

// ── 관리자 API ──
let admin = true;
const requireAdmin = async () => (admin ? null : NextResponse.json({ message: "관리자만" }, { status: 403 }));
const snapshot = async () => ({ running: 0, loopGuard: (await settings.getLoopGuard()).value, loopGuardDefault: (await settings.getLoopGuard()).isDefault });
const controlRoute = loadTs("app/api/admin/factory/control/route.ts", {
  "@/lib/factory/admin": { requireAdmin },
  "@/lib/factory/ai": { isAiEngine: () => false, AI_LABELS: {}, readModelChoice: () => ({ ok: false, message: "" }) },
  "@/lib/factory/settings": settings,
  "@/lib/factory/toolBroker": { isToolBrokerMode: () => false, TOOL_BROKER_MODE_LABELS: {}, toolBrokerLimitLabel: () => "" },
  "@/lib/factory/supervisor": { supervisorSnapshot: snapshot, runSupervisorAction: async () => ({ message: "", snapshot: {} }) },
  // 이 시험과 상관없는 모듈은 빈 껍데기로(관리자 API 는 loopGuard 요청만 시험한다)
  "@/lib/factory/appChecks": {},
  "@/lib/factory/conductor": {},
  "@/lib/factory/toolkit": {},
  "@/lib/factory/appRoles": {},
  "@/lib/factory/studioProjects": {},
  "@/lib/prisma": { __esModule: true, default: prisma },
  "@/lib/factory/arts": {},
  "@/lib/studio/requests": {},
  "@/lib/factory/supervisorLog": {},
});
const post = (body) => new NextRequest("http://x/api/admin/factory/control", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

test("관리자 API: 비관리자는 막히고, 관리자는 저장(응답에 값과 안내), 범위 밖은 400", async () => {
  store.clear();
  admin = false;
  assert.equal((await controlRoute.POST(post({ loopGuard: { repeatMax: 5 } }))).status, 403);
  assert.equal(store.has("loopGuard"), false);
  admin = true;
  const res = await controlRoute.POST(post({ loopGuard: { repeatMax: 5, screenshotMaxMin: 20 } }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.loopGuard.repeatMax, 5);
  assert.equal(body.loopGuardDefault, false);
  assert.match(body.message, /5번을 넘게 반복되면/);
  assert.match(body.message, /'막힘'/);
  assert.match(body.message, /20분/);
  const off = await (await controlRoute.POST(post({ loopGuard: { enabled: false } }))).json();
  assert.match(off.message, /껐어요/);
  const bad = await controlRoute.POST(post({ loopGuard: { screenshotMaxMin: 999 } }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).message, /1~120/);
  assert.equal(JSON.parse(store.get("loopGuard")).enabled, false, "잘못된 요청은 저장된 값을 바꾸지 않는다");
  store.clear();
});

test("/next 와 통제실 상태가 loopGuard 를 감독 프로그램·화면에 내려 준다(소스 확인)", () => {
  assert.match(read("app/api/factory/next/route.ts"), /getLoopGuard\(\)\)[\s\S]{0,80}\.value[\s\S]*\.\.\.\(loopGuard \? \{ loopGuard \} : \{\}\)/);
  assert.match(read("lib/factory/supervisor.ts"), /loopGuard: loopGuard\.value/);
  assert.match(read("tools/factory-supervisor/supervisor.mjs"), /r\.data\?\.loopGuard[\s\S]{0,120}loopGuardSettings = cleanLoopGuard\(r\.data\.loopGuard\)/);
});

// ── 작업 규칙 문구 ──
test("작업 규칙: 서버 기본값(common)과 감독 프로그램 rulesFor 에 같은 문구가 들어 있고, 앱 일감에 실제로 전달된다", () => {
  const rules = loadTs("lib/factory/rules.ts", { "@/lib/prisma": { __esModule: true, default: prisma } });
  assert.ok(rules.DEFAULT_RULES.common.includes(SENTENCE));
  for (const kind of ["new", "revision"]) {
    const out = rules.renderRules({ appSlug: "a", title: "t", stack: "nextjs", kind }, {});
    assert.ok(out.rules.includes(SENTENCE), `${kind} 일감 규칙에 포함`);
  }
  assert.ok(read("tools/factory-supervisor/supervisor.mjs").includes(`- ${SENTENCE}`), "감독 프로그램 기본 규칙(서버 값이 없을 때)");
  assert.ok(read("lib/factory/rules.ts").includes(`- ${SENTENCE}`));
  // 통제실에서 common 을 직접 고쳐 둔 경우에는 그 글이 우선(문구가 강제로 끼어들지 않는다)
  assert.equal(rules.renderRules({ appSlug: "a", title: "t", stack: "nextjs", kind: "new" }, { common: "내 규칙" }).rules.includes(SENTENCE), false);
});

test("채팅 도구 설명: enqueue_app_job 과 enqueue_lab_job 에 '실험 일감으로 보내라' 한 줄", () => {
  const src = read("lib/factory/mcp.ts");
  for (const name of ["enqueue_app_job", "enqueue_lab_job"]) {
    const i = src.indexOf(`name: "${name}"`);
    const block = src.slice(i, src.indexOf("inputSchema", i));
    assert.ok(block.includes(TOOL_LINE), `${name} 설명`);
  }
});

// ── 일감 크기 예상 ──
const size = loadTs("lib/factory/jobSize.ts");

test("일감 크기: 10-14 돌탑 같은 지시(측정 + 스크린샷)는 '예상 큼', 짧은 수정은 아님", () => {
  const tower = "소원 돌탑 수정:\n- 봇 측정: 시드 30개 × 60턴으로 분포 3종을 측정한다\n- 불일치 원인 재현 시뮬레이션\n- 화면 스크린샷 e2e 로 30장 확인";
  const big = size.estimateJobSize(tower, "revision");
  assert.equal(big.big, true);
  assert.equal(big.measure, true);
  assert.equal(big.screenshot, true);
  assert.ok(big.reasons.includes("측정·시뮬레이션 요구"));
  assert.ok(big.reasons.includes("스크린샷·e2e 요구"));
  assert.equal(size.estimateJobSize("버튼 색을 파란색으로 바꿔 주세요.", "revision").big, false);
  assert.equal(size.estimateJobSize("홈 화면 스크린샷을 한 장 찍어 주세요.", "revision").big, false, "스크린샷 요구 하나만으로는 큼이 아님");
  assert.equal(size.estimateJobSize("밸런스를 시뮬레이션으로 측정해 주세요.", "revision").big, true, "측정 요구는 그것만으로 큼");
});

test("일감 크기: 길이와 항목 수도 점수가 되고, 새 앱 기획서는 길이 기준이 3배, 실험·출시는 대상이 아님", () => {
  const items = Array.from({ length: 12 }, (_, i) => `- 항목 ${i + 1}`).join("\n");
  assert.equal(size.countItems(items), 12);
  assert.equal(size.countItems("1. 가\n2) 나\n  * 다\n문장"), 3);
  const many = size.estimateJobSize(items, "revision");
  assert.equal(many.score, 1);
  assert.equal(many.big, false, "항목만 많은 건 1점");
  const longManyText = `${items}\n${"긴 설명 ".repeat(600)}`;
  assert.equal(size.estimateJobSize(longManyText, "revision").big, true, "길고 항목도 많으면 큼");
  assert.equal(size.estimateJobSize(longManyText, "new").big, false, "새 앱 기획서는 길이 기준이 3배라 길다고 안 봄");
  assert.equal(size.estimateJobSize("측정 시뮬레이션 스크린샷 e2e", "lab").big, false);
  assert.equal(size.estimateJobSize("측정 시뮬레이션 스크린샷 e2e", "release").big, false);
  assert.match(size.BIG_JOB_ADVICE, /실험 일감으로 나누는 것을 권해요/);
  assert.match(size.BIG_JOB_ADVICE, /안내만 해요/);
});

test("승인 화면: 큰 일감에 '예상 큼'과 실험 일감 안내를 보이고, 작은 일감에는 아무것도 없다. 승인 버튼은 막지 않는다", () => {
  const Notice = loadTs("components/admin/factory/JobSizeNotice.tsx", { "@/lib/factory/jobSize": size }).default;
  const big = renderToStaticMarkup(h(Notice, { plan: "- 봇 측정 시드 30\n- 스크린샷 e2e", kind: "revision" }));
  assert.match(big, /data-job-size-notice="big"/);
  assert.match(big, /예상 큼/);
  assert.match(big, /측정·시뮬레이션 요구/);
  assert.match(big, /실험 일감으로 나누는 것을 권해요/);
  assert.equal(renderToStaticMarkup(h(Notice, { plan: "버튼 색 변경", kind: "revision" })), "");
  const control = read("components/admin/factory/FactoryControl.tsx");
  assert.match(control, /job\.status === "pending" && <JobSizeNotice kind=\{job\.kind\} plan=\{job\.planMarkdown\} \/>/, "승인 대기 일감 상세에 표시");
  assert.match(control, /action: "approve"/, "승인 동작은 그대로(안내만 하고 막지 않음)");
  assert.doesNotMatch(read("components/admin/factory/JobSizeNotice.tsx"), /isDisabled|disabled/);
});

test("통제실 설정 카드: 현재 값과 기본값 표시, 저장 버튼", () => {
  const data = { loopGuard: { enabled: true, repeatMax: 3, judge: "any", minChangedFiles: 2, screenshotMaxMin: 15 }, loopGuardDefault: true };
  const Card = loadTs("components/admin/factory/LoopGuardSettings.tsx", {
    "./useFactoryControl": { useFactoryControl: () => ({ data }), postControl: async () => ({ ok: true, data: {} }) },
  }).default;
  const html = renderToStaticMarkup(h(Card));
  assert.match(html, /data-loop-guard-settings/);
  assert.match(html, /일감 시간 낭비 막기/);
  assert.match(html, /반복 감지 켜짐/);
  assert.match(html, /3회 넘게/);
  assert.match(html, /스크린샷 15분/);
  assert.match(html, /정한 적 없어서 기본값/);
  assert.match(html, /data-loop-guard-save/);
  assert.match(read("components/admin/factory/FactoryConsole.tsx"), /<LoopGuardSettings \/>/);
});

test("업데이트 묶는 시간 입력 정규식이 숫자를 받는다(\\d 누락 수정)", () => {
  const src = read("components/admin/factory/AppSlotsSettings.tsx");
  assert.doesNotMatch(src, /\/\^d\{1,3\}\$\//);
  assert.equal((src.match(/\/\^\\d\{1,3\}\$\//g) ?? []).length >= 2, true);
});
