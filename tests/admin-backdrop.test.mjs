// 관리자 화면 뒤 흰색 노출 시험: 실제 루트 레이아웃(app/layout.tsx)의 html·body·래퍼 구조 + styles/globals.css(Tailwind·HeroUI 그대로)
// + 관리자 레이아웃(app/admin/layout.tsx, admin-ui.css)을 헤드리스 Chrome 에 그려서 확인한다.
//   (a) 맨 위 0~30px 줄·맨 아래 줄 픽셀이 전부 어두운 바탕인지(1440·1024·360px)
//   (b) 문서 끝까지 스크롤한 뒤 html·body 의 computed 배경이 어둡고, 당겼을 때(overscroll) 드러나는 캔버스 색도 어두운지
//   (c) 공개 페이지는 기존 배경(흰색·밝은 color-scheme)을 그대로 쓰는지, 관리자에서 나간 뒤(속성 제거) 원래대로 돌아오는지
// 실행: npm run test:admin-backdrop   (Chrome/Edge 필요, CHROME_PATH 로 지정 가능. 없으면 건너뜀)
// 브라우저 조종은 Chrome DevTools Protocol(Node 20 의 --experimental-websocket 또는 Node 22 의 기본 WebSocket)로 한다.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
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
const { createElement: h, Fragment } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(repo, "tests", ".out");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");
const DIAG = process.argv.includes("--diag");

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

// ── 화면: 루트 레이아웃 구조를 그대로 흉내 ──
const Link = ({ href, children, ...rest }) => h("a", { href, ...rest }, children);
const link = { __esModule: true, default: Link };
const meters = loadTs("components/admin/ui/meters.tsx");
const site = loadTs("config/site.ts");
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
const adminLayoutDeps = {
  "./admin-ui.css": {},
  "@/config/fonts": { fontMono: { variable: "" } },
  "@/components/admin/ui/AdminTopBar": { __esModule: true, default: () => h(topBar.AdminTopBarView, { pathname: "/admin/factory", clock: "12:42", account: "부영실" }) },
  "@/components/admin/ui/AdminStatusBar": { __esModule: true, default: () => h(statusBar.AdminStatusBarView, { data: null, now: Date.UTC(2026, 9, 13, 3, 42), error: null }) },
  "@/components/admin/ui/AdminDocumentTheme": { __esModule: true, default: () => null }, // 효과는 브라우저에서 따로 시험
};
const { default: AdminLayout } = loadTs("app/admin/layout.tsx", adminLayoutDeps);

const rows = (n) => Array.from({ length: n }, (_, i) => h("div", { key: i, className: "fx-panel mb-4 p-4" }, `패널 ${i + 1} · 스크롤 시험용 내용`));
// app/layout.tsx 의 <body> 안쪽과 같은 구조(Providers 는 DOM 을 만들지 않음)
const root = (children, publicChrome) =>
  h(
    "div",
    { className: "flex flex-col flex-grow min-h-0" },
    publicChrome ? h("div", { className: "flex flex-col w-full justify-center items-center" }, h("nav", { className: "w-full flex justify-center py-3" }, "공개 네비바"), h("hr", { className: "w-full mt-4" })) : null,
    h("main", { className: "flex-grow w-full min-h-screen" }, children),
  );
const PAGES = {
  admin: root(h(AdminLayout, null, h("div", { className: "mx-auto w-full px-4 py-4 sm:py-8" }, h("h1", { className: "text-2xl font-bold" }, "앱 공장 통제실"), ...rows(40))), false),
  adminShort: root(h(AdminLayout, null, h("div", { className: "mx-auto w-full px-4 py-4" }, h("h1", null, "짧은 화면"))), false),
  public: h(
    Fragment,
    null,
    root(h("div", { className: "p-6" }, h("h1", { className: "text-2xl font-bold" }, "공개 페이지"), ...Array.from({ length: 40 }, (_, i) => h("p", { key: i }, `본문 ${i}`))), true),
    h("div", { className: "mt-auto" }, h("footer", { className: "p-6" }, "푸터")),
  ),
};

// ── CSS: 실제 globals.css(Tailwind + HeroUI 플러그인) + 관리자 CSS ──
fs.mkdirSync(out, { recursive: true });
const bodies = Object.fromEntries(Object.entries(PAGES).map(([k, el]) => [k, renderToStaticMarkup(el)]));
const scan = path.join(out, "admin-backdrop-scan.html");
fs.writeFileSync(scan, Object.values(bodies).join("\n") + '<html class="light"><body class="flex flex-col min-h-screen">');
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const globals = read("styles/globals.css")
  .replace('@import "tailwindcss";', `@import "tailwindcss" source(none);\n@source "${scan.replaceAll("\\", "/")}";`)
  .replace('@config "../tailwind.config.js";', `@config "${path.join(repo, "tailwind.config.js").replaceAll("\\", "/")}";`);
assert.match(globals, /source\(none\)/, "globals.css 의 tailwindcss import 를 찾지 못함");
const { css } = await postcss([tailwind()]).process(globals, { from: path.join(repo, "styles", "globals.css") });
fs.rmSync(scan, { force: true });

const files = {};
for (const [k, body] of Object.entries(bodies)) {
  files[k] = path.join(out, `admin-backdrop-${k}.html`);
  fs.writeFileSync(
    files[k],
    `<!doctype html><html lang="ko" class="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style><style>${read("app/admin/admin-ui.css")}</style></head>
<body class="flex flex-col min-h-screen">${body}</body></html>`,
  );
}

// ── 브라우저 ──
const browserPath = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean).find((p) => fs.existsSync(p));
if (!browserPath) {
  console.log("Chrome/Edge 를 찾지 못해 건너뜀 (CHROME_PATH 로 지정 가능)");
  process.exit(0);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "admin-backdrop-"));
const chrome = spawn(browserPath, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const cleanup = () => {
  try {
    chrome.kill();
  } catch {}
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
};

let ws;
let seq = 0;
const pending = new Map();
const listeners = [];
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`CDP 시간 초과: ${method}`)), 30_000);
    pending.set(id, (msg) => {
      clearTimeout(t);
      msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result);
    });
  });
}
const waitEvent = (method) => new Promise((resolve) => listeners.push({ method, resolve }));
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`페이지 스크립트 오류: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}

// PNG(8비트, 비인터레이스, RGB/RGBA) 해독: 스크린샷 픽셀 확인용
function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "PNG 비트 깊이 8 만 지원");
      assert.equal(data[12], 0, "인터레이스 PNG 는 지원 안 함");
      channels = { 2: 3, 6: 4 }[data[9]];
      assert.ok(channels, `PNG 색 형식 ${data[9]} 지원 안 함`);
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      px[y * stride + x] = (src[x] + [0, a, b, (a + b) >> 1, pr][f]) & 0xff;
    }
  }
  return { width, height, at: (x, y) => [...px.subarray(y * stride + x * channels, y * stride + x * channels + 3)] };
}

// 화면 띠(y0~y1)를 찍어 밝은 픽셀(글자 아닌 바탕이 흰색인 곳)을 센다. 글자·선은 일부 밝을 수 있으므로 '줄 전체가 밝은 행'과 밝은 픽셀 비율을 본다.
async function bandStats(y0, y1, width) {
  const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: y0, width, height: y1 - y0, scale: 1 }, captureBeyondViewport: false });
  const img = decodePng(Buffer.from(shot.data, "base64"));
  let bright = 0;
  let total = 0;
  let brightRows = 0;
  for (let y = 0; y < img.height; y++) {
    let rowBright = 0;
    for (let x = 0; x < img.width; x++) {
      const [r, g, b] = img.at(x, y);
      total++;
      if ((r + g + b) / 3 > 200) {
        bright++;
        rowBright++;
      }
    }
    if (rowBright > img.width * 0.5) brightRows++;
  }
  // 바탕색 = 줄 왼쪽 끝 픽셀(글자 없는 여백)
  return { brightRatio: bright / total, brightRows, edge: img.at(0, 0), edgeRight: img.at(img.width - 1, 0) };
}

const dark = ([r, g, b]) => r < 40 && g < 40 && b < 40;
const rgbOf = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
const isDarkCss = (s) => {
  const [r, g, b, a = 1] = rgbOf(s);
  return a > 0.99 && dark([r, g, b]);
};

const PROBE = `(() => {
  const cs = (el) => getComputedStyle(el);
  const html = document.documentElement, body = document.body;
  const top = [...document.elementsFromPoint(2, 2)].map((e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\\s+/).join(".") : "") + " bg=" + cs(e).backgroundColor + " pt=" + cs(e).paddingTop + " mt=" + cs(e).marginTop);
  const bar = document.querySelector(".fx-topbar"), sb = document.querySelector(".fx-statusbar");
  const main = document.querySelector(".fx-admin-main");
  return {
    htmlBg: cs(html).backgroundColor, bodyBg: cs(body).backgroundColor,
    htmlScheme: cs(html).colorScheme, bodyScheme: cs(body).colorScheme,
    htmlOverscroll: cs(html).overscrollBehaviorY, bodyOverscroll: cs(body).overscrollBehaviorY,
    bodyPadL: cs(body.firstElementChild).paddingLeft,
    scroller: document.scrollingElement === html ? "html" : "other",
    bodyScrolls: body.scrollHeight > body.clientHeight + 1 && cs(body).overflowY !== "visible",
    barTop: bar ? bar.getBoundingClientRect().top : null,
    barLeft: bar ? bar.getBoundingClientRect().left : null,
    barWidth: bar ? bar.getBoundingClientRect().width : null,
    sbBottom: sb ? sb.getBoundingClientRect().bottom : null,
    sbHeight: sb ? sb.getBoundingClientRect().height : null,
    mainPadBottom: main ? cs(main).paddingBottom : null,
    lastBottom: main ? main.lastElementChild?.getBoundingClientRect().bottom ?? null : null,
    vh: innerHeight, vw: innerWidth,
    docH: document.scrollingElement.scrollHeight,
    top,
  };
})()`;

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
  const pageTarget = list.find((t) => t.type === "page");
  ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
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

  async function open(file, width, height = 800) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    const loaded = waitEvent("Page.loadEventFired");
    await send("Page.navigate", { url: pathToFileURL(file).href });
    await loaded;
    await evaluate("document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))");
  }

  for (const width of [1440, 1024, 360]) {
    await check(`관리자 ${width}px: 맨 위 0~30px 줄이 어두운 바탕이고 상단바가 top:0·좌우 끝까지 붙음`, async () => {
      await open(files.admin, width);
      const p = await evaluate(PROBE);
      if (DIAG) console.log(JSON.stringify(p, null, 2));
      const band = await bandStats(0, 30, width);
      if (DIAG) console.log("top band", band);
      assert.ok(dark(band.edge) && dark(band.edgeRight), `맨 위 줄 가장자리 색이 밝음: ${band.edge} / ${band.edgeRight}\n맨 위 요소: ${p.top.join(" > ")}`);
      assert.equal(band.brightRows, 0, `맨 위 30px 중 밝은 줄 ${band.brightRows}개\n맨 위 요소: ${p.top.join(" > ")}`);
      assert.ok(band.brightRatio < 0.05, `맨 위 30px 밝은 픽셀 비율 ${band.brightRatio.toFixed(3)}`);
      assert.equal(p.barTop, 0, `상단바 top=${p.barTop}`);
      assert.equal(p.barLeft, 0, `상단바 left=${p.barLeft}`);
      assert.equal(p.barWidth, p.vw, `상단바 폭 ${p.barWidth} ≠ 화면 ${p.vw}`);
    });

    await check(`관리자 ${width}px: 끝까지 스크롤한 뒤 html·body 배경이 어둡고 당겨도(overscroll) 흰색이 안 보임`, async () => {
      await open(files.admin, width);
      await evaluate("window.scrollTo(0, 1e7), new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
      const p = await evaluate(PROBE);
      if (DIAG) console.log(JSON.stringify(p, null, 2));
      assert.ok(isDarkCss(p.htmlBg), `html 배경 ${p.htmlBg}`);
      assert.ok(isDarkCss(p.bodyBg), `body 배경 ${p.bodyBg}`);
      assert.equal(p.htmlScheme, "dark", `html color-scheme ${p.htmlScheme}`);
      assert.equal(p.htmlOverscroll, "none", `html overscroll-behavior ${p.htmlOverscroll}`);
      assert.equal(p.bodyOverscroll, "none", `body overscroll-behavior ${p.bodyOverscroll}`);
      assert.equal(p.scroller, "html", "문서 스크롤이 html(뷰포트)이 아님");
      assert.equal(p.bodyScrolls, false, "body 가 따로 스크롤되는 상자가 됨(당기면 body 바깥이 드러남)");
      assert.equal(p.barTop, 0, `끝까지 스크롤한 뒤 상단바 top=${p.barTop}(위에 붙어 따라와야 함)`);
      // 하단 상태줄은 화면 맨 아래에 붙고, 마지막 내용이 상태줄에 가리지 않음
      assert.ok(Math.abs(p.sbBottom - p.vh) < 1, `상태줄 bottom=${p.sbBottom}, 화면 높이=${p.vh}`);
      assert.ok(p.lastBottom <= p.vh - p.sbHeight + 0.5, `마지막 내용(bottom ${p.lastBottom})이 상태줄(높이 ${p.sbHeight})에 가림`);
      const band = await bandStats(p.vh - 30, p.vh, width);
      assert.ok(dark(band.edge) && dark(band.edgeRight), `맨 아래 줄 가장자리 색이 밝음: ${band.edge}`);
      assert.equal(band.brightRows, 0, `맨 아래 30px 중 밝은 줄 ${band.brightRows}개`);
    });

    await check(`관리자 ${width}px: 내용이 짧아도 상태줄이 맨 아래에 붙고 빈 곳이 어두움`, async () => {
      await open(files.adminShort, width);
      const p = await evaluate(PROBE);
      assert.ok(Math.abs(p.sbBottom - p.vh) < 1, `상태줄 bottom=${p.sbBottom}, 화면 높이=${p.vh}`);
      assert.ok(p.docH <= p.vh + 1, `짧은 화면인데 문서 높이 ${p.docH} > 화면 ${p.vh}(빈 스크롤)`);
      const band = await bandStats(p.vh - 30, p.vh, width);
      assert.equal(band.brightRows, 0, `맨 아래 30px 중 밝은 줄 ${band.brightRows}개`);
    });

    await check(`공개 ${width}px: 기존 배경(밝은 바탕·밝은 color-scheme) 그대로`, async () => {
      await open(files.public, width);
      const p = await evaluate(PROBE);
      if (DIAG) console.log(JSON.stringify(p, null, 2));
      assert.ok(!isDarkCss(p.bodyBg), `공개 body 배경이 어두워짐: ${p.bodyBg}`);
      assert.notEqual(p.htmlScheme, "dark", "공개 html color-scheme 이 dark 가 됨");
      assert.equal(p.htmlOverscroll, "auto", "공개 html overscroll-behavior 가 바뀜");
      assert.equal(p.bodyPadL, width < 768 ? "16px" : "0px", "공개 모바일 좌우 여백(globals.css body > *)이 바뀜");
      const band = await bandStats(0, 30, width);
      assert.ok(!dark(band.edge), `공개 맨 위 바탕이 어두움: ${band.edge}`);
    });
  }

  await check("관리자 효과: html·body 에 data-admin 을 달면 어둡고, 떼면(공개로 이동) 원래 배경으로 돌아옴", async () => {
    await open(files.public, 1024);
    const before = await evaluate(PROBE);
    await evaluate("document.documentElement.setAttribute('data-admin', ''), 0");
    const on = await evaluate(PROBE);
    assert.ok(isDarkCss(on.htmlBg) && isDarkCss(on.bodyBg), `data-admin 인데 배경 ${on.htmlBg} / ${on.bodyBg}`);
    assert.equal(on.htmlScheme, "dark");
    await evaluate("document.documentElement.removeAttribute('data-admin'), 0");
    const off = await evaluate(PROBE);
    assert.equal(off.htmlBg, before.htmlBg);
    assert.equal(off.bodyBg, before.bodyBg);
    assert.equal(off.htmlScheme, before.htmlScheme);
    assert.equal(off.bodyPadL, before.bodyPadL);
  });
} finally {
  try {
    ws?.close();
  } catch {}
  cleanup();
}

// ── 관리자 효과 부품(브라우저 없이): 속성을 달고, 사라질 때 떼기 ──
{
  const effects = [];
  const react = { ...require("react"), useEffect: (fn) => effects.push(fn) };
  const mod = loadTs("components/admin/ui/AdminDocumentTheme.tsx", { react });
  const attrs = () => {
    const m = new Map();
    return { setAttribute: (k, v) => m.set(k, v), removeAttribute: (k) => m.delete(k), hasAttribute: (k) => m.has(k) };
  };
  await check("AdminDocumentTheme: 붙을 때 html·body 에 data-admin, 사라질 때(공개로 이동) 뗌", async () => {
    const doc = { documentElement: attrs(), body: attrs() };
    const undo = mod.applyAdminDocument(doc);
    assert.ok(doc.documentElement.hasAttribute("data-admin"));
    assert.ok(doc.body.hasAttribute("data-admin"));
    undo();
    assert.ok(!doc.documentElement.hasAttribute("data-admin"));
    assert.ok(!doc.body.hasAttribute("data-admin"));
    // 컴포넌트는 이 함수를 효과로 걸고(정리 함수 = 떼기) 아무것도 그리지 않는다
    assert.equal(mod.default(), null);
    assert.equal(effects.length, 1);
  });
  await check("관리자 레이아웃: AdminDocumentTheme 를 붙이고 주소창 색(theme-color)을 관리자 바탕색으로", async () => {
    assert.match(read("app/admin/layout.tsx"), /<AdminDocumentTheme \/>/);
    const { viewport } = loadTs("app/admin/layout.tsx", adminLayoutDeps);
    const fxBg = read("app/admin/admin-ui.css").match(/--fx-bg:\s*(#[0-9a-f]{6})/i)[1];
    assert.equal(viewport?.themeColor, fxBg);
  });
}

if (failures) {
  console.log(`\n실패 ${failures}개`);
  process.exit(1);
}
console.log("\n관리자 화면 뒤 흰색 노출 시험 모두 통과");
