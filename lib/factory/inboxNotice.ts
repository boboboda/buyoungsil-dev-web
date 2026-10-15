// lib/factory/inboxNotice.ts
// 텔레그램 '같은 알림은 한 번만'. 알림마다 안정된 이름(key)을 정하고, 보내기 전에 factory_settings 에 한 줄을 새로 만든다.
// 기본 키(PK)라서 이미 있으면 만들기가 실패한다 → 동시에 두 곳에서 불러도 한쪽만 "내가 처음"이 된다(DB 하나뿐이라 서버가 여러 번 떠도 안전).
// 그 할 일이 사라지면(처리·취소) releaseNotices 로 줄을 지워서, 같은 일이 나중에 다시 생기면 새로 알린다.
import prisma from "@/lib/prisma";

export const NOTICE_PREFIX = "inboxNotice:";
const KEY_RE = /^[A-Za-z0-9_.:-]{1,120}$/;

/** 이 알림을 지금 처음 보내는 쪽이면 true(보내라). 이미 보냈으면 false. 이름이 이상하거나 DB 가 안 되면 true(알림이 빠지는 쪽보다 한 번 더 가는 쪽이 낫다) */
export async function claimNotice(key: string): Promise<boolean> {
  if (!KEY_RE.test(key)) return true;
  try {
    await prisma.factorySetting.create({ data: { key: `${NOTICE_PREFIX}${key}`, value: new Date().toISOString() } });

    return true;
  } catch (e) {
    // 같은 이름이 이미 있다(P2002) = 이미 알렸다. 그 밖의 오류는 알림을 빠뜨리지 않게 true
    return (e as { code?: string })?.code === "P2002" ? false : true;
  }
}

/** 보낸 알림 줄 중 prefix(예: "keys:")로 시작하고 keep 에 없는 것을 지운다(그 할 일이 사라졌다). 지운 개수 */
export async function releaseNotices(prefix: string, keep: Set<string>): Promise<number> {
  try {
    const rows = await prisma.factorySetting.findMany({ where: { key: { startsWith: `${NOTICE_PREFIX}${prefix}` } }, select: { key: true }, take: 500 });
    const gone = rows.map((r) => r.key).filter((k) => !keep.has(k.slice(NOTICE_PREFIX.length)));

    if (!gone.length) return 0;

    return (await prisma.factorySetting.deleteMany({ where: { key: { in: gone } } })).count;
  } catch {
    return 0;
  }
}

/** 한 건의 알림 줄만 지운다(처리가 끝난 일감의 알림 기록 정리) */
export async function releaseNotice(key: string): Promise<void> {
  try {
    await prisma.factorySetting.deleteMany({ where: { key: `${NOTICE_PREFIX}${key}` } });
  } catch {
    /* 무시 */
  }
}
