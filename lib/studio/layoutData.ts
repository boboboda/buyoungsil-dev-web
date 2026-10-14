// lib/studio/layoutData.ts
// 공용 스튜디오 [제작] > [배치] 편집기의 읽기·쓰기(서버 전용, 3-4). 계산·형식 변환은 lib/studio/layout.ts.
// - 저장: 저장할 때마다 새 판(판 번호 +1)을 홈페이지 DB(factory_layout_boards)에 쌓는다. 같은 내용을 다시 저장하면 판을 올리지 않는다. 판 번호가 어긋나면(다른 곳에서 먼저 저장) 거절한다.
// - 불러오기: 서비스의 기존 배치를 읽어(GET, 설정한 경로) 또는 붙여 넣은 JSON 을 공용 형식으로 바꿔 새 판으로 저장한다. 서비스 쪽은 읽기만 한다.
// - 내보내기: 설정한 형식으로 바꾼 뒤 3-3 내보내기와 같은 길로 보낸다 — 앱 폴더면 앱 수정 일감 1건, 서비스 API 면 호출. 앱 폴더·서비스 DB 는 직접 건드리지 않는다.
import { randomBytes } from "node:crypto";

import prisma from "@/lib/prisma";
import { enqueueWithId } from "@/lib/factory/mcp";
import { exportStatus, serviceBase } from "@/lib/studio/opsData";
import {
  boardsEqual,
  buildLayoutPlan,
  cleanBoard,
  exportBoard,
  HISTORY_KEEP,
  importAny,
  MAX_EXPORT_PLAN_JSON,
  readLayoutConfig,
  toFileText,
  type LayoutBoard,
  type LayoutConfig,
} from "@/lib/studio/layout";
import { callServiceApi, type ServiceCallDeps } from "@/lib/studio/service";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const STUDIO_SOURCE = "스튜디오";
const PALETTE_LIMIT = 300;
const HISTORY_SHOWN = 30;
const SERVICE_LAYOUT_MAX = 96 * 1024;

export interface LayoutPaletteArt {
  id: string;
  subject: string;
  kind: string;
  url: string;
}

export interface LayoutHistoryRow {
  version: number;
  source: string;
  note: string;
  who: string;
  itemCount: number;
  createdAt: string;
  exportStatus: string;
  exportDest: string;
  exportNote: string;
  exportedAt: string | null;
  exportJobId: string | null;
}

export interface LayoutData {
  appSlug: string;
  config: LayoutConfig | null;
  version: number; // 0 = 저장된 판 없음
  board: LayoutBoard | null;
  history: LayoutHistoryRow[]; // 최신 판이 먼저
  palette: LayoutPaletteArt[];
}

export type LayoutResult = { ok: true; message: string; version?: number; warnings?: string[]; jobId?: string } | { ok: false; status: number; message: string; currentVersion?: number };

const fail = (status: number, message: string, currentVersion?: number): LayoutResult => ({ ok: false, status, message, ...(currentVersion === undefined ? {} : { currentVersion }) });
const newId = () => `lay_${randomBytes(10).toString("hex")}`;
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

async function readConfig(appSlug: string): Promise<{ config: LayoutConfig | null; domain: string | null }> {
  const row = await prisma.factoryAppConnection.findUnique({ where: { appSlug }, select: { layoutConfig: true, domain: true } });

  return { config: readLayoutConfig(row?.layoutConfig), domain: row?.domain ?? null };
}

function parseStoredBoard(text: string, config: LayoutConfig): LayoutBoard | null {
  try {
    const r = cleanBoard(JSON.parse(text), config);

    return r.ok ? r.board : null;
  } catch {
    return null;
  }
}

/** 화면이 쓰는 자료: 설정 · 최신 판 · 이력 · 놓을 수 있는 승인 그림 */
export async function readLayoutData(appSlug: string): Promise<LayoutData | null> {
  if (!SLUG_RE.test(appSlug)) return null;
  const { config } = await readConfig(appSlug);
  const [latest, rows, arts] = await Promise.all([
    prisma.factoryLayoutBoard.findFirst({ where: { appSlug }, orderBy: { version: "desc" } }),
    prisma.factoryLayoutBoard.findMany({ where: { appSlug }, orderBy: { version: "desc" }, take: HISTORY_SHOWN, select: { version: true, source: true, note: true, who: true, itemCount: true, createdAt: true, exportStatus: true, exportDest: true, exportNote: true, exportedAt: true, exportJobId: true } }),
    prisma.factoryArt.findMany({ where: { appSlug, status: "approved" }, orderBy: { decidedAt: "desc" }, select: { id: true, subject: true, kind: true, url: true }, take: PALETTE_LIMIT }),
  ]);
  const jobIds = [...new Set(rows.map((r) => r.exportJobId).filter((x): x is string => !!x))];
  const jobs = jobIds.length ? await prisma.factoryJob.findMany({ where: { id: { in: jobIds } }, select: { id: true, status: true } }) : [];
  const jobStatus = new Map(jobs.map((j) => [j.id, j.status]));
  const kinds = config?.allowedKinds ?? [];

  return {
    appSlug,
    config,
    version: latest?.version ?? 0,
    board: latest && config ? parseStoredBoard(latest.board, config) : null,
    history: rows.map((r) => ({ version: r.version, source: r.source, note: r.note, who: r.who, itemCount: r.itemCount, createdAt: iso(r.createdAt)!, exportStatus: exportStatus(r.exportStatus, r.exportJobId ? jobStatus.get(r.exportJobId) : undefined), exportDest: r.exportDest, exportNote: r.exportNote, exportedAt: iso(r.exportedAt), exportJobId: r.exportJobId })),
    palette: arts.filter((a) => !kinds.length || kinds.includes(a.kind)),
  };
}

// ───────── 저장 ─────────

async function writeVersion(appSlug: string, board: LayoutBoard, baseVersion: number, who: string, note: string, source: "editor" | "import" | "restore"): Promise<LayoutResult> {
  const latest = await prisma.factoryLayoutBoard.findFirst({ where: { appSlug }, orderBy: { version: "desc" }, select: { version: true, board: true } });
  const current = latest?.version ?? 0;

  if (baseVersion !== current) return fail(409, `다른 곳에서 먼저 저장했어요(지금 ${current}판). 화면을 새로 열어 확인한 뒤 다시 저장해 주세요.`, current);
  if (latest && source === "editor") {
    let same = false;

    try {
      same = boardsEqual(JSON.parse(latest.board) as LayoutBoard, board);
    } catch {
      same = false;
    }
    if (same) return { ok: true, version: current, message: `바뀐 내용이 없어서 ${current}판 그대로예요.` };
  }
  const next = current + 1;

  try {
    await prisma.factoryLayoutBoard.create({ data: { id: newId(), appSlug, version: next, board: JSON.stringify(board), itemCount: board.items.length, source, note: note.slice(0, 200), who: who.slice(0, 80) } });
  } catch {
    return fail(409, "동시에 저장이 일어났어요. 화면을 새로 열어 다시 저장해 주세요.", current);
  }
  await prisma.factoryLayoutBoard.deleteMany({ where: { appSlug, version: { lte: next - HISTORY_KEEP } } }).catch(() => undefined);

  return { ok: true, version: next, message: `${next}판으로 저장했어요(항목 ${board.items.length}개).` };
}

export async function saveLayout(appSlug: string, rawBoard: unknown, baseVersion: unknown, who: string, note = ""): Promise<LayoutResult> {
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) return fail(400, "판 번호(baseVersion)가 올바르지 않아요.");
  const { config } = await readConfig(appSlug);

  if (!config) return fail(400, "배치 설정이 없어요. 통제실의 프로젝트 연결 설정에서 '배치 설정'을 먼저 정해 주세요.");
  const cleaned = cleanBoard(rawBoard, config);

  if (cleaned.ok === false) return fail(400, cleaned.reason);

  return writeVersion(appSlug, cleaned.board, baseVersion, who, note, "editor");
}

/** 옛 판의 내용을 새 판으로 다시 저장(이력은 지우지 않는다) */
export async function restoreLayout(appSlug: string, version: unknown, baseVersion: unknown, who: string): Promise<LayoutResult> {
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return fail(400, "되돌릴 판 번호가 올바르지 않아요.");
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) return fail(400, "판 번호(baseVersion)가 올바르지 않아요.");
  const { config } = await readConfig(appSlug);

  if (!config) return fail(400, "배치 설정이 없어요.");
  const row = await prisma.factoryLayoutBoard.findUnique({ where: { appSlug_version: { appSlug, version } } });

  if (!row) return fail(404, `${version}판이 없어요(오래된 판은 ${HISTORY_KEEP}판까지만 남아요).`);
  const board = parseStoredBoard(row.board, config);

  if (!board) return fail(400, `${version}판은 지금 배치 설정과 맞지 않아 되돌릴 수 없어요(맵 크기나 층이 바뀜).`);
  const r = await writeVersion(appSlug, board, baseVersion, who, `${version}판으로 되돌림`, "restore");

  return r.ok ? { ...r, message: `${version}판 내용을 ${r.version}판으로 저장했어요.` } : r;
}

// ───────── 불러오기 ─────────

/** 기존 배치를 공용 편집기의 새 판으로. json 이 있으면 그것을, 없으면 설정한 서비스 경로(GET)를 읽는다. 서비스 쪽은 바꾸지 않는다 */
export async function importLayout(appSlug: string, input: { json?: unknown; fromService?: boolean }, baseVersion: unknown, who: string, deps: { serviceDeps?: ServiceCallDeps } = {}): Promise<LayoutResult> {
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) return fail(400, "판 번호(baseVersion)가 올바르지 않아요.");
  const { config, domain } = await readConfig(appSlug);

  if (!config) return fail(400, "배치 설정이 없어요. 통제실의 프로젝트 연결 설정에서 '배치 설정'을 먼저 정해 주세요.");
  let raw = input.json;
  let from = "붙여 넣은 JSON";

  if (raw === undefined) {
    if (!input.fromService) return fail(400, "불러올 내용이 없어요.");
    if (!config.importPath) return fail(400, "불러올 서비스 API 경로가 설정에 없어요(배치 설정의 '기존 배치 불러올 곳').");
    const base = await serviceBase(appSlug, domain);
    const res = await callServiceApi({ appSlug, auth: "admin", method: "GET", path: config.importPath }, base, deps.serviceDeps, undefined, SERVICE_LAYOUT_MAX);

    if (res.state === "need-key") return fail(400, `키 등록 필요: ${res.keyName} (서버 보관 키로 등록해 주세요). 급하면 서비스의 배치 JSON 을 복사해 붙여 넣으면 같은 일을 할 수 있어요.`);
    if (res.state === "no-api") return fail(404, "서비스에 그 API 가 없어요(404). 경로 설정을 확인하거나 배치 JSON 을 붙여 넣어 주세요.");
    if (res.state === "blocked" || res.state === "error") return fail(502, `서비스에서 읽지 못했어요 — ${res.reason}`);
    const d = res.data as Record<string, unknown> | null;

    if (!d || typeof d !== "object") return fail(502, "서비스 응답 형식이 올바르지 않아요.");
    if (d.layout === null) return fail(404, "서비스에 저장된 배치가 아직 없어요(layout: null).");
    raw = d.layout ?? d;
    from = `서비스(${config.importPath})${typeof d.version === "number" ? ` ${d.version}판` : ""}`;
  }
  const imported = importAny(raw, config);

  if (imported.ok === false) return fail(400, `불러오지 못했어요 — ${imported.reason}`);
  const saved = await writeVersion(appSlug, imported.board, baseVersion, who, `${from}에서 불러옴`, "import");

  if (!saved.ok) return saved;
  const warn = imported.warnings.length ? ` (${[...new Set(imported.warnings)].slice(0, 3).join(" / ")})` : "";

  return { ok: true, version: saved.version, warnings: imported.warnings, message: `${from}에서 ${imported.board.items.length}개를 불러와 ${saved.version}판으로 저장했어요.${warn}` };
}

// ───────── 내보내기 ─────────

/** 저장된 판 하나를 설정한 형식·곳으로 보낸다. version 이 없으면 최신 판 */
export async function exportLayout(appSlug: string, version: unknown, who: string, deps: { serviceDeps?: ServiceCallDeps } = {}): Promise<LayoutResult> {
  const { config, domain } = await readConfig(appSlug);

  if (!config) return fail(400, "배치 설정이 없어요.");
  if (config.dest.kind === "none") return fail(400, "내보낼 곳이 정해져 있지 않아요. 프로젝트 연결 설정의 '배치 설정'에서 앱 폴더 경로나 서비스 API 를 정해 주세요.");
  const row = typeof version === "number" ? await prisma.factoryLayoutBoard.findUnique({ where: { appSlug_version: { appSlug, version } } }) : await prisma.factoryLayoutBoard.findFirst({ where: { appSlug }, orderBy: { version: "desc" } });

  if (!row) return fail(404, "내보낼 저장된 판이 없어요. 먼저 저장해 주세요.");
  const board = parseStoredBoard(row.board, config);

  if (!board) return fail(400, `${row.version}판은 지금 배치 설정과 맞지 않아 내보낼 수 없어요.`);
  const out = exportBoard(board, config);

  if (!out.count) return fail(400, `내보낼 항목이 없어요.${out.warnings.length ? ` (${out.warnings[0]})` : ""}`);
  const dest = config.dest.path;
  const mark = (data: { exportStatus: string; exportJobId?: string; exportNote?: string }) =>
    prisma.factoryLayoutBoard.update({ where: { appSlug_version: { appSlug, version: row.version } }, data: { exportDest: dest, exportedAt: new Date(), exportNote: (data.exportNote ?? "").slice(0, 200), exportStatus: data.exportStatus, exportJobId: data.exportJobId ?? null } });

  if (config.dest.kind === "folder") {
    if (row.exportStatus === "requested" && row.exportDest === dest) {
      const st = row.exportJobId ? (await prisma.factoryJob.findUnique({ where: { id: row.exportJobId }, select: { status: true } }))?.status : undefined;

      if (exportStatus(row.exportStatus, st) === "requested") return fail(409, `${row.version}판은 이미 앱 수정 일감으로 보냈어요(승인 기다리는 중이거나 작업 중).`);
    }
    const fileText = toFileText(out.json);

    if (fileText.length > MAX_EXPORT_PLAN_JSON) return fail(413, "배치 파일이 너무 커서 일감 하나에 담을 수 없어요. 항목을 줄이거나 서비스 API 로 보내 주세요.");
    const r = await enqueueWithId({ appSlug, title: `배치 ${row.version}판 앱 폴더에 반영`, kind: "revision", planMarkdown: buildLayoutPlan({ appSlug, path: dest, version: row.version, schema: out.schema, fileText, warnings: out.warnings }), source: STUDIO_SOURCE });

    if (r.isError || !r.jobId) return fail(409, (r.content[0]?.text ?? "앱 수정 일감을 만들지 못했어요.").slice(0, 300));
    await mark({ exportStatus: "requested", exportJobId: r.jobId });

    return { ok: true, version: row.version, jobId: r.jobId, warnings: out.warnings, message: `${row.version}판을 ${out.schema} 형식(${out.count}개)으로 바꿔 앱 수정 일감 1건을 등록했어요(→ ${dest}). 승인하면 작업 PC가 파일을 씁니다.${out.warnings.length ? ` 경고 ${out.warnings.length}건: ${out.warnings[0]}` : ""}` };
  }
  // 서비스 API: 지금 서비스 쪽 판 번호를 읽고(GET) 그 번호를 기준으로 쓴다(PUT { layout, baseVersion })
  const base = await serviceBase(appSlug, domain);
  const api = { appSlug, auth: "admin" as const, path: config.dest.path };
  const cur = await callServiceApi({ ...api, method: "GET" }, base, deps.serviceDeps, undefined, SERVICE_LAYOUT_MAX);

  if (cur.state !== "ok") {
    const text = cur.state === "need-key" ? `키 등록 필요: ${cur.keyName}` : cur.state === "no-api" ? "서비스에 API 없음" : cur.reason;

    await mark({ exportStatus: cur.state === "no-api" ? "unsupported" : "failed", exportNote: text });

    return fail(cur.state === "no-api" ? 501 : 502, cur.state === "no-api" ? "서비스 API 미지원 — 서비스에 그 경로가 없어요. 내보낼 곳을 앱 폴더 경로로 바꾸면 앱 수정 일감으로 보낼 수 있어요." : `서비스로 보내지 못했어요 — ${text}`);
  }
  const remote = cur.data as { version?: unknown } | null;
  const remoteVersion = typeof remote?.version === "number" && Number.isInteger(remote.version) ? remote.version : 0;
  const put = await callServiceApi({ ...api, method: "PUT" }, base, deps.serviceDeps, { layout: out.json, baseVersion: remoteVersion }, SERVICE_LAYOUT_MAX);

  if (put.state !== "ok") {
    const text = put.state === "need-key" ? `키 등록 필요: ${put.keyName}` : put.state === "no-api" ? "서비스에 API 없음" : put.reason;

    await mark({ exportStatus: "failed", exportNote: text });

    return fail(502, `서비스로 보내지 못했어요 — ${text}`);
  }
  await mark({ exportStatus: "done" });

  return { ok: true, version: row.version, warnings: out.warnings, message: `${row.version}판을 ${out.schema} 형식(${out.count}개)으로 바꿔 서비스(${dest})로 보냈어요.${out.warnings.length ? ` 경고 ${out.warnings.length}건: ${out.warnings[0]}` : ""}` };
}
