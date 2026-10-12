// lib/factory/keyPasswords.ts
// 업로드 키 비밀번호 전달. 통제실에서 입력 → 서버에 암호화해 임시 보관 → PC 감독 프로그램이 가져가 secrets.env 에 저장 → 확인(ack)하면 서버 값 삭제.
// - 키 단위(경로+별칭)로 구분하고, PC secrets.env 이름도 키마다 다르다(RELEASE_KEY_<구분값>_STORE_PASSWORD / _KEY_PASSWORD).
// - 값은 통제실·커넥터 응답, 로그 어디에도 다시 나오지 않는다. 화면에는 "등록됨(PC 저장 완료/가져가기 대기)"만.
// - 암호화 키: FACTORY_SECRET_KEY(있으면) 또는 서버의 NEXTAUTH_SECRET / AUTH_SECRET 에서 만든다.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import prisma from "@/lib/prisma";

export const DEFAULT_KEY_ALIAS = "upload";

/** 경로 비교용: 앞뒤 공백 제거, \ → /, 소문자(Windows 경로는 대소문자 구분이 없다) */
const normPath = (p: string) => p.trim().replace(/\\/g, "/").toLowerCase();

export function keyRefOf(keystorePath: string, alias: string): string {
  return createHash("sha1").update(`${normPath(keystorePath)}\n${alias.trim()}`).digest("hex").slice(0, 10).toUpperCase();
}

export const keySecretNames = (ref: string) => ({
  store: `RELEASE_KEY_${ref}_STORE_PASSWORD`,
  key: `RELEASE_KEY_${ref}_KEY_PASSWORD`,
});

// 이 프로젝트의 TS 설정에서 Buffer 가 Uint8Array 로 바로 안 맞아서 바꿔 넘긴다
const u8 = (b: Buffer) => new Uint8Array(b);

function cipherKey(): Uint8Array | null {
  const base = process.env.FACTORY_SECRET_KEY?.trim() || process.env.NEXTAUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || "";

  if (base.length < 16) return null;

  return u8(createHash("sha256").update(`factory-key-password:${base}`).digest());
}

// 외부 서비스 키(secretEntries.ts)도 같은 암호화를 쓴다. 저장 형식(v1:iv:tag:ct)은 바꾸지 않는다.
export function seal(plain: string): string | null {
  const key = cipherKey();

  if (!key) return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, u8(iv));
  const ct = Buffer.concat([u8(c.update(plain, "utf8")), u8(c.final())]);

  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function unseal(sealed: string): string | null {
  const key = cipherKey();
  const [v, iv, tag, ct] = sealed.split(":");

  if (!key || v !== "v1" || !iv || !tag || !ct) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key, u8(Buffer.from(iv, "base64")));

    d.setAuthTag(u8(Buffer.from(tag, "base64")));

    return Buffer.concat([u8(d.update(u8(Buffer.from(ct, "base64")))), u8(d.final())]).toString("utf8");
  } catch {
    return null;
  }
}

// keytool 은 6자 이상을 요구한다. secrets.env 한 줄에 그대로 들어가야 해서 줄바꿈·앞뒤 공백·감싼 따옴표는 받지 않는다.
function checkPassword(v: unknown, what: string): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof v !== "string" || v.length < 6 || v.length > 128) return { ok: false, message: `${what}는 6~128자예요.` };
  if (/[\u0000-\u001f\u007f]/.test(v)) return { ok: false, message: `${what}에 줄바꿈·제어문자는 쓸 수 없어요.` };
  if (v !== v.trim()) return { ok: false, message: `${what} 앞뒤에 공백은 쓸 수 없어요.` };
  if (/^(['"]).*\1$/.test(v)) return { ok: false, message: `${what}를 따옴표로 감싸지 마세요.` };

  return { ok: true, value: v };
}

/**
 * 키 하나의 비밀번호를 등록(또는 바꿈)한다. keyPassword 가 비어 있으면 storePassword 와 같게 둔다.
 * 돌려주는 메시지에 값은 없다.
 */
export async function registerKeyPassword(
  keystorePath: string,
  keyAlias: string,
  storePassword: unknown,
  keyPassword: unknown,
  refOverride?: string | null, // 키 보관함 항목의 passwordRef(경로를 바꾼 키). 없으면 경로+별칭
): Promise<{ ok: boolean; status: number; message: string }> {
  const sp = checkPassword(storePassword, "키 저장소 비밀번호");

  if ("message" in sp) return { ok: false, status: 400, message: sp.message };
  const kpRaw = typeof keyPassword === "string" && keyPassword !== "" ? keyPassword : sp.value;
  const kp = checkPassword(kpRaw, "키 비밀번호");

  if ("message" in kp) return { ok: false, status: 400, message: kp.message };
  const sealed = seal(JSON.stringify({ store: sp.value, key: kp.value }));

  if (!sealed) {
    return { ok: false, status: 500, message: "서버 암호화 키가 없어 보관할 수 없어요(FACTORY_SECRET_KEY 또는 NEXTAUTH_SECRET 필요)." };
  }
  const ref = refOverride || keyRefOf(keystorePath, keyAlias);
  const names = keySecretNames(ref);
  const data = { keystorePath, keyAlias, storeName: names.store, keyName: names.key, sealed, registeredAt: new Date(), deliveredAt: null };

  await prisma.factoryKeyPassword.upsert({ where: { keyRef: ref }, create: { keyRef: ref, ...data }, update: data });
  // 키 이름 카탈로그에도 남긴다(값은 없다)
  for (const [n, d] of [
    [names.store, `업로드 키 ${keyAlias} (${keystorePath}) 키 저장소 비밀번호`],
    [names.key, `업로드 키 ${keyAlias} (${keystorePath}) 키 비밀번호`],
  ]) {
    await prisma.factorySecretName.upsert({ where: { name: n }, create: { name: n, description: d.slice(0, 200) }, update: {} });
  }

  return { ok: true, status: 200, message: "키 비밀번호를 등록했어요. 작업 PC 감독 프로그램이 곧 가져가 저장하고, 서버에서는 지워요." };
}

export type KeyPasswordState = "none" | "waiting" | "delivered";

/** 화면용: 키별 등록 상태(값 없음) */
export async function keyPasswordStatuses() {
  const rows = await prisma.factoryKeyPassword.findMany({ orderBy: { registeredAt: "desc" } });

  return rows.map((r) => ({
    keyRef: r.keyRef,
    keystorePath: r.keystorePath,
    keyAlias: r.keyAlias,
    state: (r.sealed ? "waiting" : "delivered") as KeyPasswordState,
    registeredAt: r.registeredAt,
    deliveredAt: r.deliveredAt,
  }));
}

export async function keyPasswordsPending(): Promise<boolean> {
  return (await prisma.factoryKeyPassword.count({ where: { sealed: { not: null } } })) > 0;
}

/** 감독 프로그램 전용(워커 토큰): 아직 안 가져간 값. 풀 수 없는 값(암호화 키가 바뀜 등)은 건너뛴다. */
export async function pendingKeyPasswords() {
  const rows = await prisma.factoryKeyPassword.findMany({ where: { sealed: { not: null } }, take: 20 });
  const out: { keyRef: string; version: string; storeName: string; keyName: string; store: string; key: string }[] = [];

  for (const r of rows) {
    const plain = r.sealed ? unseal(r.sealed) : null;

    if (!plain) continue;
    try {
      const v = JSON.parse(plain) as { store?: unknown; key?: unknown };

      if (typeof v.store === "string" && typeof v.key === "string") {
        out.push({ keyRef: r.keyRef, version: r.registeredAt.toISOString(), storeName: r.storeName, keyName: r.keyName, store: v.store, key: v.key });
      }
    } catch {
      /* 건너뜀 */
    }
  }

  return out;
}

/** 감독 프로그램이 secrets.env 에 저장했다고 알리면 서버 값을 지운다. 그 사이 다시 등록된 값(version 다름)은 남긴다. */
export async function ackKeyPasswords(items: unknown): Promise<number> {
  if (!Array.isArray(items)) return 0;
  let n = 0;

  for (const it of items.slice(0, 20)) {
    const r = it as { keyRef?: unknown; version?: unknown };

    if (typeof r?.keyRef !== "string" || typeof r.version !== "string" || !/^[0-9A-F]{10}$/.test(r.keyRef)) continue;
    const at = new Date(r.version);

    if (Number.isNaN(at.getTime())) continue;
    const res = await prisma.factoryKeyPassword.updateMany({
      where: { keyRef: r.keyRef, registeredAt: at, sealed: { not: null } },
      data: { sealed: null, deliveredAt: new Date() },
    });

    n += res.count;
  }

  return n;
}
