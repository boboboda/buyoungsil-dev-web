// lib/studio/service.ts
// 공용 스튜디오 [운영] 탭의 '서비스 운영'(3-3): 서비스(예: 한 컷 서버)가 열어 둔 관리자 API 를 읽기만 해서 확인한 표와, 있는 API 만 부르는 호출기.
// - 표(SERVICE_PROFILES)는 서비스 앱 폴더의 코드·문서를 읽어 만든 것이다(2026-10-15, one-tiny-frame server/src/*.ts · docs/api.md · docs/deploy.md). 서비스 코드가 바뀌면 같이 고친다.
//   `api` 는 '홈페이지가 부를 경로'다. 서비스에 그 경로가 아직 없으면(404) 호출기가 no-api 로 돌려주고 화면은 '서비스 API 없음'으로 보여 주며 버튼을 끈다.
// - 부르는 쪽은 홈페이지 서버뿐이다. 관리자 키(SERVICE_ADMIN_TOKEN_<앱>)는 서버 보관 키로 읽고(readServerSecret) 응답·로그·화면에 값을 내지 않는다.
// - 서비스 DB 는 건드리지 않는다. API 가 있는 기능만 부른다. 사설망·로컬 주소는 부르지 않는다(SSRF 방지, 리다이렉트도 따라가지 않음).
import { isPrivateHost } from "@/lib/factory/reviewStatus";
import type { ServiceHealth } from "@/lib/studio/serviceHealth";

export type CapabilityKey = "health" | "pipeline-state" | "schedule-toggle" | "run-now" | "gen-log" | "approve-candidate" | "review-count" | "upload";
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
      key: "health",
      label: "서비스 상태(health)",
      api: { method: "GET", path: "/api/admin/health", auth: "admin" },
      evidence: "GET /api/admin/health (Authorization: Bearer SERVICE_ADMIN_TOKEN). 한 컷 앱 일감이 추가하는 JSON API예요. 서비스에 아직 없으면 404라서 '서비스 API 없음'으로 보여요.",
    },
    {
      key: "pipeline-state",
      label: "생성 일정·실행 상태 읽기",
      api: { method: "GET", path: "/api/admin/pipeline", auth: "admin" },
      evidence: "GET /api/admin/pipeline → { auto, running, weekly }. 기존 /admin/pipeline/* 는 쿠키 로그인 화면 전용이라 JSON API를 따로 추가해요(docs/studio-service-api.md).",
    },
    {
      key: "schedule-toggle",
      label: "생성 일정 켜기·끄기",
      api: { method: "POST", path: "/api/admin/pipeline/auto", auth: "admin" },
      evidence: "POST /api/admin/pipeline/auto { on } → 위 상태. 서비스에 없으면 404 → 서비스 API 없음.",
    },
    {
      key: "run-now",
      label: "지금 실행",
      api: { method: "POST", path: "/api/admin/pipeline/run", auth: "admin" },
      evidence: "POST /api/admin/pipeline/run { kind, lines? } → 202 / 409 busy. 서비스에 없으면 404 → 서비스 API 없음.",
    },
    {
      key: "gen-log",
      label: "생성 기록(gen_log)",
      api: { method: "GET", path: "/api/admin/gen-log", auth: "admin" },
      evidence: "GET /api/admin/gen-log?limit=50 → { items: [{ id, at, step, cutId, ok, detail }] }. 프롬프트·키 없는 요약만 와요.",
    },
    {
      key: "approve-candidate",
      label: "후보 목록·승인·반려·다시",
      api: { method: "GET", path: "/api/admin/candidates", auth: "admin" },
      evidence: "GET /api/admin/candidates?status=review|held|pending → { items: [{ id, line, image, imageUrl, status, days }] }, POST /api/admin/cuts/:id/approve|reject|retry. 서비스에 없으면 404 → 서비스 API 없음.",
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
      api: { method: "POST", path: "/api/admin/art-upload", auth: "admin" },
      evidence: "POST /api/admin/art-upload { items: [{ url, subject, kind, fileName }] } → { saved, skipped }. 서비스에 없으면 404 → 서비스 업로드 미지원.",
    },
  ],
};

export const SERVICE_PROFILES: Record<string, ServiceProfile> = { "one-tiny-frame": ONE_TINY_FRAME };
export const serviceProfileOf = (appSlug: string): ServiceProfile | null => SERVICE_PROFILES[appSlug] ?? null;

/** 서비스 관리자 키 이름: 예 one-tiny-frame → SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME (서버 보관 키) */
export const SERVICE_ADMIN_PREFIX = "SERVICE_ADMIN_TOKEN_";
export const serviceAdminKeyName = (appSlug: string) => `${SERVICE_ADMIN_PREFIX}${appSlug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

/** 검수 대기 개수용 키 이름: 예 one-tiny-frame → REVIEW_STATUS_TOKEN_ONE_TINY_FRAME (서버 보관 키) */
export const reviewKeyName = (appSlug: string) => `REVIEW_STATUS_TOKEN_${appSlug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

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

const tokenName = (cap: Capability, appSlug: string) => (cap.api?.auth === "review" ? reviewKeyName(appSlug) : serviceAdminKeyName(appSlug));

/**
 * 서비스 API 한 번 호출. API 가 없으면 부르지 않고 no-api, 키가 없으면 need-key(멈춘다). 던지지 않는다.
 * 응답 본문은 JSON 만 받고 16KB 까지. 키 값은 어디에도 내지 않는다.
 */
export async function callService(profile: ServiceProfile, key: CapabilityKey, base: string | null | undefined, deps: ServiceCallDeps = {}, body?: unknown, maxBody: number = SERVICE_MAX_BODY): Promise<ServiceResult> {
  const cap = profile.capabilities.find((c) => c.key === key);

  if (!cap?.api) return { state: "no-api" };

  return callServiceApi({ appSlug: profile.appSlug, auth: cap.api.auth, method: cap.api.method, path: cap.api.path }, base, deps, body, maxBody);
}

/** 서비스 경로 하나를 직접 부른다(배치 편집기처럼 서비스 표에 없는, 연결 설정에 적힌 경로). 안전 검사·키 읽기·응답 제한은 callService 와 같다 */
export async function callServiceApi(api: { appSlug: string; auth: CapabilityAuth; method: "GET" | "POST" | "PUT"; path: string }, base: string | null | undefined, deps: ServiceCallDeps = {}, body?: unknown, maxBody: number = SERVICE_MAX_BODY): Promise<ServiceResult> {
  const origin = serviceOrigin(base);

  if (origin.ok === false) return { state: "blocked", reason: origin.reason };
  const name = api.auth === "review" ? reviewKeyName(api.appSlug) : serviceAdminKeyName(api.appSlug);
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
    const res = await (deps.fetchImpl ?? fetch)(`${origin.origin}${api.path}`, {
      method: api.method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      cache: "no-store",
      signal: ctrl.signal,
    });

    if (res.status === 401 || res.status === 403) return { state: "error", reason: "인증 실패(키 확인)" };
    if (res.status === 404) return { state: "no-api" };
    if (res.status === 409) return { state: "error", reason: "서비스 쪽 배치가 그 사이에 바뀌었어요(409)" };
    if (res.status < 200 || res.status >= 300) return { state: "error", reason: `응답 ${res.status}` };
    const text = await res.text();

    if (text.length > maxBody) return { state: "error", reason: "응답이 너무 큼" };

    try {
      return { state: "ok", status: res.status, data: JSON.parse(text) };
    } catch {
      return { state: "error", reason: "응답 형식 오류(JSON 아님)" };
    }
  } catch (e) {
    return { state: "error", reason: (e as Error)?.name === "AbortError" ? "시간 초과" : certProblem(e) ?? "연결 실패" };
  } finally {
    clearTimeout(timer);
  }
}

/** fetch 오류의 원인 코드가 HTTPS 인증서 문제면 사람이 읽는 글자로(만료 포함). 아니면 null */
export function certProblem(e: unknown): string | null {
  const code = String((e as { cause?: { code?: unknown } })?.cause?.code ?? (e as { code?: unknown })?.code ?? "");

  if (code === "CERT_HAS_EXPIRED") return "인증서 만료";
  if (/^(UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|ERR_TLS_CERT_ALTNAME_INVALID|CERT_[A-Z_]+)$/.test(code)) return "인증서 오류";

  return null;
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
  health: ServiceHealth | null; // 연결 상태(도메인·인증서·키·health API). 확인 전이면 null
  proposal: string; // 한 컷 앱에 추가할 API 제안 문서 위치
}

export const SERVICE_PROPOSAL_DOC = "docs/studio-service-api.md";

/** 키 보관 상태를 합쳐 화면용으로 */
export function buildServiceView(args: { profile: ServiceProfile; base: string | null | undefined; keysReady: ReadonlySet<string>; reviewCount: ServiceView["reviewCount"]; health?: ServiceHealth | null }): ServiceView {
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
    health: args.health ?? null,
    proposal: SERVICE_PROPOSAL_DOC,
  };
}
