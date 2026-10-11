// lib/factory/project.ts
// 공장 앱과 홈페이지 Project 를 잇는다.
// - 개발 단계: 새 앱 일감을 승인하면 Project 를 만든다(이미 있으면 그대로).
// - 출시 단계: 비어 있는 항목만 채운다. 이미 입력된 내용은 덮어쓰지 않는다.
//   예외: 사람이 승인 때 '홈페이지 프로젝트도 덮어쓰기'를 고른 스토어 자료 수정·프로젝트 업데이트 일감(overwrite)은
//   설명·대표 이미지·앱 링크·기술 스택을 바꾼다. 개인정보처리방침은 그때도 빈 칸일 때만 채운다.
//   단 '개인정보처리방침 갱신'을 고른 일감(privacyOverwrite)은 덮어쓰기 선택과 상관없이 방침을 바꾼다([[ ]] 검사는 그대로).
import prisma from "@/lib/prisma";
import { createProject } from "@/serverActions/projects";
import { hasUnfilledPlaceholder } from "@/lib/privacy/template";

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

/** 새 앱 일감을 승인할 때 호출. 연결된 Project 가 없으면 만든다. 실패해도 승인은 그대로 진행되게 호출 쪽에서 try/catch 한다. */
export async function ensureProjectForJob(job: {
  appSlug: string;
  title: string;
  planMarkdown: string;
  stack?: string | null;
}): Promise<{ projectId: string; created: boolean }> {
  const app = await prisma.factoryApp.findUnique({ where: { appSlug: job.appSlug } });

  if (app?.projectId) return { projectId: app.projectId, created: false };

  const shape = projectShapeForStack(job.stack);
  const res = await createProject({
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
  filled: string[];
  skipped: string[];
}

const PLACEHOLDER_DESCRIPTION = "개발 중인 앱입니다.";

/**
 * 출시 단계에서 비어 있는 Project 항목만 채운다. 이미 값이 있으면 건너뛴다(opts.overwrite 면 개인정보처리방침 말고는 바꾼다).
 * opts.privacyOverwrite 면 개인정보처리방침도 바꾼다.
 */
export async function fillProjectIfEmpty(
  appSlug: string,
  fill: ProjectFill,
  opts: { overwrite?: boolean; privacyOverwrite?: boolean } = {},
): Promise<FillResult> {
  const app = await prisma.factoryApp.findUnique({ where: { appSlug } });

  if (!app?.projectId) {
    return { ok: false, status: 404, message: "연결된 홈페이지 프로젝트가 없어요. 새 앱 일감을 승인하면 만들어져요.", filled: [], skipped: [] };
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

  if (filled.length + overwritten.length > 0) await prisma.project.update({ where: { id: project.id }, data });
  const parts = [filled.length ? `채웠어요: ${filled.join(", ")}` : "", overwritten.length ? `덮어썼어요: ${overwritten.join(", ")}` : ""].filter(Boolean);

  return {
    ok: true,
    status: 200,
    message: parts.length ? parts.join(" / ") : opts.overwrite || opts.privacyOverwrite ? "바꿀 항목이 없어요." : "채울 빈 항목이 없어요.",
    filled: [...filled, ...overwritten],
    skipped,
  };
}

// ───────── 통제실: 기존 Project 를 공장 앱에 연결 ─────────

/** 공장 앱(일감이 한 번이라도 있었던 appSlug)과 연결 상태, 고를 수 있는 Project 목록. */
export async function listAppProjectLinks() {
  const [jobs, links, projects] = await Promise.all([
    prisma.factoryJob.findMany({
      orderBy: { createdAt: "desc" },
      select: { appSlug: true, title: true, stack: true, kind: true },
    }),
    prisma.factoryApp.findMany({ select: { appSlug: true, projectId: true } }),
    prisma.project.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, name: true, platform: true, status: true },
    }),
  ]);
  const linkBySlug = new Map(links.map((l) => [l.appSlug, l.projectId]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const linkedTo = new Map(links.filter((l) => l.projectId).map((l) => [l.projectId as string, l.appSlug]));
  const newTitle = new Map(jobs.filter((j) => j.kind === "new").map((j) => [j.appSlug, j.title]));
  const seen = new Set<string>();
  const apps: { appSlug: string; title: string; stack: string; projectId: string | null; projectTitle: string | null }[] = [];

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
