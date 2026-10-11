// app/api/admin/factory/control/route.ts
// 감독 프로그램 켜기/끄기(일시 정지)와 연결 상태. 관리자만.
// 홈페이지는 PC 의 프로그램을 직접 켤 수 없다. "새 일감을 내줄지 말지"만 정한다.
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/factory/admin";
import {
  isAutoUpdateEnabled,
  isSupervisorEnabled,
  setAutoUpdateEnabled,
  getSupervisorInfo,
  setSupervisorEnabled,
} from "@/lib/factory/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ONLINE_MS = 90_000;

async function snapshot() {
  const [enabled, autoUpdate, info, last, running, approved] = await Promise.all([
    isSupervisorEnabled(),
    isAutoUpdateEnabled(),
    getSupervisorInfo(),
    prisma.factoryWorkerToken.findFirst({
      where: { lastUsedAt: { not: null } },
      orderBy: { lastUsedAt: "desc" },
      select: { name: true, lastUsedAt: true },
    }),
    prisma.factoryJob.count({ where: { status: "running" } }),
    prisma.factoryJob.count({ where: { status: "approved" } }),
  ]);
  const lastSeen = last?.lastUsedAt ?? null;

  return {
    enabled,
    autoUpdate,
    commit: info?.commit ?? null,
    updateNote: info?.note ?? null,
    online: !!lastSeen && Date.now() - lastSeen.getTime() < ONLINE_MS,
    lastSeenAt: lastSeen,
    workerName: last?.name ?? null,
    running,
    approved,
  };
}

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  return NextResponse.json(await snapshot());
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    enabled?: unknown;
    autoUpdate?: unknown;
  } | null;
  const hasEnabled = typeof body?.enabled === "boolean";
  const hasAuto = typeof body?.autoUpdate === "boolean";

  if (!body || (!hasEnabled && !hasAuto)) {
    return NextResponse.json(
      { message: "enabled 또는 autoUpdate 는 true/false 여야 해요." },
      { status: 400 },
    );
  }

  if (hasAuto) {
    await setAutoUpdateEnabled(body.autoUpdate as boolean);

    return NextResponse.json({
      ...(await snapshot()),
      message: body.autoUpdate
        ? "자동 업데이트를 켰어요. 다음 확인 때부터 적용돼요."
        : "자동 업데이트를 껐어요. PC 프로그램은 지금 코드 그대로 실행돼요.",
    });
  }

  await setSupervisorEnabled(body.enabled as boolean);

  return NextResponse.json({
    ...(await snapshot()),
    message: body.enabled
      ? "켰어요. 감독 프로그램이 다음 확인 때부터 일감을 가져가요."
      : "일시 정지했어요. 진행 중인 작업은 끝까지 하고, 새 일감은 가져가지 않아요.",
  });
}
