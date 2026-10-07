// serverActions/analyticsApp.ts
"use server";

import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth/auth";
import prisma from "@/lib/prisma";
import { ensureAnalyticsApp } from "@/lib/analytics/registerApp";

export interface AnalyticsConnectInfo {
  appId: string;
  ingestKey: string;
  isActive: boolean;
}

// 수집 키는 관리자만 볼 수 있다. 서버 액션은 외부에서 직접 호출될 수 있어서 권한을 다시 확인한다.
export async function getAnalyticsConnectInfo(
  projectId: string,
): Promise<{ ok: boolean; message?: string; info?: AnalyticsConnectInfo }> {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (role !== "admin") return { ok: false, message: "권한이 없습니다." };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, title: true, platform: true },
  });

  if (!project) return { ok: false, message: "프로젝트를 찾을 수 없습니다." };

  // 예전에 만든 프로젝트는 분석 앱이 없을 수 있으니, 처음 열 때 만들어 준다.
  const app = await ensureAnalyticsApp(project);

  if (!app) {
    return {
      ok: false,
      message: "이 프로젝트는 분석 대상이 아니거나(백엔드) 분석 앱을 만들지 못했습니다.",
    };
  }

  return {
    ok: true,
    info: { appId: app.appId, ingestKey: app.ingestKey, isActive: app.isActive },
  };
}
