// lib/factory/settings.ts
// 통제실 설정값. 지금은 "감독 프로그램 활성화 여부" 하나. 값이 없으면 활성(켜짐)이다.
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
