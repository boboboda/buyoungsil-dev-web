// 홈 히어로 통계 카드 시험: 가입자 수 카드(components/home/hero.tsx + app/(main)/page.tsx)
//   (a) 가입자 값이 있으면 '가입자 N명' 카드가 다른 카드와 같은 모양으로 6칸 중 하나로 나온다
//   (b) 가입자 조회가 실패하면(null) 그 카드만 숨기고 홈은 그대로 그린다(page.tsx 의 safeCount 경로까지)
//   (c) 가입자 수는 회원(User) 행 수 count() 하나로만 읽는다(개인정보 필드는 읽지 않음)
//   (d) 실제 Tailwind CSS 로 헤드리스 Chrome 에 1440·360px 로 그려서 6칸이 빈칸 없이 꽉 차고 가로 넘침이 없는지
//       (스크린샷: tests/.out/home-stats-1440.png, home-stats-360.png)
// 실행: npm run test:home-stats   (브라우저 부분은 Chrome/Edge 필요, CHROME_PATH 로 지정 가능. 없으면 그 부분만 건너뜀)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

if (typeof WebSocket === "undefined") {
  // Node 20: 기본 WebSocket 이 플래그 뒤에 있다
  const r = spawnSync(process.execPath, ["--experimental-websocket", ...process.argv.slice(1)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

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

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures++;
    console.log(`not ok - ${name}\n  ${String(e.message).replaceAll("\n", "\n  ")}`);
  }
}

// ── 화면 부품 ──
const Link = ({ href, children, ...rest }) => h("a", { href, ...rest }, children);
// 캐릭터 애니메이션(lottie)은 브라우저에서만 돌므로 같은 크기의 자리 상자로 바꾼다
const Animation = () => h("div", { className: "aspect-square w-full rounded-lg bg-gray-200", "data-animation": "" });
const { default: Hero } = loadTs("components/home/hero.tsx", {
  "next/link": { __esModule: true, default: Link },
  "./animation": { __esModule: true, default: Animation },
});

const FULL = { totalProjects: 12, totalUsers: 1234, totalNotes: 87, daysRunning: 652, todayVisitors: 31, totalVisitors: 45678 };
const cards = (html) => [...html.matchAll(/<div class="text-xs text-gray-600[^"]*">([^<]+)<\/div>/g)].map((m) => m[1]);

await check("가입자 값이 있으면 '가입자 1,234명' 카드가 6칸 중 두 번째로 나온다", () => {
  const html = renderToStaticMarkup(h(Hero, FULL));
  assert.deepEqual(cards(html), ["만든 앱·프로젝트", "가입자", "공개 개발노트", "홈페이지 운영", "오늘 방문자", "총 방문자"]);
  assert.match(html, /👥/);
  assert.match(html, /1,234<span class="text-sm ml-1">명<\/span>/);
  assert.doesNotMatch(html, /출시한 앱/, "임시로 넣었던 '출시한 앱' 카드가 남아 있음");
  assert.match(html, /grid grid-cols-2 sm:grid-cols-3 /, "6칸은 모바일 2열·PC 3열이어야 함");
});

await check("가입자 조회 실패(null)·0 이면 그 카드만 숨기고 나머지는 그대로", () => {
  for (const totalUsers of [null, 0]) {
    const html = renderToStaticMarkup(h(Hero, { ...FULL, totalUsers }));
    assert.deepEqual(cards(html), ["만든 앱·프로젝트", "공개 개발노트", "홈페이지 운영", "오늘 방문자", "총 방문자"], `totalUsers=${totalUsers}`);
    assert.doesNotMatch(html, /가입자|👥/);
    assert.match(html, /코딩천재 부영실/);
  }
});

// ── page.tsx: 실제 홈 서버 컴포넌트를 가짜 DB 로 ──
function loadHome(userCount) {
  const calls = [];
  const prisma = {
    user: new Proxy({}, {
      get: (_, op) => async (args) => {
        calls.push({ op, args });
        if (op !== "count") throw new Error(`user.${String(op)} 를 부르면 안 됨`);
        return userCount();
      },
    }),
    developNote: { findMany: async () => [], count: async () => 87 },
  };
  const Empty = () => null;
  const page = loadTs("app/(main)/page.tsx", {
    "@/components/home/hero": { __esModule: true, default: Hero },
    "@/components/home/FeaturedProjects": { __esModule: true, default: Empty },
    "@/components/home/RecentNotes": { __esModule: true, default: Empty },
    "@/components/home/CTASection": { __esModule: true, default: Empty },
    "@/serverActions/projects": { fetchAllProjects: async () => [] },
    "@/serverActions/visitor": { getTodayVisitorCount: async () => 31, getTotalVisitorCount: async () => 45678 },
    "@/config/site": loadTs("config/site.ts"),
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/types": {},
  });
  return { Home: page.default, calls };
}

await check("홈: 가입자 수는 User.count() 하나로 읽어 카드에 넣는다(개인정보 조회 없음)", async () => {
  const { Home, calls } = loadHome(async () => 57);
  const html = renderToStaticMarkup(await Home());
  assert.deepEqual(calls, [{ op: "count", args: undefined }], "회원 테이블은 조건 없는 count() 만 불러야 함");
  assert.match(html, /57<span class="text-sm ml-1">명<\/span>/);
  assert.ok(cards(html).includes("가입자"));
});

await check("홈: 가입자 조회가 실패해도 홈은 그리고 가입자 카드만 빠진다", async () => {
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(" "));
  try {
    const { Home } = loadHome(async () => {
      throw new Error("DB 연결 끊김");
    });
    const html = renderToStaticMarkup(await Home());
    assert.ok(!cards(html).includes("가입자"));
    assert.ok(cards(html).includes("총 방문자"));
    assert.ok(errors.some((e) => e.includes("홈 가입자 조회 실패")), "실패 로그가 남아야 함");
  } finally {
    console.error = orig;
  }
});

// ── 브라우저: 1440·360px 레이아웃 ──
fs.mkdirSync(out, { recursive: true });
// app/layout.tsx 의 body 안쪽 구조 + 홈 래퍼(page.tsx)
const body = renderToStaticMarkup(
  h("div", { className: "flex flex-col flex-grow min-h-0" }, h("main", { className: "flex-grow w-full min-h-screen" }, h("div", { className: "flex flex-col w-full overflow-x-hidden" }, h(Hero, FULL)))),
);
const scan = path.join(out, "home-stats-scan.html");
fs.writeFileSync(scan, body + '<html class="light"><body class="flex flex-col min-h-screen">');
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const globals = read("styles/globals.css")
  .replace('@import "tailwindcss";', `@import "tailwindcss" source(none);\n@source "${scan.replaceAll("\\", "/")}";`)
  .replace('@config "../tailwind.config.js";', `@config "${path.join(repo, "tailwind.config.js").replaceAll("\\", "/")}";`);
assert.match(globals, /source\(none\)/, "globals.css 의 tailwindcss import 를 찾지 못함");
const { css } = await postcss([tailwind()]).process(globals, { from: path.join(repo, "styles", "globals.css") });
fs.rmSync(scan, { force: true });
const file = path.join(out, "home-stats.html");
fs.writeFileSync(
  file,
  `<!doctype html><html lang="ko" class="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style></head><body class="flex flex-col min-h-screen">${body}</body></html>`,
);

const browserPath = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean).find((p) => fs.existsSync(p));

if (!browserPath) {
  console.log("Chrome/Edge 를 찾지 못해 브라우저 시험은 건너뜀 (CHROME_PATH 로 지정 가능)");
} else {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "home-stats-"));
  const chrome = spawn(browserPath, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let ws;
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  const send = (method, params = {}) => {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`CDP 시간 초과: ${method}`)), 30_000);
      pending.set(id, (msg) => {
        clearTimeout(t);
        msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result);
      });
    });
  };
  const waitEvent = (method) => new Promise((resolve) => listeners.push({ method, resolve }));
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`페이지 스크립트 오류: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };

  // 통계 격자: 칸 수·열 수·줄마다 칸 수·넘침
  const PROBE = `(() => {
    const grid = [...document.querySelectorAll("div.grid")].find((g) => g.className.startsWith("grid grid-cols-2 "));
    const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    const items = [...grid.children].map((c) => c.getBoundingClientRect());
    const rows = {};
    for (const r of items) rows[Math.round(r.top)] = (rows[Math.round(r.top)] ?? 0) + 1;
    const g = grid.getBoundingClientRect();
    return {
      cols, count: items.length, perRow: Object.values(rows),
      labels: [...grid.querySelectorAll(".text-xs")].map((e) => e.textContent.trim()),
      gridRight: g.right, gridLeft: g.left,
      maxRight: Math.max(...items.map((r) => r.right)), minLeft: Math.min(...items.map((r) => r.left)),
      sameWidth: new Set(items.map((r) => Math.round(r.width))).size === 1,
      sameHeightPerRow: Object.keys(rows).every((top) => new Set(items.filter((r) => Math.round(r.top) == top).map((r) => Math.round(r.height))).size === 1),
      vw: innerWidth, docW: document.scrollingElement.scrollWidth,
      overflowText: [...grid.querySelectorAll("div")].some((e) => e.scrollWidth > e.clientWidth + 1),
    };
  })()`;

  try {
    const port = await new Promise((resolve, reject) => {
      let buf = "";
      const t = setTimeout(() => reject(new Error("Chrome 원격 디버깅 주소를 받지 못함")), 20_000);
      chrome.stderr.on("data", (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
        if (m) {
          clearTimeout(t);
          resolve(Number(m[1]));
        }
      });
    });
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("CDP 연결 실패"));
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else if (msg.method) {
        for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].method === msg.method) listeners.splice(i, 1)[0].resolve(msg.params);
      }
    };
    await send("Page.enable");
    await send("Runtime.enable");

    for (const [width, cols] of [[1440, 3], [360, 2]]) {
      await check(`${width}px: 6칸이 ${cols}열로 빈칸 없이 꽉 차고 가로 넘침 없음 (스크린샷 home-stats-${width}.png)`, async () => {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
        const loaded = waitEvent("Page.loadEventFired");
        await send("Page.navigate", { url: pathToFileURL(file).href });
        await loaded;
        // 등장 애니메이션(fade-in-up)이 끝난 뒤 찍는다
        await evaluate("document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1800)))");
        const p = await evaluate(PROBE);
        const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: await evaluate("document.scrollingElement.scrollHeight"), scale: 1 } });
        fs.writeFileSync(path.join(out, `home-stats-${width}.png`), Buffer.from(shot.data, "base64"));
        assert.equal(p.count, 6, JSON.stringify(p));
        assert.equal(p.cols, cols, JSON.stringify(p));
        assert.deepEqual(p.perRow, Array(6 / cols).fill(cols), `줄마다 칸이 꽉 차야 함: ${JSON.stringify(p.perRow)}`);
        assert.ok(p.labels.includes("가입자"), JSON.stringify(p.labels));
        assert.ok(p.sameWidth && p.sameHeightPerRow, "칸 크기가 서로 달라짐");
        assert.ok(p.docW <= p.vw, `가로 넘침: 문서 ${p.docW}px > 화면 ${p.vw}px`);
        assert.ok(p.minLeft >= 0 && p.maxRight <= p.vw, `칸이 화면 밖으로 나감: ${p.minLeft}~${p.maxRight}`);
        assert.ok(!p.overflowText, "칸 안 글자가 넘침");
      });
    }
  } finally {
    try {
      ws?.close();
    } catch {}
    try {
      chrome.kill();
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
}

if (failures) {
  console.log(`\n실패 ${failures}개`);
  process.exit(1);
}
console.log("\n모두 통과");
