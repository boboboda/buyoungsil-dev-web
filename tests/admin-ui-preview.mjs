// 관리자 HUD 디자인 미리보기(로그인 없이 보는 하니스).
// 실제 관리자 레이아웃(app/admin/layout.tsx: 상단바·하단 상태줄)·통제실 탭·AI USAGE 패널을 가짜 데이터로 그려 HTML 로 만들고,
// Tailwind(저장소 설정 그대로) + app/admin/admin-ui.css 를 붙인다. --shot 이면 헤드리스 Chrome/Edge 로 스크린샷도 찍는다.
// 상태 3종: live(값 있음) · waiting(수신 대기) · failed(수집 실패 + 오래된 값 + 감독 끊김 + 갱신 실패)
// 실행: npm run preview:admin-ui            → tests/.out/admin-ui-{live,waiting,failed}.html
//       npm run preview:admin-ui -- --shot  → + admin-ui-{상태}-{1440,1024,360}.png
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
const heroui = require("@heroui/react");
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
const site = loadTs("config/site.ts");
const fx = loadTs("components/admin/factory/fx.tsx");
const tabs = loadTs("components/admin/factory/consoleTabs.ts");
const { default: FactoryTabs } = loadTs("components/admin/factory/FactoryTabs.tsx", { "next/link": link, "./consoleTabs": tabs });
const { UsageDashView } = loadTs("components/admin/factory/UsageDash.tsx", { "@/components/admin/ui/meters": meters });
const noop = () => ({});
const topBar = loadTs("components/admin/ui/AdminTopBar.tsx", {
  "next/link": link,
  "next/navigation": { usePathname: () => "/admin/factory", useRouter: noop },
  "next-auth/react": { signOut: noop, useSession: () => ({ data: null }) },
  "@/app/hooks/auth/useIdleLogout": { useIdleLogout: () => ({ remainingSeconds: null }) },
  "@/components/admin/ui/meters": meters,
  "@/config/site": site,
});
const statusBar = loadTs("components/admin/ui/AdminStatusBar.tsx", { "@/components/admin/ui/meters": meters });

// ── 가짜 데이터 ──
const now = Date.UTC(2026, 9, 13, 3, 42, 0); // 12:42 KST
const MIN = 60_000;
const HOUR = 60 * MIN;
const win = (usedPct, resetIn) => ({ usedPct, resetsAt: now + resetIn, reset: false });
const day = (offset, tokens) => ({ date: `d-${offset}`, input: tokens * 0.7, output: tokens * 0.2, cacheCreate: tokens * 0.1, cacheRead: 0 });
const daily = Array.from({ length: 14 }, (_, i) => day(i, [0.8, 1.1, 0.4, 2.3, 1.9, 0, 0.6, 1.4, 2.8, 1.2, 0.9, 1.7, 1.05, 1.42][i] * 1e6));
const base = { asOf: now - 4_000, sessions: [], windowHours: 5, windowTokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, daily, recent: [] };
const claudeLive = { fiveHour: win(23.4, 2 * HOUR + 14 * MIN), sevenDay: win(41, 3 * 24 * HOUR + 4 * HOUR), asOf: now - MIN, stale: false, failedAt: null, failReason: null, source: "auto", extra: [{ key: "weekly_scoped · Fable", usedPct: 12, resetsAt: now + 30 * HOUR, reset: false }], extraAsOf: now - MIN, device: "work-pc" };
const codexLive = { fiveHour: win(0, 5 * HOUR), sevenDay: win(17, 5 * 24 * HOUR), asOf: now - 2 * MIN, stale: false, failedAt: null, failReason: null, source: "auto", extra: [], extraAsOf: null, device: "work-pc" };

const STATES = {
  live: {
    title: "값 있음",
    stats: { ...base, limits: claudeLive, codexLimits: codexLive },
    bar: { asOf: now, supervisor: { online: true, lastSeenAt: now - 20_000, running: 1, waiting: 2, commit: "a1b2c3d" }, build: { commit: "83793a957b06", at: now - 3 * HOUR }, claude: claudeLive, codex: codexLive },
  },
  waiting: {
    title: "수신 대기",
    stats: { ...base, daily: [], limits: null, codexLimits: null },
    bar: null,
  },
  failed: {
    title: "수집 실패 + 오래된 값",
    stats: {
      ...base,
      limits: { fiveHour: { usedPct: 60, resetsAt: now - 5 * MIN, reset: true }, sevenDay: win(78, 4 * 24 * HOUR), asOf: now - 22 * MIN, stale: false, failedAt: now - 3 * MIN, failReason: "HTTP 429 요청 제한 · 15분 뒤 다시", source: "statusline", extra: [], extraAsOf: null, device: "work-pc" },
      codexLimits: { fiveHour: win(41, 3 * HOUR), sevenDay: win(94, 5 * 24 * HOUR), asOf: now - 40 * MIN, stale: true, failedAt: now - 2 * MIN, failReason: "HTTP 401", source: "auto", extra: [], extraAsOf: null, device: "work-pc" },
    },
    error: "갱신 실패, 다시 시도 중",
    bar: { asOf: now, supervisor: { online: false, lastSeenAt: now - 47 * MIN, running: 0, waiting: 3, commit: null }, build: null, claude: null, codex: null },
    barError: "상태 갱신 실패",
  },
};

// ── 화면 ──
const { Card, CardBody, Button, Input } = heroui;
const Item = (label, value, mono = false) =>
  h("div", { key: label, className: "min-w-0" }, h("dt", { className: "text-default-500" }, label), h("dd", { className: `${mono ? "font-mono " : ""}font-medium break-words` }, value));

function leftWork(state) {
  const online = state !== "failed";

  return h(
    "div",
    { className: "fx-split-main" },
    h(
      "header",
      { className: "mb-4" },
      h("h1", { className: "flex items-center gap-2 text-2xl font-bold sm:text-3xl" }, h("span", { "aria-hidden": true, className: "fx-dot fx-run" }), "앱 공장 통제실"),
      h("p", { className: "mt-2 text-sm fx-muted" }, "기획서를 승인하면 내 PC의 감독 프로그램이 가져가서 앱을 만들어요"),
    ),
    h(FactoryTabs, { active: "status" }),
    // 승인·배포 할 일 (FactoryOverview 모양)
    h(
      Card,
      { className: "mb-6", "data-title": "todo · 승인·배포" },
      h(
        CardBody,
        { className: "space-y-3" },
        h(
          "div",
          { className: "flex flex-wrap items-center justify-between gap-2" },
          h("div", { className: "flex items-center gap-2 font-semibold" }, h(fx.StatusDot, { tone: "warn" }), "승인·배포 할 일", h("span", { className: "font-mono" }, "(2)")),
          h("span", { className: "text-xs text-default-500" }, "텔레그램 버튼과 같은 동작이에요. 어느 쪽에서 먼저 눌러도 한 번만 처리돼요."),
        ),
        ...[
          ["관리자 UI 2차: 가독성 + 네비바·푸터", "배포 대기 · 83793a9"],
          ["timer-app 기획서", "승인 기다림 · 3분 전"],
        ].map(([t, sub], i) =>
          h(
            "div",
            { key: t, className: "flex flex-col gap-2 rounded-lg border border-default-200 p-2 sm:flex-row sm:items-center sm:justify-between" },
            h("div", { className: "min-w-0 text-sm" }, h("div", { className: "font-medium" }, t), h("div", { className: "mt-1 font-mono text-xs text-default-500" }, sub)),
            h("div", { className: "flex gap-2" }, i === 0 ? h(Button, { color: "primary", size: "sm" }, "배포") : h(Button, { color: "success", size: "sm" }, "승인"), h(Button, { size: "sm", variant: "flat" }, "자세히")),
          ),
        ),
      ),
    ),
    // 감독 프로그램 (SupervisorControl 모양)
    h(
      Card,
      { className: "mb-6", "data-title": "supervisor · 감독 프로그램" },
      h(
        CardBody,
        { className: "space-y-2" },
        h(
          "div",
          { className: "flex flex-wrap items-center justify-between gap-3" },
          h("div", { className: "flex items-center gap-2 font-semibold" }, h(fx.StatusDot, { tone: online ? "ok" : "bad" }), "감독 프로그램: ", h("span", { className: online ? "fx-ok" : "fx-bad" }, online ? "작동 중" : "응답 없음")),
          h(Button, { color: "warning", size: "sm" }, "일시 정지"),
        ),
        h("p", { className: "text-sm text-default-600" }, online ? "승인된 일감을 가져가서 만들어요." : "PC 가 47분째 응답하지 않아요. 작업 PC 가 켜져 있는지 확인하세요."),
        h(
          "dl",
          { className: "grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-default-200 bg-background p-2 text-xs sm:grid-cols-4" },
          Item("연결", online ? "연결됨" : "응답 없음"),
          Item("작업 PC", "work-pc", true),
          Item("마지막 응답", online ? "2026. 10. 13. 오후 12:41:40" : "2026. 10. 13. 오전 11:55:00", true),
          Item("일감 받기", "작동 중"),
          Item("현재 버전", "a1b2c3d", true),
          Item("자동 업데이트", "켜짐"),
          Item("진행 중 / 승인된 대기", online ? "1 / 2" : "0 / 3", true),
          Item("승인 기다림", "1", true),
        ),
      ),
    ),
    // 일감 카드
    h(
      "div",
      { className: "grid gap-4" },
      ...[
        ["timer-app", "running", "제작 중 · 화면 3/5"],
        ["memo-app", "review", "검토 대기"],
        ["weather", "failed", "빌드 실패"],
      ].map(([name, status, note]) =>
        h(
          "div",
          { key: name, className: "fx-panel flex flex-col gap-3 p-4" },
          h("div", { className: "flex items-center justify-between gap-2" }, h("span", { className: "font-semibold font-mono" }, name), h(meters.Led, { tone: fx.jobTone(status) }, note)),
          h(fx.JobSteps, { status, startedAt: status === "failed" ? "x" : null }),
          status === "running" ? h(fx.ProgressBar, { label: "제작 진행", value: 0.6 }) : null,
        ),
      ),
      // 옛 화면(회색 유틸리티)이 토큰으로 바뀌는지 견본
      h(
        "div",
        { className: "bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl p-5" },
        h("p", { className: "text-sm text-gray-600 dark:text-gray-400" }, "옛 관리자 화면 카드(bg-white·border-gray-200·text-gray-600) → HUD 토큰"),
        h("p", { className: "text-gray-900 font-bold" }, "글/노트 관리 · 문의함 · 일감 화면 공통"),
        h("input", { className: "mt-2 w-full px-3 py-2 border rounded-lg", placeholder: "기본 입력칸 (placeholder)" }),
        h("div", { className: "mt-3" }, h(Input, { label: "HeroUI 입력칸", placeholder: "앱 이름", size: "sm" })),
      ),
    ),
  );
}

function page(state) {
  const st = STATES[state];
  // 실제 레이아웃에 실제 상단바·상태줄 '보기' 부품을 가짜 값으로 끼운다(훅 없이)
  const { default: AdminLayout } = loadTs("app/admin/layout.tsx", {
    "./admin-ui.css": {},
    "@/config/fonts": { fontMono: { variable: "" } },
    "@/components/admin/ui/AdminDocumentTheme": { __esModule: true, default: () => null },
    "@/components/admin/ui/AdminTopBar": { __esModule: true, default: () => h(topBar.AdminTopBarView, { pathname: "/admin/factory", clock: "12:42", account: "부영실" }) },
    "@/components/admin/ui/AdminStatusBar": { __esModule: true, default: () => h(statusBar.AdminStatusBarView, { data: st.bar, now, error: st.barError ?? null }) },
  });

  return h(
    AdminLayout,
    null,
    h(
      "div",
      { className: "fx-wide mx-auto w-full px-4 py-4 sm:py-8" },
      h("div", { className: "fx-split" }, leftWork(state), h("aside", { "aria-label": "AI 사용량 계기판", className: "fx-split-side" }, h(UsageDashView, { stats: st.stats, now, error: st.error ?? null }))),
      h("h2", { className: "fx-label mt-10 mb-3" }, `── 상태 견본: ${st.title} (패널 펼침) ──`),
      h("div", { className: "max-w-md" }, h(UsageDashView, { stats: st.stats, now, error: st.error ?? null, open: true })),
    ),
  );
}

// ── CSS: 저장소 Tailwind 설정 + 관리자 CSS ──
fs.mkdirSync(out, { recursive: true });
const bodies = Object.fromEntries(Object.keys(STATES).map((k) => [k, renderToStaticMarkup(page(k))]));
const scan = path.join(out, "admin-ui-scan.html");
fs.writeFileSync(scan, Object.values(bodies).join("\n")); // Tailwind 가 쓰인 클래스를 찾을 수 있게 먼저 쓴다
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const entry = [
  '@import "tailwindcss" source(none);',
  `@config "${path.join(repo, "tailwind.config.js").replaceAll("\\", "/")}";`,
  `@source "${scan.replaceAll("\\", "/")}";`,
].join("\n");
const { css } = await postcss([tailwind()]).process(entry, { from: path.join(repo, "styles", "admin-ui-preview.css") });
const files = {};
for (const [k, body] of Object.entries(bodies)) {
  files[k] = path.join(out, `admin-ui-${k}.html`);
  fs.writeFileSync(
    files[k],
    `<!doctype html><html lang="ko" class="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>관리자 HUD 미리보기 · ${STATES[k].title}</title><style>${css}</style><style>${read("app/admin/admin-ui.css")}</style>
<style>body{margin:0;background:#fff;font-family:Inter,system-ui,"Malgun Gothic",sans-serif}</style></head>
<body><main>${body}</main></body></html>`,
  );
  console.log(`미리보기: ${files[k]}`);
}
fs.rmSync(scan, { force: true });

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
    const only = process.argv.find((a) => a.startsWith("--state="))?.slice(8);
    try {
      for (const [k, file] of Object.entries(files)) {
        if (only && only !== k) continue;
        // 헤드리스 창은 최소 폭이 있어(약 500px) 360px 은 iframe 에 넣어 찍는다
        const mobile = path.join(out, `admin-ui-${k}-360.html`);
        fs.writeFileSync(mobile, `<!doctype html><body style="margin:0;background:#333"><iframe src="${path.basename(file)}" width="360" height="2600" style="border:0;display:block"></iframe></body>`);
        for (const [w, size, target] of [["1440", "1440,1500", file], ["1024", "1024,1500", file], ["360", "600,2600", mobile]]) {
          const png = path.join(out, `admin-ui-${k}-${w}.png`);
          const r = spawnSync(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--user-data-dir=${profile}`, `--window-size=${size}`, `--screenshot=${png}`, pathToFileURL(target).href], { timeout: 60_000 });
          console.log(r.status === 0 && fs.existsSync(png) ? `스크린샷: ${png}` : `스크린샷 실패(${k} ${w})`);
        }
      }
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
}
