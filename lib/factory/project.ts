// lib/factory/project.ts
// 공장 앱과 홈페이지 Project 를 잇는다.
// - 개발 단계: 새 앱 일감을 승인하면 Project 를 만든다(이미 있으면 그대로).
// - 출시 단계: 비어 있는 항목만 채운다. 이미 입력된 내용은 절대 덮어쓰지 않는다.
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

/** 새 앱 일감을 승인할 때 호출. 연결된 Project 가 없으면 만든다. 실패해도 승인은 그대로 진행되게 호출 쪽에서 try/catch 한다. */
export async function ensureProjectForJob(job: {
  appSlug: string;
  title: string;
  planMarkdown: string;
}): Promise<{ projectId: string; created: boolean }> {
  const app = await prisma.factoryApp.findUnique({ where: { appSlug: job.appSlug } });

  if (app?.projectId) return { projectId: app.projectId, created: false };

  const res = await createProject({
    title: job.title,
    description: summarizePlan(job.planMarkdown),
    status: "in-progress",
    platform: "mobile",
    progress: 0,
    techStack: ["Flutter"],
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

/** 출시 단계에서 비어 있는 Project 항목만 채운다. 이미 값이 있으면 건너뛴다. */
export async function fillProjectIfEmpty(appSlug: string, fill: ProjectFill): Promise<FillResult> {
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
  const pick = (key: string, isEmpty: boolean, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    if (!isEmpty) {
      skipped.push(key);

      return;
    }
    data[key] = value;
    filled.push(key);
  };

  pick("description", !project.description.trim() || project.description === PLACEHOLDER_DESCRIPTION, fill.description?.trim());
  pick("coverImage", !project.coverImage, fill.coverImage?.trim());
  pick("appLink", !project.appLink, fill.appLink?.trim());
  pick("techStack", project.techStack.length === 0, fill.techStack?.length ? fill.techStack : undefined);

  const policy = fill.privacyPolicy?.trim();

  pick("privacyPolicy", !project.privacyPolicy?.trim(), policy);
  if (data.privacyPolicy) data.privacyUpdatedAt = new Date();

  if (filled.length > 0) await prisma.project.update({ where: { id: project.id }, data });

  return {
    ok: true,
    status: 200,
    message: filled.length ? `채웠어요: ${filled.join(", ")}` : "채울 빈 항목이 없어요.",
    filled,
    skipped,
  };
}
