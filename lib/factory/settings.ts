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
