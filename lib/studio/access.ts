// lib/studio/access.ts
// Studio 접근 키: 통제실에서 앱 이름별로 발급·폐기하고, 서버1 nginx 가 auth_request 로 /api/studio-auth/verify 에 물어본다. docs/studio-access.md
// - 키 원문은 발급 응답에서 딱 한 번만 나간다. DB 에는 HMAC-SHA256(서버 비밀값, 키) hex 만 둔다.
// - 서버 비밀값: 환경변수 STUDIO_KEY_PEPPER → 없으면 통제실 '외부 서비스 키'에 등록한 서버 보관 키 STUDIO_KEY_PEPPER
//   → 그것도 없으면 로그인용 시크릿 NEXTAUTH_SECRET(없으면 AUTH_SECRET)에서 HKDF-SHA256(info "studio-access-key-v1")으로 유도한 값.
//   유도에 쓴 시크릿이 바뀌면 이미 발급한 키는 모두 무효가 된다. 셋 다 없으면 발급·검증 불가.
// - 키·해시·비밀값·Authorization 헤더 값은 로그·오류·응답 본문에 넣지 않는다.
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "crypto";

import prisma from "@/lib/prisma";
import { readServerSecret } from "@/lib/factory/secretEntries";

export const STUDIO_APP_RE = /^[a-z0-9-]{3,40}$/;
export const STUDIO_KEY_RE = /^stk_[A-Za-z0-9_-]{43}$/; // 32바이트 base64url
export const PEPPER_NAME = "STUDIO_KEY_PEPPER";
const MIN_PEPPER = 32;
const MIN_DERIVE_BASE = 16; // lib/factory/keyPasswords.ts 의 암호화 키와 같은 기준
const DERIVE_INFO = "studio-access-key-v1";
const PEPPER_CACHE_MS = 60_000;
const LAST_USED_EVERY_MS = 60_000;
const MAX_AUTH_HEADER = 1024;

// ───────── 서버 비밀값 ─────────

let pepperCache: { value: string | null; at: number } | null = null;

/**
 * STUDIO_KEY_PEPPER 가 없을 때 쓰는 이 용도 전용 값. 로그인 세션 서명용 NEXTAUTH_SECRET(없으면 middleware 가 쓰는 AUTH_SECRET)을
 * 그대로 쓰지 않고 HKDF-SHA256 으로 유도한다. 시크릿이 없거나 짧으면 null.
 */
function derivedPepper(): string | null {
  const base = process.env.NEXTAUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || "";

  if (base.length < MIN_DERIVE_BASE) return null;

  return Buffer.from(hkdfSync("sha256", base, "", DERIVE_INFO, 32)).toString("hex");
}

/** 해시용 서버 비밀값(STUDIO_KEY_PEPPER → 서버 보관 키 → 유도 값). 없으면 null. 1분 동안 기억한다. */
export async function getPepper(): Promise<string | null> {
  const now = Date.now();

  if (pepperCache && now - pepperCache.at < PEPPER_CACHE_MS) return pepperCache.value;
  const env = process.env[PEPPER_NAME]?.trim();
  let value: string | null = env && env.length >= MIN_PEPPER ? env : null;

  if (!value) {
    const stored = await readServerSecret(PEPPER_NAME).catch(() => null);

    value = stored && stored.length >= MIN_PEPPER ? stored : null;
  }
  if (!value) value = derivedPepper();
  pepperCache = { value, at: now };

  return value;
}

/** 통제실에서 비밀값을 막 등록했을 때 바로 반영되도록 기억을 지운다. */
export const forgetPepper = () => {
  pepperCache = null;
};

export const hashStudioKey = (pepper: string, key: string) => createHmac("sha256", pepper).update(key, "utf8").digest("hex");

export const generateStudioKey = () => `stk_${randomBytes(32).toString("base64url")}`;

// ───────── 요청 해석 ─────────

/** Authorization: Basic ... 의 비밀번호 칸(아이디 칸은 무시). 형식이 아니면 null. */
export function basicPassword(header: string | null): string | null {
  if (!header || header.length > MAX_AUTH_HEADER) return null;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);

  if (!m) return null;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const i = decoded.indexOf(":");

  return i < 0 ? null : decoded.slice(i + 1);
}

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

/** 같은 PC·사설망(도커 브리지 포함)에서 온 연결만 프록시로 믿는다. */
export function isTrustedProxy(addr: string): boolean {
  const a = addr.toLowerCase().replace(/^::ffff:/, "");

  return (
    a === "::1" ||
    a.startsWith("127.") ||
    a.startsWith("10.") ||
    a.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(a) ||
    /^f[cd][0-9a-f]{2}:/.test(a)
  );
}

/**
 * 실패 횟수를 셀 주소. 연결 주소는 x-forwarded-for 의 마지막 칸(nginx 가 지우면 Next 가 소켓 주소로 채운다).
 * X-Real-IP 는 연결 주소가 믿는 프록시일 때만 쓴다.
 */
export function studioClientIp(get: (name: string) => string | null): string {
  const hops = (get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const conn = hops.length ? hops[hops.length - 1] : "unknown";
  const real = get("x-real-ip")?.trim();

  if (real && IP_RE.test(real) && isTrustedProxy(conn)) return real;

  return IP_RE.test(conn) ? conn : "unknown";
}

/** 관리자 화면에서 보낸 요청인지(CSRF 방어). 쿠키를 싣고 다른 사이트에서 보낸 요청은 거절한다. */
export function isSameOriginRequest(get: (name: string) => string | null): boolean {
  const site = get("sec-fetch-site");

  if (site) return site === "same-origin";
  const host = get("x-forwarded-host") || get("host");
  const source = get("origin") || get("referer");

  if (!host || !source) return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

// ───────── 실패 제한(메모리, 서버 프로세스 안에서만. lib/factory/http.ts 의 hit 와 같은 방식) ─────────

export const FAIL_WINDOW_MS = 10 * 60_000;
export const FAIL_LIMIT = 10;
export const BLOCK_MS = 15 * 60_000;
export const APP_SLOW_AFTER = 30; // 앱 전체 실패가 10분에 이만큼 넘으면 실패 응답을 늦춘다
export const APP_SLOW_MS = 1500;

export function createFailLimiter(now: () => number = Date.now) {
  const ips = new Map<string, { start: number; count: number; until: number }>();
  const apps = new Map<string, { start: number; count: number }>();
  const prune = () => {
    const t = now();

    if (ips.size > 5000) for (const [k, v] of ips) if (v.until < t && t - v.start > FAIL_WINDOW_MS) ips.delete(k);
    if (apps.size > 1000) for (const [k, v] of apps) if (t - v.start > FAIL_WINDOW_MS) apps.delete(k);
  };

  return {
    /** 막힌 동안 남은 ms(0 이면 안 막힘) */
    blockedFor(ip: string): number {
      const e = ips.get(ip);

      return e ? Math.max(0, e.until - now()) : 0;
    },
    /** 실패 1회. 앱 전체 실패가 많으면 늦출 ms 를 돌려준다. */
    fail(ip: string, app: string): number {
      prune();
      const t = now();
      const e = ips.get(ip);

      if (!e || t - e.start > FAIL_WINDOW_MS) ips.set(ip, { start: t, count: 1, until: 0 });
      else if (++e.count >= FAIL_LIMIT) {
        e.until = t + BLOCK_MS;
        e.start = t;
        e.count = 0;
        console.warn(`[studio] 키 실패가 많아 한 주소를 15분 막음: app=${app}`);
      }
      const a = apps.get(app);

      if (!a || t - a.start > FAIL_WINDOW_MS) {
        apps.set(app, { start: t, count: 1 });

        return 0;
      }
      a.count += 1;

      return a.count > APP_SLOW_AFTER ? APP_SLOW_MS : 0;
    },
  };
}

// ───────── 발급·폐기·목록·검증 ─────────

type Fail = { ok: false; status: number; message: string };

const NO_PEPPER: Fail = {
  ok: false,
  status: 409,
  message: `먼저 비밀값을 등록하세요. 서버에 로그인용 시크릿이 없어 자동으로 만들 수 없어요. [설정] 탭 '외부 서비스 키'에 ${PEPPER_NAME}(32자 이상)를 등록하면 발급할 수 있어요.`,
};

export function checkStudioApp(v: unknown): { ok: true; app: string } | Fail {
  const app = typeof v === "string" ? v.trim() : "";

  return STUDIO_APP_RE.test(app) ? { ok: true, app } : { ok: false, status: 400, message: "앱 이름은 영어 소문자·숫자·하이픈으로 3~40자예요. 예: sprout-hub" };
}

/** 새 키를 발급한다. 같은 앱의 이전 키는 같은 트랜잭션에서 바로 폐기. 원문은 여기서 한 번만 돌려준다. */
export async function issueStudioKey(appRaw: unknown, createdBy: string): Promise<{ ok: true; app: string; key: string; createdAt: Date; replaced: number } | Fail> {
  const c = checkStudioApp(appRaw);

  if ("message" in c) return c;
  forgetPepper();
  const pepper = await getPepper();

  if (!pepper) return NO_PEPPER;
  const key = generateStudioKey();
  const keyHash = hashStudioKey(pepper, key);
  const now = new Date();
  const run = () =>
    prisma.$transaction(
      async (tx) => {
        const revoked = await tx.studioAccessKey.updateMany({ where: { app: c.app, revokedAt: null }, data: { revokedAt: now } });
        const row = await tx.studioAccessKey.create({ data: { app: c.app, keyHash, createdBy: createdBy.slice(0, 200) }, select: { createdAt: true } });

        return { replaced: revoked.count, createdAt: row.createdAt };
      },
      { isolationLevel: "Serializable" },
    );
  let r: { replaced: number; createdAt: Date };

  try {
    r = await run();
  } catch (e) {
    if ((e as { code?: string })?.code !== "P2034") throw e;
    r = await run(); // 같은 앱을 동시에 발급해 직렬화 충돌이 난 경우 한 번 더
  }

  return { ok: true, app: c.app, key, createdAt: r.createdAt, replaced: r.replaced };
}

/** 그 앱의 유효한 키를 바로 무효로 한다. */
export async function revokeStudioKey(appRaw: unknown): Promise<{ ok: true; app: string } | Fail> {
  const c = checkStudioApp(appRaw);

  if ("message" in c) return c;
  const r = await prisma.studioAccessKey.updateMany({ where: { app: c.app, revokedAt: null }, data: { revokedAt: new Date() } });

  return r.count ? { ok: true, app: c.app } : { ok: false, status: 404, message: "유효한 키가 없어요." };
}

export interface StudioKeyView {
  app: string;
  active: boolean;
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/** 앱별 최신 키 상태(해시 없음). */
export async function listStudioKeys(): Promise<{ pepperReady: boolean; items: StudioKeyView[] }> {
  const [rows, pepper] = await Promise.all([
    prisma.studioAccessKey.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { app: true, createdAt: true, createdBy: true, revokedAt: true, lastUsedAt: true },
    }),
    (forgetPepper(), getPepper()),
  ]);
  const map = new Map<string, StudioKeyView>();

  for (const r of rows) {
    const cur = map.get(r.app);

    if (cur?.active) continue;
    if (cur && r.revokedAt) continue;
    map.set(r.app, {
      app: r.app,
      active: !r.revokedAt,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    });
  }

  return { pepperReady: !!pepper, items: [...map.values()].sort((a, b) => a.app.localeCompare(b.app)) };
}

/** 그 앱의 유효한 키와 맞으면 true. 형식이 틀리거나 비밀값이 없으면 false. 성공 시 lastUsedAt 을 1분에 한 번 이하로 쓴다. */
export async function verifyStudioKey(app: string, key: string): Promise<boolean> {
  return (await verifyStudioKeyId(app, key)) !== null;
}

/** verifyStudioKey 와 같은 확인. 맞으면 키 id(감사 기록용, 키 원문·해시 아님), 아니면 null. */
export async function verifyStudioKeyId(app: string, key: string): Promise<string | null> {
  if (!STUDIO_APP_RE.test(app) || !STUDIO_KEY_RE.test(key)) return null;
  const pepper = await getPepper();

  if (!pepper) return null;
  const row = await prisma.studioAccessKey.findFirst({
    where: { app, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, keyHash: true, lastUsedAt: true },
  });
  const given = Buffer.from(hashStudioKey(pepper, key), "hex");
  // 없는 앱도 같은 길이의 비교를 한 번 해서 걸리는 시간을 맞춘다
  const stored = row && /^[0-9a-f]{64}$/.test(row.keyHash) ? Buffer.from(row.keyHash, "hex") : Buffer.alloc(32);
  const ok = timingSafeEqual(new Uint8Array(given), new Uint8Array(stored)) && !!row;

  if (ok && row && (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() >= LAST_USED_EVERY_MS)) {
    await prisma.studioAccessKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {
      console.error("[studio] 마지막 사용 시각 기록 실패");
    });
  }

  return ok && row ? row.id : null;
}
