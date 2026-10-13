// lib/factory/supervisorLog.ts
// 통제실 [감독] 탭의 '감독 로그': 재시작·일시 정지/재개·자동 업데이트·장비 보고 성공/실패·오류 같은 사건을 시간순으로.
// 새 테이블·API 없이 설정 한 칸(FactorySetting)에 최근 줄만 JSON 으로 둔다(상한은 일감·정비 로그와 같은 500줄·한 줄 2000자, 비밀번호 가림).
// 업데이트 소식은 이미 있는 업데이트 이력(FactorySupervisorEvent)을 읽을 때 합친다.
import { MAX_LOG_MESSAGE, MAX_LOGS_PER_JOB } from "@/lib/factory/jobs";
import { maskSecrets } from "@/lib/factory/mask";
import prisma from "@/lib/prisma";

const LOG_KEY = "supervisorLog";

export type SupervisorLogKind = "update" | "restart" | "pause" | "device" | "error" | "setting";

export interface SupervisorLogLine {
  at: string;
  kind: SupervisorLogKind;
  text: string;
  ok?: boolean; // 실패·오류면 false
}

const clean = (s: string) => maskSecrets(s.replace(/\s+/g, " ").trim().slice(0, MAX_LOG_MESSAGE)) || "-";

async function readLines(): Promise<SupervisorLogLine[]> {
  const row = await prisma.factorySetting.findUnique({ where: { key: LOG_KEY } });

  if (!row) return [];
  try {
    const list = JSON.parse(row.value) as unknown;

    return Array.isArray(list) ? (list as SupervisorLogLine[]) : [];
  } catch {
    return [];
  }
}

/** 감독 로그에 한 줄 더한다. 로그 때문에 본 동작이 실패하면 안 되므로 오류는 삼킨다. */
export async function addSupervisorLog(kind: SupervisorLogKind, text: string, ok = true): Promise<void> {
  try {
    const lines = await readLines();

    lines.push({ at: new Date().toISOString(), kind, text: clean(text), ...(ok ? {} : { ok: false }) });
    const value = JSON.stringify(lines.slice(-MAX_LOGS_PER_JOB));

    await prisma.factorySetting.upsert({ where: { key: LOG_KEY }, create: { key: LOG_KEY, value }, update: { value } });
  } catch (error) {
    console.error("[supervisor-log] 기록 실패:", error);
  }
}

// 장비 보고는 1분마다 오므로 성공은 '처음/실패 뒤 복구'일 때만, 실패는 연속이면 처음 한 번만 남긴다
const deviceOk = new Map<string, boolean>();

export async function noteDeviceReport(device: string, ok: boolean, reason?: string): Promise<void> {
  const before = deviceOk.get(device);

  deviceOk.set(device, ok);
  if (ok && before !== false && before !== undefined) return;
  if (!ok && before === false) return;
  await addSupervisorLog(
    "device",
    ok ? (before === false ? `장비 보고 복구: ${device}` : `장비 보고 시작: ${device}`) : `장비 보고 실패: ${device}${reason ? ` — ${reason}` : ""}`,
    ok,
  );
}

/** 기록된 줄 + 업데이트 소식을 합쳐 최신이 위로 오게 돌려준다. */
export async function supervisorLog(limit = 100): Promise<SupervisorLogLine[]> {
  const [lines, updates] = await Promise.all([
    readLines(),
    prisma.factorySupervisorEvent.findMany({ orderBy: { id: "desc" }, take: limit }),
  ]);
  const fromUpdates: SupervisorLogLine[] = updates.map((e) => ({
    at: e.at.toISOString(),
    kind: "update",
    text: clean(
      `${e.fromCommit ? `업데이트 ${e.fromCommit.slice(0, 7)} → ${e.commit.slice(0, 7)}` : `감독 프로그램 ${e.commit.slice(0, 7)}`}${e.subject ? ` ${e.subject}` : ""}${e.note ? ` · ${e.note}` : ""}`,
    ),
  }));

  return [...lines, ...fromUpdates].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}
