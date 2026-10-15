// lib/connect/pepper.ts
// 연결 키 해시용 서버 비밀값: 환경변수 STUDIO_KEY_PEPPER(32자 이상) → 없으면 NEXTAUTH_SECRET(없으면 AUTH_SECRET)에서
// HKDF-SHA256(info "studio-access-key-v1")으로 유도한 값. 둘 다 없으면 null(발급·검증 불가). 1분 동안 기억한다.
// 값은 로그·응답에 넣지 않는다.
import { hkdfSync } from "crypto";

const PEPPER_NAME = "STUDIO_KEY_PEPPER";
const MIN_PEPPER = 32;
const MIN_DERIVE_BASE = 16;
const DERIVE_INFO = "studio-access-key-v1";
const PEPPER_CACHE_MS = 60_000;

let pepperCache: { value: string | null; at: number } | null = null;

function derivedPepper(): string | null {
  const base = process.env.NEXTAUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || "";

  if (base.length < MIN_DERIVE_BASE) return null;

  return Buffer.from(hkdfSync("sha256", base, "", DERIVE_INFO, 32)).toString("hex");
}

export async function getPepper(): Promise<string | null> {
  const now = Date.now();

  if (pepperCache && now - pepperCache.at < PEPPER_CACHE_MS) return pepperCache.value;
  const env = process.env[PEPPER_NAME]?.trim();
  const value = env && env.length >= MIN_PEPPER ? env : derivedPepper();

  pepperCache = { value, at: now };

  return value;
}
