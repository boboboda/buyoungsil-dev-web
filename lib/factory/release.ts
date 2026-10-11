// lib/factory/release.ts
// 앱 공장 출시(반자동).
// - 배포 계정 프로필 A/B: 서명 키·서비스 계정 키는 PC 파일 경로만 저장한다. 비밀번호·키 값은 서버에 두지 않는다
//   (PC 의 secrets.env 에 RELEASE_<라벨>_KEYSTORE_PASSWORD 같은 이름으로 넣고, 출시 준비 일감에만 넘긴다).
// - 앱별 출시 상태와, 출시 준비 일감(kind=release)이 만든 패키지(스토어 문구·데이터 보안·콘텐츠 등급·체크리스트·방침 초안·AAB 정보).
// - AAB 파일은 PC 에만 있고, 여기에는 경로·크기·버전·빌드 시각만 남는다.
// - 계정이 비공개 테스트가 필요하면(requiresTesting) 테스트 시작일·완료 예정일(14일)을 기록하고 텔레그램으로 알린다.
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { notifyText } from "@/lib/factory/telegram";
import { ACTIVE_STATUSES } from "@/lib/factory/jobs";
import { DEFAULT_KEY_ALIAS, keyPasswordStatuses, keyRefOf, keySecretNames } from "@/lib/factory/keyPasswords";
import { maskSecrets } from "@/lib/factory/mask";

// 출시 일감 종류. 종류마다 서버가 만드는 지시문과 허용 동작(outbox 파일·키 준비)이 다르다.
export const RELEASE_KINDS = ["first", "store", "project"] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];
export const RELEASE_KIND_LABELS: Record<ReleaseKind, string> = {
  first: "첫 출시",
  store: "스토어 자료 수정",
  project: "프로젝트 업데이트",
};
export const isReleaseKind = (v: unknown): v is ReleaseKind => typeof v === "string" && (RELEASE_KINDS as readonly string[]).includes(v);
/** 예전 일감(releaseKind 없음)은 첫 출시로 본다 */
export const releaseKindOf = (v: string | null | undefined): ReleaseKind => (isReleaseKind(v) ? v : "first");

// 출시 일감 진행 단계(.factory/phase.txt 의 한 단어). 감독 프로그램이 실패 단계로도 쓴다.
export const RELEASE_STAGE_LABELS: Record<string, string> = {
  prepare: "준비",
  scaffold: "준비",
  key: "키",
  build: "빌드",
  sign: "서명",
  store: "스토어 자료",
  icon: "아이콘·대표 이미지",
  screenshots: "스크린샷",
  video: "영상",
  listing: "문구",
  upload: "업로드",
  homepage: "홈페이지 반영",
  done: "완료",
};
export const stageLabel = (s: string | null | undefined) => (s ? (RELEASE_STAGE_LABELS[s] ?? s) : "-");
// 재시도를 이 단계부터 시작할 수 있다
const RESUMABLE = ["key", "build", "sign", "store", "icon", "screenshots", "video", "listing", "upload", "homepage"];
// 종류별로 감독 프로그램이 홈페이지로 보낼 수 있는 outbox 파일
const OUTBOX_BY_KIND: Record<ReleaseKind, string[]> = {
  first: ["project.json", "release.json"],
  store: ["release.json", "project.json"],
  project: ["project.json"],
};
// 홈페이지 프로젝트 '덮어쓰기'를 고를 수 있는 종류(첫 출시는 늘 빈 칸만 채운다)
export const OVERWRITE_KINDS: ReleaseKind[] = ["store", "project"];
// Play 업로드 트랙: 비공개 테스트(closed testing) 기본 트랙. 프로덕션은 사람이 Console 에서 '라이브러리에서 추가'로
export const PLAY_TEST_TRACK = "alpha";

export const RELEASE_STATUSES = ["preparing", "package", "review", "testing", "released"] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];
export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  preparing: "준비중",
  package: "패키지 생성",
  review: "검토",
  testing: "비공개 테스트",
  released: "출시",
};

export const TESTING_DAYS = 14;
const LABEL_RE = /^[A-Z]$/;
const DAY = 24 * 60 * 60 * 1000;

// 계정별로 PC secrets.env 에 넣을 비밀번호 키 이름(값은 PC 에만)
export const keystorePasswordName = (label: string) => `RELEASE_${label}_KEYSTORE_PASSWORD`;
export const keyPasswordName = (label: string) => `RELEASE_${label}_KEY_PASSWORD`;

const cleanStr = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();

  return t ? t.slice(0, max) : null;
};

// PC 경로처럼 보이고 확장자가 맞는지만 본다(파일 내용은 서버가 알 수 없다)
function checkPath(v: unknown, exts: string[], what: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const p = cleanStr(v, 300);

  if (!p) return { ok: true, value: null };
  if (!/^(~[\\/]|[A-Za-z]:[\\/]|\/)/.test(p)) return { ok: false, message: `${what} 경로는 ~/, C:\\, / 로 시작하는 PC 경로여야 해요.` };
  if (!exts.some((e) => p.toLowerCase().endsWith(e))) return { ok: false, message: `${what} 파일은 ${exts.join(", ")} 이어야 해요.` };

  return { ok: true, value: p };
}

// ───────── 배포 계정 ─────────

export interface AccountInput {
  label?: unknown;
  name?: unknown;
  requiresTesting?: unknown;
  developerName?: unknown;
  contactEmail?: unknown;
  keystorePath?: unknown;
  keyAlias?: unknown;
  serviceAccountKeyPath?: unknown;
  developerAccountId?: unknown;
  accountType?: unknown;
  loginEmail?: unknown;
  notes?: unknown;
}

export const ACCOUNT_TYPES = ["personal", "organization"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Play Console 앱 목록 주소(개발자 계정 ID 가 있을 때) */
export const playConsoleUrl = (developerAccountId: string | null | undefined) =>
  developerAccountId ? `https://play.google.com/console/u/0/developers/${developerAccountId}/app-list` : null;

export async function saveReleaseAccount(input: AccountInput): Promise<{ ok: boolean; status: number; message: string }> {
  const label = typeof input.label === "string" ? input.label.trim().toUpperCase() : "";

  if (!LABEL_RE.test(label)) return { ok: false, status: 400, message: "계정 라벨은 영문 대문자 한 글자예요(예: A, B)." };
  const name = cleanStr(input.name, 60);

  if (!name) return { ok: false, status: 400, message: "계정 이름이 필요해요." };
  const email = cleanStr(input.contactEmail, 120);

  if (email && !EMAIL_RE.test(email)) return { ok: false, status: 400, message: "연락 이메일 형식이 올바르지 않아요." };
  const loginEmail = cleanStr(input.loginEmail, 120);

  if (loginEmail && !EMAIL_RE.test(loginEmail)) return { ok: false, status: 400, message: "로그인 구글 이메일 형식이 올바르지 않아요." };
  // 개발자 계정 ID 는 숫자 문자열(보통 19자리). 큰 수라 숫자로 바꾸지 않고 문자열 그대로 둔다
  const devId = cleanStr(input.developerAccountId, 40)?.replace(/\s/g, "") || null;

  if (devId && !/^\d{10,25}$/.test(devId)) return { ok: false, status: 400, message: "개발자 계정 ID 는 숫자만(보통 19자리) 넣어 주세요." };
  const accountType = input.accountType === "" || input.accountType == null ? null : input.accountType;

  if (accountType !== null && !(ACCOUNT_TYPES as readonly unknown[]).includes(accountType)) {
    return { ok: false, status: 400, message: "계정 유형은 개인 또는 조직이에요." };
  }
  const ks = checkPath(input.keystorePath, [".jks", ".keystore"], "서명 키");

  if ("message" in ks) return { ok: false, status: 400, message: ks.message };
  const sa = checkPath(input.serviceAccountKeyPath, [".json"], "서비스 계정 키");

  if ("message" in sa) return { ok: false, status: 400, message: sa.message };

  const data = {
    name,
    requiresTesting: input.requiresTesting === true,
    developerName: cleanStr(input.developerName, 80),
    contactEmail: email,
    keystorePath: ks.value,
    keyAlias: cleanStr(input.keyAlias, 80),
    serviceAccountKeyPath: sa.value,
    developerAccountId: devId,
    accountType: accountType as string | null,
    loginEmail,
    notes: cleanStr(input.notes, 2000),
  };

  await prisma.factoryReleaseAccount.upsert({ where: { label }, create: { label, ...data }, update: data });

  // 서명 키를 쓰는 계정이면 비밀번호 키 "이름"을 등록해 둔다(값은 PC secrets.env 에만). 출시 준비 일감이 이 이름으로 받는다.
  if (data.keystorePath) {
    for (const [n, d] of [
      [keystorePasswordName(label), `배포 계정 ${label} 업로드 키(keystore) 비밀번호`],
      [keyPasswordName(label), `배포 계정 ${label} 업로드 키 별칭(key) 비밀번호`],
    ]) {
      await prisma.factorySecretName.upsert({ where: { name: n }, create: { name: n, description: d }, update: {} });
    }
  }

  return { ok: true, status: 200, message: `배포 계정 ${label}(${name})을 저장했어요.` };
}

// ───────── PC 파일 준비 상태 (감독 프로그램이 존재 여부만 알려 준다) ─────────

const PC_STATUS_KEY = "pcPathStatus";

export interface PcPathItem {
  key: string; // 예: "A.keystore", "A.serviceAccount"
  path: string;
  exists: boolean;
  size: number | null;
  mtime: string | null;
}

/** 감독 프로그램에게 확인을 부탁할 경로 목록(값이 아니라 경로만). */
export async function pcPathsToCheck(): Promise<{ key: string; path: string }[]> {
  const accounts = await prisma.factoryReleaseAccount.findMany({ orderBy: { label: "asc" } });
  const out: { key: string; path: string }[] = [];

  for (const a of accounts) {
    if (a.keystorePath) out.push({ key: `${a.label}.keystore`, path: a.keystorePath });
    if (a.serviceAccountKeyPath) out.push({ key: `${a.label}.serviceAccount`, path: a.serviceAccountKeyPath });
  }
  // 앱별 '다른 키'
  const custom = await prisma.factoryApp.findMany({ where: { customKeystorePath: { not: null } }, select: { appSlug: true, customKeystorePath: true } });

  for (const c of custom.slice(0, 10)) if (c.customKeystorePath) out.push({ key: `app:${c.appSlug}.keystore`, path: c.customKeystorePath });

  return out;
}

/** 감독 프로그램이 보낸 확인 결과. 지금 등록된 경로와 맞는 것만 저장한다. */
export async function savePcPathStatus(items: unknown): Promise<number> {
  if (!Array.isArray(items)) return 0;
  const wanted = new Map((await pcPathsToCheck()).map((w) => [w.key, w.path]));
  const clean: PcPathItem[] = [];

  for (const it of items.slice(0, 20)) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const key = typeof r.key === "string" ? r.key : "";

    if (!wanted.has(key) || r.path !== wanted.get(key)) continue;
    clean.push({
      key,
      path: wanted.get(key) as string,
      exists: r.exists === true,
      size: typeof r.size === "number" && Number.isFinite(r.size) ? r.size : null,
      mtime: typeof r.mtime === "string" ? r.mtime.slice(0, 40) : null,
    });
  }
  const value = JSON.stringify({ at: new Date().toISOString(), items: clean });

  await prisma.factorySetting.upsert({ where: { key: PC_STATUS_KEY }, create: { key: PC_STATUS_KEY, value }, update: { value } });

  return clean.length;
}

async function getPcPathStatus(): Promise<{ at: string; items: PcPathItem[] } | null> {
  const row = await prisma.factorySetting.findUnique({ where: { key: PC_STATUS_KEY } });

  if (!row) return null;
  try {
    return JSON.parse(row.value) as { at: string; items: PcPathItem[] };
  } catch {
    return null;
  }
}

// ───────── 키 점검 (감독 프로그램이 앱 폴더의 .jks·key.properties 를 찾아 경로·별칭·SHA-1 만 보고) ─────────

const KEY_SCAN_REQUEST = "keyScanRequest";
const KEY_SCAN_RESULT = "keyScanResult";

export interface KeyScanApp {
  appSlug: string;
  keys: { path: string; type: string; aliases: { alias: string; sha1: string | null }[]; gitTracked: boolean | null; note?: string | null }[];
  keyProperties: { path: string; storeFile: string | null; keyAlias: string | null; gitTracked: boolean | null }[];
}

/** 통제실 [키 점검]: 다음 /next 응답에 keyScan: true 를 한 번 붙인다 */
export async function requestKeyScan(): Promise<{ ok: boolean; status: number; message: string }> {
  const value = new Date().toISOString();

  await prisma.factorySetting.upsert({ where: { key: KEY_SCAN_REQUEST }, create: { key: KEY_SCAN_REQUEST, value }, update: { value } });

  return { ok: true, status: 200, message: "키 점검을 요청했어요. 작업 PC 가 15초 안에 가져가 결과를 보내요(잠시 뒤 새로고침)." };
}

/** /next 에서 부른다. 요청이 있으면 지우고 true */
export async function consumeKeyScan(): Promise<boolean> {
  const res = await prisma.factorySetting.deleteMany({ where: { key: KEY_SCAN_REQUEST } });

  return res.count > 0;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : null);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);

export async function saveKeyScan(body: unknown): Promise<number> {
  const appsIn = (body as { apps?: unknown })?.apps;

  if (!Array.isArray(appsIn)) return 0;
  const apps: KeyScanApp[] = [];

  for (const a of appsIn.slice(0, 100)) {
    const r = a as Record<string, unknown>;
    const appSlug = str(r?.appSlug, 60);

    if (!appSlug) continue;
    const keys = (Array.isArray(r.keys) ? r.keys : []).slice(0, 20).map((k: Record<string, unknown>) => ({
      path: str(k?.path, 300) ?? "",
      type: str(k?.type, 20) ?? "?",
      aliases: (Array.isArray(k?.aliases) ? k.aliases : []).slice(0, 10).map((x: Record<string, unknown>) => ({
        alias: str(x?.alias, 80) ?? "",
        sha1: typeof x?.sha1 === "string" && /^[0-9A-F:]{40,59}$/.test(x.sha1) ? x.sha1 : null,
      })),
      gitTracked: bool(k?.gitTracked),
      note: str(k?.note, 200),
    }));
    const keyProperties = (Array.isArray(r.keyProperties) ? r.keyProperties : []).slice(0, 10).map((k: Record<string, unknown>) => ({
      path: str(k?.path, 300) ?? "",
      storeFile: str(k?.storeFile, 300),
      keyAlias: str(k?.keyAlias, 80),
      gitTracked: bool(k?.gitTracked),
    }));

    apps.push({ appSlug, keys, keyProperties });
  }
  const value = JSON.stringify({ at: new Date().toISOString(), apps });

  await prisma.factorySetting.upsert({ where: { key: KEY_SCAN_RESULT }, create: { key: KEY_SCAN_RESULT, value }, update: { value } });

  return apps.length;
}

/** 마지막 키 점검 결과와, 아직 PC 가 가져가지 않은 요청 시각 */
async function getKeyScan(): Promise<{ at: string | null; apps: KeyScanApp[]; requestedAt: string | null }> {
  const [row, req] = await Promise.all([
    prisma.factorySetting.findUnique({ where: { key: KEY_SCAN_RESULT } }),
    prisma.factorySetting.findUnique({ where: { key: KEY_SCAN_REQUEST } }),
  ]);
  let saved: { at: string; apps: KeyScanApp[] } | null = null;

  try {
    saved = row ? (JSON.parse(row.value) as { at: string; apps: KeyScanApp[] }) : null;
  } catch {
    saved = null;
  }

  return { at: saved?.at ?? null, apps: saved?.apps ?? [], requestedAt: req?.value ?? null };
}

// ───────── 앱이 쓸 업로드 키 ─────────

type AccountRow = { label: string; name: string; developerName: string | null; keystorePath: string | null; keyAlias: string | null };
type AppKeyRow = { customKeystorePath: string | null; customKeyAlias: string | null };

/** 앱별 '다른 키'가 있으면 그것, 없으면 배포 계정 공용 키. 둘 다 없으면 null */
export function effectiveKey(app: AppKeyRow | null, acc: AccountRow | null) {
  if (app?.customKeystorePath) {
    const alias = app.customKeyAlias || DEFAULT_KEY_ALIAS;

    return { source: "custom" as const, path: app.customKeystorePath, alias, ref: keyRefOf(app.customKeystorePath, alias) };
  }
  if (acc?.keystorePath) {
    const alias = acc.keyAlias || DEFAULT_KEY_ALIAS;

    return { source: "account" as const, path: acc.keystorePath, alias, ref: keyRefOf(acc.keystorePath, alias) };
  }

  return null;
}

// ───────── Play 업로드 전제 조건 ─────────

/**
 * Play Developer API 업로드(스토어 자료·업데이트 AAB) 전에 필요한 것. 모자란 것을 한국어로 돌려준다(비면 업로드 가능).
 * 서비스 계정 키는 경로만 본다. 파일이 PC 에 있는지는 감독 프로그램이 마지막으로 알려 준 결과(pcStatus)와, 업로드 직전 감독 프로그램이 다시 확인한다.
 */
export function playUploadMissing(
  app: { packageName: string | null; firstUploadDone: boolean } | null,
  acc: { label: string; serviceAccountKeyPath: string | null } | null,
  pcItems?: PcPathItem[] | null,
): string[] {
  const missing: string[] = [];

  if (!acc) missing.push("배포 계정이 정해지지 않았어요");
  else if (!acc.serviceAccountKeyPath) missing.push(`배포 계정 ${acc.label} 에 서비스 계정 키(JSON) 경로가 없어요`);
  else {
    const pc = pcItems?.find((i) => i.key === `${acc.label}.serviceAccount` && i.path === acc.serviceAccountKeyPath);

    if (pc && !pc.exists) missing.push(`서비스 계정 키 파일이 작업 PC 에 없어요(${acc.serviceAccountKeyPath})`);
  }
  if (!app?.packageName) missing.push("패키지 이름이 없어요");
  if (!app?.firstUploadDone) missing.push("'최초 AAB 업로드 완료'가 체크되지 않았어요(최초 업로드는 Play Console 에서 직접)");

  return missing;
}

// ───────── 앱별 출시 상태 ─────────

/** 통제실 "출시 패키지" 화면에 필요한 것 전부. 키 값은 없다(경로·이름·존재 여부만). */
export async function releaseOverview() {
  const [accounts, apps, jobs, pcStatus, secretNames, keyPasswords, keyScan] = await Promise.all([
    prisma.factoryReleaseAccount.findMany({ orderBy: { label: "asc" } }),
    prisma.factoryApp.findMany(),
    prisma.factoryJob.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        appSlug: true,
        title: true,
        kind: true,
        stack: true,
        status: true,
        createdAt: true,
        finishedAt: true,
        releaseKind: true,
        phase: true,
        failStage: true,
        failReason: true,
        resumeFrom: true,
        overwriteProject: true,
      },
    }),
    getPcPathStatus(),
    prisma.factorySecretName.findMany({ select: { name: true } }),
    keyPasswordStatuses(),
    getKeyScan(),
  ]);
  const appBySlug = new Map(apps.map((a) => [a.appSlug, a]));
  const names = new Set(secretNames.map((s) => s.name));
  const pwByRef = new Map(keyPasswords.map((k) => [k.keyRef, k]));
  const seen = new Set<string>();
  const rows = [];
  // 마지막 출시 일감의 최근 로그(마스킹). 진행 중이거나 실패한 것만
  const lastRelease = new Map<string, (typeof jobs)[number]>();

  for (const j of jobs) if (j.kind === "release" && !lastRelease.has(j.appSlug)) lastRelease.set(j.appSlug, j);
  const logJobs = [...lastRelease.values()].filter((j) => j.status === "running" || j.status === "failed").slice(0, 30);
  const logs = new Map(
    await Promise.all(
      logJobs.map(async (j) => {
        const rows = await prisma.factoryJobLog.findMany({ where: { jobId: j.id }, orderBy: { id: "desc" }, take: 8, select: { at: true, level: true, message: true } });

        return [j.id, rows.reverse().map((l) => ({ ...l, message: maskSecrets(l.message).slice(0, 400) }))] as const;
      }),
    ),
  );

  for (const j of jobs) {
    if (seen.has(j.appSlug)) continue;
    seen.add(j.appSlug);
    const mine = jobs.filter((x) => x.appSlug === j.appSlug);
    const app = appBySlug.get(j.appSlug);
    const removedAt = app?.releaseRemovedAt ?? null;

    // 목록에서 지운 앱은 그 뒤에 새 일감이 생기기 전까지 숨긴다(지시 기록은 그대로 남아 있다)
    if (removedAt && !mine.some((x) => x.createdAt > removedAt)) continue;
    const lastRelease = mine.find((x) => x.kind === "release" && (!removedAt || x.createdAt > removedAt)) ?? null;
    const account = accounts.find((a) => a.id === app?.releaseAccountId) ?? null;
    const key = effectiveKey(app ?? null, account);
    const pw = key ? pwByRef.get(key.ref) : undefined;

    rows.push({
      appSlug: j.appSlug,
      title: mine.find((x) => x.kind === "new")?.title ?? j.title,
      stack: j.stack,
      done: mine.some((x) => x.status === "done"),
      active: mine.some((x) => ["pending", "approved", "running"].includes(x.status)),
      releaseAccountId: app?.releaseAccountId ?? null,
      releaseStatus: (app?.releaseStatus ?? "preparing") as ReleaseStatus,
      packageName: app?.packageName ?? null,
      firstUploadDone: app?.firstUploadDone ?? false,
      testingStartedAt: app?.testingStartedAt ?? null,
      testingDueAt: app?.testingDueAt ?? null,
      releasePackage: app?.releasePackage ?? null,
      releasePackageAt: app?.releasePackageAt ?? null,
      releasePackageJob: app?.releasePackageJob ?? null,
      aab: app?.aab ?? null,
      customKeystorePath: app?.customKeystorePath ?? null,
      customKeyAlias: app?.customKeyAlias ?? null,
      promoVideoUrl: app?.promoVideoUrl ?? null,
      storeAssets: app?.storeAssets ?? null,
      // Play 업로드(스토어 자료·업데이트 AAB)에 모자란 것. 비면 업로드 가능
      playMissing: playUploadMissing(app ?? null, account, pcStatus?.items),
      // 이 앱이 쓸 업로드 키(앱 폴더에 key.properties 가 있으면 PC 가 그걸 먼저 쓴다)와 비밀번호 등록 상태(값 없음)
      key: key ? { source: key.source, path: key.path, alias: key.alias, password: pw?.state ?? "none" } : null,
      keyScan: keyScan.apps.find((s) => s.appSlug === j.appSlug) ?? null,
      lastReleaseJob: lastRelease
        ? {
            id: lastRelease.id,
            status: lastRelease.status,
            finishedAt: lastRelease.finishedAt,
            releaseKind: releaseKindOf(lastRelease.releaseKind),
            phase: lastRelease.phase,
            phaseLabel: stageLabel(lastRelease.phase),
            failStage: lastRelease.status === "failed" ? (lastRelease.failStage ?? lastRelease.phase) : null,
            failStageLabel: lastRelease.status === "failed" ? stageLabel(lastRelease.failStage ?? lastRelease.phase) : null,
            failReason: lastRelease.status === "failed" ? maskSecrets(lastRelease.failReason)?.slice(0, 1500) ?? null : null,
            resumeFrom: lastRelease.resumeFrom,
            overwriteProject: lastRelease.overwriteProject,
            logs: logs.get(lastRelease.id) ?? [],
          }
        : null,
    });
  }

  return {
    statuses: RELEASE_STATUSES.map((s) => ({ value: s, label: RELEASE_STATUS_LABELS[s] })),
    kinds: RELEASE_KINDS.map((k) => ({ value: k, label: RELEASE_KIND_LABELS[k], canOverwrite: OVERWRITE_KINDS.includes(k) })),
    testingDays: TESTING_DAYS,
    accounts: accounts.map((a) => {
      const key = effectiveKey(null, a);

      return {
        ...a,
        playConsoleUrl: playConsoleUrl(a.developerAccountId),
        secretNames: { keystore: keystorePasswordName(a.label), key: keyPasswordName(a.label) },
        secretNamesRegistered: names.has(keystorePasswordName(a.label)) && names.has(keyPasswordName(a.label)),
        keyPassword: key ? (pwByRef.get(key.ref)?.state ?? "none") : null,
      };
    }),
    pcStatus,
    keyPasswords,
    keyScan,
    apps: rows,
  };
}

export interface AppReleaseInput {
  releaseAccountId?: unknown;
  releaseStatus?: unknown;
  packageName?: unknown;
  firstUploadDone?: unknown;
  customKeystorePath?: unknown;
  customKeyAlias?: unknown;
}

const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

export async function updateAppRelease(appSlug: string, input: AppReleaseInput): Promise<{ ok: boolean; status: number; message: string }> {
  const hasJob = await prisma.factoryJob.findFirst({ where: { appSlug }, select: { id: true } });

  if (!hasJob) return { ok: false, status: 404, message: "그런 공장 앱이 없어요." };
  const cur = await prisma.factoryApp.findUnique({ where: { appSlug } });
  const data: Record<string, unknown> = {};

  if (input.releaseAccountId !== undefined) {
    if (input.releaseAccountId === null || input.releaseAccountId === "") data.releaseAccountId = null;
    else if (typeof input.releaseAccountId === "string" && (await prisma.factoryReleaseAccount.findUnique({ where: { id: input.releaseAccountId } }))) {
      data.releaseAccountId = input.releaseAccountId;
    } else return { ok: false, status: 400, message: "없는 배포 계정이에요." };
  }
  if (input.packageName !== undefined) {
    const pkg = cleanStr(input.packageName, 150);

    if (pkg && !PACKAGE_RE.test(pkg)) return { ok: false, status: 400, message: "패키지 이름 형식이 올바르지 않아요(예: com.factory.my_app)." };
    data.packageName = pkg;
  }
  if (input.firstUploadDone !== undefined) data.firstUploadDone = input.firstUploadDone === true;
  // 앱별 '다른 키 사용'(비우면 배포 계정 공용 키). 경로만 저장한다
  if (input.customKeystorePath !== undefined) {
    const ks = checkPath(input.customKeystorePath, [".jks", ".keystore"], "다른 키");

    if ("message" in ks) return { ok: false, status: 400, message: ks.message };
    data.customKeystorePath = ks.value;
  }
  if (input.customKeyAlias !== undefined) data.customKeyAlias = cleanStr(input.customKeyAlias, 80);

  let startedTesting = false;

  if (input.releaseStatus !== undefined) {
    if (typeof input.releaseStatus !== "string" || !(RELEASE_STATUSES as readonly string[]).includes(input.releaseStatus)) {
      return { ok: false, status: 400, message: "출시 상태 값이 올바르지 않아요." };
    }
    data.releaseStatus = input.releaseStatus;
    // 비공개 테스트로 처음 바꾸면, 테스트가 필요한 계정일 때 시작일·완료 예정일을 남긴다
    const accountId = (data.releaseAccountId as string | null | undefined) ?? cur?.releaseAccountId ?? null;
    const account = accountId ? await prisma.factoryReleaseAccount.findUnique({ where: { id: accountId } }) : null;

    if (input.releaseStatus === "testing" && account?.requiresTesting && !cur?.testingStartedAt) {
      const now = new Date();

      data.testingStartedAt = now;
      data.testingDueAt = new Date(now.getTime() + TESTING_DAYS * DAY);
      data.testingNotifiedAt = null;
      startedTesting = true;
    }
  }

  await prisma.factoryApp.upsert({ where: { appSlug }, create: { appSlug, ...data }, update: data });

  if (startedTesting) {
    const due = (data.testingDueAt as Date).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });

    await notifyText(`🧪 비공개 테스트 시작\n${appSlug} · 완료 예정일 ${due} (${TESTING_DAYS}일)\n테스터 12명 이상이 계속 참여 중인지 확인하세요.`);
  }

  return { ok: true, status: 200, message: startedTesting ? `저장했어요. 비공개 테스트 완료 예정일: ${TESTING_DAYS}일 뒤` : "저장했어요." };
}

/**
 * 출시 패키지 목록에서 지운다. 출시 쪽 데이터(상태·배포 계정·패키지 이름·테스트 일정·패키지·AAB 정보)만 비우고
 * 숨김 표시를 남긴다. 공장 지시 기록·홈페이지 프로젝트 연결·앱 소스·PC 파일(AAB·키)은 건드리지 않는다.
 */
export async function removeAppRelease(appSlugs: string[]): Promise<{ ok: boolean; status: number; message: string }> {
  const slugs = [...new Set(appSlugs)];

  if (slugs.length === 0) return { ok: false, status: 400, message: "지울 앱을 고르세요." };
  const jobs = await prisma.factoryJob.findMany({ where: { appSlug: { in: slugs } }, select: { appSlug: true, status: true } });
  const missing = slugs.filter((s) => !jobs.some((j) => j.appSlug === s));

  if (missing.length) return { ok: false, status: 404, message: `그런 공장 앱이 없어요: ${missing.join(", ")}` };
  const busy = slugs.filter((s) => jobs.some((j) => j.appSlug === s && ["pending", "approved", "running"].includes(j.status)));

  if (busy.length) return { ok: false, status: 409, message: `진행 중 일감이 있어요: ${busy.join(", ")}` };

  const data = {
    releaseAccountId: null,
    releaseStatus: "preparing",
    packageName: null,
    firstUploadDone: false,
    testingStartedAt: null,
    testingDueAt: null,
    testingNotifiedAt: null,
    releasePackage: Prisma.DbNull,
    releasePackageAt: null,
    releasePackageJob: null,
    aab: Prisma.DbNull,
    releaseRemovedAt: new Date(),
  };

  await prisma.$transaction(slugs.map((appSlug) => prisma.factoryApp.upsert({ where: { appSlug }, create: { appSlug, ...data }, update: data })));

  return { ok: true, status: 200, message: `출시 패키지 목록에서 지웠어요: ${slugs.join(", ")}` };
}

/** 완료 예정일이 지난 비공개 테스트를 한 번씩 알린다. /next 에서 가끔 부른다. 던지지 않는다. */
let lastDueCheck = 0;

export async function notifyTestingDue(): Promise<void> {
  if (Date.now() - lastDueCheck < 10 * 60 * 1000) return;
  lastDueCheck = Date.now();
  try {
    const due = await prisma.factoryApp.findMany({
      where: { releaseStatus: "testing", testingDueAt: { lte: new Date() }, testingNotifiedAt: null },
    });

    for (const a of due) {
      await prisma.factoryApp.update({ where: { appSlug: a.appSlug }, data: { testingNotifiedAt: new Date() } });
      await notifyText(`⏰ 비공개 테스트 ${TESTING_DAYS}일 경과\n${a.appSlug}\nPlay Console 에서 프로덕션 출시 신청(라이브러리에서 추가)을 진행할 수 있어요.`);
    }
  } catch (error) {
    console.error("[factory] 테스트 완료 예정 알림 실패:", error);
  }
}

// ───────── 출시 준비 일감이 보낸 패키지 받기 (감독 프로그램 → POST /api/factory/release) ─────────

const MAX_TEXT = 20_000;

function sanitize(v: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (typeof v === "string") return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, MAX_TEXT);
  if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => sanitize(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};

    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 100)) out[k.slice(0, 60)] = sanitize(x, depth + 1);

    return out;
  }

  return null;
}

const PACKAGE_KEYS = ["storeListing", "dataSafety", "contentRating", "checklist", "privacyPolicyDraft", "sdks", "notes"] as const;

export async function receiveReleasePackage(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; message: string }> {
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const job = jobId
    ? await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { appSlug: true, kind: true, status: true, releaseKind: true } })
    : null;

  if (!job) return { ok: false, status: 404, message: "없는 지시입니다." };
  if (job.kind !== "release") return { ok: false, status: 400, message: "출시 준비 일감만 패키지를 보낼 수 있어요." };
  if (job.status !== "running") return { ok: false, status: 409, message: `지시가 실행 중이 아닙니다(${job.status}).` };
  const kind = releaseKindOf(job.releaseKind);

  if (!OUTBOX_BY_KIND[kind].includes("release.json")) {
    return { ok: false, status: 400, message: `${RELEASE_KIND_LABELS[kind]} 일감은 출시 패키지를 보낼 수 없어요.` };
  }

  const cur = await prisma.factoryApp.findUnique({ where: { appSlug: job.appSlug } });
  // 스토어 자료 수정은 보낸 항목만 바꾸고 나머지(데이터 보안·콘텐츠 등급 등)는 그대로 둔다
  const pkg: Record<string, unknown> =
    kind === "store" && cur?.releasePackage && typeof cur.releasePackage === "object" && !Array.isArray(cur.releasePackage)
      ? { ...(cur.releasePackage as Record<string, unknown>) }
      : {};

  for (const k of PACKAGE_KEYS) if (body[k] !== undefined) pkg[k] = sanitize(body[k]);
  if (JSON.stringify(pkg).length > 200_000) return { ok: false, status: 413, message: "패키지가 너무 커요(200KB 이하)." };

  let aab: Prisma.InputJsonObject | null = null;
  // AAB 정보는 첫 출시 일감에서만 받는다
  const a = kind === "first" ? (body.aab as Record<string, unknown> | undefined) : undefined;

  if (a && typeof a === "object" && typeof a.path === "string") {
    aab = {
      path: a.path.slice(0, 300),
      size: typeof a.size === "number" ? a.size : null,
      versionName: typeof a.versionName === "string" ? a.versionName.slice(0, 40) : null,
      versionCode: typeof a.versionCode === "number" ? a.versionCode : null,
      builtAt: typeof a.builtAt === "string" ? a.builtAt.slice(0, 40) : null,
    };
  }

  const data = {
    releasePackage: pkg as Prisma.InputJsonObject,
    releasePackageAt: new Date(),
    releasePackageJob: jobId,
    ...(aab ? { aab } : {}),
    ...(!cur || cur.releaseStatus === "preparing" ? { releaseStatus: "package" } : {}),
  };

  await prisma.factoryApp.upsert({ where: { appSlug: job.appSlug }, create: { appSlug: job.appSlug, ...data }, update: data });

  return { ok: true, status: 200, message: `출시 패키지를 저장했어요${aab ? "(AAB 정보 포함)" : ""}.` };
}

// ───────── 출시 일감 기획서 (종류별) ─────────

const STAGES_BY_KIND: Record<ReleaseKind, string[]> = {
  first: ["key", "build", "sign", "store", "upload", "homepage"],
  store: ["store", "homepage"],
  project: ["homepage"],
};

function stageSection(kind: ReleaseKind): string {
  return [
    "## 진행 단계와 실패 알림",
    `- 단계가 바뀔 때마다 \`.factory/phase.txt\` 에 한 단어를 덮어쓰세요: ${STAGES_BY_KIND[kind].join(", ")} (끝나면 done).`,
    '- 더 진행할 수 없으면(빌드·서명 실패 등) `.factory/fail.json` 에 {"stage": "build", "reason": "한국어 한두 문장"} 을 쓰고 끝내세요.',
    "  감독 프로그램이 이걸 보고 그 단계 실패로 알려요. 이유에 비밀번호·키 값은 절대 쓰지 마세요.",
  ].join("\n");
}

/**
 * 출시 일감(kind=release)에 넣을 지시문. 계정·경로·이름만 들어가고 값은 없다.
 * - first(첫 출시): 키 준비, AAB 빌드, 스토어 문구·체크리스트, 홈페이지 프로젝트 빈 칸 채우기(+기존 조건의 비공개 테스트 업로드)
 * - store(스토어 자료 수정): .factory/store/ 에 아이콘·대표 이미지·스크린샷·영상·문구. Play 업로드·홈페이지 반영은 감독 프로그램이
 * - project(프로젝트 업데이트): 홈페이지 프로젝트 정보만. Play 업로드·AAB 금지
 * store/project 는 opts.overwriteProject 면 홈페이지 프로젝트 기존 값도 덮어쓴다(개인정보처리방침 제외).
 * 키 비밀번호는 requiredSecrets 로 넘기지 않는다. 감독 프로그램이 /next 의 job.release.key 를 보고 필요할 때만 secrets.env 에서 읽는다.
 */
export async function buildReleasePlan(
  appSlug: string,
  kindArg: ReleaseKind = "first",
  opts: { overwriteProject?: boolean } = {},
): Promise<{ ok: true; plan: string; requiredSecrets: string[] } | { ok: false; message: string }> {
  const kind = releaseKindOf(kindArg);
  const app = await prisma.factoryApp.findUnique({ where: { appSlug }, include: { releaseAccount: true } });
  const acc = app?.releaseAccount ?? null;

  if (!acc) return { ok: false, message: "먼저 출시 패키지 화면에서 이 앱의 배포 계정을 고르세요." };

  const head = [
    `# ${RELEASE_KIND_LABELS[kind]} (${appSlug})`,
    "",
    "## 배포 계정",
    `- 계정 ${acc.label}: ${acc.name}${acc.accountType ? ` (${acc.accountType === "organization" ? "조직" : "개인"})` : ""}`,
    `- 개발자 이름: ${acc.developerName ?? "(미정: 체크리스트에 남기기)"}`,
    `- 연락 이메일: ${acc.contactEmail ?? "(미정: 체크리스트에 남기기)"}`,
    `- 비공개 테스트 필요: ${acc.requiresTesting ? "예(테스터 12명·14일). 체크리스트에 넣기" : "아니요"}`,
    `- 패키지 이름(applicationId): ${app?.packageName ?? "(미정: 지금 앱 설정의 applicationId 를 쓰고 release.json notes 에 적기)"}`,
    "",
  ];

  const overwrite = opts.overwriteProject === true && OVERWRITE_KINDS.includes(kind);
  const projectRule = overwrite
    ? "홈페이지 프로젝트 **덮어쓰기**가 선택됐어요: description·techStack(그리고 서버가 가진 대표 이미지→coverImage, 출시된 앱이면 Play 주소→appLink)이 기존 값을 바꿔요. 개인정보처리방침은 빈 칸일 때만 채워요."
    : "홈페이지 프로젝트는 **빈 칸만** 채워져요(이미 있는 값은 그대로).";

  if (kind === "store") {
    const lines = [
      ...head,
      "이 지시는 **스토어 자료만** 다시 만드는 일이에요. 앱 코드·빌드 설정은 바꾸지 마세요(스크린샷용 디버그 빌드는 괜찮아요).",
      "기준 폴더는 앱 폴더의 `.factory/store/` 예요. 파일 이름은 아래 그대로 쓰세요(감독 프로그램이 이 이름만 검사·업로드해요).",
      "",
      "## 단계 icon: 아이콘·대표 이미지 (코드로 생성)",
      "- `icon-512.png`: 512x512 PNG(투명 허용), 1MB 이하. 앱의 기존 런처 아이콘(android/app/src/main/res/mipmap-*/ic_launcher*.png, assets 의 아이콘, flutter_launcher_icons 설정)이 있으면 그걸 키워서/다듬어 쓰세요.",
      "- `feature-1024x500.png`: 1024x500, **투명(알파) 없는 PNG**. 앱 이름·한 줄 소개·아이콘을 앱의 테마 색(ThemeData/colors.xml/tailwind 등)으로 배치.",
      "- 이미지는 이 PC 에 있는 도구로 코드로 만드세요(예: Python Pillow, Node + 헤드리스 Chrome 스크린샷, ffmpeg). 설치가 필요하면 앱 폴더 밖 임시 폴더에.",
      "",
      "## 단계 screenshots: 스크린샷 (에뮬레이터의 실제 앱 화면)",
      "- `screenshots/phone-01.png` ~ `phone-08.png`: 2~8장, 세로 9:16(또는 가로 16:9) 비율, 변 길이 320~3840px, **알파 없는 PNG**(또는 .jpg).",
      "- 에뮬레이터를 띄워 디버그 빌드를 설치하고 주요 화면을 `adb exec-out screencap -p` 로 찍은 뒤 9:16 으로 자르고 알파를 없애세요.",
      "- 에뮬레이터·adb 경로와 AVD 목록은 RELEASE_REQUEST.md 아래 '이 PC 환경'에 있어요. 띄운 에뮬레이터는 끝내기 전에 반드시 끄세요(`adb emu kill`).",
      '- 에뮬레이터를 쓸 수 없으면(AVD 없음, 가속 없음, 빌드 실패, 시간 부족) **실패로 끝내지 말고** `.factory/store/status.json` 에 `"screenshots": {"skipped": true, "reason": "이유"}` 를 쓰고 다음 단계로 가세요. 화면을 그림으로 지어내지 마세요.',
      "",
      "## 단계 video: 홍보 영상 (HyperFrames)",
      "- HyperFrames(HeyGen 오픈소스 HTML→MP4, npm 패키지 `hyperframes`, Apache-2.0)로 15~30초 앱 소개 영상 `promo.mp4`(1920x1080 또는 1080x1920)를 만드세요: 스크린샷과 스토어 문구가 움직이게.",
      "- 필요 환경: Node 22 이상, ffmpeg·ffprobe, Chrome(`npx hyperframes doctor` 로 확인). 앱 폴더 밖 임시 폴더에서 `npx hyperframes init` → 구성 HTML 작성 → `npx hyperframes render -c <html> -o <앱 폴더>/.factory/store/promo.mp4`.",
      '- 환경이 안 되거나 렌더가 실패하면 실패로 끝내지 말고 status.json 에 `"video": {"skipped": true, "reason": "이유"}` 를 쓰고 넘어가세요. 확인한 환경(Node·ffmpeg·Chrome·버전·라이선스)을 status.json 의 `"tools": "한두 줄"` 에 적으세요.',
      "- 영상은 PC 에만 둬요(서버로 보내지 않음). YouTube 업로드도 하지 마세요(사람이 직접 올리고 링크만 통제실에 넣어요).",
      "",
      "## 단계 listing: 스토어 문구",
      '- `listing.json`: {"ko-KR": {"title": "30자 이내", "shortDescription": "80자 이내", "fullDescription": "4000자 이내"}, "en-US": {...같은 형식}}. 언어 코드는 Play 형식(ko-KR, en-US).',
      "- 영상 링크는 이 폴더에 두지 마세요(통제실에 저장된 링크를 감독 프로그램이 넣어요).",
      "- `.factory/outbox/release.json` 에 storeListing(같은 내용, 키는 ko/en), checklist, notes 만 넣으세요(보낸 항목만 바뀌어요).",
      '- `.factory/outbox/project.json` 에 {"description": "홈페이지 소개 2~3문장", "techStack": [...]} (선택).',
      "",
      "## 업로드·홈페이지 (감독 프로그램이 해요. 직접 하지 마세요)",
      "- 끝나면 감독 프로그램이 파일을 검사하고, 아이콘·대표 이미지·스크린샷(png/jpg)만 홈페이지로 올려요.",
      "- Play 업로드 조건이 맞으면(서비스 계정 키, 패키지 이름, 최초 AAB 업로드 완료) Play Developer API 로 등록정보(제목·설명·영상 링크)와 이미지(종류별 통째 교체)를 올려요.",
      `- ${projectRule}`,
      "",
      "## 하지 말 것",
      "- AAB 빌드·서명, Play 업로드·Play Console 조작, YouTube 업로드. 키·비밀번호 파일 읽기.",
      "",
      stageSection(kind),
    ];

    return { ok: true, plan: lines.join("\n"), requiredSecrets: [] };
  }

  if (kind === "project") {
    const lines = [
      ...head,
      "이 지시는 **홈페이지 프로젝트 정보만** 갱신하는 일이에요. 앱 코드·빌드 설정은 바꾸지 마세요.",
      "",
      "## 만들 것",
      "1. 지금 앱의 기능을 읽고 홈페이지 소개(description, 2~3문장)와 기술 스택(techStack)을 정리.",
      "2. 개인정보처리방침: 코드에서 광고·분석·오류 수집 SDK 를 찾아 판별하고 작성([[ ... ]] 자리표시자 금지).",
      '3. `.factory/outbox/project.json` 에 {"description", "techStack", "privacyPolicy"} 로 저장.',
      `- ${projectRule}`,
      "",
      "## 하지 말 것",
      "- AAB 빌드·서명, Play 업로드(Play 는 건드리지 않아요), `release.json`. 이 종류에서는 서명 키·비밀번호도 넘기지 않아요.",
      "",
      stageSection(kind),
    ];

    return { ok: true, plan: lines.join("\n"), requiredSecrets: [] };
  }

  const key = effectiveKey(app, acc);
  const upload = !!key && playUploadMissing(app, acc).length === 0;
  const lines = [
    ...head,
    "이 지시는 스토어 첫 출시에 필요한 자료를 만드는 일이에요. 앱 기능은 바꾸지 마세요(출시에 꼭 필요한 설정 변경만).",
    "",
    "## 만들 것 (.factory/outbox/ 에 JSON 으로. 작업 규칙의 '출시 준비' 항목 형식 그대로)",
    "1. 개인정보처리방침 초안: 코드에서 광고·분석·오류 수집 SDK 를 찾아(pubspec/gradle/package.json 과 import) 판별하고, 홈페이지 템플릿(아래 구성)에 맞춰 작성.",
    "2. 스토어 문구 한국어/영어: 제목(30자), 짧은 설명(80자), 자세한 설명(4000자 이내).",
    "3. 데이터 보안 답안: 수집·공유 여부, 데이터 유형별 목적, 암호화 전송, 삭제 요청 방법.",
    "4. 콘텐츠 등급 설문 답안(IARC): 폭력·성적 내용·언어·약물·도박·사용자 상호작용·위치 공유·디지털 구매.",
    "5. 출시 체크리스트: 사람이 Play Console 에서 할 일, 그래픽(아이콘 512, 그래픽 이미지 1024x500, 스크린샷) 준비 여부.",
    "6. 홈페이지 프로젝트 빈 칸 채우기: project.json (이미 있는 값은 서버가 덮어쓰지 않아요).",
    "",
    "## 서명 키와 AAB (단계 key → build → sign)",
    "- 앱 폴더에 `android/key.properties`(또는 `key.properties`)가 이미 있으면 그 키를 그대로 쓰세요. key.properties 와 그 키 파일은 수정·이동·재생성하지 마세요.",
    key
      ? [
          `- 없으면 ${key.source === "custom" ? "이 앱에 지정된 다른 키" : `배포 계정 ${acc.label} 공용 키`}를 써요: \`${key.path}\` (별칭 ${key.alias}).`,
          "  감독 프로그램이 시작 전에 준비해서(파일이 없을 때만 한 번 만들고, 있으면 절대 건드리지 않음) 환경변수로 넘겨요:",
          "  FACTORY_KEYSTORE_PATH, FACTORY_KEY_ALIAS, FACTORY_KEYSTORE_PASSWORD, FACTORY_KEY_PASSWORD.",
          "- 서명 설정은 빌드 스크립트가 이 환경변수를 읽게 하세요(Flutter: android/app/build.gradle(.kts) 의 signingConfigs.release 에서 System.getenv).",
          "  key.properties 를 새로 만들 때는 storeFile·keyAlias 만 쓰고 비밀번호는 쓰지 마세요. 비밀번호를 파일·로그·커밋·JSON 에 쓰지 마세요.",
          '- 환경변수가 없으면(키 준비 실패) fail.json 에 stage "key" 로 남기고 끝내세요.',
        ].join("\n")
      : "- 이 앱에 쓸 공용 키·다른 키 경로가 없어요. 앱 폴더에 key.properties 도 없으면 AAB 는 만들지 말고 체크리스트에 '서명 키 준비'를 넣으세요.",
    "- 서명된 릴리스 AAB 를 만들고(Flutter: flutter build appbundle --release), 경로·버전을 release.json 의 aab 에 적으세요. AAB 는 PC 에만 둡니다(서버로 올리지 않음).",
    "- 키 파일을 앱 폴더로 복사하거나 커밋하지 마세요.",
    "",
    "## 스토어 업로드",
    upload
      ? [
          `- 최초 업로드를 마친 앱이라, 서명 AAB 를 release.json 의 aab 에 적으면 **감독 프로그램이** Play Developer API 로 비공개 테스트 트랙(${PLAY_TEST_TRACK})에 올려요.`,
          "- 직접 올리지 마세요(fastlane·python 등 금지). 서비스 계정 키 파일도 읽지 마세요. 버전 코드는 이전 업로드보다 커야 해요(pubspec version 의 + 뒤 숫자 / versionCode).",
          "- 프로덕션 트랙은 사람이 Play Console 에서 '라이브러리에서 추가'로 진행해요.",
        ].join("\n")
      : "- 이번에는 업로드하지 않아요(최초 업로드는 사람이 Play Console 에 직접). 체크리스트에 '최초 AAB 직접 업로드'를 넣으세요.",
    "",
    stageSection(kind),
  ];

  return { ok: true, plan: lines.join("\n"), requiredSecrets: [] };
}

// ───────── 감독 프로그램에게 일감과 함께 주는 출시 정보 (/next 의 job.release) ─────────

const dnamePart = (v: string | null | undefined) => (v ?? "").replace(/[^0-9A-Za-z가-힣 ._-]/g, "").trim().slice(0, 60);

/**
 * 출시 일감마다: 종류, 재시도 시작 단계·이전 실패 이유, 보낼 수 있는 outbox 파일, (첫 출시면) 쓸 업로드 키.
 * 키는 경로·별칭·secrets.env 이름만(값 없음). generate 는 공용 키일 때만 true(파일이 없을 때만 감독 프로그램이 한 번 만든다).
 */
export async function releaseJobExtras(jobs: { id: string; appSlug: string; kind: string }[]) {
  const out = new Map<string, Record<string, unknown>>();
  const rel = jobs.filter((j) => j.kind === "release");

  if (rel.length === 0) return out;
  const [rows, apps] = await Promise.all([
    prisma.factoryJob.findMany({ where: { id: { in: rel.map((j) => j.id) } }, select: { id: true, releaseKind: true, resumeFrom: true, resumeNote: true, overwriteProject: true } }),
    prisma.factoryApp.findMany({ where: { appSlug: { in: rel.map((j) => j.appSlug) } }, include: { releaseAccount: true } }),
  ]);
  const pcStatus = await getPcPathStatus().catch(() => null);

  for (const j of rel) {
    const r = rows.find((x) => x.id === j.id);
    const kind = releaseKindOf(r?.releaseKind);
    const app = apps.find((a) => a.appSlug === j.appSlug) ?? null;
    const acc = app?.releaseAccount ?? null;
    const key = kind === "first" ? effectiveKey(app, acc) : null;
    const names = key ? keySecretNames(key.ref) : null;

    out.set(j.id, {
      kind,
      kindLabel: RELEASE_KIND_LABELS[kind],
      stages: STAGES_BY_KIND[kind],
      outbox: OUTBOX_BY_KIND[kind],
      resumeFrom: r?.resumeFrom && RESUMABLE.includes(r.resumeFrom) ? r.resumeFrom : null,
      resumeNote: r?.resumeNote ?? null,
      overwriteProject: OVERWRITE_KINDS.includes(kind) && r?.overwriteProject === true,
      // Play Developer API 업로드(감독 프로그램이 직접): 스토어 자료 수정 = 등록정보·이미지, 첫 출시 = 업데이트 AAB → 비공개 테스트 트랙.
      // 서비스 계정 키는 경로만 준다(감독 프로그램이 읽어 토큰을 받고, 내용은 어디에도 보내지 않는다). missing 이 있으면 업로드하지 않는다.
      play:
        kind === "project"
          ? null
          : {
              packageName: app?.packageName ?? null,
              serviceAccountKeyPath: acc?.serviceAccountKeyPath ?? null,
              track: PLAY_TEST_TRACK,
              videoUrl: kind === "store" ? (app?.promoVideoUrl ?? null) : null,
              missing: playUploadMissing(app, acc, pcStatus?.items),
            },
      key:
        key && names && acc
          ? {
              source: key.source,
              path: key.path,
              alias: key.alias,
              storeName: names.store,
              keyName: names.key,
              // 예전 방식(계정 라벨별 이름)도 있으면 쓴다
              legacyStoreName: key.source === "account" ? keystorePasswordName(acc.label) : null,
              legacyKeyName: key.source === "account" ? keyPasswordName(acc.label) : null,
              generate: key.source === "account",
              dname: `CN=${dnamePart(acc.developerName) || dnamePart(acc.name) || "App Factory"}, C=KR`,
            }
          : null,
    });
  }

  return out;
}

/**
 * project.json 을 받아도 되는 일감인지. jobId 가 없으면(예전 감독 프로그램) 예전처럼 빈 칸만 채운다.
 * release: 출시 일감이면 그 종류. overwrite: 덮어쓰기를 고른 store/project 일감(개인정보처리방침은 여전히 빈 칸만)
 */
export async function projectFillAllowed(
  jobId: unknown,
): Promise<{ ok: true; release: ReleaseKind | null; overwrite: boolean } | { ok: false; message: string }> {
  if (typeof jobId !== "string" || !jobId) return { ok: true, release: null, overwrite: false };
  const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { kind: true, releaseKind: true, overwriteProject: true } });

  if (!job || job.kind !== "release") return { ok: true, release: null, overwrite: false };
  const kind = releaseKindOf(job.releaseKind);

  if (!OUTBOX_BY_KIND[kind].includes("project.json")) return { ok: false, message: `${RELEASE_KIND_LABELS[kind]} 일감은 홈페이지 프로젝트를 바꿀 수 없어요.` };

  return { ok: true, release: kind, overwrite: OVERWRITE_KINDS.includes(kind) && job.overwriteProject };
}

// ───────── 재시도 (실패한 단계부터) ─────────

export async function retryRelease(jobId: string): Promise<{ ok: boolean; status: number; message: string }> {
  const job = await prisma.factoryJob.findUnique({
    where: { id: jobId },
    select: { kind: true, status: true, appSlug: true, failStage: true, phase: true, failReason: true },
  });

  if (!job || job.kind !== "release") return { ok: false, status: 404, message: "없는 출시 일감이에요." };
  if (job.status !== "failed") return { ok: false, status: 409, message: `지금 상태(${job.status})에서는 재시도할 수 없어요. 실패한 일감만 돼요.` };
  const clash = await prisma.factoryJob.count({ where: { appSlug: job.appSlug, id: { not: jobId }, status: { in: [...ACTIVE_STATUSES] } } });

  if (clash > 0) return { ok: false, status: 409, message: "같은 앱의 진행 중인 일감이 있어서 재시도할 수 없어요." };
  const stage = job.failStage ?? job.phase;
  const resumeFrom = stage && RESUMABLE.includes(stage) ? stage : null;
  const res = await prisma.factoryJob.updateMany({
    where: { id: jobId, status: "failed" },
    data: {
      status: "approved",
      attempts: 0,
      approvedAt: new Date(),
      failReason: null,
      failStage: null,
      phase: null,
      workerId: null,
      leaseUntil: null,
      startedAt: null,
      finishedAt: null,
      resumeFrom,
      resumeNote: maskSecrets(job.failReason)?.slice(0, 500) ?? null,
    },
  });

  if (res.count === 0) return { ok: false, status: 409, message: "이미 다른 곳에서 처리됐어요." };
  await prisma.factoryJobLog.create({
    data: { jobId, level: "info", message: `재시도 승인: ${resumeFrom ? `'${stageLabel(resumeFrom)}' 단계부터` : "처음부터"}` },
  });

  return { ok: true, status: 200, message: resumeFrom ? `'${stageLabel(resumeFrom)}' 단계부터 다시 하도록 승인했어요.` : "처음부터 다시 하도록 승인했어요." };
}

