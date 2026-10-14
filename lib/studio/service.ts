// lib/studio/service.ts
// 공용 스튜디오 [운영] 탭의 '서비스 운영'(3-3): 서비스(예: 한 컷 서버)가 열어 둔 관리자 API 를 읽기만 해서 확인한 표와, 있는 API 만 부르는 호출기.
// - 표(SERVICE_PROFILES)는 서비스 앱 폴더의 코드·문서를 읽어 만든 것이다(2026-10-15, one-tiny-frame server/src/*.ts · docs/api.md · docs/deploy.md). 서비스 코드가 바뀌면 같이 고친다.
// - 부르는 쪽은 홈페이지 서버뿐이다. 관리자 키(SERVICE_ADMIN_TOKEN_<앱>)는 서버 보관 키로 읽고(readServerSecret) 응답·로그·화면에 값을 내지 않는다.
// - 서비스 DB 는 건드리지 않는다. API 가 있는 기능만 부른다. 사설망·로컬 주소는 부르지 않는다(SSRF 방지, 리다이렉트도 따라가지 않음).
import { isPrivateHost } from "@/lib/factory/reviewStatus";

export type CapabilityKey = "schedule-toggle" | "run-now" | "gen-log" | "approve-candidate" | "review-count" | "upload";
export type CapabilityAuth = "admin" | "review";

export interface Capability {
  key: CapabilityKey;
  label: string;
  /** 홈페이지가 부를 수 있는 JSON API. null 이면 '서비스에 API 없음' */
  api: { method: "GET" | "POST"; path: string; auth: CapabilityAuth } | null;
  /** 코드를 읽어 확인한 근거(있는 것·없는 것) */
  evidence: string;
}

export interface ServiceProfile {
  appSlug: string;
  name: string;
  server: "serverpc" | "serverpc2";
  container: string;
  checkedAt: string; // 코드를 읽은 날짜
  capabilities: Capability[];
  /** 서비스가 스스로 만드는 일정이 있으면 한 줄(없으면 null). 스튜디오 일정과 겹침 경고에 쓴다 */
  ownSchedule: string | null;
}

const ONE_TINY_FRAME: ServiceProfile = {
  appSlug: "one-tiny-frame",
  name: "하찮은 한 컷 서버",
  server: "serverpc2",
  container: "one-tiny-frame-api-1",
  checkedAt: "2026-10-15",
  ownSchedule: "매주 월요일 10:00(한국 시간) 재고 채우기, 관리자 화면의 '자동 실행'이 켜져 있을 때만",
  capabilities: [
    {
      key: "schedule-toggle",
      label: "생성 일정 켜기·끄기",
      api: null,
      evidence: "POST /admin/pipeline/auto (form, on=1/0) 는 있지만 관리자 화면 전용이에요: 쿠키 로그인(ADMIN_TOKEN 입력)이 필요하고 응답이 리다이렉트예요. 토큰으로 부를 수 있는 JSON API가 없어요. 현재 켜짐 여부를 읽는 API도 없어요.",
    },
    {
      key: "run-now",
      label: "지금 실행",
      api: null,
      evidence: "POST /admin/pipeline/request (form, kind·lines) 는 있지만 같은 이유로 관리자 화면 전용이에요(쿠키 로그인, 리다이렉트 응답). 실행 중 여부(jobState)를 읽는 API도 없어요.",
    },
    {
      key: "gen-log",
      label: "생성 기록(gen_log)",
      api: null,
      evidence: "gen_log 표는 있고 recentLogs()로 /admin 화면에만 그려요. 읽는 JSON API가 없어요.",
    },
    {
      key: "approve-candidate",
      label: "후보 승인",
      api: null,
      evidence: "POST /admin/cuts/:id/approve · reject · retry 는 있지만 관리자 화면 전용이에요(쿠키 로그인, 리다이렉트 응답). 후보 목록을 읽는 API도 없어요. /worker/* 는 작업 PC 전용 토큰이라 홈페이지가 쓰지 않아요.",
    },
    {
      key: "review-count",
      label: "검수 대기 개수",
      api: { method: "GET", path: "/api/review-status", auth: "review" },
      evidence: "GET /api/review-status (Authorization: Bearer REVIEW_STATUS_TOKEN) → { review, held, pending, updatedAt }. 읽기 전용이고 개수만 줘요. 이미 출시 카드가 같은 API를 써요.",
    },
    {
      key: "upload",
      label: "서비스 업로드(그림 받기)",
      api: null,
      evidence: "그림을 받는 API가 없어요. 컷 그림은 서비스 안의 파이프라인이 만들고, /worker/rounds/:id/upload 는 로컬 채점 라운드 전용(작업 PC 토큰)이에요.",
    },
  ],
};

export const SERVICE_PROFILES: Record<string, ServiceProfile> = { "one-tiny-frame": ONE_TINY_FRAME };
export const serviceProfileOf = (appSlug: string): ServiceProfile | null => SERVICE_PROFILES[appSlug] ?? null;

/** 서비스 관리자 키 이름: 예 one-tiny-frame → SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME (서버 보관 키) */
export const SERVICE_ADMIN_PREFIX = "SERVICE_ADMIN_TOKEN_";
export const serviceAdminKeyName = (appSlug: string) => `${SERVICE_ADMIN_PREFIX}${appSlug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

export type KeyState = "ready" | "missing" | "not-needed";

/** 없는 기능마다 '한 컷 앱에 추가할 API' 제안이 필요한지 */
export const missingCapabilities = (p: ServiceProfile): Capability[] => p.capabilities.filter((c) => !c.api);

// ───────── 호출기 ─────────

export const SERVICE_TIMEOUT_MS = 5000;
export const SERVICE_MAX_BODY = 16_384;

export interface ServiceCallDeps {
  fetchImpl?: typeof fetch;
  lookupImpl?: (host: string) => Promise<string[]>;
  readSecret?: (name: string) => Promise<string | null>;
  timeoutMs?: number;
}

export type ServiceResult =
  | { state: "ok"; data: unknown; status: number }
  | { state: "no-api" } // 서비스에 API 없음
  | { state: "need-key"; keyName: string } // 키 등록 필요
  | { state: "blocked"; reason: string } // 주소가 안전하지 않아 부르지 않음
  | { state: "error"; reason: string };

/** 주소 검사: https 만, 계정 정보·사설망 금지. 통과하면 origin */
export function serviceOrigin(raw: string | null | undefined): { ok: true; origin: string } | { ok: false; reason: string } {
  if (!raw) return { ok: false, reason: "서비스 주소가 정해져 있지 않아요(출시 카드의 검수 페이지 주소나 프로젝트 연결의 도메인을 정해 주세요)." };
  let u: URL;

  try {
    u = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: "서비스 주소가 올바르지 않아요." };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "서비스 주소는 https 여야 해요." };
  if (u.username || u.password) return { ok: false, reason: "주소에 아이디·비밀번호를 넣을 수 없어요." };
  if (isPrivateHost(u.hostname)) return { ok: false, reason: "사설망·로컬 주소는 부르지 않아요." };

  return { ok: true, origin: u.origin };
}

const tokenName = (cap: Capability, appSlug: string) => (cap.api?.auth === "review" ? `REVIEW_STATUS_TOKEN_${appSlug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}` : serviceAdminKeyName(appSlug));

/**
 * 서비스 API 한 번 호출. API 가 없으면 부르지 않고 no-api, 키가 없으면 need-key(멈춘다). 던지지 않는다.
 * 응답 본문은 JSON 만 받고 16KB 까지. 키 값은 어디에도 내지 않는다.
 */
export async function callService(profile: ServiceProfile, key: CapabilityKey, base: string | null | undefined, deps: ServiceCallDeps = {}, body?: unknown): Promise<ServiceResult> {
  const cap = profile.capabilities.find((c) => c.key === key);

  if (!cap?.api) return { state: "no-api" };
  const origin = serviceOrigin(base);

  if (origin.ok === false) return { state: "blocked", reason: origin.reason };
  const name = tokenName(cap, profile.appSlug);
  const token = await (deps.readSecret ?? defaultReadSecret)(name).catch(() => null);

  if (!token) return { state: "need-key", keyName: name };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? SERVICE_TIMEOUT_MS);

  try {
    const host = new URL(origin.origin).hostname;

    if (deps.lookupImpl) {
      const addrs = await deps.lookupImpl(host);

      if (!addrs.length) return { state: "error", reason: "주소를 찾지 못함" };
      if (addrs.some(isPrivateHost)) return { state: "blocked", reason: "사설망 주소로 풀려서 부르지 않아요." };
    }
    const res = await (deps.fetchImpl ?? fetch)(`${origin.origin}${cap.api.path}`, {
      method: cap.api.method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      cache: "no-store",
      signal: ctrl.signal,
    });

    if (res.status === 401 || res.status === 403) return { state: "error", reason: "인증 실패(키 확인)" };
    if (res.status === 404) return { state: "no-api" };
    if (res.status < 200 || res.status >= 300) return { state: "error", reason: `응답 ${res.status}` };
    const text = await res.text();

    if (text.length > SERVICE_MAX_BODY) return { state: "error", reason: "응답이 너무 큼" };

    try {
      return { state: "ok", status: res.status, data: JSON.parse(text) };
    } catch {
      return { state: "error", reason: "응답 형식 오류(JSON 아님)" };
    }
  } catch (e) {
    return { state: "error", reason: (e as Error)?.name === "AbortError" ? "시간 초과" : "연결 실패" };
  } finally {
    clearTimeout(timer);
  }
}

async function defaultReadSecret(name: string): Promise<string | null> {
  const { readServerSecret } = await import("@/lib/factory/secretEntries");

  return readServerSecret(name);
}

// ───────── 화면에 줄 요약 ─────────

export interface CapabilityView {
  key: CapabilityKey;
  label: string;
  present: boolean;
  api: string | null; // "GET /api/review-status"
  evidence: string;
  keyName: string | null; // 필요한 키 이름(값 아님)
  keyReady: boolean | null;
}

export interface ServiceView {
  appSlug: string;
  name: string;
  server: string;
  container: string;
  checkedAt: string;
  baseLabel: string; // 서비스 주소의 호스트(없으면 빈 글자)
  baseProblem: string | null;
  capabilities: CapabilityView[];
  ownSchedule: string | null;
  reviewCount: { state: "ok"; review: number; held: number; pending: number } | { state: "unavailable"; text: string } | null;
  adminKey: { name: string; ready: boolean };
  proposal: string; // 한 컷 앱에 추가할 API 제안 문서 위치
}

export const SERVICE_PROPOSAL_DOC = "docs/studio-service-api.md";

/** 키 보관 상태를 합쳐 화면용으로 */
export function buildServiceView(args: { profile: ServiceProfile; base: string | null | undefined; keysReady: ReadonlySet<string>; reviewCount: ServiceView["reviewCount"] }): ServiceView {
  const { profile } = args;
  const origin = serviceOrigin(args.base);

  return {
    appSlug: profile.appSlug,
    name: profile.name,
    server: profile.server === "serverpc2" ? "서버2(serverpc2)" : "서버1(serverpc)",
    container: profile.container,
    checkedAt: profile.checkedAt,
    baseLabel: origin.ok ? new URL(origin.origin).host : "",
    baseProblem: origin.ok === true ? null : origin.reason,
    capabilities: profile.capabilities.map((c) => {
      const keyName = c.api ? tokenName(c, profile.appSlug) : null;

      return { key: c.key, label: c.label, present: !!c.api, api: c.api ? `${c.api.method} ${c.api.path}` : null, evidence: c.evidence, keyName, keyReady: keyName ? args.keysReady.has(keyName) : null };
    }),
    ownSchedule: profile.ownSchedule,
    reviewCount: args.reviewCount,
    adminKey: { name: serviceAdminKeyName(profile.appSlug), ready: args.keysReady.has(serviceAdminKeyName(profile.appSlug)) },
    proposal: SERVICE_PROPOSAL_DOC,
  };
}
