// lib/factory/project.ts
// 공장 앱과 홈페이지 Project 를 잇는다.
// - Project 는 출시 대상(storeTarget) 앱에만 만든다: 출시 패키지에 추가할 때 기존 프로젝트를 고르거나 새로 만든다(건너뛰고 나중에 카드에서 연결해도 된다).
//   새 앱 일감 승인 때는 만들지 않는다(출시 안 할 앱이 홈페이지에 공개되지 않게).
// - 출시 단계: 비어 있는 항목만 채운다. 이미 입력된 내용은 덮어쓰지 않는다.
//   예외: 사람이 승인 때 '홈페이지 프로젝트도 덮어쓰기'를 고른 스토어 자료 수정·프로젝트 업데이트 일감(overwrite)은
//   설명·대표 이미지·앱 링크·기술 스택을 바꾼다. 개인정보처리방침은 그때도 빈 칸일 때만 채운다.
//   단 '개인정보처리방침 갱신'을 고른 일감(privacyOverwrite)은 덮어쓰기 선택과 상관없이 방침을 바꾼다([[ ]] 검사는 그대로).
import prisma from "@/lib/prisma";
import { createProjectRecord } from "@/lib/projects/createProjectRecord";
import { hasUnfilledPlaceholder } from "@/lib/privacy/template";
import { readStoreAssets } from "@/lib/factory/storeAssets";
import { storeTitleOf } from "@/lib/factory/appName";
import { APP_ROLES_KEY, readAppRoles, resolveAppRole, type AppRole } from "@/lib/factory/appRoles";

/** 기획서 본문에서 홈페이지 소개용 첫 문단을 뽑는다. (제목·목록 기호 제거, 200자) */
export function summarizePlan(plan: string): string {
  const lines = plan
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").replace(/^[-*>\d.\s]+/, "").trim())
    .filter((l) => l.length >= 10);
  const text = (lines[0] ?? "").slice(0, 200);

  return text || "개발 중인 앱입니다.";
}

// 공장 앱 종류(stack) → 홈페이지 Project 의 플랫폼과 기술 스택 값(ProjectForm 의 TECH_STACK_OPTIONS 와 같은 값, 개발노트 카테고리와 연결된다)
const STACK_TO_PROJECT: Record<string, { platform: "mobile" | "web" | "backend"; techStack: string[] }> = {
  flutter: { platform: "mobile", techStack: ["flutter"] },
  "kotlin-compose": { platform: "mobile", techStack: ["kotlin-compose"] },
  "swift-swiftui": { platform: "mobile", techStack: ["swift-swiftui"] },
  nextjs: { platform: "web", techStack: ["nextjs-heroui"] },
  nestjs: { platform: "backend", techStack: ["nestjs-typescript"] },
};

export function projectShapeForStack(stack: string | null | undefined) {
  return STACK_TO_PROJECT[stack ?? ""] ?? STACK_TO_PROJECT.flutter;
}

/** 연결된 Project 가 없으면 기획서로 만든다(in-progress). 출시 패키지에 추가할 때 '새 프로젝트 만들기'로 부른다(createProjectForApp). */
export async function ensureProjectForJob(job: {
  appSlug: string;
  title: string;
  planMarkdown: string;
  stack?: string | null;
}): Promise<{ projectId: string; created: boolean }> {
  const app = await prisma.factoryApp.findUnique({ where: { appSlug: job.appSlug } });

  if (app?.projectId) return { projectId: app.projectId, created: false };

  const shape = projectShapeForStack(job.stack);
  const res = await createProjectRecord({
    title: job.title,
    description: summarizePlan(job.planMarkdown),
    status: "in-progress",
    platform: shape.platform,
    progress: 0,
    techStack: shape.techStack,
  });
  const projectId = res.data.id;

  await prisma.factoryApp.upsert({
    where: { appSlug: job.appSlug },
    create: { appSlug: job.appSlug, projectId },
    update: { projectId },
  });

  return { projectId, created: true };
}

export interface ProjectFill {
  title?: string; // 사람이 출시 카드에서 정한 앱 이름(서버 값만. 빈 칸일 때만, 덮어쓰기면 바꿈)
  description?: string;
  coverImage?: string;
  appLink?: string;
  techStack?: string[];
  privacyPolicy?: string;
}

export interface FillResult {
  ok: boolean;
  status: number;
  message: string;
  filled: string[]; // 채운 칸 + 덮어쓴 칸(예전 응답 그대로)
  overwritten?: string[]; // 그중 덮어쓴 칸
  skipped: string[];
}

export const NO_PROJECT_MESSAGE = "연결된 홈페이지 프로젝트가 없어요. 먼저 출시 패키지 카드에서 프로젝트를 연결하세요.";

const PLACEHOLDER_DESCRIPTION = "개발 중인 앱입니다.";

/**
 * 출시 단계에서 비어 있는 Project 항목만 채운다. 이미 값이 있으면 건너뛴다(opts.overwrite 면 개인정보처리방침 말고는 바꾼다).
 * opts.privacyOverwrite 면 개인정보처리방침도 바꾼다. opts.dryRun 이면 저장하지 않고 결과만 돌려준다(확인창 미리보기).
 */
export async function fillProjectIfEmpty(
  appSlug: string,
  fill: ProjectFill,
  opts: { overwrite?: boolean; privacyOverwrite?: boolean; dryRun?: boolean } = {},
): Promise<FillResult> {
  const app = await prisma.factoryApp.findUnique({ where: { appSlug } });

  if (!app?.projectId) {
    return { ok: false, status: 404, message: NO_PROJECT_MESSAGE, filled: [], skipped: [] };
  }
  if (fill.privacyPolicy && hasUnfilledPlaceholder(fill.privacyPolicy)) {
    return { ok: false, status: 400, message: "개인정보처리방침에 [[ ... ]] 자리표시자가 남아 있어요. 모두 채워서 다시 보내세요.", filled: [], skipped: [] };
  }

  const project = await prisma.project.findUnique({ where: { id: app.projectId } });

  if (!project) {
    return { ok: false, status: 404, message: "연결된 프로젝트가 삭제됐어요.", filled: [], skipped: [] };
  }

  const data: Record<string, unknown> = {};
  const filled: string[] = [];
  const skipped: string[] = [];
  const overwritten: string[] = [];
  const pick = (key: string, isEmpty: boolean, value: unknown, canOverwrite = !!opts.overwrite) => {
    if (value === undefined || value === null || value === "") return;
    if (!isEmpty && canOverwrite) {
      if (JSON.stringify((project as Record<string, unknown>)[key]) === JSON.stringify(value)) return; // 같은 값
      data[key] = value;
      overwritten.push(key);

      return;
    }
    if (!isEmpty) {
      skipped.push(key);

      return;
    }
    data[key] = value;
    filled.push(key);
  };

  pick("title", !project.title.trim(), fill.title?.trim());
  pick("description", !project.description.trim() || project.description === PLACEHOLDER_DESCRIPTION, fill.description?.trim());
  pick("coverImage", !project.coverImage, fill.coverImage?.trim());
  pick("appLink", !project.appLink, fill.appLink?.trim());
  pick("techStack", project.techStack.length === 0, fill.techStack?.length ? fill.techStack : undefined);

  const policy = fill.privacyPolicy?.trim();

  pick("privacyPolicy", !project.privacyPolicy?.trim(), policy, !!opts.privacyOverwrite); // '개인정보처리방침 갱신'을 고른 일감만 덮어쓴다
  if (data.privacyPolicy) data.privacyUpdatedAt = new Date();

  if (filled.length + overwritten.length > 0 && !opts.dryRun) await prisma.project.update({ where: { id: project.id }, data });
  const parts = [filled.length ? `채웠어요: ${filled.join(", ")}` : "", overwritten.length ? `덮어썼어요: ${overwritten.join(", ")}` : ""].filter(Boolean);

  return {
    ok: true,
    status: 200,
    message: parts.length ? parts.join(" / ") : opts.overwrite || opts.privacyOverwrite ? "바꿀 항목이 없어요." : "채울 빈 항목이 없어요.",
    filled: [...filled, ...overwritten],
    overwritten,
    skipped,
  };
}

// ───────── 출시 카드 [홈페이지만 반영]: 서버에 저장된 출시 자료로 연결된 Project 를 덮어쓴다 ─────────
// Play·감독 프로그램은 건드리지 않는다. 개인정보처리방침과 Project.status(공개 여부)는 바꾸지 않는다.

export const PROJECT_FIELD_LABELS: Record<string, string> = {
  title: "제목",
  description: "소개",
  coverImage: "대표 이미지",
  appLink: "앱 링크",
  techStack: "기술 스택",
};

const fieldLabel = (k: string) => PROJECT_FIELD_LABELS[k] ?? k;

// 스토어 문구(언어별)에서 한국어 먼저 글자를 고른다
function listingText(listing: unknown, field: "shortDescription" | "fullDescription"): string | null {
  if (!listing || typeof listing !== "object") return null;
  const l = listing as Record<string, Record<string, unknown> | null>;
  const langs = Object.keys(l).sort((a, b) => Number(!a.startsWith("ko")) - Number(!b.startsWith("ko")));

  for (const lang of langs) {
    const t = l[lang]?.[field];

    if (typeof t === "string" && t.trim()) return t.trim();
  }

  return null;
}

export interface PackageAppRow {
  appName?: string | null;
  storeAssets?: unknown;
  releasePackage?: unknown;
  packageName?: string | null;
  releaseStatus?: string | null;
}

/**
 * 서버에 있는 출시 자료로 Project 에 넣을 값. 파일이 PC 에만 있는 것은 없다(서버 값만).
 * - 제목: 출시 카드에서 정한 앱 이름 → 스토어 문구 앱 이름
 * - 소개: 스토어 짧은 설명(없으면 자세한 설명 2000자) — 스토어 자료 listing → 출시 패키지 storeListing
 * - 대표 이미지: 스토어 자료로 올린 대표 이미지(feature) 주소
 * - 앱 링크: 출시됨 상태이고 패키지 이름이 있으면 Play 주소
 * - 기술 스택: 앱 종류(stack)
 * 값이 없는 항목은 missing 에 이유와 함께(한국어 이름).
 */
export function packageProjectFill(app: PackageAppRow | null, stack: string | null | undefined): { fill: ProjectFill; missing: string[] } {
  const fill: ProjectFill = {};
  const missing: string[] = [];
  const sa = readStoreAssets(app?.storeAssets);
  const pkg = app?.releasePackage && typeof app.releasePackage === "object" ? (app.releasePackage as Record<string, unknown>) : null;

  const title = app?.appName?.trim() || storeTitleOf(app);

  if (title) fill.title = title;
  else missing.push(`${fieldLabel("title")}(앱 이름·스토어 제목 없음)`);

  const short = listingText(sa?.listing, "shortDescription") ?? listingText(pkg?.storeListing, "shortDescription");
  const description = short ?? (listingText(sa?.listing, "fullDescription") ?? listingText(pkg?.storeListing, "fullDescription"))?.slice(0, 2000) ?? null;

  if (description) fill.description = description;
  else missing.push(`${fieldLabel("description")}(스토어 설명 없음)`);

  const cover = sa?.images?.feature?.url;

  if (cover) fill.coverImage = cover;
  else missing.push(`${fieldLabel("coverImage")}(서버에 올린 대표 이미지 없음)`);

  if (app?.packageName && app.releaseStatus === "released") fill.appLink = `https://play.google.com/store/apps/details?id=${app.packageName}`;
  else missing.push(`${fieldLabel("appLink")}(출시 상태가 '출시됨'이 아니거나 패키지 이름 없음)`);

  fill.techStack = projectShapeForStack(stack).techStack;

  return { fill, missing };
}

export interface ProjectSyncResult {
  ok: boolean;
  status: number;
  message: string;
  projectTitle?: string;
  filled: string[]; // 빈 칸이라 채운(채울) 항목
  overwritten: string[]; // 덮어쓴(덮어쓸) 항목
  unchanged: string[]; // 같은 값이라 그대로
  skipped: string[]; // 서버에 값이 없어 건너뛴 항목(이유 포함)
  values: Record<string, string>; // 바뀌는 항목의 새 값(확인창용, 짧게)
}

/** [홈페이지만 반영]. dryRun 이면 저장하지 않고 무엇이 바뀌는지만 돌려준다. */
export async function syncProjectFromPackage(appSlug: string, opts: { dryRun?: boolean } = {}): Promise<ProjectSyncResult> {
  const empty = { filled: [], overwritten: [], unchanged: [], skipped: [], values: {} };
  const app = await prisma.factoryApp.findUnique({ where: { appSlug } });

  if (!app?.projectId) return { ok: false, status: 404, message: NO_PROJECT_MESSAGE, ...empty };
  const project = await prisma.project.findUnique({ where: { id: app.projectId }, select: { title: true } });

  if (!project) return { ok: false, status: 404, message: "연결된 프로젝트가 삭제됐어요. 카드에서 다른 프로젝트를 연결하세요.", ...empty };
  const job = await prisma.factoryJob.findFirst({ where: { appSlug }, orderBy: { createdAt: "desc" }, select: { stack: true } });
  const { fill, missing } = packageProjectFill(app, job?.stack);
  const r = await fillProjectIfEmpty(appSlug, fill, { overwrite: true, dryRun: opts.dryRun });

  if (!r.ok) return { ok: false, status: r.status, message: r.message, ...empty };
  const overwritten = r.overwritten ?? [];
  const changed = new Set(r.filled);
  const filled = r.filled.filter((k) => !overwritten.includes(k));
  const unchanged = (Object.keys(fill) as (keyof ProjectFill)[]).filter((k) => !changed.has(k));
  const values: Record<string, string> = {};

  for (const k of r.filled) {
    const v = fill[k as keyof ProjectFill];
    const text = Array.isArray(v) ? v.join(", ") : String(v ?? "");

    values[fieldLabel(k)] = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }
  const labels = (keys: string[]) => keys.map(fieldLabel).join(", ");
  const parts = [
    filled.length ? `${opts.dryRun ? "채울" : "채움"}: ${labels(filled)}` : "",
    overwritten.length ? `${opts.dryRun ? "덮어쓸" : "덮어씀"}: ${labels(overwritten)}` : "",
    unchanged.length ? `같아서 그대로: ${labels(unchanged)}` : "",
    missing.length ? `건너뜀: ${missing.join(", ")}` : "",
  ].filter(Boolean);
  const head = opts.dryRun ? `"${project.title}" 프로젝트` : r.filled.length ? `"${project.title}" 프로젝트에 반영했어요` : `"${project.title}" 프로젝트에서 바꿀 항목이 없어요`;

  return {
    ok: true,
    status: 200,
    message: `${head}. ${parts.join(" / ")}`.trim(),
    projectTitle: project.title,
    filled: filled.map(fieldLabel),
    overwritten: overwritten.map(fieldLabel),
    unchanged: unchanged.map(fieldLabel),
    skipped: missing,
    values,
  };
}

// ───────── 출시 패키지에 추가할 때 프로젝트 정하기 ─────────

/** 출시 패키지에 추가하며 '새 프로젝트 만들기'를 고른 앱: 새 앱 일감(없으면 최근 일감)의 제목·기획서로 ensureProjectForJob 과 같은 규칙으로 만든다 */
export async function createProjectForApp(appSlug: string): Promise<{ projectId: string; created: boolean } | null> {
  const select = { appSlug: true, title: true, planMarkdown: true, stack: true };
  const job =
    (await prisma.factoryJob.findFirst({ where: { appSlug, kind: "new" }, orderBy: { createdAt: "desc" }, select })) ??
    (await prisma.factoryJob.findFirst({ where: { appSlug }, orderBy: { createdAt: "desc" }, select }));

  return job ? ensureProjectForJob(job) : null;
}

/**
 * 출시 패키지에 추가한 뒤 프로젝트 연결. choice: { projectId } 기존 프로젝트(다른 앱에 연결된 건 거부) | { newProject: true } 새로 만들기 | 둘 다 없으면 건너뜀.
 * 이미 연결된 앱은 기존 연결을 그대로 둔다. 실패해도 추가는 되돌리지 않는다(메시지로만 알림).
 */
export async function linkProjectOnAdd(appSlug: string, choice: { projectId?: string | null; newProject?: boolean }): Promise<{ ok: boolean; message: string }> {
  const app = await prisma.factoryApp.findUnique({ where: { appSlug }, select: { projectId: true } });

  if (app?.projectId) return { ok: true, message: "이미 연결된 홈페이지 프로젝트를 그대로 써요." };
  if (choice.projectId) {
    const r = await linkAppProject(appSlug, choice.projectId);

    return { ok: r.ok, message: r.ok ? r.message : `프로젝트 연결은 못 했어요: ${r.message} (카드에서 다시 연결하세요)` };
  }
  if (choice.newProject) {
    try {
      const r = await createProjectForApp(appSlug);

      return r ? { ok: true, message: "새 홈페이지 프로젝트를 만들어 연결했어요(개발 중 상태)." } : { ok: false, message: "프로젝트를 만들 일감이 없어요." };
    } catch (error) {
      console.error("[factory] 홈페이지 프로젝트 만들기 실패:", error);

      return { ok: false, message: "새 프로젝트를 만들지 못했어요. 카드에서 다시 연결하세요." };
    }
  }

  return { ok: true, message: "홈페이지 프로젝트는 연결하지 않았어요(나중에 카드에서 연결할 수 있어요)." };
}

// ───────── 통제실: 기존 Project 를 공장 앱에 연결 ─────────

/** 공장 앱(일감이 한 번이라도 있었던 appSlug)과 연결 상태, 고를 수 있는 Project 목록. */
export async function listAppProjectLinks() {
  const [jobs, links, projects, rolesRow] = await Promise.all([
    prisma.factoryJob.findMany({
      orderBy: { createdAt: "desc" },
      select: { appSlug: true, title: true, stack: true, kind: true },
    }),
    prisma.factoryApp.findMany({ select: { appSlug: true, projectId: true, storeTarget: true } }),
    prisma.project.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, name: true, platform: true, status: true },
    }),
    prisma.factorySetting.findUnique({ where: { key: APP_ROLES_KEY } }),
  ]);
  const roles = readAppRoles(rolesRow?.value);
  const linkBySlug = new Map(links.map((l) => [l.appSlug, l.projectId]));
  const targetBySlug = new Map(links.map((l) => [l.appSlug, l.storeTarget]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const linkedTo = new Map(links.filter((l) => l.projectId).map((l) => [l.projectId as string, l.appSlug]));
  const newTitle = new Map(jobs.filter((j) => j.kind === "new").map((j) => [j.appSlug, j.title]));
  const seen = new Set<string>();
  // storeTarget: 출시 대상(출시 패키지 목록)인지. 대상이 아닌데 연결된 앱은 통제실에서 [연결 풀기]만 보여 준다
  const apps: { appSlug: string; title: string; stack: string; projectId: string | null; projectTitle: string | null; storeTarget: boolean; role: AppRole }[] = [];

  // 표시 이름은 새 앱 일감의 제목을 우선한다(수정 지시 제목은 "앱 (무엇)" 꼴이라). 없으면 가장 최근 일감 제목
  for (const j of jobs) {
    if (seen.has(j.appSlug)) continue;
    seen.add(j.appSlug);
    const projectId = linkBySlug.get(j.appSlug) ?? null;

    apps.push({
      appSlug: j.appSlug,
      title: newTitle.get(j.appSlug) ?? j.title,
      stack: j.stack,
      projectId,
      projectTitle: projectId ? (projectById.get(projectId)?.title ?? "(삭제된 프로젝트)") : null,
      storeTarget: targetBySlug.get(j.appSlug) === true,
      role: resolveAppRole(roles, j.appSlug),
    });
  }

  return {
    apps,
    projects: projects.map((p) => ({ ...p, linkedApp: linkedTo.get(p.id) ?? null })),
  };
}

/** 공장 앱에 Project 를 연결하거나(projectId) 연결을 푼다(null). Project 자체는 지우지 않는다. */
export async function linkAppProject(appSlug: string, projectId: string | null): Promise<{ ok: boolean; status: number; message: string }> {
  const hasJob = await prisma.factoryJob.findFirst({ where: { appSlug }, select: { id: true } });

  if (!hasJob) return { ok: false, status: 404, message: "그런 공장 앱이 없어요." };

  if (projectId === null) {
    await prisma.factoryApp.upsert({
      where: { appSlug },
      create: { appSlug, projectId: null },
      update: { projectId: null },
    });

    return { ok: true, status: 200, message: `${appSlug} 의 프로젝트 연결을 풀었어요. (프로젝트는 그대로 있어요)` };
  }

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, title: true } });

  if (!project) return { ok: false, status: 404, message: "그런 프로젝트가 없어요." };

  const other = await prisma.factoryApp.findUnique({ where: { projectId }, select: { appSlug: true } });

  if (other && other.appSlug !== appSlug) {
    return { ok: false, status: 409, message: `이 프로젝트는 이미 ${other.appSlug} 에 연결돼 있어요. 그쪽 연결을 먼저 풀어 주세요.` };
  }

  await prisma.factoryApp.upsert({
    where: { appSlug },
    create: { appSlug, projectId },
    update: { projectId },
  });

  return { ok: true, status: 200, message: `${appSlug} 를 "${project.title}" 프로젝트에 연결했어요.` };
}
