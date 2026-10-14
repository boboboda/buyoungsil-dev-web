// 공용 스튜디오 [제작] > [배치] 편집기(3-4) 시험: 배치 설정 검사 · 편집 동작 · 형식 변환과 왕복(새싹 허브 형식) · 저장·판 번호·이력 · 불러오기(붙여 넣기·가짜 서비스) · 내보내기(앱 폴더 일감·서비스 API) · 화면 · 통제실 정리.
// 실행: npm run test:studio-layout   (가짜 DB·가짜 서비스(fetch 주입), react-dom/server 로 그린다. 실제 DB·키·외부 네트워크 없음)
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
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");

const cache = new Map();
function resolveSource(name) {
  const base = name.startsWith("@/") ? name.slice(2) : name;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (fs.existsSync(path.join(repo, base + ext))) return base + ext;
  throw new Error(`못 찾음: ${name}`);
}
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

const L = load("lib/studio/layout.ts");
const service = load("lib/studio/service.ts", { "@/lib/factory/reviewStatus": { isPrivateHost: load("lib/factory/reviewStatus.ts", { "@/lib/prisma": { __esModule: true, default: {} }, "@/lib/factory/secretEntries": { readServerSecret: async () => null } }).isPrivateHost } });
const SECRET = "tok-layout-secret-value-123456";

// ───────── 설정 · 편집 동작 ─────────

const HUB = L.HUB_PRESET;
const CFG = { ...L.DEFAULT_CONFIG, cols: 10, rows: 8, layers: [{ id: "floor", name: "바닥" }, { id: "decor", name: "장식" }], exportLayers: [] };
const board0 = () => L.emptyBoard(CFG);

test("배치 설정 검사: 올바른 설정은 통과, 틀린 칸은 한국어 이유로 거절", () => {
  assert.equal(L.cleanLayoutConfig(HUB).ok, true);
  assert.equal(L.cleanLayoutConfig(L.DEFAULT_CONFIG).ok, true);
  const bad = (patch) => L.cleanLayoutConfig({ ...HUB, ...patch });
  assert.match(bad({ cell: 4 }).reason, /칸 크기/);
  assert.match(bad({ cols: 0 }).reason, /맵 크기/);
  assert.match(bad({ shape: "hex" }).reason, /맵 형태/);
  assert.match(bad({ layers: [] }).reason, /층은 1~8개/);
  assert.match(bad({ layers: [{ id: "A B", name: "x" }] }).reason, /층 id/);
  assert.match(bad({ layers: [{ id: "a", name: "x" }, { id: "a", name: "y" }] }).reason, /겹쳐요/);
  assert.match(bad({ exportLayers: ["nope"] }).reason, /내보낼 층/);
  assert.match(bad({ format: "xml" }).reason, /내보내기 형식/);
  assert.match(bad({ dest: { kind: "folder", path: "../etc/x.json" } }).reason, /앱 폴더 경로/);
  assert.match(bad({ dest: { kind: "folder", path: "/abs/x.json" } }).reason, /앱 폴더 경로/);
  assert.match(bad({ dest: { kind: "folder", path: "assets/layout/" } }).reason, /앱 폴더 경로/);
  assert.match(bad({ dest: { kind: "service", path: "api/x" } }).reason, /서비스 API 경로/);
  assert.match(bad({ importPath: "http://x" }).reason, /불러올 서비스 API/);
  assert.match(bad({ background: { kind: "image", url: "javascript:alert(1)" } }).reason, /배경 그림 주소/);
  assert.match(bad({ background: { kind: "color", color: "red" } }).reason, /배경 색/);
  assert.deepEqual(L.cleanLayoutConfig({ ...HUB, extra: 1, dest: { kind: "folder", path: "assets/layout/hub_layout.json", token: "x" } }).config.dest, { kind: "folder", path: "assets/layout/hub_layout.json" }, "모르는 칸은 버림");
  assert.equal(L.readLayoutConfig({ nonsense: true }), null);
  assert.equal(HUB.cell, 32);
  assert.equal(HUB.cols, 36);
});

test("놓기: 칸에 맞추고 맵 안으로 넣고 같은 층 맨 위로, 자유 모양은 0.25칸 단위", () => {
  let r = L.placeItem(board0(), CFG, { name: "sofa_01", layer: "decor", x: 2.6, y: 3.4, w: 2, h: 1 });
  assert.deepEqual([r.board.items[0].x, r.board.items[0].y], [3, 3]);
  r = L.placeItem(r.board, CFG, { name: "tree", layer: "decor", x: 99, y: -5, w: 2, h: 2 });
  assert.deepEqual([r.board.items[1].x, r.board.items[1].y], [8, 0], "w=2 라서 맵 안(10-2)으로");
  assert.equal(r.board.items[1].z, r.board.items[0].z + 1, "같은 층 맨 위");
  const free = { ...CFG, shape: "free" };
  const f = L.placeItem(L.emptyBoard(free), free, { name: "a", layer: "decor", x: 1.3, y: 1.9 });
  assert.deepEqual([f.board.items[0].x, f.board.items[0].y], [1.25, 2]);
  const off = L.placeItem(board0(), CFG, { name: "a", layer: "decor", x: 1.3, y: 1.9 }, false);
  assert.deepEqual([off.board.items[0].x, off.board.items[0].y], [1.25, 2], "칸 맞춤을 끄면 0.25 단위");
  assert.ok(L.placeItem(board0(), CFG, { name: "a", layer: "nope", x: 0, y: 0 }).error);
  assert.ok(L.placeItem(board0(), CFG, { name: "   ", layer: "decor", x: 0, y: 0 }).error);
  assert.ok(L.placeItem(board0(), CFG, { name: "a<b", layer: "decor", x: 0, y: 0 }).error, "특수 기호 거절");
  const full = { ...board0(), items: Array.from({ length: 500 }, (_, i) => ({ id: `i${i}`, name: "a", artId: "", layer: "decor", x: 0, y: 0, w: 1, h: 1, rot: 0, flip: false, z: i, fixed: false })) };
  assert.match(L.placeItem(full, CFG, { name: "a", layer: "decor", x: 0, y: 0 }).error, /500개/);
  assert.equal(r.board.items.length, 2);
  assert.equal(board0().items.length, 0, "원본은 바꾸지 않음");
});

test("옮기기·회전·뒤집기·잠금·지우기: 잠금은 안 움직이고 안 지워짐, 회전하면 차지하는 칸이 바뀌고 맵 안으로 당김", () => {
  let b = L.placeItem(board0(), CFG, { name: "bar", layer: "decor", x: 8, y: 0, w: 2, h: 1 }, true, "a").board;
  b = L.rotateItem(b, "a");
  assert.equal(b.items[0].rot, 90);
  assert.deepEqual(L.footprint(b.items[0]), { w: 1, h: 2 });
  assert.deepEqual([b.items[0].x, b.items[0].y], [8, 0]);
  b = L.rotateItem(L.rotateItem(L.rotateItem(b, "a"), "a"), "a");
  assert.equal(b.items[0].rot, 0, "네 번이면 한 바퀴");
  // 맵 오른쪽 끝에서 회전해 폭이 커지면 안으로 당긴다
  let c = L.placeItem(board0(), CFG, { name: "tall", layer: "decor", x: 9, y: 0, w: 1, h: 3 }, true, "t").board;
  c = L.rotateItem(c, "t");
  assert.deepEqual([c.items[0].x, c.items[0].y], [7, 0], "가로 3칸이 되어 x=7");
  c = L.flipItem(c, "t");
  assert.equal(c.items[0].flip, true);
  c = L.lockItem(c, "t", true);
  const moved = L.moveItem(c, CFG, "t", 0, 5);
  assert.deepEqual([moved.items[0].x, moved.items[0].y], [7, 0], "잠금은 안 움직임");
  assert.equal(L.rotateItem(c, "t").items[0].rot, c.items[0].rot);
  assert.equal(L.flipItem(c, "t").items[0].flip, true);
  assert.equal(L.removeItem(c, "t").items.length, 1, "잠금은 안 지워짐");
  assert.equal(L.removeItem(L.lockItem(c, "t", false), "t").items.length, 0);
  assert.equal(L.moveItem(L.lockItem(c, "t", false), CFG, "t", 2.4, 3.6).items[0].x, 2);
  assert.equal(L.renameItem(c, "t", "x").items[0].name, "tall", "잠금은 이름도 안 바뀜");
});

test("겹침 순서·층 전환: 같은 층 안에서만 순서가 바뀌고, 층을 옮기면 그 층 맨 위", () => {
  let b = board0();
  for (const id of ["a", "b", "c"]) b = L.placeItem(b, CFG, { name: id, layer: "decor", x: 0, y: 0 }, true, id).board;
  b = L.placeItem(b, CFG, { name: "f", layer: "floor", x: 0, y: 0 }, true, "f").board;
  const zs = (bd) => Object.fromEntries(bd.items.map((i) => [i.id, i.z]));
  assert.ok(zs(b).a < zs(b).b && zs(b).b < zs(b).c);
  const front = L.moveZ(b, "a", "front");
  assert.ok(zs(front).a > zs(front).c, "맨 위");
  const back = L.moveZ(b, "c", "back");
  assert.ok(zs(back).c < zs(back).a, "맨 아래");
  const fwd = L.moveZ(b, "a", "forward");
  assert.ok(zs(fwd).a > zs(fwd).b && zs(fwd).a < zs(fwd).c, "한 칸 위로");
  const bwd = L.moveZ(b, "c", "backward");
  assert.ok(zs(bwd).c < zs(bwd).b && zs(bwd).c > zs(bwd).a, "한 칸 아래로");
  assert.equal(zs(L.moveZ(b, "a", "backward")).a, 0, "이미 맨 아래면 그대로");
  assert.equal(zs(front).f, zs(b).f, "다른 층 순서는 건드리지 않음");
  const sw = L.setItemLayer(b, CFG, "f", "decor");
  assert.equal(sw.items.find((i) => i.id === "f").layer, "decor");
  assert.ok(sw.items.find((i) => i.id === "f").z > zs(b).c, "옮겨 간 층 맨 위");
  assert.equal(L.setItemLayer(b, CFG, "f", "ghost"), b, "없는 층은 무시");
});

test("겹침 감지(같은 층만, 맞닿기는 겹침 아님)·첫 빈자리·되돌리기/다시", () => {
  let b = board0();
  b = L.placeItem(b, CFG, { name: "a", layer: "decor", x: 0, y: 0, w: 2, h: 2 }, true, "a").board;
  b = L.placeItem(b, CFG, { name: "b", layer: "decor", x: 2, y: 0, w: 2, h: 2 }, true, "b").board;
  assert.equal(L.overlappingIds(b).size, 0, "맞닿기만");
  b = L.placeItem(b, CFG, { name: "c", layer: "decor", x: 1, y: 1, w: 2, h: 2 }, true, "c").board;
  assert.deepEqual([...L.overlappingIds(b)].sort(), ["a", "b", "c"]);
  b = L.placeItem(b, CFG, { name: "d", layer: "floor", x: 1, y: 1, w: 2, h: 2 }, true, "d").board;
  assert.ok(!L.overlappingIds(b).has("d"), "다른 층은 겹침 아님");
  assert.deepEqual(L.firstFreeCell(L.emptyBoard(CFG), "decor", 2, 2), { x: 0, y: 0 });
  const two = L.placeItem(L.emptyBoard(CFG), CFG, { name: "a", layer: "decor", x: 0, y: 0, w: 2, h: 2 }, true, "a").board;
  assert.deepEqual(L.firstFreeCell(two, "decor", 2, 2), { x: 2, y: 0 });
  assert.deepEqual(L.firstFreeCell(two, "floor", 2, 2), { x: 0, y: 0 }, "층이 다르면 비어 있음");
  let u = L.createUndo(board0());
  u = L.pushUndo(u, two);
  u = L.pushUndo(u, two);
  assert.equal(u.past.length, 1, "같은 내용은 단계를 늘리지 않음");
  u = L.undo(u);
  assert.equal(u.present.items.length, 0);
  assert.equal(L.undo(u), u, "더 되돌릴 게 없으면 그대로");
  u = L.redo(u);
  assert.equal(u.present.items.length, 1);
  u = L.undo(u);
  u = L.pushUndo(u, L.moveItem(two, CFG, "a", 5, 5));
  assert.equal(u.future.length, 0, "새 편집을 하면 다시 기록은 비움");
  let many = L.createUndo(board0());
  for (let i = 0; i < L.UNDO_LIMIT + 20; i++) many = L.pushUndo(many, L.placeItem(many.present, CFG, { name: "n", layer: "decor", x: i % 10, y: 0 }, true, `n${i}`).board);
  assert.equal(many.past.length, L.UNDO_LIMIT);
});

test("배치판 검사: 모르는 층·겹치는 id·크기 다름·잘못된 회전은 거절, 위치는 맵 안으로 맞춤", () => {
  const item = (o = {}) => ({ id: "a", name: "sofa", artId: "", layer: "decor", x: 1, y: 1, w: 1, h: 1, rot: 0, flip: false, z: 0, fixed: false, ...o });
  const ok = (items, cols = 10, rows = 8) => L.cleanBoard({ version: 1, cols, rows, items }, CFG);
  assert.equal(ok([item()]).ok, true);
  assert.match(ok([item()], 11, 8).reason, /맵 크기/);
  assert.match(ok([item({ layer: "sky" })]).reason, /층/);
  assert.match(ok([item(), item()]).reason, /겹쳐요/);
  assert.match(ok([item({ rot: 45 })]).reason, /회전/);
  assert.match(ok([item({ w: 0 })]).reason, /칸 수/);
  assert.match(ok([item({ id: "a b" })]).reason, /id/);
  assert.match(ok([item({ name: "" })]).reason, /이름/);
  assert.equal(ok([item({ x: 50, y: -3, w: 2 })]).board.items[0].x, 8);
  assert.equal(ok([item({ x: 50, y: -3 })]).board.items[0].y, 0);
  assert.equal(L.cleanBoard("x", CFG).ok, false);
  assert.equal(L.cleanBoard({ version: 1, cols: 10, rows: 8, items: "x" }, CFG).ok, false);
  const cleaned = ok([{ ...item(), evil: "<script>" }]).board.items[0];
  assert.equal("evil" in cleaned, false, "모르는 칸은 버림");
  assert.equal(L.boardsEqual(board0(), board0()), true);
  assert.equal(L.boardsEqual(board0(), null), false);
});

// ───────── 형식 변환 · 왕복 ─────────

// 새싹 허브 게임 파일(assets/layout/hub_layout.json)의 모양: 고정 줄 2개(note 포함)와 놓는 소품
const HUB_FILE = {
  version: 1,
  room: { cols: 36, rows: 36 },
  items: [
    { id: "fx1", kind: "prop", name: "extinguisher", x: 8, y: 17, flip: false, fixed: true, note: "입구 소화기" },
    { id: "fx2", kind: "prop", name: "bench", x: 6, y: 20, flip: false, fixed: true, note: "휴식 벤치" },
    { id: "p1", kind: "prop", name: "tree", x: 3, y: 4, flip: true, fixed: false },
    { id: "p2", kind: "prop", name: "sofa_01", x: 30, y: 33, flip: false, fixed: false },
  ],
};

/** app-kit 저장 입구(src/studio-layout.ts cleanLayout)와 같은 규칙: 알려진 칸만 남기고 틀리면 문자열 */
function appKitClean(v) {
  const isCell = (n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 35;
  if (!v || typeof v !== "object" || v.version !== 1 || !v.room || v.room.cols !== 36 || v.room.rows !== 36 || !Array.isArray(v.items) || v.items.length > 500) return "형식";
  const items = [];
  for (const it of v.items) {
    if (typeof it.id !== "string" || it.id.length < 1 || it.id.length > 40) return "id";
    if (it.kind !== "prop") return "kind";
    if (typeof it.name !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(it.name)) return "name";
    if (!isCell(it.x) || !isCell(it.y)) return "위치";
    if (it.flip !== undefined && typeof it.flip !== "boolean") return "flip";
    if (it.fixed !== undefined && typeof it.fixed !== "boolean") return "fixed";
    const o = { id: it.id, kind: "prop", name: it.name, x: it.x, y: it.y };
    if (it.flip !== undefined) o.flip = it.flip;
    if (it.fixed !== undefined) o.fixed = it.fixed;
    items.push(o);
  }
  return { version: 1, room: { cols: 36, rows: 36 }, items };
}

test("왕복: 새싹 허브 배치 → 공용 배치판 → hub 형식으로 내보내면 app-kit 입구가 받는 모양과 같다", () => {
  const imp = L.importHub(HUB_FILE, HUB);
  assert.equal(imp.ok, true);
  assert.equal(imp.board.items.length, 4);
  assert.deepEqual(imp.warnings, []);
  assert.ok(imp.board.items.every((i) => i.layer === "decor"), "허브 소품은 장식 층");
  assert.equal(imp.board.items.find((i) => i.id === "fx1").fixed, true);
  assert.equal(imp.board.items.find((i) => i.id === "p1").flip, true);
  const out = L.exportBoard(imp.board, HUB);
  const expected = appKitClean(HUB_FILE); // note 같은 모르는 칸은 입구가 버리므로 기준은 입구 결과
  assert.deepEqual(out.json, expected, "내보낸 결과 = 기존 저장 형식");
  assert.deepEqual(appKitClean(out.json), out.json, "내보낸 결과를 입구에 다시 넣어도 같다(멱등)");
  assert.deepEqual(out.warnings, []);
  assert.equal(out.schema, "hub_layout");
  assert.equal(out.count, 4);
  // 두 번 돌려도 같다
  const again = L.exportBoard(L.importHub(out.json, HUB).board, HUB);
  assert.deepEqual(again.json, out.json);
  // flip/fixed 가 빠진 옛 파일도 읽고, 내보내면 둘 다 명시한다(게임 파일 모양)
  const sparse = L.importHub({ version: 1, room: { cols: 36, rows: 36 }, items: [{ id: "x", kind: "prop", name: "tree", x: 1, y: 2 }] }, HUB);
  assert.deepEqual(L.exportBoard(sparse.board, HUB).json.items[0], { id: "x", kind: "prop", name: "tree", x: 1, y: 2, flip: false, fixed: false });
  // 서비스가 { ok, layout, version } 로 감싸 줘도 읽는다
  assert.equal(L.importAny({ ok: true, layout: HUB_FILE, version: 3 }, HUB).board.items.length, 4);
});

test("실제 게임 파일(새싹 허브 hub_layout.json)이 있으면 그 파일로도 왕복이 같다", { skip: !fs.existsSync(path.resolve(repo, "../saessak-hub/assets/layout/hub_layout.json")) }, () => {
  const real = JSON.parse(fs.readFileSync(path.resolve(repo, "../saessak-hub/assets/layout/hub_layout.json"), "utf8"));
  const imp = L.importHub(real, HUB);
  assert.equal(imp.ok, true, imp.reason);
  assert.deepEqual(L.exportBoard(imp.board, HUB).json, appKitClean(real));
});

test("hub 형식으로 못 담는 것은 빼고 경고: 한글 이름·소수 위치·맵 밖·회전, 내보낼 층만", () => {
  let b = L.emptyBoard(HUB);
  b = L.placeItem(b, HUB, { name: "소파", layer: "decor", x: 1, y: 1 }, true, "k").board;
  b = L.placeItem(b, HUB, { name: "lamp", layer: "decor", x: 2.5, y: 1 }, false, "f").board;
  b = L.placeItem(b, HUB, { name: "tree", layer: "decor", x: 4, y: 4, w: 2, h: 1 }, true, "r").board;
  b = L.rotateItem(b, "r");
  b = L.placeItem(b, HUB, { name: "rug", layer: "floor", x: 0, y: 0 }, true, "fl").board;
  const out = L.exportBoard(b, HUB);
  assert.deepEqual(out.json.items.map((i) => i.id), ["r"]);
  assert.ok(out.warnings.some((w) => /소파/.test(w) && /이름 규칙/.test(w)));
  assert.ok(out.warnings.some((w) => /lamp/.test(w) && /칸에 맞지/.test(w)));
  assert.ok(out.warnings.some((w) => /회전/.test(w)));
  assert.ok(out.warnings.some((w) => /내보낼 층이 아닌 항목 1개/.test(w)));
  const bad = L.importHub({ version: 1, room: { cols: 10, rows: 10 }, items: [] }, HUB);
  assert.match(bad.reason, /방 크기/);
  assert.match(L.importHub({ version: 2, room: { cols: 36, rows: 36 }, items: [] }, HUB).reason, /버전/);
  const partial = L.importHub({ version: 1, room: { cols: 36, rows: 36 }, items: [{ id: "a", kind: "desk", name: "x", x: 0, y: 0 }, { id: "b", kind: "prop", name: "한글", x: 0, y: 0 }, { id: "c", kind: "prop", name: "ok", x: 99, y: 0 }, { id: "d", kind: "prop", name: "ok", x: 1, y: 1 }] }, HUB);
  assert.equal(partial.board.items.length, 1, "읽을 수 없는 줄만 건너뜀");
  assert.equal(partial.warnings.length, 3);
});

test("공용 형식(studio-layout-v1): 층·회전·겹침 순서를 담고, 다시 읽으면 같은 배치", () => {
  let b = board0();
  b = L.placeItem(b, CFG, { name: "sofa", artId: "art1", layer: "decor", x: 2, y: 3, w: 2, h: 1 }, true, "a").board;
  b = L.rotateItem(b, "a");
  b = L.flipItem(b, "a");
  b = L.placeItem(b, CFG, { name: "rug", layer: "floor", x: 0, y: 0, w: 3, h: 3 }, true, "b").board;
  const out = L.exportBoard(b, CFG);
  assert.equal(out.json.schema, "studio-layout-v1");
  assert.deepEqual(out.json.items.map((i) => i.id), ["b", "a"], "아래층이 먼저");
  assert.equal(out.json.items[1].rot, 90);
  assert.equal(out.json.items[1].art, "art1");
  const back = L.importAny(JSON.parse(JSON.stringify(out.json)), CFG);
  assert.equal(back.ok, true);
  const byId = (bd) => Object.fromEntries(bd.items.map((i) => [i.id, i]));
  assert.deepEqual(byId(back.board), byId(b), "왕복 뒤 같은 항목");
  assert.match(L.importAny({ nope: 1 }, CFG).reason, /알 수 없는/);
});

test("앱 폴더로 보낼 지시문: 파일 한 개·내용 그대로·고정 줄 유지·e2e 안 함, 경고 포함", () => {
  const text = L.toFileText({ version: 1, items: [] });
  assert.equal(text.endsWith("}\n"), true);
  const plan = L.buildLayoutPlan({ appSlug: "saessak-hub", path: "assets/layout/hub_layout.json", version: 4, schema: "hub_layout", fileText: text, warnings: ["회전 1개 뺌"] });
  assert.match(plan, /4판/);
  assert.match(plan, /assets\/layout\/hub_layout\.json/);
  assert.match(plan, /```json\n\{\n {2}"version": 1/);
  assert.match(plan, /fixed: true/);
  assert.match(plan, /한 파일만 바꿉니다/);
  assert.match(plan, /e2e 스크린샷은 찍지 않습니다/);
  assert.match(plan, /회전 1개 뺌/);
});

// ───────── 저장 · 판 번호 · 불러오기 · 내보내기 (가짜 DB · 가짜 서비스) ─────────

function makeDb(over = {}) {
  const st = { conn: { layoutConfig: HUB, domain: "hub.example.com" }, boards: [], arts: [], jobs: {}, ...over };
  const prisma = {
    factoryAppConnection: { findUnique: async () => st.conn },
    factoryLayoutBoard: {
      findFirst: async ({ where }) => st.boards.filter((b) => b.appSlug === where.appSlug).sort((a, b) => b.version - a.version)[0] ?? null,
      findMany: async ({ where, take }) => st.boards.filter((b) => b.appSlug === where.appSlug).sort((a, b) => b.version - a.version).slice(0, take),
      findUnique: async ({ where }) => st.boards.find((b) => b.appSlug === where.appSlug_version.appSlug && b.version === where.appSlug_version.version) ?? null,
      create: async ({ data }) => {
        if (st.boards.some((b) => b.appSlug === data.appSlug && b.version === data.version)) throw new Error("unique");
        st.boards.push({ exportStatus: "", exportJobId: null, exportDest: "", exportNote: "", exportedAt: null, createdAt: new Date("2026-10-15T01:00:00Z"), ...data });
        return data;
      },
      deleteMany: async ({ where }) => {
        st.boards = st.boards.filter((b) => !(b.appSlug === where.appSlug && b.version <= where.version.lte));
        return {};
      },
      update: async ({ where, data }) => {
        const row = st.boards.find((b) => b.appSlug === where.appSlug_version.appSlug && b.version === where.appSlug_version.version);
        Object.assign(row, data);
        return row;
      },
    },
    factoryArt: { findMany: async () => st.arts },
    factoryJob: {
      findMany: async ({ where }) => where.id.in.filter((id) => st.jobs[id]).map((id) => ({ id, status: st.jobs[id] })),
      findUnique: async ({ where }) => (st.jobs[where.id] ? { status: st.jobs[where.id] } : null),
    },
  };
  return { st, prisma };
}

function loadData(db, extra = {}) {
  const calls = { revision: [] };
  const mod = load("lib/studio/layoutData.ts", {
    "@/lib/prisma": { __esModule: true, default: db.prisma },
    "@/lib/factory/mcp": { enqueueWithId: async (args) => (calls.revision.push(args), extra.revisionFail ? { isError: true, content: [{ text: "같은 앱에 검토 대기 일감이 있어요" }] } : { content: [{ text: "ok" }], jobId: `rev${calls.revision.length}` }) },
    "@/lib/studio/opsData": {
      exportStatus: (stored, js) => (stored !== "requested" || !js ? stored : js === "done" ? "done" : js === "failed" || js === "cancelled" ? "failed" : "requested"),
      serviceBase: async (_slug, domain) => domain,
    },
    "@/lib/studio/service": service,
  });
  return { mod, calls };
}

/** 가짜 서비스: 요청을 기록하고 정해 둔 응답을 준다 */
function fakeService(routes) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, method: init.method, auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : undefined });
    const r = routes[`${init.method} ${new URL(url).pathname}`];
    if (!r) return new Response("", { status: 404 });
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { seen, deps: { fetchImpl, readSecret: async (name) => (name === "SERVICE_ADMIN_TOKEN_SAESSAK_HUB" ? SECRET : null), lookupImpl: async () => ["93.184.216.34"] } };
}

const boardOf = (n) => {
  let b = L.emptyBoard(HUB);
  for (let i = 0; i < n; i++) b = L.placeItem(b, HUB, { name: `item_${i}`, layer: "decor", x: i % 30, y: 5 + Math.floor(i / 30) }, true, `p${i}`).board;
  return b;
};

test("저장: 첫 판 1, 같은 내용은 판을 올리지 않음, 바뀌면 +1, 판 번호가 어긋나면 409, 설정이 없으면 거절", async () => {
  const db = makeDb();
  const { mod } = loadData(db);
  const r1 = await mod.saveLayout("saessak-hub", boardOf(2), 0, "관리자", "처음");
  assert.deepEqual([r1.ok, r1.version], [true, 1]);
  assert.equal(db.st.boards[0].who, "관리자");
  assert.equal(db.st.boards[0].note, "처음");
  assert.equal(db.st.boards[0].source, "editor");
  assert.equal(db.st.boards[0].itemCount, 2);
  const same = await mod.saveLayout("saessak-hub", boardOf(2), 1, "관리자");
  assert.deepEqual([same.ok, same.version], [true, 1]);
  assert.match(same.message, /바뀐 내용이 없어서/);
  assert.equal(db.st.boards.length, 1, "같은 내용은 새 줄을 만들지 않음");
  const r2 = await mod.saveLayout("saessak-hub", boardOf(3), 1, "관리자");
  assert.equal(r2.version, 2);
  const stale = await mod.saveLayout("saessak-hub", boardOf(4), 1, "다른 사람");
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  assert.equal(stale.currentVersion, 2);
  assert.equal(db.st.boards.length, 2, "거절하면 저장 안 함");
  assert.equal((await mod.saveLayout("saessak-hub", boardOf(1), "x", "a")).status, 400);
  assert.equal((await mod.saveLayout("saessak-hub", { cols: 1 }, 2, "a")).status, 400, "검사 통과 못 하면 거절");
  const noCfg = makeDb({ conn: { layoutConfig: null, domain: null } });
  assert.match((await loadData(noCfg).mod.saveLayout("saessak-hub", boardOf(1), 0, "a")).message, /배치 설정이 없어요/);
  const broken = makeDb({ conn: { layoutConfig: { cell: "x" }, domain: null } });
  assert.equal((await loadData(broken).mod.saveLayout("saessak-hub", boardOf(1), 0, "a")).ok, false, "깨진 설정도 설정 없음으로 본다");
});

test("판 이력: 최신 판이 먼저, 오래된 판은 100판까지만 남음, 되돌리기는 새 판으로 저장(이력 안 지움)", async () => {
  const db = makeDb();
  const { mod } = loadData(db);
  for (let i = 0; i < 103; i++) assert.equal((await mod.saveLayout("saessak-hub", boardOf(1 + (i % 7) + Math.floor(i / 7)), i, "a")).version, i + 1);
  const versions = db.st.boards.map((b) => b.version).sort((a, b) => a - b);
  assert.equal(versions.length, L.HISTORY_KEEP);
  assert.equal(versions[0], 4, "1~3판은 정리");
  assert.equal(versions.at(-1), 103);
  const data = await mod.readLayoutData("saessak-hub");
  assert.equal(data.version, 103);
  assert.equal(data.history[0].version, 103);
  assert.equal(data.history.length, 30, "화면에는 최근 30판");
  assert.equal(data.board.items.length, db.st.boards.find((b) => b.version === 103).itemCount);
  const keep = db.st.boards.find((b) => b.version === 50);
  const rest = await mod.restoreLayout("saessak-hub", 50, 103, "관리자");
  assert.deepEqual([rest.ok, rest.version], [true, 104]);
  assert.match(rest.message, /50판 내용을 104판/);
  const row = db.st.boards.find((b) => b.version === 104);
  assert.equal(row.source, "restore");
  assert.equal(row.board, keep.board, "내용이 50판과 같다");
  assert.ok(db.st.boards.some((b) => b.version === 50), "옛 판은 그대로");
  assert.equal((await mod.restoreLayout("saessak-hub", 2, 104, "a")).status, 404, "정리된 판");
  assert.equal((await mod.restoreLayout("saessak-hub", 50, 3, "a")).status, 409, "판 번호 어긋남");
});

test("불러오기: 붙여 넣은 hub JSON 이 첫 판으로 저장되고, 읽지 못하면 저장하지 않는다", async () => {
  const db = makeDb();
  const { mod } = loadData(db);
  const r = await mod.importLayout("saessak-hub", { json: HUB_FILE }, 0, "관리자");
  assert.deepEqual([r.ok, r.version], [true, 1]);
  assert.equal(db.st.boards[0].source, "import");
  assert.match(db.st.boards[0].note, /붙여 넣은 JSON/);
  assert.equal(db.st.boards[0].itemCount, 4);
  const bad = await mod.importLayout("saessak-hub", { json: { version: 1, room: { cols: 10, rows: 10 }, items: [] } }, 1, "a");
  assert.equal(bad.status, 400);
  assert.match(bad.message, /방 크기/);
  assert.equal(db.st.boards.length, 1, "읽지 못하면 저장 안 함");
  assert.equal((await mod.importLayout("saessak-hub", {}, 1, "a")).status, 400);
  assert.equal((await mod.importLayout("saessak-hub", { json: HUB_FILE }, 5, "a")).status, 409, "판 번호 어긋남");
});

test("불러오기(서비스): 설정한 경로를 GET 으로 읽고 첫 판으로 저장, 키 값은 어디에도 안 나옴, 키 없음·404·빈 배치는 이유를 알림", async () => {
  const db = makeDb();
  const { mod } = loadData(db);
  const svc = fakeService({ "GET /p/hub/api/studio-layout": { body: { ok: true, layout: HUB_FILE, version: 3, updatedAt: "2026-10-14T07:20:00Z", appliedAt: null } } });
  const r = await mod.importLayout("saessak-hub", { fromService: true }, 0, "관리자", { serviceDeps: svc.deps });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.version, 1);
  assert.match(r.message, /서비스\(\/p\/hub\/api\/studio-layout\) 3판에서 4개를 불러와 1판으로 저장/);
  assert.equal(svc.seen.length, 1);
  assert.equal(svc.seen[0].method, "GET", "서비스 쪽은 읽기만");
  assert.equal(svc.seen[0].url, "https://hub.example.com/p/hub/api/studio-layout");
  assert.equal(svc.seen[0].auth, `Bearer ${SECRET}`);
  assert.doesNotMatch(JSON.stringify({ r, boards: db.st.boards }), new RegExp(SECRET), "키 값은 응답·저장에 없음");
  assert.equal(db.st.boards[0].note.includes("3판"), true);
  // 키가 없으면 멈추고 키 이름만
  const nokey = await loadData(makeDb()).mod.importLayout("saessak-hub", { fromService: true }, 0, "a", { serviceDeps: { ...svc.deps, readSecret: async () => null } });
  assert.equal(nokey.status, 400);
  assert.match(nokey.message, /키 등록 필요: SERVICE_ADMIN_TOKEN_SAESSAK_HUB/);
  assert.match(nokey.message, /붙여 넣으면/);
  // 404 → 서비스에 API 없음
  const none = await loadData(makeDb()).mod.importLayout("saessak-hub", { fromService: true }, 0, "a", { serviceDeps: fakeService({}).deps });
  assert.equal(none.status, 404);
  assert.match(none.message, /API 가 없어요/);
  // 서비스에 저장된 배치가 없음
  const empty = await loadData(makeDb()).mod.importLayout("saessak-hub", { fromService: true }, 0, "a", { serviceDeps: fakeService({ "GET /p/hub/api/studio-layout": { body: { ok: true, layout: null, version: 0 } } }).deps });
  assert.match(empty.message, /저장된 배치가 아직 없어요/);
  // 인증 실패(예: 서비스가 사람 로그인만 받음)
  const denied = await loadData(makeDb()).mod.importLayout("saessak-hub", { fromService: true }, 0, "a", { serviceDeps: fakeService({ "GET /p/hub/api/studio-layout": { status: 403 } }).deps });
  assert.equal(denied.status, 502);
  assert.match(denied.message, /인증 실패/);
  // 주소가 없으면 부르지 않음
  const noBase = makeDb({ conn: { layoutConfig: HUB, domain: null } });
  const blocked = await loadData(noBase).mod.importLayout("saessak-hub", { fromService: true }, 0, "a", { serviceDeps: svc.deps });
  assert.equal(blocked.status, 502);
  // 불러올 경로 설정 없음
  const noPath = makeDb({ conn: { layoutConfig: { ...HUB, importPath: "" }, domain: "hub.example.com" } });
  assert.match((await loadData(noPath).mod.importLayout("saessak-hub", { fromService: true }, 0, "a")).message, /경로가 설정에 없어요/);
});

test("내보내기(앱 폴더): 앱 수정 일감 1건에 파일 내용·경로가 들어가고, 판에 기록이 남고, 진행 중이면 다시 못 보냄 — 불러온 배치가 왕복 뒤 같다", async () => {
  const db = makeDb();
  const { mod, calls } = loadData(db);
  await mod.importLayout("saessak-hub", { json: HUB_FILE }, 0, "관리자");
  const r = await mod.exportLayout("saessak-hub", 1, "관리자");
  assert.equal(r.ok, true, r.message);
  assert.equal(r.jobId, "rev1");
  assert.equal(calls.revision.length, 1);
  const job = calls.revision[0];
  assert.equal(job.kind, "revision");
  assert.equal(job.source, "스튜디오");
  assert.match(job.title, /배치 1판 앱 폴더에 반영/);
  assert.match(job.planMarkdown, /assets\/layout\/hub_layout\.json/);
  const body = /```json\n([\s\S]*?)\n```/.exec(job.planMarkdown)[1];
  assert.deepEqual(JSON.parse(body), appKitClean(HUB_FILE), "일감에 담긴 파일 = 기존 형식");
  const row = db.st.boards[0];
  assert.deepEqual([row.exportStatus, row.exportJobId, row.exportDest], ["requested", "rev1", "assets/layout/hub_layout.json"]);
  const again = await mod.exportLayout("saessak-hub", 1, "관리자");
  assert.equal(again.status, 409);
  assert.match(again.message, /이미 앱 수정 일감으로 보냈어요/);
  assert.equal(calls.revision.length, 1);
  // 일감이 끝나면 '보냄'으로 보이고, 다시 보낼 수 있다
  db.st.jobs.rev1 = "done";
  let data = await mod.readLayoutData("saessak-hub");
  assert.equal(data.history[0].exportStatus, "done");
  assert.equal((await mod.exportLayout("saessak-hub", 1, "관리자")).ok, true);
  db.st.jobs.rev2 = "failed";
  data = await mod.readLayoutData("saessak-hub");
  assert.equal(data.history[0].exportStatus, "failed");
  // 일감 등록이 거절되면 기록하지 않는다
  const f = makeDb();
  const fl = loadData(f, { revisionFail: true });
  await fl.mod.importLayout("saessak-hub", { json: HUB_FILE }, 0, "a");
  const fr = await fl.mod.exportLayout("saessak-hub", undefined, "a");
  assert.equal(fr.status, 409);
  assert.equal(f.st.boards[0].exportStatus, "");
  // 내보낼 곳 없음 / 저장된 판 없음 / 내보낼 항목 없음
  const none = makeDb({ conn: { layoutConfig: { ...HUB, dest: { kind: "none" } }, domain: null } });
  assert.match((await loadData(none).mod.exportLayout("saessak-hub", undefined, "a")).message, /내보낼 곳이 정해져/);
  assert.equal((await loadData(makeDb()).mod.exportLayout("saessak-hub", undefined, "a")).status, 404);
  const emptyDb = makeDb();
  await loadData(emptyDb).mod.saveLayout("saessak-hub", L.emptyBoard(HUB), 0, "a");
  assert.match((await loadData(emptyDb).mod.exportLayout("saessak-hub", undefined, "a")).message, /내보낼 항목이 없어요/);
});

test("내보내기(서비스 API): 서비스 판 번호를 읽고(GET) 그 번호를 기준으로 PUT, 실패·미지원·키 없음은 판에 기록", async () => {
  const mk = () => makeDb({ conn: { layoutConfig: { ...HUB, dest: { kind: "service", path: "/p/hub/api/studio-layout" }, exportLayers: [] }, domain: "hub.example.com" } });
  const db = mk();
  const { mod } = loadData(db);
  await mod.importLayout("saessak-hub", { json: HUB_FILE }, 0, "관리자");
  const svc = fakeService({ "GET /p/hub/api/studio-layout": { body: { ok: true, layout: null, version: 5 } }, "PUT /p/hub/api/studio-layout": { body: { ok: true, version: 6 } } });
  const r = await mod.exportLayout("saessak-hub", 1, "관리자", { serviceDeps: svc.deps });
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(svc.seen.map((s) => s.method), ["GET", "PUT"]);
  assert.deepEqual(svc.seen[1].body, { layout: appKitClean(HUB_FILE), baseVersion: 5 });
  assert.equal(svc.seen[1].auth, `Bearer ${SECRET}`);
  assert.deepEqual([db.st.boards[0].exportStatus, db.st.boards[0].exportDest], ["done", "/p/hub/api/studio-layout"]);
  assert.doesNotMatch(JSON.stringify({ r, boards: db.st.boards }), new RegExp(SECRET));
  // 서비스 쪽이 그 사이에 바뀜(409) → 실패로 기록, 덮어쓰지 않음
  const db2 = mk();
  const m2 = loadData(db2).mod;
  await m2.importLayout("saessak-hub", { json: HUB_FILE }, 0, "a");
  const conflict = await m2.exportLayout("saessak-hub", 1, "a", { serviceDeps: fakeService({ "GET /p/hub/api/studio-layout": { body: { version: 5 } }, "PUT /p/hub/api/studio-layout": { status: 409, body: { ok: false } } }).deps });
  assert.equal(conflict.status, 502);
  assert.match(conflict.message, /그 사이에 바뀌었어요/);
  assert.equal(db2.st.boards[0].exportStatus, "failed");
  // API 없음 → 미지원
  const db3 = mk();
  const m3 = loadData(db3).mod;
  await m3.importLayout("saessak-hub", { json: HUB_FILE }, 0, "a");
  const un = await m3.exportLayout("saessak-hub", 1, "a", { serviceDeps: fakeService({}).deps });
  assert.equal(un.status, 501);
  assert.match(un.message, /서비스 API 미지원/);
  assert.equal(db3.st.boards[0].exportStatus, "unsupported");
  // 키 없음
  const db4 = mk();
  const m4 = loadData(db4).mod;
  await m4.importLayout("saessak-hub", { json: HUB_FILE }, 0, "a");
  const nk = await m4.exportLayout("saessak-hub", 1, "a", { serviceDeps: { ...svc.deps, readSecret: async () => null } });
  assert.match(nk.message, /키 등록 필요: SERVICE_ADMIN_TOKEN_SAESSAK_HUB/);
  assert.equal(db4.st.boards[0].exportStatus, "failed");
  assert.equal(db4.st.boards[0].exportNote, "키 등록 필요: SERVICE_ADMIN_TOKEN_SAESSAK_HUB");
});

test("화면 자료: 놓을 수 있는 그림 종류만 보관함에서 가져오고, 설정이 없으면 board 가 없다", async () => {
  const db = makeDb({ arts: [{ id: "a1", subject: "tree", kind: "image-prop", url: "https://img/a1.png" }, { id: "a2", subject: "싹이", kind: "image-character", url: "https://img/a2.png" }] });
  const { mod } = loadData(db);
  const d = await mod.readLayoutData("saessak-hub");
  assert.deepEqual(d.palette.map((a) => a.id), ["a1"], "image-prop 만");
  assert.equal(d.version, 0);
  assert.equal(d.board, null);
  assert.equal(d.config.cols, 36);
  const all = await loadData(makeDb({ conn: { layoutConfig: { ...HUB, allowedKinds: [] }, domain: null }, arts: db.st.arts })).mod.readLayoutData("saessak-hub");
  assert.equal(all.palette.length, 2, "종류를 비우면 모두");
  const noCfg = await loadData(makeDb({ conn: null })).mod.readLayoutData("saessak-hub");
  assert.equal(noCfg.config, null);
  assert.equal(await mod.readLayoutData("../bad"), null);
});

// ───────── 연결 설정 · 화면 · 길 ─────────

test("프로젝트 연결 설정: layoutConfig 를 검사해 저장하고 null 이면 지운다", () => {
  const pl = load("lib/factory/projectLinks.ts");
  const ok = pl.validatePatch({ layoutConfig: HUB });
  assert.equal(ok.ok, true);
  assert.equal(ok.patch.layoutConfig.cols, 36);
  assert.equal(pl.validatePatch({ layoutConfig: null }).patch.layoutConfig, null);
  const bad = pl.validatePatch({ layoutConfig: { ...HUB, cell: 1 } });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /칸 크기/);
  assert.equal("layoutConfig" in pl.validatePatch({ studioBatch: true }).patch, false, "보내지 않은 칸은 안 바뀜");
  const view = pl.buildLinksView({ appSlugs: ["a-app"], connections: [{ appSlug: "a-app", folder: null, stack: null, defaultBranch: null, remotes: null, deployServer: null, deployMethod: null, domain: null, containerName: null, services: [], notes: null, exportKind: null, exportPath: null, studioBatch: true, studioService: false, layoutConfig: HUB }], report: null });
  assert.equal(view.rows[0].layoutConfig.shape, "grid");
  assert.equal(pl.buildLinksView({ appSlugs: ["b-app"], connections: [], report: null }).rows[0].layoutConfig, null);
});

const nav = { "next/navigation": { useRouter: () => ({ refresh() {}, push() {} }) } };
const sampleData = (over = {}) => {
  const board = L.importHub(HUB_FILE, HUB).board;
  return {
    appSlug: "saessak-hub",
    config: HUB,
    version: 2,
    board,
    history: [
      { version: 2, source: "editor", note: "벤치 옮김", who: "관리자", itemCount: 4, createdAt: "2026-10-15T01:00:00.000Z", exportStatus: "requested", exportDest: "assets/layout/hub_layout.json", exportNote: "", exportedAt: "2026-10-15T01:05:00.000Z", exportJobId: "rev1" },
      { version: 1, source: "import", note: "서비스(/p/hub/api/studio-layout) 3판에서 불러옴", who: "관리자", itemCount: 4, createdAt: "2026-10-14T23:00:00.000Z", exportStatus: "", exportDest: "", exportNote: "", exportedAt: null, exportJobId: null },
    ],
    palette: [{ id: "a1", subject: "tree", kind: "image-prop", url: "https://img/a1.png" }],
    ...over,
  };
};

test("편집기 화면: 맵·승인 그림·층·판 번호·내보내기 안내·이력·불러오기가 보이고, 읽기 전용이면 편집 단추가 없다", () => {
  const { default: Editor } = load("components/studio/LayoutEditor.tsx", nav);
  const html = renderToStaticMarkup(h(Editor, { data: sampleData(), canEdit: true }));
  assert.match(html, /data-layout-editor/);
  assert.match(html, /data-layout-version[^>]*>2판</);
  assert.match(html, /네모 칸 · 36×36칸 · 칸 32px/);
  assert.match(html, /data-layout-art="a1"/);
  assert.match(html, /data-layout-layer="floor"[^>]*>바닥</);
  assert.match(html, /data-layout-layer="facility"[^>]*>시설</);
  assert.match(html, /data-layout-layer="decor"[^>]*>장식</);
  assert.match(html, /data-layout-item-name="extinguisher"/);
  assert.match(html, /data-layout-item-name="tree"/);
  assert.match(html, /🔒/, "고정 항목은 잠금 표시");
  assert.match(html, /src="https:\/\/img\/a1\.png"[^>]*alt="tree"|alt="tree"[^>]*src="https:\/\/img\/a1\.png"/s, "이름이 같은 승인 그림이 있으면 그림으로 보임");
  assert.match(html, /내보낼 곳: 앱 폴더 assets\/layout\/hub_layout\.json/);
  assert.match(html, /형식 hub_layout · 4개/);
  assert.match(html, /data-layout-history-row="2"/);
  assert.match(html, /일감 등록됨 → assets\/layout\/hub_layout\.json/);
  assert.match(html, /data-layout-save-btn[^>]*disabled/, "바뀐 게 없으면 저장 단추는 잠김");
  assert.doesNotMatch(html, /data-layout-export-btn[^>]*disabled/, "저장된 판이 있고 바뀐 게 없으면 내보내기 가능");
  assert.match(html, /2판 내보내기/);
  assert.match(html, /data-layout-import-service/);
  assert.match(html, /서비스에서 불러오기 \(\/p\/hub\/api\/studio-layout\)/);
  assert.match(html, /이 판으로 되돌리기/);
  assert.match(html, /판 이력 \(2\)/);
  const ro = renderToStaticMarkup(h(Editor, { data: sampleData(), canEdit: false }));
  assert.match(ro, /읽기 전용이에요/);
  assert.doesNotMatch(ro, /data-layout-save-btn|data-layout-import|이 판으로 되돌리기|data-layout-name-add/);
  assert.match(ro, /data-layout-history-row="1"/, "이력은 읽기 전용에서도 보임");
  const first = renderToStaticMarkup(h(Editor, { data: sampleData({ version: 0, board: null, history: [] }), canEdit: true }));
  assert.match(first, /저장된 판 없음/);
  assert.match(first, /첫 판으로 저장/);
  assert.match(first, /처음이라면 서비스의 기존 배치를 불러와 첫 판으로/);
  assert.match(first, /아직 저장한 판이 없어요/);
  assert.match(first, /data-layout-export-btn[^>]*disabled/, "저장된 판이 없으면 내보내기 잠김");
  const noCfg = renderToStaticMarkup(h(Editor, { data: sampleData({ config: null, board: null }), canEdit: true }));
  assert.match(noCfg, /data-layout-noconfig/);
  assert.match(noCfg, /배치 설정이 아직 없어요/);
  const base = sampleData();
  const warn = renderToStaticMarkup(h(Editor, { data: sampleData({ board: { ...base.board, items: [...base.board.items, { id: "k", name: "소파", artId: "", layer: "decor", x: 1, y: 1, w: 1, h: 1, rot: 0, flip: false, z: 9, fixed: false }] } }), canEdit: true }));
  assert.match(warn, /data-layout-export-warnings/);
  assert.match(warn, /소파/);
});

test("제작 탭: [배치] 하위 탭에 편집기가 들어오고(자리 문구 없음), 켜짐 스위치가 있을 때만 읽는다", () => {
  const make = read("components/studio/MakeTab.tsx");
  assert.match(make, /<LayoutEditor /);
  assert.doesNotMatch(make, /들어올 자리예요/);
  const page = read("app/studio/[app]/page.tsx");
  assert.match(page, /readLayoutData\(app\)/);
  assert.match(page, /tab === "make" && flags\.studioBatch && sub === "batch"/);
  assert.match(page, /layout=\{layout\}/);
});

test("배치 API: 관리자만, 앱 이름·본문 크기 검사, 알 수 없는 행동은 400, 키 값은 오가지 않음", () => {
  const src = read("app/api/studio/layout/route.ts");
  assert.match(src, /const denied = await requireAdmin\(\);\n\n {2}if \(denied\) return denied;/);
  assert.match(src, /SLUG_RE\.test\(appSlug\)/);
  assert.match(src, /status: 413/);
  for (const a of ["save", "restore", "import", "export"]) assert.match(src, new RegExp(`body\\.action === "${a}"`));
  assert.match(src, /알 수 없는 행동이에요/);
  assert.doesNotMatch(src, /process\.env|secretEntries/);
  const data = read("lib/studio/layoutData.ts");
  assert.doesNotMatch(data, /process\.env|secretEntries|readServerSecret/, "키는 service.ts 의 호출기만 읽는다");
  assert.doesNotMatch(data, /writeFile|appendFile|child_process|execSync|spawn/, "앱 폴더·파일을 직접 건드리지 않음");
});

test("통제실 정리: 스튜디오 탭은 새 스튜디오 바로가기·요약이 위에, 예전 편집은 접어서 남음, 배치 설정 입력칸", () => {
  const src = read("components/admin/factory/StudioPanel.tsx");
  assert.match(src, /공용 스튜디오로 이동/);
  assert.match(src, /href="\/studio"/);
  assert.match(src, /data-studio-summary/);
  assert.match(src, /href=\{`\/studio\/\$\{r\.appSlug\}`\}/);
  assert.match(src, /<details data-studio-legacy>[\s\S]*<StudioWorkbench /);
  assert.match(src, /옛 스튜디오 ↗/);
  const form = read("components/admin/factory/LayoutConfigForm.tsx");
  for (const f of ["cell", "cols", "rows", "shape", "bgKind", "layers", "kinds", "format", "schema", "exportLayers", "destKind", "importPath"]) assert.match(form, new RegExp(`data-layout-field="${f}"`));
  assert.match(form, /새싹 허브 값 채우기/);
  assert.match(read("components/admin/factory/CardsPanel.tsx"), /link\.studioBatch \? <LayoutConfigForm /);
  const { draftToConfig } = load("components/admin/factory/LayoutConfigForm.tsx");
  const draft = { cell: "32", cols: "36", rows: "36", shape: "grid", bgKind: "color", bgColor: "#d6d3d1", bgUrl: "", layers: "floor:바닥, facility:시설, decor:장식", kinds: "image-prop", format: "hub-layout-v1", schema: "hub_layout", exportLayers: "decor", destKind: "folder", destPath: "assets/layout/hub_layout.json", importPath: "/p/hub/api/studio-layout" };
  assert.deepEqual(L.cleanLayoutConfig(draftToConfig(draft)).config, HUB, "입력칸 → 설정이 허브 값과 같다");
});

test("마이그레이션은 칸·표만 추가하고 데이터를 지우지 않는다", () => {
  const sql = read("prisma/migrations/20261117090000_studio_layout/migration.sql");
  assert.match(sql, /ALTER TABLE "factory_app_connections" ADD COLUMN "layoutConfig" JSONB;/);
  assert.match(sql, /CREATE TABLE "factory_layout_boards"/);
  assert.match(sql, /UNIQUE INDEX "factory_layout_boards_appSlug_version_key"/);
  assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE/i);
  assert.match(read("prisma/schema.prisma"), /model FactoryLayoutBoard \{[\s\S]*@@unique\(\[appSlug, version\]\)/);
});
