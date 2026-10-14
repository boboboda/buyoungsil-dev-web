// lib/factory/lab.ts
// 실험(lab) 일감: 도구·방식이 되는지 확인하는 테스트 전용 일감 종류. 앱 폴더가 아니라 lab\<일감id>\ 에서 돈다.
// - 일감은 kind="lab", appSlug="lab"(고정). 같은 appSlug 는 한 번에 하나만 돌기 때문에 실험은 동시에 1개다(claimJobs 가 이미 그렇게 한다).
// - 결과 파일(이미지·mp4·report.md)은 감독 프로그램이 8MB 이하 조각으로 올리고(워커 토큰), 통제실(관리자)과 커넥터(서명 주소)가 읽는다.
// - 사후 검사(공장 안 저장소의 git status 비교)와 건너뛴 파일 목록은 labResult 에 저장한다.
import { createHmac, timingSafeEqual } from "crypto";

import prisma from "@/lib/prisma";
import { maskSecrets } from "@/lib/factory/mask";

export const LAB_KIND = "lab";
export const LAB_SLUG = "lab"; // 실험 일감의 고정 appSlug(앱 목록에서는 kind=lab 을 뺀다)
export const LAB_FILE_MAX = 50 * 1024 * 1024; // 파일당
export const LAB_JOB_MAX = 200 * 1024 * 1024; // 일감당
export const LAB_FILE_COUNT_MAX = 40; // 일감당 파일 수
export const LAB_CHUNK = 8 * 1024 * 1024;
export const LAB_REPORT_TEXT_MAX = 20_000; // 커넥터에 싣는 report.md 본문 상한(글자)
const LINK_TTL_MS = 6 * 60 * 60 * 1000; // 커넥터에 준 파일 주소의 유효 시간

export type LabFileKind = "image" | "video" | "report";

const MIME_BY_EXT: Record<string, { mime: string; kind: LabFileKind }> = {
  ".png": { mime: "image/png", kind: "image" },
  ".webp": { mime: "image/webp", kind: "image" },
  ".gif": { mime: "image/gif", kind: "image" },
  ".mp4": { mime: "video/mp4", kind: "video" },
  ".md": { mime: "text/markdown; charset=utf-8", kind: "report" },
};

/** 올릴 수 있는 파일인지 이름으로 판단한다. report.md 만 문서로 받는다(다른 .md 는 받지 않음) */
export function labFileType(name: string): { mime: string; kind: LabFileKind } | null {
  const lower = name.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));
  const t = MIME_BY_EXT[ext];

  if (!t) return null;
  if (t.kind === "report" && lower !== "report.md") return null;

  return t;
}

/** outputs/ 아래 상대 경로: 슬래시 구분, 상위 이동·절대 경로·이상한 글자 불가, 200자 이내 */
export const LAB_NAME_RE = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9가-힣._ -]+(?:\/[A-Za-z0-9가-힣._ -]+){0,4}$/;

export function isLabName(v: unknown): v is string {
  return typeof v === "string" && v.length <= 200 && LAB_NAME_RE.test(v) && labFileType(v.split("/").pop() ?? "") !== null;
}

// ───────────── 결과 요약(labResult) ─────────────

export interface LabRepoChange {
  repo: string; // 저장소 폴더 이름
  files: string[]; // 바뀐 파일(최대 20개)
  more: number; // 더 있는 개수
}

export interface LabResult {
  keep?: boolean; // false 면 '지워도 되는 실험'(자동 삭제는 하지 않는다)
  skipped?: { name: string; size: number; reason: string }[]; // 용량 상한 등으로 올리지 않은 파일(목록만)
  uploadedBytes?: number;
  check?: {
    ok: boolean;
    at: string;
    changes: LabRepoChange[]; // 실험 전후 git status 가 달라진 저장소
    notes: string[]; // 검사에서 빠진 저장소(다른 일감이 같이 만짐 등)·검사 못 한 이유
    repos: number; // 검사한 저장소 수
  };
  folderDeleted?: string; // [폴더 지우기]로 지운 시각(ISO)
}

const str = (v: unknown, max: number) => (typeof v === "string" ? maskSecrets(v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max)) ?? "" : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** 감독 프로그램이 보낸 lab 필드를 정리한다(모양이 이상하면 null). 비밀값은 마스킹한다 */
export function cleanLabResult(v: unknown): Omit<LabResult, "keep" | "folderDeleted"> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const out: Omit<LabResult, "keep" | "folderDeleted"> = {};

  if (Array.isArray(r.skipped)) {
    out.skipped = r.skipped.slice(0, 60).map((s) => {
      const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;

      return { name: str(o.name, 200), size: num(o.size), reason: str(o.reason, 120) };
    }).filter((s) => s.name);
  }
  if (r.uploadedBytes !== undefined) out.uploadedBytes = num(r.uploadedBytes);
  if (r.check && typeof r.check === "object" && !Array.isArray(r.check)) {
    const c = r.check as Record<string, unknown>;

    out.check = {
      ok: c.ok === true,
      at: str(c.at, 40),
      repos: num(c.repos),
      notes: Array.isArray(c.notes) ? c.notes.slice(0, 30).map((n) => str(n, 300)).filter(Boolean) : [],
      changes: Array.isArray(c.changes)
        ? c.changes.slice(0, 30).map((x) => {
            const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;

            return {
              repo: str(o.repo, 80),
              files: Array.isArray(o.files) ? o.files.slice(0, 20).map((f) => str(f, 240)).filter(Boolean) : [],
              more: num(o.more),
            };
          }).filter((x) => x.repo)
        : [],
    };
  }

  return out;
}

export function readLabResult(v: unknown): LabResult {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as LabResult) : {};
}

/** labResult 에 일부 값을 합쳐 저장한다(없으면 만든다) */
export async function mergeLabResult(jobId: string, patch: Partial<LabResult>): Promise<void> {
  const cur = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { labResult: true } });
  const next = { ...readLabResult(cur?.labResult), ...patch };

  await prisma.factoryJob.update({ where: { id: jobId }, data: { labResult: next as object } });
}

// ───────────── 파일 받기(감독 프로그램) ─────────────

type Res = { ok: boolean; status: number; message: string };

/** 조각 하나 받기. 첫 조각(idx 0)이 오면 같은 이름의 파일을 새로 시작한다. 실행 중인 실험 일감만 */
export async function receiveLabChunk(jobId: string, name: string, idx: number, count: number, size: number, data: Uint8Array): Promise<Res> {
  const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { kind: true, status: true } });

  if (!job || job.kind !== LAB_KIND) return { ok: false, status: 404, message: "없는 실험 일감이에요." };
  if (job.status !== "running") return { ok: false, status: 409, message: `지시가 실행 중이 아닙니다(${job.status}).` };
  if (!isLabName(name)) return { ok: false, status: 400, message: "파일 이름이나 종류가 올바르지 않아요(png·webp·gif·mp4·report.md)." };
  if (!Number.isInteger(size) || size <= 0 || size > LAB_FILE_MAX) return { ok: false, status: 413, message: "파일은 50MB 이하여야 해요." };
  if (!Number.isInteger(count) || count !== Math.ceil(size / LAB_CHUNK)) return { ok: false, status: 400, message: "조각 수가 맞지 않아요." };
  if (!Number.isInteger(idx) || idx < 0 || idx >= count) return { ok: false, status: 400, message: "조각 번호가 올바르지 않아요." };
  const expect = idx === count - 1 ? size - idx * LAB_CHUNK : LAB_CHUNK;

  if (data.length !== expect) return { ok: false, status: 400, message: `조각 크기가 맞지 않아요(${data.length}/${expect}).` };
  const type = labFileType(name.split("/").pop() ?? "");

  if (!type) return { ok: false, status: 400, message: "받을 수 없는 파일 종류예요." };

  if (idx === 0) {
    // 일감당 상한: 같은 이름의 예전 파일은 빼고 센다
    const others = await prisma.factoryLabFile.findMany({ where: { jobId, NOT: { name } }, select: { size: true } });

    if (others.length >= LAB_FILE_COUNT_MAX) return { ok: false, status: 400, message: `파일은 일감당 ${LAB_FILE_COUNT_MAX}개까지예요.` };
    if (others.reduce((n, f) => n + f.size, 0) + size > LAB_JOB_MAX) return { ok: false, status: 413, message: "일감당 200MB 를 넘어요." };
    await prisma.factoryLabFile.deleteMany({ where: { jobId, name } });
    await prisma.factoryLabFile.create({ data: { jobId, name, kind: type.kind, mime: type.mime, size, chunkCount: count } });
  }
  const f = await prisma.factoryLabFile.findUnique({ where: { jobId_name: { jobId, name } } });

  if (!f || f.size !== size || f.chunkCount !== count) return { ok: false, status: 409, message: "첫 조각부터 다시 보내 주세요." };
  await prisma.factoryLabFileChunk.upsert({
    where: { fileId_idx: { fileId: f.id, idx } },
    create: { fileId: f.id, idx, data: new Uint8Array(data) },
    update: { data: new Uint8Array(data) },
  });
  const received = await prisma.factoryLabFileChunk.count({ where: { fileId: f.id } });

  await prisma.factoryLabFile.update({ where: { id: f.id }, data: { received, complete: received === count } });

  return { ok: true, status: 200, message: received === count ? `${name} 다 받았어요.` : `${name} 조각 ${idx + 1}/${count}` };
}

// ───────────── 파일 읽기(통제실·커넥터) ─────────────

function linkKey(): string {
  return process.env.FACTORY_SECRET_KEY?.trim() || process.env.NEXTAUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || "";
}

const sign = (fileId: string, exp: number) => createHmac("sha256", linkKey()).update(`lab-file:${fileId}:${exp}`).digest("hex").slice(0, 32);

/** 로그인 없이 볼 수 있는 임시 서명 주소의 query(만료 시각 포함). 키가 없으면 null */
export function labFileQuery(fileId: string, now = Date.now()): string | null {
  if (!linkKey()) return null;
  const exp = Math.floor((now + LINK_TTL_MS) / 1000);

  return `exp=${exp}&sig=${sign(fileId, exp)}`;
}

export function verifyLabLink(fileId: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  if (!linkKey() || !exp || !sig || !/^\d{1,12}$/.test(exp) || !/^[0-9a-f]{32}$/.test(sig)) return false;
  if (Number(exp) * 1000 < now) return false;
  const a = new TextEncoder().encode(sign(fileId, Number(exp)));
  const b = new TextEncoder().encode(sig);

  return a.length === b.length && timingSafeEqual(a, b);
}

export function labPublicBase(): string {
  return (process.env.FACTORY_PUBLIC_URL?.trim() || "https://www.buyoungsilcoding.com").replace(/\/+$/, "");
}

/** 일감 하나의 결과 파일 목록(다 받은 것만) */
export async function listLabFiles(jobId: string) {
  return prisma.factoryLabFile.findMany({
    where: { jobId, complete: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, kind: true, mime: true, size: true, createdAt: true },
  });
}

/** 파일 전체 바이트(report.md 같은 작은 파일용) */
export async function readLabFileBytes(fileId: string): Promise<Uint8Array | null> {
  const f = await prisma.factoryLabFile.findUnique({ where: { id: fileId }, select: { size: true, complete: true } });

  if (!f || !f.complete) return null;
  const chunks = await prisma.factoryLabFileChunk.findMany({ where: { fileId }, orderBy: { idx: "asc" } });
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.data.length, 0));
  let at = 0;

  for (const c of chunks) {
    out.set(new Uint8Array(c.data), at);
    at += c.data.length;
  }

  return out;
}

/** 요청한 바이트 범위(start~end 포함)를 조각에서 잘라 돌려준다. 한 번에 조각 두 개 이하만 읽는다(브라우저가 이어서 다시 요청) */
export async function readLabRange(fileId: string, start: number, endIn: number | null) {
  const f = await prisma.factoryLabFile.findUnique({ where: { id: fileId }, select: { size: true, complete: true, mime: true, name: true } });

  if (!f || !f.complete) return null;
  if (start >= f.size) return { ...f, start, end: start - 1, data: null };
  const firstIdx = Math.floor(start / LAB_CHUNK);
  const end = Math.min(endIn ?? f.size - 1, f.size - 1, (firstIdx + 2) * LAB_CHUNK - 1);
  const lastIdx = Math.floor(end / LAB_CHUNK);
  const chunks = await prisma.factoryLabFileChunk.findMany({ where: { fileId, idx: { gte: firstIdx, lte: lastIdx } }, orderBy: { idx: "asc" } });
  const joined = new Uint8Array(chunks.reduce((n, c) => n + c.data.length, 0));
  let at = 0;

  for (const c of chunks) {
    joined.set(new Uint8Array(c.data), at);
    at += c.data.length;
  }
  const off = start - firstIdx * LAB_CHUNK;

  return { ...f, start, end, data: joined.slice(off, off + (end - start + 1)) };
}

/** 통제실·커넥터 공통 결과 보기: 파일 목록(주소 포함)·report.md 본문·건너뜀·사후 검사 */
export async function labResultView(jobId: string, labResult: unknown, { signed }: { signed: boolean }) {
  const files = await listLabFiles(jobId);
  const result = readLabResult(labResult);
  const base = labPublicBase();
  const report = files.find((f) => f.name === "report.md") ?? files.find((f) => f.name.endsWith("/report.md"));
  let reportText: string | null = null;

  if (report) {
    const bytes = await readLabFileBytes(report.id);

    if (bytes) reportText = new TextDecoder().decode(bytes).slice(0, LAB_REPORT_TEXT_MAX);
  }

  return {
    files: files.map((f) => {
      const q = signed ? labFileQuery(f.id) : null;

      return {
        id: f.id,
        name: f.name,
        kind: f.kind,
        size: f.size,
        // 커넥터: 서명 주소(전체 URL, 몇 시간 뒤 만료). 통제실: 로그인 세션으로 열리는 상대 주소
        url: signed ? (q ? `${base}/api/factory/lab-file/${f.id}?${q}` : null) : `/api/factory/lab-file/${f.id}`,
      };
    }),
    reportText,
    skipped: result.skipped ?? [],
    check: result.check ?? null,
    keep: result.keep !== false,
    folderDeleted: result.folderDeleted ?? null,
  };
}

/** 통제실 [폴더 지우기]가 눌린 실험 일감 id (감독 프로그램이 /next 응답으로 받아 해당 lab\<id> 만 지운다) */
export async function labCleanupForNext(): Promise<string[]> {
  const rows = await prisma.factoryJob.findMany({
    where: { kind: LAB_KIND, labCleanupAt: { not: null }, status: { notIn: ["pending", "approved", "running"] } },
    orderBy: { labCleanupAt: "asc" },
    take: 5,
    select: { id: true },
  });

  return rows.map((r) => r.id);
}
