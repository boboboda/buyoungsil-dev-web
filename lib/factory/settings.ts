// lib/factory/settings.ts
// 통제실 설정값: 감독 프로그램 활성화(일시 정지), 자동 업데이트, 감독 프로그램 버전 정보, "지금 업데이트" 1회성 요청.
import prisma from "@/lib/prisma";
import { isAiEngine, isClaudeModel, type AiEngine, type ClaudeModel } from "@/lib/factory/ai";
import { isToolBrokerMode, normalizeToolBroker, readStoredToolBroker, TOOL_BROKER_LIMITS_VERSION, type ToolBrokerSettings } from "@/lib/factory/toolBroker";

const DEFAULT_AI_KEY = "defaultAiEngine";

/** Existing rows keep their AI. This setting is resolved only when a new instruction omits an AI. */
export async function getDefaultAiEngine(): Promise<AiEngine> {
  const row = await prisma.factorySetting.findUnique({ where: { key: DEFAULT_AI_KEY } });
  return isAiEngine(row?.value) ? row.value : "claude";
}

export async function setDefaultAiEngine(engine: AiEngine): Promise<void> {
  if (!isAiEngine(engine)) throw new Error("작업 AI가 올바르지 않아요.");
  await prisma.factorySetting.upsert({ where: { key: DEFAULT_AI_KEY }, create: { key: DEFAULT_AI_KEY, value: engine }, update: { value: engine } });
}

const DEFAULT_MODEL_KEY = "defaultClaudeModel";

/** 승인 때 '기본 설정 사용'이면 쓰는 Claude Code 모델. 없거나 목록 밖이면 null(= --model 없이 Claude Code 자체 기본) */
export async function getDefaultClaudeModel(): Promise<ClaudeModel | null> {
  const row = await prisma.factorySetting.findUnique({ where: { key: DEFAULT_MODEL_KEY } });

  return isClaudeModel(row?.value) ? row.value : null;
}

export async function setDefaultClaudeModel(model: ClaudeModel | null): Promise<void> {
  if (model === null) {
    await prisma.factorySetting.deleteMany({ where: { key: DEFAULT_MODEL_KEY } });

    return;
  }
  if (!isClaudeModel(model)) throw new Error("모델이 올바르지 않아요.");
  await prisma.factorySetting.upsert({ where: { key: DEFAULT_MODEL_KEY }, create: { key: DEFAULT_MODEL_KEY, value: model }, update: { value: model } });
}

const TOOL_BROKER_KEY = "toolBroker";

/** 도구 요청 중계 설정. 값이 없거나 이상하면 기본값(꺼짐) */
export async function getToolBrokerSettings(): Promise<ToolBrokerSettings> {
  const row = await prisma.factorySetting.findUnique({ where: { key: TOOL_BROKER_KEY } });
  let raw: unknown = null;

  try {
    raw = row?.value ? JSON.parse(row.value) : null;
  } catch {
    raw = null;
  }

  return readStoredToolBroker(raw);
}

export async function setToolBrokerSettings(input: Partial<ToolBrokerSettings>): Promise<ToolBrokerSettings> {
  if (input.mode !== undefined && !isToolBrokerMode(input.mode)) throw new Error("도구 요청 중계 모드가 올바르지 않아요.");
  const next = normalizeToolBroker({ ...(await getToolBrokerSettings()), ...input });
  const value = JSON.stringify({ ...next, limitsVersion: TOOL_BROKER_LIMITS_VERSION });

  await prisma.factorySetting.upsert({ where: { key: TOOL_BROKER_KEY }, create: { key: TOOL_BROKER_KEY, value }, update: { value } });

  return next;
}

const KEY = "supervisorEnabled";

export async function isSupervisorEnabled(): Promise<boolean> {
  const row = await prisma.factorySetting.findUnique({ where: { key: KEY } });

  return row?.value !== "false";
}

export async function setSupervisorEnabled(enabled: boolean): Promise<void> {
  const value = enabled ? "true" : "false";

  await prisma.factorySetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value },
  });
}

const AUTO_UPDATE_KEY = "autoUpdate";

/** 감독 프로그램 자동 업데이트 허용 여부. 값이 없으면 켜짐. */
export async function isAutoUpdateEnabled(): Promise<boolean> {
  const row = await prisma.factorySetting.findUnique({ where: { key: AUTO_UPDATE_KEY } });

  return row?.value !== "false";
}

export async function setAutoUpdateEnabled(enabled: boolean): Promise<void> {
  const value = enabled ? "true" : "false";

  await prisma.factorySetting.upsert({
    where: { key: AUTO_UPDATE_KEY },
    create: { key: AUTO_UPDATE_KEY, value },
    update: { value },
  });
}

const INFO_KEY = "supervisorInfo";

export interface SupervisorInfo {
  commit: string;
  note: string;
  at: string;
  subject?: string; // 현재 커밋 메시지 첫 줄(새 감독 프로그램만 보낸다)
}

export async function getSupervisorInfo(): Promise<SupervisorInfo | null> {
  const row = await prisma.factorySetting.findUnique({ where: { key: INFO_KEY } });

  if (!row) return null;
  try {
    return JSON.parse(row.value) as SupervisorInfo;
  } catch {
    return null;
  }
}

const MAX_EVENTS = 300;

/** 감독 프로그램이 알려 준 커밋·소식을 저장한다. 값이 바뀔 때만 쓴다(5초마다 오는 요청이 DB 를 두드리지 않게).
 *  바뀌면 업데이트 이력(FactorySupervisorEvent)에 한 줄 남긴다. */
export async function saveSupervisorInfo(commit: string, note: string, subject = ""): Promise<void> {
  const cur = await getSupervisorInfo();

  if (cur && cur.commit === commit && cur.note === note && (!subject || cur.subject === subject)) return;
  const keepSubject = subject || (cur?.commit === commit ? (cur?.subject ?? "") : "");
  const value = JSON.stringify({ commit, note, at: new Date().toISOString(), ...(keepSubject ? { subject: keepSubject } : {}) });

  await prisma.factorySetting.upsert({
    where: { key: INFO_KEY },
    create: { key: INFO_KEY, value },
    update: { value },
  });

  // 커밋이나 소식이 바뀐 경우만 이력에 남긴다(메시지만 처음 채워진 경우는 남기지 않음)
  if (cur && cur.commit === commit && cur.note === note) return;
  await prisma.factorySupervisorEvent.create({
    data: {
      fromCommit: cur && cur.commit !== commit ? cur.commit : null,
      commit,
      subject: keepSubject || null,
      note: note || null,
    },
  });
  // 오래된 이력은 정리한다
  const old = await prisma.factorySupervisorEvent.findMany({ orderBy: { id: "desc" }, skip: MAX_EVENTS, take: 100, select: { id: true } });

  if (old.length) await prisma.factorySupervisorEvent.deleteMany({ where: { id: { lte: old[0].id } } });
}

const UPDATE_NOW_KEY = "updateNowRequestedAt";

/** "지금 업데이트" 요청을 남긴다(통제실 버튼·커넥터). 감독 프로그램이 다음 /next 에서 한 번 받아 간다. */
export async function requestUpdateNow(): Promise<void> {
  const value = new Date().toISOString();

  await prisma.factorySetting.upsert({
    where: { key: UPDATE_NOW_KEY },
    create: { key: UPDATE_NOW_KEY, value },
    update: { value },
  });
}

/** 아직 감독 프로그램이 받아 가지 않은 "지금 업데이트" 요청 시각. 없으면 null. */
export async function getPendingUpdateNow(): Promise<string | null> {
  const row = await prisma.factorySetting.findUnique({ where: { key: UPDATE_NOW_KEY } });

  return row?.value ?? null;
}

/** /next 에서 부른다. 요청이 있었으면 지우고 true(1회성). 동시에 두 번 와도 지운 쪽 하나만 true 다. */
export async function consumeUpdateNow(): Promise<boolean> {
  const { count } = await prisma.factorySetting.deleteMany({ where: { key: UPDATE_NOW_KEY } });

  return count > 0;
}

const COMPACT_KEY = "compactAfterJob";

/** 일감·정비가 성공으로 끝나면 감독 프로그램이 이어 쓸 Claude 세션을 /compact 로 정리할지. 값이 없으면 켜짐. */
export async function isCompactAfterJobEnabled(): Promise<boolean> {
  const row = await prisma.factorySetting.findUnique({ where: { key: COMPACT_KEY } });

  return row?.value !== "false";
}

export async function setCompactAfterJobEnabled(enabled: boolean): Promise<void> {
  const value = enabled ? "true" : "false";

  await prisma.factorySetting.upsert({ where: { key: COMPACT_KEY }, create: { key: COMPACT_KEY, value }, update: { value } });
}

const APP_SLOTS_KEY = "appSlots";
export const MIN_APP_SLOTS = 1;
export const MAX_APP_SLOTS = 4;
export const DEFAULT_APP_SLOTS = 3;

/** 동시에 만들 앱 수로 받아들이는 값: 1~4 정수(숫자 또는 정수 문자열)만. 그 밖은 null */
export function cleanAppSlots(v: unknown): number | null {
  if (typeof v === "string" && !/^\s*\d{1,3}\s*$/.test(v)) return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);

  return Number.isInteger(n) && n >= MIN_APP_SLOTS && n <= MAX_APP_SLOTS ? n : null;
}

/** 통제실에서 정한 '동시에 만들 앱 수'. 정한 적 없거나 값이 이상하면 기본 3(isDefault: true). */
export async function getAppSlots(): Promise<{ value: number; isDefault: boolean }> {
  const row = await prisma.factorySetting.findUnique({ where: { key: APP_SLOTS_KEY } });
  const n = cleanAppSlots(row?.value);

  return n === null ? { value: DEFAULT_APP_SLOTS, isDefault: true } : { value: n, isDefault: false };
}

export async function setAppSlots(n: number): Promise<void> {
  const value = String(n);

  await prisma.factorySetting.upsert({ where: { key: APP_SLOTS_KEY }, create: { key: APP_SLOTS_KEY, value }, update: { value } });
}

const AUTO_DEPLOY_KEY = "maintenanceAutoDeploy";

/** 정비 대기열이 모두 끝나면 자동 배포할지. 값이 없으면 꺼짐. */
export async function isAutoDeployEnabled(): Promise<boolean> {
  const row = await prisma.factorySetting.findUnique({ where: { key: AUTO_DEPLOY_KEY } });

  return row?.value === "true";
}

export async function setAutoDeployEnabled(enabled: boolean): Promise<void> {
  const value = enabled ? "true" : "false";

  await prisma.factorySetting.upsert({
    where: { key: AUTO_DEPLOY_KEY },
    create: { key: AUTO_DEPLOY_KEY, value },
    update: { value },
  });
}

// 짧은 문자열 설정(정비 대기열 멈춤 표시 등). 없으면 null.
export async function getSettingValue(key: string): Promise<string | null> {
  const row = await prisma.factorySetting.findUnique({ where: { key } });

  return row?.value ?? null;
}

export async function setSettingValue(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await prisma.factorySetting.deleteMany({ where: { key } });

    return;
  }
  await prisma.factorySetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

const RESTART_KEY = "restartRequestedAt";

/** "감독 재시작" 요청을 남긴다(통제실 버튼·커넥터). 감독 프로그램이 다음 /next 에서 한 번 받아 간다. */
export async function requestRestart(): Promise<void> {
  const value = new Date().toISOString();

  await prisma.factorySetting.upsert({ where: { key: RESTART_KEY }, create: { key: RESTART_KEY, value }, update: { value } });
}

/** 아직 감독 프로그램이 받아 가지 않은 재시작 요청 시각. 없으면 null. */
export async function getPendingRestart(): Promise<string | null> {
  const row = await prisma.factorySetting.findUnique({ where: { key: RESTART_KEY } });

  return row?.value ?? null;
}

/** /next 에서 부른다. 요청이 있었으면 지우고 true(1회성). */
export async function consumeRestart(): Promise<boolean> {
  const { count } = await prisma.factorySetting.deleteMany({ where: { key: RESTART_KEY } });

  return count > 0;
}

const RUNTIME_KEY = "supervisorRuntime";

// 감독 프로그램 실행 정보(/next 로 알려 줌): 시작 시각·어떻게 켜졌는지·ffmpeg·재시작 진행 상황
export interface SupervisorRuntime {
  startedAt?: string; // 이 프로세스가 시작한 시각
  boot?: string; // restart(재시작 요청으로 다시 켜짐) | start
  ffmpeg?: string; // "버전 | 경로" 또는 "없음"
  ffprobe?: string;
  claudeTool?: string; // AI 도구 상태(읽기 전용): "버전 · 로그인됨|로그인 안 됨|로그인 확인 안 함" 또는 "없음"
  codexTool?: string;
  aiToolsAt?: string; // PC 가 AI 도구 상태를 확인한 시각
  memory?: string; // 작업 메모리 상태(읽기 전용): "폴더|갱신시각|KB|푸시(ok|failed|none|blocked)|정리필요(0|1)" 를 ; 로 이은 글. 본문 없음
  restartWait?: boolean; // 재시작 요청을 받았고 진행 중 작업이 끝나길 기다리는 중
  restartFail?: string; // PC 가 알려 준 재시작 실패 이유
  drain?: "update" | "deploy"; // 감독 프로그램이 업데이트·서버 배포를 진행 중 일감이 끝나길 기다리는 중(새 일감은 받지 않음)
  drainJobs?: number; // 그때 끝나길 기다리는 일감 수(정비 지시 포함)
  restartTakenAt?: string; // 감독 프로그램이 재시작 요청을 받아 간 시각(새로 켜지면 지운다)
  restartedAt?: string; // 마지막으로 재시작이 끝난 시각
  restartFailNotified?: string; // 텔레그램으로 알린 실패 이유(같은 이유를 두 번 보내지 않게)
}

export async function getSupervisorRuntime(): Promise<SupervisorRuntime> {
  const row = await prisma.factorySetting.findUnique({ where: { key: RUNTIME_KEY } });

  if (!row) return {};
  try {
    return JSON.parse(row.value) as SupervisorRuntime;
  } catch {
    return {};
  }
}

/** 바뀐 경우만 쓴다(15초마다 오는 요청이 DB 를 두드리지 않게). 바뀌었으면 true. */
export async function saveSupervisorRuntime(next: SupervisorRuntime, cur?: SupervisorRuntime): Promise<boolean> {
  const before = cur ?? (await getSupervisorRuntime());
  // 빈 값은 빼고 키 순서를 맞춰 비교한다
  const stable = (o: object) =>
    JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && v !== false).sort(([a], [b]) => a.localeCompare(b))));
  const value = stable(next);

  if (value === stable(before)) return false;
  await prisma.factorySetting.upsert({ where: { key: RUNTIME_KEY }, create: { key: RUNTIME_KEY, value }, update: { value } });

  return true;
}
