// 관리자 HUD 시험: 세그먼트·스파크라인 계산, 상태 색·기호, 갱신 시각 문구, LED·막대 렌더, 상단바·하단 상태줄, 공개 크롬 숨김,
// 통제실 오른쪽 'AI USAGE' 패널(수신 대기·오래된 값·수집 실패·오늘/어제·접이식), 관리자 공통 레이아웃 범위.
// 실행: npm run test:admin-meters
// TSX 를 typescript 로 변환해 react-dom/server 로 그린다(로그인·API·DB 없이 가짜 데이터).
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
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const m = loadTs("components/admin/ui/meters.tsx");
const dash = loadTs("components/admin/factory/UsageDash.tsx", { "@/components/admin/ui/meters": m });
const html = (el) => renderToStaticMarkup(el);
const count = (s, re) => (s.match(re) ?? []).length;

const MIN = 60_000;
const HOUR = 60 * MIN;
// 2026-10-13 12:05 KST
const AS_OF = Date.UTC(2026, 9, 13, 3, 5, 0);

test("스파크라인 막대 높이: 가장 큰 날이 꼭대기, 조금이라도 쓰면 1, 0·NaN 은 0", () => {
  assert.deepEqual(m.sparkHeights([0, 50, 100, 25], 28), [0, 14, 28, 7]);
  assert.deepEqual(m.sparkHeights([0.001, 1000], 28), [1, 28]);
  assert.deepEqual(m.sparkHeights([0, 0], 28), [0, 0]);
  assert.deepEqual(m.sparkHeights([Number.NaN, 4], 10), [0, 10]);
  assert.deepEqual(m.sparkHeights([], 10), []);
  const svg = html(h(m.Sparkline, { values: [1, 2, 3], label: "최근 3일" }));
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="최근 3일"/);
  assert.equal(count(svg, /class="fx-spark-bar"/g), 2);
  assert.equal(count(svg, /class="fx-spark-now"/g), 1, "마지막(오늘) 막대만 강조");
});

test("퍼센트 → 켜진 세그먼트 수: 0 이면 0, 조금이라도 쓰면 1칸, 넘치면 전부", () => {
  assert.equal(m.litSegments(0, 20), 0);
  assert.equal(m.litSegments(0.1, 20), 1);
  assert.equal(m.litSegments(2.4, 20), 1);
  assert.equal(m.litSegments(50, 20), 10);
  assert.equal(m.litSegments(97, 20), 19);
  assert.equal(m.litSegments(100, 20), 20);
  assert.equal(m.litSegments(130, 20), 20);
  assert.equal(m.litSegments(50, 0), 0);
});

test("사용률 → 색과 글자(색만으로 구분하지 않음): 70 미만 정상, 90 미만 주의, 이상 위험", () => {
  assert.deepEqual(m.meterTone(0), { tone: "ok", text: "정상" });
  assert.deepEqual(m.meterTone(69.9), { tone: "ok", text: "정상" });
  assert.deepEqual(m.meterTone(70), { tone: "warn", text: "주의" });
  assert.deepEqual(m.meterTone(89.9), { tone: "warn", text: "주의" });
  assert.deepEqual(m.meterTone(90), { tone: "bad", text: "위험" });
  assert.deepEqual(m.meterTone(400), { tone: "bad", text: "위험" });
});

test("갱신 시각 문구: '12:05 갱신 · 3분 전', 오래됨(15분) 판정, 남은 시간", () => {
  assert.equal(m.updatedText(AS_OF, AS_OF + 3 * MIN + 10_000), "12:05 갱신 · 3분 전");
  assert.equal(m.updatedText(AS_OF, AS_OF + 2_000), "12:05 갱신 · 방금");
  assert.equal(m.updatedText(AS_OF, AS_OF + 42_000), "12:05 갱신 · 42초 전");
  assert.equal(m.updatedText(AS_OF, AS_OF + 2 * HOUR), "12:05 갱신 · 2시간 전");
  assert.equal(m.updatedText(AS_OF, AS_OF + 26 * HOUR), "12:05 갱신 · 1일 전");
  assert.equal(m.updatedText(null, AS_OF), "갱신 기록 없음");
  assert.equal(m.updatedText(undefined, AS_OF), "갱신 기록 없음");
  assert.equal(m.agoText(AS_OF + 5_000, AS_OF), "방금", "시계가 조금 어긋나도 음수로 안 나옴");

  assert.equal(m.STALE_MS, 15 * MIN);
  assert.equal(m.isStale(AS_OF, AS_OF + 15 * MIN), false);
  assert.equal(m.isStale(AS_OF, AS_OF + 15 * MIN + 1), true);
  assert.equal(m.isStale(null, AS_OF), false);

  assert.equal(m.untilText(AS_OF + 12 * MIN, AS_OF), "12분");
  assert.equal(m.untilText(AS_OF + 2 * HOUR + 13 * MIN + 30_000, AS_OF), "2시간 14분");
  assert.equal(m.untilText(AS_OF + 76 * HOUR + 30_000, AS_OF), "3일 4시간");
  assert.equal(m.untilText(AS_OF - HOUR, AS_OF), "0분");
});

test("세그먼트 막대·LED(기호+글자)·숫자 렌더", () => {
  const seg = html(h(m.SegmentBar, { label: "오늘", pct: 50, segments: 10 }));
  assert.equal(count(seg, /<span aria-hidden="true"/g), 10);
  assert.equal(count(seg, /class="fx-on"/g), 5);
  assert.match(seg, /role="meter"/);
  assert.match(seg, /aria-valuenow="50"/);
  assert.match(html(h(m.SegmentBar, { label: "x", pct: 95 })), /fx-seg fx-bad/);
  assert.match(html(h(m.SegmentBar, { label: "x", pct: 95, tone: "idle" })), /fx-seg fx-idle/);

  const led = html(h(m.Led, { tone: "warn", children: "수집 실패" }));
  assert.match(led, /class="fx-led fx-warn"/);
  assert.match(led, /<span aria-hidden="true" class="fx-led-sym">▲<\/span><span>수집 실패<\/span>/);
  assert.match(html(h(m.Led, { tone: "run", blink: true, children: "x" })), /fx-led-sym fx-blink">●</);
  // 색을 못 봐도 구분되는 기호
  assert.deepEqual(m.TONE_SYMBOL, { run: "●", ok: "●", warn: "▲", bad: "✕", idle: "○" });
  assert.match(html(h(m.SegmentBar, { label: "x", pct: 10 })), /(<span aria-hidden="true"[^>]*><\/span>){24}/, "기본 24칸");

  const d = html(h(m.Digits, { value: "12" }));
  assert.match(d, /<span class="fx-digits fx-digits-md"><span class="fx-digits-value">12<\/span><\/span>/);
  assert.doesNotMatch(d, /fx-digits-unit/);
});

const limits = (over = {}) => ({
  fiveHour: { usedPct: 23.4, resetsAt: AS_OF + 2 * HOUR + 13 * MIN + 30_000, reset: false },
  sevenDay: { usedPct: 92, resetsAt: AS_OF + 76 * HOUR + 30_000, reset: false },
  asOf: AS_OF,
  stale: false,
  failedAt: null,
  device: "work-pc",
  ...over,
});
const day = (date, input, output = 0, cacheCreate = 0) => ({ date, input, output, cacheCreate, cacheRead: 999_999 });
const stats = (over = {}) => ({
  asOf: AS_OF + 3 * MIN,
  sessions: [],
  windowHours: 5,
  windowTokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  daily: [day("2026-10-12", 1_000_000), day("2026-10-13", 1_000_000, 200_000, 50_000)],
  recent: [],
  limits: limits(),
  codexLimits: null,
  ...over,
});

test("오늘/어제 비교: 입력+출력+캐시 생성, 큰 쪽이 100%", () => {
  const c = dash.dailyCompare(stats().daily);
  assert.equal(c.today, 1_250_000);
  assert.equal(c.yesterday, 1_000_000);
  assert.equal(c.todayPct, 100);
  assert.equal(c.yesterdayPct, 80);
  assert.equal(c.diff, "어제보다 +25%");
  assert.equal(dash.dailyCompare([day("a", 50), day("b", 100)].reverse()).diff, "어제보다 −50%");
  assert.equal(dash.dailyCompare([day("a", 10)]).diff, "어제 기록 없음");
  assert.deepEqual(dash.dailyCompare([]), { today: 0, yesterday: 0, todayPct: 0, yesterdayPct: 0, diff: "오늘·어제 기록 없음" });
});

test("AI USAGE 패널: 한도마다 한 행(사용 %·막대·남은 %·초기화까지·갱신 시각), 오늘 사용량, Codex 수집 실패", () => {
  const now = AS_OF + 3 * MIN + 10_000;
  const codex = limits({ fiveHour: { usedPct: 40, resetsAt: AS_OF + HOUR, reset: false }, sevenDay: null, failedAt: AS_OF + 2 * MIN });
  const out = html(h(dash.UsageDashView, { stats: stats({ codexLimits: codex }), now }));

  // 제목은 테두리에 걸린 'AI USAGE'
  assert.match(out, /class="fx-hud fx-dash"/);
  assert.match(out, /<h2 class="fx-hud-title" id="usage-dash-title">AI USAGE/);
  assert.doesNotMatch(out, /fx-gauge/, "반원 게이지는 행 형태로 바뀜");
  // 한도 4행 = 막대 4개 + 오늘/어제 막대 2개
  assert.equal(count(out, /class="fx-limit"/g), 4);
  assert.equal(count(out, /role="meter"/g), 6);
  assert.match(out, /aria-label="Claude 5시간 사용률"[^>]*aria-valuenow="23"[^>]*aria-valuetext="23% 사용 \(정상\)"/);
  assert.match(out, /<span class="fx-limit-pct fx-ok">23<span class="fx-limit-unit">%<\/span>/, "굵고 큰 사용 %");
  assert.match(out, /<span class="fx-limit-pct fx-bad">92/);
  assert.match(out, /aria-label="Claude 7일 사용률"[^>]*class="fx-seg fx-bad"/, "92% 막대는 위험 색");
  assert.match(out, /✕<\/span><span>위험<\/span>/, "92% 는 ✕ 위험 글자");
  assert.match(out, /남은 77% · 초기화까지 2시간 11분/);
  assert.match(out, /남은 8% · 초기화까지 3일 3시간/);
  assert.ok(count(out, /12:05 갱신 · 3분 전/g) >= 4, "행마다 갱신 시각");
  assert.match(out, /<span>수신 중<\/span>/, "Claude LED");
  // 오늘 사용량 1.3M(=1,250,000), 어제 대비 + 스파크라인
  assert.match(out, /fx-digits-value">1\.3M</);
  assert.match(out, /어제보다 \+25%/);
  assert.match(out, /aria-label="오늘 사용량 \(어제와 비교\)"/);
  assert.match(out, /aria-label="최근 2일 사용량: 가장 많은 날 1\.3M, 오늘 1\.3M"/);
  // Codex: 수집 실패 LED + 지난 값 표시 중, 주간 창 값 없음
  assert.match(out, /aria-label="Codex 5시간 사용률"/);
  assert.match(out, /<span class="fx-led fx-warn"><span aria-hidden="true" class="fx-led-sym">▲<\/span><span>수집 실패<\/span>/);
  assert.match(out, /▲ 마지막 수집 실패 1분 전 · 지난 값 표시 중/);
  assert.match(out, /aria-label="Codex 주간 사용률"[^>]*aria-valuetext="값 없음"/);
  // 패널 아래 마지막 갱신
  assert.match(out, /패널 갱신 12:08:00 · 10초 전/);
  // 좁은 화면 요약 줄 + 접힘
  assert.match(out, /Claude 5h 23% · 7d 92%/);
  assert.match(out, /aria-expanded="false"/);
  assert.match(out, /class="hidden fx-dash-body lg:flex"/);
  assert.match(html(h(dash.UsageDashView, { stats: stats(), now, open: true })), /aria-expanded="true"[\s\S]*class="flex fx-dash-body lg:flex"/);
});

test("AI USAGE 패널: 값이 없으면 '수신 대기'는 한 번만(오른쪽 LED), 15분 넘으면 오래된 값, 초기화된 창", () => {
  const none = html(h(dash.UsageDashView, { stats: null, now: AS_OF }));
  assert.equal(count(none, /수신 대기/g), 1, "수신 대기는 패널당 한 번");
  assert.match(none, /<span class="fx-led fx-idle"><span aria-hidden="true" class="fx-led-sym">○<\/span><span>수신 대기<\/span>/);
  assert.match(none, /<p class="fx-dash-wait">— 작업 PC 에서 Claude Code 를 한 번 쓰면 나타나요<\/p>/);
  assert.match(none, /<p class="fx-dash-wait">— 작업 PC 에서 Codex 수집 스크립트를 켜면 나타나요<\/p>/);
  assert.doesNotMatch(none, /Claude[^<]*수신 대기/, "제목에 상태를 붙이지 않음");
  assert.equal(count(none, /class="fx-limit"/g), 0);
  assert.match(none, /아직 받은 값이 없어요/);
  assert.match(none, /Claude 5h -- · 7d --/);
  assert.match(none, /오늘·어제 기록 없음/);
  assert.doesNotMatch(none, /fx-spark/, "기록이 없으면 스파크라인 없음");

  const later = AS_OF + 20 * MIN;
  const old = html(h(dash.UsageDashView, { stats: stats({ limits: limits({ fiveHour: { usedPct: 50, resetsAt: AS_OF - MIN, reset: true } }) }), now: later }));
  assert.match(old, /<span>오래된 값<\/span>/);
  assert.match(old, /class="fx-warn"[^>]*>▲ 12:05 갱신 · 20분 전/);
  assert.match(old, /초기화됨 · 새 값 대기/);
  assert.match(old, /<span class="fx-limit-pct fx-idle">--/);
  assert.match(old, /Claude 5h -- · 7d 92%/);

  const failed = html(h(dash.UsageDashView, { stats: stats(), now: AS_OF, error: "갱신 실패, 다시 시도 중" }));
  assert.match(failed, /fx-led fx-bad[\s\S]*갱신 실패/);
  assert.match(failed, /✕ 갱신 실패, 다시 시도 중/);
});

const stub = { useIdleLogout: () => ({ remainingSeconds: null }) };
const site = loadTs("config/site.ts");
const top = loadTs("components/admin/ui/AdminTopBar.tsx", {
  "next/link": { __esModule: true, default: ({ href, children, ...rest }) => h("a", { href, ...rest }, children) },
  "next/navigation": { usePathname: () => "/admin", useRouter: () => ({}) },
  "next-auth/react": { signOut: () => {}, useSession: () => ({ data: null }) },
  "@/app/hooks/auth/useIdleLogout": stub,
  "@/components/admin/ui/meters": m,
  "@/config/site": site,
});
const bar = loadTs("components/admin/ui/AdminStatusBar.tsx", { "@/components/admin/ui/meters": m });

test("관리자 상단바: 메뉴 순서·지금 위치 강조·사이트로·시각·로그아웃", () => {
  assert.deepEqual(
    top.adminNavList().map((i) => i.short),
    ["대시보드", "통제실", "글/노트", "프로젝트", "이야기", "초안함", "문의함", "외주", "분석", "카테고리"],
  );
  assert.equal(top.isAdminNavActive("/admin", "/admin"), true);
  assert.equal(top.isAdminNavActive("/admin/factory", "/admin"), false, "대시보드는 정확히 /admin 일 때만");
  assert.equal(top.isAdminNavActive("/admin/factory/jobs", "/admin/factory"), true);
  assert.equal(top.isAdminNavActive("/admin/factoryx", "/admin/factory"), false);
  assert.equal(top.isAdminNavActive(null, "/admin"), false);

  const out = html(h(top.AdminTopBarView, { pathname: "/admin/factory", clock: "12:42", account: "부영실" }));
  assert.match(out, /<header class="fx-topbar">/);
  assert.match(out, /<nav aria-label="관리자 메뉴"/);
  assert.equal(count(out, /aria-current="page"/g), 1);
  assert.match(out, /href="\/admin\/factory" aria-current="page" class="fx-topbar-link">통제실</);
  assert.match(out, /href="\/" class="fx-topbar-link">↗ 사이트로</);
  assert.match(out, />12:42</);
  assert.match(out, />부영실</);
  assert.match(out, />로그아웃</);
  assert.match(html(h(top.AdminTopBarView, { pathname: "/admin", clock: "--:--", account: null, idleText: "04:59 후 로그아웃" })), /▲ 04:59 후 로그아웃/);
  // 공개 네비바가 하던 비활동 자동 로그아웃 훅을 상단바가 이어서 건다
  assert.match(read("components/admin/ui/AdminTopBar.tsx"), /useIdleLogout\(\)/);
});

test("관리자 하단 상태줄: 연결·일감·응답·빌드·AI 요약, 값 없으면 '-'", () => {
  const now = AS_OF + 3 * MIN;
  const data = {
    asOf: now,
    supervisor: { online: true, lastSeenAt: AS_OF, running: 1, waiting: 2, commit: "abc" },
    build: { commit: "83793a957b06", at: AS_OF },
    claude: limits({ sevenDay: { usedPct: 41.2, resetsAt: AS_OF + HOUR, reset: false } }),
    codex: limits({ fiveHour: { usedPct: 0, resetsAt: AS_OF + HOUR, reset: false }, sevenDay: { usedPct: 17, resetsAt: AS_OF + HOUR, reset: false } }),
  };
  const texts = bar.statusBarParts(data, now).map((p) => p.text);
  assert.deepEqual(texts, ["감독 연결됨", "진행 1 · 대기 2", "응답 12:05 (3분 전)", "빌드 83793a9", "Claude 5h 23% · 7d 41% | Codex 5h 0% · 주 17%"]);
  assert.equal(bar.statusBarParts(data, now)[0].tone, "ok");

  const off = bar.statusBarParts({ ...data, supervisor: { ...data.supervisor, online: false } }, now);
  assert.equal(off[0].text, "감독 끊김");
  assert.equal(off[0].tone, "bad");

  assert.deepEqual(bar.statusBarParts(null, now).map((p) => p.text), ["감독 -", "진행 - · 대기 -", "응답 -", "빌드 -", "Claude 5h - · 7d - | Codex 5h - · 주 -"]);
  assert.equal(bar.aiSummary(limits({ fiveHour: { usedPct: 9, resetsAt: 0, reset: true } }), null), "Claude 5h - · 7d 92% | Codex 5h - · 주 -", "초기화된 창은 -");
  assert.equal(bar.statusBarParts(null, now, "상태 갱신 실패").at(-1).text, "상태 갱신 실패");

  const out = html(h(bar.AdminStatusBarView, { data, now }));
  assert.match(out, /<footer aria-label="관리자 상태줄" class="fx-statusbar">/);
  assert.match(out, /class="fx-statusbar-item fx-ok"[^>]*><span aria-hidden="true">● <\/span>감독 연결됨/, "색 + 기호 + 글자");
  assert.match(read("app/api/admin/status-bar/route.ts"), /requireAdmin\(\)/, "상태줄 API 는 관리자만");
});

test("공개 사이트 크롬: /admin·/app 에서만 숨기고 공개 화면은 그대로", () => {
  const appPath = loadTs("lib/utils/appPath.ts");
  for (const p of ["/admin", "/admin/factory", "/admin/notes/1"]) assert.equal(appPath.isAdminPath(p), true, p);
  for (const p of ["/", "/note", "/administrator", "/project/admin", null]) assert.equal(appPath.isAdminPath(p), false, String(p));

  let current = "/";
  const Only = loadTs("components/main/PublicChromeOnly.tsx", {
    "next/navigation": { usePathname: () => current },
    "@/lib/utils/appPath": appPath,
  }).default;
  const render = (p) => {
    current = p;
    return html(h(Only, null, h("nav", null, "공개 네비바")));
  };
  for (const p of ["/", "/note", "/project", "/contact", "/stories/x", "/administrator"]) assert.equal(render(p), "<nav>공개 네비바</nav>", `공개 화면 ${p}`);
  for (const p of ["/admin", "/admin/factory", "/app", "/app/x"]) assert.equal(render(p), "", `숨김 ${p}`);

  const root = read("app/layout.tsx");
  assert.match(root, /<PublicChromeOnly>\s*<div className="flex flex-col w-full justify-center items-center">\s*<NavbarVisibilityWrapper>/);
  assert.match(root, /<PublicChromeOnly>\s*<div className="mt-auto">\s*<Footer \/>/);
  assert.match(root, /<HideInApp>\s*<VisitorTracker \/>\s*<\/HideInApp>/, "방문 기록은 그대로");
  assert.ok(!root.includes("admin-ui"), "공개 사이트 레이아웃에 관리자 CSS 없음");
  const channel = read("components/channelTalkManager.tsx");
  assert.match(channel, /if \(isAdmin\) \{\s*if \(booted\.current\) ChannelService\.hideChannelButton\(\);/);
  assert.match(channel, /ChannelService\.showChannelButton\(\)/, "공개 화면으로 돌아가면 다시 보임");
});

test("관리자 공통 레이아웃: /admin 전체를 .factory-ui dark + 상단바·상태줄, 통제실은 좌우 분할", () => {
  const layout = read("app/admin/layout.tsx");
  assert.match(layout, /import "\.\/admin-ui\.css"/);
  assert.match(layout, /className=\{`factory-ui dark \$\{fontMono\.variable\}`\}/);
  assert.match(layout, /<AdminTopBar \/>\s*<div className="fx-admin-main">\{children\}<\/div>\s*<AdminStatusBar \/>/);
  assert.ok(!fs.existsSync(path.join(repo, "app/admin/factory/layout.tsx")), "통제실 따로 감싸기는 없어야 함(이중 래퍼)");

  const fc = read("components/admin/factory/FactoryConsole.tsx");
  assert.match(fc, /className="fx-split"/);
  assert.match(fc, /<aside[^>]*className="fx-split-side"/);
  assert.match(fc, /<UsageDash initial=\{stats\} \/>/);

  const css = read("app/admin/admin-ui.css");
  assert.match(css, /grid-template-columns: minmax\(0, 7fr\) minmax\(19rem, 3fr\)/);
  assert.match(css, /\.fx-split-side \{\s*order: -1;/, "좁은 화면: 패널이 작업 영역 위");
  assert.match(css, /\.fx-split-side \{\s*order: 0;\s*position: sticky;\s*top: calc\(var\(--fx-topbar-h\)/, "넓은 화면: 상단바 아래에 붙어 따라옴");
  assert.match(css, /\.fx-topbar \{\s*position: sticky;\s*top: 0;/);
  assert.match(css, /\.fx-statusbar \{\s*position: sticky;\s*bottom: 0;/);
  assert.match(css, /@media \(min-width: 1024px\) \{\s*\.factory-ui \.fx-dash-toggle \{\s*display: none;/, "넓은 화면: 접기 버튼 숨김");
  const reduce = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduce, /animation: none !important/);
  assert.match(reduce, /\.fx-blink/);
  // 패널 제목이 테두리에 걸림: data-title 공통 + 통제실 주요 카드
  assert.match(css, /\[data-title\]::before \{\s*content: attr\(data-title\);/);
  assert.match(read("components/admin/factory/SupervisorControl.tsx"), /data-title="supervisor · 감독 프로그램"/);
  assert.match(read("components/admin/factory/FactoryOverview.tsx"), /data-title="todo · 승인·배포"/);
});
