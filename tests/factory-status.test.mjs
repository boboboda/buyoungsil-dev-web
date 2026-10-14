// 통제실 [현황] 상태 체계 시험: 상태→색 종류·아이콘·글자 매핑, '지금 진행 중' 띠(0·1·3·4개 이상), '대화 열림' 문구,
// '진행 중만 보기' 토글, 서버 activeNow(읽기 전용 값), overview 응답의 active 필드. 가짜 DB·가짜 데이터만 쓴다.
// 색 대비는 test:admin-contrast 에 있다.
// 실행: npm run test:factory-status
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

function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : name === "./useFactoryControl" ? loadTs("components/admin/factory/useFactoryControl.ts") : require(name)), module, module.exports);
  return module.exports;
}

const fx = loadTs("components/admin/factory/fx.tsx");
const aiLib = loadTs("lib/factory/ai.ts");
const view = loadTs("components/admin/factory/FactoryOverview.tsx", {
  "./fx": fx,
  "@/lib/factory/ai": aiLib,
  "./ClaudeModelSelect": loadTs("components/admin/factory/ClaudeModelSelect.tsx", { "@/lib/factory/ai": aiLib }),
});
const html = (el) => renderToStaticMarkup(el);
const count = (s, re) => (s.match(re) ?? []).length;

test("상태 종류 7가지: 아이콘·글자·색 이름이 모두 있고 서로 겹치지 않는다", () => {
  const rows = Object.entries(fx.STATUS_KINDS);
  assert.deepEqual(rows.map(([k]) => k), ["run", "approval", "wait", "done", "fail", "cancel", "info"]);
  assert.deepEqual(rows.map(([, s]) => s.icon), ["▶", "✋", "◷", "✓", "✕", "⊘", "•"]);
  assert.deepEqual(rows.slice(0, 6).map(([, s]) => s.word), ["진행 중", "승인 필요", "대기", "완료", "실패", "취소"]);
  assert.equal(new Set(rows.map(([, s]) => s.icon)).size, 7, "아이콘이 서로 달라야 흑백에서도 구분");
  for (const [k] of rows) {
    const out = html(h(fx.StatusChip, { kind: k }));
    assert.match(out, new RegExp(`class="fx-st fx-st-${k}"`));
    assert.match(out, /aria-hidden="true"/); // 아이콘은 화면 읽기 프로그램에 읽히지 않고, 글자가 읽힌다
  }
  assert.match(html(h(fx.StatusChip, { kind: "run" })), /▶<\/span>진행 중/);
  assert.match(html(h(fx.StatusChip, { kind: "approval" })), /✋<\/span>승인 필요/);
  assert.match(html(h(fx.StatusChip, { kind: "fail", label: "실패·되돌림" })), /✕<\/span>실패·되돌림/);
  assert.deepEqual([fx.isLiveKind("run"), fx.isLiveKind("approval"), fx.isLiveKind("wait"), fx.isLiveKind("done"), fx.isLiveKind("fail")], [true, true, false, false, false]);
});

test("일감 상태 → 종류·글자: 대기/승인 필요/진행 중/완료/실패/취소", () => {
  const want = {
    pending: ["approval", "승인 필요"],
    approved: ["wait", "대기"],
    running: ["run", "진행 중"],
    review: ["approval", "검토 필요"],
    linkwait: ["approval", "영상 링크 필요"],
    done: ["done", "완료"],
    failed: ["fail", "실패"],
    cancelled: ["cancel", "취소"],
  };
  for (const [status, [kind, label]] of Object.entries(want)) assert.deepEqual({ ...fx.jobStatusInfo(status) }, { kind, label }, status);
  assert.deepEqual({ ...fx.jobStatusInfo("모르는값") }, { kind: "info", label: "모르는값" });
  const turn = { awaiting_approval: ["approval", "승인 필요"], queued: ["wait", "대기"], running: ["run", "진행 중"], done: ["done", "완료"], failed: ["fail", "실패"], cancelled: ["cancel", "취소"] };
  for (const [status, [kind, label]] of Object.entries(turn)) assert.deepEqual({ ...fx.turnStatusInfo(status) }, { kind, label }, status);
});

test("종류 칩은 색 없는 윤곽선 칩(fx-kind), data-kind 는 줄 종류가 있을 때만", () => {
  assert.match(html(h(fx.KindChip, { label: "🛠 정비", kind: "threads" })), /class="fx-kind" data-kind="threads">🛠 정비</);
  assert.doesNotMatch(html(h(fx.KindChip, { label: "수정" })), /data-kind/);
});

test("경과 시간 표기", () => {
  assert.equal(fx.formatElapsed(0), "0초");
  assert.equal(fx.formatElapsed(59_999), "59초");
  assert.equal(fx.formatElapsed(3 * 60_000 + 12_000), "3분 12초");
  assert.equal(fx.formatElapsed(2 * 3600_000 + 5 * 60_000), "2시간 5분");
  assert.equal(fx.formatElapsed(-5), "0초");
});

// ── '지금 진행 중' 띠 ──
const NOW = Date.UTC(2026, 9, 13, 9, 0, 0);
const ago = (ms) => new Date(NOW - ms).toISOString();
const job = (n, startedAgo) => ({ type: "job", id: `cjob${n}`, title: `앱 일감 ${n}`, sub: `app-${n}`, kindLabel: "수정", startedAt: ago(startedAgo), aiEngine: "claude", aiModel: "opus" });
const strip = (props) => html(h(view.ActiveStrip, { now: NOW, ...props }));

test("띠 0개: '진행 중인 작업 없음 · 대기 N개' + 맨 위 한 개를 흐리게 '다음 차례'", () => {
  const out = strip({ active: { running: [], queued: 3, next: { type: "job", title: "timer-app 수정" } } });
  assert.match(out, /진행 중인 작업 없음 · 대기 3개/);
  assert.match(out, /data-active-next[^>]*>[^<]*다음 차례: timer-app 수정/);
  assert.match(out, /fx-faint/);
  assert.equal(count(out, /data-active-item=/g), 0);
  // 예전 서버(active 없음)도 깨지지 않는다
  assert.match(strip({ active: undefined }), /진행 중인 작업 없음 · 대기 0개/);
  assert.match(strip({ active: undefined, loading: true }), /읽는 중/);
});

test("띠 1개: 종류·이름·경과 시간·AI·모델이 한 줄에, 줄을 누르면 상세로", () => {
  const out = strip({ active: { running: [job(1, 192_000)], queued: 0, next: null } });
  assert.equal(count(out, /data-active-item=/g), 1);
  assert.match(out, /fx-st-run/);
  assert.match(out, /앱 일감 1/);
  assert.match(out, /경과 3분 12초/);
  assert.match(out, /Claude Code/);
  assert.match(out, /data-model="opus"/);
  assert.match(out, /href="\/admin\/factory\?tab=jobs&amp;job=cjob1"/);
  assert.doesNotMatch(out, /진행 중인 작업 없음/);
  assert.doesNotMatch(out, /data-active-more/);
  assert.doesNotMatch(out, /data-active-queued/); // 대기 0개면 줄 없음
});

test("띠 3개/4개 이상: 최대 3개만, 나머지는 '외 N개'. 대기 개수와 다음 차례 표시", () => {
  const three = strip({ active: { running: [job(1, 3000), job(2, 2000), job(3, 1000)], queued: 2, next: { type: "maintenance", title: "다음 정비" } } });
  assert.equal(count(three, /data-active-item=/g), 3);
  assert.doesNotMatch(three, /data-active-more/);
  assert.match(three, /data-active-queued[^>]*>[^<]*대기 2개 · 다음 차례: 다음 정비/);
  const five = strip({ active: { running: [1, 2, 3, 4, 5].map((n) => job(n, n * 1000)), queued: 0, next: null } });
  assert.equal(count(five, /data-active-item=/g), 3);
  assert.match(five, /외 2개 진행 중/);
  // 오래 시작한 것부터
  assert.ok(five.indexOf("앱 일감 5") < five.indexOf("앱 일감 3") && !five.includes("앱 일감 1"));
});

test("띠: 정비 지시와 진행 중인 서버 배포를 합치고, 배포는 할 일 카드로 이동", () => {
  const deploys = [
    { threadId: "cthr1", title: "정비 배포", commit: "abcdef0123", inProgress: true, started: true, requestedAt: ago(90_000), lastResult: null },
    { threadId: "cthr2", title: "배포 대기 중인 것", commit: "1111111", inProgress: false, started: false, requestedAt: null, lastResult: null },
  ];
  const turn = { type: "maintenance", id: "cturn1", title: "통제실 [현황] 색 정리", sub: null, kindLabel: "정비", startedAt: ago(30_000), aiEngine: "codex", aiModel: null };
  const out = strip({ active: { running: [turn], queued: 0, next: null }, deploys });
  assert.equal(count(out, /data-active-item=/g), 2);
  assert.match(out, /data-active-item="deploy"[^>]*href="#factory-todo"|href="#factory-todo"[^>]*data-active-item="deploy"/);
  assert.match(out, /경과 1분 30초/);
  assert.match(out, /Codex/);
  assert.match(out, /href="\/admin\/factory\?tab=maint"/);
  assert.doesNotMatch(out, /배포 대기 중인 것/); // 아직 시작 안 한 배포는 '진행 중'이 아니다
  assert.deepEqual(view.activeItems(undefined, undefined), []);
});

// ── 이력 줄 ──
const T = (extra) => ({ id: "cthr", title: "정비 제목", status: "open", lastTurnStatus: "done", turns: 2, pushedCommit: null, needsDeploy: false, deployInProgress: false, deployedAt: null, deployResult: null, updatedAt: ago(0), ...extra });
const J = (n, status, extra) => ({ id: `cjob${n}`, appSlug: `app-${n}`, title: `일감 ${n}`, kind: "revision", kindLabel: "수정", status, aiEngine: "claude", aiModel: null, result: null, createdAt: ago(n * 1000), startedAt: null, finishedAt: null, ...extra });
const D = (n, ok, startedAt) => ({ id: `cdep${n}`, threadId: "t", threadTitle: `배포 ${n}`, commit: "abcdef0", via: null, requestedAt: ago(n * 1000), startedAt, finishedAt: null, ok, result: null, items: null });
const data = (extra) => ({ deploys: [], updates: [], threads: [], totals: { deploys: 0, updates: 0, threads: 0, jobs: 0 }, ...extra });
const panel = (props) => html(h(view.HistoryPanelView, { data: data(), open: true, tab: "deploys", full: null, onToggle() {}, onTab() {}, onShowAll() {}, onMore() {}, onShowRecent() {}, ...props }));

test("정비 대화의 '열림'은 '대화 열림'(흐린 보조 표시), 닫히면 '대화 닫힘'. 작업 상태 칩은 마지막 지시 상태", () => {
  const open = panel({ tab: "threads", data: data({ threads: [T({ status: "open", lastTurnStatus: "running" })] }) });
  assert.match(open, /data-thread-open="open"[^>]*>대화 열림</);
  assert.match(open, /class="fx-faint text-xs"/);
  assert.match(open, /fx-st-run/);
  assert.doesNotMatch(open.replace(/대화 열림/g, ""), /열림/);
  const closed = panel({ tab: "threads", data: data({ threads: [T({ status: "closed" })] }) });
  assert.match(closed, /data-thread-open="closed"[^>]*>대화 닫힘</);
  assert.match(closed, /fx-st-done/);
  // 마지막 지시가 없으면 상태 칩 없이 '대화 열림'만
  assert.doesNotMatch(panel({ tab: "threads", data: data({ threads: [T({ lastTurnStatus: null })] }) }), /data-st-chip/);
  // 배포 진행 중이면 진행 중
  assert.match(panel({ tab: "threads", data: data({ threads: [T({ deployInProgress: true })] }) }), /data-st="run"/);
});

test("줄 왼쪽 막대·배경은 상태별(data-st), 실패 사유는 접힌 채로도 보이는 빨간 글자", () => {
  const items = [J(1, "running"), J(2, "pending"), J(3, "approved"), J(4, "done"), J(5, "failed", { result: "필수 검증 실패: flutter analyze 오류 3개" }), J(6, "cancelled")];
  const out = panel({ tab: "jobs", data: data({ totals: { jobs: 6 } }), full: { kind: "jobs", items, nextCursor: null, total: 6, loading: false, error: null } });
  for (const k of ["run", "approval", "wait", "done", "fail", "cancel"]) assert.equal(count(out, new RegExp(`data-job="[^"]+" data-st="${k}"`, "g")), 1, k);
  assert.match(out, /data-fail-reason[^>]*class=|class="[^"]*fx-fail-text[^"]*"/);
  assert.match(out, /fx-fail-text[\s\S]*flutter analyze 오류 3개/);
  assert.match(out, /data-result="short"/);
});

test("배포·감독 업데이트 줄의 상태 종류", () => {
  const out = panel({ tab: "deploys", data: data({ deploys: [D(1, true, ago(1)), D(2, false, ago(1)), D(3, null, ago(1)), D(4, null, null)] }) });
  assert.deepEqual([...out.matchAll(/data-st="([a-z]+)"/g)].map((m) => m[1]), ["done", "fail", "run", "run"]);
  assert.match(out, /진행 중\(빌드\)/);
  assert.match(out, /진행 중\(PC 대기\)/);
  const U = (id, note, fromCommit) => ({ id, at: ago(1000), fromCommit, commit: "abcdef0", subject: null, note, thread: null });
  const up = panel({ tab: "updates", data: data({ updates: [U(1, "자동 업데이트 시작: x"), U(2, "자동 업데이트 실패: x"), U(3, "건너뜀"), U(4, null, null)] }) });
  assert.deepEqual([...up.matchAll(/data-st="([a-z]+)"/g)].map((m) => m[1]), ["run", "fail", "cancel", "info"]);
});

test("진행 중만 보기: 앱 일감 탭에서 진행 중·승인 필요 줄만 남는다", () => {
  const live = [J(1, "running"), J(2, "pending")];
  const other = [J(3, "done"), J(4, "failed"), J(5, "approved"), J(6, "cancelled")];
  const items = [...live, ...other];
  const full = { kind: "jobs", items, nextCursor: "n", total: 6, loading: false, error: null };
  const rows = (s) => count(s, /data-job="/g);
  // 앱 일감 탭
  const off = panel({ tab: "jobs", full });
  assert.equal(rows(off), 6);
  assert.match(off, /data-live-toggle[^>]*aria-pressed="false"|aria-pressed="false"[^>]*data-live-toggle/);
  const on = panel({ tab: "jobs", full, initialLiveOnly: true });
  assert.equal(rows(on), 2);
  assert.match(on, /aria-pressed="true"/);
  assert.match(on, /진행 중만 보는 중/);
  assert.match(on, /불러온 6개 중 진행 중·승인 필요만 보여요/);
  assert.equal(rows(panel({ tab: "jobs", initialLiveOnly: true, full: { ...full, items: other } })), 0);
  assert.match(panel({ tab: "jobs", initialLiveOnly: true, full: { ...full, items: other } }), /진행 중이거나 승인이 필요한 일감이 없어요/);
  // 다른 탭(서버 배포)에는 토글이 없다
  assert.doesNotMatch(panel({ tab: "deploys" }), /data-live-toggle/);
  assert.equal(view.isLiveItem("jobs", J(1, "linkwait")), true);
  assert.equal(view.isLiveItem("jobs", J(1, "approved")), false);
});

// ── 서버: 읽기 전용 값 ──
const T0 = Date.UTC(2026, 9, 1);
const jobsDb = [
  { id: "cj1", appSlug: "timer", title: "타이머 만들기", kind: "new", releaseKind: null, status: "running", aiEngine: "claude", aiModel: "opus", startedAt: new Date(T0 + 1000), createdAt: new Date(T0) },
  { id: "cj2", appSlug: "memo", title: "메모 수정", kind: "revision", releaseKind: null, status: "approved", aiEngine: "codex", aiModel: null, startedAt: null, createdAt: new Date(T0 + 5000) },
  { id: "cj3", appSlug: "memo", title: "출시", kind: "revision", releaseKind: "first", status: "approved", aiEngine: "claude", aiModel: null, startedAt: null, createdAt: new Date(T0 + 6000) },
  { id: "cj4", appSlug: "x", title: "끝난 것", kind: "new", releaseKind: null, status: "done", aiEngine: "claude", aiModel: null, startedAt: null, createdAt: new Date(T0) },
];
const msgsDb = [
  { id: "cm1", role: "user", status: "running", aiEngine: "claude", aiModel: null, startedAt: new Date(T0 + 2000), createdAt: new Date(T0 + 2000), maintenance: { id: "cth1", title: "색 정리" } },
  { id: "cm2", role: "user", status: "queued", aiEngine: "claude", aiModel: null, startedAt: null, createdAt: new Date(T0 + 4000), maintenance: { id: "cth2", title: "인계 기록" } },
  { id: "cm3", role: "assistant", status: null, aiEngine: "claude", aiModel: null, startedAt: null, createdAt: new Date(T0), maintenance: { id: "cth1", title: "색 정리" } },
];
const match = (row, where = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
const dbTable = (rows) => ({
  findMany: async (a = {}) => rows.filter((r) => match(r, a.where)).sort((x, y) => (x.startedAt ?? x.createdAt) - (y.startedAt ?? y.createdAt)).slice(0, a.take ?? 999),
  findFirst: async (a = {}) => rows.filter((r) => match(r, a.where)).sort((x, y) => x.createdAt - y.createdAt)[0] ?? null,
  count: async (a = {}) => rows.filter((r) => match(r, a.where)).length,
});
const ID_RE = new RegExp(fs.readFileSync(path.join(repo, "lib/factory/jobs.ts"), "utf8").match(/export const ID_RE = \/(.+)\/;/)[1]);
const approvals = loadTs("lib/factory/approvals.ts", {
  "@/lib/prisma": { __esModule: true, default: { factoryJob: dbTable(jobsDb), factoryMaintenanceMessage: dbTable(msgsDb) } },
  "@/lib/factory/jobs": { ID_RE, KIND_LABELS: { new: "새 앱", revision: "수정", release: "출시 준비" }, adminAction: async () => ({}) },
  "@/lib/factory/maintenance": {},
});

test("activeNow: 진행 중 일감·정비 지시, 대기 개수(승인된 일감 + 대기 지시), 가장 먼저 온 한 개가 다음 차례", async () => {
  const a = JSON.parse(JSON.stringify(await approvals.activeNow()));
  assert.deepEqual(a.running.map((r) => [r.type, r.id, r.title, r.sub, r.kindLabel]), [
    ["job", "cj1", "타이머 만들기", "timer", "새 앱"],
    ["maintenance", "cm1", "색 정리", null, "정비"],
  ]);
  assert.equal(a.running[0].aiModel, "opus");
  assert.equal(a.queued, 3);
  assert.deepEqual(a.next, { type: "maintenance", title: "인계 기록" }); // 대기 지시(T0+4s)가 승인된 일감(T0+5s)보다 먼저 왔다
  // 읽기 전용: 기획서·로그·작업 PC 이름 같은 열은 없다
  for (const r of a.running) assert.deepEqual(Object.keys(r).sort(), ["aiEngine", "aiModel", "id", "kindLabel", "startedAt", "sub", ...(r.type === "maintenance" ? ["threadId"] : []), "title", "type"]); // 정비 지시만 대화 id(정비 탭 링크용)
});

test("overview 응답에 active 가 실리고 관리자 전용·no-store 는 그대로", () => {
  const route = fs.readFileSync(path.join(repo, "app/api/admin/factory/overview/route.ts"), "utf8");
  assert.match(route, /activeNow\(\)/);
  assert.match(route, /return \{ supervisor, inbox, updates, deploys, threads, totals, active \}/);
  assert.match(route, /requireAdmin/);
  assert.match(route, /dynamic = "force-dynamic"/);
});
