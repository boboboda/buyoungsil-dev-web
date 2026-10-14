// lib/studio/layout.ts
// 공용 스튜디오 [제작] > [배치] 편집기의 순수 규칙(3-4): 배치 설정 검사 · 배치판 검사 · 편집 동작(놓기·옮기기·회전·겹침 순서·층·지우기) · 되돌리기 기록 · 내보내기 형식 변환.
// 편집기는 공용이고, 게임마다 다른 부분은 프로젝트 연결 설정의 '배치 설정'(LayoutConfig)에 둔다. DB·네트워크를 부르지 않는다(화면과 시험이 같이 쓴다).
// 내보내기 형식: studio-layout-v1(공용, 층·회전·겹침 순서까지 다 담음) · hub-layout-v1(새싹 허브 게임의 hub_layout.json / app-kit studio-layout 입구와 같은 모양).

export const LAYOUT_SHAPES = ["grid", "iso", "free"] as const;
export type LayoutShape = (typeof LAYOUT_SHAPES)[number];
export const SHAPE_LABELS: Record<LayoutShape, string> = { grid: "네모 칸", iso: "쿼터뷰", free: "자유" };

export const LAYOUT_FORMATS = ["studio-layout-v1", "hub-layout-v1"] as const;
export type LayoutFormat = (typeof LAYOUT_FORMATS)[number];
export const FORMAT_LABELS: Record<LayoutFormat, string> = { "studio-layout-v1": "공용 형식(studio-layout-v1)", "hub-layout-v1": "새싹 허브 형식(hub-layout-v1)" };

export const MAX_ITEMS = 500;
export const MAX_BOARD_BYTES = 200 * 1024;
export const HISTORY_KEEP = 100; // 홈페이지 DB 에 남기는 판 수
export const UNDO_LIMIT = 100; // 편집 중 되돌리기 단계

export interface LayoutLayer {
  id: string;
  name: string;
}

export type LayoutDest = { kind: "folder"; path: string } | { kind: "service"; path: string } | { kind: "none" };

export interface LayoutBackground {
  kind: "none" | "color" | "image";
  color: string; // #rrggbb (kind=color)
  url: string; // https 주소 또는 / 로 시작하는 홈페이지 경로 (kind=image)
}

export interface LayoutConfig {
  cell: number; // 한 칸 픽셀
  cols: number;
  rows: number;
  shape: LayoutShape;
  background: LayoutBackground;
  layers: LayoutLayer[]; // 아래층이 먼저
  allowedKinds: string[]; // 놓을 수 있는 그림 종류(결과 종류). 비면 모두
  format: LayoutFormat;
  schema: string; // 내보내기 JSON 스키마 이름(표시·기록용)
  exportLayers: string[]; // 내보낼 층. 비면 모든 층
  dest: LayoutDest; // 내보낼 곳
  importPath: string; // 기존 배치를 읽어 올 서비스 API 경로(GET). 비면 없음
}

export interface LayoutItem {
  id: string;
  name: string; // 게임·서비스가 아는 이름(그림의 대상 이름)
  artId: string; // 보관함 그림 id(없으면 이름만)
  layer: string;
  x: number; // 왼쪽 위 칸(자유 모양이면 0.25 단위)
  y: number;
  w: number; // 그림이 차지하는 칸 수(회전 전)
  h: number;
  rot: 0 | 90 | 180 | 270;
  flip: boolean;
  z: number; // 같은 층 안의 겹침 순서(클수록 위)
  fixed: boolean; // 잠금: 옮기기·지우기 안 됨
}

export interface LayoutBoard {
  version: 1;
  cols: number;
  rows: number;
  items: LayoutItem[];
}

// ───────── 설정 ─────────

export const DEFAULT_LAYERS: LayoutLayer[] = [
  { id: "floor", name: "바닥" },
  { id: "facility", name: "시설" },
  { id: "decor", name: "장식" },
];

export const DEFAULT_CONFIG: LayoutConfig = {
  cell: 32,
  cols: 20,
  rows: 20,
  shape: "grid",
  background: { kind: "color", color: "#e5e7eb", url: "" },
  layers: DEFAULT_LAYERS,
  allowedKinds: [],
  format: "studio-layout-v1",
  schema: "studio-layout-v1",
  exportLayers: [],
  dest: { kind: "none" },
  importPath: "",
};

/** 새싹 허브 값(36×36칸, 칸 32px, 게임은 장식 소품만 읽음). [새싹 허브 값 채우기]에서 쓴다 */
export const HUB_PRESET: LayoutConfig = {
  cell: 32,
  cols: 36,
  rows: 36,
  shape: "grid",
  background: { kind: "color", color: "#d6d3d1", url: "" },
  layers: DEFAULT_LAYERS,
  allowedKinds: ["image-prop"],
  format: "hub-layout-v1",
  schema: "hub_layout",
  exportLayers: ["decor"],
  dest: { kind: "folder", path: "assets/layout/hub_layout.json" }, // 게임이 읽는 파일
  importPath: "/p/hub/api/studio-layout", // app-kit 가 Studio 배치를 저장해 둔 입구
};

const LAYER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,19}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DEST_FOLDER_RE = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9가-힣_.\-][A-Za-z0-9가-힣_.\-/ ]{0,199}$/;
const DEST_SERVICE_RE = /^\/[A-Za-z0-9_\-./]{1,150}$/;
const KIND_RE = /^[A-Za-z0-9_.-]{1,40}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const intIn = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);

/** 배치 설정을 검사해 알려진 칸만 남긴다. 틀리면 한국어 이유 */
export function cleanLayoutConfig(raw: unknown): { ok: true; config: LayoutConfig } | { ok: false; reason: string } {
  if (!isObj(raw)) return { ok: false, reason: "배치 설정이 객체가 아니에요." };
  const cell = intIn(raw.cell, 8, 256);

  if (cell === null) return { ok: false, reason: "칸 크기는 8~256 사이 정수(픽셀)예요." };
  const cols = intIn(raw.cols, 1, 200);
  const rows = intIn(raw.rows, 1, 200);

  if (cols === null || rows === null) return { ok: false, reason: "맵 크기(가로·세로 칸 수)는 1~200 사이 정수예요." };
  if (!(LAYOUT_SHAPES as readonly unknown[]).includes(raw.shape)) return { ok: false, reason: "맵 형태는 네모 칸 / 쿼터뷰 / 자유 중 하나예요." };
  const bg = isObj(raw.background) ? raw.background : { kind: "none" };
  const bgKind = bg.kind === "color" || bg.kind === "image" ? bg.kind : "none";
  const color = typeof bg.color === "string" ? bg.color : "";
  const url = typeof bg.url === "string" ? bg.url.trim() : "";

  if (bgKind === "color" && !COLOR_RE.test(color)) return { ok: false, reason: "배경 색은 #rrggbb 모양이에요." };
  if (bgKind === "image" && !/^(https:\/\/[^\s]{3,300}|\/[A-Za-z0-9_\-./%]{1,200})$/.test(url)) return { ok: false, reason: "배경 그림 주소는 https:// 주소이거나 /로 시작하는 홈페이지 경로여야 해요." };
  if (!Array.isArray(raw.layers) || raw.layers.length < 1 || raw.layers.length > 8) return { ok: false, reason: "층은 1~8개예요." };
  const layers: LayoutLayer[] = [];

  for (const l of raw.layers) {
    if (!isObj(l) || typeof l.id !== "string" || !LAYER_ID_RE.test(l.id)) return { ok: false, reason: "층 id 는 영문 소문자·숫자·_·- 20자까지예요." };
    if (typeof l.name !== "string" || !l.name.trim() || l.name.trim().length > 20) return { ok: false, reason: "층 이름은 1~20자예요." };
    if (layers.some((x) => x.id === l.id)) return { ok: false, reason: `층 id '${l.id}' 가 겹쳐요.` };
    layers.push({ id: l.id, name: l.name.trim() });
  }
  const kindList = (v: unknown): string[] | null => (Array.isArray(v) && v.length <= 10 && v.every((k) => typeof k === "string" && KIND_RE.test(k)) ? [...new Set(v as string[])] : null);
  const allowedKinds = raw.allowedKinds === undefined ? [] : kindList(raw.allowedKinds);

  if (!allowedKinds) return { ok: false, reason: "놓을 수 있는 그림 종류는 종류 이름 목록(10개까지)이에요." };
  if (!(LAYOUT_FORMATS as readonly unknown[]).includes(raw.format)) return { ok: false, reason: "내보내기 형식은 studio-layout-v1 / hub-layout-v1 중 하나예요." };
  const schema = typeof raw.schema === "string" ? raw.schema.trim() : "";

  if (!/^[A-Za-z0-9_.-]{1,60}$/.test(schema)) return { ok: false, reason: "스키마 이름은 영문·숫자·_ . - 60자까지예요." };
  const exportLayers = raw.exportLayers === undefined ? [] : kindList(raw.exportLayers);

  if (!exportLayers || exportLayers.some((id) => !layers.some((l) => l.id === id))) return { ok: false, reason: "내보낼 층은 위에서 만든 층 id 중에서만 고를 수 있어요." };
  let dest: LayoutDest = { kind: "none" };

  if (isObj(raw.dest) && raw.dest.kind === "folder") {
    const p = typeof raw.dest.path === "string" ? raw.dest.path.trim() : "";

    if (!DEST_FOLDER_RE.test(p) || p.endsWith("/")) return { ok: false, reason: "내보낼 앱 폴더 경로는 파일 경로(앱 폴더 안 상대 경로, 절대 경로·.. 금지)여야 해요. 예: assets/layout/hub_layout.json" };
    dest = { kind: "folder", path: p };
  } else if (isObj(raw.dest) && raw.dest.kind === "service") {
    const p = typeof raw.dest.path === "string" ? raw.dest.path.trim() : "";

    if (!DEST_SERVICE_RE.test(p) || p.includes("..")) return { ok: false, reason: "서비스 API 경로는 /로 시작하는 경로예요. 예: /p/hub/api/studio-layout" };
    dest = { kind: "service", path: p };
  }
  const importPath = typeof raw.importPath === "string" ? raw.importPath.trim() : "";

  if (importPath && (!DEST_SERVICE_RE.test(importPath) || importPath.includes(".."))) return { ok: false, reason: "불러올 서비스 API 경로는 /로 시작하는 경로예요. 예: /p/hub/api/studio-layout" };
  const config: LayoutConfig = { cell, cols, rows, shape: raw.shape as LayoutShape, background: { kind: bgKind, color: bgKind === "color" ? color : "", url: bgKind === "image" ? url : "" }, layers, allowedKinds, format: raw.format as LayoutFormat, schema, exportLayers, dest, importPath };

  return { ok: true, config };
}

/** DB 에 저장된 값(JSON)을 읽는다. 깨졌으면 null */
export function readLayoutConfig(stored: unknown): LayoutConfig | null {
  const r = cleanLayoutConfig(stored);

  return r.ok ? r.config : null;
}

// ───────── 배치판 ─────────

export const emptyBoard = (config: Pick<LayoutConfig, "cols" | "rows">): LayoutBoard => ({ version: 1, cols: config.cols, rows: config.rows, items: [] });

export const stepOf = (config: Pick<LayoutConfig, "shape">, snap = true): number => (config.shape === "free" || !snap ? 0.25 : 1);
const snapTo = (v: number, step: number) => Math.round(v / step) * step;
const ROTS = [0, 90, 180, 270] as const;

/** 회전을 반영한 차지하는 칸 수 */
export const footprint = (it: Pick<LayoutItem, "w" | "h" | "rot">): { w: number; h: number } => (it.rot === 90 || it.rot === 270 ? { w: it.h, h: it.w } : { w: it.w, h: it.h });

const clampPos = (it: LayoutItem, board: Pick<LayoutBoard, "cols" | "rows">, x: number, y: number, step: number) => {
  const f = footprint(it);

  return { x: Math.min(Math.max(0, snapTo(x, step)), Math.max(0, board.cols - f.w)), y: Math.min(Math.max(0, snapTo(y, step)), Math.max(0, board.rows - f.h)) };
};

const NAME_RE = /^[^\u0000-\u001f<>"'`\\]{1,80}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const ART_ID_RE = /^[A-Za-z0-9_-]{0,80}$/;

/** 배치판 검사: 알려진 칸만 남기고 범위를 맞춘다. 틀리면 한국어 이유 */
export function cleanBoard(raw: unknown, config: LayoutConfig): { ok: true; board: LayoutBoard } | { ok: false; reason: string } {
  if (!isObj(raw)) return { ok: false, reason: "배치 내용이 올바르지 않아요." };
  if (raw.cols !== config.cols || raw.rows !== config.rows) return { ok: false, reason: `맵 크기가 설정(${config.cols}×${config.rows})과 달라요.` };
  if (!Array.isArray(raw.items) || raw.items.length > MAX_ITEMS) return { ok: false, reason: `배치 항목은 ${MAX_ITEMS}개 이하의 목록이어야 해요.` };
  const items: LayoutItem[] = [];
  const seen = new Set<string>();
  const step = stepOf(config, false);

  for (const it of raw.items) {
    if (!isObj(it)) return { ok: false, reason: "배치 항목이 올바르지 않아요." };
    if (typeof it.id !== "string" || !ID_RE.test(it.id)) return { ok: false, reason: "항목 id 는 영문·숫자·_·- 40자까지예요." };
    if (seen.has(it.id)) return { ok: false, reason: `항목 id '${it.id}' 가 겹쳐요.` };
    if (typeof it.name !== "string" || !NAME_RE.test(it.name)) return { ok: false, reason: "항목 이름은 1~80자(특수 기호 제외)예요." };
    if (typeof it.layer !== "string" || !config.layers.some((l) => l.id === it.layer)) return { ok: false, reason: `항목 '${it.name}' 의 층이 설정에 없어요.` };
    const w = intIn(it.w, 1, 64);
    const h = intIn(it.h, 1, 64);

    if (w === null || h === null) return { ok: false, reason: `항목 '${it.name}' 의 칸 수(가로·세로)는 1~64 정수예요.` };
    if (!(ROTS as readonly unknown[]).includes(it.rot)) return { ok: false, reason: "회전은 0·90·180·270 중 하나예요." };
    if (typeof it.x !== "number" || typeof it.y !== "number" || !Number.isFinite(it.x) || !Number.isFinite(it.y)) return { ok: false, reason: "항목 위치는 숫자예요." };
    if (typeof it.z !== "number" || !Number.isInteger(it.z) || it.z < -1000 || it.z > 100000) return { ok: false, reason: "겹침 순서는 정수예요." };
    if (typeof it.artId !== "string" || !ART_ID_RE.test(it.artId)) return { ok: false, reason: "그림 id 모양이 틀려요." };
    const item: LayoutItem = { id: it.id, name: it.name, artId: it.artId, layer: it.layer, x: 0, y: 0, w, h, rot: it.rot as LayoutItem["rot"], flip: it.flip === true, z: it.z, fixed: it.fixed === true };
    const p = clampPos(item, config, it.x, it.y, step);

    item.x = p.x;
    item.y = p.y;
    seen.add(it.id);
    items.push(item);
  }
  const board: LayoutBoard = { version: 1, cols: config.cols, rows: config.rows, items };

  if (JSON.stringify(board).length > MAX_BOARD_BYTES) return { ok: false, reason: "배치가 너무 커요." };

  return { ok: true, board };
}

export const boardsEqual = (a: LayoutBoard | null, b: LayoutBoard | null): boolean => (a === null || b === null ? a === b : JSON.stringify(a) === JSON.stringify(b));

// ───────── 편집 동작(새 배치판을 돌려줌, 원본은 바꾸지 않음) ─────────

let seq = 0;
export const newItemId = (): string => `i${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.slice(0, 40);

const withItems = (b: LayoutBoard, items: LayoutItem[]): LayoutBoard => ({ ...b, items });
const mapItem = (b: LayoutBoard, id: string, fn: (it: LayoutItem) => LayoutItem): LayoutBoard => withItems(b, b.items.map((it) => (it.id === id ? fn(it) : it)));
const topZ = (b: LayoutBoard, layer: string) => b.items.reduce((m, it) => (it.layer === layer ? Math.max(m, it.z) : m), 0);

export interface NewItem {
  name: string;
  artId?: string;
  layer: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
}

/** 놓기: 칸에 맞추고 맵 안으로 넣고 같은 층의 맨 위에 올린다 */
export function placeItem(b: LayoutBoard, config: LayoutConfig, n: NewItem, snap = true, id: string = newItemId()): { board: LayoutBoard; id: string } | { error: string } {
  if (b.items.length >= MAX_ITEMS) return { error: `항목은 ${MAX_ITEMS}개까지 놓을 수 있어요.` };
  if (!config.layers.some((l) => l.id === n.layer)) return { error: "없는 층이에요." };
  const name = n.name.trim();

  if (!NAME_RE.test(name)) return { error: "이름은 1~80자(특수 기호 제외)예요." };
  const item: LayoutItem = { id, name, artId: n.artId ?? "", layer: n.layer, x: 0, y: 0, w: Math.min(64, Math.max(1, Math.round(n.w ?? 1))), h: Math.min(64, Math.max(1, Math.round(n.h ?? 1))), rot: 0, flip: false, z: topZ(b, n.layer) + 1, fixed: false };
  const p = clampPos(item, b, n.x, n.y, stepOf(config, snap));

  item.x = p.x;
  item.y = p.y;

  return { board: withItems(b, [...b.items, item]), id };
}

export function moveItem(b: LayoutBoard, config: LayoutConfig, id: string, x: number, y: number, snap = true): LayoutBoard {
  return mapItem(b, id, (it) => (it.fixed ? it : { ...it, ...clampPos(it, b, x, y, stepOf(config, snap)) }));
}

/** 시계 방향으로 90도. 맵 밖으로 나가면 안으로 당긴다 */
export function rotateItem(b: LayoutBoard, id: string): LayoutBoard {
  return mapItem(b, id, (it) => {
    if (it.fixed) return it;
    const next = { ...it, rot: ROTS[(ROTS.indexOf(it.rot) + 1) % 4] };

    return { ...next, ...clampPos(next, b, it.x, it.y, 0.25) };
  });
}

export const flipItem = (b: LayoutBoard, id: string): LayoutBoard => mapItem(b, id, (it) => (it.fixed ? it : { ...it, flip: !it.flip }));
export const lockItem = (b: LayoutBoard, id: string, fixed: boolean): LayoutBoard => mapItem(b, id, (it) => ({ ...it, fixed }));
export const removeItem = (b: LayoutBoard, id: string): LayoutBoard => withItems(b, b.items.filter((it) => it.id !== id || it.fixed));
export const renameItem = (b: LayoutBoard, id: string, name: string): LayoutBoard => (NAME_RE.test(name.trim()) ? mapItem(b, id, (it) => (it.fixed ? it : { ...it, name: name.trim() })) : b);

/** 층 바꾸기: 옮겨 간 층의 맨 위로 */
export function setItemLayer(b: LayoutBoard, config: LayoutConfig, id: string, layer: string): LayoutBoard {
  if (!config.layers.some((l) => l.id === layer)) return b;
  const top = topZ(b, layer) + 1;

  return mapItem(b, id, (it) => (it.fixed || it.layer === layer ? it : { ...it, layer, z: top }));
}

export type ZMove = "front" | "back" | "forward" | "backward";

/** 겹침 순서: 같은 층 안에서 한 칸 위/아래 또는 맨 위/맨 아래. 순서는 0부터 다시 번호를 매긴다 */
export function moveZ(b: LayoutBoard, id: string, move: ZMove): LayoutBoard {
  const target = b.items.find((it) => it.id === id);

  if (!target || target.fixed) return b;
  const sameLayer = b.items.filter((it) => it.layer === target.layer).sort((p, q) => p.z - q.z || b.items.indexOf(p) - b.items.indexOf(q));
  const order = sameLayer.map((it) => it.id);
  const i = order.indexOf(id);

  order.splice(i, 1);
  const j = move === "front" ? order.length : move === "back" ? 0 : move === "forward" ? Math.min(order.length, i + 1) : Math.max(0, i - 1);

  order.splice(j, 0, id);
  const zOf = new Map(order.map((oid, k) => [oid, k]));

  return withItems(b, b.items.map((it) => (zOf.has(it.id) ? { ...it, z: zOf.get(it.id)! } : it)));
}

/** 같은 층에서 칸이 겹치는 항목 id (맞닿기만 한 것은 겹침 아님). 잠금 항목끼리는 보지 않는다 */
export function overlappingIds(b: LayoutBoard): Set<string> {
  const out = new Set<string>();
  const list = b.items.map((it) => ({ it, f: footprint(it) }));

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const c = list[j];

      if (a.it.layer !== c.it.layer || (a.it.fixed && c.it.fixed)) continue;
      if (a.it.x < c.it.x + c.f.w && c.it.x < a.it.x + a.f.w && a.it.y < c.it.y + c.f.h && c.it.y < a.it.y + a.f.h) {
        out.add(a.it.id);
        out.add(c.it.id);
      }
    }
  }

  return out;
}

/** 놓을 첫 빈자리(같은 층, 왼쪽 위부터). 없으면 0,0 */
export function firstFreeCell(b: LayoutBoard, layer: string, w: number, h: number): { x: number; y: number } {
  const taken = b.items.filter((it) => it.layer === layer).map((it) => ({ x: it.x, y: it.y, ...footprint(it) }));

  for (let y = 0; y + h <= b.rows; y++) {
    for (let x = 0; x + w <= b.cols; x++) {
      if (!taken.some((t) => x < t.x + t.w && t.x < x + w && y < t.y + t.h && t.y < y + h)) return { x, y };
    }
  }

  return { x: 0, y: 0 };
}

// ───────── 되돌리기 기록 ─────────

export interface UndoState {
  past: LayoutBoard[];
  present: LayoutBoard;
  future: LayoutBoard[];
}

export const createUndo = (b: LayoutBoard): UndoState => ({ past: [], present: b, future: [] });

export function pushUndo(s: UndoState, next: LayoutBoard): UndoState {
  if (boardsEqual(s.present, next)) return s;

  return { past: [...s.past, s.present].slice(-UNDO_LIMIT), present: next, future: [] };
}

export const undo = (s: UndoState): UndoState => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s);
export const redo = (s: UndoState): UndoState => (s.future.length ? { past: [...s.past, s.present].slice(-UNDO_LIMIT), present: s.future[0], future: s.future.slice(1) } : s);

// ───────── 내보내기·불러오기 형식 ─────────

export interface HubItem {
  id: string;
  kind: "prop";
  name: string;
  x: number;
  y: number;
  flip: boolean;
  fixed: boolean;
}
export interface HubLayout {
  version: 1;
  room: { cols: number; rows: number };
  items: HubItem[];
}

export interface ExportResult {
  format: LayoutFormat;
  schema: string;
  json: unknown;
  count: number;
  warnings: string[];
}

const HUB_NAME_RE = /^[A-Za-z0-9_-]{1,80}$/;

const orderedItems = (b: LayoutBoard, config: LayoutConfig): LayoutItem[] => {
  const layerIndex = new Map(config.layers.map((l, i) => [l.id, i]));

  return [...b.items].sort((p, q) => (layerIndex.get(p.layer) ?? 0) - (layerIndex.get(q.layer) ?? 0) || p.z - q.z);
};

/** 설정한 형식으로 바꾼다. 형식에 담을 수 없는 항목·정보는 빼고 경고로 알린다 */
export function exportBoard(b: LayoutBoard, config: LayoutConfig): ExportResult {
  const warnings: string[] = [];
  const layerOk = (it: LayoutItem) => !config.exportLayers.length || config.exportLayers.includes(it.layer);
  const picked = orderedItems(b, config).filter(layerOk);
  const skippedLayers = b.items.length - picked.length;

  if (skippedLayers > 0) warnings.push(`내보낼 층이 아닌 항목 ${skippedLayers}개는 보내지 않아요.`);
  if (config.format === "studio-layout-v1") {
    const json = {
      schema: config.schema,
      version: 1,
      shape: config.shape,
      cell: config.cell,
      cols: b.cols,
      rows: b.rows,
      layers: config.layers.filter((l) => !config.exportLayers.length || config.exportLayers.includes(l.id)),
      items: picked.map((it) => ({ id: it.id, name: it.name, art: it.artId || undefined, layer: it.layer, x: it.x, y: it.y, w: it.w, h: it.h, rot: it.rot, flip: it.flip, z: it.z, fixed: it.fixed })),
    };

    return { format: config.format, schema: config.schema, json, count: picked.length, warnings };
  }
  // hub-layout-v1: 정수 칸 좌표, 회전·층·겹침 순서 없음, 이름은 게임 그림 이름 규칙
  const items: HubItem[] = [];
  let rotDropped = 0;

  for (const it of picked) {
    if (!HUB_NAME_RE.test(it.name)) {
      warnings.push(`'${it.name}' 은 게임 그림 이름 규칙(영문·숫자·_·-)에 맞지 않아 뺐어요.`);
      continue;
    }
    if (!Number.isInteger(it.x) || !Number.isInteger(it.y)) {
      warnings.push(`'${it.name}' 의 위치가 칸에 맞지 않아(소수) 뺐어요. 칸 맞춤으로 다시 놓아 주세요.`);
      continue;
    }
    const f = footprint(it);

    if (it.x + f.w > b.cols || it.y + f.h > b.rows) {
      warnings.push(`'${it.name}' 이 맵 밖이라 뺐어요.`);
      continue;
    }
    if (it.rot !== 0) rotDropped++;
    items.push({ id: it.id.slice(0, 40), kind: "prop", name: it.name, x: it.x, y: it.y, flip: it.flip, fixed: it.fixed });
  }
  if (rotDropped) warnings.push(`이 형식에는 회전이 없어서 회전한 ${rotDropped}개는 회전 없이 보내요.`);
  if (items.length > 500) {
    warnings.push("이 형식은 항목 500개까지예요. 넘는 항목은 뺐어요.");
    items.length = 500;
  }
  const json: HubLayout = { version: 1, room: { cols: b.cols, rows: b.rows }, items };

  return { format: config.format, schema: config.schema, json, count: items.length, warnings };
}

/** 새싹 허브 배치 JSON 을 공용 배치판으로. 게임이 읽는 모양이 아니면 이유를 돌려준다. 그림은 이름만 알고 있다(artId 는 비움) */
export function importHub(raw: unknown, config: LayoutConfig, layer: string = config.layers.find((l) => l.id === "decor")?.id ?? config.layers[config.layers.length - 1].id): { ok: true; board: LayoutBoard; warnings: string[] } | { ok: false; reason: string } {
  if (!isObj(raw)) return { ok: false, reason: "배치 JSON 이 객체가 아니에요." };
  if (raw.version !== 1) return { ok: false, reason: "배치 형식 버전이 1이 아니에요." };
  if (!isObj(raw.room) || raw.room.cols !== config.cols || raw.room.rows !== config.rows) return { ok: false, reason: `방 크기가 설정(${config.cols}×${config.rows})과 달라요.` };
  if (!Array.isArray(raw.items)) return { ok: false, reason: "items 가 목록이 아니에요." };
  const warnings: string[] = [];
  let board = emptyBoard(config);
  const used = new Set<string>();

  for (const it of raw.items) {
    if (!isObj(it) || it.kind !== "prop" || typeof it.name !== "string" || !HUB_NAME_RE.test(it.name) || typeof it.id !== "string" || !ID_RE.test(it.id) || used.has(it.id)) {
      warnings.push("읽을 수 없는 항목 1개는 건너뛰었어요.");
      continue;
    }
    if (typeof it.x !== "number" || typeof it.y !== "number" || !Number.isInteger(it.x) || !Number.isInteger(it.y) || it.x < 0 || it.y < 0 || it.x >= config.cols || it.y >= config.rows) {
      warnings.push(`'${it.name}' 의 위치가 맵 밖이라 건너뛰었어요.`);
      continue;
    }
    const placed = placeItem(board, config, { name: it.name, layer, x: it.x, y: it.y }, true, it.id);

    if ("error" in placed) {
      warnings.push(placed.error);
      break;
    }
    used.add(it.id);
    board = placed.board;
    board = mapItem(board, it.id, (cur) => ({ ...cur, flip: it.flip === true, fixed: it.fixed === true }));
  }

  return { ok: true, board, warnings };
}

/** 어느 형식이든 알아보고 공용 배치판으로: hub 모양(room/kind=prop) 또는 studio-layout-v1 */
export function importAny(raw: unknown, config: LayoutConfig): { ok: true; board: LayoutBoard; warnings: string[] } | { ok: false; reason: string } {
  if (isObj(raw) && isObj(raw.layout) && raw.layout !== raw) return importAny(raw.layout, config); // 서비스가 { layout, version } 로 감싸 준 경우
  if (isObj(raw) && isObj(raw.room)) return importHub(raw, config);
  if (!isObj(raw) || !Array.isArray(raw.items)) return { ok: false, reason: "알 수 없는 배치 형식이에요." };
  const items = raw.items.map((it) => {
    const o = isObj(it) ? it : {};
    const layer = typeof o.layer === "string" && config.layers.some((l) => l.id === o.layer) ? o.layer : config.layers[0].id;

    return { id: o.id, name: o.name, artId: typeof o.art === "string" ? o.art : "", layer, x: o.x, y: o.y, w: o.w ?? 1, h: o.h ?? 1, rot: o.rot ?? 0, flip: o.flip === true, z: o.z ?? 0, fixed: o.fixed === true };
  });
  const cleaned = cleanBoard({ version: 1, cols: raw.cols ?? config.cols, rows: raw.rows ?? config.rows, items }, config);

  return cleaned.ok === false ? { ok: false, reason: cleaned.reason } : { ok: true, board: cleaned.board, warnings: [] };
}

/** 내보내기 결과를 파일 글자로(들여쓰기 2칸, 끝에 줄바꿈) */
export const toFileText = (json: unknown): string => `${JSON.stringify(json, null, 2)}\n`;

export const MAX_EXPORT_PLAN_JSON = 50 * 1024;

/** 앱 폴더로 보낼 때 쓰는 앱 수정 일감 지시문: 파일 하나를 이 내용으로 쓴다 */
export function buildLayoutPlan(args: { appSlug: string; path: string; version: number; schema: string; fileText: string; warnings: readonly string[] }): string {
  return [
    `# 스튜디오 배치 ${args.version}판을 앱 폴더에 반영 (${args.appSlug})`,
    "",
    `스튜디오 배치 편집기에서 내보낸 배치 파일(스키마 ${args.schema})을 앱 폴더의 \`${args.path}\` 파일 한 개에 아래 내용 그대로 씁니다. 이 파일은 배치 데이터 전용이라 덮어써도 됩니다. 목록에 없는 일은 하지 않습니다.`,
    "",
    "## 파일 내용",
    "```json",
    args.fileText.trimEnd(),
    "```",
    "",
    "## 규칙",
    `- \`${args.path}\` 한 파일만 바꿉니다. 소스 코드·설정·다른 에셋은 바꾸지 않습니다. 폴더가 없으면 만듭니다.`,
    "- 파일에 `fixed: true` 인 줄이 있으면 그대로 둡니다(바꾸지 않음).",
    "- 앱 안에 이 파일을 검사하는 시험이 있으면 실행하고 결과를 적습니다. 검사는 빌드(또는 해당 시험)만 하고 e2e 스크린샷은 찍지 않습니다.",
    "- 끝나면 바꾼 파일과 검사 결과를 결과에 적습니다.",
    ...(args.warnings.length ? ["", "## 내보내기 경고(참고)", ...args.warnings.map((w) => `- ${w}`)] : []),
  ].join("\n");
}
