// lib/connection-keys.ts
// 서버끼리 쓰는 연결 키의 순수 함수(생성·해시·검증·헤더 해석). DB·환경변수·Next 를 쓰지 않아 블로그가 그대로 복사해 쓴다.
// - 형식: ck_ + 32바이트 무작위 hex(64자). 해시: HMAC-SHA256(서버 비밀값, 키) hex. 원문은 저장하지 않는다.
// - 서버 비밀값(pepper)을 고르는 방법은 호출하는 쪽 몫이다(factory-web: lib/studio/access.ts getPepper).
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const CONNECTION_KEY_RE = /^ck_[0-9a-f]{64}$/;
export const CONNECTION_KEY_PREFIX_LEN = 8;
const MAX_AUTH_HEADER = 1024;

export const generateConnectionKey = () => `ck_${randomBytes(32).toString("hex")}`;

export const hashConnectionKey = (pepper: string, key: string) => createHmac("sha256", pepper).update(key, "utf8").digest("hex");

/** 목록 표시용 앞 8자(예: "ck_1a2b3"). 원문 전체가 아니라 앞부분만. */
export const connectionKeyPrefix = (key: string) => key.slice(0, CONNECTION_KEY_PREFIX_LEN);

/** 키 형식이 맞고 저장된 해시와 같으면 true(시간 일정 비교). storedHash 가 없거나 형식이 틀려도 같은 길이로 비교한다. */
export function verifyConnectionKeyHash(pepper: string, key: string, storedHash: string | null | undefined): boolean {
  if (!CONNECTION_KEY_RE.test(key)) return false;
  const given = Buffer.from(hashConnectionKey(pepper, key), "hex");
  const valid = typeof storedHash === "string" && /^[0-9a-f]{64}$/.test(storedHash);
  const stored = valid ? Buffer.from(storedHash, "hex") : Buffer.alloc(32);

  return timingSafeEqual(new Uint8Array(given), new Uint8Array(stored)) && valid;
}

/** Authorization: Bearer ck_… 에서 키를 꺼낸다. 형식이 아니면 null. */
export function bearerConnectionKey(header: string | null | undefined): string | null {
  if (!header || header.length > MAX_AUTH_HEADER) return null;
  const m = /^[Bb][Ee][Aa][Rr][Ee][Rr]\s+(ck_[0-9a-f]{64})\s*$/.exec(header);

  return m ? m[1] : null;
}
