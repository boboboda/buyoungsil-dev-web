// lib/factory/keyVault.ts
// 앱 공장 키 보관함: 업로드(서명) 키 항목을 모아 두고, 배포 계정(기본 키)과 앱(이 앱이 쓸 키)이 골라 쓴다.
// - 서버에는 PC 파일 경로·별칭·이름·설명·운영 키 표시와, PC 감독 프로그램이 확인한 정보(있음·크기·형식·별칭·SHA-1)만 둔다.
//   파일 내용·개인키는 서버로 오지 않는다. 비밀번호는 keyPasswords.ts 방식(서버 암호화 임시 보관 → PC secrets.env → 서버 삭제) 그대로.
// - [새 공용 키 만들기]만 PC 가 keytool 로 파일을 만든다(대상 경로에 파일이 있으면 절대 덮어쓰지 않음). 출시 일감은 키를 만들지 않는다.
// - [조회]: PC 가 그 파일 하나를 직접 확인한다(확장자 없어도 됨, 1MB 이하 일반 파일만, 심볼릭 링크는 따라가지 않음).
// - 예전 값(계정의 서명 키 경로·별칭, 앱별 '다른 키')은 첫 로드 때 보관함 항목으로 가져온다(예전 열은 지우지 않고 사본으로 둔다).
// - 운영 키(production)는 삭제·다시 만들기 불가. 보관함 항목을 지워도 PC 파일은 지우지 않는다.
// - [커밋에서 빼기]: 앱 폴더 git 이 키 파일을 추적 중이면 PC 가 기록을 조사하고(커밋 해시 앞 7자리·날짜·메시지 첫 줄, 원격·브랜치 이름만)
//   git rm --cached + .gitignore 보강 + 그 두 경로만 로컬 커밋한다. 파일은 지우거나 옮기거나 바꾸지 않고, push·기록 삭제는 하지 않는다(운영 키도 허용).
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { maskSecrets } from "@/lib/factory/mask";
import { DEFAULT_KEY_ALIAS, keyPasswordStatuses, keyRefOf, keySecretNames, registerKeyPassword, type KeyPasswordState } from "@/lib/factory/keyPasswords";

export const KEY_KINDS = { shared: "공용 키", app: "기존 앱 키" } as const;
export type KeyKind = keyof typeof KEY_KINDS;
const isKind = (v: unknown): v is KeyKind => v === "shared" || v === "app";

// PC 가 일감을 가져간 뒤 이 시간 안에 결과가 없으면 다시 내준다
const LEASE_MS = 3 * 60 * 1000;

type Res = { ok: boolean; status: number; message: string };
const bad = (message: string, status = 400): Res => ({ ok: false, status, message });

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();

  return t ? t.slice(0, max) : null;
};

/** PC 경로인지만 본다(확장자 없어도 됨. 예: ~/keys/Untitled) */
export function checkKeyPath(v: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const p = clean(v, 300);

  if (!p) return { ok: false, message: "키 파일 경로가 필요해요." };
  if (!/^(~[\\/]|[A-Za-z]:[\\/]|\/)/.test(p)) return { ok: false, message: "키 파일 경로는 ~/, C:\\, / 로 시작하는 PC 경로여야 해요." };
  if (/[\\/]$/.test(p)) return { ok: false, message: "키 파일 경로가 폴더로 끝나요. 파일 이름까지 넣어 주세요." };
  if (/(^|[\\/])\.\.([\\/]|$)/.test(p)) return { ok: false, message: "키 파일 경로에 .. 는 쓸 수 없어요." };

  return { ok: true, value: p };
}

const ALIAS_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** 비밀번호 이름에 쓰는 구분값(경로를 바꾼 키는 처음 값) */
export const vaultRef = (k: { passwordRef: string | null; keystorePath: string; keyAlias: string }) => k.passwordRef || keyRefOf(k.keystorePath, k.keyAlias);
const normPath = (p: string) => p.trim().replace(/\\/g, "/").toLowerCase();

// ───────── 확인 결과 모양 ─────────

export interface KeyCheck {
  at: string;
  exists: boolean;
  size: number | null;
  mtime: string | null;
  type: string | null; // JKS | JCEKS | PKCS12 | 알 수 없음
  aliases: { alias: string; sha1: string | null }[];
  aliasFound: boolean | null; // 지정한 별칭이 파일 안에 있는지(형식만 읽은 PKCS12 는 null)
  passwordOk: boolean | null; // PC 에 비밀번호가 있어 keytool 로 확인했으면 true/false, 확인 못 하면 null
  inApp: string | null; // 작업 폴더의 앱 폴더 안에 있으면 그 앱 이름
  gitTracked: boolean | null; // 앱 폴더 안이고 git 이 추적 중이면 true(경고)
  note: string | null;
}

// [커밋에서 빼기] 결과
export interface KeyUntrack {
  at: string;
  ok: boolean;
  message: string | null; // 한국어 한 줄(오류 또는 '추적하지 않아요')
  file: string | null; // 저장소 안 상대 경로
  wasTracked: boolean;
  stagedOnly: boolean; // 스테이징만 되고 커밋된 적 없음
  commits: { hash: string; date: string | null; subject: string | null }[];
  hasRemote: boolean | null;
  remotes: string[];
  pushed: { commit: string; branches: string[] }[]; // 원격 브랜치(마지막 fetch 기준)에 들어간 커밋
  untracked: boolean;
  gitignoreAdded: string[];
  commit: string | null; // 새로 만든 로컬 커밋(앞 7자리)
  stillTracked: boolean | null;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? maskSecrets(v.replace(/[\u0000-\u001f\u007f]/g, " ")).slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const boolOrNull = (v: unknown) => (typeof v === "boolean" ? v : null);

function cleanCheck(v: unknown): KeyCheck | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;

  return {
    at: new Date().toISOString(),
    exists: r.exists === true,
    size: num(r.size),
    mtime: str(r.mtime, 40),
    type: str(r.type, 20),
    aliases: (Array.isArray(r.aliases) ? r.aliases : []).slice(0, 20).map((x: Record<string, unknown>) => ({
      alias: str(x?.alias, 80) ?? "",
      sha1: typeof x?.sha1 === "string" && /^[0-9A-F:]{40,59}$/.test(x.sha1) ? x.sha1 : null,
    })),
    aliasFound: boolOrNull(r.aliasFound),
    passwordOk: boolOrNull(r.passwordOk),
    inApp: str(r.inApp, 60),
    gitTracked: boolOrNull(r.gitTracked),
    note: str(r.note, 300),
  };
}

const HASH_RE = /^[0-9a-f]{7,12}$/;
const hash = (v: unknown) => (typeof v === "string" && HASH_RE.test(v) ? v.slice(0, 7) : null);
const strList = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.slice(0, n).map((x) => str(x, max)).filter((x): x is string => !!x) : []);

function cleanUntrack(v: unknown, error: string | null): KeyUntrack {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;

  return {
    at: new Date().toISOString(),
    ok: !error && r.ok !== false,
    message: error ?? str(r.message, 300),
    file: str(r.file, 300),
    wasTracked: r.wasTracked === true,
    stagedOnly: r.stagedOnly === true,
    commits: (Array.isArray(r.commits) ? r.commits : [])
      .slice(0, 20)
      .map((c: Record<string, unknown>) => ({ hash: hash(c?.hash) ?? "", date: str(c?.date, 20), subject: str(c?.subject, 120) }))
      .filter((c) => c.hash),
    hasRemote: boolOrNull(r.hasRemote),
    remotes: strList(r.remotes, 10, 40),
    pushed: (Array.isArray(r.pushed) ? r.pushed : [])
      .slice(0, 20)
      .map((x: Record<string, unknown>) => ({ commit: hash(x?.commit) ?? "", branches: strList(x?.branches, 10, 80) }))
      .filter((x) => x.commit && x.branches.length),
    untracked: r.untracked === true,
    gitignoreAdded: strList(r.gitignoreAdded, 10, 200),
    commit: hash(r.commit),
    stillTracked: boolOrNull(r.stillTracked),
  };
}

// ───────── 예전 값 가져오기 (첫 로드 때, 몇 번 불러도 같음) ─────────

async function uniqueName(base: string): Promise<string> {
  for (let i = 1; i < 50; i++) {
    const name = (i === 1 ? base : `${base} (${i})`).slice(0, 60);

    if (!(await prisma.factoryKey.findUnique({ where: { name }, select: { id: true } }))) return name;
  }

  return `${base.slice(0, 40)} ${Date.now()}`;
}

/** 같은 경로·별칭의 보관함 항목을 찾고, 없으면 만든다(파일은 건드리지 않음) */
async function findOrAdd(path: string, alias: string, base: string, kind: KeyKind, description: string): Promise<string> {
  const all = await prisma.factoryKey.findMany({ select: { id: true, keystorePath: true, keyAlias: true } });
  const same = all.find((k) => normPath(k.keystorePath) === normPath(path) && k.keyAlias === alias);

  if (same) return same.id;
  const row = await prisma.factoryKey.create({ data: { name: await uniqueName(base), kind, keystorePath: path, keyAlias: alias, description } });

  return row.id;
}

let importing: Promise<void> | null = null;

/** 계정의 서명 키 경로·별칭, 앱별 '다른 키'를 보관함 항목으로 가져와 연결한다. 예전 열은 지우지 않는다. 던지지 않는다. */
export function importLegacyKeys(): Promise<void> {
  importing ??= (async () => {
    try {
      const accounts = await prisma.factoryReleaseAccount.findMany({ where: { defaultKeyId: null, keystorePath: { not: null } } });

      for (const a of accounts) {
        if (!a.keystorePath) continue;
        const id = await findOrAdd(a.keystorePath, a.keyAlias || DEFAULT_KEY_ALIAS, `계정 ${a.label} 공용 키`, "shared", `배포 계정 ${a.label} 의 서명 키(예전 설정에서 가져옴)`);

        await prisma.factoryReleaseAccount.update({ where: { id: a.id }, data: { defaultKeyId: id } });
      }
      const apps = await prisma.factoryApp.findMany({ where: { keyId: null, customKeystorePath: { not: null } } });

      for (const a of apps) {
        if (!a.customKeystorePath) continue;
        const id = await findOrAdd(a.customKeystorePath, a.customKeyAlias || DEFAULT_KEY_ALIAS, `${a.appSlug} 키`, "app", `${a.appSlug} 앱의 '다른 키'(예전 설정에서 가져옴)`);

        await prisma.factoryApp.update({ where: { appSlug: a.appSlug }, data: { keyId: id } });
      }
    } catch (error) {
      console.error("[factory] 키 보관함 가져오기 실패:", error);
    } finally {
      importing = null;
    }
  })();

  return importing;
}

// ───────── 목록 (화면용, 값 없음) ─────────

export interface VaultKey {
  id: string;
  name: string;
  kind: KeyKind;
  kindLabel: string;
  keystorePath: string;
  keyAlias: string;
  description: string | null;
  production: boolean;
  dname: string | null;
  createState: string | null;
  check: KeyCheck | null;
  checking: "requested" | "taken" | null;
  untracking: "requested" | "taken" | null;
  untrack: KeyUntrack | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  password: KeyPasswordState;
  usedBy: { accounts: string[]; apps: string[] };
  createdAt: Date;
}

export async function listVault(): Promise<VaultKey[]> {
  await importLegacyKeys();
  const [rows, pw] = await Promise.all([
    prisma.factoryKey.findMany({
      orderBy: { createdAt: "asc" },
      include: { accounts: { select: { label: true } }, apps: { select: { appSlug: true } } },
    }),
    keyPasswordStatuses(),
  ]);
  const pwByRef = new Map(pw.map((p) => [p.keyRef, p.state]));

  return rows.map((k) => ({
    id: k.id,
    name: k.name,
    kind: isKind(k.kind) ? k.kind : "shared",
    kindLabel: KEY_KINDS[isKind(k.kind) ? k.kind : "shared"],
    keystorePath: k.keystorePath,
    keyAlias: k.keyAlias,
    description: k.description,
    production: k.production,
    dname: k.dname,
    createState: k.createState,
    check: (k.check as unknown as KeyCheck | null) ?? null,
    checking: k.checkRequestedAt ? (k.checkTakenAt ? "taken" : "requested") : null,
    untracking: k.untrackRequestedAt ? (k.untrackTakenAt ? "taken" : "requested") : null,
    untrack: (k.untrack as unknown as KeyUntrack | null) ?? null,
    lastError: maskSecrets(k.lastError),
    lastErrorAt: k.lastErrorAt,
    password: pwByRef.get(vaultRef(k)) ?? "none",
    usedBy: { accounts: k.accounts.map((a) => a.label), apps: k.apps.map((a) => a.appSlug) },
    createdAt: k.createdAt,
  }));
}

// ───────── 만들기·등록·고치기·지우기·조회 (통제실) ─────────

async function samePathExists(path: string, alias: string) {
  const all = await prisma.factoryKey.findMany({ select: { id: true, name: true, keystorePath: true, keyAlias: true } });

  return all.find((k) => normPath(k.keystorePath) === normPath(path) && k.keyAlias === alias) ?? null;
}

/** 새 항목의 비밀번호 구분값. 경로를 옮긴 다른 키가 이 값을 이미 쓰고 있으면 겹치지 않는 값으로 */
async function freshRef(path: string, alias: string): Promise<string> {
  const base = keyRefOf(path, alias);
  const used = (await prisma.factoryKey.findMany({ select: { passwordRef: true, keystorePath: true, keyAlias: true } })).map(vaultRef);

  return used.includes(base) ? keyRefOf(`${path}#${Date.now()}`, alias) : base;
}

function checkName(v: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const name = clean(v, 60);

  return name ? { ok: true, value: name } : { ok: false, message: "이름(별명)이 필요해요." };
}

/** 기본 경로에 쓸 파일 이름(영문·숫자·-_ 만) */
export const defaultKeyFile = (name: string) => `~/keys/${name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "upload"}.jks`;

/**
 * [새 공용 키 만들기]: 보관함 항목을 만들고 비밀번호를 등록한 뒤, PC 가 keytool 로 만들도록 요청한다.
 * 비밀번호는 한 번만 받아 키 저장소·키 비밀번호에 같이 쓴다(password2 는 확인용).
 */
export async function createSharedKey(input: Record<string, unknown>): Promise<Res> {
  const name = checkName(input.name);

  if ("message" in name) return bad(name.message);
  const path = checkKeyPath(clean(input.keystorePath, 300) ?? defaultKeyFile(name.value));

  if ("message" in path) return bad(path.message);
  const alias = clean(input.keyAlias, 64) ?? DEFAULT_KEY_ALIAS;

  if (!ALIAS_RE.test(alias)) return bad("별칭은 영문·숫자·. _ - 로 64자 이내예요.");
  const dname = clean(input.dname, 80);

  if (dname && !/^[0-9A-Za-z가-힣 ._-]+$/.test(dname)) return bad("인증서 이름에는 글자·숫자·공백·. _ - 만 쓸 수 있어요.");
  if (typeof input.password !== "string" || input.password !== input.password2) return bad("비밀번호 두 칸이 서로 달라요.");
  if (await prisma.factoryKey.findUnique({ where: { name: name.value }, select: { id: true } })) return bad("같은 이름의 키가 이미 있어요.", 409);
  const dup = await samePathExists(path.value, alias);

  if (dup) return bad(`같은 경로·별칭의 키가 이미 보관함에 있어요(${dup.name}).`, 409);
  const ref = await freshRef(path.value, alias);
  const pw = await registerKeyPassword(path.value, alias, input.password, input.password, ref);

  if (!pw.ok) return pw;
  await prisma.factoryKey.create({
    data: {
      name: name.value,
      passwordRef: ref,
      kind: "shared",
      keystorePath: path.value,
      keyAlias: alias,
      dname,
      description: clean(input.description, 1000),
      createState: "requested",
    },
  });

  return {
    ok: true,
    status: 200,
    message: `'${name.value}' 공용 키 만들기를 요청했어요. 작업 PC 가 15초 안에 keytool 로 만들어요(파일이 이미 있으면 덮어쓰지 않고 멈춰요).`,
  };
}

/** [기존 키 등록]: 파일은 만들거나 옮기거나 바꾸지 않는다. 비밀번호를 등록하고 바로 조회를 요청한다. */
export async function registerExistingKey(input: Record<string, unknown>): Promise<Res> {
  const name = checkName(input.name);

  if ("message" in name) return bad(name.message);
  const path = checkKeyPath(input.keystorePath);

  if ("message" in path) return bad(path.message);
  const alias = clean(input.keyAlias, 64) ?? DEFAULT_KEY_ALIAS;

  if (!ALIAS_RE.test(alias)) return bad("별칭은 영문·숫자·. _ - 로 64자 이내예요.");
  if (await prisma.factoryKey.findUnique({ where: { name: name.value }, select: { id: true } })) return bad("같은 이름의 키가 이미 있어요.", 409);
  const dup = await samePathExists(path.value, alias);

  if (dup) return bad(`같은 경로·별칭의 키가 이미 보관함에 있어요(${dup.name}).`, 409);
  const ref = await freshRef(path.value, alias);
  const pw = await registerKeyPassword(path.value, alias, input.storePassword, input.keyPassword, ref);

  if (!pw.ok) return pw;
  await prisma.factoryKey.create({
    data: {
      name: name.value,
      passwordRef: ref,
      kind: isKind(input.kind) ? input.kind : "app",
      keystorePath: path.value,
      keyAlias: alias,
      description: clean(input.description, 1000),
      production: input.production === true,
      checkRequestedAt: new Date(),
    },
  });

  return { ok: true, status: 200, message: `'${name.value}' 키를 등록했어요. 작업 PC 가 파일을 확인해 결과를 보여 줘요.` };
}

/**
 * 이름·종류·설명·운영 키 표시, 경로(파일을 옮긴 뒤)를 바꾼다. 별칭은 바꾸지 않는다(다른 키면 새로 등록).
 * 경로를 바꿔도 비밀번호는 이어진다(passwordRef 에 처음 구분값을 남김). 운영 키도 경로는 바꿀 수 있다(파일은 건드리지 않음).
 */
export async function updateKey(id: string, input: Record<string, unknown>): Promise<Res> {
  const cur = await prisma.factoryKey.findUnique({ where: { id } });

  if (!cur) return bad("없는 키예요.", 404);
  const data: Prisma.FactoryKeyUpdateInput = {};

  if (input.name !== undefined) {
    const name = checkName(input.name);

    if ("message" in name) return bad(name.message);
    const other = await prisma.factoryKey.findUnique({ where: { name: name.value }, select: { id: true } });

    if (other && other.id !== id) return bad("같은 이름의 키가 이미 있어요.", 409);
    data.name = name.value;
  }
  if (input.kind !== undefined) {
    if (!isKind(input.kind)) return bad("종류는 공용 키 또는 기존 앱 키예요.");
    data.kind = input.kind;
  }
  if (input.description !== undefined) data.description = clean(input.description, 1000);
  if (input.production !== undefined) data.production = input.production === true;
  let moved: string | null = null;

  if (input.keystorePath !== undefined) {
    const path = checkKeyPath(input.keystorePath);

    if ("message" in path) return bad(path.message);
    if (normPath(path.value) !== normPath(cur.keystorePath)) {
      const dup = await samePathExists(path.value, cur.keyAlias);

      if (dup) return bad(`같은 경로·별칭의 키가 이미 보관함에 있어요(${dup.name}).`, 409);
      moved = path.value;
      data.keystorePath = moved;
      data.passwordRef = vaultRef(cur);
      // 새 경로로 다시 확인한다
      data.check = Prisma.DbNull;
      data.untrack = Prisma.DbNull;
      data.checkRequestedAt = new Date();
      data.checkTakenAt = null;
    }
  }
  await prisma.factoryKey.update({ where: { id }, data });
  if (moved) {
    // 예전 열(호환용 사본)도 맞춘다
    await prisma.factoryReleaseAccount.updateMany({ where: { defaultKeyId: id }, data: { keystorePath: moved } });
    await prisma.factoryApp.updateMany({ where: { keyId: id }, data: { customKeystorePath: moved } });

    return { ok: true, status: 200, message: "키 정보를 저장했어요. 새 경로로 다시 조회해요(비밀번호는 그대로 이어져요)." };
  }

  return { ok: true, status: 200, message: "키 정보를 저장했어요." };
}

/** 보관함 항목만 지운다(PC 파일은 절대 지우지 않음). 운영 키·사용 중인 키·만드는 중인 키는 못 지운다. */
export async function deleteKey(id: string): Promise<Res> {
  const k = await prisma.factoryKey.findUnique({
    where: { id },
    include: { accounts: { select: { label: true } }, apps: { select: { appSlug: true } } },
  });

  if (!k) return bad("없는 키예요.", 404);
  if (k.production) return bad("운영 키는 지울 수 없어요(운영 키 표시를 먼저 끄세요).", 409);
  if (k.createState === "requested" || k.createState === "creating") return bad("작업 PC 가 이 키를 만드는 중이라 지울 수 없어요.", 409);
  const used = [...k.accounts.map((a) => `계정 ${a.label}`), ...k.apps.map((a) => a.appSlug)];

  if (used.length) return bad(`쓰는 곳이 있어 지울 수 없어요: ${used.join(", ")}. 다른 키로 바꾼 뒤 지우세요.`, 409);
  await prisma.factoryKey.delete({ where: { id } });

  return { ok: true, status: 200, message: `'${k.name}' 를 보관함에서 지웠어요. PC 의 키 파일은 그대로예요.` };
}

/** [조회]: PC 가 이 키 파일을 확인하도록 요청 */
export async function requestKeyCheck(id: string): Promise<Res> {
  const k = await prisma.factoryKey.findUnique({ where: { id }, select: { name: true } });

  if (!k) return bad("없는 키예요.", 404);
  await prisma.factoryKey.update({ where: { id }, data: { checkRequestedAt: new Date(), checkTakenAt: null } });

  return { ok: true, status: 200, message: `'${k.name}' 조회를 요청했어요. 작업 PC 가 15초 안에 확인해요.` };
}

/**
 * [커밋에서 빼기]: PC 가 앱 폴더 git 에서 이 키 파일의 추적을 해제하도록 요청(운영 키도 됨: 파일은 바꾸지 않는다).
 * push·기록 삭제·파일 이동은 하지 않는다.
 */
export async function requestUntrack(id: string): Promise<Res> {
  const k = await prisma.factoryKey.findUnique({ where: { id }, select: { name: true } });

  if (!k) return bad("없는 키예요.", 404);
  await prisma.factoryKey.update({ where: { id }, data: { untrackRequestedAt: new Date(), untrackTakenAt: null } });

  return {
    ok: true,
    status: 200,
    message: `'${k.name}' 커밋에서 빼기를 요청했어요. 작업 PC 가 기록을 조사한 뒤 추적만 해제해요(파일은 그대로, push 안 함).`,
  };
}

/** 실패한 공용 키 만들기를 다시 요청(운영 키는 안 됨). 파일이 이미 있으면 PC 가 여전히 덮어쓰지 않는다. */
export async function retryCreateKey(id: string): Promise<Res> {
  const k = await prisma.factoryKey.findUnique({ where: { id } });

  if (!k) return bad("없는 키예요.", 404);
  if (k.production) return bad("운영 키는 다시 만들 수 없어요.", 409);
  if (k.kind !== "shared" || k.createState !== "failed") return bad("만들기에 실패한 공용 키만 다시 만들 수 있어요.", 409);
  await prisma.factoryKey.update({ where: { id }, data: { createState: "requested", createTakenAt: null } });

  return { ok: true, status: 200, message: "다시 만들기를 요청했어요(파일이 이미 있으면 덮어쓰지 않고 멈춰요)." };
}

/** 키 하나의 비밀번호 등록(바꾸기) */
export async function setVaultKeyPassword(id: string, storePassword: unknown, keyPassword: unknown): Promise<Res> {
  const k = await prisma.factoryKey.findUnique({ where: { id } });

  if (!k) return bad("없는 키예요.", 404);

  return registerKeyPassword(k.keystorePath, k.keyAlias, storePassword, keyPassword, vaultRef(k));
}

// ───────── 감독 프로그램 (/next 의 keyTasks → POST /api/factory/key-vault) ─────────

export interface KeyTask {
  id: string;
  op: "create" | "check" | "untrack";
  path: string;
  alias: string;
  dname: string | null;
  storeName: string; // PC secrets.env 의 비밀번호 이름(값 아님)
  keyName: string;
}

/** 내줄 일(만들기·조회). 가져간 것은 표시하고, 오래 결과가 없으면 다시 내준다. 던지지 않는다. */
export async function keyTasksForNext(): Promise<KeyTask[]> {
  try {
    const stale = new Date(Date.now() - LEASE_MS);
    const rows = await prisma.factoryKey.findMany({
      where: {
        OR: [
          { createState: "requested" },
          { createState: "creating", OR: [{ createTakenAt: null }, { createTakenAt: { lt: stale } }] },
          { checkRequestedAt: { not: null }, OR: [{ checkTakenAt: null }, { checkTakenAt: { lt: stale } }] },
          { untrackRequestedAt: { not: null }, OR: [{ untrackTakenAt: null }, { untrackTakenAt: { lt: stale } }] },
        ],
      },
      take: 10,
    });
    const now = new Date();
    const tasks: KeyTask[] = [];

    for (const k of rows) {
      const names = keySecretNames(vaultRef(k));
      const base = { id: k.id, path: k.keystorePath, alias: k.keyAlias, dname: k.dname, storeName: names.store, keyName: names.key };

      const fresh = (taken: Date | null) => !taken || taken < stale;

      if (k.createState === "requested" || (k.createState === "creating" && fresh(k.createTakenAt))) {
        await prisma.factoryKey.update({ where: { id: k.id }, data: { createState: "creating", createTakenAt: now } });
        tasks.push({ ...base, op: "create" });
      } else if (k.checkRequestedAt && fresh(k.checkTakenAt)) {
        await prisma.factoryKey.update({ where: { id: k.id }, data: { checkTakenAt: now } });
        tasks.push({ ...base, op: "check" });
      }
      // 커밋에서 빼기는 만들기·조회와 따로 낸다(같은 키에 둘 다 있을 수 있음)
      if (k.untrackRequestedAt && fresh(k.untrackTakenAt)) {
        await prisma.factoryKey.update({ where: { id: k.id }, data: { untrackTakenAt: now } });
        tasks.push({ ...base, op: "untrack" });
      }
    }

    return tasks;
  } catch (error) {
    console.error("[factory] 키 보관함 일 내주기 실패:", error);

    return [];
  }
}

/**
 * 감독 프로그램이 보낸 결과. results: [{ id, op, ok, pending?, error?, info? }]
 * - create ok: 만들어짐(info 는 확인 결과). pending: 비밀번호가 아직 PC 에 없어 다음에 다시. 실패: error(한국어, 비밀번호 가림)
 * - check: info 저장, error 가 있으면 오류로 표시
 */
export async function receiveKeyResults(results: unknown): Promise<number> {
  if (!Array.isArray(results)) return 0;
  let n = 0;

  for (const it of results.slice(0, 20)) {
    const r = it as Record<string, unknown>;
    const id = typeof r?.id === "string" ? r.id : "";
    const k = id ? await prisma.factoryKey.findUnique({ where: { id } }) : null;

    if (!k) continue;
    const error = str(r.error, 1000);
    const info = cleanCheck(r.info);
    const errData = error ? { lastError: error, lastErrorAt: new Date() } : { lastError: null, lastErrorAt: null };

    if (r.op === "create") {
      if (k.createState !== "creating") continue;
      const createState = r.pending === true ? "requested" : r.ok === true ? "done" : "failed";

      await prisma.factoryKey.update({
        where: { id },
        data: { createState, createTakenAt: null, ...(info ? { check: info as unknown as Prisma.InputJsonObject } : {}), ...errData },
      });
    } else if (r.op === "check") {
      await prisma.factoryKey.update({
        where: { id },
        data: { checkRequestedAt: null, checkTakenAt: null, ...(info ? { check: info as unknown as Prisma.InputJsonObject } : {}), ...errData },
      });
    } else if (r.op === "untrack") {
      // 결과는 따로 남기고, 다시 조회한 정보(info)가 있으면 확인 정보도 바꾼다
      await prisma.factoryKey.update({
        where: { id },
        data: {
          untrackRequestedAt: null,
          untrackTakenAt: null,
          untrack: cleanUntrack(r.result, error) as unknown as Prisma.InputJsonObject,
          ...(info ? { check: info as unknown as Prisma.InputJsonObject } : {}),
        },
      });
    } else continue;
    n++;
  }

  return n;
}
