// lib/factory/serviceToken.ts
// 서비스 관리자 토큰(SERVICE_ADMIN_TOKEN_<앱>)을 감독 프로그램(serverctl service-token)이 키 보관함에 자동으로 넣는 쓰기 경로.
// 한 컷 서버 .env 의 ADMIN_API_TOKEN 과 홈페이지 키 보관함의 SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME 이 같은 값이어야 해서,
// serverctl 이 PC 메모리에서 값을 한 번 만들어 ① 서버2 .env 에 넣고 ② 여기로 보낸다. 한쪽이 실패하면 되돌린다(rollbackServiceToken).
// - 이름은 허용 목록(SERVICE_ADMIN_TOKEN_*)만. 값은 secretEntries 와 같은 암호화(seal)로 factory_secret_entries 에 '서버 보관 키'로 저장되고,
//   읽기는 기존 readServerSecret 그대로다. 통제실 [설정] 화면에는 '서버 보관'으로 보인다.
// - 되돌리기: 저장 직전 상태(이전 암호문 또는 '없음')를 factory_settings(serviceTokenPrev:<이름>)에 한 단계만 남기고, 같은 version 일 때만 복원한다.
// - 값은 응답·로그·설정 어디에도 평문으로 남지 않는다. 호출은 워커 토큰(app/api/factory/service-token)으로만.
// - factory-web(통제실)에도 같은 API 를 7-3/실행 순서 4 에서 옮긴다(docs/studio-service-api.md).
import prisma from "@/lib/prisma";
import { seal } from "@/lib/factory/keyPasswords";
import { checkSecretValue, SECRET_ENTRY_NAME_RE } from "@/lib/factory/secretEntries";
import { getSettingValue, setSettingValue } from "@/lib/factory/settings";

export const SERVICE_TOKEN_NAME_RE = /^SERVICE_ADMIN_TOKEN_[A-Z0-9_]{1,40}$/;
const DESCRIPTION = "서비스 관리자 토큰(serverctl service-token 이 서버 .env 와 짝으로 넣음)";
const prevKey = (name: string) => `serviceTokenPrev:${name}`;

interface PrevRecord {
  version: number; // 이 기록을 남긴 저장의 version. 같을 때만 되돌린다
  before: { sealed: string | null; status: string; description: string; storedAt: string | null } | null; // null = 저장 전에 없었음
  at: string;
}

type Fail = { ok: false; status: number; message: string };
export type PutResult = { ok: true; status: 200; version: number; replaced: boolean } | Fail;
export type RollbackResult = { ok: true; status: 200; restored: "previous" | "deleted" } | Fail;

export function checkServiceTokenName(v: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const name = typeof v === "string" ? v.trim() : "";

  if (!SERVICE_TOKEN_NAME_RE.test(name) || !SECRET_ENTRY_NAME_RE.test(name)) return { ok: false, message: "이름은 SERVICE_ADMIN_TOKEN_<앱> 꼴만 쓸 수 있어요." };

  return { ok: true, value: name };
}

const isUniqueRace = (e: unknown) => (e as { code?: string })?.code === "P2002";

function parsePrev(raw: string | null): PrevRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PrevRecord>;

    if (!v || !Number.isInteger(v.version) || typeof v.at !== "string") return null;
    if (v.before !== null && (typeof v.before !== "object" || typeof v.before?.status !== "string")) return null;

    return {
      version: v.version as number,
      before: v.before ? { sealed: typeof v.before.sealed === "string" ? v.before.sealed : null, status: v.before.status, description: typeof v.before.description === "string" ? v.before.description : "", storedAt: typeof v.before.storedAt === "string" ? v.before.storedAt : null } : null,
      at: v.at,
    };
  } catch {
    return null;
  }
}

/** 값을 암호화해 서버 보관 키로 저장(있으면 교체)하고, 되돌리기용 이전 상태를 한 단계 남긴다. 돌려주는 값에 토큰은 없다. */
export async function putServiceToken(nameRaw: unknown, valueRaw: unknown): Promise<PutResult> {
  const n = checkServiceTokenName(nameRaw);

  if ("message" in n) return { ok: false, status: 400, message: n.message };
  const v = checkSecretValue(valueRaw);

  if ("message" in v) return { ok: false, status: 400, message: v.message };
  const name = n.value;
  const sealed = seal(v.value);

  if (!sealed) return { ok: false, status: 500, message: "서버 암호화 키가 없어 보관할 수 없어요(FACTORY_SECRET_KEY 또는 NEXTAUTH_SECRET 필요)." };
  const before = await prisma.factorySecretEntry.findUnique({ where: { name }, select: { sealed: true, status: true, description: true, storedAt: true } });
  const now = new Date();
  const upsert = () =>
    prisma.factorySecretEntry.upsert({
      where: { name },
      create: { name, description: DESCRIPTION, sealed, status: "stored", version: 1, storedAt: now },
      update: { sealed, status: "stored", version: { increment: 1 }, storedAt: now, ...(before?.description ? {} : { description: DESCRIPTION }) },
      select: { version: true },
    });
  let row: { version: number };

  try {
    row = await upsert();
  } catch (e) {
    if (!isUniqueRace(e)) throw e;
    row = await upsert();
  }
  const prev: PrevRecord = {
    version: row.version,
    before: before ? { sealed: before.sealed, status: before.status, description: before.description, storedAt: before.storedAt ? before.storedAt.toISOString() : null } : null,
    at: now.toISOString(),
  };

  await setSettingValue(prevKey(name), JSON.stringify(prev));

  return { ok: true, status: 200, version: row.version, replaced: !!before?.sealed };
}

/** 방금 저장(version)을 되돌린다: 저장 전에 있던 값이면 그 암호문으로, 없었으면 항목 삭제. 그 사이 다시 바뀌었으면(version 다름) 아무것도 안 한다. */
export async function rollbackServiceToken(nameRaw: unknown, versionRaw: unknown): Promise<RollbackResult> {
  const n = checkServiceTokenName(nameRaw);

  if ("message" in n) return { ok: false, status: 400, message: n.message };
  if (!Number.isInteger(versionRaw) || (versionRaw as number) < 1) return { ok: false, status: 400, message: "version 이 필요해요." };
  const name = n.value;
  const version = versionRaw as number;
  const prev = parsePrev(await getSettingValue(prevKey(name)).catch(() => null));
  const cur = await prisma.factorySecretEntry.findUnique({ where: { name }, select: { version: true } });

  if (!prev || prev.version !== version || !cur || cur.version !== version) {
    return { ok: false, status: 409, message: "되돌릴 기록이 없거나 그 사이 다시 바뀌었어요. 통제실 [설정]에서 확인하세요." };
  }
  if (prev.before) {
    await prisma.factorySecretEntry.updateMany({
      where: { name, version },
      data: { sealed: prev.before.sealed, status: prev.before.status, description: prev.before.description, storedAt: prev.before.storedAt ? new Date(prev.before.storedAt) : null, version: { increment: 1 } },
    });
  } else {
    await prisma.factorySecretEntry.deleteMany({ where: { name, version } });
  }
  await setSettingValue(prevKey(name), null);

  return { ok: true, status: 200, restored: prev.before ? "previous" : "deleted" };
}
