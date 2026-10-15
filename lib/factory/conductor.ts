// 지휘자(병렬화 단계 C-2). 같은 앱에 승인된 수정 일감이 그룹 없이 2개 이상 쌓이면, 감독 프로그램이 앱 폴더에서 읽기 전용 AI 턴 하나를 돌려
// '서로 겹치지 않는지'를 판단하고, 서버가 그 제안을 다시 검사해서 안전할 때만 자동으로 '같이 돌리기'(parallelGroup)로 묶는다.
//   서버(이 파일): 판단할 일감 고르기·판단 키 캐시·가져가기 잠깐 보류·AI 제안 검사(planGroups)·묶기 반영·실패 기록·예상과 실제 비교·최종 점검 기록·비용 기록
//   감독 프로그램(tools/factory-supervisor/conductor.mjs): AI 턴 실행(읽기 전용)과 결과 보고
// 사람이 직접 묶거나 푼 일감(parallelSource = manual)은 지휘자가 바꾸지 않는다. 자동 묶기를 끄면 C-1 과 똑같이 동작한다.
import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { approvalWaitRemaining, claimOrder, MAX_GROUP_SIZE, newGroupId, PARALLEL_KIND, readConductorInfo, SOURCE_CONDUCTOR, SOURCE_MANUAL, type ConductorInfo, type Confidence } from "@/lib/factory/parallel";

export { SOURCE_CONDUCTOR, SOURCE_MANUAL };
export type { Confidence };

export const DEFAULT_MODEL = "haiku"; // 가벼운 모델이면 충분하다. 설정(conductorModel)으로 바꾼다
export const HOLD_MS = 5 * 60_000; // 판단을 기다리느라 가져가기를 보류하는 최대 시간(마지막 승인으로부터). 지나면 순서대로 돈다
export const LEASE_MS = 10 * 60_000; // 판단 요청을 내준 뒤 결과를 기다리는 시간(공장 전체 동시에 1개)
export const FAIL_CACHE_MS = 15 * 60_000; // 판단 실패를 기억하는 시간(그동안 같은 조합을 다시 판단하지 않음)

export const CONFIDENCE_LABELS: Record<Confidence, string> = { high: "높음", medium: "중간", low: "낮음" };
export const AREA_LABELS: Record<string, string> = { screen: "화면", data: "데이터", config: "설정", dependency: "의존성", logic: "로직", test: "시험", docs: "문서", assets: "리소스", other: "기타" };

// ───────────── 설정 ─────────────

const AUTO_KEY = "conductorAutoGroup";
const MODEL_KEY = "conductorModel";
const SHARED_KEY = "conductorSharedFiles";
const LOG_KEY = "conductorLog";
const LEASE_KEY = "conductorLease";
const MAX_LOG = 50;

/** 공용 파일 기본 목록. 슬래시가 없는 패턴은 어느 폴더에 있든 파일 이름이 맞으면 해당한다. ** 는 여러 폴더, * 는 한 폴더 안의 글자들 */
export const DEFAULT_SHARED_FILES: readonly string[] = [
  // 의존성·빌드
  "pubspec.yaml", "pubspec.lock", "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "build.gradle*", "settings.gradle*", "gradle.properties", "AndroidManifest.xml", "Podfile", "Podfile.lock", "Package.swift", "Package.resolved", "Cargo.toml", "Cargo.lock", "requirements.txt",
  // 공용 설정: 라우터·앱 전역 설정
  "main.dart", "app.dart", "*router*", "*routes*", "app_config*", "app_theme*", "next.config.*", "tsconfig.json",
  // 마이그레이션·스키마
  "**/migrations/**", "schema.prisma", "*.sql",
  // 번역 파일
  "**/l10n/**", "**/i18n/**", "**/locales/**", "**/translations/**", "*.arb", "strings.xml",
];

export async function isAutoGroupEnabled(): Promise<boolean> {
  const row = await prisma.factorySetting.findUnique({ where: { key: AUTO_KEY } });

  return row?.value !== "false"; // 기본 켜기
}

export async function setAutoGroupEnabled(on: boolean): Promise<void> {
  const value = on ? "true" : "false";

  await prisma.factorySetting.upsert({ where: { key: AUTO_KEY }, create: { key: AUTO_KEY, value }, update: { value } });
}

/** 지휘자 모델 별칭의 모양만 본다(허용 목록 검사는 control API 와 감독 프로그램이 한다) */
export const MODEL_RE = /^[a-z0-9]{3,12}(\[1m\])?$/;

export async function getConductorModel(): Promise<{ value: string; isDefault: boolean }> {
  const row = await prisma.factorySetting.findUnique({ where: { key: MODEL_KEY } });

  return row?.value && MODEL_RE.test(row.value) ? { value: row.value, isDefault: false } : { value: DEFAULT_MODEL, isDefault: true };
}

export async function setConductorModel(model: string): Promise<void> {
  await prisma.factorySetting.upsert({ where: { key: MODEL_KEY }, create: { key: MODEL_KEY, value: model }, update: { value: model } });
}

/** 공용 파일 패턴 정리: 줄바꿈 글자 또는 배열. 한 줄 200자·최대 100줄, 모양이 이상한 줄은 버린다. 빈 목록도 허용(=공용 파일 검사 없음) */
export function cleanSharedPatterns(v: unknown): string[] | null {
  const lines = typeof v === "string" ? v.split(/\r?\n|,/) : Array.isArray(v) ? v : null;

  if (!lines || lines.length > 300) return null;
  const out: string[] = [];

  for (const x of lines) {
    if (typeof x !== "string") return null;
    const t = x.trim().replace(/\\/g, "/");

    if (!t || t.length > 200 || /[\u0000-\u001f\u007f]/.test(t) || t.startsWith("/") || t.split("/").includes("..")) continue;
    if (!out.includes(t)) out.push(t);
  }

  return out.length > 100 ? null : out;
}

export async function getSharedFiles(): Promise<{ value: string[]; isDefault: boolean }> {
  const row = await prisma.factorySetting.findUnique({ where: { key: SHARED_KEY } });

  if (!row?.value) return { value: [...DEFAULT_SHARED_FILES], isDefault: true };
  try {
    const list = cleanSharedPatterns(JSON.parse(row.value) as unknown);

    return list ? { value: list, isDefault: false } : { value: [...DEFAULT_SHARED_FILES], isDefault: true };
  } catch {
    return { value: [...DEFAULT_SHARED_FILES], isDefault: true };
  }
}

export async function setSharedFiles(list: string[]): Promise<void> {
  const value = JSON.stringify(list);

  await prisma.factorySetting.upsert({ where: { key: SHARED_KEY }, create: { key: SHARED_KEY, value }, update: { value } });
}

// ───────────── 파일 경로·공용 파일 ─────────────

/** AI 가 적은 파일 경로 정리: 슬래시로 통일, ./ 제거. 절대 경로·.. ·이상한 글자는 null */
export function cleanPath(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\\/g, "/").replace(/^\.\//, "");

  if (!t || t.length > 200 || /[\u0000-\u001f\u007f]/.test(t) || t.startsWith("/") || /^[a-zA-Z]:/.test(t) || t.split("/").includes("..") || t.endsWith("/")) return null;

  return t;
}

const reCache = new Map<string, RegExp>();

/** 패턴 하나를 정규식으로: 대소문자 구분 없음. 슬래시가 없으면 어느 폴더든 파일 이름만 맞으면 된다 */
export function globToRegExp(pattern: string): RegExp {
  const hit = reCache.get(pattern);

  if (hit) return hit;
  const p = pattern.includes("/") ? pattern : `**/${pattern}`;
  let src = "";

  for (let i = 0; i < p.length; i++) {
    const c = p[i];

    if (c === "*" && p[i + 1] === "*") {
      if (p[i + 2] === "/") {
        src += "(?:.*/)?"; // **/ = 폴더 0개 이상
        i += 2;
      } else {
        src += ".*";
        i += 1;
      }
    } else if (c === "*") src += "[^/]*";
    else if (c === "?") src += "[^/]";
    else src += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const re = new RegExp(`^${src}$`, "i");

  reCache.set(pattern, re);

  return re;
}

/** 공용 파일에 해당하면 그 패턴, 아니면 null */
export function sharedPatternOf(file: string, patterns: readonly string[]): string | null {
  for (const p of patterns) if (globToRegExp(p).test(file)) return p;

  return null;
}

// ───────────── AI 판단 결과 정리 ─────────────

export interface JobVerdict {
  id: string;
  files: string[];
  areas: string[];
  confidence: Confidence;
  note: string;
}

export interface Proposal {
  jobIds: string[];
  reason: string;
}

export interface Verdict {
  jobs: JobVerdict[];
  groups: Proposal[];
  sequential: Proposal[];
}

const text = (x: unknown, max: number) => (typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const MAX_FILES_PER_JOB = 60;

/** 감독 프로그램이 보낸 AI 출력(JSON)을 정리한다. 모양이 이상한 값은 버리고, 아는 일감 id 만 남긴다. 판단 결과가 하나도 없으면 null */
export function cleanVerdict(v: unknown, ids: readonly string[]): Verdict | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;

  if (!Array.isArray(r.jobs)) return null;
  const known = new Set(ids);
  const jobs: JobVerdict[] = [];

  for (const item of r.jobs.slice(0, 40)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";

    if (!known.has(id) || jobs.some((j) => j.id === id)) continue;
    const files = Array.isArray(o.files) ? [...new Set(o.files.map(cleanPath).filter((f): f is string => !!f))].slice(0, MAX_FILES_PER_JOB) : [];
    const areas = Array.isArray(o.areas) ? [...new Set(o.areas.map((a) => (typeof a === "string" ? a.trim().toLowerCase() : "")).filter((a) => /^[a-z_]{2,20}$/.test(a)))].slice(0, 6) : [];
    const confidence: Confidence = o.confidence === "high" ? "high" : o.confidence === "medium" ? "medium" : "low"; // 모르면 낮음

    jobs.push({ id, files, areas, confidence, note: text(o.note, 200) });
  }
  if (!jobs.length) return null;
  const proposals = (x: unknown): Proposal[] =>
    Array.isArray(x)
      ? x.slice(0, 20).flatMap((p) => {
          if (!p || typeof p !== "object" || Array.isArray(p)) return [];
          const o = p as Record<string, unknown>;
          const jobIds = Array.isArray(o.jobIds) ? [...new Set(o.jobIds.filter((i): i is string => typeof i === "string" && known.has(i)))] : [];

          return jobIds.length ? [{ jobIds, reason: text(o.reason, 300) }] : [];
        })
      : [];

  return { jobs, groups: proposals(r.groups), sequential: proposals(r.sequential) };
}

// ───────────── 서버 안전 규칙: AI 제안을 다시 검사해서 묶음을 정한다 ─────────────

export interface PlanJob {
  id: string;
  title: string;
  priority: number;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface PlanResult {
  bundles: string[][]; // 같이 돌릴 묶음(2개 이상, 우선순위 순)
  sequential: { id: string; reason: string }[]; // 순서대로 둘 일감과 이유
}

/** 이 일감만 봐도 묶을 수 없는 이유(확신도·예상 파일 없음·공용 파일). 없으면 null */
export function unsafeReason(v: JobVerdict | undefined, shared: readonly string[]): string | null {
  if (!v) return "지휘자가 이 일감을 판단하지 못했어요";
  if (v.confidence !== "high") return `확신도가 ${CONFIDENCE_LABELS[v.confidence]}이라 순서대로 둬요`;
  if (!v.files.length) return "예상 수정 파일을 알 수 없어요";
  for (const f of v.files) {
    const p = sharedPatternOf(f, shared);

    if (p) return `${f.split("/").pop()} 공통(공용 파일: ${f})`;
  }
  if (v.areas.includes("dependency")) return "의존성 영역을 건드려요";

  return null;
}

const norm = (f: string) => f.toLowerCase();

/** 두 일감의 예상 파일이 겹치는 파일들 */
export function overlapFiles(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(b.map(norm));

  return a.filter((f) => set.has(norm(f)));
}

/**
 * 묶음 정하기. 우선순위(priority→승인→등록 순)가 가장 높은 일감부터 묶음을 만든다. 묶음은 순서상 이어진 일감들이고(pickClaims 가 새치기를 허용하지 않음),
 * 다음 일감이 안전하지 않거나 겹치거나 지휘자가 같이 돌리자고 하지 않았으면 거기서 묶음이 끝난다. 높은 순위를 건너뛰어 낮은 일감끼리 먼저 묶지 않는다.
 * 묶음 크기는 perApp 이하. 묶지 못한 일감은 순서대로 두고 이유를 남긴다.
 */
export function planGroups(args: { jobs: PlanJob[]; verdict: Verdict; perApp: number; shared: readonly string[] }): PlanResult {
  const ordered = [...args.jobs].sort(claimOrder);
  const byId = new Map(args.verdict.jobs.map((j) => [j.id, j]));
  const proposal = new Map<string, number>(); // 일감 → 지휘자가 같이 돌리자고 제안한 묶음 번호
  const out: PlanResult = { bundles: [], sequential: [] };
  const cap = Math.max(1, Math.min(MAX_GROUP_SIZE, Math.floor(args.perApp)));

  args.verdict.groups.forEach((g, i) => {
    if (g.jobIds.length >= 2) for (const id of g.jobIds) if (!proposal.has(id)) proposal.set(id, i);
  });
  const seqNote = (id: string) => args.verdict.sequential.find((s) => s.jobIds.includes(id))?.reason || args.verdict.jobs.find((j) => j.id === id)?.note || "";
  const title = (j: PlanJob) => `'${j.title.slice(0, 30)}'`;
  let i = 0;

  while (i < ordered.length) {
    const head = ordered[i];
    const hv = byId.get(head.id);
    const own = unsafeReason(hv, args.shared);

    if (own) {
      out.sequential.push({ id: head.id, reason: own });
      i++;
      continue;
    }
    const bundle = [head];
    let blocker = "";
    let j = i + 1;

    while (j < ordered.length && bundle.length < cap) {
      const c = ordered[j];
      const cv = byId.get(c.id);
      const cOwn = unsafeReason(cv, args.shared);

      if (cOwn) {
        blocker = `다음 일감 ${title(c)}: ${cOwn}`;
        break;
      }
      if (proposal.get(head.id) === undefined || proposal.get(head.id) !== proposal.get(c.id)) {
        blocker = `지휘자가 ${title(c)}와 같이 돌리자고 하지 않았어요${seqNote(c.id) ? ` (${seqNote(c.id)})` : ""}`;
        break;
      }
      const clash = bundle.flatMap((m) => overlapFiles(cv!.files, byId.get(m.id)!.files).map((f) => ({ f, m })))[0];

      if (clash) {
        blocker = `${title(c)}와 ${clash.f} 겹침`;
        break;
      }
      bundle.push(c);
      j++;
    }
    if (bundle.length >= 2) {
      out.bundles.push(bundle.map((b) => b.id));
      i = j;
    } else {
      out.sequential.push({ id: head.id, reason: blocker || (cap < 2 ? "같이 돌릴 수 있는 수가 1개예요" : ordered.length - i < 2 ? "같이 돌릴 짝이 없어요" : `지휘자가 같이 돌리자고 하지 않았어요${seqNote(head.id) ? ` (${seqNote(head.id)})` : ""}`) });
      i++;
    }
  }

  return out;
}

// ───────────── 판단할 일감·캐시 ─────────────

export interface CandidateRow {
  id: string;
  appSlug: string;
  title: string;
  kind: string;
  status: string;
  priority: number;
  approvedAt: Date | null;
  createdAt: Date;
  planHash: string;
  planMarkdown?: string;
  parallelGroup: string | null;
  parallelSource: string | null;
  conductorInfo: unknown;
}

const CAND_SELECT = { id: true, appSlug: true, title: true, kind: true, status: true, priority: true, approvedAt: true, createdAt: true, planHash: true, planMarkdown: true, parallelGroup: true, parallelSource: true, conductorInfo: true } as const;

/** 지휘자가 판단할 수 있는 일감인지: 승인된 수정 일감, 아직 그룹이 없고 사람이 만지지 않은 것 */
export function isCandidate(r: Pick<CandidateRow, "kind" | "status" | "parallelGroup" | "parallelSource">): boolean {
  return r.kind === PARALLEL_KIND && r.status === "approved" && !r.parallelGroup && r.parallelSource !== SOURCE_MANUAL;
}

/** 판단 키: 대상 일감 id 와 각 planHash. 새 일감이 들어오거나 내용이 바뀌면 키가 달라져 다시 판단한다 */
export function judgeKey(rows: readonly { id: string; planHash: string }[]): string {
  const parts = rows.map((r) => `${r.id}:${r.planHash}`).sort();

  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

export { readConductorInfo, type ConductorInfo };

/** 이 조합은 이미 판단했나: 모든 대상 일감에 같은 키의 기록이 있고(실패는 15분 동안만 기억) */
export function isResolved(rows: readonly CandidateRow[], key: string, now = Date.now()): boolean {
  return rows.every((r) => {
    const info = readConductorInfo(r.conductorInfo);

    if (!info || info.key !== key) return false;
    if (info.decision === "failed") return now - Date.parse(info.at) < FAIL_CACHE_MS;

    return true;
  });
}

/** 앱별로 판단 대상(2개 이상)을 모은다. 우선순위 순, 한 번에 최대 MAX_GROUP_SIZE 개 */
export function groupCandidatesByApp(rows: readonly CandidateRow[]): Map<string, CandidateRow[]> {
  const out = new Map<string, CandidateRow[]>();

  for (const r of rows.filter(isCandidate)) out.set(r.appSlug, [...(out.get(r.appSlug) ?? []), r]);
  for (const [slug, list] of out) {
    const top = [...list].sort(claimOrder).slice(0, MAX_GROUP_SIZE);

    if (top.length < 2) out.delete(slug);
    else out.set(slug, top);
  }

  return out;
}

async function loadCandidates(): Promise<Map<string, CandidateRow[]>> {
  const rows = (await prisma.factoryJob.findMany({ where: { status: "approved", kind: PARALLEL_KIND, parallelGroup: null }, select: CAND_SELECT })) as unknown as CandidateRow[];

  return groupCandidatesByApp(rows);
}

export interface ConductorSettings {
  autoGroup: boolean;
  perApp: number;
  appSlots: number;
}

/** 병행할 여유가 설정상 있는가: 자동 묶기가 켜져 있고, 같은 앱 동시 수와 공장 전체 상한이 모두 2 이상 */
export const hasRoom = (s: ConductorSettings) => s.autoGroup && s.perApp >= 2 && s.appSlots >= 2;

/**
 * 판단이 끝나기를 잠깐 기다려야 하는 앱(가져가기 보류). 감독 프로그램이 지휘자를 쓸 줄 알 때(capable)만, 마지막 승인으로부터 HOLD_MS 안에서만.
 * 판단이 끝나면(묶음 또는 순서대로 기록) 바로 풀린다. 판단이 실패하거나 오지 않아도 시간이 지나면 풀려서 예전처럼 순서대로 돈다.
 */
export async function appsToHold(s: ConductorSettings, capable: boolean, now = Date.now()): Promise<Set<string>> {
  const hold = new Set<string>();

  if (!capable || !hasRoom(s)) return hold;
  for (const [slug, list] of await loadCandidates()) {
    const last = Math.max(...list.map((r) => (r.approvedAt ? r.approvedAt.getTime() : r.createdAt.getTime())));

    if (now - last < HOLD_MS && !isResolved(list, judgeKey(list), now)) hold.add(slug);
  }

  return hold;
}

/**
 * 승인 직후 '다른 승인'을 짧게 기다려야 하는 앱(앱 이름 → 남은 초). 같은 앱에 승인 대기(pending) 수정 일감이 또 있으면, 방금 승인된(묶이지 않은) 수정 일감을
 * 바로 가져가지 않고 마지막 승인으로부터 waitSec 초 동안 기다린다(관리자가 연달아 승인해서 지휘자·묶음이 일할 시간). 0이면 기다리지 않는다(예전과 같음).
 * 감독 프로그램이 지휘자를 쓸 줄 알 때(capable)만, 자동 묶기가 켜져 있고 같은 앱 동시 수가 2 이상일 때만(hasRoom). 그 밖에는 기다리지 않는다.
 * 이미 묶인 일감은 대상이 아니다(묶음은 모두 승인될 때까지 따로 기다린다).
 */
export async function appsWaitingForApproval(s: ConductorSettings, capable: boolean, waitSec: number, now = Date.now()): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  if (!capable || !(waitSec > 0) || !hasRoom(s)) return out;
  const [approved, pending] = await Promise.all([
    prisma.factoryJob.findMany({ where: { status: "approved", kind: PARALLEL_KIND, parallelGroup: null }, select: { appSlug: true, approvedAt: true } }),
    prisma.factoryJob.findMany({ where: { status: "pending", kind: PARALLEL_KIND }, select: { appSlug: true } }),
  ]);
  const pendingBy = new Map<string, number>();

  for (const p of pending) pendingBy.set(p.appSlug, (pendingBy.get(p.appSlug) ?? 0) + 1);
  const bySlug = new Map<string, (Date | null)[]>();

  for (const a of approved) bySlug.set(a.appSlug, [...(bySlug.get(a.appSlug) ?? []), a.approvedAt]);
  for (const [slug, approvedAts] of bySlug) {
    const left = approvalWaitRemaining({ approvedAts, pendingCount: pendingBy.get(slug) ?? 0, waitSec, now });

    if (left > 0) out.set(slug, left);
  }

  return out;
}

// ───────────── 판단 요청 내주기(/next) ─────────────

export interface ConductorTask {
  appSlug: string;
  key: string;
  model: string;
  perApp: number;
  sharedFiles: string[];
  jobs: { id: string; title: string; priority: number; instruction: string }[];
}

const MAX_INSTRUCTION = 6000;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.factorySetting.findUnique({ where: { key } });

  if (!row?.value) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  const v = JSON.stringify(value);

  await prisma.factorySetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

/** 감독 프로그램에 판단을 시킬 일을 하나 내준다(공장 전체 동시에 1개). 할 일이 없으면 null */
export async function conductorTaskForNext(s: ConductorSettings, now = Date.now()): Promise<ConductorTask | null> {
  if (!hasRoom(s)) return null;
  const lease = await readJson<{ until?: number } | null>(LEASE_KEY, null);

  if (lease && typeof lease.until === "number" && lease.until > now) return null;
  const apps = [...(await loadCandidates())].sort((a, b) => claimOrder(a[1][0], b[1][0]));

  for (const [slug, list] of apps) {
    const key = judgeKey(list);

    if (isResolved(list, key, now)) continue;
    const model = (await getConductorModel()).value;
    const sharedFiles = (await getSharedFiles()).value;

    await writeJson(LEASE_KEY, { appSlug: slug, key, until: now + LEASE_MS });

    return { appSlug: slug, key, model, perApp: s.perApp, sharedFiles, jobs: list.map((r) => ({ id: r.id, title: r.title, priority: r.priority, instruction: (r.planMarkdown ?? "").slice(0, MAX_INSTRUCTION) })) };
  }

  return null;
}

async function releaseLease(): Promise<void> {
  await writeJson(LEASE_KEY, { until: 0 });
}

/** 감독 프로그램이 지금은 판단하지 못한다고 알릴 때(앱 폴더에서 다른 일감이 돌고 있음 등): 기록 없이 잠금만 풀어 다음 확인 때 다시 받게 한다 */
export async function skipVerdict(): Promise<void> {
  await releaseLease();
}

// ───────────── 판단 결과 반영 ─────────────

export interface CostRecord {
  at: string;
  role: "conductor"; // 비용 기록에서 지휘자 턴을 따로 구분하는 표시
  appSlug: string;
  jobIds: string[];
  model: string | null;
  ok: boolean;
  outcome: string; // grouped N / sequential / failed / stale 같은 한 줄
  ms: number | null;
  costUsd: number | null;
  tokens: { input: number; output: number; cacheCreate: number; cacheRead: number } | null;
}

const num = (x: unknown, max = 1e9) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.min(x, max) : null);

/** 보고에 실린 사용량(토큰·비용)을 정리한다. 모양이 이상한 값은 버린다 */
export function cleanUsage(v: unknown): { ms: number | null; costUsd: number | null; tokens: CostRecord["tokens"] } {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const t = o.tokens && typeof o.tokens === "object" && !Array.isArray(o.tokens) ? (o.tokens as Record<string, unknown>) : null;

  return {
    ms: num(o.ms, 3_600_000),
    costUsd: num(o.costUsd, 1000),
    tokens: t ? { input: num(t.input) ?? 0, output: num(t.output) ?? 0, cacheCreate: num(t.cacheCreate) ?? 0, cacheRead: num(t.cacheRead) ?? 0 } : null,
  };
}

export async function readConductorLog(): Promise<CostRecord[]> {
  const list = await readJson<unknown>(LOG_KEY, []);

  return Array.isArray(list) ? (list as CostRecord[]).filter((r) => r && r.role === "conductor" && typeof r.at === "string").slice(0, MAX_LOG) : [];
}

async function appendLog(rec: CostRecord): Promise<void> {
  await writeJson(LOG_KEY, [rec, ...(await readConductorLog())].slice(0, MAX_LOG));
  await import("@/lib/factory/runStatsDb").then((m) => m.recordConductorStat(rec)).catch(() => undefined); // 블록별 통계(4-4)
}

export type ApplyResult =
  | { ok: true; grouped: number; sequential: number; message: string }
  | { ok: false; stale?: boolean; message: string };

interface ReportArgs {
  appSlug: string;
  key: string;
  settings: ConductorSettings;
  model: string | null;
  shared: readonly string[];
  usage: unknown;
}

const infoJson = (i: ConductorInfo) => i as unknown as Prisma.InputJsonObject;

async function logForJobs(ids: string[], message: string): Promise<void> {
  if (ids.length) await prisma.factoryJobLog.createMany({ data: ids.map((jobId) => ({ jobId, level: "info", message: message.slice(0, 900) })) });
}

/** 지금 같은 앱의 판단 대상이 보고한 키와 같은지 확인하고 대상을 돌려준다. 달라졌으면(새 일감·내용 변경) null */
async function currentTargets(appSlug: string, key: string): Promise<CandidateRow[] | null> {
  const list = (await loadCandidates()).get(appSlug);

  return list && judgeKey(list) === key ? list : null;
}

/** 감독 프로그램이 보낸 AI 판단을 검사하고 묶음을 반영한다. 대상이 그 사이 바뀌었으면 반영하지 않는다(다음 확인 때 다시 판단) */
export async function applyVerdict(raw: unknown, a: ReportArgs): Promise<ApplyResult> {
  const now = new Date();
  const usage = cleanUsage(a.usage);
  const rec = (ok: boolean, outcome: string, ids: string[]) => appendLog({ at: now.toISOString(), role: "conductor", appSlug: a.appSlug, jobIds: ids, model: a.model, ok, outcome, ...usage });

  try {
    const list = await currentTargets(a.appSlug, a.key);

    if (!list) {
      await rec(true, "대상이 바뀌어 반영하지 않음", []);

      return { ok: false, stale: true, message: "그 사이 일감이 바뀌어서 판단을 쓰지 않았어요. 다시 판단해요." };
    }
    const ids = list.map((r) => r.id);
    const verdict = cleanVerdict(raw, ids);

    if (!verdict) return await failTargets(list, a, "지휘자의 답이 올바른 형식이 아니었어요", usage);
    const plan = planGroups({ jobs: list, verdict, perApp: a.settings.perApp, shared: a.shared });
    const byId = new Map(verdict.jobs.map((j) => [j.id, j]));
    const at = now.toISOString();
    const make = (id: string, over: Partial<ConductorInfo>): ConductorInfo => {
      const v = byId.get(id);

      return { decision: "sequential", reason: "", key: a.key, at, files: v?.files ?? [], areas: v?.areas ?? [], confidence: v?.confidence ?? null, groupWith: [], model: a.model, ...over };
    };
    let grouped = 0;

    for (const bundle of plan.bundles) {
      const group = newGroupId();
      const reason = verdict.groups.find((g) => bundle.every((id) => g.jobIds.includes(id)))?.reason || "예상 수정 파일이 겹치지 않아요";

      for (const id of bundle) {
        const res = await prisma.factoryJob.updateMany({ where: { id, status: "approved", parallelGroup: null }, data: { parallelGroup: group, parallelSource: SOURCE_CONDUCTOR, conductorInfo: infoJson(make(id, { decision: "grouped", reason, groupWith: bundle.filter((x) => x !== id) })) } });

        grouped += res.count;
      }
      await logForJobs(bundle, `지휘자: 같이 돌리기로 묶었어요(${bundle.length}개). 이유: ${reason}`);
    }
    for (const s of plan.sequential) {
      await prisma.factoryJob.updateMany({ where: { id: s.id, status: "approved", parallelGroup: null }, data: { conductorInfo: infoJson(make(s.id, { decision: "sequential", reason: s.reason })) } });
      await logForJobs([s.id], `지휘자: 순서대로 둬요. 이유: ${s.reason}`);
    }
    await rec(true, `묶음 ${plan.bundles.length}개 · 순서대로 ${plan.sequential.length}개`, ids);

    return { ok: true, grouped, sequential: plan.sequential.length, message: `묶음 ${plan.bundles.length}개, 순서대로 ${plan.sequential.length}개로 정했어요.` };
  } finally {
    await releaseLease().catch(() => undefined);
  }
}

async function failTargets(list: CandidateRow[], a: ReportArgs, reason: string, usage: ReturnType<typeof cleanUsage>): Promise<ApplyResult> {
  const at = new Date().toISOString();
  const why = text(reason, 300) || "알 수 없는 이유";

  for (const r of list) {
    const info: ConductorInfo = { decision: "failed", reason: why, key: a.key, at, files: [], areas: [], confidence: null, groupWith: [], model: a.model };

    await prisma.factoryJob.updateMany({ where: { id: r.id, status: "approved", parallelGroup: null }, data: { conductorInfo: infoJson(info) } });
  }
  await logForJobs(list.map((r) => r.id), `지휘자 판단 실패: ${why}. 순서대로 실행해요.`);
  await appendLog({ at, role: "conductor", appSlug: a.appSlug, jobIds: list.map((r) => r.id), model: a.model, ok: false, outcome: `실패: ${why}`.slice(0, 200), ...usage });

  return { ok: false, message: `판단에 실패해서 순서대로 둬요: ${why}` };
}

/** 감독 프로그램이 판단하지 못했다고 알릴 때(AI 실행 실패·읽기 전용 위반·시간 초과 등). 순서대로 두고 사유를 남기며, 공장은 멈추지 않는다 */
export async function failVerdict(reason: string, a: ReportArgs): Promise<ApplyResult> {
  try {
    const list = await currentTargets(a.appSlug, a.key);

    if (!list) {
      await appendLog({ at: new Date().toISOString(), role: "conductor", appSlug: a.appSlug, jobIds: [], model: a.model, ok: false, outcome: `실패(대상이 바뀜): ${text(reason, 150)}`, ...cleanUsage(a.usage) });

      return { ok: false, stale: true, message: "그 사이 일감이 바뀌었어요. 다시 판단해요." };
    }

    return await failTargets(list, a, reason, cleanUsage(a.usage));
  } finally {
    await releaseLease().catch(() => undefined);
  }
}

// ───────────── 예상과 실제 비교 ─────────────

export const MAX_ACTUAL_FILES = 200;

/**
 * 합친 뒤 실제로 바뀐 파일(actual)을 지휘자가 예상한 파일(predicted)과 비교한다.
 *  unexpected = 예상에 없던 실제 변경 파일, overlapFiles = 이미 합쳐진 같은 묶음 일감들의 실제 변경과 겹친 파일.
 */
export function compareActual(args: { predicted: readonly string[]; actual: readonly string[]; mateActuals: readonly (readonly string[])[] }): { unexpected: string[]; overlapFiles: string[]; overlap: boolean } {
  const pred = new Set(args.predicted.map(norm));
  const mates = new Set(args.mateActuals.flat().map(norm));
  const unexpected = args.actual.filter((f) => !pred.has(norm(f)));
  const overlapFiles = args.actual.filter((f) => mates.has(norm(f)));

  return { unexpected: unexpected.slice(0, 50), overlapFiles: overlapFiles.slice(0, 30), overlap: overlapFiles.length > 0 };
}

/** 보고에 실린 병행 상태에 실제 변경 파일이 있으면 예상과 비교한 값(unexpected·overlapFiles·overlap)을 채운다. 지휘자가 묶은 일감이 아니면 그대로 */
export async function annotateActual<T extends { actualFiles?: string[]; unexpected?: string[]; overlapFiles?: string[]; overlap?: boolean }>(jobId: string, info: T): Promise<T> {
  if (!info.actualFiles?.length) return info;
  try {
    const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { appSlug: true, parallelGroup: true, parallelSource: true, conductorInfo: true } });
    const ci = readConductorInfo(job?.conductorInfo);

    if (!job?.parallelGroup || job.parallelSource !== SOURCE_CONDUCTOR || ci?.decision !== "grouped") return info;
    const mates = await prisma.factoryJob.findMany({ where: { appSlug: job.appSlug, parallelGroup: job.parallelGroup }, select: { id: true, parallelInfo: true } });
    const mateActuals = mates.filter((m) => m.id !== jobId).map((m) => {
      const f = (m.parallelInfo as { actualFiles?: unknown } | null)?.actualFiles;

      return Array.isArray(f) ? f.filter((x): x is string => typeof x === "string") : [];
    });

    return { ...info, ...compareActual({ predicted: ci.files, actual: info.actualFiles, mateActuals }) };
  } catch {
    return info;
  }
}

/** 통제실 설정 화면용: 자동 묶기·모델·공용 파일 목록과 최근 판단(비용) 기록 */
export async function conductorSnapshot() {
  const [autoGroup, model, shared, log] = await Promise.all([isAutoGroupEnabled(), getConductorModel(), getSharedFiles(), readConductorLog()]);

  return { autoGroup, model: model.value, modelIsDefault: model.isDefault, sharedFiles: shared.value, sharedFilesIsDefault: shared.isDefault, defaultSharedFiles: [...DEFAULT_SHARED_FILES], log: log.slice(0, 10) };
}
