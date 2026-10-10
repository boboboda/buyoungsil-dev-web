// 앱 공장용 커넥터 도구. lib/drafts/mcp.ts 의 MCP 서버에 합쳐서 쓴다. (같은 커넥터, 같은 토큰)
// Claude 채팅은 여기서 지시를 "등록"만 한다. 승인은 관리자가 통제실에서 한다.
import { createHash } from "crypto";

import prisma from "@/lib/prisma";
import {
  ACTIVE_STATUSES,
  APP_SLUG_RE,
  ID_RE,
  JOB_STATUSES,
  MAX_PENDING_JOBS,
  MAX_PLAN,
  MIN_PLAN,
  STACKS,
} from "@/lib/factory/jobs";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError: true } : {}),
});

const json = (v: unknown) => text(JSON.stringify(v, null, 1));

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// 제어문자를 지우고 길이를 자른다.
function clean(v: unknown, max: number, keepNewlines = false): string {
  if (typeof v !== "string") return "";
  const re = keepNewlines
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
    : /[\u0000-\u001f\u007f]/g;

  return v.replace(re, "").trim().slice(0, max);
}

export const FACTORY_INSTRUCTIONS =
  " 앱 공장: 확정된 앱 기획서는 enqueue_app_job 으로 등록해요(승인은 관리자가 통제실 /admin/factory 에서 해요). " +
  "등록 전에 list_factory_jobs 로 같은 앱 이름이 이미 있는지, list_secret_names 로 쓸 수 있는 키 이름을 확인하세요. " +
  "이미 만든 앱을 고칠 때는 kind=revision 으로, 반드시 기존 앱 이름(appSlug)과 고칠 내용만 보내세요.";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const FACTORY_TOOLS = [
  {
    name: "list_factory_jobs",
    description:
      "앱 공장의 지시 목록(최근 순)을 돌려줍니다. 기획서 본문은 빼고 앱 이름(appSlug), 표시 이름, 종류, 상태, 단계, 요약만 담아요. " +
      "새 앱을 등록하기 전에 같은 이름이 이미 있는지, 수정 지시를 보내기 전에 어떤 앱이 완성돼 있는지(status=done) 확인하는 용도예요.",
    inputSchema: {
      type: "object",
      properties: {
        appSlug: {
          type: "string",
          description: "이 앱 이름의 지시만 보기 (선택)",
        },
        status: {
          type: "string",
          enum: [...JOB_STATUSES],
          description: "이 상태만 보기 (선택)",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "개수 (기본 20)",
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_factory_job",
    description:
      "지시 하나의 상세를 돌려줍니다: 상태, 완료 요약, 실패 이유, 최근 로그, 스크린샷 주소. includePlan=true 면 등록했던 기획서 본문도 같이 줘요. " +
      "수정 지시를 쓰기 전에 원래 기획과 결과 요약을 확인할 때 쓰세요.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "지시 id (list_factory_jobs 의 id)",
        },
        includePlan: {
          type: "boolean",
          description: "기획서 본문 포함 (기본 false)",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "list_secret_names",
    description:
      "앱 기획서에서 쓸 수 있는 키 이름과 설명 목록입니다. 값은 이 서버에 없고 작업 PC에만 있어요. " +
      "enqueue_app_job 의 requiredSecrets 에는 여기 나온 이름만 쓸 수 있어요.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "enqueue_app_job",
    description:
      "확정된 앱 기획서(또는 수정 내용)를 앱 공장 대기열에 등록합니다. 등록만 되고 '승인 대기' 상태로 쌓이며, 관리자가 통제실에서 승인해야 제작이 시작돼요. " +
      "규칙: appSlug 는 앱 폴더 이름(영문 소문자·숫자·하이픈 3~40자)이고 이후 수정 지시에서도 똑같이 써야 해요. " +
      "kind=new 는 아직 없는 앱만, kind=revision 은 이미 완성(done)된 앱만 가능해요. 같은 앱에 진행 중인 지시가 있으면 새로 등록할 수 없어요. " +
      "planMarkdown 은 새 앱이면 기획서 전체, 수정이면 '고칠 내용만' 적으세요(원본 기획서를 다시 보내지 마세요).",
    inputSchema: {
      type: "object",
      properties: {
        appSlug: {
          type: "string",
          description: "앱 폴더 이름. 예: one-tiny-frame",
        },
        title: {
          type: "string",
          description: "화면에 표시할 앱 이름 (80자 이내)",
        },
        kind: {
          type: "string",
          enum: ["new", "revision"],
          description: "new=새 앱(기본), revision=완성된 앱 수정",
        },
        planMarkdown: {
          type: "string",
          description: `기획서(새 앱) 또는 고칠 내용(수정). ${MIN_PLAN}~${MAX_PLAN}자, 마크다운`,
        },
        stack: {
          type: "string",
          enum: [...STACKS],
          description: "앱 종류 (기본 flutter)",
        },
        requiredSecrets: {
          type: "array",
          items: { type: "string" },
          description:
            "필요한 키 이름 (list_secret_names 에 있는 것만, 최대 10개)",
        },
        parentJobId: {
          type: "string",
          description:
            "수정 지시일 때 이어받을 이전 지시 id. 비우면 그 앱의 가장 최근 완료 지시로 이어요.",
        },
        priority: {
          type: "integer",
          minimum: -100,
          maximum: 100,
          description: "우선순위(클수록 먼저, 기본 0)",
        },
        source: {
          type: "string",
          description: "어느 기획 대화에서 온 건지 짧게 (선택, 100자 이내)",
        },
      },
      required: ["appSlug", "title", "planMarkdown"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];

const FACTORY_NAMES = new Set(FACTORY_TOOLS.map((t) => t.name));

export const isFactoryTool = (name: string) => FACTORY_NAMES.has(name);

export async function callFactoryTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case "list_factory_jobs":
      return listJobs(args);
    case "get_factory_job":
      return getJob(args);
    case "list_secret_names":
      return listSecretNames();
    case "enqueue_app_job":
      return enqueue(args);
    default:
      return text(`알 수 없는 도구예요: ${name}`, true);
  }
}

async function listJobs(args: Record<string, unknown>): Promise<ToolResult> {
  const appSlug = typeof args.appSlug === "string" ? args.appSlug.trim() : "";
  const status = typeof args.status === "string" ? args.status : "";

  if (status && !(JOB_STATUSES as readonly string[]).includes(status))
    return text("status 값이 올바르지 않아요.", true);

  const limitRaw = typeof args.limit === "number" ? Math.floor(args.limit) : 20;
  const limit = Math.min(
    50,
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20),
  );

  const jobs = await prisma.factoryJob.findMany({
    where: { ...(appSlug ? { appSlug } : {}), ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      appSlug: true,
      title: true,
      kind: true,
      parentJobId: true,
      status: true,
      phase: true,
      summary: true,
      failReason: true,
      createdAt: true,
      finishedAt: true,
    },
  });

  return json({
    지시: jobs.map((j) => ({
      id: j.id,
      appSlug: j.appSlug,
      title: j.title,
      kind: j.kind,
      parentJobId: j.parentJobId,
      status: j.status,
      phase: j.phase,
      summary: j.summary ? j.summary.slice(0, 300) : null,
      failReason: j.failReason ? j.failReason.slice(0, 300) : null,
      createdAt: iso(j.createdAt),
      finishedAt: iso(j.finishedAt),
    })),
  });
}

async function getJob(args: Record<string, unknown>): Promise<ToolResult> {
  const id = typeof args.id === "string" ? args.id.trim() : "";

  if (!ID_RE.test(id))
    return text(
      "id 가 올바르지 않아요. list_factory_jobs 의 id 를 쓰세요.",
      true,
    );

  const job = await prisma.factoryJob.findUnique({
    where: { id },
    include: {
      images: { orderBy: { createdAt: "asc" }, take: 30 },
      logs: { orderBy: { id: "desc" }, take: 30 },
    },
  });

  if (!job) return text("없는 지시예요.", true);

  return json({
    id: job.id,
    appSlug: job.appSlug,
    title: job.title,
    kind: job.kind,
    parentJobId: job.parentJobId,
    stack: job.stack,
    requiredSecrets: job.requiredSecrets,
    status: job.status,
    phase: job.phase,
    summary: job.summary,
    failReason: job.failReason,
    createdAt: iso(job.createdAt),
    startedAt: iso(job.startedAt),
    finishedAt: iso(job.finishedAt),
    스크린샷: job.images.map((i) => ({ label: i.label, url: i.url })),
    최근_로그: [...job.logs]
      .reverse()
      .map((l) => `${iso(l.at)} [${l.level}] ${l.message}`),
    ...(args.includePlan === true ? { planMarkdown: job.planMarkdown } : {}),
  });
}

async function listSecretNames(): Promise<ToolResult> {
  const names = await prisma.factorySecretName.findMany({
    orderBy: { name: "asc" },
  });

  if (names.length === 0)
    return text(
      "등록된 키 이름이 없어요. 관리자가 통제실에서 먼저 등록해야 해요.",
    );

  return json({
    키_이름: names.map((n) => ({ name: n.name, description: n.description })),
  });
}

type EnqueueFail = { ok: false; message: string };
type EnqueueOk = { ok: true; id: string; message: string };

async function enqueue(args: Record<string, unknown>): Promise<ToolResult> {
  const appSlug = typeof args.appSlug === "string" ? args.appSlug.trim() : "";
  const title = clean(args.title, 80);
  const kind = args.kind === undefined ? "new" : args.kind;
  const plan = clean(args.planMarkdown, MAX_PLAN + 1, true);
  const stack = args.stack === undefined ? "flutter" : args.stack;
  const source = clean(args.source, 100) || null;
  const parentArg =
    typeof args.parentJobId === "string" ? args.parentJobId.trim() : "";

  if (!APP_SLUG_RE.test(appSlug)) {
    return text(
      "appSlug 는 앱 폴더 이름이에요: 영문 소문자·숫자·하이픈, 3~40자, 하이픈으로 시작하거나 끝나면 안 돼요. 예: one-tiny-frame",
      true,
    );
  }
  if (!title) return text("title(표시할 앱 이름)이 필요해요.", true);
  if (kind !== "new" && kind !== "revision")
    return text("kind 는 new 또는 revision 이에요.", true);
  if (
    typeof stack !== "string" ||
    !(STACKS as readonly string[]).includes(stack)
  ) {
    return text(`stack 은 ${STACKS.join(", ")} 만 쓸 수 있어요.`, true);
  }
  if (plan.length < MIN_PLAN)
    return text(`planMarkdown 이 너무 짧아요(${MIN_PLAN}자 이상).`, true);
  if (plan.length > MAX_PLAN)
    return text(
      `planMarkdown 이 너무 길어요(${MAX_PLAN}자 이하). 핵심만 줄여서 다시 보내세요.`,
      true,
    );
  if (parentArg && !ID_RE.test(parentArg))
    return text("parentJobId 가 올바르지 않아요.", true);
  if (kind === "new" && parentArg)
    return text("parentJobId 는 kind=revision 일 때만 쓸 수 있어요.", true);

  let priority = 0;

  if (args.priority !== undefined) {
    if (
      typeof args.priority !== "number" ||
      !Number.isInteger(args.priority) ||
      args.priority < -100 ||
      args.priority > 100
    ) {
      return text("priority 는 -100 에서 100 사이 정수예요.", true);
    }
    priority = args.priority;
  }

  let secrets: string[] = [];

  if (args.requiredSecrets !== undefined) {
    if (
      !Array.isArray(args.requiredSecrets) ||
      args.requiredSecrets.some((s) => typeof s !== "string")
    ) {
      return text("requiredSecrets 는 키 이름 문자열 목록이에요.", true);
    }
    secrets = [
      ...new Set((args.requiredSecrets as string[]).map((s) => s.trim())),
    ];
    if (secrets.length > 10)
      return text("requiredSecrets 는 최대 10개예요.", true);
  }
  if (secrets.length > 0) {
    const known = await prisma.factorySecretName.findMany({
      select: { name: true },
    });
    const set = new Set(known.map((k) => k.name));
    const unknown = secrets.filter((s) => !set.has(s));

    if (unknown.length > 0) {
      return text(
        `등록되지 않은 키 이름이에요: ${unknown.join(", ")}. list_secret_names 에 있는 이름만 쓸 수 있어요. ` +
          `필요한 키가 목록에 없으면 관리자가 통제실에서 이름을 먼저 추가해야 해요.`,
        true,
      );
    }
  }

  const planHash = createHash("sha256").update(plan).digest("hex");

  // 같은 앱 이름의 동시 등록을 막으려고 앱 이름 단위로 잠근 뒤 검사하고 저장한다.
  const result: EnqueueFail | EnqueueOk = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"factory:" + appSlug}))`;

      const pendingTotal = await tx.factoryJob.count({
        where: { status: "pending" },
      });

      if (pendingTotal >= MAX_PENDING_JOBS) {
        return {
          ok: false,
          message: `승인 대기 중인 지시가 ${MAX_PENDING_JOBS}개예요. 관리자가 정리한 뒤에 다시 등록하세요.`,
        } as EnqueueFail;
      }

      const active = await tx.factoryJob.findFirst({
        where: { appSlug, status: { in: [...ACTIVE_STATUSES] } },
        select: { id: true, status: true, kind: true, planHash: true },
      });

      if (active) {
        const dup =
          active.planHash === planHash
            ? " 내용도 똑같아서 중복 등록이에요."
            : "";

        return {
          ok: false,
          message:
            `${appSlug} 에는 이미 진행 중인 지시가 있어요 (id: ${active.id}, 상태: ${active.status}).${dup} ` +
            `끝나거나 취소된 뒤에 다시 등록하세요.`,
        } as EnqueueFail;
      }

      const done = await tx.factoryJob.findMany({
        where: { appSlug, status: "done" },
        orderBy: { finishedAt: "desc" },
        select: { id: true, title: true },
      });

      let parentJobId: string | null = null;

      if (kind === "new") {
        if (done.length > 0) {
          return {
            ok: false,
            message: `${appSlug} 는 이미 만들어진 앱이에요(${done[0].title}). 고치려면 kind=revision 으로, 새 앱이면 다른 appSlug 를 쓰세요.`,
          } as EnqueueFail;
        }
      } else {
        if (done.length === 0) {
          const known = await tx.factoryJob.findMany({
            where: { status: "done" },
            distinct: ["appSlug"],
            select: { appSlug: true, title: true },
            take: 30,
          });
          const list = known.length
            ? known.map((k) => `${k.appSlug}(${k.title})`).join(", ")
            : "아직 없어요";

          return {
            ok: false,
            message: `${appSlug} 라는 완성된 앱이 없어서 수정 지시를 만들 수 없어요. 완성된 앱: ${list}. 앱 이름을 정확히 확인하세요.`,
          } as EnqueueFail;
        }
        if (parentArg) {
          const parent = await tx.factoryJob.findUnique({
            where: { id: parentArg },
            select: { appSlug: true, status: true },
          });

          if (!parent)
            return {
              ok: false,
              message: "parentJobId 에 해당하는 지시가 없어요.",
            } as EnqueueFail;
          if (parent.appSlug !== appSlug) {
            return {
              ok: false,
              message: "parentJobId 의 앱 이름이 appSlug 와 달라요.",
            } as EnqueueFail;
          }
          if (parent.status !== "done") {
            return {
              ok: false,
              message: "parentJobId 는 완료(done)된 지시여야 해요.",
            } as EnqueueFail;
          }
          parentJobId = parentArg;
        } else {
          parentJobId = done[0].id;
        }
      }

      const job = await tx.factoryJob.create({
        data: {
          appSlug,
          title,
          kind,
          parentJobId,
          planMarkdown: plan,
          planHash,
          stack,
          requiredSecrets: secrets,
          priority,
          source,
        },
        select: { id: true },
      });

      return {
        ok: true,
        id: job.id,
        message:
          `${kind === "new" ? "새 앱" : "수정 지시"}를 등록했어요 (id: ${job.id}, appSlug: ${appSlug}). ` +
          `승인 대기 상태예요. 관리자가 통제실(/admin/factory)에서 승인하면 제작이 시작돼요.`,
      } as EnqueueOk;
    },
  );

  return result.ok ? text(result.message) : text(result.message, true);
}
