// lib/analytics/registerApp.ts
// 프로젝트 ↔ 분석 앱 연결. 프로젝트를 등록하면 분석 앱(수집 키 포함)이 같이 만들어진다.
//   분석 앱의 appId = 프로젝트 name(slug)  → /admin/analytics?app=<name> 로 바로 연결된다.
import { randomBytes } from "node:crypto";

import prisma from "@/lib/prisma";

// 백엔드 프로젝트는 앱이 아니라서 분석 대상에서 뺀다.
export const ANALYTICS_PLATFORMS = new Set(["mobile", "web"]);

export const newIngestKey = () => `ak_${randomBytes(24).toString("base64url")}`;

export interface ProjectLike {
  name: string;
  title: string;
  platform: string;
}

/**
 * 분석 앱이 없으면 만들고, 있으면 표시 이름만 맞춘다. 이미 있는 수집 키는 절대 바꾸지 않는다.
 * 프로젝트 저장을 막으면 안 되므로 실패해도 예외를 던지지 않고 null 을 돌려준다.
 */
export async function ensureAnalyticsApp(project: ProjectLike) {
  if (!ANALYTICS_PLATFORMS.has(project.platform)) return null;

  try {
    return await prisma.analyticsApp.upsert({
      where: { appId: project.name },
      create: {
        appId: project.name,
        name: project.title,
        ingestKey: newIngestKey(),
      },
      update: { name: project.title },
    });
  } catch (error) {
    console.error("[analytics] 분석 앱 자동 생성 실패:", error);

    return null;
  }
}
