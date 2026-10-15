// lib/studio/serviceHealth.ts
// 스튜디오 ↔ 서비스(한 컷) 연결 상태: 도메인 응답·응답 시간 · HTTPS 인증서 만료일 · 키 등록 여부 · GET /api/admin/health 결과 · 마지막 확인 시각.
// - 확인은 [지금 확인] 버튼과 10분 캐시(메모리 + factory_settings 에 마지막 결과 한 줄)로 한다. 화면을 열 때마다 서비스를 부르지 않는다.
// - 인증서 만료가 7일 이하로 남으면(이미 만료 포함) 통제실 할 일(inbox)과 텔레그램에 한 번 알린다(같은 인증서 만료일이면 한 번만).
// - 서비스는 홈페이지 서버만 부른다. 키 값은 읽어도 결과에 담지 않는다(이름과 등록 여부만). 사설망·로컬 주소는 부르지 않는다.
// - 서비스 DB·서버 설정(nginx·인증서 파일)은 건드리지 않는다. 읽기만 한다.
import { callServiceApi, certProblem, reviewKeyName, serviceAdminKeyName, serviceOrigin, SERVICE_PROFILES, serviceProfileOf } from "@/lib/studio/service";
import { isPrivateHost } from "@/lib/factory/reviewStatus";

export const HEALTH_TTL_MS = 10 * 60_000;
export const CERT_WARN_DAYS = 14; // 이하면 경고(노란색)
export const CERT_ALERT_DAYS = 7; // 이하면 통제실 할 일 + 텔레그램 한 번
export const HEALTH_KEY_PREFIX = "serviceHealth:";
const PROBE_TIMEOUT_MS = 5000;
const DAY_MS = 24 * 3600 * 1000;

export type CertState = "ok" | "warn" | "expired" | "unknown";
export type DomainState = "ok" | "slow" | "error" | "down" | "blocked" | "no-base";
export type ApiState = "ok" | "no-api" | "need-key" | "blocked" | "error" | "skipped";

export interface ServiceHealth {
  appSlug: string;
  checkedAt: string; // ISO — 마지막 확인 시각
  base: string; // 서비스 주소의 호스트(없으면 빈 글자)
  domain: { state: DomainState; ms: number | null; status: number | null; text: string };
  cert: { state: CertState; validTo: string | null; daysLeft: number | null; text: string };
  keys: { review: { name: string; ready: boolean }; admin: { name: string; ready: boolean } };
  api: { state: ApiState; text: string; info: Record<string, string | number | boolean> };
}

// ───────── 순수 계산(시험이 직접 부른다) ─────────

/** 만료일까지 남은 날수(오늘 포함 내림). 만료됐으면 음수 */
export function daysUntil(validTo: Date | string | number, now: number): number {
  return Math.floor((new Date(validTo).getTime() - now) / DAY_MS);
}

/** 14일 이하면 경고, 만료면 빨강(expired) */
export function certState(daysLeft: number | null): CertState {
  if (daysLeft === null || !Number.isFinite(daysLeft)) return "unknown";
  if (daysLeft < 0) return "expired";

  return daysLeft <= CERT_WARN_DAYS ? "warn" : "ok";
}

export function certText(daysLeft: number | null, validTo: string | null): string {
  if (daysLeft === null || !validTo) return "인증서 만료일을 확인하지 못했어요";
  const day = validTo.slice(0, 10);

  if (daysLeft < 0) return `인증서 만료됨 (${day}, ${-daysLeft}일 지남)`;

  return `인증서 만료일 ${day} (남은 ${daysLeft}일)${daysLeft <= CERT_WARN_DAYS ? " — 갱신이 필요해요" : ""}`;
}

/** 통제실 할 일·텔레그램으로 알릴 만료 임박(7일 이하·만료)인지 */
export function certAlert(h: Pick<ServiceHealth, "appSlug" | "cert"> | null): { appSlug: string; daysLeft: number; validTo: string } | null {
  if (!h || h.cert.daysLeft === null || !h.cert.validTo) return null;

  return h.cert.daysLeft <= CERT_ALERT_DAYS ? { appSlug: h.appSlug, daysLeft: h.cert.daysLeft, validTo: h.cert.validTo } : null;
}

/** 알림 이름: 같은 인증서(만료일)면 한 번만, 갱신하면 새로 알린다 */
export const certNoticeKey = (appSlug: string, validTo: string) => `servicecert:${appSlug}:${validTo.slice(0, 10)}`;

export function certAlertText(appSlug: string, name: string, daysLeft: number, validTo: string): string {
  return daysLeft < 0
    ? `🔒 ${name}(${appSlug}) HTTPS 인증서가 만료됐어요 (${validTo.slice(0, 10)}). 서비스 주소에 접속하면 오류가 나고, 공장이 이 서버의 그림을 받으면 실패해요. 서버 인증서를 갱신해 주세요.`
    : `🔒 ${name}(${appSlug}) HTTPS 인증서가 ${daysLeft}일 뒤(${validTo.slice(0, 10)}) 만료돼요. 서버 인증서 갱신을 준비해 주세요.`;
}

const INFO_KEYS = ["ok", "status", "version", "commit", "db", "uptime", "time", "env"];

/** health 응답에서 화면에 보여 줄 짧은 값만(문자·숫자·불리언, 40자). 키·토큰처럼 보이는 이름은 버린다 */
export function healthInfo(data: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};

  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const k of INFO_KEYS) {
    const v = (data as Record<string, unknown>)[k];

    if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
    else if (typeof v === "string") out[k] = v.replace(/[\u0000-\u001f]+/g, " ").slice(0, 40);
  }

  return out;
}

// ───────── 한 번 확인 ─────────

export interface TlsProbeResult {
  validTo: string | null; // ISO
  authorized: boolean;
  error: string | null;
}

export interface HealthDeps {
  fetchImpl?: typeof fetch;
  lookupImpl?: (host: string) => Promise<string[]>;
  tlsProbe?: (host: string, ip: string, port: number, timeoutMs: number) => Promise<TlsProbeResult>;
  readSecret?: (name: string) => Promise<string | null>;
  keysReady?: (names: string[]) => Promise<ReadonlySet<string>>;
  now?: () => number;
  timeoutMs?: number;
  base?: string | null; // 서비스 주소를 직접 주면 DB 에서 찾지 않는다(시험용)
}

async function defaultLookup(host: string): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");

  return (await lookup(host, { all: true })).map((a) => a.address);
}

/** 인증서가 만료·불일치여도 만료일을 읽도록 검증은 끄고(rejectUnauthorized:false) 결과로 판단만 한다. 읽기만 하고 데이터는 보내지 않는다 */
async function defaultTlsProbe(host: string, ip: string, port: number, timeoutMs: number): Promise<TlsProbeResult> {
  const tls = await import("node:tls");

  return new Promise((resolve) => {
    let done = false;
    const finish = (r: TlsProbeResult) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(r);
    };
    const socket = tls.connect({ host: ip, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const c = socket.getPeerCertificate();
      const to = c && typeof c.valid_to === "string" ? new Date(c.valid_to) : null;

      finish({ validTo: to && !Number.isNaN(to.getTime()) ? to.toISOString() : null, authorized: socket.authorized, error: socket.authorizationError ? String(socket.authorizationError) : null });
    });

    socket.on("timeout", () => finish({ validTo: null, authorized: false, error: "시간 초과" }));
    socket.on("error", (e) => finish({ validTo: null, authorized: false, error: (e as Error).message?.slice(0, 80) || "연결 실패" }));
  });
}

async function defaultKeysReady(names: string[]): Promise<ReadonlySet<string>> {
  const { default: prisma } = await import("@/lib/prisma");
  const rows = await prisma.factorySecretEntry.findMany({ where: { name: { in: names }, status: "stored" }, select: { name: true } });

  return new Set(rows.map((r) => r.name));
}

/** 서비스 주소: 출시 카드의 검수 페이지 주소 → 프로젝트 연결의 도메인 (opsData.serviceBase 와 같은 규칙) */
export async function resolveServiceBase(appSlug: string): Promise<string | null> {
  const { default: prisma } = await import("@/lib/prisma");
  const [app, conn] = await Promise.all([prisma.factoryApp.findUnique({ where: { appSlug }, select: { reviewUrl: true } }).catch(() => null), prisma.factoryAppConnection.findUnique({ where: { appSlug }, select: { domain: true } }).catch(() => null)]);

  if (app?.reviewUrl) {
    try {
      return new URL(app.reviewUrl).origin;
    } catch {
      /* 아래로 */
    }
  }

  return conn?.domain ?? null;
}

const clip = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 120);

/** 서비스 하나를 지금 확인한다(캐시 없음). 던지지 않는다 */
export async function probeServiceHealth(appSlug: string, base: string | null | undefined, deps: HealthDeps = {}): Promise<ServiceHealth> {
  const now = deps.now ?? Date.now;
  const started = now();
  const reviewName = reviewKeyName(appSlug);
  const adminName = serviceAdminKeyName(appSlug);
  const ready = await (deps.keysReady ?? defaultKeysReady)([reviewName, adminName]).catch(() => new Set<string>());
  const out: ServiceHealth = {
    appSlug,
    checkedAt: new Date(started).toISOString(),
    base: "",
    domain: { state: "no-base", ms: null, status: null, text: "" },
    cert: { state: "unknown", validTo: null, daysLeft: null, text: "인증서 만료일을 확인하지 못했어요" },
    keys: { review: { name: reviewName, ready: ready.has(reviewName) }, admin: { name: adminName, ready: ready.has(adminName) } },
    api: { state: "skipped", text: "도메인을 확인하지 못해 건너뛰었어요.", info: {} },
  };
  const origin = serviceOrigin(base);

  if (origin.ok === false) {
    out.domain.text = origin.reason;
    out.api = { state: "blocked", text: origin.reason, info: {} };

    return out;
  }
  const url = new URL(origin.origin);

  out.base = url.host;
  const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
  let addrs: string[] = [];

  try {
    addrs = await (deps.lookupImpl ?? defaultLookup)(url.hostname);
  } catch {
    addrs = [];
  }
  if (!addrs.length) {
    out.domain = { state: "down", ms: null, status: null, text: "주소를 찾지 못했어요(도메인 DNS)" };

    return out;
  }
  if (addrs.some(isPrivateHost)) {
    out.domain = { state: "blocked", ms: null, status: null, text: "사설망 주소로 풀려서 확인하지 않았어요" };
    out.api = { state: "blocked", text: "사설망 주소로 풀려서 부르지 않았어요", info: {} };

    return out;
  }

  // 인증서 만료일
  const cert = await (deps.tlsProbe ?? defaultTlsProbe)(url.hostname, addrs[0], Number(url.port) || 443, timeoutMs).catch(() => ({ validTo: null, authorized: false, error: "확인 실패" }) as TlsProbeResult);

  if (cert.validTo) {
    const days = daysUntil(cert.validTo, started);

    out.cert = { state: certState(days), validTo: cert.validTo, daysLeft: days, text: certText(days, cert.validTo) };
  } else out.cert.text = cert.error ? `인증서 만료일을 확인하지 못했어요 (${clip(cert.error)})` : out.cert.text;

  // 도메인 응답과 시간(어떤 HTTP 응답이든 서버가 답하면 '응답함', 5xx 는 오류로 표시)
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = now();

  try {
    const res = await (deps.fetchImpl ?? fetch)(`${origin.origin}/`, { method: "GET", redirect: "manual", cache: "no-store", signal: ctrl.signal });
    const ms = Math.max(0, now() - t0);

    await (res as { body?: { cancel?: () => Promise<void> } }).body?.cancel?.().catch(() => {});
    out.domain = res.status >= 500 ? { state: "error", ms, status: res.status, text: `서버 오류 응답 ${res.status} (${ms}ms)` } : { state: ms > 3000 ? "slow" : "ok", ms, status: res.status, text: `응답함 ${res.status} (${ms}ms)${ms > 3000 ? " — 느려요" : ""}` };
  } catch (e) {
    const reason = (e as Error)?.name === "AbortError" ? "시간 초과" : (certProblem(e) ?? "연결 실패");

    out.domain = { state: "down", ms: null, status: null, text: `응답 없음 — ${reason}` };
    if (reason === "인증서 만료" && out.cert.state !== "expired") out.cert = { ...out.cert, state: "expired", text: out.cert.validTo ? certText(out.cert.daysLeft, out.cert.validTo) : "인증서가 만료됐어요" };
  } finally {
    clearTimeout(timer);
  }

  // 서비스 health API (관리자 키)
  if (out.domain.state === "down") {
    out.api = { state: "skipped", text: "도메인이 응답하지 않아 건너뛰었어요.", info: {} };

    return out;
  }
  const r = await callServiceApi({ appSlug, auth: "admin", method: "GET", path: "/api/admin/health" }, origin.origin, { fetchImpl: deps.fetchImpl, readSecret: deps.readSecret, lookupImpl: async () => addrs, timeoutMs });

  if (r.state === "ok") out.api = { state: "ok", text: "정상 응답", info: healthInfo(r.data) };
  else if (r.state === "no-api") out.api = { state: "no-api", text: "서비스 API 없음", info: {} };
  else if (r.state === "need-key") out.api = { state: "need-key", text: `키 등록 필요: ${r.keyName}`, info: {} };
  else out.api = { state: r.state === "blocked" ? "blocked" : "error", text: clip(r.reason), info: {} };

  return out;
}

// ───────── 캐시 · 저장 ─────────

const mem = new Map<string, { at: number; health: ServiceHealth }>();

/** 시험용: 메모리 캐시 비우기 */
export const resetHealthCache = () => {
  mem.clear();
  lastTick = 0;
};

const isHealth = (v: unknown): v is ServiceHealth => {
  const o = v as ServiceHealth | null;

  return !!o && typeof o === "object" && typeof o.appSlug === "string" && typeof o.checkedAt === "string" && !!o.domain && !!o.cert && !!o.keys && !!o.api;
};

async function persist(h: ServiceHealth): Promise<void> {
  try {
    const { default: prisma } = await import("@/lib/prisma");
    const value = JSON.stringify(h);

    await prisma.factorySetting.upsert({ where: { key: `${HEALTH_KEY_PREFIX}${h.appSlug}` }, create: { key: `${HEALTH_KEY_PREFIX}${h.appSlug}`, value }, update: { value } });
  } catch {
    /* 저장 못 해도 메모리 캐시는 쓴다 */
  }
}

/** 확인 없이, 저장된 마지막 결과만(메모리 → DB). 없으면 null. 통제실 표·할 일이 쓴다 */
export async function peekServiceHealth(appSlug: string): Promise<ServiceHealth | null> {
  const hit = mem.get(appSlug);

  if (hit) return hit.health;
  try {
    const { default: prisma } = await import("@/lib/prisma");
    const row = await prisma.factorySetting.findUnique({ where: { key: `${HEALTH_KEY_PREFIX}${appSlug}` } });
    const v = row ? (JSON.parse(row.value) as unknown) : null;

    return isHealth(v) ? v : null;
  } catch {
    return null;
  }
}

/** 마지막 결과가 10분 안이면 그대로, 아니면(또는 force) 새로 확인해 저장한다. 서비스 확인표가 없는 앱은 null */
export async function getServiceHealth(appSlug: string, opts: { force?: boolean; deps?: HealthDeps } = {}): Promise<ServiceHealth | null> {
  if (!serviceProfileOf(appSlug)) return null;
  const now = (opts.deps?.now ?? Date.now)();
  const hit = mem.get(appSlug);

  if (!opts.force && hit && now - hit.at < HEALTH_TTL_MS) return hit.health;
  if (!opts.force && !hit) {
    const saved = await peekServiceHealth(appSlug);

    if (saved && now - new Date(saved.checkedAt).getTime() < HEALTH_TTL_MS) {
      mem.set(appSlug, { at: new Date(saved.checkedAt).getTime(), health: saved });

      return saved;
    }
  }
  const base = opts.deps && "base" in opts.deps ? opts.deps.base : await resolveServiceBase(appSlug).catch(() => null);
  const health = await probeServiceHealth(appSlug, base, opts.deps);

  mem.set(appSlug, { at: now, health });
  await persist(health);

  return health;
}

// ───────── 정기 확인 + 만료 임박 알림 ─────────

let lastTick = 0;

/** 다른 요청 길목에서 부르는 가벼운 확인(10분에 한 번만, 기다리지 않아도 됨, 던지지 않음). 만료 7일 이하면 텔레그램에 한 번 알린다 */
export async function tickServiceHealth(now = Date.now(), force = false, deps: HealthDeps = {}): Promise<void> {
  if (!force && now - lastTick < HEALTH_TTL_MS) return;
  lastTick = now;
  try {
    for (const slug of Object.keys(SERVICE_PROFILES)) {
      const h = await getServiceHealth(slug, { force: true, deps: { ...deps, now: () => now } });
      const alert = certAlert(h);

      if (h && alert) {
        const { notifyOnce } = await import("@/lib/factory/telegram");

        await notifyOnce(certNoticeKey(slug, alert.validTo), certAlertText(slug, SERVICE_PROFILES[slug].name, alert.daysLeft, alert.validTo), `/studio/${slug}?tab=ops&sub=service`);
      }
    }
  } catch {
    console.error("[studio] 서비스 연결 상태 확인 실패");
  }
}

/** 통제실 할 일(inbox)이 읽는 만료 임박 목록: 저장된 마지막 결과 기준(확인은 하지 않는다) */
export async function readCertAlerts(): Promise<{ appSlug: string; name: string; daysLeft: number; validTo: string }[]> {
  const out: { appSlug: string; name: string; daysLeft: number; validTo: string }[] = [];

  for (const [slug, p] of Object.entries(SERVICE_PROFILES)) {
    const a = certAlert(await peekServiceHealth(slug));

    // 저장된 날수는 확인한 시점 기준이라, 지금 기준으로 다시 센다
    if (a) out.push({ appSlug: slug, name: p.name, daysLeft: daysUntil(a.validTo, Date.now()), validTo: a.validTo });
  }

  return out;
}
