// lib/factory/maintenance.ts
// 공장 정비: 공장 자체(홈페이지·감독 프로그램 코드)를 고치는 대화형 스레드. 앱 일감(FactoryJob)과 따로 돈다.
// - 지시(user 메시지)마다 감독 프로그램이 정비 전용 체크아웃(~/dev/factory/selfdev)에서 같은 Claude 세션을 이어 처리한다.
// - 대기열: 처리 중·승인 대기인 지시가 있어도 새 지시는 거절하지 않고 쌓는다. 모든 대화의 지시를 보낸 순서(createdAt)대로 한 번에 하나씩.
//   맨 앞 지시가 승인 대기면 뒤의 승인된 지시도 기다린다(순서 보존). 앞 지시가 실패하면 대기열을 멈추고 사람이
//   [계속 진행](건너뛰기)·[재시도]·[대기열 비우기] 중에 고른다(멈춤 표시는 FactorySetting maintenanceQueueHalt).
// - 정비 지시가 대기(queued)·진행 중이면 새 앱 일감을 내주지 않는다(진행 중인 앱 일감은 끝까지). 승인 대기만 있으면 멈추지 않는다.
// - 결과는 감독 프로그램이 검사(타입·문법)를 통과해야 GitHub main 에 올린다. 서버 코드가 바뀌었으면 사람이 [배포]를 눌러야
//   감독 프로그램이 정해진 명령 하나(서버 배포 저장소로 그 커밋 푸시)를 실행한다. 서버가 PC 로 코드를 보내지는 않는다.
// - 배포 묶기: 대기열에 남은 지시가 있으면 [배포]는 막고(급하면 [지금 배포]), 대기열이 다 끝나면 '배포 필요'를 한 번만 알린다.
//   배포는 GitHub main 의 가장 최근 정비 커밋 하나로, 그때까지 배포 안 된 지시들이 모두 들어간다(main 은 한 줄로 쌓이므로).
//   설정 '대기열 끝나면 자동 배포'(기본 꺼짐)가 켜져 있으면 그때 한 번 자동으로 요청한다(지난 배포 뒤 실패한 지시가 있으면 안 함).
// - 통제실에서 보낸 지시는 바로 대기열에, 채팅(커넥터)에서 보낸 지시는 승인을 기다린다. 채팅에서는 배포할 수 없다.
import prisma from "@/lib/prisma";
import { isAiEngine, readModelChoice, type AiEngine, type ClaudeModel } from "@/lib/factory/ai";
import { maskSecrets } from "@/lib/factory/mask";
import { notifyDeployReady, notifyMaintenance, notifyText } from "@/lib/factory/telegram";
import { getDefaultAiEngine, getDefaultClaudeModel, getSettingValue, isAutoDeployEnabled, setSettingValue } from "@/lib/factory/settings";

export const TURN_ACTIVE = ["queued", "running"] as const;
const QUEUE_STATES = ["awaiting_approval", "queued", "running"];
const MAX_TEXT = 8000;
const MAX_LOGS_PER_TURN = 400;
const STALE_MS = 20 * 60 * 1000; // 감독 프로그램 보고가 이만큼 없으면 멈춘 것으로 본다
const COMMIT_RE = /^[0-9a-f]{7,40}$/;
const HALT_KEY = "maintenanceQueueHalt"; // { turnId, threadId, at } 실패해서 멈춘 대기열
const NOTIFIED_KEY = "maintenanceDeployNotified"; // '배포 필요'를 알린 커밋(한 번만 알리려고)

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "";
const firstLine = (v: string) => v.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 80) ?? "";
const short = (c: string | null | undefined) => (c ? c.slice(0, 7) : "?");

type Result = { ok: boolean; status: number; message: string; id?: string };
const fail = (status: number, message: string): Result => ({ ok: false, status, message });

// ───────── 대기열 ─────────

interface Halt {
  turnId: string;
  threadId: string;
  at: string;
}

/** 실패로 멈춘 대기열. 기다리는 지시가 하나도 없으면 멈춤도 지운다(새로 보낸 지시가 막히지 않게). */
async function getHalt(): Promise<Halt | null> {
  const raw = await getSettingValue(HALT_KEY);

  if (!raw) return null;
  let h: Halt | null = null;

  try {
    h = JSON.parse(raw) as Halt;
  } catch {
    /* 깨진 값은 지운다 */
  }
  const waiting = h ? await prisma.factoryMaintenanceMessage.count({ where: { role: "user", status: { in: ["awaiting_approval", "queued"] } } }) : 0;

  if (!h || !waiting) {
    await setSettingValue(HALT_KEY, null);

    return null;
  }

  return h;
}

/** 대기열(보낸 순서): 진행 중·대기·승인 대기 지시와 각자 왜 기다리는지. */
export async function maintenanceQueue() {
  const [turns, halt, recent] = await Promise.all([
    prisma.factoryMaintenanceMessage.findMany({
      where: { role: "user", status: { in: QUEUE_STATES } },
      orderBy: { createdAt: "asc" },
      include: { maintenance: { select: { id: true, title: true } } },
    }),
    getHalt(),
    prisma.factoryMaintenanceMessage.findMany({
      where: { role: "user", status: { in: ["done", "failed", "cancelled"] }, finishedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      orderBy: { finishedAt: "desc" },
      take: 5,
      include: { maintenance: { select: { id: true, title: true } } },
    }),
  ]);
  const haltTurn = halt ? await prisma.factoryMaintenanceMessage.findUnique({ where: { id: halt.turnId }, include: { maintenance: { select: { title: true } } } }) : null;
  let approvalAhead = false;
  let runningAhead = false;
  const items = turns.map((t, i) => {
    let wait: string | null = null;

    if (t.status === "running") wait = "진행 중";
    else if (halt) wait = "앞 지시가 실패해 대기열이 멈췄어요";
    else if (t.status === "awaiting_approval") wait = approvalAhead ? "승인 대기(앞의 승인 대기도 있어요)" : "관리자 승인을 기다려요";
    else if (approvalAhead) wait = "앞의 승인 대기 때문에 기다려요";
    else if (runningAhead || i > 0) wait = "앞 지시가 끝나면 시작해요";
    else wait = "곧 시작해요(진행 중인 앱 일감이 있으면 끝난 뒤)";
    if (t.status === "awaiting_approval") approvalAhead = true;
    if (t.status === "running") runningAhead = true;

    return {
      position: i + 1,
      turnId: t.id,
      threadId: t.maintenanceId,
      threadTitle: t.maintenance.title,
      status: t.status,
      aiEngine: t.aiEngine,
      aiModel: t.aiModel,
      source: t.source,
      firstLine: firstLine(t.text),
      wait,
      createdAt: t.createdAt,
    };
  });

  return {
    items,
    left: items.length,
    halted: halt
      ? { turnId: halt.turnId, threadId: halt.threadId, at: halt.at, threadTitle: haltTurn?.maintenance.title ?? "", firstLine: haltTurn ? firstLine(haltTurn.text) : "" }
      : null,
    recent: recent.map((t) => ({
      turnId: t.id,
      threadId: t.maintenanceId,
      threadTitle: t.maintenance.title,
      status: t.status,
      firstLine: firstLine(t.text),
      pushedCommit: t.pushedCommit,
      finishedAt: t.finishedAt,
    })),
  };
}

/** 이 지시 앞에 남은(진행 중·대기·승인 대기) 지시 수 */
const aheadOf = (turn: { id: string; createdAt: Date }) =>
  prisma.factoryMaintenanceMessage.count({ where: { role: "user", status: { in: QUEUE_STATES }, id: { not: turn.id }, createdAt: { lte: turn.createdAt } } });

/** [계속 진행](실패한 지시 건너뛰기) / [재시도] / [대기열 비우기]. turnId 를 주면 멈춘 지시와 같을 때만(오래된 텔레그램 버튼 방지). */
export async function queueAction(action: "skip" | "retry" | "clear", via: string, turnId?: string): Promise<Result> {
  const halt = await getHalt();

  if ((action !== "clear" || turnId) && !halt) return fail(409, "멈춘 대기열이 없어요.");
  if (turnId && halt && halt.turnId !== turnId) return fail(409, "지금 멈춘 지시가 아니에요. 통제실에서 확인하세요.");

  if (action === "skip" && halt) {
    await setSettingValue(HALT_KEY, null);
    await prisma.factoryMaintenanceMessage.create({ data: { maintenanceId: halt.threadId, role: "system", text: `실패한 지시를 건너뛰고 대기열을 계속 진행해요(${via}).` } });
    await afterQueueChange();

    return { ok: true, status: 200, message: "실패한 지시를 건너뛰고 다음 지시로 계속 진행해요." };
  }
  if (action === "retry" && halt) {
    const r = await prisma.factoryMaintenanceMessage.updateMany({
      where: { id: halt.turnId, role: "user", status: "failed" },
      data: { status: "queued", startedAt: null, finishedAt: null, heartbeatAt: null },
    });

    await setSettingValue(HALT_KEY, null);
    if (!r.count) return fail(409, "실패한 지시를 찾지 못해 멈춤만 풀었어요.");
    await prisma.factoryMaintenance.update({ where: { id: halt.threadId }, data: { status: "open", updatedAt: new Date() } });
    await prisma.factoryMaintenanceMessage.create({ data: { maintenanceId: halt.threadId, role: "system", text: `실패한 지시를 다시 시도해요(${via}). 대기열 맨 앞에서 같은 Claude 세션으로 이어서 해요.` } });

    return { ok: true, status: 200, message: "실패한 지시를 다시 시도해요(대기열 맨 앞)." };
  }
  const now = new Date();
  const waiting = await prisma.factoryMaintenanceMessage.findMany({ where: { role: "user", status: { in: ["awaiting_approval", "queued"] } }, select: { id: true, maintenanceId: true } });

  await prisma.factoryMaintenanceMessage.updateMany({ where: { id: { in: waiting.map((w) => w.id) }, status: { in: ["awaiting_approval", "queued"] } }, data: { status: "cancelled", finishedAt: now } });
  for (const tid of new Set(waiting.map((w) => w.maintenanceId))) {
    await prisma.factoryMaintenanceMessage.create({ data: { maintenanceId: tid, role: "system", text: `대기열을 비웠어요(${via}). 시작 전이던 지시는 취소됐어요.` } });
  }
  await setSettingValue(HALT_KEY, null);
  await afterQueueChange();

  return { ok: true, status: 200, message: waiting.length ? `대기열을 비웠어요(시작 전 지시 ${waiting.length}개 취소). 진행 중인 지시는 끝까지 해요.` : "비울 지시가 없어요(진행 중인 지시는 끝까지 해요)." };
}

// ───────── 지시 보내기 ─────────

/** 새 정비(threadId 없음) 또는 기존 정비에 이어서 지시. source=통제실 이면 바로 대기열, 채팅이면 승인 대기. 처리 중이어도 대기열에 쌓는다. */
export async function sendMaintenance(input: { threadId?: unknown; text?: unknown; aiEngine?: unknown; aiModel?: unknown; source: "통제실" | "채팅" }): Promise<Result> {
  if (input.aiEngine !== undefined && !isAiEngine(input.aiEngine)) return fail(400, "작업 AI가 올바르지 않아요.");
  const aiEngine = isAiEngine(input.aiEngine) ? input.aiEngine : await getDefaultAiEngine();
  // 통제실에서 보낸 지시는 보내는 순간이 승인이라 여기서 모델을 고른다(허용 목록만, Codex 는 거부)
  const model = readModelChoice(input.aiModel);

  if (!model.ok) return fail(400, model.message);
  if (model.model && aiEngine === "codex") return fail(400, "Codex 지시에는 모델을 고를 수 없어요(Claude Code 지시만).");
  const text = clean(input.text, MAX_TEXT);

  if (text.length < 5) return fail(400, "지시를 5자 이상 적어 주세요.");
  const threadId = typeof input.threadId === "string" && input.threadId ? input.threadId : null;
  const status = input.source === "통제실" ? "queued" : "awaiting_approval";

  if (threadId) {
    const t = await prisma.factoryMaintenance.findUnique({ where: { id: threadId } });

    if (!t) return fail(404, "없는 정비예요.");
    if (t.status === "closed") return fail(409, "닫힌 정비예요. 새 정비로 보내세요.");
  }

  const thread = threadId
    ? await prisma.factoryMaintenance.update({ where: { id: threadId }, data: { updatedAt: new Date() } })
    : await prisma.factoryMaintenance.create({ data: { title: text.split("\n")[0].slice(0, 60) } });
  const msg = await prisma.factoryMaintenanceMessage.create({
    data: { maintenanceId: thread.id, role: "user", text, status, source: input.source, aiEngine, aiModel: model.model },
  });
  const ahead = await aheadOf(msg);
  const halt = await getHalt();
  const place = `대기 ${ahead + 1}번째(앞에 ${ahead}개)`;
  const haltNote = halt ? " 지금은 앞 지시가 실패해 대기열이 멈춰 있어요(통제실에서 계속 진행·재시도·비우기)." : "";

  if (status === "awaiting_approval") await notifyMaintenance("approval", thread.id, msg.id, { position: ahead + 1 });

  return {
    ok: true,
    status: 200,
    id: thread.id,
    message:
      status === "queued"
        ? `정비 지시를 대기열에 넣었어요 — ${place}, 정비 ${thread.id}. 앞 지시와 진행 중인 앱 일감이 끝나면 차례대로 시작해요. 그동안 새 앱 일감은 멈춰요.${haltNote}`
        : `정비 지시를 보냈어요 — ${place}, 정비 ${thread.id}, 지시 ${msg.id}. 관리자가 통제실이나 텔레그램에서 승인하면 차례가 될 때 시작해요(미리 승인해 둘 수 있어요).${haltNote}`,
  };
}

const TURN_STATE: Record<string, string> = {
  queued: "이미 승인돼 대기열에 있어요",
  running: "이미 진행 중이에요",
  done: "이미 끝난 지시예요",
  failed: "이미 끝난(실패) 지시예요",
  cancelled: "취소된 지시예요",
};

// 조건부 updateMany 라서 통제실·텔레그램에서 동시에 눌러도 한쪽만 승인된다. 다른 쪽에는 지금 상태를 알려 준다.
// aiModel: 승인 때 고른 Claude Code 모델(null = 기본 설정 사용). Codex 지시에 모델을 주면 거부한다
export async function approveTurn(turnId: string, aiModel: ClaudeModel | null = null): Promise<Result> {
  if (aiModel) {
    const t = await prisma.factoryMaintenanceMessage.findUnique({ where: { id: turnId }, select: { aiEngine: true } });

    if (t?.aiEngine === "codex") return fail(400, "Codex 지시에는 모델을 고를 수 없어요(Claude Code 지시만).");
  }
  const r = await prisma.factoryMaintenanceMessage.updateMany({ where: { id: turnId, role: "user", status: "awaiting_approval" }, data: { status: "queued", aiModel } });

  if (r.count) {
    const turn = await prisma.factoryMaintenanceMessage.findUnique({ where: { id: turnId }, select: { id: true, createdAt: true } });
    const ahead = turn ? await aheadOf(turn) : 0;

    return {
      ok: true,
      status: 200,
      message: (aiModel ? `(모델: ${aiModel}) ` : "") + (ahead ? `정비 지시를 승인했어요. 대기 ${ahead + 1}번째(앞에 ${ahead}개)라 앞 지시가 끝나면 자동으로 시작해요.` : "정비 지시를 승인했어요. 진행 중인 앱 일감이 끝나면 시작해요."),
    };
  }
  const turn = await prisma.factoryMaintenanceMessage.findUnique({ where: { id: turnId }, select: { role: true, status: true } });

  if (!turn || turn.role !== "user") return fail(404, "없는 지시예요.");

  return fail(409, `승인할 수 없어요: ${TURN_STATE[turn.status ?? ""] ?? `지금 상태(${turn.status})`}.`);
}

export async function cancelTurn(turnId: string): Promise<Result> {
  const r = await prisma.factoryMaintenanceMessage.updateMany({
    where: { id: turnId, role: "user", status: { in: ["awaiting_approval", "queued"] } },
    data: { status: "cancelled", finishedAt: new Date() },
  });

  if (r.count) await afterQueueChange();

  return r.count ? { ok: true, status: 200, message: "지시를 취소했어요." } : fail(409, "시작 전인 지시만 취소할 수 있어요.");
}

export async function closeThread(threadId: string): Promise<Result> {
  const active = await prisma.factoryMaintenanceMessage.findFirst({ where: { maintenanceId: threadId, role: "user", status: { in: QUEUE_STATES } } });

  // 승인 대기 지시가 남은 채 닫으면 대기열 맨 앞을 막을 수 있어서 같이 막는다
  if (active) return fail(409, "처리 중이거나 대기열에 있는 지시가 있어서 닫을 수 없어요(먼저 취소하세요).");
  const r = await prisma.factoryMaintenance.updateMany({ where: { id: threadId }, data: { status: "closed" } });

  return r.count ? { ok: true, status: 200, message: "정비를 닫았어요." } : fail(404, "없는 정비예요.");
}

// ───────── 배포 묶기 ─────────

export interface DeployItem {
  turnId: string | null; // null = 이 변경 전의 기록(정비 대화 단위로만 남아 있음)
  threadId: string;
  title: string;
  commit: string;
}

const inProgressWhere = { deployRequestedAt: { not: null }, deployedAt: null, deployResult: null };

/** 다음 배포에 들어갈 것: 배포 안 된 지시 목록, 배포할 커밋(가장 최근 정비 커밋), 남은 대기열, 진행 중인 배포. */
export async function deployBundle() {
  const [turns, threads, latest, left, running, lastDeploy] = await Promise.all([
    prisma.factoryMaintenanceMessage.findMany({
      where: { role: "user", needsDeploy: true, pushedCommit: { not: null }, deployedAt: null },
      orderBy: { finishedAt: "asc" },
    }),
    prisma.factoryMaintenance.findMany({ where: { needsDeploy: true, pushedCommit: { not: null } }, orderBy: { updatedAt: "asc" } }),
    prisma.factoryMaintenanceMessage.findFirst({ where: { role: "user", pushedCommit: { not: null }, finishedAt: { not: null } }, orderBy: { finishedAt: "desc" } }),
    prisma.factoryMaintenanceMessage.count({ where: { role: "user", status: { in: QUEUE_STATES } } }),
    prisma.factoryMaintenance.findFirst({ where: inProgressWhere, orderBy: { deployRequestedAt: "desc" } }),
    prisma.factoryDeploy.findFirst({ orderBy: { requestedAt: "desc" } }),
  ]);
  // 예전 기록: 정비 대화에 '배포 필요'만 있고 지시 단위 커밋이 없는 것(이 변경 전에 끝난 정비). 그대로 목록에 넣는다.
  const legacy = threads.filter((t) => !turns.some((x) => x.maintenanceId === t.id));
  const items: DeployItem[] = [
    ...legacy.map((t) => ({ turnId: null, threadId: t.id, title: t.title, commit: t.pushedCommit! })),
    ...turns.map((x) => ({ turnId: x.id, threadId: x.maintenanceId, title: firstLine(x.text), commit: x.pushedCommit! })),
  ];
  // main 은 한 줄로 쌓이므로 가장 최근에 올린 정비 커밋에 앞의 것이 모두 들어 있다. 지시 단위 기록이 없으면 예전처럼 정비 대화의 커밋.
  const legacyLast = legacy.length ? legacy[legacy.length - 1] : null;
  const target = latest?.pushedCommit
    ? { threadId: latest.maintenanceId, commit: latest.pushedCommit }
    : legacyLast
      ? { threadId: legacyLast.id, commit: legacyLast.pushedCommit! }
      : null;
  const inProgress = running
    ? { threadId: running.id, title: running.title, commit: running.deployCommit, started: !!running.deployStartedAt, requestedAt: running.deployRequestedAt }
    : null;
  const titles = new Map(threads.map((t) => [t.id, t.title]));

  return {
    items,
    commit: items.length ? (target?.commit ?? null) : null,
    threadId: items.length ? (target?.threadId ?? null) : null,
    threadTitle: target ? (titles.get(target.threadId) ?? null) : null,
    queueLeft: left,
    inProgress,
    canDeploy: items.length > 0 && left === 0 && !inProgress && !!target,
    lastResult: lastDeploy && lastDeploy.ok !== null ? { ok: lastDeploy.ok, result: lastDeploy.result, commit: lastDeploy.commit, finishedAt: lastDeploy.finishedAt } : null,
  };
}

export type DeployBundle = Awaited<ReturnType<typeof deployBundle>>;

export const itemsText = (items: DeployItem[], max = 15) =>
  items
    .slice(0, max)
    .map((i) => `• ${i.title} (${short(i.commit)})`)
    .join("\n") + (items.length > max ? `\n… 외 ${items.length - max}개` : "");

/** 대기열이 바뀐 뒤(지시 끝남·취소·비우기): 남은 지시가 없고 배포할 것이 있으면 '배포 필요'를 한 번만 알리거나, 설정이 켜져 있으면 자동 배포. */
async function afterQueueChange(): Promise<void> {
  try {
    const b = await deployBundle();

    if (!b.items.length || b.queueLeft || b.inProgress || !b.commit || !b.threadId) return;
    if ((await getSettingValue(NOTIFIED_KEY)) === b.commit) return;
    await setSettingValue(NOTIFIED_KEY, b.commit);
    const list = itemsText(b.items);

    if (await isAutoDeployEnabled()) {
      // 지난 (성공한) 배포 뒤 실패한 지시가 있었으면 자동 배포하지 않는다
      const lastOk = await prisma.factoryDeploy.findFirst({ where: { ok: true }, orderBy: { requestedAt: "desc" } });
      const firstTurn = b.items.find((i) => i.turnId);
      const firstTurnRow = firstTurn?.turnId ? await prisma.factoryMaintenanceMessage.findUnique({ where: { id: firstTurn.turnId }, select: { createdAt: true } }) : null;
      const since = lastOk?.requestedAt ?? firstTurnRow?.createdAt ?? new Date();
      const failed = await prisma.factoryMaintenanceMessage.count({ where: { role: "user", status: "failed", finishedAt: { gt: since } } });

      if (!failed) {
        const r = await requestDeploy(b.threadId, "자동");

        await notifyText(
          r.ok
            ? `🚀 정비 대기열이 모두 끝나 자동 배포를 시작해요(${short(b.commit)}).\n포함된 지시:\n${list}`
            : `⚠️ 자동 배포를 시작하지 못했어요: ${r.message}\n포함될 지시:\n${list}`,
          "/admin/factory",
        );

        return;
      }
      await notifyDeployReady(b.threadId, `⏳ 정비 대기열이 모두 끝났어요. 배포가 필요해요(${short(b.commit)}).\n실패한 지시가 있어서 자동 배포는 하지 않았어요.\n포함될 지시:\n${list}`);

      return;
    }
    await notifyDeployReady(b.threadId, `⏳ 정비 대기열이 모두 끝났어요. 배포가 필요해요(${short(b.commit)}).\n포함될 지시:\n${list}`);
  } catch (e) {
    console.error("[factory] 정비 배포 안내 실패:", e);
  }
}

/** 사람이 [배포]를 누름(통제실·텔레그램) 또는 자동 배포. GitHub 에 올라간 커밋만 배포할 수 있다.
 *  배포 안 된 정비 지시를 모두 묶어 가장 최근 정비 커밋 하나로 배포한다(threadId 는 예전 버튼 호환용, 묶음과 상관없이 받는다).
 *  대기열에 남은 지시가 있으면 force(지금 배포)일 때만. 조건부 updateMany 라서 두 곳에서 동시에 눌러도 배포 요청은 한 번만 들어간다. */
export async function requestDeploy(threadId: string, via: "통제실" | "텔레그램" | "자동" = "통제실", opts: { force?: boolean } = {}): Promise<Result> {
  const t = await prisma.factoryMaintenance.findUnique({ where: { id: threadId } });

  if (!t) return fail(404, "없는 정비예요.");
  const b = await deployBundle();

  if (b.inProgress) return fail(409, `이미 배포를 요청했어요(진행 중, ${short(b.inProgress.commit)}). 끝나면 결과가 여기와 텔레그램에 나와요.`);
  if (!b.items.length || !b.commit || !b.threadId) {
    return fail(409, t.deployedAt && t.deployCommit ? `이미 배포했어요(${short(t.deployCommit)}).` : "배포할 변경이 없어요.");
  }
  if (b.queueLeft && !opts.force) return fail(409, `대기열 ${b.queueLeft}개 처리 후 배포할 수 있어요. 급하면 통제실의 [지금 배포]를 쓰세요.`);
  const commit = b.commit;
  const now = new Date();
  const r = await prisma.factoryMaintenance.updateMany({
    where: {
      id: b.threadId,
      pushedCommit: commit,
      // 배포 요청이 없었거나, 지난 배포가 끝났을 때만(진행 중인 배포가 있으면 막는다)
      OR: [{ deployRequestedAt: null }, { deployedAt: { not: null } }, { deployResult: { not: null } }],
    },
    data: { deployCommit: commit, deployRequestedAt: now, deployStartedAt: null, deployedAt: null, deployResult: null },
  });

  if (!r.count) return fail(409, "이미 배포를 요청했어요(진행 중). 끝나면 결과가 여기와 텔레그램에 나와요.");
  await prisma.factoryDeploy
    .create({ data: { maintenanceId: b.threadId, commit, via, requestedAt: now, items: JSON.stringify(b.items) } })
    .catch((e) => console.error("[factory] 배포 이력 기록 실패:", e));
  if (b.queueLeft) {
    await prisma.factoryMaintenanceMessage.create({
      data: { maintenanceId: b.threadId, role: "system", text: `지금 배포(${via}): 대기열 ${b.queueLeft}개가 남았지만 지금까지 반영분(${short(commit)})만 먼저 배포해요.` },
    });
  }

  return {
    ok: true,
    status: 200,
    message: `배포를 요청했어요(${short(commit)}, 지시 ${b.items.length}개). 감독 프로그램이 15초 안에 받아서 서버에 올려요(빌드 3~4분).${b.queueLeft ? ` 남은 대기열 ${b.queueLeft}개는 끝난 뒤 다시 배포가 필요해요.` : ""}`,
  };
}

/** 이 정비의 가장 최근 배포 이력(아직 결과 없는 것) */
const openDeploy = (threadId: string, commit: string | null) =>
  prisma.factoryDeploy.findFirst({ where: { maintenanceId: threadId, ok: null, ...(commit ? { commit } : {}) }, orderBy: { requestedAt: "desc" } });

const parseItems = (raw: string | null | undefined): DeployItem[] | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;

    return Array.isArray(v) ? (v as DeployItem[]) : null;
  } catch {
    return null;
  }
};

// ───────── 감독 프로그램 쪽 ─────────

/** 정비 지시가 대기·진행 중인가(새 앱 일감을 멈출지). 승인 대기(awaiting_approval)만 있으면 멈추지 않는다. */
export async function maintenanceHold(): Promise<boolean> {
  const n = await prisma.factoryMaintenanceMessage.count({ where: { role: "user", status: { in: [...TURN_ACTIVE] } } });

  return n > 0;
}

/** 지시가 실패로 끝났을 때: 뒤에 기다리는 지시가 있으면 대기열을 멈춘다(뒤 지시가 앞 결과에 기댈 수 있어서). */
async function haltIfWaiting(turnId: string, threadId: string): Promise<boolean> {
  const waiting = await prisma.factoryMaintenanceMessage.count({ where: { role: "user", status: { in: ["awaiting_approval", "queued"] } } });

  if (!waiting) return false;
  await setSettingValue(HALT_KEY, JSON.stringify({ turnId, threadId, at: new Date().toISOString() }));
  await prisma.factoryMaintenanceMessage.create({
    data: { maintenanceId: threadId, role: "system", text: `이 지시가 실패해서 정비 대기열(남은 ${waiting}개)을 멈췄어요. 통제실에서 [계속 진행](건너뛰기)·[재시도]·[대기열 비우기] 중에 골라 주세요.` },
  });

  return true;
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
    const halted = await haltIfWaiting(s.id, s.maintenanceId);

    await notifyMaintenance("failed", s.maintenanceId, s.id, { halted });
  }
  if (stale.length) await afterQueueChange();
  const staleMsg = "배포 결과 보고가 20분 넘게 없어요. 서버 배포 로그를 확인하세요.";
  const staleDeploys = await prisma.factoryMaintenance.findMany({
    where: { deployStartedAt: { lt: cut }, deployedAt: null, deployResult: null },
    select: { id: true },
  });

  if (staleDeploys.length) {
    const ids = staleDeploys.map((d) => d.id);

    await prisma.factoryMaintenance.updateMany({ where: { id: { in: ids }, deployedAt: null, deployResult: null }, data: { deployResult: staleMsg } });
    await prisma.factoryDeploy.updateMany({
      where: { maintenanceId: { in: ids }, ok: null, startedAt: { lt: cut } },
      data: { ok: false, finishedAt: new Date(), result: staleMsg },
    });
  }
}

/** /next 응답에 붙일 것: 다음 정비 지시(진행 중인 게 없고 대기열이 멈추지 않았고 맨 앞이 승인됐을 때), 배포 요청. */
export async function maintenanceForNext(engines: readonly AiEngine[] = ["claude"]): Promise<{ maintenance?: object; maintenanceDeploy?: object }> {
  await releaseStale();
  const out: { maintenance?: object; maintenanceDeploy?: object } = {};
  const running = await prisma.factoryMaintenanceMessage.findFirst({ where: { role: "user", status: "running" } });

  if (!running && !(await getHalt())) {
    // 보낸 순서대로 맨 앞 하나만. 맨 앞이 승인 대기면 뒤의 승인된 지시도 기다린다(순서 보존).
    const head = await prisma.factoryMaintenanceMessage.findFirst({
      where: { role: "user", status: { in: ["awaiting_approval", "queued"] } },
      orderBy: { createdAt: "asc" },
      include: { maintenance: true },
    });

    if (head?.status === "queued" && engines.includes(head.aiEngine as AiEngine)) {
      // '기본 설정 사용'으로 승인된 Claude 지시는 시작할 때 기본 모델로 채운다(이력에 실제 모델이 남게). 기본 모델이 없으면 --model 없이
      if (head.aiEngine === "claude" && !head.aiModel) {
        const def = await getDefaultClaudeModel().catch(() => null);

        if (def) {
          await prisma.factoryMaintenanceMessage.updateMany({ where: { id: head.id, status: "queued", aiModel: null }, data: { aiModel: def } });
          head.aiModel = def;
        }
      }
      const left = await prisma.factoryMaintenanceMessage.count({ where: { role: "user", status: { in: ["awaiting_approval", "queued"] }, id: { not: head.id } } });

      out.maintenance = {
        turnId: head.id,
        threadId: head.maintenanceId,
        title: head.maintenance.title,
        text: head.text,
        aiEngine: head.aiEngine,
        aiModel: head.aiEngine === "claude" ? head.aiModel : null, // 감독 프로그램이 --model 로 넘긴다(허용 목록 다시 확인)
        sessionId: head.aiEngine === "codex" ? head.maintenance.codexSessionId : head.maintenance.sessionId,
        previousResult: (await prisma.factoryMaintenanceMessage.findFirst({
          where: { maintenanceId: head.maintenanceId, role: "assistant" }, orderBy: { createdAt: "desc" }, select: { text: true },
        }))?.text.slice(0, 6000) ?? null,
        // 새 필드(예전 감독 프로그램은 무시): 배포를 대기열 끝에 묶어서 안내하는지, 이 지시 뒤에 남은 지시 수
        deployBundling: true,
        queueLeft: left,
      };
    }
  }
  const dep = await prisma.factoryMaintenance.findFirst({ where: { deployRequestedAt: { not: null }, deployStartedAt: null, deployResult: null } });

  if (dep?.deployCommit) out.maintenanceDeploy = { threadId: dep.id, commit: dep.deployCommit };

  return out;
}

export async function setTurnEngine(turnId: string, aiEngine: unknown): Promise<Result> {
  if (!isAiEngine(aiEngine)) return fail(400, "작업 AI가 올바르지 않아요.");
  const r = await prisma.factoryMaintenanceMessage.updateMany({
    where: { id: turnId, role: "user", status: { in: ["awaiting_approval", "queued", "failed"] } }, data: { aiEngine, ...(aiEngine === "codex" ? { aiModel: null } : {}) },
  });
  return r.count ? { ok: true, status: 200, message: "작업 AI를 바꿨어요. 다음 실행에 적용돼요." } : fail(409, "진행 중이거나 끝난 지시의 AI는 바꿀 수 없어요.");
}

export async function startTurn(turnId: string, selectedEngine: unknown = "claude"): Promise<Result> {
  if (!isAiEngine(selectedEngine)) return fail(400, "작업 AI가 올바르지 않아요.");
  const now = new Date();
  const r = await prisma.factoryMaintenanceMessage.updateMany({ where: { id: turnId, role: "user", status: "queued", aiEngine: selectedEngine }, data: { status: "running", startedAt: now, heartbeatAt: now } });

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
  const needsDeploy = !!pushed && d.needsDeploy === true;
  const thread = await prisma.factoryMaintenance.findUnique({ where: { id: turn.maintenanceId } });
  // 진행 중인 배포([지금 배포])가 있으면 그 배포 상태는 건드리지 않는다(끝난 뒤 결과가 사라지지 않게)
  const deploying = !!thread?.deployRequestedAt && !thread.deployedAt && !thread.deployResult;

  await prisma.factoryMaintenanceMessage.update({
    where: { id: turnId },
    data: { status: ok ? "done" : "failed", finishedAt: new Date(), heartbeatAt: new Date(), ...(pushed ? { pushedCommit: pushed, needsDeploy } : {}) },
  });
  await prisma.factoryMaintenanceMessage.create({
    data: { maintenanceId: turn.maintenanceId, role: "assistant", aiEngine: turn.aiEngine, aiModel: turn.aiModel, text: maskSecrets(clean(d.text, 20_000)) || (ok ? "완료(요약 없음)" : "실패(사유 없음)") },
  });
  await prisma.factoryMaintenance.update({
    where: { id: turn.maintenanceId },
    data: {
      ...(sessionId ? (turn.aiEngine === "codex" ? { codexSessionId: sessionId } : { sessionId }) : {}),
      ...(pushed ? { pushedCommit: pushed } : {}),
      ...(pushed && !deploying ? { deployRequestedAt: null, deployStartedAt: null, deployedAt: null, deployResult: null } : {}),
      ...(needsDeploy ? { needsDeploy: true } : {}),
    },
  });
  const halted = ok ? false : await haltIfWaiting(turnId, turn.maintenanceId);
  const queueLeft = await prisma.factoryMaintenanceMessage.count({ where: { role: "user", status: { in: QUEUE_STATES } } });

  await notifyMaintenance(ok ? "done" : "failed", turn.maintenanceId, turnId, { halted, queueLeft, needsDeploy });
  await afterQueueChange();

  return { ok: true, status: 200, message: "결과 저장" };
}

export async function deployStarted(threadId: string, commit: string): Promise<Result> {
  const now = new Date();
  const r = await prisma.factoryMaintenance.updateMany({
    where: { id: threadId, deployCommit: commit, deployRequestedAt: { not: null }, deployStartedAt: null, deployResult: null },
    data: { deployStartedAt: now },
  });

  if (r.count) {
    const d = await openDeploy(threadId, commit);

    if (d) await prisma.factoryDeploy.update({ where: { id: d.id }, data: { startedAt: now } });
  }

  return r.count ? { ok: true, status: 200, message: "배포 시작" } : fail(409, "배포 요청이 없거나 이미 시작됐어요.");
}

export async function deployFinished(threadId: string, ok: boolean, output: string): Promise<Result> {
  const t = await prisma.factoryMaintenance.findUnique({ where: { id: threadId } });

  if (!t?.deployStartedAt) return fail(409, "시작한 배포가 없어요.");
  const d = await openDeploy(threadId, t.deployCommit);
  const items = parseItems(d?.items);
  const now = new Date();

  // 묶음 배포(items 있음)면 성공했을 때 포함된 지시를 '배포됨'으로 표시하고 정비 대화마다 남은 배포 필요를 다시 센다.
  // 예전 배포 요청(items 없음)은 예전처럼 이 정비만 배포 필요를 끈다.
  await prisma.factoryMaintenance.update({
    where: { id: threadId },
    data: { deployedAt: ok ? now : null, deployResult: clean(output, 4000) || (ok ? "배포 완료" : "배포 실패"), ...(ok && !items ? { needsDeploy: false } : {}) },
  });
  if (ok && items) {
    const turnIds = items.map((i) => i.turnId).filter((x): x is string => !!x);

    if (turnIds.length) await prisma.factoryMaintenanceMessage.updateMany({ where: { id: { in: turnIds }, deployedAt: null }, data: { deployedAt: now } });
    for (const tid of new Set([threadId, ...items.map((i) => i.threadId)])) {
      const remaining = await prisma.factoryMaintenanceMessage.count({ where: { maintenanceId: tid, role: "user", needsDeploy: true, pushedCommit: { not: null }, deployedAt: null } });

      await prisma.factoryMaintenance.update({
        where: { id: tid },
        data: {
          needsDeploy: remaining > 0,
          // 함께 배포된 다른 정비에도 배포 완료를 남긴다
          ...(tid !== threadId ? { deployCommit: t.deployCommit, deployedAt: now, deployResult: `함께 배포됨(${short(t.deployCommit)}, 정비 「${t.title}」)` } : {}),
        },
      });
    }
  }
  if (d) {
    await prisma.factoryDeploy.update({
      where: { id: d.id },
      data: { ok, finishedAt: now, result: clean(output, 4000) || (ok ? "배포 완료" : "배포 실패") },
    });
  }
  const list = items?.length ? `\n포함된 지시:\n${itemsText(items)}` : "";

  await prisma.factoryMaintenanceMessage.create({
    data: { maintenanceId: threadId, role: "system", text: ok ? `서버 배포 완료(${short(t.deployCommit)}${d?.via ? `, ${d.via}` : ""}).${list}` : `서버 배포 실패: ${clean(output, 1500)}${list}` },
  });
  await notifyMaintenance(ok ? "deployed" : "deploy_failed", threadId, undefined, { items: items ?? undefined, via: d?.via ?? undefined });
  // 배포가 실패했으면 다시 '배포 필요'를 알릴 수 있게 한다
  if (!ok) await setSettingValue(NOTIFIED_KEY, null);

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
  const [hold, queue, deploy, autoDeploy] = await Promise.all([maintenanceHold(), maintenanceQueue(), deployBundle(), isAutoDeployEnabled()]);

  return {
    hold, // true 면 새 앱 일감이 멈춰 있다
    queue, // 대기열(모든 정비 대화, 보낸 순서)
    deploy, // 다음 배포 묶음
    autoDeploy, // 대기열이 끝나면 자동 배포(설정)
    threads: threads.map((t) => {
      const turns = t.messages.filter((m) => m.role === "user");
      const actives = turns.filter((m) => QUEUE_STATES.includes(m.status ?? ""));
      const active = actives.find((m) => m.status === "running") ?? actives[0];
      const logs = t.messages.filter((m) => m.role === "log");

      return {
        id: t.id,
        title: t.title,
        status: t.status,
        activeTurn: active ? { id: active.id, status: active.status, source: active.source } : null,
        activeTurns: actives.length,
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
          .map((m) => ({ id: m.id, role: m.role, text: m.text, status: m.status, aiEngine: m.aiEngine, aiModel: m.aiModel, source: m.source, createdAt: m.createdAt, pushedCommit: m.pushedCommit, deployedAt: m.deployedAt })),
      };
    }),
  };
}

/** serverctl(정비 전용 서버 설정 도구)가 서버 설정을 바꿀 때마다: 진행 중인 지시가 있으면 그 정비 대화에, 그리고 텔레그램으로. 값은 오지 않는다. */
export async function noteServerChange(turnId: string | null, text: string): Promise<Result> {
  const t = clean(text, 1500);

  if (!t) return fail(400, "내용이 없어요.");
  if (turnId) {
    const turn = await prisma.factoryMaintenanceMessage.findUnique({ where: { id: turnId } });

    if (turn?.role === "user" && turn.status === "running") {
      await prisma.factoryMaintenanceMessage.create({ data: { maintenanceId: turn.maintenanceId, role: "system", text: `🔧 서버 설정 변경\n${t}` } });
    }
  }
  await notifyText(`🔧 서버 설정 변경(공장 정비)\n${t}`, "/admin/factory");

  return { ok: true, status: 200, message: "기록" };
}
