// 관리자 계기판 시험: 게이지 계산(퍼센트→각도·세그먼트·색), 갱신 시각 문구, 게이지·LED 막대 렌더,
// 통제실 오른쪽 'AI 사용량' 패널(수신 대기·오래된 값·수집 실패·오늘/어제·접이식), 관리자 공통 레이아웃 범위.
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

test("퍼센트 → 바늘 각도: 0%=-90°, 50%=0°, 100%=90°, 범위 밖·NaN 은 자름", () => {
  assert.equal(m.gaugeAngle(0), -90);
  assert.equal(m.gaugeAngle(25), -45);
  assert.equal(m.gaugeAngle(50), 0);
  assert.equal(m.gaugeAngle(100), 90);
  assert.equal(m.gaugeAngle(150), 90);
  assert.equal(m.gaugeAngle(-5), -90);
  assert.equal(m.gaugeAngle(Number.NaN), -90);
  assert.equal(m.gaugeAngle(50, 240), 0);
  assert.equal(m.gaugeAngle(0, 240), -120);
  // 원 위의 점: 0°=위, 90°=오른쪽, -90°=왼쪽
  assert.deepEqual(m.polar(60, 58, 46, 0), { x: 60, y: 12 });
  assert.deepEqual(m.polar(60, 58, 46, 90), { x: 106, y: 58 });
  assert.deepEqual(m.polar(60, 58, 46, -90), { x: 14, y: 58 });
  assert.equal(m.arcPath(60, 58, 46, -90, 90), "M 14 58 A 46 46 0 0 1 106 58");
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

test("반원 게이지 렌더: role=meter·값·글자, 빈 게이지는 '--'·바늘 없음", () => {
  const g = html(h(m.ArcGauge, { label: "Claude 5시간", pct: 23.4 }));
  assert.match(g, /role="meter"/);
  assert.match(g, /aria-valuenow="23"/);
  assert.match(g, /aria-valuetext="23% 사용 \(정상\)"/);
  assert.match(g, /class="fx-gauge fx-ok"/);
  assert.match(g, /fx-gauge-needle/);
  assert.match(g, /fx-gauge-fill/);
  assert.equal(count(g, /fx-gauge-tick/g), 11, "10% 마다 눈금 11개");
  assert.equal(count(g, /fx-gauge-tick fx-major/g), 3, "0·50·100 큰 눈금");
  assert.match(g, /<span class="fx-digits-value">23<\/span><span class="fx-digits-unit">%<\/span>/);
  assert.match(g, />정상</);

  const hi = html(h(m.ArcGauge, { label: "x", pct: 95 }));
  assert.match(hi, /fx-gauge fx-bad/);
  assert.match(hi, />위험</);

  const empty = html(h(m.ArcGauge, { label: "Codex 5시간", pct: null, status: "수신 대기" }));
  assert.match(empty, /class="fx-gauge fx-idle"/);
  assert.doesNotMatch(empty, /fx-gauge-needle/);
  assert.doesNotMatch(empty, /fx-gauge-fill/);
  assert.doesNotMatch(empty, /aria-valuenow/);
  assert.match(empty, /aria-valuetext="수신 대기"/);
  assert.match(empty, /fx-digits-value">--</);
  assert.match(empty, />수신 대기</);
});

test("LED 막대·LED·숫자 렌더", () => {
  const seg = html(h(m.SegmentBar, { label: "오늘", pct: 50, segments: 10 }));
  assert.equal(count(seg, /<span aria-hidden="true"/g), 10);
  assert.equal(count(seg, /class="fx-on"/g), 5);
  assert.match(seg, /role="meter"/);
  assert.match(seg, /aria-valuenow="50"/);
  assert.match(html(h(m.SegmentBar, { label: "x", pct: 95 })), /fx-seg fx-bad/);
  assert.match(html(h(m.SegmentBar, { label: "x", pct: 95, tone: "idle" })), /fx-seg fx-idle/);

  const led = html(h(m.Led, { tone: "warn", children: "수집 실패" }));
  assert.match(led, /class="fx-led fx-warn"/);
  assert.match(led, /<span aria-hidden="true" class="fx-led-dot"><\/span><span>수집 실패<\/span>/);
  assert.match(html(h(m.Led, { tone: "run", blink: true, children: "x" })), /fx-led-dot fx-blink/);

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

test("AI 사용량 패널: Claude 게이지 2개·남은 시간·갱신 시각, 오늘 사용량, Codex 수집 실패", () => {
  const now = AS_OF + 3 * MIN + 10_000;
  const codex = limits({ fiveHour: { usedPct: 40, resetsAt: AS_OF + HOUR, reset: false }, sevenDay: null, failedAt: AS_OF + 2 * MIN });
  const out = html(h(dash.UsageDashView, { stats: stats({ codexLimits: codex }), now }));

  assert.match(out, /aria-label="Claude 5시간 사용률"[^>]*aria-valuenow="23"|aria-valuenow="23"[^>]*aria-label="Claude 5시간 사용률"/);
  assert.match(out, /aria-label="Claude 7일 사용률"/);
  assert.match(out, /남은 77% · 초기화까지 2시간 11분/);
  assert.match(out, /남은 8% · 초기화까지 3일 3시간/);
  assert.match(out, />위험</, "92% 는 위험 글자");
  assert.ok(count(out, /12:05 갱신 · 3분 전/g) >= 4, "게이지마다 갱신 시각");
  assert.match(out, /<span>수신 중<\/span>/, "Claude LED");
  // 오늘 사용량 1.3M(=1,250,000), 어제 대비
  assert.match(out, /fx-digits-value">1\.3M</);
  assert.match(out, /어제보다 \+25%/);
  assert.match(out, /aria-label="오늘 사용량 \(어제와 비교\)"/);
  // Codex: 수집 실패 LED + 지난 값 표시 중, 주간 창 값 없음
  assert.match(out, /aria-label="Codex 5시간 사용률"/);
  assert.match(out, /<span class="fx-led fx-warn"><span aria-hidden="true" class="fx-led-dot"><\/span><span>수집 실패<\/span>/);
  assert.match(out, /마지막 수집 실패 1분 전 \(지난 값 표시 중\)/);
  assert.match(out, /Codex 주간 사용률[^>]*aria-valuetext="값 없음"|aria-valuetext="값 없음"[^>]*Codex 주간/);
  // 패널 아래 마지막 갱신
  assert.match(out, /패널 갱신 12:08:00 · 10초 전/);
  // 좁은 화면 요약 줄 + 접힘
  assert.match(out, /Claude 5h 23% · 7d 92%/);
  assert.match(out, /aria-expanded="false"/);
  assert.match(out, /class="hidden fx-dash-body lg:flex"/);
  assert.match(html(h(dash.UsageDashView, { stats: stats(), now, open: true })), /aria-expanded="true"[\s\S]*class="flex fx-dash-body lg:flex"/);
});

test("AI 사용량 패널: 값이 없으면 빈 게이지 + 수신 대기, 15분 넘으면 오래된 값 경고, 초기화된 창", () => {
  const none = html(h(dash.UsageDashView, { stats: null, now: AS_OF }));
  assert.equal(count(none, /role="meter" /g) + count(none, /role="meter">/g), 6, "게이지 4개 + LED 막대 2개");
  assert.equal(count(none, /fx-gauge fx-idle/g), 4);
  assert.match(none, /수신 대기 — 작업 PC 에서 Claude Code 를 한 번 쓰면 나타나요/);
  assert.match(none, /수신 대기 — 작업 PC 에서 Codex 수집 스크립트를 켜면 나타나요/);
  assert.match(none, /아직 받은 값이 없어요/);
  assert.match(none, /Claude 5h -- · 7d --/);
  assert.match(none, /오늘·어제 기록 없음/);

  const later = AS_OF + 20 * MIN;
  const old = html(h(dash.UsageDashView, { stats: stats({ limits: limits({ fiveHour: { usedPct: 50, resetsAt: AS_OF - MIN, reset: true } }) }), now: later }));
  assert.match(old, /<span>오래된 값<\/span>/);
  assert.match(old, /fx-dash-line fx-warn"[^>]*>⚠ 12:05 갱신 · 20분 전/);
  assert.match(old, /초기화됨 · 새 값 대기/);
  assert.match(old, /Claude 5h -- · 7d 92%/);

  const failed = html(h(dash.UsageDashView, { stats: stats(), now: AS_OF, error: "갱신 실패, 다시 시도 중" }));
  assert.match(failed, /fx-led fx-bad[\s\S]*갱신 실패/);
});

test("관리자 공통 레이아웃: /admin 전체를 .factory-ui dark 로, 통제실은 좌우 분할", () => {
  const layout = read("app/admin/layout.tsx");
  assert.match(layout, /import "\.\/admin-ui\.css"/);
  assert.match(layout, /className=\{`factory-ui dark \$\{fontMono\.variable\}/);
  assert.ok(!fs.existsSync(path.join(repo, "app/admin/factory/layout.tsx")), "통제실 따로 감싸기는 없어야 함(이중 래퍼)");
  assert.ok(!read("app/layout.tsx").includes("admin-ui"), "공개 사이트 레이아웃은 그대로");

  const fc = read("components/admin/factory/FactoryConsole.tsx");
  assert.match(fc, /className="fx-split"/);
  assert.match(fc, /<aside[^>]*className="fx-split-side"/);
  assert.match(fc, /<UsageDash initial=\{stats\} \/>/);

  const css = read("app/admin/admin-ui.css");
  assert.match(css, /grid-template-columns: minmax\(0, 7fr\) minmax\(19rem, 3fr\)/);
  assert.match(css, /position: sticky/);
  assert.match(css, /\.fx-split-side \{\s*order: -1;/, "좁은 화면: 계기판이 작업 영역 위");
  assert.match(css, /@media \(min-width: 1024px\) \{\s*\.factory-ui \.fx-dash-toggle \{\s*display: none;/, "넓은 화면: 접기 버튼 숨김");
  const reduce = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduce, /animation: none !important/);
  assert.match(reduce, /\.fx-blink/);
});
