// lib/factory/settings.ts
// 통제실 설정값: 감독 프로그램 활성화(일시 정지), 자동 업데이트, 감독 프로그램 버전 정보, "지금 업데이트" 1회성 요청.
import prisma from "@/lib/prisma";

const KEY = "supervisorEnabled";

export async function isSupervisorEnabled(): Promise<boolean> {
  const row = await prisma.factorySetting.findUnique({ where: { key: KEY } });

  return row?.value !== "false";
}

export async function setSupervisorEnabled(enabled: boolean): Promise<void> {
  const value = enabled ? "true" : "false";

  await prisma.factorySetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value },
  });
}

const AUTO_UPDATE_KEY = "autoUpdate";

/** 감독 프로그램 자동 업데이트 허용 여부. 값이 없으면 켜짐. */
export async function isAutoUpdateEnabled(): Promise<boolean> {
  const row = await prisma.factorySetting.findUnique({ where: { key: AUTO_UPDATE_KEY } });

  return row?.value !== "false";
}

export async function setAutoUpdateEnabled(enabled: boolean): Promise<void> {
  const value = enabled ? "true" : "false";

  await prisma.factorySetting.upsert({
    where: { key: AUTO_UPDATE_KEY },
    create: { key: AUTO_UPDATE_KEY, value },
    update: { value },
  });
}

const INFO_KEY = "supervisorInfo";

export interface SupervisorInfo {
  commit: string;
  note: string;
  at: string;
}

export async function getSupervisorInfo(): Promise<SupervisorInfo | null> {
  const row = await prisma.factorySetting.findUnique({ where: { key: INFO_KEY } });

  if (!row) return null;
  try {
    return JSON.parse(row.value) as SupervisorInfo;
  } catch {
    return null;
  }
}

/** 감독 프로그램이 알려 준 커밋·소식을 저장한다. 값이 바뀔 때만 쓴다(5초마다 오는 요청이 DB 를 두드리지 않게). */
export async function saveSupervisorInfo(commit: string, note: string): Promise<void> {
  const cur = await getSupervisorInfo();

  if (cur && cur.commit === commit && cur.note === note) return;
  const value = JSON.stringify({ commit, note, at: new Date().toISOString() });

  await prisma.factorySetting.upsert({
    where: { key: INFO_KEY },
    create: { key: INFO_KEY, value },
    update: { value },
  });
}

const UPDATE_NOW_KEY = "updateNowRequestedAt";

/** "지금 업데이트" 요청을 남긴다(통제실 버튼·커넥터). 감독 프로그램이 다음 /next 에서 한 번 받아 간다. */
export async function requestUpdateNow(): Promise<void> {
  const value = new Date().toISOString();

  await prisma.factorySetting.upsert({
    where: { key: UPDATE_NOW_KEY },
    create: { key: UPDATE_NOW_KEY, value },
    update: { value },
  });
}

/** 아직 감독 프로그램이 받아 가지 않은 "지금 업데이트" 요청 시각. 없으면 null. */
export async function getPendingUpdateNow(): Promise<string | null> {
  const row = await prisma.factorySetting.findUnique({ where: { key: UPDATE_NOW_KEY } });

  return row?.value ?? null;
}

/** /next 에서 부른다. 요청이 있었으면 지우고 true(1회성). 동시에 두 번 와도 지운 쪽 하나만 true 다. */
export async function consumeUpdateNow(): Promise<boolean> {
  const { count } = await prisma.factorySetting.deleteMany({ where: { key: UPDATE_NOW_KEY } });

  return count > 0;
}
