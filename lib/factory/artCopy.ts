// lib/factory/artCopy.ts
// 그림 자체 보관: 그림 저장소의 승인 그림·기본 그림이 홈페이지 업로드 서버(FACTORY_UPLOAD_URL)가 아닌 주소(예: 서비스 서버)에 있으면,
// 승인하거나 기본 그림으로 정할 때 업로드 서버로 복사한다. 기존 그림은 copyApprovedArts([지금 복사])로 한 번에 옮긴다.
// - 복사하면 url 이 복사본 주소로 바뀌고, 원래 주소는 sourceUrl 에 남는다. 도구 일감·참고 그림 선택은 url 을 쓰므로 자동으로 복사본을 쓴다.
// - 복사하지 못하면 url 은 그대로 두고 이유(인증서 만료 등)를 copyError 에 적는다. 그림 옆에 그대로 보여 준다.
// - 원본 서버의 파일과 DB 는 건드리지 않는다(내려받기만 한다). 사설망·로컬 주소는 받지 않는다.
// - 이 파일은 DB 모양(ArtDb)과 주입된 fetch·업로드 함수만 쓴다(시험에서 가짜로 바꾸려고).
import { certProblem } from "@/lib/studio/service";
import { isPrivateHost } from "@/lib/factory/reviewStatus";
import type { ArtDb, ArtRow } from "@/lib/factory/arts";

export const MAX_COPY_BYTES = 10 * 1024 * 1024; // 업로드 서버의 한도와 같다
export const COPY_TIMEOUT_MS = 15_000;
export const COPY_BATCH = 40; // [지금 복사] 한 번에 옮기는 최대 장 수(나머지는 한 번 더 누르면 이어서)
const MAX_HOPS = 3;
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export interface CopyDeps {
  fetchImpl?: typeof fetch;
  lookupImpl?: (host: string) => Promise<string[]>;
  /** 업로드 서버 주소(끝 슬래시 없음). 비면 복사하지 않는다 */
  base?: string;
  /** 업로드 서버로 보내 공개 주소를 받는다 */
  forward?: (base: string, buf: Uint8Array, type: string, filename: string) => Promise<{ ok: true; url: string } | { ok: false; message: string }>;
  timeoutMs?: number;
}

const originOf = (u: string): string | null => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

/** 이 주소가 업로드 서버(base)에 있는 그림인지(출처가 같은지) */
export function isOnUploadServer(url: string, base: string): boolean {
  const a = originOf(url);
  const b = originOf(base);

  return !!a && !!b && a === b;
}

/** 오류 → 사람이 읽는 이유. 인증서 만료는 따로 알려 준다 */
export function copyReason(e: unknown): string {
  if ((e as Error)?.name === "AbortError") return "시간 초과";

  return certProblem(e) ? `원래 주소 접속 실패(${certProblem(e)})` : "원래 주소 접속 실패(연결 실패)";
}

const sniff = (b: Uint8Array): string | null => {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";

  return null;
};

async function lookupAll(host: string, deps: CopyDeps): Promise<string[]> {
  if (deps.lookupImpl) return deps.lookupImpl(host);
  const { lookup } = await import("node:dns/promises");

  return (await lookup(host, { all: true })).map((a) => a.address);
}

/** 원래 주소의 그림을 내려받는다(리다이렉트는 3번까지, 매번 사설망 검사). 던지지 않는다 */
export async function downloadArt(url: string, deps: CopyDeps = {}): Promise<{ ok: true; buf: Uint8Array; type: string } | { ok: false; reason: string }> {
  let cur = url;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? COPY_TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      let u: URL;

      try {
        u = new URL(cur);
      } catch {
        return { ok: false, reason: "그림 주소가 올바르지 않아요" };
      }
      if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: "그림 주소는 http(s) 여야 해요" };
      if (u.username || u.password) return { ok: false, reason: "주소에 아이디·비밀번호가 있어서 받지 않아요" };
      if (isPrivateHost(u.hostname)) return { ok: false, reason: "사설망·로컬 주소라서 받지 않아요" };
      const addrs = await lookupAll(u.hostname, deps).catch(() => [] as string[]);

      if (!addrs.length) return { ok: false, reason: "원래 주소 접속 실패(주소를 찾지 못함)" };
      if (addrs.some(isPrivateHost)) return { ok: false, reason: "사설망 주소로 풀려서 받지 않아요" };
      const res = await (deps.fetchImpl ?? fetch)(cur, { redirect: "manual", cache: "no-store", signal: ctrl.signal });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers?.get?.("location");

        if (!loc) return { ok: false, reason: `원래 주소가 이동 응답(${res.status})만 줬어요` };
        cur = new URL(loc, cur).toString();
        continue;
      }
      if (res.status < 200 || res.status >= 300) return { ok: false, reason: `원래 주소가 오류를 돌려줬어요(HTTP ${res.status})` };
      const declared = Number(res.headers?.get?.("content-length") ?? "0");

      if (declared > MAX_COPY_BYTES) return { ok: false, reason: "그림이 10MB 보다 커요" };
      const buf = new Uint8Array(await res.arrayBuffer());

      if (!buf.length) return { ok: false, reason: "받은 그림이 비어 있어요" };
      if (buf.length > MAX_COPY_BYTES) return { ok: false, reason: "그림이 10MB 보다 커요" };
      const header = (res.headers?.get?.("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const type = TYPES[header] ? header : sniff(buf);

      if (!type || !TYPES[type]) return { ok: false, reason: "이미지(png·jpeg·gif·webp)가 아니에요" };

      return { ok: true, buf, type };
    }

    return { ok: false, reason: "이동 응답이 너무 많아요" };
  } catch (e) {
    return { ok: false, reason: copyReason(e) };
  } finally {
    clearTimeout(timer);
  }
}

export type CopyOutcome = { ok: true; url: string; already: boolean } | { ok: false; reason: string };

async function defaultForward(base: string, buf: Uint8Array, type: string, filename: string) {
  const { forwardBuffer } = await import("@/lib/factory/uploadStream");
  const r = await forwardBuffer(base, buf, type, filename);

  return r.ok === false ? { ok: false as const, message: r.message } : { ok: true as const, url: r.url };
}

async function defaultBase(): Promise<string> {
  const { uploadBase } = await import("@/lib/factory/uploadStream");

  return uploadBase();
}

/** 그림 하나를 업로드 서버로 복사하고 DB 를 갱신한다. 이미 업로드 서버에 있으면 아무것도 하지 않는다(copyError 만 비움). 던지지 않는다 */
export async function copyArtToUpload(db: ArtDb, art: Pick<ArtRow, "id" | "url" | "sourceUrl" | "copyError">, deps: CopyDeps = {}): Promise<CopyOutcome> {
  const base = (deps.base ?? (await defaultBase().catch(() => ""))).replace(/\/+$/, "");

  if (!base) return { ok: false, reason: "업로드 서버 주소를 알 수 없어요" };
  if (isOnUploadServer(art.url, base)) {
    if (art.copyError) await db.factoryArt.update({ where: { id: art.id }, data: { copyError: "" } }).catch(() => undefined);

    return { ok: true, url: art.url, already: true };
  }
  const fail = async (reason: string): Promise<CopyOutcome> => {
    await db.factoryArt.update({ where: { id: art.id }, data: { copyError: reason.slice(0, 200) } }).catch(() => undefined);

    return { ok: false, reason };
  };
  const got = await downloadArt(art.url, deps);

  if (got.ok === false) return fail(got.reason);
  const sent = await (deps.forward ?? defaultForward)(base, got.buf, got.type, `${art.id}.${TYPES[got.type]}`);

  if (sent.ok === false) return fail(`업로드 서버에 올리지 못했어요: ${sent.message}`.slice(0, 200));
  await db.factoryArt.update({ where: { id: art.id }, data: { url: sent.url, sourceUrl: art.sourceUrl || art.url, copyError: "" } });

  return { ok: true, url: sent.url, already: false };
}

/** 이 프로젝트의 승인 그림 중 업로드 서버 밖에 있는 것 */
export async function pendingCopies(db: ArtDb, appSlug: string, base: string): Promise<ArtRow[]> {
  const rows = await db.factoryArt.findMany({ where: { appSlug, status: "approved" }, orderBy: { decidedAt: "desc" }, take: 500 });

  return rows.filter((r) => !isOnUploadServer(r.url, base));
}

export interface CopyAllResult {
  total: number; // 복사가 필요했던 장 수
  copied: number;
  failed: number;
  remaining: number; // 한 번에 옮기는 한도(COPY_BATCH) 때문에 남은 장 수
  firstError: string;
}

/** [지금 복사]: 승인 그림 중 업로드 서버 밖의 것을 차례로 복사한다(한 번에 COPY_BATCH 장까지) */
export async function copyApprovedArts(db: ArtDb, appSlug: string, deps: CopyDeps = {}, batch = COPY_BATCH): Promise<CopyAllResult> {
  const base = (deps.base ?? (await defaultBase().catch(() => ""))).replace(/\/+$/, "");
  const out: CopyAllResult = { total: 0, copied: 0, failed: 0, remaining: 0, firstError: base ? "" : "업로드 서버 주소를 알 수 없어요" };

  if (!base) return out;
  const todo = await pendingCopies(db, appSlug, base);

  out.total = todo.length;
  for (const art of todo.slice(0, batch)) {
    const r = await copyArtToUpload(db, art, { ...deps, base });

    if (r.ok === false) {
      out.failed++;
      out.firstError ||= r.reason;
    } else out.copied++;
  }
  out.remaining = Math.max(0, todo.length - batch);

  return out;
}

/** 승인·기본 그림 지정 직후 한 장을 복사해 본다(실패해도 승인·지정은 그대로, 이유만 그림에 남는다). 던지지 않는다 */
export async function copyAfterApprove(db: ArtDb, id: string, deps: CopyDeps = {}): Promise<CopyOutcome | null> {
  try {
    const row = await db.factoryArt.findUnique({ where: { id } });

    return row && row.status === "approved" ? await copyArtToUpload(db, row, deps) : null;
  } catch {
    return null;
  }
}
