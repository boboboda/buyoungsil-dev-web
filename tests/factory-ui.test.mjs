// 통제실(7단계) 화면 시험: 탭 주소 해석, 탭 전환 표시, 상태 색, 단계 표시, 프로젝트 연결 공용 칸, 빈 상태, 다크 범위.
// 실행: npm run test:factory-ui
// TSX 를 typescript 로 저장소 안 임시 폴더에 변환해서 react-dom/server 로 그린다(관리자 로그인 없이 가짜 데이터로).
// next/link·@heroui/react 는 단순한 대역으로 바꾼다. API·DB 는 부르지 않는다.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = new URL("..", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");
// node_modules 의 react 를 찾을 수 있게 저장소 안에 만든다(끝나면 지움)
const dir = mkdtempSync(join(fileURLToPath(new URL("tests/", root)), ".tmp-factory-ui-"));

const STUBS = {
  "next/link": "./link-stub.mjs",
  "@heroui/react": "./heroui-stub.mjs",
  "./consoleTabs": "./consoleTabs.mjs",
  "./fx": "./fx.mjs",
};

function transpile(rel, out) {
  let js = ts.transpileModule(read(rel), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  for (const [from, to] of Object.entries(STUBS)) js = js.replaceAll(`"${from}"`, `"${to}"`);
  writeFileSync(join(dir, out), js);
}

const load = (file) => import(pathToFileURL(join(dir, file)).href);
const html = (el) => renderToStaticMarkup(el);
const count = (s, re) => (s.match(re) ?? []).length;

try {
  writeFileSync(
    join(dir, "link-stub.mjs"),
    `import { createElement } from "react";
export default function Link({ href, children, ...rest }) { return createElement("a", { href, ...rest }, children); }`,
  );
  writeFileSync(
    join(dir, "heroui-stub.mjs"),
    `import { createElement } from "react";
export function Button({ children, isDisabled, onPress, color, size, variant, ...rest }) {
  return createElement("button", { type: "button", disabled: !!isDisabled, "data-color": color, ...rest }, children);
}`,
  );
  transpile("components/admin/factory/consoleTabs.ts", "consoleTabs.mjs");
  transpile("components/admin/factory/FactoryTabs.tsx", "FactoryTabs.mjs");
  transpile("components/admin/factory/fx.tsx", "fx.mjs");
  transpile("components/admin/factory/ProjectLinkSelect.tsx", "ProjectLinkSelect.mjs");

  const { FACTORY_TABS, parseFactoryTab, factoryTabHref } = await load("consoleTabs.mjs");
  const { default: FactoryTabs } = await load("FactoryTabs.mjs");
  const fx = await load("fx.mjs");
  const { default: ProjectLinkSelect } = await load("ProjectLinkSelect.mjs");

  // (1) 탭 주소: 5개, 모르는 값·빈 값은 [현황], 배열이면 첫 값
  assert.deepEqual(
    FACTORY_TABS.map((t) => `${t.key}:${t.label}`),
    ["status:현황", "jobs:일감", "release:출시", "settings:설정", "usage:사용량"],
  );
  assert.equal(parseFactoryTab(undefined), "status");
  assert.equal(parseFactoryTab(""), "status");
  assert.equal(parseFactoryTab("nope"), "status");
  assert.equal(parseFactoryTab("usage"), "usage");
  assert.equal(parseFactoryTab(["release", "jobs"]), "release");
  assert.equal(factoryTabHref("settings"), "/admin/factory?tab=settings");

  // (2) 탭 전환: 지금 탭만 aria-current="page", 링크는 ?tab= 주소
  for (const t of FACTORY_TABS) {
    const out = html(h(FactoryTabs, { active: t.key }));
    assert.equal(count(out, /aria-current="page"/g), 1, `${t.key}: 현재 탭 표시는 1개`);
    assert.match(out, new RegExp(`aria-current="page"[^>]*href="/admin/factory\\?tab=${t.key}"|href="/admin/factory\\?tab=${t.key}"[^>]*aria-current="page"`));
    for (const o of FACTORY_TABS) assert.ok(out.includes(`href="/admin/factory?tab=${o.key}"`), `${o.key} 링크 없음`);
    assert.match(out, /aria-label="통제실 메뉴"/);
  }

  // (3) 상태 색: 진행=청록(run)·완료=초록(ok)·대기/승인 필요=노랑(warn)·실패/중단=빨강(bad)
  const tone = { pending: "warn", approved: "warn", running: "run", review: "warn", linkwait: "warn", done: "ok", failed: "bad", cancelled: "bad" };
  for (const [status, expected] of Object.entries(tone)) assert.equal(fx.jobTone(status), expected, status);
  assert.equal(fx.jobTone("모르는값"), "idle");
  assert.match(html(h(fx.StatusDot, { tone: "run" })), /class="fx-dot fx-run"/);
  assert.match(html(h(fx.StatusDot, { tone: "idle", hollow: true })), /fx-dot fx-idle fx-hollow/);
  assert.match(html(h(fx.StatusDot, { tone: "ok" })), /aria-hidden="true"/);

  // (4) 진행 막대: 값이 없으면 오가는 막대, 있으면 % 와 aria-valuenow
  const ind = html(h(fx.ProgressBar, { label: "제작 중" }));
  assert.match(ind, /role="progressbar"/);
  assert.match(ind, /fx-indeterminate/);
  assert.doesNotMatch(ind, /aria-valuenow/);
  const half = html(h(fx.ProgressBar, { label: "반", value: 0.5, tone: "ok" }));
  assert.match(half, /aria-valuenow="50"/);
  assert.match(half, /width:50%/);
  assert.doesNotMatch(half, /fx-indeterminate/);
  assert.match(html(h(fx.ProgressBar, { label: "넘침", value: 3 })), /aria-valuenow="100"/);

  // (5) 단계 표시 ●──●──○: 상태별 끝난 단계·지금 단계·색
  const st = (status, extra = {}) => fx.jobStepState({ status, ...extra });
  assert.deepEqual(st("pending"), { reached: 0, current: 1, tone: "warn" });
  assert.deepEqual(st("approved"), { reached: 1, current: 2, tone: "warn" });
  assert.deepEqual(st("running"), { reached: 1, current: 2, tone: "run" });
  assert.deepEqual(st("review"), { reached: 2, current: 3, tone: "warn" });
  assert.deepEqual(st("done"), { reached: 3, current: null, tone: "ok" });
  assert.deepEqual(st("failed", { startedAt: "2026-10-13T00:00:00Z" }), { reached: 1, current: 2, tone: "bad" });
  assert.deepEqual(st("cancelled"), { reached: 0, current: 1, tone: "bad" });

  const done = html(h(fx.JobSteps, { status: "done" }));
  assert.equal(count(done, /fx-dot fx-ok/g), 4, "완료: 점 4개 모두 초록");
  assert.equal(count(done, /fx-step-line fx-ok fx-done/g), 3);
  assert.match(done, /단계: 등록 끝, 승인 끝, 제작 끝, 완료 끝/);
  const running = html(h(fx.JobSteps, { status: "running" }));
  assert.equal(count(running, /fx-dot fx-run/g), 3, "제작 중: 끝난 2개 + 지금 1개가 청록");
  assert.equal(count(running, /fx-hollow/g), 1, "제작 중: 남은 1개는 빈 점");
  assert.match(running, /제작 중/);
  const failed = html(h(fx.JobSteps, { status: "failed", approvedAt: "x" }));
  assert.equal(count(failed, /fx-dot fx-bad/g), 1);
  assert.match(failed, /제작 멈춤/);
  const compact = html(h(fx.JobSteps, { status: "pending", labels: false }));
  assert.doesNotMatch(compact, /justify-between/, "labels=false 면 글자 줄 없음");

  // (6) 프로젝트 연결 공용 칸: 다른 앱에 연결된 프로젝트는 고를 수 없음, 지금 연결 표시, 연결 풀기는 연결돼 있고 onUnlink 가 있을 때만
  const projects = [
    { id: "p1", title: "카운터", platform: "mobile", status: "released", linkedApp: null },
    { id: "p2", title: "메모", platform: "mobile", status: "in-progress", linkedApp: "memo-app" },
    { id: "p3", title: "타이머", platform: "mobile", status: "in-progress", linkedApp: "timer-app" },
  ];
  const noop = () => {};
  const linked = html(h(ProjectLinkSelect, { appSlug: "timer-app", appName: "타이머", projects, currentId: "p3", busy: false, onLink: noop, onUnlink: noop }));
  assert.match(linked, /<option disabled="" value="p2">메모 \(mobile, in-progress\) — memo-app 에 연결됨<\/option>/);
  assert.match(linked, /<option value="p3"[^>]*>타이머 \(mobile, in-progress\) — 지금 연결됨<\/option>/);
  assert.doesNotMatch(linked, /<option disabled="" value="p3"/);
  assert.match(linked, /연결 풀기/);
  assert.match(linked, /aria-label="타이머 에 연결할 홈페이지 프로젝트"/);
  const fresh = html(h(ProjectLinkSelect, { appSlug: "new-app", appName: "새 앱", projects, currentId: null, busy: false, saving: true, onLink: noop }));
  assert.doesNotMatch(fresh, /연결 풀기/);
  assert.match(fresh, /저장 중…/);
  assert.match(fresh, /<button type="button" disabled=""[^>]*>저장 중…/, "고른 게 없으면 [연결] 비활성");
  // 빈 상태: 프로젝트가 없으면 안내 한 줄만
  const empty = html(h(ProjectLinkSelect, { appSlug: "a", appName: "A", projects: [], currentId: null, busy: false, onLink: noop }));
  assert.equal(count(empty, /<option/g), 1);
  assert.match(empty, /프로젝트 고르기…/);

  // (7) 탭 구성: 기존 화면이 각 탭에 들어가 있는지(기능 컴포넌트를 그대로 씀)
  const consoleSrc = read("components/admin/factory/FactoryConsole.tsx");
  const tabBlock = (key) => {
    const m = consoleSrc.match(new RegExp(`\\{tab === "${key}" && ([\\s\\S]*?)\\n\\s*\\)\\}|\\{tab === "${key}" && (<[^\\n]*)`));
    assert.ok(m, `${key} 탭 블록이 없음`);
    return m[1] ?? m[2];
  };
  const expectIn = {
    status: ["FactoryOverview", "SupervisorControl"],
    jobs: ["FactoryControl", "RevisionSender", "MaintenancePanel"],
    release: ["ReleasePanel"],
    settings: ["DefaultAiSettings", "ToolBrokerSettings", "TelegramSetup", "WorkerTokens", "SecretEntries", "SecretNames", "ReleaseAccounts", "AppProjectLinks", "WorkRules"],
    usage: ["UsageTab"],
  };
  for (const [key, names] of Object.entries(expectIn)) {
    const block = tabBlock(key);
    for (const n of names) assert.ok(block.includes(`<${n}`), `${key} 탭에 ${n} 없음`);
  }
  assert.match(consoleSrc, /<ClaudeStatusView initial=\{initial\} \/>/);
  // 설정은 한 곳: 감독 카드 안에서 기본 AI·도구 중계·정비를 다시 그리지 않음
  const supSrc = read("components/admin/factory/SupervisorControl.tsx");
  for (const n of ["DefaultAiSettings", "ToolBrokerSettings", "MaintenancePanel"]) assert.ok(!supSrc.includes(`<${n}`), `감독 카드에 ${n} 가 남아 있음`);
  // 프로젝트 연결 고르기는 공용 칸 하나
  for (const f of ["AppProjectLinks.tsx", "ReleasePanel.tsx"]) {
    assert.match(read(`components/admin/factory/${f}`), /<ProjectLinkSelect/, `${f} 가 공용 칸을 안 씀`);
  }
  // 정비 대기열 줄에는 승인 버튼 대신 [현황] 안내
  const mp = read("components/admin/factory/MaintenancePanel.tsx");
  assert.ok(!mp.includes('post({ action: "approve", turnId: i.turnId })'), "정비 대기열 줄에 승인 버튼이 남아 있음");
  assert.ok(mp.includes('post({ action: "approve", turnId: m.id })'), "정비 대화 안 승인은 남아야 함");

  // (8) 주소: 옛 통제실 주소는 페이지가 남아 해당 탭을 그림, /admin/claude 페이지는 없음(301)
  assert.match(read("app/admin/factory/release/page.tsx"), /<FactoryConsole tab="release" \/>/);
  assert.match(read("app/admin/factory/settings/page.tsx"), /<FactoryConsole tab="settings" \/>/);
  assert.match(read("app/admin/factory/page.tsx"), /parseFactoryTab\(tab\)/);
  assert.ok(!existsSync(new URL("app/admin/claude/page.tsx", root)));
  assert.ok(!read("app/admin/page.tsx").includes('href="/admin/claude"'), "대시보드에 클로드 항목이 남아 있음");

  // (9) 다크 범위: 관리자 공통 레이아웃(/admin/*)만 .factory-ui dark, CSS 규칙은 모두 .factory-ui 아래(또는 keyframes·media)
  assert.match(read("app/admin/layout.tsx"), /className=\{`factory-ui dark \$\{fontMono\.variable\}/);
  assert.ok(!existsSync(new URL("app/admin/factory/layout.tsx", root)), "통제실 이중 래퍼가 남아 있음");
  const css = read("app/admin/admin-ui.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [...css.matchAll(/(^|})\s*([^{}@]+)\{/g)].map((m) => m[2].trim()).filter((s) => !/^((\d+%|from|to)\s*,?\s*)+$/.test(s));
  assert.ok(selectors.length > 10);
  for (const sel of selectors) {
    for (const part of sel.split(",")) assert.match(part.trim(), /^\.factory-ui\b/, `범위 밖 선택자: ${part.trim()}`);
  }
  assert.match(css, /prefers-reduced-motion: reduce/);
  for (const v of ["#0a0c10", "#0e1116", "#5f6b7a", "#e8edf3", "#aab5c1", "#22d3ee", "#4ade80", "#fbbf24", "#f87171"]) {
    assert.ok(css.toLowerCase().includes(v), `색 토큰 ${v} 없음`);
  }
  assert.ok(!read("styles/globals.css").includes("factory-ui"), "전역 CSS 는 건드리지 않음");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("factory-ui: 탭 5개·탭 전환·상태 색·진행 막대·단계 표시·프로젝트 연결 칸·빈 상태·탭 구성·옛 주소·다크 범위 시험 통과");
