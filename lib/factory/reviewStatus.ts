// lib/factory/reviewStatus.ts
// 출시 패키지 카드의 '검수 페이지'(앱별 https 주소)와 '검수 대기 N장'. 홈페이지 서버가 그 주소의 호스트에 GET /api/review-status 를 대신 부른다.
// 계약: Authorization: Bearer <토큰> → 200 { review, held, pending: 정수, updatedAt: ISO } / 401 인증 실패 / 404 기능 꺼짐.
// - 토큰은 외부 서비스 키 REVIEW_STATUS_TOKEN_<앱 이름 대문자·_>(서버 보관 키, secretEntries.readServerSecret). 브라우저·로그·응답에 값이 나가지 않는다.
// - 3초 타임아웃(DNS 포함), 60초 캐시(토큰이 바뀌면 새로), 실패는 '확인 못 함'으로만. 사설망·로컬 주소는 부르지 않는다(SSRF 방지, 리다이렉트도 따라가지 않음).
import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import prisma from "@/lib/prisma";
import { readServerSecret } from "@/lib/factory/secretEntries";

export const REVIEW_TOKEN_PREFIX = "REVIEW_STATUS_TOKEN_";
export const REVIEW_TIMEOUT_MS = 3000;
export const REVIEW_CACHE_MS = 60_000;
const MAX_URL = 300;
const MAX_BODY = 8192;

/** 앱 이름(slug) → 토큰 키 이름. 예: one-tiny-frame → REVIEW_STATUS_TOKEN_ONE_TINY_FRAME */
export const reviewTokenName = (appSlug: string) => `${REVIEW_TOKEN_PREFIX}${appSlug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

function ipv4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);

  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

/** 사설망·로컬·예약 주소(IP 또는 이름)면 true. 이름은 localhost·.local·.internal·점 없는 이름을 막는다. */
export function isPrivateHost(hostRaw: string): boolean {
  const host = hostRaw.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");

  if (!host) return true;
  const v = isIP(host);

  if (v === 4) return ipv4Private(host);
  if (v === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host)?.[1];

    if (mapped) return ipv4Private(mapped);
    if (/^::ffff:/.test(host)) return true; // 16진 표기 매핑 주소는 그냥 막는다

    return host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || /^ff/.test(host);
  }

  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".");
}

/** 카드에서 저장하는 검수 페이지 주소. 빈 값이면 null(표시 안 함). https 만, 계정 정보·사설망 주소는 안 된다. */
export function checkReviewUrl(v: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, message: "검수 페이지 주소가 올바르지 않아요." };
  const s = v.trim();

  if (!s) return { ok: true, value: null };
  if (s.length > MAX_URL) return { ok: false, message: `검수 페이지 주소는 ${MAX_URL}자까지예요.` };
  let u: URL;

  try {
    u = new URL(s);
  } catch {
    return { ok: false, message: "검수 페이지 주소가 올바르지 않아요(예: https://example.com/admin)." };
  }
  if (u.protocol !== "https:") return { ok: false, message: "검수 페이지 주소는 https:// 로 시작해야 해요." };
  if (u.username || u.password) return { ok: false, message: "주소에 아이디·비밀번호를 넣을 수 없어요." };
  if (isPrivateHost(u.hostname)) return { ok: false, message: "사설망·로컬 주소는 쓸 수 없어요." };

  return { ok: true, value: u.toString() };
}

export type ReviewStatus =
  | { state: "ok"; review: number; held: number; pending: number; updatedAt: string | null; checkedAt: string }
  | { state: "no_token" } // 토큰 미등록(링크만)
  | { state: "blocked" } // 사설망 주소라 부르지 않음
  | { state: "error"; reason: string; checkedAt: string }; // 확인 못 함

export interface ReviewDeps {
  fetchImpl?: typeof fetch;
  lookupImpl?: (host: string) => Promise<string[]>;
  readToken?: (name: string) => Promise<string | null>;
  now?: () => number;
  timeoutMs?: number;
}

const defaultLookup = async (host: string) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);
const cache = new Map<string, { at: number; value: ReviewStatus }>();

/** 시험용: 캐시 비우기 */
export const clearReviewCache = () => cache.clear();

const nonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** 앱 하나의 검수 상태. 던지지 않는다. */
export async function reviewStatusOf(appSlug: string, url: string, deps: ReviewDeps = {}): Promise<ReviewStatus> {
  const now = deps.now ?? Date.now;
  const checked = checkReviewUrl(url);

  if ("message" in checked || !checked.value) return { state: "blocked" };
  const origin = new URL(checked.value).origin;
  const host = new URL(checked.value).hostname;
  const token = await (deps.readToken ?? readServerSecret)(reviewTokenName(appSlug)).catch(() => null);

  if (!token) return { state: "no_token" };
  // 캐시 키에 토큰 지문(앞 12자)만: 토큰을 바꾸면 바로 새로 부른다
  const key = `${appSlug}\n${origin}\n${createHash("sha256").update(token).digest("hex").slice(0, 12)}`;
  const hit = cache.get(key);

  if (hit && now() - hit.at < REVIEW_CACHE_MS) return hit.value;
  const value = await callReviewStatus(origin, host, token, deps, now);

  if (value.state !== "blocked") cache.set(key, { at: now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);

  return value;
}

async function callReviewStatus(origin: string, host: string, token: string, deps: ReviewDeps, now: () => number): Promise<ReviewStatus> {
  const checkedAt = () => new Date(now()).toISOString();
  const fail = (reason: string): ReviewStatus => ({ state: "error", reason, checkedAt: checkedAt() });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? REVIEW_TIMEOUT_MS);
  const timeout = new Promise<never>((_, reject) => ctrl.signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "AbortError" }))));

  timeout.catch(() => {}); // 아무도 기다리지 않을 때 처리 안 된 거부가 되지 않게

  try {
    // 이름이면 풀어서 사설망 주소가 하나라도 있으면 부르지 않는다
    if (!isIP(host.replace(/^\[|\]$/g, ""))) {
      const addrs = await Promise.race([(deps.lookupImpl ?? defaultLookup)(host), timeout]);

      if (!addrs.length) return fail("주소를 찾지 못함");
      if (addrs.some(isPrivateHost)) return { state: "blocked" };
    }
    const res = await Promise.race([
      (deps.fetchImpl ?? fetch)(`${origin}/api/review-status`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "manual",
        cache: "no-store",
        signal: ctrl.signal,
      }),
      timeout,
    ]);

    if (res.status === 401 || res.status === 403) return fail("인증 실패(토큰 확인)");
    if (res.status === 404) return fail("기능 꺼짐(404)");
    if (res.status !== 200) return fail(`응답 ${res.status}`);
    const text = await Promise.race([res.text(), timeout]);

    if (text.length > MAX_BODY) return fail("응답이 너무 큼");
    let body: Record<string, unknown>;

    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return fail("응답 형식 오류");
    }
    if (!body || typeof body !== "object" || !nonNegInt(body.review) || !nonNegInt(body.held) || !nonNegInt(body.pending)) return fail("응답 형식 오류");
    const updatedAt = typeof body.updatedAt === "string" && !Number.isNaN(Date.parse(body.updatedAt)) ? new Date(body.updatedAt).toISOString() : null;

    return { state: "ok", review: body.review, held: body.held, pending: body.pending, updatedAt, checkedAt: checkedAt() };
  } catch (e) {
    return fail((e as Error)?.name === "AbortError" || ctrl.signal.aborted ? "시간 초과(3초)" : "연결 실패");
  } finally {
    clearTimeout(timer);
  }
}

export interface ReviewStatusRow {
  appSlug: string;
  url: string;
  tokenName: string;
  status: ReviewStatus;
}

/** 출시 대상 앱 중 검수 페이지 주소가 있는 앱 전부(병렬). 관리자 라우트에서만 부른다. */
export async function reviewStatusList(deps: ReviewDeps = {}): Promise<ReviewStatusRow[]> {
  const apps = await prisma.factoryApp.findMany({ where: { storeTarget: true, reviewUrl: { not: null } }, select: { appSlug: true, reviewUrl: true } });

  return Promise.all(
    apps.map(async (a) => ({
      appSlug: a.appSlug,
      url: a.reviewUrl as string,
      tokenName: reviewTokenName(a.appSlug),
      status: await reviewStatusOf(a.appSlug, a.reviewUrl as string, deps).catch((): ReviewStatus => ({ state: "error", reason: "확인 실패", checkedAt: new Date().toISOString() })),
    })),
  );
}
