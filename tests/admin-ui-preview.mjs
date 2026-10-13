// 관리자 계기판 디자인 미리보기(로그인 없이 보는 하니스).
// 실제 관리자 레이아웃(app/admin/layout.tsx)·통제실 탭·AI 사용량 패널을 가짜 데이터로 그려 HTML 한 장으로 만들고,
// Tailwind(저장소 설정 그대로) + app/admin/admin-ui.css 를 붙인다. --shot 이면 헤드리스 Chrome/Edge 로 스크린샷도 찍는다.
// 실행: npm run preview:admin-ui            → tests/.out/admin-ui-preview.html
//       npm run preview:admin-ui -- --shot  → + admin-ui-desktop.png(1440px), admin-ui-mobile.png(360px)
// API·DB·키는 쓰지 않는다. 결과 폴더(tests/.out)는 커밋하지 않는다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(repo, "tests", ".out");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const Link = ({ href, children, ...rest }) => h("a", { href, ...rest }, children);
const link = { __esModule: true, default: Link };
const meters = loadTs("components/admin/ui/meters.tsx");
const fx = loadTs("components/admin/factory/fx.tsx");
const tabs = loadTs("components/admin/factory/consoleTabs.ts");
const { default: FactoryTabs } = loadTs("components/admin/factory/FactoryTabs.tsx", { "next/link": link, "./consoleTabs": tabs });
const { UsageDashView } = loadTs("components/admin/factory/UsageDash.tsx", { "@/components/admin/ui/meters": meters });
const { default: AdminLayout } = loadTs("app/admin/layout.tsx", {
  "./admin-ui.css": {},
  "next/link": link,
  "@/config/fonts": { fontMono: { variable: "" } },
});

// ── 가짜 데이터 ──
const now = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const win = (usedPct, resetIn) => ({ usedPct, resetsAt: now + resetIn, reset: false });
const day = (offset, tokens) => ({ date: `d-${offset}`, input: tokens * 0.7, output: tokens * 0.2, cacheCreate: tokens * 0.1, cacheRead: 0 });
const daily = Array.from({ length: 14 }, (_, i) => day(i, [0.8, 1.1, 0.4, 2.3, 1.9, 0, 0.6, 1.4, 2.8, 1.2, 0.9, 1.7, 1.05, 1.42][i] * 1e6));
const base = { asOf: now - 4_000, sessions: [], windowHours: 5, windowTokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, daily, recent: [] };
const live = {
  ...base,
  limits: { fiveHour: win(23.4, 2 * HOUR + 14 * MIN), sevenDay: win(78, 3 * 24 * HOUR + 4 * HOUR), asOf: now - 3 * MIN, stale: false, failedAt: null, device: "work-pc" },
  codexLimits: { fiveHour: win(41, 3 * HOUR), sevenDay: win(94, 5 * 24 * HOUR), asOf: now - 12 * MIN, stale: false, failedAt: now - 2 * MIN, device: "work-pc" },
};
const stale = {
  ...base,
  limits: { fiveHour: { usedPct: 60, resetsAt: now - 5 * MIN, reset: true }, sevenDay: win(52, 4 * 24 * HOUR), asOf: now - 22 * MIN, stale: false, failedAt: null, device: "work-pc" },
  codexLimits: null,
};

// ── 화면 ──
const panel = (title, el) =>
  h("div", { className: "flex flex-col gap-2" }, h("p", { className: "text-xs fx-muted font-mono" }, title), el);

const leftWork = h(
  "div",
  { className: "fx-split-main" },
  h(
    "header",
    { className: "mb-4" },
    h("h1", { className: "flex items-center gap-2 text-2xl font-bold sm:text-3xl" }, h("span", { "aria-hidden": true, className: "fx-dot fx-run" }), "앱 공장 통제실"),
    h("p", { className: "mt-2 text-sm fx-muted" }, "기획서를 승인하면 내 PC의 감독 프로그램이 가져가서 앱을 만들어요"),
  ),
  h(FactoryTabs, { active: "status" }),
  h(
    "div",
    { className: "mt-4 grid gap-4" },
    ...[
      ["timer-app", "running", "제작 중 · 화면 3/5"],
      ["memo-app", "review", "검토 대기"],
      ["counter", "done", "완료 · 2시간 전"],
      ["weather", "failed", "빌드 실패"],
    ].map(([name, status, note]) =>
      h(
        "div",
        { key: name, className: "fx-panel flex flex-col gap-3 p-4" },
        h("div", { className: "flex items-center justify-between gap-2" }, h("span", { className: "font-semibold" }, name), h(meters.Led, { tone: fx.jobTone(status) }, note)),
        h(fx.JobSteps, { status, startedAt: status === "failed" ? "x" : null }),
        status === "running" ? h(fx.ProgressBar, { label: "제작 진행", value: 0.6 }) : null,
      ),
    ),
    // 옛 화면(회색 유틸리티)이 토큰으로 바뀌는지 견본
    h(
      "div",
      { className: "bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl p-5" },
      h("p", { className: "text-sm text-gray-600 dark:text-gray-400" }, "옛 관리자 화면 카드(bg-white·border-gray-200·text-gray-600) → 계기판 토큰"),
      h("p", { className: "text-gray-900 font-bold" }, "글/노트 관리 · 문의함 · 일감 화면 공통"),
      h("input", { className: "mt-2 w-full px-3 py-2 border rounded-lg", placeholder: "기본 입력칸" }),
    ),
    h(
      "div",
      { className: "grid grid-cols-2 gap-4 lg:grid-cols-4" },
      ...[
        ["📥 초안함 대기", 3],
        ["💬 문의 답변 대기", 0],
        ["💻 외주 신청 대기", null],
        ["💼 프로젝트", 27],
      ].map(([label, v], i) =>
        h(
          "div",
          { key: label, className: `fx-panel fx-tile p-5 ${i === 0 ? "fx-tile-alert" : ""}` },
          h("p", { className: "text-sm fx-muted mb-2" }, label),
          v === null
            ? h(meters.Led, { tone: "idle" }, "읽기 실패 -")
            : i === 3
              ? h("span", { className: "fx-run" }, h(meters.Digits, { value: String(v) }))
              : v > 0
                ? h("div", { className: "flex items-end justify-between gap-2 fx-warn" }, h(meters.Digits, { value: String(v), unit: "건" }), h(meters.Led, { tone: "warn" }, "대기"))
                : h(meters.Led, { tone: "ok" }, "없음"),
        ),
      ),
    ),
    h("div", { className: "grid grid-cols-2 gap-4 md:grid-cols-3" }, ...["+ 새 프로젝트", "+ 새 개발노트", "🏭 앱 공장 통제실"].map((t) => h("button", { key: t, className: "fx-key w-full p-4", type: "button" }, t))),
  ),
);

const page = h(
  AdminLayout,
  null,
  h(
    "div",
    { className: "fx-wide mx-auto w-full px-4 py-4 sm:py-8" },
    h("div", { className: "fx-split" }, leftWork, h("aside", { "aria-label": "AI 사용량 계기판", className: "fx-split-side" }, h(UsageDashView, { stats: live, now }))),
    h("h2", { className: "mt-10 mb-3 text-sm font-mono fx-muted" }, "── 상태 견본 (패널 펼침) ──"),
    h(
      "div",
      { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-3" },
      panel("값 없음(수신 대기)", h(UsageDashView, { stats: null, now, open: true })),
      panel("오래된 값(22분)·초기화된 창·Codex 없음", h(UsageDashView, { stats: stale, now, open: true })),
      panel("서버 갱신 실패", h(UsageDashView, { stats: live, now, open: true, error: "갱신 실패, 다시 시도 중" })),
    ),
  ),
);
const body = renderToStaticMarkup(page);

// ── CSS: 저장소 Tailwind 설정 + 관리자 CSS ──
fs.mkdirSync(out, { recursive: true });
const htmlFile = path.join(out, "admin-ui-preview.html");
fs.writeFileSync(htmlFile, body); // Tailwind 가 쓰인 클래스를 찾을 수 있게 먼저 쓴다
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const entry = [
  '@import "tailwindcss" source(none);',
  `@config "${path.join(repo, "tailwind.config.js").replaceAll("\\", "/")}";`,
  `@source "${htmlFile.replaceAll("\\", "/")}";`,
].join("\n");
const { css } = await postcss([tailwind()]).process(entry, { from: path.join(repo, "styles", "admin-ui-preview.css") });
const doc = `<!doctype html><html lang="ko" class="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>관리자 계기판 미리보기</title><style>${css}</style><style>${read("app/admin/admin-ui.css")}</style>
<style>body{margin:0;background:#fff;font-family:system-ui,"Malgun Gothic",sans-serif}</style></head>
<body>${body}</body></html>`;
fs.writeFileSync(htmlFile, doc);
console.log(`미리보기: ${htmlFile}`);

// ── 스크린샷(선택) ──
if (process.argv.includes("--shot")) {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const browser = candidates.find((p) => fs.existsSync(p));
  if (!browser) {
    console.log("Chrome/Edge 를 찾지 못해 스크린샷은 건너뜀 (CHROME_PATH 로 지정 가능)");
  } else {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "admin-ui-shot-"));
    try {
      // 헤드리스 창은 최소 폭이 있어(약 500px) 모바일은 360px iframe 에 넣어 찍는다
      const mobileFile = path.join(out, "admin-ui-mobile.html");
      fs.writeFileSync(mobileFile, `<!doctype html><body style="margin:0;background:#333"><iframe src="admin-ui-preview.html" width="360" height="2400" style="border:0;display:block"></iframe></body>`);
      for (const [name, size, file] of [["desktop", "1440,1500", htmlFile], ["mobile", "600,2400", mobileFile]]) {
        const png = path.join(out, `admin-ui-${name}.png`);
        const r = spawnSync(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--user-data-dir=${profile}`, `--window-size=${size}`, `--screenshot=${png}`, pathToFileURL(file).href], { timeout: 60_000 });
        console.log(r.status === 0 && fs.existsSync(png) ? `스크린샷: ${png}` : `스크린샷 실패(${name})`);
      }
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
}
