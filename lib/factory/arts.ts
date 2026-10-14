// lib/factory/arts.ts
// 도트 그림 저장소: pixel-art 가 만든 그림은 '후보' → 관리자가 스튜디오에서 보고 [승인]/[반려] → '승인'된 것만 이후 참고 그림으로 자동 전달된다.
// - 후보·반려 그림은 자동 참고(references.approved)에 절대 들어가지 않는다. 자동 목록은 approvedEntries() 한 곳에서만 만든다.
// - 툴킷(game-toolkit pixel-art)이 받는 입력: settings.references.approved: [{ path(URL 가능), subject?, kind?, project? }] 와 요청 refs(쉼표, URL).
//   참고 그림 고르는 순서(툴킷): ①요청 refs(picked) ②같은 프로젝트·같은 대상 이름(별칭 포함) 승인 그림 ③같은 결과 종류 승인 그림 ④없으면 프롬프트만, 합쳐서 최대 4장.
//   selectReferences() 는 그 규칙을 그대로 옮긴 미리보기·시험용이다(실제로 고르는 쪽은 툴킷).
// - 이 파일은 DB 모양(ArtDb)만 알고 prisma 를 직접 부르지 않는다(시험에서 가짜 DB 를 쓰려고).
import { RESULT_KINDS, RESULT_KIND_LABELS, type ResultKind } from "@/lib/factory/projectToolSettings";

export const ART_STATUSES = ["candidate", "approved", "rejected"] as const;
export type ArtStatus = (typeof ART_STATUSES)[number];
export const ART_STATUS_LABELS: Record<ArtStatus, string> = { candidate: "후보", approved: "승인", rejected: "반려" };
export const ART_KINDS = RESULT_KINDS;
export { RESULT_KIND_LABELS };

export const MAX_REFS = 4; // 툴킷 REFS_MAX
export const MAX_AUTO_ENTRIES = 24; // 일감에 내려 주는 승인 그림 목록 상한(설정 파일 16KB 안에 들어가게)
export const MAX_ARTS_PER_JOB = 12; // 한 일감이 올릴 수 있는 후보 수
export const MAX_NOTE = 200;
export const MAX_SUBJECT = 60;
export const MAX_SUMMARY_BYTES = 2000;
export const ART_PICKS_PREFIX = "art-picks:"; // FactorySetting 키: art-picks:<jobId> → JSON ["artId", ...]

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const METHOD_RE = /^[a-z][a-z0-9_]{0,39}$/;

export interface ArtRow {
  id: string;
  appSlug: string;
  subject: string;
  kind: string;
  status: string;
  url: string;
  method: string;
  summary: string;
  jobId: string | null;
  srcKey: string;
  createdAt: Date;
  decidedBy: string;
  decidedAt: Date | null;
  note: string;
}

/** 화면·API 로 나가는 모양(날짜는 ISO 글자) */
export interface ArtView {
  id: string;
  appSlug: string;
  subject: string;
  kind: ResultKind;
  status: ArtStatus;
  url: string;
  method: string;
  summary: ArtSummary | null;
  jobId: string | null;
  createdAt: string;
  decidedBy: string;
  decidedAt: string | null;
  note: string;
}

export interface ArtSummary {
  steps: string[]; // 실행한 내부 단계 도구 이름
  refs: string[]; // 참고 그림 고른 이유(①picked …)
  refsFallback: string;
  cost: number; // PixelLab 호출 수
}

export interface ArtDb {
  factoryArt: {
    findUnique(args: { where: { id: string } | { srcKey: string } }): Promise<ArtRow | null>;
    findMany(args: { where: { appSlug?: string; status?: string; id?: { in: string[] }; jobId?: string }; orderBy?: Record<string, "asc" | "desc">; take?: number }): Promise<ArtRow[]>;
    count(args: { where: { jobId: string } }): Promise<number>;
    create(args: { data: Omit<ArtRow, "id" | "createdAt" | "decidedBy" | "decidedAt" | "note"> & Partial<Pick<ArtRow, "decidedBy" | "decidedAt" | "note">> }): Promise<ArtRow>;
    update(args: { where: { id: string }; data: Partial<Pick<ArtRow, "status" | "decidedBy" | "decidedAt" | "note">> }): Promise<ArtRow>;
  };
}

const oneLine = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export const isArtKind = (v: unknown): v is ResultKind => typeof v === "string" && (ART_KINDS as readonly string[]).includes(v);
export const isArtStatus = (v: unknown): v is ArtStatus => typeof v === "string" && (ART_STATUSES as readonly string[]).includes(v);
export const isHttpUrl = (v: unknown): v is string => typeof v === "string" && v.length <= 500 && /^https?:\/\/[^\s]+$/.test(v);

/** result.json 요약(감독 프로그램이 보낸 것)을 정리해서 JSON 글자로. 프롬프트·경로·키는 담지 않는다 */
export function cleanSummary(raw: unknown): string {
  let v: unknown = raw;

  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return "";
    }
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "";
  const o = v as Record<string, unknown>;
  const list = (x: unknown, re: RegExp, n: number) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && re.test(s)).slice(0, n) : []);
  const cost = typeof o.cost === "number" && Number.isFinite(o.cost) && o.cost >= 0 ? Math.min(Math.floor(o.cost), 100000) : 0;
  const out: ArtSummary = { steps: list(o.steps, /^[A-Za-z0-9_.-]{1,40}$/, 12), refs: list(o.refs, /^[①②③④A-Za-z0-9_-]{1,24}$/, 8), refsFallback: oneLine(o.refsFallback, 100), cost };
  const text = JSON.stringify(out);

  return Buffer.byteLength(text, "utf8") <= MAX_SUMMARY_BYTES ? text : "";
}

export function parseSummary(text: string): ArtSummary | null {
  if (!text) return null;
  try {
    const o = JSON.parse(text) as Partial<ArtSummary>;

    return { steps: Array.isArray(o.steps) ? o.steps : [], refs: Array.isArray(o.refs) ? o.refs : [], refsFallback: typeof o.refsFallback === "string" ? o.refsFallback : "", cost: typeof o.cost === "number" ? o.cost : 0 };
  } catch {
    return null;
  }
}

export function toArtView(r: ArtRow): ArtView {
  return {
    id: r.id,
    appSlug: r.appSlug,
    subject: r.subject,
    kind: isArtKind(r.kind) ? r.kind : "image-prop",
    status: isArtStatus(r.status) ? r.status : "candidate",
    url: r.url,
    method: r.method,
    summary: parseSummary(r.summary),
    jobId: r.jobId,
    createdAt: r.createdAt.toISOString(),
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    note: r.note,
  };
}

// ───────── 대상 이름 묶음 ─────────

/** 별칭(settings.aliases: { 대표이름: [별칭…] })을 대표 이름으로 합친다. 대소문자는 구분하지 않는다(툴킷 canonical_subject 와 같다) */
export function canonicalSubject(subject: string, aliases: unknown): string {
  const low = subject.trim().toLowerCase();

  if (aliases && typeof aliases === "object" && !Array.isArray(aliases)) {
    for (const [main, names] of Object.entries(aliases as Record<string, unknown>)) {
      if (low === main.toLowerCase() || (Array.isArray(names) && names.some((n) => String(n).toLowerCase() === low))) return main;
    }
  }

  return subject.trim();
}

const STATUS_ORDER: Record<string, number> = { approved: 0, candidate: 1, rejected: 2 };

/** 대상 이름(별칭은 대표 이름으로 묶음)별로 모은다. 승인 그림이 있는 대상이 위, 안에서는 승인 → 후보 → 반려, 새 것이 먼저 */
export function groupBySubject(arts: readonly ArtView[], aliases: unknown): { subject: string; arts: ArtView[] }[] {
  const map = new Map<string, ArtView[]>();

  for (const a of arts) {
    const key = canonicalSubject(a.subject, aliases);

    map.set(key, [...(map.get(key) ?? []), a]);
  }
  const groups = [...map.entries()].map(([subject, list]) => ({
    subject,
    arts: [...list].sort((x, y) => (STATUS_ORDER[x.status] ?? 9) - (STATUS_ORDER[y.status] ?? 9) || y.createdAt.localeCompare(x.createdAt)),
  }));

  return groups.sort((x, y) => Number(y.arts.some((a) => a.status === "approved")) - Number(x.arts.some((a) => a.status === "approved")) || x.subject.localeCompare(y.subject));
}

// ───────── 자동 참고 목록 ─────────

export interface ApprovedEntry {
  url: string;
  subject: string;
  kind: ResultKind;
  approvedAt: string; // ISO
}

/** 자동 참고 대상 = '승인'만(후보·반려는 절대 아님). 승인 시각이 새로운 것부터 최대 MAX_AUTO_ENTRIES 개 */
export function approvedEntries(rows: readonly { status: string; url: string; subject: string; kind: string; decidedAt: Date | string | null; createdAt?: Date | string }[], limit = MAX_AUTO_ENTRIES): ApprovedEntry[] {
  const at = (r: { decidedAt: Date | string | null; createdAt?: Date | string }) => new Date(r.decidedAt ?? r.createdAt ?? 0).toISOString();

  return rows
    .filter((r) => r.status === "approved" && isHttpUrl(r.url) && isArtKind(r.kind) && r.subject)
    .map((r) => ({ url: r.url, subject: r.subject, kind: r.kind as ResultKind, approvedAt: at(r) }))
    .sort((a, b) => b.approvedAt.localeCompare(a.approvedAt))
    .slice(0, limit);
}

export interface SelectedRef {
  url: string;
  reason: "①picked" | "②subject" | "③kind";
}

/**
 * 툴킷 pick_refs 와 같은 규칙(미리보기·시험용): ① picked(요청이 고른 그림) 먼저 → ② 같은 대상 이름(별칭 묶음) 승인 그림 → ③ 같은 결과 종류 승인 그림.
 * 전체 최대 4장, 자동으로 붙이는 수는 settings.references.auto_max(기본 4) 까지, 같은 그림은 한 번만.
 */
export function selectReferences(opts: { picked?: readonly string[]; approved: readonly { url: string; subject?: string; kind?: string }[]; subject: string; kind: string; settings?: Record<string, unknown> | null }): SelectedRef[] {
  const refs: SelectedRef[] = [];
  const seen = new Set<string>();
  const add = (url: string, reason: SelectedRef["reason"]) => {
    if (refs.length >= MAX_REFS || seen.has(url)) return false;
    seen.add(url);
    refs.push({ url, reason });

    return true;
  };

  for (const u of opts.picked ?? []) add(u, "①picked");
  const references = (opts.settings?.references ?? {}) as Record<string, unknown>;
  const autoMax = typeof references.auto_max === "number" ? references.auto_max : MAX_REFS;
  const canon = canonicalSubject(opts.subject, opts.settings?.aliases);
  let auto = 0;

  for (const [want, reason] of [["subject", "②subject"], ["kind", "③kind"]] as const) {
    for (const e of opts.approved) {
      if (auto >= autoMax || refs.length >= MAX_REFS) break;
      const ok = want === "subject" ? !!e.subject && canonicalSubject(e.subject, opts.settings?.aliases) === canon : e.kind === opts.kind;

      if (ok && add(e.url, reason)) auto++;
    }
  }

  return refs;
}

/** 일감에 내려 주는 설정에 승인 그림을 합친다(감독 프로그램 toolbroker.mjs 의 mergeApprovedArts 와 같은 규칙): 승인 그림이 앞, 설정에 원래 있던 항목은 뒤. 같은 path 는 한 번만 */
export function mergeApprovedIntoSettings(settings: Record<string, unknown> | null | undefined, entries: readonly ApprovedEntry[]): Record<string, unknown> | null {
  if (!entries.length) return settings ?? null;
  const base = settings ?? { version: 1 };
  const references = (typeof base.references === "object" && base.references !== null && !Array.isArray(base.references) ? base.references : {}) as Record<string, unknown>;
  const stored = Array.isArray(references.approved) ? (references.approved as Record<string, unknown>[]) : [];
  const fromArts = entries.map((e) => ({ path: e.url, subject: e.subject, kind: e.kind }));
  const seen = new Set<string>();
  const approved = [...fromArts, ...stored].filter((e) => typeof e?.path === "string" && !seen.has(e.path as string) && !!seen.add(e.path as string));

  return { ...base, references: { ...references, approved } };
}

// ───────── 저장·승인 ─────────

export interface CandidateInput {
  appSlug: unknown;
  subject: unknown;
  kind: unknown;
  method?: unknown;
  summary?: unknown;
  url: unknown;
  jobId?: unknown;
  srcKey: unknown;
  /** 손으로 올리는 처음 값(jobId 없을 때만): 'approved' 로 바로 등록 */
  status?: unknown;
  note?: unknown;
  decidedBy?: unknown;
  /** 옛 그림을 가져올 때(jobId 없을 때만): 원래 만든 시각·승인 시각(ISO). 잘못된 값·미래 시각은 무시 */
  createdAt?: unknown;
  decidedAt?: unknown;
}

export type RegisterResult = { ok: true; art: ArtView; duplicate: boolean } | { ok: false; status: number; message: string };

/** 가져오는 그림의 원래 시각: 올바른 ISO(Z) 이고 2020년 이후·지금 이전일 때만 쓴다 */
export function originalTime(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v)) return null;
  const d = new Date(v);

  return Number.isNaN(d.getTime()) || d.getTime() < Date.UTC(2020, 0, 1) || d.getTime() > Date.now() ? null : d;
}

/** 후보 등록. 일감이 올리는 그림은 언제나 '후보'. 같은 srcKey 는 다시 만들지 않고 기존 것을 돌려준다 */
export async function registerArt(db: ArtDb, input: CandidateInput): Promise<RegisterResult> {
  const bad = (message: string, status = 400): RegisterResult => ({ ok: false, status, message });
  const appSlug = typeof input.appSlug === "string" ? input.appSlug.trim() : "";
  const subject = oneLine(input.subject, MAX_SUBJECT);
  const srcKey = typeof input.srcKey === "string" ? input.srcKey.trim() : "";
  const jobId = typeof input.jobId === "string" && input.jobId ? input.jobId : null;

  if (!SLUG_RE.test(appSlug)) return bad("appSlug 형식이 올바르지 않아요.");
  if (!subject) return bad("대상 이름이 비어 있어요.");
  if (!isArtKind(input.kind)) return bad("결과 종류가 올바르지 않아요.");
  if (!isHttpUrl(input.url)) return bad("그림 주소가 올바르지 않아요.");
  if (!srcKey || srcKey.length > 300 || /[\u0000-\u001f]/.test(srcKey)) return bad("srcKey 형식이 올바르지 않아요.");
  if (jobId && !ID_RE.test(jobId)) return bad("jobId 형식이 올바르지 않아요.");
  const method = typeof input.method === "string" && METHOD_RE.test(input.method) ? input.method : "";
  // 일감이 올리는 그림은 항상 후보. 승인으로 바로 등록하는 건 일감 없이 손으로 올리는 처음 값뿐
  const status: ArtStatus = !jobId && (input.status === "approved" || input.status === "candidate") ? input.status : "candidate";
  const existing = await db.factoryArt.findUnique({ where: { srcKey } });

  if (existing) return { ok: true, art: toArtView(existing), duplicate: true };
  if (jobId && (await db.factoryArt.count({ where: { jobId } })) >= MAX_ARTS_PER_JOB) return bad(`한 일감이 올릴 수 있는 그림은 ${MAX_ARTS_PER_JOB}장까지예요.`, 429);
  const decided = status === "approved";
  const row = await db.factoryArt.create({
    data: {
      appSlug,
      subject,
      kind: input.kind,
      status,
      url: input.url,
      method,
      summary: cleanSummary(input.summary),
      jobId,
      srcKey,
      note: oneLine(input.note, MAX_NOTE),
      ...(!jobId && originalTime(input.createdAt) ? { createdAt: originalTime(input.createdAt) as Date } : {}),
      ...(decided ? { decidedBy: oneLine(input.decidedBy, 80) || "처음 값", decidedAt: (!jobId && originalTime(input.decidedAt)) || new Date() } : {}),
    },
  });

  return { ok: true, art: toArtView(row), duplicate: false };
}

export async function listArts(db: ArtDb, appSlug: string, limit = 300): Promise<ArtView[]> {
  if (!SLUG_RE.test(appSlug)) return [];
  const rows = await db.factoryArt.findMany({ where: { appSlug }, orderBy: { createdAt: "desc" }, take: limit });

  return rows.map(toArtView);
}

export type DecideAction = "approve" | "reject" | "reset";

/** 상태 전환: 후보 ↔ 승인 ↔ 반려 (reset = 다시 후보). 승인자·시각을 남긴다 */
export async function decideArt(db: ArtDb, id: string, action: unknown, who: string): Promise<{ ok: true; art: ArtView } | { ok: false; status: number; message: string }> {
  if (!ID_RE.test(id)) return { ok: false, status: 400, message: "그림 id 가 올바르지 않아요." };
  if (action !== "approve" && action !== "reject" && action !== "reset") return { ok: false, status: 400, message: "approve · reject · reset 중 하나여야 해요." };
  const cur = await db.factoryArt.findUnique({ where: { id } });

  if (!cur) return { ok: false, status: 404, message: "없는 그림이에요." };
  const status: ArtStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "candidate";
  const row = await db.factoryArt.update({ where: { id }, data: status === "candidate" ? { status, decidedBy: "", decidedAt: null } : { status, decidedBy: oneLine(who, 80), decidedAt: new Date() } });

  return { ok: true, art: toArtView(row) };
}

export async function setArtNote(db: ArtDb, id: string, note: unknown): Promise<{ ok: true; art: ArtView } | { ok: false; status: number; message: string }> {
  if (!ID_RE.test(id)) return { ok: false, status: 400, message: "그림 id 가 올바르지 않아요." };
  if (typeof note !== "string" || note.length > MAX_NOTE * 2) return { ok: false, status: 400, message: `메모는 ${MAX_NOTE}자 이하 글자예요.` };
  if (!(await db.factoryArt.findUnique({ where: { id } }))) return { ok: false, status: 404, message: "없는 그림이에요." };

  return { ok: true, art: toArtView(await db.factoryArt.update({ where: { id }, data: { note: oneLine(note, MAX_NOTE) } })) };
}

/** 이 프로젝트의 승인 그림(자동 참고 목록 원본). 후보·반려는 없다 */
export async function approvedArtsFor(db: ArtDb, appSlug: string): Promise<ApprovedEntry[]> {
  if (!SLUG_RE.test(appSlug)) return [];

  return approvedEntries(await db.factoryArt.findMany({ where: { appSlug, status: "approved" }, orderBy: { decidedAt: "desc" }, take: 200 }));
}

/** [일감 보내기]에서 '참고로 고르기' 한 그림 id → 같은 프로젝트의 '승인' 그림만, 최대 4장, 고른 순서대로 */
export async function resolvePicked(db: ArtDb, appSlug: string, ids: unknown): Promise<ArtView[]> {
  if (!SLUG_RE.test(appSlug) || !Array.isArray(ids)) return [];
  const want = [...new Set(ids.filter((x): x is string => typeof x === "string" && ID_RE.test(x)))].slice(0, MAX_REFS);

  if (!want.length) return [];
  const rows = await db.factoryArt.findMany({ where: { appSlug, status: "approved", id: { in: want } } });

  return want.map((id) => rows.find((r) => r.id === id)).filter((r): r is ArtRow => !!r && isHttpUrl(r.url)).map(toArtView);
}

/** 일감 하나에 실을 picked 목록 모양(감독 프로그램으로 내려감) */
export interface PickedRef {
  url: string;
  subject: string;
  kind: ResultKind;
}

export const toPickedRefs = (arts: readonly ArtView[]): PickedRef[] => arts.map((a) => ({ url: a.url, subject: a.subject, kind: a.kind }));

// ───────── 일감에 실어 보내기 ─────────

export interface PickDb {
  factorySetting: {
    findMany(args: { where: { key: { in: string[] } } }): Promise<{ key: string; value: string }[]>;
    upsert(args: { where: { key: string }; create: { key: string; value: string }; update: { value: string } }): Promise<unknown>;
  };
}

/** 일감을 만들 때 고른 '참고로 고르기' 그림 id 를 일감에 묶어 둔다(FactorySetting art-picks:<jobId>). 일감 표는 바꾸지 않는다 */
export async function savePicks(db: PickDb, jobId: string, artIds: readonly string[]): Promise<void> {
  if (!ID_RE.test(jobId) || !artIds.length) return;
  const value = JSON.stringify(artIds.slice(0, MAX_REFS));

  await db.factorySetting.upsert({ where: { key: `${ART_PICKS_PREFIX}${jobId}` }, create: { key: `${ART_PICKS_PREFIX}${jobId}`, value }, update: { value } });
}

/** 시작하는 일감들의 picked 목록: jobId → [{ url, subject, kind }]. 그 시점에도 '승인'인 그림만(그 사이 반려했으면 빠짐) */
export async function pickedForJobs(db: PickDb & ArtDb, jobs: readonly { id: string; appSlug: string }[]): Promise<Map<string, PickedRef[]>> {
  const out = new Map<string, PickedRef[]>();

  if (!jobs.length) return out;
  const rows = await db.factorySetting.findMany({ where: { key: { in: jobs.map((j) => `${ART_PICKS_PREFIX}${j.id}`) } } });

  for (const row of rows) {
    const job = jobs.find((j) => `${ART_PICKS_PREFIX}${j.id}` === row.key);
    let ids: unknown = [];

    try {
      ids = JSON.parse(row.value);
    } catch {
      /* 읽을 수 없으면 없는 것으로 */
    }
    const picked = job ? toPickedRefs(await resolvePicked(db, job.appSlug, ids)) : [];

    if (job && picked.length) out.set(job.id, picked);
  }

  return out;
}

/** 시작하는 일감들의 승인 그림 목록(자동 참고 원본): appSlug → [{ url, subject, kind, approvedAt }]. 승인 그림이 없는 프로젝트는 넣지 않는다 */
export async function approvedForNext(db: ArtDb, appSlugs: readonly string[]): Promise<Map<string, ApprovedEntry[]>> {
  const out = new Map<string, ApprovedEntry[]>();

  for (const slug of new Set(appSlugs)) {
    const list = await approvedArtsFor(db, slug);

    if (list.length) out.set(slug, list);
  }

  return out;
}
