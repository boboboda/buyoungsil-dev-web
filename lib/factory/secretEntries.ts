// lib/factory/secretEntries.ts
// 외부 서비스 키(환경변수) 전달. 통제실에서 입력 → 서버에 암호화해 임시 보관 → PC 감독 프로그램이 가져가 secrets.env 의 그 줄만 저장 → 확인(ack)하면 서버 값 삭제.
// 서명 키 비밀번호(keyPasswords.ts)와 같은 흐름이고 암호화(seal/unseal)도 그대로 쓴다. 서명 키 이름(RELEASE_...)은 여기서 다루지 않는다.
// - 값은 등록 응답·목록·로그·텔레그램 어디에도 다시 나오지 않는다. 감독 프로그램용 GET(/api/factory/secrets) 응답에만 있다.
// - 삭제도 같은 길: 삭제 대기 → PC 가 secrets.env 에서 그 줄만 지우고 확인하면 항목을 지운다(이름 카탈로그는 남는다).
// - PC 는 secrets.env 에 있는 "이름만" 알려 준다(pcSecretNames). 값은 오지 않는다.
// - 예외: 서버 보관 키(REVIEW_STATUS_TOKEN_…)는 PC 로 보내지 않고 암호문을 서버에 둔다(홈페이지 서버가 직접 씀, readServerSecret).
import prisma from "@/lib/prisma";
import { seal, unseal } from "@/lib/factory/keyPasswords";
import { getSettingValue, setSettingValue } from "@/lib/factory/settings";

export const SECRET_ENTRY_NAME_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
const ANY_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/; // secrets.env 에서 읽는 이름(예전 규칙)
export const MAX_SECRET_ENTRIES = 100;
const MAX_DESCRIPTION = 100;
const MAX_PC_NAMES = 300;
const PC_NAMES_KEY = "pcSecretNames";

// 시스템·공장 내부 이름. 서명 키 비밀번호(RELEASE_)는 키 보관함·출시 화면에서만 다룬다.
// tools/factory-supervisor/secrets.mjs 에도 같은 목록이 있다(같이 고친다).
const RESERVED_PREFIXES = ["RELEASE_", "FACTORY_", "SERVERCTL_", "NEXTAUTH_", "AUTH_", "DATABASE_", "NODE_", "NPM_", "GIT_", "SSH_", "CLAUDE_", "CODEX_", "ANTHROPIC_"];
const RESERVED_NAMES = new Set([
  "PATH", "PATHEXT", "HOME", "USERPROFILE", "USERNAME", "USER", "SHELL", "COMSPEC", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR",
  "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "HOMEDRIVE", "HOMEPATH", "PWD", "LANG", "TZ",
  "OPENAI_API_KEY", "OPENAI_BASE_URL",
]);

export const isReservedSecretName = (name: string) => RESERVED_NAMES.has(name) || RESERVED_PREFIXES.some((p) => name.startsWith(p));

// 서버 보관 키: 홈페이지 서버가 직접 쓰는 키(예: 검수 상태 토큰 REVIEW_STATUS_TOKEN_<앱>, 스튜디오 서비스 운영 관리자 키 SERVICE_ADMIN_TOKEN_<앱>). PC 로 보내지 않고 암호문을 서버에 남긴다.
// 값은 readServerSecret 으로 서버 안에서만 풀고, 목록·응답·로그에는 나오지 않는다. 앱 일감용 이름 목록(knownSecretNames)에서도 뺀다.
const SERVER_SECRET_PREFIXES = ["REVIEW_STATUS_TOKEN_", "SERVICE_ADMIN_TOKEN_"];
// 이름 그대로 서버 보관: STUDIO_KEY_PEPPER = Studio 접근 키 해시용 서버 비밀값(lib/studio/access.ts)
const SERVER_SECRET_NAMES = new Set(["STUDIO_KEY_PEPPER"]);

export const isServerSecretName = (name: string) => SERVER_SECRET_NAMES.has(name) || SERVER_SECRET_PREFIXES.some((p) => name.startsWith(p));

/** 서버 보관 키의 값(서버 안에서만 쓴다). 없거나 풀 수 없으면 null. */
export async function readServerSecret(name: string): Promise<string | null> {
  if (!isServerSecretName(name) || !SECRET_ENTRY_NAME_RE.test(name)) return null;
  const row = await prisma.factorySecretEntry.findUnique({ where: { name }, select: { sealed: true, status: true } });

  if (!row?.sealed || row.status !== "stored") return null;
  const value = unseal(row.sealed);

  return value !== null && checkSecretValue(value).ok ? value : null;
}

export function checkSecretName(v: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const name = typeof v === "string" ? v.trim() : "";

  if (!SECRET_ENTRY_NAME_RE.test(name)) return { ok: false, message: "이름은 대문자로 시작하고 대문자·숫자·_ 로 3~64자예요. 예: PIXELLAB_TOKEN" };
  if (name.startsWith("RELEASE_")) return { ok: false, message: "RELEASE_ 로 시작하는 이름은 서명 키 전용이에요(키 보관함·출시 화면에서 다뤄요)." };
  if (isReservedSecretName(name)) return { ok: false, message: `${name} 은(는) 시스템·공장 내부에서 쓰는 이름이라 쓸 수 없어요.` };

  return { ok: true, value: name };
}

// keyPasswords.ts 의 checkPassword 와 같은 원칙(secrets.env 한 줄에 그대로 들어가야 함). 길이만 토큰용으로 8~4096자.
export function checkSecretValue(v: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof v !== "string" || v.length < 8 || v.length > 4096) return { ok: false, message: "값은 8~4096자예요." };
  if (/[\u0000-\u001f\u007f]/.test(v)) return { ok: false, message: "값에 줄바꿈·제어문자는 쓸 수 없어요." };
  if (v !== v.trim()) return { ok: false, message: "값 앞뒤에 공백은 쓸 수 없어요." };
  if (/^(['"]).*\1$/.test(v)) return { ok: false, message: "값을 따옴표로 감싸지 마세요." };

  return { ok: true, value: v };
}

const cleanDescription = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_DESCRIPTION) : "");

type Result = { ok: boolean; status: number; message: string; replaced?: boolean };

const isUniqueRace = (e: unknown) => (e as { code?: string })?.code === "P2002";

/** 키를 등록하거나 바꾼다. 같은 이름을 동시에 보내면 version 이 차례로 올라가고 마지막 값이 남는다. 돌려주는 메시지에 값은 없다. */
export async function registerSecretEntry(nameRaw: unknown, descriptionRaw: unknown, valueRaw: unknown): Promise<Result> {
  const n = checkSecretName(nameRaw);

  if ("message" in n) return { ok: false, status: 400, message: n.message };
  const v = checkSecretValue(valueRaw);

  if ("message" in v) return { ok: false, status: 400, message: v.message };
  const name = n.value;
  const description = cleanDescription(descriptionRaw);
  const before = await prisma.factorySecretEntry.findUnique({ where: { name }, select: { status: true } });

  if (!before && (await prisma.factorySecretEntry.count()) >= MAX_SECRET_ENTRIES) {
    return { ok: false, status: 400, message: `외부 서비스 키는 ${MAX_SECRET_ENTRIES}개까지예요.` };
  }
  const sealed = seal(v.value);

  if (!sealed) return { ok: false, status: 500, message: "서버 암호화 키가 없어 보관할 수 없어요(FACTORY_SECRET_KEY 또는 NEXTAUTH_SECRET 필요)." };
  // 서버 보관 키: 바로 '저장됨'(PC 가 가져가지 않음), 암호문은 남긴다. 앱 일감용 이름 카탈로그에는 넣지 않는다
  if (isServerSecretName(name)) {
    const serverUpsert = () =>
      prisma.factorySecretEntry.upsert({
        where: { name },
        create: { name, description, sealed, status: "stored", version: 1, storedAt: new Date() },
        update: { sealed, status: "stored", version: { increment: 1 }, storedAt: new Date(), ...(description ? { description } : {}) },
      });

    try {
      await serverUpsert();
    } catch (e) {
      if (!isUniqueRace(e)) throw e;
      await serverUpsert();
    }

    return {
      ok: true,
      status: 200,
      replaced: !!before,
      message: `${name} 를 ${before ? "교체" : "등록"}했어요. 홈페이지 서버에 암호화해 보관하고 서버만 써요(작업 PC 로 보내지 않아요).`,
    };
  }
  const pc = await pcSecretNames();
  const replaced = before?.status === "stored" || !!pc?.names.includes(name);
  const upsert = () =>
    prisma.factorySecretEntry.upsert({
      where: { name },
      create: { name, description, sealed, status: "pending", version: 1 },
      update: { sealed, status: "pending", version: { increment: 1 }, storedAt: null, ...(description ? { description } : {}) },
    });

  try {
    await upsert();
  } catch (e) {
    if (!isUniqueRace(e)) throw e;
    await upsert(); // 같은 이름을 동시에 처음 만든 경우: 한 번 더 하면 update 로 간다
  }
  // 이름 카탈로그(list_secret_names·requiredSecrets 검사)에도 남긴다. 값은 없다.
  const catalogDesc = description || "통제실에서 등록한 외부 서비스 키";

  await prisma.factorySecretName.upsert({ where: { name }, create: { name, description: catalogDesc }, update: description ? { description } : {} });

  return {
    ok: true,
    status: 200,
    replaced,
    message: `${name} 를 ${replaced ? "교체" : "등록"}했어요. 작업 PC 감독 프로그램이 곧 가져가 secrets.env 에 저장하고, 서버에서는 지워요.`,
  };
}

/** PC secrets.env 에서 그 줄만 지우도록 요청한다. 알려진 이름(항목·카탈로그·PC 보고)만. */
export async function requestSecretDelete(nameRaw: unknown): Promise<Result> {
  const n = checkSecretName(nameRaw);

  if ("message" in n) return { ok: false, status: 400, message: n.message };
  const name = n.value;

  // 서버 보관 키는 PC 를 거치지 않고 바로 지운다
  if (isServerSecretName(name)) {
    const del = await prisma.factorySecretEntry.deleteMany({ where: { name } });

    return del.count ? { ok: true, status: 200, message: `${name} 를 서버에서 지웠어요.` } : { ok: false, status: 404, message: "모르는 이름이에요." };
  }
  const [entry, catalog, pc] = await Promise.all([
    prisma.factorySecretEntry.findUnique({ where: { name }, select: { name: true } }),
    prisma.factorySecretName.findUnique({ where: { name }, select: { description: true } }),
    pcSecretNames(),
  ]);

  if (!entry && !catalog && !pc?.names.includes(name)) return { ok: false, status: 404, message: "모르는 이름이에요." };
  const upsert = () =>
    prisma.factorySecretEntry.upsert({
      where: { name },
      create: { name, description: catalog?.description.slice(0, MAX_DESCRIPTION) ?? "", sealed: null, status: "delete_pending", version: 1 },
      update: { sealed: null, status: "delete_pending", version: { increment: 1 }, storedAt: null },
    });

  try {
    await upsert();
  } catch (e) {
    if (!isUniqueRace(e)) throw e;
    await upsert();
  }

  return { ok: true, status: 200, message: `${name} 삭제를 요청했어요. 작업 PC 가 secrets.env 에서 그 줄만 지우면 완료돼요.` };
}

/** /next 용: PC 가 할 일(가져갈 값·지울 줄)이 있는지 */
export async function secretEntriesPending(): Promise<boolean> {
  return (await prisma.factorySecretEntry.count({ where: { OR: [{ status: "pending", sealed: { not: null } }, { status: "delete_pending" }] } })) > 0;
}

export type PendingSecretItem = { name: string; version: number; value: string } | { name: string; version: number; delete: true };

/** 감독 프로그램 전용(워커 토큰): 가져갈 값과 지울 이름. 풀 수 없는 값(암호화 키가 바뀜 등)은 건너뛴다. */
export async function pendingSecretEntries(): Promise<PendingSecretItem[]> {
  const rows = await prisma.factorySecretEntry.findMany({
    where: { OR: [{ status: "pending", sealed: { not: null } }, { status: "delete_pending" }] },
    orderBy: { updatedAt: "asc" },
    take: 50,
  });
  const out: PendingSecretItem[] = [];

  for (const r of rows) {
    if (isReservedSecretName(r.name) || isServerSecretName(r.name) || !SECRET_ENTRY_NAME_RE.test(r.name)) continue;
    if (r.status === "delete_pending") {
      out.push({ name: r.name, version: r.version, delete: true });
      continue;
    }
    const value = r.sealed ? unseal(r.sealed) : null;

    if (value !== null && checkSecretValue(value).ok) out.push({ name: r.name, version: r.version, value });
  }

  return out;
}

/** 감독 프로그램이 secrets.env 에 반영했다고 알리면 서버 값을 지운다. 그 사이 다시 등록·삭제된 것(version 다름)은 남긴다. */
export async function ackSecretEntries(items: unknown): Promise<number> {
  if (!Array.isArray(items)) return 0;
  let n = 0;

  for (const it of items.slice(0, 50)) {
    const r = it as { name?: unknown; version?: unknown; action?: unknown };

    if (typeof r?.name !== "string" || !SECRET_ENTRY_NAME_RE.test(r.name) || isServerSecretName(r.name) || !Number.isInteger(r.version)) continue;
    const version = r.version as number;

    if (r.action === "store") {
      const res = await prisma.factorySecretEntry.updateMany({
        where: { name: r.name, version, status: "pending" },
        data: { sealed: null, status: "stored", storedAt: new Date() },
      });

      n += res.count;
    } else if (r.action === "delete") {
      const res = await prisma.factorySecretEntry.deleteMany({ where: { name: r.name, version, status: "delete_pending" } });

      n += res.count;
    }
  }

  return n;
}

// ───────── PC 가 알려 준 이름(값 없음) ─────────

export async function pcSecretNames(): Promise<{ names: string[]; at: string } | null> {
  const raw = await getSettingValue(PC_NAMES_KEY).catch(() => null);

  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { names?: unknown; at?: unknown };

    if (!Array.isArray(v.names) || typeof v.at !== "string") return null;

    return { names: v.names.filter((x): x is string => typeof x === "string"), at: v.at };
  } catch {
    return null;
  }
}

/** 감독 프로그램이 secrets.env 의 이름 목록을 알린다. 예약 이름·이상한 이름은 버린다. 저장한 개수를 돌려준다. */
export async function savePcSecretNames(names: unknown): Promise<number> {
  if (!Array.isArray(names)) return 0;
  const clean = [...new Set(names.filter((x): x is string => typeof x === "string" && ANY_NAME_RE.test(x) && !isReservedSecretName(x)))].sort().slice(0, MAX_PC_NAMES);

  await setSettingValue(PC_NAMES_KEY, JSON.stringify({ names: clean, at: new Date().toISOString() }));

  return clean.length;
}

// ───────── 화면·커넥터용(값 없음) ─────────

export type SecretEntryState = "pending" | "stored" | "delete_pending" | "missing" | "server"; // server = 서버 보관 키(PC 로 안 감)

export interface SecretEntryView {
  name: string;
  description: string;
  state: SecretEntryState;
  onPc: boolean | null; // PC 보고 기준(보고가 없으면 null)
  updatedAt: string | null;
}

/** 통제실 목록: 등록 항목 + 이름 카탈로그 + PC 보고 이름을 합친다(서명 키·예약 이름은 뺀다). */
export async function secretEntryStatuses(): Promise<{ items: SecretEntryView[]; pcReportedAt: string | null }> {
  const [entries, catalog, pc] = await Promise.all([
    prisma.factorySecretEntry.findMany({ select: { name: true, description: true, status: true, storedAt: true, updatedAt: true, sealed: true } }),
    prisma.factorySecretName.findMany({ select: { name: true, description: true, createdAt: true } }),
    pcSecretNames(),
  ]);
  const pcSet = pc ? new Set(pc.names) : null;
  const pcAt = pc ? new Date(pc.at).getTime() : 0;
  const map = new Map<string, SecretEntryView>();

  for (const c of catalog) {
    if (isReservedSecretName(c.name)) continue;
    const onPc = pcSet ? pcSet.has(c.name) : null;

    map.set(c.name, { name: c.name, description: c.description, state: onPc ? "stored" : "missing", onPc, updatedAt: c.createdAt.toISOString() });
  }
  for (const name of pc?.names ?? []) {
    if (!map.has(name) && !isReservedSecretName(name)) map.set(name, { name, description: "", state: "stored", onPc: true, updatedAt: pc!.at });
  }
  for (const e of entries) {
    if (isReservedSecretName(e.name)) continue;
    if (isServerSecretName(e.name)) {
      map.set(e.name, { name: e.name, description: e.description, state: e.sealed ? "server" : "missing", onPc: null, updatedAt: e.updatedAt.toISOString() });
      continue;
    }
    const onPc = pcSet ? pcSet.has(e.name) : null;
    let state: SecretEntryState = e.status === "pending" ? "pending" : e.status === "delete_pending" ? "delete_pending" : "stored";

    // 저장 확인 뒤 PC 가 새로 알려 온 목록에 없으면(사람이 직접 지움 등) PC 에 없음
    if (state === "stored" && pcSet && !onPc && e.storedAt && pcAt >= e.storedAt.getTime()) state = "missing";
    const prev = map.get(e.name);

    map.set(e.name, { name: e.name, description: e.description || prev?.description || "", state, onPc, updatedAt: e.updatedAt.toISOString() });
  }

  return { items: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)), pcReportedAt: pc?.at ?? null };
}

/** list_secret_names·requiredSecrets 검사용: 카탈로그 이름 + PC 보고로만 알려진 이름. 설명은 카탈로그 → 등록 항목 순. 삭제 대기는 뺀다. */
export async function knownSecretNames(): Promise<{ name: string; description: string }[]> {
  const [catalog, entries, pc] = await Promise.all([
    prisma.factorySecretName.findMany({ orderBy: { name: "asc" } }),
    prisma.factorySecretEntry.findMany({ select: { name: true, description: true, status: true } }),
    pcSecretNames(),
  ]);
  const deleting = new Set(entries.filter((e) => e.status === "delete_pending").map((e) => e.name));
  const entryDesc = new Map(entries.map((e) => [e.name, e.description]));
  const map = new Map<string, string>();

  for (const c of catalog) if (!deleting.has(c.name) && !isServerSecretName(c.name)) map.set(c.name, c.description || entryDesc.get(c.name) || "");
  for (const n of pc?.names ?? []) {
    if (!map.has(n) && !deleting.has(n) && !isReservedSecretName(n) && !isServerSecretName(n)) map.set(n, entryDesc.get(n) || "작업 PC 에 있는 키(설명 없음)");
  }

  return [...map.entries()].map(([name, description]) => ({ name, description })).sort((a, b) => a.name.localeCompare(b.name));
}
