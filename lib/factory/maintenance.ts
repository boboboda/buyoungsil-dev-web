// lib/factory/maintenance.ts
// 공장 정비: 공장 자체(홈페이지·감독 프로그램 코드)를 고치는 대화형 스레드. 앱 일감(FactoryJob)과 따로 돈다.
// - 지시(user 메시지)마다 감독 프로그램이 정비 전용 체크아웃(~/dev/factory/selfdev)에서 같은 Claude 세션을 이어 처리한다.
// - 정비 지시가 대기·진행 중이면 새 앱 일감을 내주지 않는다(진행 중인 앱 일감은 끝까지).
// - 결과는 감독 프로그램이 검사(타입·문법)를 통과해야 GitHub main 에 올린다. 서버 코드가 바뀌었으면 사람이 [배포]를 눌러야
//   감독 프로그램이 정해진 명령 하나(서버 배포 저장소로 그 커밋 푸시)를 실행한다. 서버가 PC 로 코드를 보내지는 않는다.
// - 통제실에서 보낸 지시는 바로 대기열에, 채팅(커넥터)에서 보낸 지시는 승인을 기다린다. 채팅에서는 배포할 수 없다.
import prisma from "@/lib/prisma";
import { notifyMaintenance } from "@/lib/factory/telegram";

export const TURN_ACTIVE = ["queued", "running"] as const;
const MAX_TEXT = 8000;
const MAX_LOGS_PER_TURN = 400;
const STALE_MS = 20 * 60 * 1000; // 감독 프로그램 보고가 이만큼 없으면 멈춘 것으로 본다
const COMMIT_RE = /^[0-9a-f]{7,40}$/;

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "";

type Result = { ok: boolean; status: number; message: string; id?: string };
const fail = (status: number, message: string): Result => ({ ok: false, status, message });

// ───────── 지시 보내기 ─────────

/** 새 정비(threadId 없음) 또는 기존 정비에 이어서 지시. source=통제실 이면 바로 대기열, 채팅이면 승인 대기. */
export async function sendMaintenance(input: { threadId?: unknown; text?: unknown; source: "통제실" | "채팅" }): Promise<Result> {
  const text = clean(input.text, MAX_TEXT);

  if (text.length < 5) return fail(400, "지시를 5자 이상 적어 주세요.");
  const threadId = typeof input.threadId === "string" && input.threadId ? input.threadId : null;
  const status = input.source === "통제실" ? "queued" : "awaiting_approval";

  if (threadId) {
    const t = await prisma.factoryMaintenance.findUnique({ where: { id: threadId } });

    if (!t) return fail(404, "없는 정비예요.");
    if (t.status === "closed") return fail(409, "닫힌 정비예요. 새 정비로 보내세요.");
    const busy = await prisma.factoryMaintenanceMessage.findFirst({
      where: { maintenanceId: threadId, role: "user", status: { in: ["awaiting_approval", "queued", "running"] } },
    });

    if (busy) return fail(409, "이 정비에 아직 처리 중인(또는 승인 기다리는) 지시가 있어요. 끝난 뒤에 이어서 보내세요.");
  }

  const thread = threadId
    ? await prisma.factoryMaintenance.update({ where: { id: threadId }, data: { updatedAt: new Date() } })
    : await prisma.factoryMaintenance.create({ data: { title: text.split("\n")[0].slice(0, 60) } });
  const msg = await prisma.factoryMaintenanceMessage.create({
    data: { maintenanceId: thread.id, role: "user", text, status, source: input.source },
  });

  if (status === "awaiting_approval") await notifyMaintenance("approval", thread.id, msg.id);

  return {
    ok: true,
    status: 200,
    id: thread.id,
    message:
      status === "queued"
        ? `정비 지시를 대기열에 넣었어요(정비 ${thread.id}). 진행 중인 앱 일감이 끝나면 감독 프로그램이 시작해요. 그동안 새 앱 일감은 멈춰요.`
        : `정비 지시를 보냈어요(정비 ${thread.id}, 지시 ${msg.id}). 관리자가 통제실이나 텔레그램에서 승인하면 시작해요.`,
  };
}

export async function approveTurn(turnId: string): Promise<Result> {
  const r = await prisma.factoryMaintenanceMessage.updateMany({ where: { id: turnId, role: "user", status: "awaiting_approval" }, data: { status: "queued" } });

  return r.count ? { ok: true, status: 200, message: "정비 지시를 승인했어요. 진행 중인 앱 일감이 끝나면 시작해요." } : fail(409, "승인할 수 있는 지시가 아니에요.");
}

export async function cancelTurn(turnId: string): Promise<Result> {
  const r = await prisma.factoryMaintenanceMessage.updateMany({
    where: { id: turnId, role: "user", status: { in: ["awaiting_approval", "queued"] } },
    data: { status: "cancelled", finishedAt: new Date() },
  });

  return r.count ? { ok: true, status: 200, message: "지시를 취소했어요." } : fail(409, "시작 전인 지시만 취소할 수 있어요.");
}

export async function closeThread(threadId: string): Promise<Result> {
  const active = await prisma.factoryMaintenanceMessage.findFirst({ where: { maintenanceId: threadId, role: "user", status: { in: ["queued", "running"] } } });

  if (active) return fail(409, "처리 중인 지시가 있어서 닫을 수 없어요.");
  const r = await prisma.factoryMaintenance.updateMany({ where: { id: threadId }, data: { status: "closed" } });

  return r.count ? { ok: true, status: 200, message: "정비를 닫았어요." } : fail(404, "없는 정비예요.");
}

/** 사람이 [배포]를 누름(통제실·텔레그램). GitHub 에 올라간 커밋만 배포할 수 있다. */
export async function requestDeploy(threadId: string): Promise<Result> {
  const t = await prisma.factoryMaintenance.findUnique({ where: { id: threadId } });

  if (!t) return fail(404, "없는 정비예요.");
  if (!t.needsDeploy || !t.pushedCommit) return fail(409, "배포할 변경이 없어요.");
  if (t.deployRequestedAt && !t.deployedAt && !t.deployResult) return fail(409, "이미 배포를 요청했어요.");
  await prisma.factoryMaintenance.update({
    where: { id: threadId },
    data: { deployCommit: t.pushedCommit, deployRequestedAt: new Date(), deployStartedAt: null, deployedAt: null, deployResult: null },
  });

  return { ok: true, status: 200, message: `배포를 요청했어요(${t.pushedCommit.slice(0, 7)}). 감독 프로그램이 15초 안에 받아서 서버에 올려요(빌드 3~4분).` };
}

// ───────── 감독 프로그램 쪽 ─────────

/** 정비 지시가 대기·진행 중인가(새 앱 일감을 멈출지). */
export async function maintenanceHold(): Promise<boolean> {
  const n = await prisma.factoryMaintenanceMessage.count({ where: { role: "user", status: { in: [...TURN_ACTIVE] } } });

  return n > 0;
}

/** 오래 보고가 없는 진행 중 지시·배포를 정리한다. */
async function releaseStale(): Promise<void> {
  const cut = new Date(Date.now() - STALE_MS);
  const stale = await prisma.factoryMaintenanceMessage.findMany({ where: { role: "user", status: "running", heartbeatAt: { lt: cut } } });

  for (const s of stale) {
    await prisma.factoryMaintenanceMessage.update({ where: { id: s.id }, data: { status: "failed", finishedAt: new Date() } });
    await prisma.factoryMaintenanceMessage.create({
      data: { maintenanceId: s.maintenanceId, role: "system", text: "감독 프로그램 보고가 20분 넘게 없어서 이 지시를 실패로 정리했어요. 같은 내용을 다시 보내면 이어서 해요." },
    });
  }
  await prisma.factoryMaintenance.updateMany({
    where: { deployStartedAt: { lt: cut }, deployedAt: null, deployResult: null },
    data: { deployResult: "배포 결과 보고가 20분 넘게 없어요. 서버 배포 로그를 확인하세요." },
  });
}

/** /next 응답에 붙일 것: 다음 정비 지시(진행 중인 게 없을 때), 배포 요청. */
export async function maintenanceForNext(): Promise<{ maintenance?: object; maintenanceDeploy?: object }> {
  await releaseStale();
  const out: { maintenance?: object; maintenanceDeploy?: object } = {};
  const running = await prisma.factoryMaintenanceMessage.findFirst({ where: { role: "user", status: "running" } });

  if (!running) {
    const next = await prisma.factoryMaintenanceMessage.findFirst({
      where: { role: "user", status: "queued" },
      orderBy: { createdAt: "asc" },
      include: { maintenance: true },
    });

    if (next) {
      out.maintenance = { turnId: next.id, threadId: next.maintenanceId, title: next.maintenance.title, text: next.text, sessionId: next.maintenance.sessionId };
    }
  }
  const dep = await prisma.factoryMaintenance.findFirst({ where: { deployRequestedAt: { not: null }, deployStartedAt: null, deployResult: null } });

  if (dep?.deployCommit) out.maintenanceDeploy = { threadId: dep.id, commit: dep.deployCommit };

  return out;
}

export async function startTurn(turnId: string): Promise<Result> {
  const now = new Date();
  const r = await prisma.factoryMaintenanceMessage.updateMany({ where: { id: turnId, role: "user", status: "queued" }, data: { status: "running", startedAt: now, heartbeatAt: now } });

  return r.count ? { ok: true, status: 200, message: "시작" } : fail(409, "시작할 수 있는 지시가 아니에요(취소됐거나 이미 시작됨).");
}

export interface TurnReport {
  turnId?: unknown;
  logs?: unknown;
  done?: unknown;
}

/** 진행 로그(와 끝났으면 결과). 결과: { ok, text, sessionId?, pushedCommit?, needsDeploy? } */
export async function reportTurn(body: TurnReport): Promise<Result> {
  const turnId = typeof body.turnId === "string" ? body.turnId : "";
  const turn = turnId ? await prisma.factoryMaintenanceMessage.findUnique({ where: { id: turnId } }) : null;

  if (!turn || turn.role !== "user") return fail(404, "없는 지시예요.");
  if (turn.status !== "running") return fail(409, `지시가 진행 중이 아니에요(${turn.status}).`);

  const logs = Array.isArray(body.logs) ? body.logs.filter((l): l is string => typeof l === "string").slice(0, 50) : [];

  if (logs.length) {
    const have = await prisma.factoryMaintenanceMessage.count({ where: { maintenanceId: turn.maintenanceId, role: "log", createdAt: { gte: turn.startedAt ?? turn.createdAt } } });
    const room = Math.max(0, MAX_LOGS_PER_TURN - have);

    if (room) await prisma.factoryMaintenanceMessage.createMany({ data: logs.slice(0, room).map((t) => ({ maintenanceId: turn.maintenanceId, role: "log", text: clean(t, 1500) || "-" })) });
  }

  const d = body.done as Record<string, unknown> | undefined;

  if (!d || typeof d !== "object") {
    await prisma.factoryMaintenanceMessage.update({ where: { id: turnId }, data: { heartbeatAt: new Date() } });

    return { ok: true, status: 200, message: "기록" };
  }

  const ok = d.ok === true;
  const sessionId = typeof d.sessionId === "string" && /^[0-9a-f-]{8,64}$/i.test(d.sessionId) ? d.sessionId : undefined;
  const pushed = typeof d.pushedCommit === "string" && COMMIT_RE.test(d.pushedCommit) ? d.pushedCommit : undefined;

  await prisma.factoryMaintenanceMessage.update({ where: { id: turnId }, data: { status: ok ? "done" : "failed", finishedAt: new Date(), heartbeatAt: new Date() } });
  await prisma.factoryMaintenanceMessage.create({
    data: { maintenanceId: turn.maintenanceId, role: "assistant", text: clean(d.text, 20_000) || (ok ? "완료(요약 없음)" : "실패(사유 없음)") },
  });
  await prisma.factoryMaintenance.update({
    where: { id: turn.maintenanceId },
    data: {
      ...(sessionId ? { sessionId } : {}),
      ...(pushed ? { pushedCommit: pushed, deployRequestedAt: null, deployStartedAt: null, deployedAt: null, deployResult: null } : {}),
      ...(pushed && d.needsDeploy === true ? { needsDeploy: true } : {}),
    },
  });
  await notifyMaintenance(ok ? "done" : "failed", turn.maintenanceId, turnId);

  return { ok: true, status: 200, message: "결과 저장" };
}

export async function deployStarted(threadId: string, commit: string): Promise<Result> {
  const r = await prisma.factoryMaintenance.updateMany({
    where: { id: threadId, deployCommit: commit, deployRequestedAt: { not: null }, deployStartedAt: null, deployResult: null },
    data: { deployStartedAt: new Date() },
  });

  return r.count ? { ok: true, status: 200, message: "배포 시작" } : fail(409, "배포 요청이 없거나 이미 시작됐어요.");
}

export async function deployFinished(threadId: string, ok: boolean, output: string): Promise<Result> {
  const t = await prisma.factoryMaintenance.findUnique({ where: { id: threadId } });

  if (!t?.deployStartedAt) return fail(409, "시작한 배포가 없어요.");
  await prisma.factoryMaintenance.update({
    where: { id: threadId },
    data: { deployedAt: ok ? new Date() : null, deployResult: clean(output, 4000) || (ok ? "배포 완료" : "배포 실패"), ...(ok ? { needsDeploy: false } : {}) },
  });
  await prisma.factoryMaintenanceMessage.create({
    data: { maintenanceId: threadId, role: "system", text: ok ? `서버 배포 완료(${t.deployCommit?.slice(0, 7)}).` : `서버 배포 실패: ${clean(output, 1500)}` },
  });
  await notifyMaintenance(ok ? "deployed" : "deploy_failed", threadId);

  return { ok: true, status: 200, message: "기록" };
}

// ───────── 보기 ─────────

export async function maintenanceOverview(opts: { threadId?: string; limit?: number; withLogs?: boolean } = {}) {
  const threads = await prisma.factoryMaintenance.findMany({
    where: opts.threadId ? { id: opts.threadId } : {},
    orderBy: { updatedAt: "desc" },
    take: opts.threadId ? 1 : (opts.limit ?? 20),
    include: { messages: { orderBy: { createdAt: "asc" }, ...(opts.withLogs === false ? { where: { role: { not: "log" } } } : {}) } },
  });
  const hold = await maintenanceHold();

  return {
    hold, // true 면 새 앱 일감이 멈춰 있다
    threads: threads.map((t) => {
      const turns = t.messages.filter((m) => m.role === "user");
      const active = turns.find((m) => ["awaiting_approval", "queued", "running"].includes(m.status ?? ""));
      const logs = t.messages.filter((m) => m.role === "log");

      return {
        id: t.id,
        title: t.title,
        status: t.status,
        activeTurn: active ? { id: active.id, status: active.status, source: active.source } : null,
        pushedCommit: t.pushedCommit,
        needsDeploy: t.needsDeploy,
        deploy: {
          commit: t.deployCommit,
          requestedAt: t.deployRequestedAt,
          startedAt: t.deployStartedAt,
          deployedAt: t.deployedAt,
          result: t.deployResult,
        },
        updatedAt: t.updatedAt,
        messages: [...t.messages.filter((m) => m.role !== "log"), ...logs.slice(-60)]
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((m) => ({ id: m.id, role: m.role, text: m.text, status: m.status, source: m.source, createdAt: m.createdAt })),
      };
    }),
  };
}
