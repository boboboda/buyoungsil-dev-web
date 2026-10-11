// 앱 공장용 커넥터 도구. lib/drafts/mcp.ts 의 MCP 서버에 합쳐서 쓴다. (같은 커넥터, 같은 토큰)
// Claude 채팅은 여기서 지시를 "등록"만 한다. 승인은 관리자가 통제실에서 한다.
import { createHash } from "crypto";

import prisma from "@/lib/prisma";
import { notifyJobEvent } from "@/lib/factory/telegram";
import { runSupervisorAction, SUPERVISOR_ACTIONS, type SupervisorAction } from "@/lib/factory/supervisor";
import { buildReleasePlan, releaseOverview } from "@/lib/factory/release";
import {
  ACTIVE_STATUSES,
  APP_SLUG_RE,
  ID_RE,
  JOB_STATUSES,
  MAX_PENDING_JOBS,
  MAX_PLAN,
  MIN_PLAN,
  STACK_LABELS,
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
  "이미 만든 앱을 고칠 때는 kind=revision 으로, 반드시 기존 앱 이름(appSlug)과 고칠 내용만 보내세요. "
  + "관리자가 통제실에서 직접 보낸 수정 지시는 source 가 '통제실'로 나와요. 결과는 get_factory_job(includePlan=true)으로 읽고 사용자와 의논하세요. "
  + "작업 PC 감독 프로그램은 supervisor_control 로 봐요: action=status(연결·버전·일시 정지·자동 업데이트·진행/대기 일감 수), "
  + "update_now(GitHub main 의 새 감독 프로그램 코드를 지금 받게 함. 15초~1분 뒤 status 의 commit 으로 확인), pause/resume(새 일감 받기 멈춤/재개), "
  + "auto_update_on/off. 사용자가 요청한 경우에만 상태를 바꾸세요. "
  + "출시: get_release_status 로 앱별 출시 상태·배포 계정·패키지(스토어 문구·체크리스트)·AAB 정보·테스트 일정을 보고, "
  + "enqueue_release_job(appSlug) 으로 출시 준비 일감을 등록해요(지시문은 서버가 배포 계정 정보로 만들고, 승인은 관리자). "
  + "출시 준비는 enqueue_app_job 이 아니라 이 도구로만 보내요. 결과는 get_factory_job 과 get_release_status 로 확인하세요.";

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
          description:
            "앱 종류 (새 앱만, 기본 flutter). 수정 지시는 원래 앱의 종류를 그대로 써요. " +
            STACKS.map((k) => `${k}=${STACK_LABELS[k]}`).join(" / "),
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
  {
    name: "get_release_status",
    description:
      "완성된 앱들의 출시 상태를 돌려줍니다: 출시 단계(준비중/패키지 생성/검토/비공개 테스트/출시), 배포 계정(A/B)과 키 준비 상태(경로·PC 에 있는지만), " +
      "패키지 이름, 최초 업로드 여부, 비공개 테스트 시작·완료 예정일, 출시 패키지 요약(스토어 제목·짧은 설명·체크리스트 남은 할 일·찾은 SDK), AAB 정보(경로·크기·버전, 파일은 PC 에만). " +
      "키 값은 담지 않아요.",
    inputSchema: {
      type: "object",
      properties: {
        appSlug: { type: "string", description: "이 앱만 보기 (선택)" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "enqueue_release_job",
    description:
      "완성된 앱에 출시 준비 일감을 등록합니다(승인 대기, 승인은 관리자). 지시문은 서버가 그 앱의 배포 계정 정보로 만들어요: " +
      "개인정보처리방침 초안, 스토어 문구(한/영), 데이터 보안·콘텐츠 등급 답안, 체크리스트, (서명 키가 있으면) 서명 AAB, " +
      "(최초 업로드 뒤 서비스 계정 키가 있으면) 비공개 테스트 트랙 업로드. 먼저 통제실 출시 패키지에서 배포 계정을 골라 둬야 해요. " +
      "끝나면 get_factory_job 과 get_release_status 로 확인하세요.",
    inputSchema: {
      type: "object",
      properties: {
        appSlug: { type: "string", description: "완성된 앱 이름 (list_factory_jobs 의 appSlug)" },
        source: { type: "string", description: "어느 대화에서 온 건지 짧게 (선택, 100자 이내)" },
      },
      required: ["appSlug"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "supervisor_control",
    description:
      "작업 PC 의 감독 프로그램 상태를 보거나 정해진 명령을 보냅니다. 명령은 홈페이지에 신호로 남고, 감독 프로그램이 15초마다 확인할 때 가져가요. " +
      "status=연결 여부·현재 버전(commit)·최근 업데이트 소식·일시 정지/자동 업데이트 상태·진행/대기 일감 수, " +
      "update_now=GitHub main 의 새 감독 프로그램 코드를 지금 확인해 받게 함(돌고 있는 일감이 있으면 끝난 뒤. 새 버전이면 30초쯤 뒤 다시 켜짐), " +
      "pause=새 일감 받기 멈춤(진행 중 작업은 끝까지), resume=다시 받기, auto_update_on/off=10분마다 하는 자동 업데이트 켜고 끄기. " +
      "상태를 바꾸는 명령은 사용자가 요청했을 때만 쓰세요.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...SUPERVISOR_ACTIONS],
          description: "status | update_now | pause | resume | auto_update_on | auto_update_off",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
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
      // 출시 준비는 서버가 지시문을 만드는 enqueue_release_job 으로만
      if (args.kind === "release") return text("출시 준비 일감은 enqueue_release_job(appSlug) 으로 보내세요.", true);
      return enqueue(args);
    case "supervisor_control":
      return supervisorControl(args);
    case "get_release_status":
      return getReleaseStatus(args);
    case "enqueue_release_job":
      return enqueueReleaseJob(args);
    default:
      return text(`알 수 없는 도구예요: ${name}`, true);
  }
}

// 출시 상태. 키 값은 없다(경로·이름·존재 여부만). 패키지는 요약만(전문은 통제실 출시 패키지 화면).
async function getReleaseStatus(args: Record<string, unknown>): Promise<ToolResult> {
  const appSlug = typeof args.appSlug === "string" ? args.appSlug.trim() : "";
  const o = await releaseOverview();
  const label = (v: string) => o.statuses.find((s) => s.value === v)?.label ?? v;
  const apps = o.apps.filter((a) => a.done && (!appSlug || a.appSlug === appSlug));

  if (appSlug && apps.length === 0) return text(`${appSlug} 라는 완성된 앱이 없어요.`, true);
  const summarize = (pkg: Record<string, unknown> | null) => {
    if (!pkg) return null;
    const listing = (pkg.storeListing ?? {}) as Record<string, { title?: string; shortDescription?: string }>;
    const checklist = Array.isArray(pkg.checklist) ? (pkg.checklist as { item?: string; done?: boolean }[]) : [];

    return {
      스토어제목: Object.fromEntries(Object.entries(listing).map(([k, v]) => [k, v?.title ?? null])),
      짧은설명: Object.fromEntries(Object.entries(listing).map(([k, v]) => [k, v?.shortDescription ?? null])),
      체크리스트: `${checklist.filter((c) => c.done).length}/${checklist.length} 완료`,
      남은할일: checklist.filter((c) => !c.done).map((c) => c.item).slice(0, 15),
      찾은SDK: pkg.sdks ?? null,
      메모: typeof pkg.notes === "string" ? pkg.notes.slice(0, 500) : null,
    };
  };

  return json({
    배포계정: o.accounts.map((a) => {
      const pc = (k: string) => o.pcStatus?.items.find((i) => i.key === `${a.label}.${k}`);

      return {
        계정: a.label,
        이름: a.name,
        비공개테스트필요: a.requiresTesting,
        개발자이름: a.developerName,
        연락이메일: a.contactEmail,
        서명키: a.keystorePath ? (pc("keystore")?.exists ? "PC 에 있음" : pc("keystore") ? "PC 에 없음" : "경로만 등록(PC 확인 전)") : "없음",
        서비스계정키: a.serviceAccountKeyPath ? (pc("serviceAccount")?.exists ? "PC 에 있음" : pc("serviceAccount") ? "PC 에 없음" : "경로만 등록(PC 확인 전)") : "없음",
      };
    }),
    앱: apps.map((a) => ({
      appSlug: a.appSlug,
      이름: a.title,
      종류: a.stack,
      출시상태: label(a.releaseStatus),
      배포계정: o.accounts.find((x) => x.id === a.releaseAccountId)?.label ?? null,
      패키지이름: a.packageName,
      최초업로드완료: a.firstUploadDone,
      비공개테스트: a.testingStartedAt ? { 시작: iso(a.testingStartedAt), 완료예정: iso(a.testingDueAt) } : null,
      진행중일감: a.active,
      최근출시준비일감: a.lastReleaseJob,
      패키지생성: iso(a.releasePackageAt),
      패키지: summarize(a.releasePackage as Record<string, unknown> | null),
      AAB: a.aab,
    })),
  });
}

// 출시 준비 일감 등록. 지시문은 서버가 배포 계정 정보로 만든다(채팅이 쓰지 않음). 승인은 관리자가 통제실/텔레그램에서.
export async function enqueueReleaseJob(args: Record<string, unknown>): Promise<ToolResult> {
  const appSlug = typeof args.appSlug === "string" ? args.appSlug.trim() : "";

  if (!APP_SLUG_RE.test(appSlug)) return text("appSlug 가 올바르지 않아요.", true);
  const plan = await buildReleasePlan(appSlug);

  if ("message" in plan) return text(plan.message, true);
  const o = await releaseOverview();
  const app = o.apps.find((a) => a.appSlug === appSlug);

  if (!app?.done) return text(`${appSlug} 는 완성된 앱이 아니에요.`, true);

  return enqueue({
    appSlug,
    title: `${app.title} (출시 준비)`,
    kind: "release",
    planMarkdown: plan.plan,
    requiredSecrets: plan.requiredSecrets,
    source: clean(args.source, 100) || "채팅",
  });
}

async function supervisorControl(args: Record<string, unknown>): Promise<ToolResult> {
  const action = args.action;

  if (typeof action !== "string" || !(SUPERVISOR_ACTIONS as readonly string[]).includes(action)) {
    return text(`action 은 ${SUPERVISOR_ACTIONS.join(", ")} 중 하나예요.`, true);
  }
  const { message, snapshot: s } = await runSupervisorAction(action as SupervisorAction);

  return json({
    ...(message ? { 결과: message } : {}),
    연결: s.online ? "연결됨" : "응답 없음(PC 꺼짐 또는 감독 프로그램 멈춤)",
    작업PC: s.workerName,
    마지막응답: iso(s.lastSeenAt),
    현재버전: s.commit,
    최근업데이트소식: s.updateNote,
    최근업데이트소식시각: s.updateNoteAt,
    지금업데이트요청대기: s.updateNowRequestedAt,
    일시정지: !s.enabled,
    자동업데이트: s.autoUpdate,
    진행중: s.running,
    승인됨_대기열: s.approved,
    승인기다림: s.pending,
  });
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
      stack: true,
      parentJobId: true,
      status: true,
      phase: true,
      summary: true,
      failReason: true,
      source: true,
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
      stack: j.stack,
      parentJobId: j.parentJobId,
      status: j.status,
      phase: j.phase,
      summary: j.summary ? j.summary.slice(0, 300) : null,
      failReason: j.failReason ? j.failReason.slice(0, 300) : null,
      source: j.source,
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
    source: job.source,
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

export async function enqueue(args: Record<string, unknown>): Promise<ToolResult> {
  const appSlug = typeof args.appSlug === "string" ? args.appSlug.trim() : "";
  const title = clean(args.title, 80);
  const kind = args.kind === undefined ? "new" : args.kind;
  const plan = clean(args.planMarkdown, MAX_PLAN + 1, true);
  const stackArg = args.stack;
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
  if (kind !== "new" && kind !== "revision" && kind !== "release")
    return text("kind 는 new, revision, release 중 하나예요.", true);
  if (
    stackArg !== undefined &&
    (typeof stackArg !== "string" ||
      !(STACKS as readonly string[]).includes(stackArg))
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
    return text("parentJobId 는 kind=revision/release 일 때만 쓸 수 있어요.", true);

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
        select: { id: true, title: true, stack: true },
      });

      let parentJobId: string | null = null;
      // 새 앱은 고른 종류(기본 flutter), 수정 지시는 원래 앱의 종류를 그대로 쓴다.
      let stack = typeof stackArg === "string" ? stackArg : "flutter";

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
            select: { appSlug: true, status: true, stack: true },
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
          stack = parent.stack;
        } else {
          parentJobId = done[0].id;
          stack = done[0].stack;
        }
        if (typeof stackArg === "string" && stackArg !== stack) {
          return {
            ok: false,
            message: `${appSlug} 는 ${stack} 앱이라 수정 지시도 ${stack} 이에요. stack 을 빼고 다시 보내세요.`,
          } as EnqueueFail;
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
          `${kind === "new" ? "새 앱" : kind === "release" ? "출시 준비 일감" : "수정 지시"}를 등록했어요 (id: ${job.id}, appSlug: ${appSlug}). ` +
          `승인 대기 상태예요. 관리자가 통제실(/admin/factory)에서 승인하면 제작이 시작돼요.`,
      } as EnqueueOk;
    },
  );

  // 승인 대기 알림. 통제실에서 직접 보낸 지시는 보낸 사람이 이미 아니까 알리지 않는다.
  if (result.ok && source !== "통제실") void notifyJobEvent(result.id, "pending");

  return result.ok ? text(result.message) : text(result.message, true);
}
