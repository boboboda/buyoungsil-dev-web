// lib/connect/adminKeys.ts
// 블로그 설정의 "연결 키": 만들기(원문은 응답에서 한 번만)·목록·폐기. 표(control_connection_keys)의 주인은 통제실(factory-web)이다.
// 해시는 통제실과 같은 getPepper(STUDIO_KEY_PEPPER → 서버 보관 키 → NEXTAUTH_SECRET 유도)로 만들어, 같은 키가 양쪽에서 같은 해시가 된다.
// 키 원문·해시·비밀값은 목록·로그·오류에 넣지 않는다.
import { connectionKeyPrefix, generateConnectionKey, hashConnectionKey } from "@/lib/connection-keys";
import prisma from "@/lib/prisma";
import { getPepper } from "@/lib/studio/access";

export const MAX_LABEL = 40;
export const MAX_ACTIVE_KEYS = 20;

export interface ConnectionKeyItem {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

type Fail = { ok: false; status: number; message: string };

/** 통제실이 아직 배포되지 않아 표가 없을 때(Prisma P2021, 또는 "does not exist") */
export function isMissingTable(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;

  if (code === "P2021") return true;
  const msg = e instanceof Error ? e.message : "";

  return /control_connection_keys/.test(msg) && /does not exist/i.test(msg);
}

export function checkLabel(v: unknown): { ok: true; value: string } | Fail {
  const label = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";

  if (!label) return { ok: false, status: 400, message: "키 이름을 적어 주세요. 예: 블로그 서버" };
  if (label.length > MAX_LABEL) return { ok: false, status: 400, message: `이름은 ${MAX_LABEL}자까지예요.` };
  if (/[\u0000-\u001f\u007f<>]/.test(label)) return { ok: false, status: 400, message: "이름에 제어문자·< > 는 쓸 수 없어요." };

  return { ok: true, value: label };
}

/** 목록. 표가 없으면 { available: false } */
export async function listConnectionKeys(): Promise<{ available: boolean; items: ConnectionKeyItem[] }> {
  try {
    const rows = await prisma.controlConnectionKey.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, label: true, prefix: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    });

    return {
      available: true,
      items: rows.map((r) => ({
        id: r.id,
        label: r.label,
        prefix: r.prefix,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        revokedAt: r.revokedAt?.toISOString() ?? null,
      })),
    };
  } catch (e) {
    if (isMissingTable(e)) return { available: false, items: [] };
    throw e;
  }
}

/** 새 키 만들기. 원문(key)은 이 반환값에만 있다. */
export async function createConnectionKey(labelRaw: unknown, createdBy: string): Promise<{ ok: true; id: string; label: string; prefix: string; key: string } | Fail> {
  const l = checkLabel(labelRaw);

  if ("message" in l) return l;
  const pepper = await getPepper();

  if (!pepper) {
    return { ok: false, status: 409, message: "먼저 비밀값을 등록하세요. 통제실 [설정]의 '외부 서비스 키'에 STUDIO_KEY_PEPPER(32자 이상)를 등록하면 만들 수 있어요." };
  }
  try {
    const active = await prisma.controlConnectionKey.count({ where: { revokedAt: null } });

    if (active >= MAX_ACTIVE_KEYS) return { ok: false, status: 400, message: `유효한 키는 ${MAX_ACTIVE_KEYS}개까지예요. 안 쓰는 키를 먼저 폐기해 주세요.` };
    const key = generateConnectionKey();
    const row = await prisma.controlConnectionKey.create({
      data: { label: l.value, prefix: connectionKeyPrefix(key), hash: hashConnectionKey(pepper, key), createdBy: createdBy.slice(0, 120) },
      select: { id: true, label: true, prefix: true },
    });

    return { ok: true, id: row.id, label: row.label, prefix: row.prefix, key };
  } catch (e) {
    if (isMissingTable(e)) return { ok: false, status: 503, message: "통제실 배포 후 사용 가능해요." };
    throw e;
  }
}

export async function revokeConnectionKey(idRaw: unknown): Promise<{ ok: true } | Fail> {
  if (typeof idRaw !== "string" || !idRaw || idRaw.length > 64) return { ok: false, status: 400, message: "폐기할 키를 골라 주세요." };
  try {
    const r = await prisma.controlConnectionKey.updateMany({ where: { id: idRaw, revokedAt: null }, data: { revokedAt: new Date() } });

    return r.count ? { ok: true } : { ok: false, status: 404, message: "유효한 키가 없어요." };
  } catch (e) {
    if (isMissingTable(e)) return { ok: false, status: 503, message: "통제실 배포 후 사용 가능해요." };
    throw e;
  }
}
