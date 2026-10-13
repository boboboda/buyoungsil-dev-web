// lib/factory/keyProvision.ts
// 통제실 외부 서비스 키 → 서버2 .env 자동 반영. 실제 반영은 작업 PC 감독 프로그램(keyprovision.mjs)이 app-kit 의 provision-key.sh 로 한다.
// 서버가 하는 일: "반영 대상 이름"(감독 프로그램이 key-map.json 에서 이름만 알려 줌)을 기억하고, 키를 등록·교체하면 반영 요청(pending)을 남기고,
// 감독 프로그램이 보낸 결과(종료 코드·출력 줄, 값 없음)를 보관해 화면에 보여 준다.
// - 값은 여기 어디에도 저장하지 않는다. 서버 보관 키(REVIEW_STATUS_TOKEN_…)만 감독 프로그램 전용 GET 응답에 값이 실린다(PC 에 값이 없으므로).
// - 저장 위치는 factory_settings 한 곳(키 `keyProvision:<이름>`, `keyProvisionNames`). 새 테이블 없음.
import { maskSecrets } from "@/lib/factory/mask";
import { isServerSecretName, readServerSecret, SECRET_ENTRY_NAME_RE } from "@/lib/factory/secretEntries";
import { getSettingValue, setSettingValue } from "@/lib/factory/settings";

const NAMES_KEY = "keyProvisionNames";
const recordKey = (name: string) => `keyProvision:${name}`;
const MAX_NAMES = 100;
const MAX_LINES = 30;
const MAX_LINE = 200;
const RUNNING_STALE_MS = 15 * 60_000; // 실행 중으로 남은 지 이만큼 지나면(감독 프로그램이 꺼짐 등) 다시 요청으로 본다

export type ProvisionState = "pending" | "running" | "ok" | "unchanged" | "failed";
const STATES: ProvisionState[] = ["pending", "running", "ok", "unchanged", "failed"];

export interface ProvisionRecord {
  state: ProvisionState;
  seq: number; // 요청 번호. 등록·교체·[다시 반영]마다 올라가고, 결과는 같은 번호일 때만 받는다
  exitCode: number | null;
  lines: string[]; // 값 없는 출력 줄
  requestedAt: string;
  at: string; // 마지막 상태 변경
}

export const PROVISION_EXIT_TEXT: Record<number, string> = {
  2: "사용법·키 이름이 key-map.json 과 안 맞아요",
  3: "작업 PC 에 그 키의 값이 없어요",
  4: "서버 반영에 실패해서 이전 값으로 되돌렸어요",
  5: "서버 반영에 실패했고 되돌림도 실패했어요 — 사람이 확인해야 해요",
};

function parseRecord(raw: string | null): ProvisionRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ProvisionRecord>;

    if (!v || !STATES.includes(v.state as ProvisionState) || !Number.isInteger(v.seq) || typeof v.at !== "string") return null;

    return {
      state: v.state as ProvisionState,
      seq: v.seq as number,
      exitCode: Number.isInteger(v.exitCode) ? (v.exitCode as number) : null,
      lines: Array.isArray(v.lines) ? v.lines.filter((x): x is string => typeof x === "string").slice(0, MAX_LINES) : [],
      requestedAt: typeof v.requestedAt === "string" ? v.requestedAt : v.at,
      at: v.at,
    };
  } catch {
    return null;
  }
}

async function readRecord(name: string): Promise<ProvisionRecord | null> {
  return parseRecord(await getSettingValue(recordKey(name)).catch(() => null));
}

const writeRecord = (name: string, rec: ProvisionRecord) => setSettingValue(recordKey(name), JSON.stringify(rec));

/** 감독 프로그램이 key-map.json 에서 읽은 반영 대상 이름. 아직 보고가 없으면 null. */
export async function provisionNames(): Promise<{ names: string[]; at: string } | null> {
  const raw = await getSettingValue(NAMES_KEY).catch(() => null);

  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { names?: unknown; at?: unknown };

    if (!Array.isArray(v.names) || typeof v.at !== "string") return null;

    return { names: v.names.filter((x): x is string => typeof x === "string" && SECRET_ENTRY_NAME_RE.test(x)), at: v.at };
  } catch {
    return null;
  }
}

export async function saveProvisionNames(names: unknown): Promise<number> {
  if (!Array.isArray(names)) return 0;
  const clean = [...new Set(names.filter((x): x is string => typeof x === "string" && SECRET_ENTRY_NAME_RE.test(x)))].sort().slice(0, MAX_NAMES);

  await setSettingValue(NAMES_KEY, JSON.stringify({ names: clean, at: new Date().toISOString() }));

  return clean.length;
}

export async function isProvisionTarget(name: string): Promise<boolean> {
  return !!(await provisionNames())?.names.includes(name);
}

/** 키를 등록·교체했을 때 부른다. 반영 대상 이름이면 요청(pending)을 남기고 true. 아니면 아무것도 안 한다. 던지지 않는다. */
export async function requestProvision(name: string): Promise<boolean> {
  try {
    if (!(await isProvisionTarget(name))) return false;
    const prev = await readRecord(name);
    const now = new Date().toISOString();

    await writeRecord(name, { state: "pending", seq: (prev?.seq ?? 0) + 1, exitCode: null, lines: [], requestedAt: now, at: now });

    return true;
  } catch {
    return false;
  }
}

/** 키를 삭제할 때 부른다. 서버는 건드리지 않고 반영 기록만 지운다. */
export async function clearProvision(name: string): Promise<void> {
  await setSettingValue(recordKey(name), null).catch(() => {});
}

/** 화면용: 반영 대상 이름과 키별 기록(값 없음) */
export async function provisionStatuses(): Promise<{ names: string[] | null; at: string | null; records: Record<string, ProvisionRecord> }> {
  const known = await provisionNames();
  const records: Record<string, ProvisionRecord> = {};

  for (const name of known?.names ?? []) {
    const rec = await readRecord(name);

    if (rec) records[name] = rec;
  }

  return { names: known?.names ?? null, at: known?.at ?? null, records };
}

const isStale = (rec: ProvisionRecord) => rec.state === "running" && Date.now() - new Date(rec.at).getTime() > RUNNING_STALE_MS;

/** /next 용: 감독 프로그램이 할 반영이 있는지 */
export async function provisionPending(): Promise<boolean> {
  const known = await provisionNames();

  for (const name of known?.names ?? []) {
    const rec = await readRecord(name);

    if (rec && (rec.state === "pending" || isStale(rec))) return true;
  }

  return false;
}

export interface PendingProvision {
  name: string;
  seq: number;
  value?: string; // 서버 보관 키만(PC 에 값이 없어서). PC 키는 감독 프로그램이 secrets.env 에서 읽는다
}

/** 감독 프로그램 전용(워커 토큰): 할 반영 목록. 응답에 값이 실릴 수 있으니 로그에 남기지 않는다. */
export async function pendingProvisions(): Promise<PendingProvision[]> {
  const known = await provisionNames();
  const out: PendingProvision[] = [];

  for (const name of known?.names ?? []) {
    const rec = await readRecord(name);

    if (!rec || !(rec.state === "pending" || isStale(rec))) continue;
    if (isServerSecretName(name)) {
      const value = await readServerSecret(name).catch(() => null);

      out.push(value ? { name, seq: rec.seq, value } : { name, seq: rec.seq }); // 값이 없으면 감독 프로그램이 종료 코드 3 으로 보고한다
    } else {
      out.push({ name, seq: rec.seq });
    }
  }

  return out;
}

const cleanLine = (s: string) => maskSecrets(s.replace(/[\u0000-\u001f\u007f]/g, " ").trim()).slice(0, MAX_LINE);

/** 감독 프로그램의 결과 보고. 요청 번호(seq)가 지금 것과 다르면(그 사이 다시 요청됨) 무시한다. */
export async function reportProvision(input: unknown): Promise<{ ok: boolean; applied: boolean }> {
  const r = input as { name?: unknown; seq?: unknown; state?: unknown; exitCode?: unknown; lines?: unknown } | null;

  if (!r || typeof r.name !== "string" || !SECRET_ENTRY_NAME_RE.test(r.name) || !Number.isInteger(r.seq)) return { ok: false, applied: false };
  if (!STATES.includes(r.state as ProvisionState) || r.state === "pending") return { ok: false, applied: false };
  const cur = await readRecord(r.name);

  if (!cur || cur.seq !== r.seq) return { ok: true, applied: false };
  const lines = Array.isArray(r.lines) ? r.lines.filter((x): x is string => typeof x === "string").slice(0, MAX_LINES).map(cleanLine).filter(Boolean) : [];
  const exitCode = Number.isInteger(r.exitCode) ? (r.exitCode as number) : null;

  await writeRecord(r.name, { ...cur, state: r.state as ProvisionState, exitCode, lines, at: new Date().toISOString() });

  return { ok: true, applied: true };
}
