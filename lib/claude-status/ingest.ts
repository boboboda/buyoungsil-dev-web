// lib/claude-status/ingest.ts
// Claude Code 훅이 보낸 상태 이벤트를 검증하고 저장한다.
// 프롬프트·코드 내용은 받지 않는다. 정해진 필드만 읽고 나머지는 버린다.
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

export const EVENT_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SubagentStop",
  "SessionEnd",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

const EVENT_SET = new Set<string>(EVENT_NAMES);

// 이 이벤트만 claude_events 에 쌓는다. 도구 호출은 너무 잦아서 세션 행만 갱신한다.
const LOGGED_EVENTS = new Set<EventName>([
  "SessionStart",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SessionEnd",
]);

const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;
const MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_TOKEN_VALUE = 1_000_000_000_000;
const MAX_INT = 2_000_000_000; // claude_events 증가분 컬럼(Int) 상한
const EVENT_KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const SESSION_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const kstDate = (d: Date) =>
  new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);

export interface Usage {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface StatusPayload {
  event: EventName;
  sessionId: string;
  project: string;
  device: string;
  tool: string | null;
  at: Date;
  usage: Usage | null; // 세션 "누적" 토큰 (이번 증가분이 아님)
}

export type ValidateResult =
  | { ok: true; payload: StatusPayload }
  | { ok: false; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// 제어문자를 지우고 길이를 자른다. 비어 있으면 null.
function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;

  const t = v
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);

  return t.length > 0 ? t : null;
}

function tokenValue(v: unknown): number | null {
  if (v === undefined || v === null) return 0;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < 0 || v > MAX_TOKEN_VALUE) return null;

  return Math.floor(v);
}

function parseUsage(v: unknown): Usage | null | "invalid" {
  if (v === undefined || v === null) return null;
  if (!isRecord(v)) return "invalid";

  const input = tokenValue(v.input);
  const output = tokenValue(v.output);
  const cacheCreate = tokenValue(v.cacheCreate);
  const cacheRead = tokenValue(v.cacheRead);

  if (
    input === null ||
    output === null ||
    cacheCreate === null ||
    cacheRead === null
  ) {
    return "invalid";
  }

  return { input, output, cacheCreate, cacheRead };
}

export function validatePayload(body: unknown): ValidateResult {
  if (!isRecord(body))
    return { ok: false, reason: "요청 형식이 올바르지 않습니다." };

  const event = typeof body.event === "string" ? body.event : "";

  if (!EVENT_SET.has(event))
    return { ok: false, reason: "알 수 없는 이벤트입니다." };

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";

  if (!SESSION_ID_RE.test(sessionId)) {
    return { ok: false, reason: "sessionId 형식이 올바르지 않습니다." };
  }

  const project = cleanText(body.project, 100);
  const device = cleanText(body.device, 60);

  if (!project) return { ok: false, reason: "project 가 필요합니다." };
  if (!device) return { ok: false, reason: "device 가 필요합니다." };

  const usage = parseUsage(body.usage);

  if (usage === "invalid")
    return { ok: false, reason: "usage 값이 올바르지 않습니다." };

  const now = Date.now();
  let at = now;

  if (typeof body.ts === "number" && Number.isFinite(body.ts)) {
    if (body.ts >= now - MAX_PAST_MS && body.ts <= now + MAX_FUTURE_MS)
      at = body.ts;
  }

  return {
    ok: true,
    payload: {
      event: event as EventName,
      sessionId,
      project,
      device,
      tool: cleanText(body.tool, 80),
      at: new Date(at),
      usage,
    },
  };
}

// 이벤트가 세션 상태를 어떻게 바꾸는지. null 이면 상태를 그대로 둔다.
function nextStatus(event: EventName, prev: string | undefined): string | null {
  switch (event) {
    case "SessionStart":
      // 이어하기·압축 때도 SessionStart 가 오므로, 이미 있는 세션의 상태는 건드리지 않는다.
      return !prev || prev === "ended" ? "idle" : null;
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
      return "working";
    case "Notification":
      // 작업 중에 온 알림만 "입력 필요"로 본다. 작업을 마친 뒤 오는 "입력을 기다리는 중" 알림은 완료 상태를 유지한다.
      return prev === "working" ? "waiting" : null;
    case "Stop":
      return "idle";
    case "SubagentStop":
      return null; // 서브에이전트가 끝나도 메인 작업은 계속된다
    case "SessionEnd":
      return "ended";
  }
}

// 누적값이 줄었으면(압축 등으로 기록이 새로 시작됨) 새 값을 그대로 증가분으로 본다.
const increase = (current: number, before: number) =>
  current >= before ? current - before : current;

const clampInt = (n: number) => Math.min(n, MAX_INT);

async function saveOnce(p: StatusPayload): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const prev = await tx.claudeSession.findUnique({
      where: { id: p.sessionId },
    });

    // 늦게 도착한 이벤트는 상태와 토큰을 덮어쓰지 않는다.
    const outOfOrder = prev
      ? p.at.getTime() < prev.lastEventAt.getTime()
      : false;

    const status = outOfOrder
      ? (prev?.status ?? "idle")
      : (nextStatus(p.event, prev?.status) ?? prev?.status ?? "idle");

    // 처음 보는 세션이거나 SessionStart 이면 "기준선"만 잡는다.
    // (훅을 작업 도중에 켰거나 이전 대화를 이어서 열었을 때, 그동안의 토큰이 오늘 사용량으로 잡히지 않게)
    const baselineOnly = !prev || p.event === "SessionStart";

    let delta: Usage = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };

    if (p.usage && !outOfOrder && !baselineOnly && prev) {
      delta = {
        input: increase(p.usage.input, Number(prev.inputTokens)),
        output: increase(p.usage.output, Number(prev.outputTokens)),
        cacheCreate: increase(
          p.usage.cacheCreate,
          Number(prev.cacheCreateTokens),
        ),
        cacheRead: increase(p.usage.cacheRead, Number(prev.cacheReadTokens)),
      };
    }

    const totals =
      p.usage && !outOfOrder
        ? {
            inputTokens: BigInt(p.usage.input),
            outputTokens: BigInt(p.usage.output),
            cacheCreateTokens: BigInt(p.usage.cacheCreate),
            cacheReadTokens: BigInt(p.usage.cacheRead),
          }
        : {};

    await tx.claudeSession.upsert({
      where: { id: p.sessionId },
      create: {
        id: p.sessionId,
        device: p.device,
        project: p.project,
        status,
        lastEvent: p.event,
        lastTool: p.tool,
        startedAt: p.at,
        lastEventAt: p.at,
        ...totals,
      },
      update: outOfOrder
        ? {}
        : {
            device: p.device,
            project: p.project,
            status,
            lastEvent: p.event,
            // 알림에는 도구 정보가 없으므로, "어떤 도구에서 멈췄는지" 보이도록 직전 값을 남긴다.
            lastTool: p.event === "Notification" ? undefined : p.tool,
            lastEventAt: p.at,
            ...totals,
          },
    });

    const hasDelta =
      delta.input + delta.output + delta.cacheCreate + delta.cacheRead > 0;

    if (hasDelta) {
      await tx.claudeDailyUsage.upsert({
        where: {
          date_device_project: {
            date: kstDate(p.at),
            device: p.device,
            project: p.project,
          },
        },
        create: {
          date: kstDate(p.at),
          device: p.device,
          project: p.project,
          inputTokens: BigInt(delta.input),
          outputTokens: BigInt(delta.output),
          cacheCreateTokens: BigInt(delta.cacheCreate),
          cacheReadTokens: BigInt(delta.cacheRead),
        },
        update: {
          inputTokens: { increment: BigInt(delta.input) },
          outputTokens: { increment: BigInt(delta.output) },
          cacheCreateTokens: { increment: BigInt(delta.cacheCreate) },
          cacheReadTokens: { increment: BigInt(delta.cacheRead) },
        },
      });
    }

    if (!outOfOrder && LOGGED_EVENTS.has(p.event)) {
      await tx.claudeEvent.create({
        data: {
          sessionId: p.sessionId,
          event: p.event,
          at: p.at,
          inputDelta: clampInt(delta.input),
          outputDelta: clampInt(delta.output),
          cacheCreateDelta: clampInt(delta.cacheCreate),
          cacheReadDelta: clampInt(delta.cacheRead),
        },
      });
    }
  });
}

// 같은 새 세션의 이벤트가 동시에 들어오면 한쪽이 충돌할 수 있어서 한 번만 다시 시도한다.
export async function saveStatus(p: StatusPayload): Promise<void> {
  try {
    await saveOnce(p);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      await saveOnce(p);
    } else {
      throw error;
    }
  }

  // 오래된 기록 정리. 실패해도 이벤트 저장에는 영향이 없다.
  if (p.event === "SessionEnd" || Math.random() < 0.02) {
    try {
      const now = Date.now();

      await prisma.claudeEvent.deleteMany({
        where: { at: { lt: new Date(now - EVENT_KEEP_MS) } },
      });
      await prisma.claudeSession.deleteMany({
        where: { lastEventAt: { lt: new Date(now - SESSION_KEEP_MS) } },
      });
    } catch (error) {
      console.error("[claude-status] 오래된 기록 정리 실패:", error);
    }
  }
}
