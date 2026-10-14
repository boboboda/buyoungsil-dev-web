// 공용 스튜디오(/studio) 시험: 접근 관문(로그인 없이 거부), 탭·하위 메뉴, 블록 그림 배치·상태, 사용량 집계, 프로젝트 목록 읽기, 화면 렌더, 키 값 비노출.
// 실행: npm run test:studio-hub
// TS/TSX 를 typescript 로 변환해 불러오고(@/ 경로 포함) react-dom/server 로 그린다. DB·로그인·API 는 가짜로 바꾼다.
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

const cache = new Map();
function resolveSource(name) {
  const base = name.startsWith("@/") ? name.slice(2) : name;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (fs.existsSync(path.join(repo, base + ext))) return base + ext;
  throw new Error(`못 찾음: ${name}`);
}
/** rel(저장소 안 경로)을 변환해 불러온다. overrides 의 이름은 가짜로 바꾼다. overrides 가 없을 때만 캐시한다 */
function load(rel, overrides = {}) {
  const useCache = Object.keys(overrides).length === 0;
  if (useCache && cache.has(rel)) return cache.get(rel);
  const output = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const req = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith("@/")) return load(resolveSource(name), overrides);
    return require(name);
  };
  new Function("require", "module", "exports", output)(req, module, module.exports);
  if (useCache) cache.set(rel, module.exports);
  return module.exports;
}

const Link = ({ href, children, ...rest }) => h("a", { href, ...rest }, children);
const nav = { "next/link": { __esModule: true, default: Link }, "next/navigation": { useRouter: () => ({ refresh() {}, push() {} }) } };

// ───────── 접근 ─────────

const gate = load("lib/studio/gate.ts");

test("관문: 로그인 없이는 목록은 로그인 화면, 앱 화면은 401(키 입력 창)", () => {
  const anon = { signedIn: false, isAdmin: false, hasAuthHeader: false };
  assert.equal(gate.studioGate("/studio", anon).action, "signin");
  assert.equal(gate.studioGate("/studio/saessak-hub", anon).action, "challenge");
  assert.equal(gate.studioGate("/studio", { ...anon, hasAuthHeader: true }).action, "signin", "키는 목록을 못 연다");
});

test("관문: 일반 회원은 목록 못 엶, 관리자는 통과, 키 헤더가 있으면 화면이 DB 로 다시 확인", () => {
  assert.equal(gate.studioGate("/studio", { signedIn: true, isAdmin: false, hasAuthHeader: false }).action, "home");
  assert.equal(gate.studioGate("/studio/saessak-hub", { signedIn: true, isAdmin: false, hasAuthHeader: false }).action, "challenge");
  assert.equal(gate.studioGate("/studio/saessak-hub", { signedIn: false, isAdmin: false, hasAuthHeader: true }).action, "pass");
  assert.equal(gate.studioGate("/studio", { signedIn: true, isAdmin: true, hasAuthHeader: false }).action, "pass");
  assert.equal(gate.studioGate("/studio/x-app", { signedIn: true, isAdmin: true, hasAuthHeader: false }).action, "pass");
  assert.equal(gate.isStudioPath("/studio"), true);
  assert.equal(gate.isStudioPath("/studio/saessak-hub"), true);
  assert.equal(gate.isStudioPath("/studios"), false);
  assert.equal(gate.isStudioPath("/admin/factory"), false);
});

test("middleware 가 /studio 를 관문에 연결하고 matcher 에 넣었다", () => {
  const src = read("middleware.ts");
  assert.ok(src.includes('from "@/lib/studio/gate"'));
  assert.ok(src.includes('"/studio"') && src.includes('"/studio/:path*"'), "matcher");
  assert.match(src, /WWW-Authenticate/);
  assert.match(src, /gate\.action === "challenge"/);
});

const keyHeader = (key) => `Basic ${Buffer.from(`any:${key}`).toString("base64")}`;
const GOOD = `stk_${"A".repeat(43)}`;
const realAccess = load("lib/studio/access.ts", { "@/lib/prisma": { __esModule: true, default: {} }, "@/lib/factory/secretEntries": { readServerSecret: async () => null } });
const access = load("lib/studio/pageAccess.ts", { "@/lib/auth/get-sesstion": { auth: async () => null }, "@/lib/studio/access": { basicPassword: realAccess.basicPassword, STUDIO_APP_RE: realAccess.STUDIO_APP_RE, verifyStudioKey: async () => false } });

test("화면 접근: 관리자·그 앱의 키만, 나머지는 거부", async () => {
  const verify = async (app, key) => app === "saessak-hub" && key === GOOD;
  const base = { name: "관리자", verify };
  assert.deepEqual(await access.decideViewer({ ...base, isAdmin: true, authorization: null, app: undefined }), { kind: "admin", name: "관리자" });
  assert.equal(await access.decideViewer({ ...base, isAdmin: false, authorization: null, app: "saessak-hub" }), null, "로그인·키 없음");
  assert.equal(await access.decideViewer({ ...base, isAdmin: false, authorization: keyHeader("stk_wrong"), app: "saessak-hub" }), null, "틀린 키");
  assert.deepEqual(await access.decideViewer({ ...base, isAdmin: false, authorization: keyHeader(GOOD), app: "saessak-hub" }), { kind: "key", app: "saessak-hub" });
  assert.equal(await access.decideViewer({ ...base, isAdmin: false, authorization: keyHeader(GOOD), app: "memo-app" }), null, "다른 앱");
  assert.equal(await access.decideViewer({ ...base, isAdmin: false, authorization: keyHeader(GOOD), app: undefined }), null, "키로 목록 못 엶");
  assert.equal(await access.decideViewer({ ...base, isAdmin: false, authorization: "Bearer abc", app: "saessak-hub" }), null, "Basic 아님");
  assert.equal(await access.decideViewer({ isAdmin: false, name: "", authorization: keyHeader(GOOD), app: "saessak-hub", verify: async () => { throw new Error("db"); } }), null, "확인 중 오류는 거부");
});

// ───────── 계산 ─────────

const dash = load("lib/studio/dashboard.ts");

test("탭 해석·운영 하위 메뉴(기능 스위치)", () => {
  assert.equal(dash.parseStudioTab("make"), "make");
  assert.equal(dash.parseStudioTab(["ops", "x"]), "ops");
  assert.equal(dash.parseStudioTab("zzz"), "config");
  assert.equal(dash.parseStudioTab(undefined), "config");
  assert.deepEqual(dash.STUDIO_TABS.map((t) => t.label), ["구성", "제작", "운영"]);
  const keys = (f) => dash.visibleOpsMenu(f).map((m) => m.key);
  assert.deepEqual(keys({ studioBatch: true, studioService: true }), ["review", "schedule", "service", "export"]);
  assert.deepEqual(keys({ studioBatch: false, studioService: true }), ["review", "service", "export"]);
  assert.deepEqual(keys({ studioBatch: true, studioService: false }), ["review", "schedule", "export"]);
  assert.deepEqual(keys({ studioBatch: false, studioService: false }), ["review", "export"]);
});

const TOOLS = [
  { name: "pixel-art", label: "도트 그림", source: "file", version: 2, methods: [{ id: "pixellab", label: "PixelLab", secrets: [{ name: "PIXELLAB_API_KEY", ready: false }] }, { id: "codex", label: "Codex", secrets: [] }, { id: "claude", label: "Claude", secrets: [{ name: "ANTHROPIC_API_KEY", ready: true }] }] },
  { name: "anim-sheet", label: "움짤", source: "fallback", version: 1, methods: [{ id: "manual", label: "손으로", secrets: [] }] },
];
const CARDS = [
  { id: "c1", name: "싹이 단독 짤", version: 3, tool: "pixel-art", method: "pixellab", enabled: true, warnings: ["키 없음"] },
  { id: "c2", name: "소품 컷", version: 1, tool: "pixel-art", method: "codex", enabled: true, warnings: [] },
  { id: "c3", name: "옛 움짤", version: 1, tool: "anim-sheet", method: "manual", enabled: false, warnings: [] },
  { id: "c4", name: "기본 카드", version: 1, tool: "pixel-art", method: "", enabled: true, warnings: [] },
];

test("블록 그림: 4열 배치, 선, 카드·도구·방법 상태", () => {
  const g = dash.buildBlockGraph({ appSlug: "saessak-hub", title: "새싹 허브", kindLabel: "게임", cards: CARDS, tools: TOOLS, toolkitCommit: "abc1234" });
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  assert.deepEqual([...new Set(g.nodes.map((n) => n.col))].sort(), [0, 1, 2, 3]);
  assert.equal(g.nodes.filter((n) => n.type === "project").length, 1);
  assert.equal(g.nodes.filter((n) => n.type === "card").length, 4);
  assert.equal(g.nodes.filter((n) => n.type === "tool").length, 2, "같은 도구는 한 블록");
  assert.equal(g.nodes.filter((n) => n.type === "method").length, 4, "도구·방법 조합마다 한 블록");
  // 카드: 판 번호·경고·꺼짐
  const c1 = byId.get("card:c1");
  assert.ok(c1.badges.some((b) => b.text === "판 3"));
  assert.ok(c1.badges.some((b) => b.text === "경고 1" && b.tone === "warn"));
  assert.ok(byId.get("card:c3").badges.some((b) => b.text === "꺼짐"));
  assert.equal(byId.get("card:c3").dim, true);
  // 도구: 설명서 출처·툴킷 판
  const tp = byId.get("tool:pixel-art").badges.map((b) => b.text);
  assert.ok(tp.includes("설명서 file") && tp.includes("툴킷 abc1234"));
  assert.ok(byId.get("tool:anim-sheet").badges.some((b) => b.text === "설명서 fallback" && b.tone === "warn"));
  // 방법: 키 준비 여부(값 없이)
  assert.ok(byId.get("method:pixel-art:pixellab").badges.some((b) => b.text === "키 없음 1개" && b.tone === "warn"));
  assert.ok(byId.get("method:pixel-art:codex").badges.some((b) => b.text === "키 필요 없음"));
  assert.ok(byId.get("method:pixel-art:claude") === undefined, "카드가 안 쓰는 방법은 그리지 않는다");
  assert.ok(byId.get("method:pixel-art:default").badges.some((b) => /키는 설정에 따름/.test(b.text)));
  // 선: 프로젝트→카드 4, 카드→도구 4, 도구→방법 4
  assert.equal(g.edges.length, 12);
  assert.ok(g.edges.some((e) => e.from === "project:saessak-hub" && e.to === "card:c1"));
  assert.ok(g.edges.some((e) => e.from === "card:c1" && e.to === "tool:pixel-art"));
  assert.ok(g.edges.some((e) => e.from === "tool:pixel-art" && e.to === "method:pixel-art:pixellab"));
  // 모든 블록이 그림 안, 같은 열 블록끼리 겹치지 않음
  for (const n of g.nodes) assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= g.width && n.y + n.h <= g.height, n.id);
  for (const a of g.nodes) for (const b of g.nodes) if (a !== b && a.col === b.col) assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y, `겹침 ${a.id} ${b.id}`);
});

test("블록 그림: 설명서에 없는 도구·방법, 툴킷 판 미확인, 카드 없음", () => {
  const g = dash.buildBlockGraph({ appSlug: "memo-app", title: "메모", kindLabel: "앱", cards: [{ id: "x", name: "이상한 카드", version: 1, tool: "ghost", method: "zap", enabled: true, warnings: [] }], tools: [], toolkitCommit: "" });
  const t = g.nodes.find((n) => n.type === "tool");
  const m = g.nodes.find((n) => n.type === "method");
  assert.ok(t.badges.some((b) => b.text === "설명서 없음"));
  assert.ok(m.badges.some((b) => b.text === "설명서에 없는 방법"));
  const empty = dash.buildBlockGraph({ appSlug: "memo-app", title: "메모", kindLabel: "앱", cards: [], tools: TOOLS, toolkitCommit: "" });
  assert.equal(empty.nodes.length, 1);
  assert.equal(empty.edges.length, 0);
});

test("사용량: 최근 30일, 카드별, 카드 없는 그림은 제외", () => {
  const now = Date.parse("2026-10-15T00:00:00Z");
  const day = 24 * 3600 * 1000;
  const iso = (d) => new Date(now - d * day).toISOString();
  const u = dash.summarizeUsage(
    [
      { cardId: "c1", status: "approved", createdAt: iso(1), summary: JSON.stringify({ cost: 3 }) },
      { cardId: "c1", status: "candidate", createdAt: iso(5), summary: JSON.stringify({ cost: 2 }) },
      { cardId: "c1", status: "approved", createdAt: iso(40), summary: JSON.stringify({ cost: 9 }) }, // 30일 밖
      { cardId: "c2", status: "rejected", createdAt: iso(2), summary: "" },
      { cardId: null, status: "approved", createdAt: iso(1), summary: JSON.stringify({ cost: 7 }) },
      { cardId: "zzz", status: "approved", createdAt: iso(1), summary: JSON.stringify({ cost: 7 }) },
      { cardId: "c1", status: "approved", createdAt: iso(1), summary: "깨진 JSON" },
    ],
    ["c1", "c2", "c3"],
    now,
  );
  const by = Object.fromEntries(u.map((x) => [x.cardId, x]));
  assert.deepEqual({ recent: by.c1.recent, approved: by.c1.approved, cost: by.c1.cost }, { recent: 3, approved: 2, cost: 5 });
  assert.equal(by.c1.lastAt, iso(1));
  assert.deepEqual({ recent: by.c2.recent, approved: by.c2.approved, cost: by.c2.cost, lastAt: by.c2.lastAt }, { recent: 1, approved: 0, cost: 0, lastAt: iso(2) });
  assert.deepEqual({ recent: by.c3.recent, lastAt: by.c3.lastAt }, { recent: 0, lastAt: null });
  assert.equal(dash.summaryCost(JSON.stringify({ cost: -1 })), 0);
});

test("목록 정렬: 게임 → 앱 → 미분류, 최근 생성 먼저", () => {
  const row = (appSlug, kind, last) => ({ appSlug, title: appSlug, kind, kindLabel: kind, cardCount: 0, enabledCards: 0, pendingReview: 0, lastGeneratedAt: last, cost30d: 0 });
  const sorted = dash.sortOverview([row("zz-none", "none", null), row("aa-app", "app", "2026-10-01T00:00:00Z"), row("bb-game", "game", null), row("cc-game", "game", "2026-10-10T00:00:00Z")]);
  assert.deepEqual(sorted.map((r) => r.appSlug), ["cc-game", "bb-game", "aa-app", "zz-none"]);
});

// ───────── 읽기 ─────────

function fakePrisma() {
  const now = Date.parse("2026-10-15T00:00:00Z");
  const iso = (d) => new Date(now - d * 24 * 3600 * 1000);
  const arts = [
    { appSlug: "saessak-hub", status: "candidate", createdAt: iso(1), summary: JSON.stringify({ cost: 4 }), cardId: "c1" },
    { appSlug: "saessak-hub", status: "approved", createdAt: iso(3), summary: JSON.stringify({ cost: 1 }), cardId: "c1", id: "a1", subject: "싹이", kind: "image-prop", url: "https://x/a.png", decidedAt: iso(2) },
    { appSlug: "memo-app", status: "candidate", createdAt: iso(60), summary: "", cardId: null },
  ];
  const where = (rows, w = {}) => rows.filter((r) => Object.entries(w).every(([k, v]) => (v && typeof v === "object" && "gte" in v ? r[k] >= v.gte : v && typeof v === "object" && "not" in v ? r[k] !== v.not : r[k] === v)));
  return {
    factoryJob: {
      findMany: async () => [
        { appSlug: "saessak-hub", title: "새싹 허브", stack: "unity", status: "done", finishedAt: iso(1), kind: "app" },
        { appSlug: "memo-app", title: "메모", stack: "flutter", status: "done", finishedAt: iso(9), kind: "app" },
        { appSlug: "game-toolkit", title: "툴킷", stack: "py", status: "done", finishedAt: iso(9), kind: "app" },
      ],
      findFirst: async ({ where: w }) => (w.appSlug === "saessak-hub" ? { title: "새싹 허브" } : null),
    },
    factorySetting: { findUnique: async ({ where: w }) => (w.key === "studioProjects" ? { value: JSON.stringify({ "saessak-hub": { kind: "game", tools: [] } }) } : null) },
    factoryCard: { findMany: async () => [{ appSlug: "saessak-hub", enabled: true }, { appSlug: "saessak-hub", enabled: false }, { appSlug: "memo-app", enabled: true }] },
    factoryAppConnection: { findUnique: async () => null },
    factoryArt: {
      findMany: async ({ where: w } = {}) => where(arts, w),
      count: async ({ where: w } = {}) => where(arts, w).length,
    },
    now,
  };
}

test("프로젝트 목록 읽기: 카드 수·검수 대기·최근 생성·비용", async () => {
  const prisma = fakePrisma();
  const data = load("lib/studio/data.ts", { "@/lib/prisma": { __esModule: true, default: prisma }, "@/lib/factory/cardsDb": {}, "@/lib/factory/projectLinksDb": {}, "@/lib/factory/toolManifestDb": {} });
  const o = await data.readStudioOverview(prisma.now);
  const hub = o.rows.find((r) => r.appSlug === "saessak-hub");
  assert.equal(hub.kind, "game");
  assert.equal(hub.cardCount, 2);
  assert.equal(hub.enabledCards, 1);
  assert.equal(hub.pendingReview, 1);
  assert.equal(hub.cost30d, 5);
  assert.ok(hub.lastGeneratedAt.startsWith("2026-10-14"));
  const memo = o.rows.find((r) => r.appSlug === "memo-app");
  assert.equal(memo.kind, "none");
  assert.equal(memo.cost30d, 0, "60일 전 그림은 비용에 안 셈");
  assert.equal(memo.lastGeneratedAt, null);
  assert.equal(o.rows[0].appSlug, "saessak-hub", "게임이 먼저");
  assert.deepEqual(o.toolApps, ["game-toolkit"]);
  assert.equal(o.rows.find((r) => r.appSlug === "game-toolkit"), undefined, "도구·플랫폼은 목록에서 접음");
});

// ───────── 화면 ─────────

const cardView = (c) => ({ ...c, description: "", options: {}, refRules: { pinDefault: false, defaultArtId: null, sameSubject: true, sameKind: true, maxRefs: null }, settings: null, appSlug: "saessak-hub", updatedAt: "2026-10-14T01:02:03.000Z", updatedBy: "통제실", isDefault: c.name === "기본 카드", secrets: [], pinnedArt: null });
const manifestView = {
  commit: "abc1234",
  reportedAt: "2026-10-14T00:00:00.000Z",
  tools: [
    {
      name: "pixel-art", label: "도트 그림", description: "도트 그림을 만든다", layer: "studio", version: 2, source: "file",
      methods: [{ id: "pixellab", label: "PixelLab", secrets: ["PIXELLAB_API_KEY"], network: true, limits: { size: { allowed: [32, 64] }, maxImagesPerCall: 1 }, cost: { unit: "호출", perCall: 1 }, secretStates: [{ name: "PIXELLAB_API_KEY", ready: false }], ready: false }],
      inputs: [{ name: "kind", label: "결과 종류", type: "string", required: true, description: "종류", choices: ["image-prop"] }],
      outputs: { formats: ["png"], files: [], resultFile: "result.json", resultFields: [] },
    },
  ],
};
const projectData = (over = {}) => ({
  appSlug: "saessak-hub", title: "새싹 허브", kind: "game", kindLabel: "게임",
  link: { appSlug: "saessak-hub", studioBatch: false, studioService: true, exportKind: "folder", exportPath: "assets", warnings: [{ kind: "no-remote", text: "git 원격이 없어요" }] },
  cards: [cardView(CARDS[0]), cardView(CARDS[3])],
  manifest: manifestView,
  usage: [{ cardId: "c1", recent: 4, approved: 2, cost: 5, lastAt: "2026-10-14T00:00:00.000Z" }, { cardId: "c4", recent: 0, approved: 0, cost: 0, lastAt: null }],
  pendingReview: 3, approvedArts: [], studioUrl: null,
  ...over,
});

test("프로젝트 목록 화면: 분류별 묶음과 네 가지 숫자", () => {
  const { default: ProjectList } = load("components/studio/ProjectList.tsx", nav);
  const rows = [
    { appSlug: "saessak-hub", title: "새싹 허브", kind: "game", kindLabel: "게임", cardCount: 4, enabledCards: 3, pendingReview: 2, lastGeneratedAt: "2026-10-14T10:20:00.000Z", cost30d: 5 },
    { appSlug: "memo-app", title: "메모", kind: "none", kindLabel: "미분류", cardCount: 0, enabledCards: 0, pendingReview: 0, lastGeneratedAt: null, cost30d: 0 },
  ];
  const html = renderToStaticMarkup(h(ProjectList, { rows, toolApps: ["game-toolkit"] }));
  assert.match(html, /data-studio-group="game"/);
  assert.match(html, /data-studio-group="none"/);
  assert.doesNotMatch(html, /data-studio-group="app"/, "빈 분류는 안 그린다");
  assert.match(html, /href="\/studio\/saessak-hub"/);
  assert.match(html, /4장 \(켜짐 3\)/);
  assert.match(html, /2장/);
  assert.match(html, /2026-10-14 10:20\(UTC\)/);
  assert.match(html, /PixelLab 5회/);
  assert.match(html, /아직 없음/);
  assert.match(html, /game-toolkit/);
});

test("[구성] 탭 화면: 대시보드·블록·상태 표시·키 상태·사용량", () => {
  const { default: ConfigTab } = load("components/studio/ConfigTab.tsx", nav);
  const html = renderToStaticMarkup(h(ConfigTab, { data: projectData(), canEdit: true }));
  for (const s of ["dashboard", "blocks", "cards", "keys", "usage"]) assert.match(html, new RegExp(`data-config-section="${s}"`));
  assert.match(html, /data-block-diagram/);
  assert.match(html, /<path[^>]*data-edge="project:saessak-hub&gt;card:c1"/, "SVG 선");
  assert.match(html, /data-block="card:c1"/);
  assert.match(html, /판 3/);
  assert.match(html, /경고 1/);
  assert.match(html, /설명서 file/);
  assert.match(html, /툴킷 abc1234/);
  assert.match(html, /키 없음 1개/);
  assert.match(html, /data-detail="project"/, "처음엔 프로젝트 블록 상세");
  assert.match(html, /data-card-new/);
  assert.match(html, /data-usage-row="c1"/);
  assert.match(html, /PIXELLAB_API_KEY 없음/, "키 이름과 등록 여부");
  assert.match(html, /5회/);
});

test("[구성] 탭 화면: 접근 키로 열면 읽기 전용(새 카드·고치기 없음)", () => {
  const { default: ConfigTab } = load("components/studio/ConfigTab.tsx", nav);
  const html = renderToStaticMarkup(h(ConfigTab, { data: projectData(), canEdit: false }));
  assert.doesNotMatch(html, /data-card-new/);
  assert.match(html, /읽기 전용/);
});

test("상세 패널: 카드·도구·방법", () => {
  const { default: Detail } = load("components/studio/ConfigDetail.tsx", nav);
  const data = projectData();
  const render = (selected) => renderToStaticMarkup(h(Detail, { data, selected, canEdit: true, usage: new Map(data.usage.map((u) => [u.cardId, u])), busy: false, onEdit() {}, onToggle() {} }));
  const card = render("card:c1");
  assert.match(card, /data-detail="card"/);
  assert.match(card, /같은 대상/);
  assert.match(card, /data-card-edit/);
  assert.match(card, /data-card-toggle/);
  assert.match(card, /\[끄기\]/);
  const tool = render("tool:pixel-art");
  assert.match(tool, /data-detail="tool"/);
  assert.match(tool, /data-detail-inputs/);
  assert.match(tool, /data-detail-limits/);
  assert.match(tool, /크기 32·64/);
  assert.match(tool, /abc1234/);
  const method = render("method:pixel-art:pixellab");
  assert.match(method, /PIXELLAB_API_KEY/);
  assert.match(method, /없음/);
  assert.match(method, /키 값은 이 화면에 나오지 않아요/);
});

test("카드 편집 화면 틀: 이름·도구·방법·참고 규칙 입력과 저장 버튼", () => {
  const { default: Editor } = load("components/studio/CardEditor.tsx", nav);
  const html = renderToStaticMarkup(h(Editor, { appSlug: "saessak-hub", card: null, approvedArts: [], onSaved() {}, onClose() {} }));
  assert.match(html, /data-card-editor/);
  assert.match(html, /불러오는 중/, "도구 목록은 화면이 붙은 뒤 설명서에서 받는다");
});

test("프로젝트 화면: 로그인·키 없음이면 거부 화면, 있으면 탭 [구성] [제작] [운영]", async () => {
  const denied = { "@/lib/studio/pageAccess": { resolveViewer: async () => null }, "@/lib/studio/data": { readStudioProject: async () => projectData() }, "@/components/studio/ConfigTab": { __esModule: true, default: () => h("div", { "data-fake-config": "" }) } };
  const { default: PageDenied } = load("app/studio/[app]/page.tsx", { ...nav, ...denied });
  const deniedHtml = renderToStaticMarkup(await PageDenied({ params: Promise.resolve({ app: "saessak-hub" }), searchParams: Promise.resolve({}) }));
  assert.match(deniedHtml, /data-studio-denied/);
  assert.doesNotMatch(deniedHtml, /새싹 허브/, "거부면 프로젝트 자료를 그리지 않는다");

  const allowed = { ...denied, "@/lib/studio/pageAccess": { resolveViewer: async () => ({ kind: "admin", name: "관리자" }) } };
  const { default: Page } = load("app/studio/[app]/page.tsx", { ...nav, ...allowed });
  const render = async (search) => renderToStaticMarkup(await Page({ params: Promise.resolve({ app: "saessak-hub" }), searchParams: Promise.resolve(search) }));
  const config = await render({});
  assert.match(config, /data-studio-tab="config"[^>]*>구성</);
  assert.match(config, /data-studio-tab="make"[^>]*>제작</);
  assert.match(config, /data-studio-tab="ops"[^>]*>운영</);
  assert.match(config, /data-fake-config/);
  const make = await render({ tab: "make" });
  assert.match(make, /data-studio-pending="make"/);
  assert.match(make, /준비 중/);
  const ops = await render({ tab: "ops" });
  assert.match(ops, /data-ops-item="review"/);
  assert.match(ops, /data-ops-item="service"/, "서비스 운영 켜짐");
  assert.doesNotMatch(ops, /data-ops-item="schedule"/, "배치 꺼짐 → 생성 일정 숨김");
  assert.match(ops, /data-ops-item="export"/);
  const unknown = load("app/studio/[app]/page.tsx", { ...nav, ...allowed, "@/lib/studio/data": { readStudioProject: async () => null } });
  const unknownHtml = renderToStaticMarkup(await unknown.default({ params: Promise.resolve({ app: "nope-app" }), searchParams: Promise.resolve({}) }));
  assert.match(unknownHtml, /모르는 프로젝트/);
});

test("프로젝트 화면: 접근 키로 열면 목록 링크 없이 읽기 전용 표시", async () => {
  const mocks = { "@/lib/studio/pageAccess": { resolveViewer: async () => ({ kind: "key", app: "saessak-hub" }) }, "@/lib/studio/data": { readStudioProject: async () => projectData() }, "@/components/studio/ConfigTab": { __esModule: true, default: () => null } };
  const { default: Page } = load("app/studio/[app]/page.tsx", { ...nav, ...mocks });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ app: "saessak-hub" }), searchParams: Promise.resolve({}) }));
  assert.match(html, /읽기 전용/);
  assert.doesNotMatch(html, /← 프로젝트/);
});

test("첫 화면: 관리자가 아니면 거부, 관리자는 목록", async () => {
  const data = { readStudioOverview: async () => ({ rows: [{ appSlug: "saessak-hub", title: "새싹 허브", kind: "game", kindLabel: "게임", cardCount: 1, enabledCards: 1, pendingReview: 0, lastGeneratedAt: null, cost30d: 0 }], toolApps: [] }) };
  const deny = load("app/studio/page.tsx", { ...nav, "@/lib/studio/pageAccess": { resolveViewer: async () => null }, "@/lib/studio/data": data });
  assert.match(renderToStaticMarkup(await deny.default()), /data-studio-denied/);
  const ok = load("app/studio/page.tsx", { ...nav, "@/lib/studio/pageAccess": { resolveViewer: async () => ({ kind: "admin", name: "관리자" }) }, "@/lib/studio/data": data });
  assert.match(renderToStaticMarkup(await ok.default()), /data-studio-project="saessak-hub"/);
  const broken = load("app/studio/page.tsx", { ...nav, "@/lib/studio/pageAccess": { resolveViewer: async () => ({ kind: "admin", name: "관리자" }) }, "@/lib/studio/data": { readStudioOverview: async () => { throw new Error("db"); } } });
  assert.match(renderToStaticMarkup(await broken.default()), /확인 못 함/, "읽기 실패해도 화면은 뜬다");
});

// ───────── 연결·비노출 ─────────

test("통제실 스튜디오 탭에 '공용 스튜디오로 이동'이 있고 기존 기능은 그대로", async () => {
  const src = read("components/admin/factory/StudioPanel.tsx");
  assert.match(src, /공용 스튜디오로 이동/);
  assert.match(src, /href="\/studio"/);
  assert.match(src, /<StudioWorkbench /, "기존 기능은 지우지 않음(정리는 3-4)");
});

test("공개 사이트 네비바·채팅 버튼은 /studio 에서 숨김", () => {
  assert.match(read("components/main/PublicChromeOnly.tsx"), /isStudioPath\(pathname\)/);
  assert.match(read("components/channelTalkManager.tsx"), /isStudioPath\(pathname\)/);
});

test("스튜디오 코드는 키 값을 읽지 않는다", () => {
  const files = ["lib/studio/dashboard.ts", "lib/studio/data.ts", "lib/studio/gate.ts", "lib/studio/pageAccess.ts", "app/studio/layout.tsx", "app/studio/page.tsx", "app/studio/[app]/page.tsx", ...fs.readdirSync(path.join(repo, "components/studio")).map((f) => `components/studio/${f}`)];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /process\.env/, `${f}: 환경변수 읽지 않음`);
    assert.doesNotMatch(src, /secretEntries|key-vault|keyVault|FactorySecretEntry|factorySecretEntry|factoryKey\b/, `${f}: 키 보관소를 읽지 않음`);
    assert.doesNotMatch(src, /\.value\b.*secret/i, f);
  }
  // 방법·키 상태 모양에는 값 칸이 없다(이름과 등록 여부만)
  const g = dash.buildBlockGraph({ appSlug: "a-app", title: "a", kindLabel: "앱", cards: CARDS, tools: TOOLS, toolkitCommit: "" });
  assert.doesNotMatch(JSON.stringify(g), /sk-|stk_|secret/i);
});

test("문서: nginx 초안은 docs 에만 있고 설정은 바꾸지 않았다", () => {
  const doc = read("docs/studio-hub.md");
  assert.match(doc, /server_name studio\.buyoungsilcoding\.com/);
  assert.match(doc, /사람이 적용/);
  assert.match(doc, /키 값을 읽지도 보여 주지도 않는다/);
});
