// lib/factory/appName.ts
// 출시 쪽에서 보여 줄 '앱 이름'. 우선순위: ① 사람이 출시 카드에서 정한 이름(FactoryApp.appName)
// ② 스토어 문구의 앱 이름(스토어 자료 listing 또는 출시 패키지 storeListing 의 title, 한국어 먼저) ③ 연결된 홈페이지 프로젝트 제목 ④ 작업 이름.
// 통제실의 다른 화면(일감 목록 등)은 작업 이름을 그대로 쓴다.
import prisma from "@/lib/prisma";
import { readStoreAssets } from "@/lib/factory/storeAssets";

export const APP_NAME_MAX = 30;
export type AppNameSource = "manual" | "store" | "project" | "job";
export const APP_NAME_SOURCE_LABELS: Record<AppNameSource, string> = {
  manual: "직접 정한 이름",
  store: "스토어 문구의 앱 이름",
  project: "홈페이지 프로젝트 제목",
  job: "작업 이름",
};

/** 입력 확인: undefined 면 바꾸지 않음, 빈 값이면 null(자동), 아니면 30자 이내 한 줄 */
export function cleanAppName(v: unknown): { ok: true; value: string | null | undefined } | { ok: false; message: string } {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, message: "앱 이름은 글자여야 해요." };
  const t = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();

  if (!t) return { ok: true, value: null };
  if ([...t].length > APP_NAME_MAX) return { ok: false, message: `앱 이름은 ${APP_NAME_MAX}자 이내예요(스토어 제목 한도).` };

  return { ok: true, value: t };
}

const firstTitle = (listing: unknown): string | null => {
  if (!listing || typeof listing !== "object") return null;
  const l = listing as Record<string, { title?: unknown } | null>;
  const langs = Object.keys(l).sort((a, b) => Number(!a.startsWith("ko")) - Number(!b.startsWith("ko")));

  for (const lang of langs) {
    const t = l[lang]?.title;

    if (typeof t === "string" && t.trim()) return t.trim().slice(0, 60);
  }

  return null;
};

/** 스토어 문구의 앱 이름(스토어 자료 listing → 출시 패키지 storeListing) */
export function storeTitleOf(app: { storeAssets?: unknown; releasePackage?: unknown } | null | undefined): string | null {
  if (!app) return null;
  const sa = readStoreAssets(app.storeAssets);
  const pkg = app.releasePackage && typeof app.releasePackage === "object" ? (app.releasePackage as Record<string, unknown>) : null;

  return firstTitle(sa?.listing) ?? firstTitle(pkg?.storeListing);
}

export function pickAppName(v: { appName?: string | null; storeTitle?: string | null; projectTitle?: string | null; jobTitle: string }): { name: string; source: AppNameSource } {
  if (v.appName?.trim()) return { name: v.appName.trim(), source: "manual" };
  if (v.storeTitle?.trim()) return { name: v.storeTitle.trim(), source: "store" };
  if (v.projectTitle?.trim()) return { name: v.projectTitle.trim(), source: "project" };

  return { name: v.jobTitle, source: "job" };
}

/** 앱 하나의 표시 이름(알림·확인창·커넥터용). 실패하면 fallback */
export async function releaseAppName(appSlug: string, fallback: string): Promise<string> {
  try {
    const app = await prisma.factoryApp.findUnique({ where: { appSlug }, select: { appName: true, storeAssets: true, releasePackage: true, projectId: true } });
    const project = app?.projectId ? await prisma.project.findUnique({ where: { id: app.projectId }, select: { title: true } }) : null;

    return pickAppName({ appName: app?.appName, storeTitle: storeTitleOf(app), projectTitle: project?.title, jobTitle: fallback }).name;
  } catch {
    return fallback;
  }
}
