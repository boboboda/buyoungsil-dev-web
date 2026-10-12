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
import { KEY_KINDS, listVault } from "@/lib/factory/keyVault";
import { deleteReviewVideo, reviewVideoInfo } from "@/lib/factory/reviewVideo";
import { readStoreAssets, savePromoVideoUrl } from "@/lib/factory/storeAssets";
import { uploadTestState } from "@/lib/factory/uploadTest";
import { APP_NAME_SOURCE_LABELS, cleanAppName, pickAppName, storeTitleOf } from "@/lib/factory/appName";
import { isStoreTarget, storeTargetBlockReason } from "@/lib/factory/storeTarget";
import { TEST_APK_MAX, apkReadiness, apkStackSupported, listTestApks } from "@/lib/factory/testApk";

// 출시 일감 종류. 종류마다 서버가 만드는 지시문과 허용 동작(outbox 파일·키 준비)이 다르다.
// project(프로젝트 업데이트)는 예전 종류: 예전 일감 기록이 읽히고 커넥터 호환으로만 받는다(통제실에서는 고르지 않음. 홈페이지만 고치려면 store + 덮어쓰기)
// apk(시험용 APK): 실기기 시험용 서명 release APK 를 만들어 통제실에서 내려받는다. Play 는 건드리지 않는다(출시 카드의 '시험용 APK' 영역에서만 요청)
export const RELEASE_KINDS = ["first", "store", "update", "project", "apk"] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];
export const RELEASE_KIND_LABELS: Record<ReleaseKind, string> = {
  first: "첫 출시",
  store: "스토어 수정",
  update: "앱 업데이트(기능 추가)",
  project: "프로젝트 업데이트(예전)",
  apk: "시험용 APK",
};
// 종류 옆 한 줄 설명
export const RELEASE_KIND_HINTS: Record<ReleaseKind, string> = {
  first: "스토어 첫 출시 자료(AAB·문구·이미지·영상) 만들기 → 검토 → 홈페이지 반영. 최초 AAB 는 Console 에 직접",
  store: "Play 스토어 정보 바꾸기(이미지·문구·영상 링크·개인정보처리방침) → 검토 → Play 업로드",
  update: "기능을 추가해 새 버전 내기(코드 수정·시험 → 버전 올림 → AAB → 비공개 테스트 트랙)",
  project: "예전 종류: 홈페이지 프로젝트 정보만(지금은 스토어 수정 + 홈페이지 덮어쓰기)",
  apk: "등록된 서명 키로 release APK 를 만들어 통제실에서 내려받기(실기기 시험용). Play 는 건드리지 않아요",
};
// 통제실에서 고를 수 있는 종류(예전 종류 제외)
export const SELECTABLE_KINDS: ReleaseKind[] = ["first", "store", "update"];
// 생성 뒤 '검토 대기'를 거치는 종류
export const REVIEW_KINDS: ReleaseKind[] = ["first", "store"];
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
  privacy: "개인정보처리방침",
  review: "검토 대기",
  linkwait: "영상 링크 대기",
  videolink: "영상 링크 반영",
  code: "코드 수정",
  test: "시험",
  version: "버전 올림",
  upload: "업로드",
  homepage: "홈페이지 반영",
  done: "완료",
};
export const stageLabel = (s: string | null | undefined) => (s ? (RELEASE_STAGE_LABELS[s] ?? s) : "-");
// 재시도를 이 단계부터 시작할 수 있다
// review 부터 = 검토 자료만 다시 올리기(Claude 없이), upload·homepage 부터 = 승인 뒤 반영만 다시(Claude 없이)
const RESUMABLE = ["key", "build", "sign", "store", "icon", "screenshots", "video", "listing", "privacy", "code", "test", "version", "review", "upload", "homepage", "videolink"];
// 종류별로 감독 프로그램이 홈페이지로 보낼 수 있는 outbox 파일
const OUTBOX_BY_KIND: Record<ReleaseKind, string[]> = {
  first: ["project.json", "release.json"],
  store: ["release.json", "project.json"],
  update: ["release.json", "project.json"],
  project: ["project.json"],
  apk: [], // APK 는 outbox 가 아니라 감독 프로그램이 /api/factory/test-apk 로 올린다
};
// 홈페이지 프로젝트 '덮어쓰기'를 고를 수 있는 종류(첫 출시는 늘 빈 칸만 채운다). 앱 업데이트는 이 체크가 '홈페이지 프로젝트도 반영'
export const OVERWRITE_KINDS: ReleaseKind[] = ["store", "project", "update"];

// 스토어 자료 수정·프로젝트 업데이트 승인 때 고르는 갱신 항목. 고른 항목만 만들고·올리고·홈페이지에 반영한다.
// 일감의 updateItems 가 빈 배열이면 예전 일감이다(예전 동작 그대로).
export type UpdateItem = { value: string; label: string; help: string };
export const UPDATE_ITEMS: Partial<Record<ReleaseKind, UpdateItem[]>> = {
  store: [
    { value: "images", label: "이미지", help: "아이콘·대표 이미지·폰 스크린샷을 새로 만들어 Play 와 홈페이지에 올려요." },
    { value: "listing", label: "문구", help: "제목·짧은 설명·긴 설명을 새로 써서 Play 등록정보에 올려요(홈페이지 소개·기술 스택도)." },
    // video: 영상(mp4)만 만든다. 링크는 YouTube 에 올린 뒤 '영상 링크 대기'에서 붙여 넣는다(Play 영상은 그때 반영)
    { value: "video", label: "홍보 영상 만들기", help: "홍보 영상(promo.mp4)을 새로 만들어요. YouTube 에 올린 뒤 카드에서 링크를 붙여 넣으면 Play 등록정보에 반영돼요." },
    // videoLink: 이미 YouTube 에 올린 영상의 링크만 Play 등록정보에 넣는다(링크 필수, '홍보 영상 만들기'와 같이 못 고름)
    { value: "videoLink", label: "홍보 영상 링크만 반영", help: "YouTube 에 이미 올린 영상의 링크만 Play 등록정보 영상에 넣어요(아래 링크 칸 필수)." },
    { value: "privacy", label: "개인정보처리방침 갱신", help: "홈페이지 프로젝트의 개인정보처리방침을 새로 써서 덮어써요." },
  ],
  project: [
    { value: "description", label: "설명", help: "홈페이지 소개(2~3문장)와 기술 스택을 새로 정리해요." },
    { value: "cover", label: "대표 이미지", help: "스토어 자료의 대표 이미지(1024x500)를 홈페이지 대표 이미지로 써요." },
    { value: "privacy", label: "개인정보처리방침 갱신", help: "홈페이지 프로젝트의 개인정보처리방침을 새로 써서 덮어써요." },
  ],
};
// 커넥터가 항목을 안 보냈을 때(예전 호출): 개인정보처리방침은 건드리지 않는 예전 범위
const DEFAULT_UPDATE_ITEMS: Partial<Record<ReleaseKind, string[]>> = { store: ["images", "listing", "video"], project: ["description", "cover"] };
const itemLabel = (kind: ReleaseKind, v: string) => UPDATE_ITEMS[kind]?.find((i) => i.value === v)?.label ?? v;
export const updateItemsText = (kind: ReleaseKind, items: string[]) => items.map((v) => itemLabel(kind, v)).join("·");

/**
 * 갱신 항목 확인. 종류에 항목이 없으면(첫 출시) 빈 배열. undefined 면 예전 범위, 빈 배열·모르는 값은 거절.
 * 돌려주는 순서는 UPDATE_ITEMS 순서.
 */
export function normalizeUpdateItems(kind: ReleaseKind, v: unknown): { ok: true; items: string[] } | { ok: false; message: string } {
  const defs = UPDATE_ITEMS[kind];

  if (!defs) return { ok: true, items: [] };
  if (v === undefined) return { ok: true, items: DEFAULT_UPDATE_ITEMS[kind] ?? [] };
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !defs.some((d) => d.value === x))) {
    return { ok: false, message: `갱신 항목은 ${defs.map((d) => `${d.value}(${d.label})`).join(", ")} 중에서 골라요.` };
  }
  const items = defs.map((d) => d.value).filter((x) => v.includes(x));

  if (items.includes("video") && items.includes("videoLink")) {
    return { ok: false, message: "'홍보 영상 만들기'와 '홍보 영상 링크만 반영'은 같이 고를 수 없어요(영상을 만들면 링크는 나중에 넣어요)." };
  }

  if (items.length === 0) return { ok: false, message: "갱신할 항목을 하나 이상 고르세요." };

  return { ok: true, items };
}

/** 일감에 저장된 갱신 항목. 예전 일감(빈 배열)이나 항목이 없는 종류는 null(= 전부, 예전 동작) */
export const jobUpdateItems = (kind: ReleaseKind, items: string[] | null | undefined): string[] | null =>
  UPDATE_ITEMS[kind] && items && items.length ? items : null;
const has = (items: string[] | null, v: string) => !items || items.includes(v);

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
  defaultKeyId?: unknown; // 기본 키(키 보관함 항목 id, 빈 값이면 없음). 주면 keystorePath·keyAlias 는 무시하고 그 키의 값으로 맞춘다
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
  // 서명 키: 보관함에서 고른 기본 키(새 화면) → 예전 경로 칸(예전 호출) → 안 보냈으면 그대로
  let keyData: { defaultKeyId?: string | null; keystorePath?: string | null; keyAlias?: string | null } = {};

  if (input.defaultKeyId !== undefined) {
    const id = typeof input.defaultKeyId === "string" && input.defaultKeyId ? input.defaultKeyId : null;
    const k = id ? await prisma.factoryKey.findUnique({ where: { id } }) : null;

    if (id && !k) return { ok: false, status: 400, message: "키 보관함에 없는 키예요." };
    // 예전 열은 호환용 사본(예전 감독 프로그램·화면이 읽음)
    keyData = { defaultKeyId: k?.id ?? null, keystorePath: k?.keystorePath ?? null, keyAlias: k?.keyAlias ?? null };
  } else if (input.keystorePath !== undefined) {
    const ks = checkPath(input.keystorePath, [".jks", ".keystore"], "서명 키");

    if ("message" in ks) return { ok: false, status: 400, message: ks.message };
    keyData = { defaultKeyId: null, keystorePath: ks.value, keyAlias: cleanStr(input.keyAlias, 80) }; // 다음 로드 때 보관함으로 가져온다
  }
  const sa = checkPath(input.serviceAccountKeyPath, [".json"], "서비스 계정 키");

  if ("message" in sa) return { ok: false, status: 400, message: sa.message };

  const data = {
    name,
    requiresTesting: input.requiresTesting === true,
    developerName: cleanStr(input.developerName, 80),
    contactEmail: email,
    ...keyData,
    serviceAccountKeyPath: sa.value,
    developerAccountId: devId,
    accountType: accountType as string | null,
    loginEmail,
    notes: cleanStr(input.notes, 2000),
  };

  await prisma.factoryReleaseAccount.upsert({ where: { label }, create: { label, ...data }, update: data });

  // 서명 키를 쓰는 계정이면 비밀번호 키 "이름"을 등록해 둔다(값은 PC secrets.env 에만). 출시 준비 일감이 이 이름으로 받는다.
  if (keyData.keystorePath) {
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
// 앱 하나만 점검(출시 카드 [키 조회]): { [appSlug]: { requestedAt, takenAt } }. 결과가 오면 그 앱 줄을 지운다
const KEY_SCAN_APPS = "keyScanAppRequests";

export interface KeyScanApp {
  appSlug: string;
  keys: {
    path: string;
    abs?: string | null; // PC 의 절대 경로('이 키를 이 앱 키로 지정'에 쓴다)
    type: string;
    aliases: { alias: string; sha1: string | null }[];
    gitTracked: boolean | null;
    note?: string | null;
  }[];
  keyProperties: { path: string; storeFile: string | null; keyAlias: string | null; gitTracked: boolean | null }[];
  missing?: boolean; // PC 작업 폴더에 이 앱 폴더가 없음
  at?: string | null; // 이 앱을 마지막으로 조회한 시각
}

type KeyScanAppRequests = Record<string, { requestedAt: string; takenAt: string | null }>;

async function readKeyScanApps(): Promise<KeyScanAppRequests> {
  const row = await prisma.factorySetting.findUnique({ where: { key: KEY_SCAN_APPS } });

  try {
    const v = row ? (JSON.parse(row.value) as KeyScanAppRequests) : {};

    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

async function writeKeyScanApps(v: KeyScanAppRequests) {
  if (Object.keys(v).length === 0) await prisma.factorySetting.deleteMany({ where: { key: KEY_SCAN_APPS } });
  else {
    const value = JSON.stringify(v);

    await prisma.factorySetting.upsert({ where: { key: KEY_SCAN_APPS }, create: { key: KEY_SCAN_APPS, value }, update: { value } });
  }
}

/**
 * 통제실 [키 점검]: 다음 /next 응답에 keyScan: true 를 한 번 붙인다.
 * appSlug 를 주면(출시 카드 [키 조회]) 그 앱 하나만 점검한다.
 */
export async function requestKeyScan(appSlug?: string): Promise<{ ok: boolean; status: number; message: string }> {
  const value = new Date().toISOString();

  if (appSlug) {
    const hasJob = await prisma.factoryJob.findFirst({ where: { appSlug }, select: { id: true } });

    if (!hasJob) return { ok: false, status: 404, message: "그런 공장 앱이 없어요." };
    const cur = await readKeyScanApps();

    // 오래된 요청(1시간 넘음)은 정리하고, 한 번에 20개까지만
    for (const [k, v] of Object.entries(cur)) if (Date.now() - Date.parse(v.requestedAt) > 60 * 60 * 1000) delete cur[k];
    if (Object.keys(cur).length >= 20 && !cur[appSlug]) return { ok: false, status: 429, message: "키 조회 요청이 너무 많아요. 잠시 뒤 다시 하세요." };
    cur[appSlug] = { requestedAt: value, takenAt: null };
    await writeKeyScanApps(cur);

    return { ok: true, status: 200, message: `${appSlug} 키 조회를 요청했어요. 작업 PC 가 15초 안에 가져가 결과를 보내요.` };
  }
  await prisma.factorySetting.upsert({ where: { key: KEY_SCAN_REQUEST }, create: { key: KEY_SCAN_REQUEST, value }, update: { value } });

  return { ok: true, status: 200, message: "키 점검을 요청했어요. 작업 PC 가 15초 안에 가져가 결과를 보내요(잠시 뒤 새로고침)." };
}

/**
 * /next 에서 부른다. 요청이 없으면 false.
 * 전체 점검 요청이 있으면 true(앱 하나 요청도 함께 처리됨), 앱 하나 요청만 있으면 그 앱 이름 목록.
 * /next 는 둘 다 keyScan: true 로 알리고, 앱 목록은 keyScanApps 로 따로 준다(예전 감독 프로그램은 전체를 점검해 그 앱도 포함된다).
 */
export async function consumeKeyScan(): Promise<boolean | string[]> {
  const res = await prisma.factorySetting.deleteMany({ where: { key: KEY_SCAN_REQUEST } });
  const cur = await readKeyScanApps();
  const now = new Date().toISOString();
  const fresh = Object.entries(cur).filter(([, v]) => !v.takenAt);

  if (fresh.length || res.count > 0) {
    for (const [k] of fresh) cur[k].takenAt = now;
    if (fresh.length) await writeKeyScanApps(cur);
  }
  if (res.count > 0) return true;

  return fresh.length ? fresh.map(([k]) => k) : false;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : null);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);

/**
 * 감독 프로그램의 키 점검 결과 저장. body.only(앱 이름 목록)가 있으면 앱 하나 점검 결과라 그 앱들만 바꾸고 나머지는 그대로 둔다.
 * 없으면 전체 점검 결과로 통째 바꾼다.
 */
export async function saveKeyScan(body: unknown): Promise<number> {
  const appsIn = (body as { apps?: unknown })?.apps;
  const onlyIn = (body as { only?: unknown })?.only;
  const only = Array.isArray(onlyIn) ? onlyIn.filter((x): x is string => typeof x === "string").slice(0, 20) : null;

  if (!Array.isArray(appsIn)) return 0;
  const apps: KeyScanApp[] = [];
  const now = new Date().toISOString();

  for (const a of appsIn.slice(0, 100)) {
    const r = a as Record<string, unknown>;
    const appSlug = str(r?.appSlug, 60);

    if (!appSlug) continue;
    if (only && !only.includes(appSlug)) continue;
    const keys = (Array.isArray(r.keys) ? r.keys : []).slice(0, 20).map((k: Record<string, unknown>) => ({
      path: str(k?.path, 300) ?? "",
      abs: str(k?.abs, 300),
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

    apps.push({ appSlug, keys, keyProperties, missing: r.missing === true, at: now });
  }
  let value: string;

  if (only) {
    // 앱 하나 점검: 이전 전체 점검 결과(시각 포함)는 그대로 두고 그 앱 줄만 바꾼다
    const prev = await getKeyScan();
    const merged = [...prev.apps.filter((a) => !apps.some((x) => x.appSlug === a.appSlug)), ...apps];

    value = JSON.stringify({ at: prev.at, apps: merged });
  } else value = JSON.stringify({ at: now, apps });

  await prisma.factorySetting.upsert({ where: { key: KEY_SCAN_RESULT }, create: { key: KEY_SCAN_RESULT, value }, update: { value } });
  // 결과가 온 앱의 [키 조회] 요청은 끝났다
  const req = await readKeyScanApps();
  // 앱 하나 점검이면 그 앱들, 전체 점검이면 PC 가 가져간 요청 전부(전체 점검이 그 앱도 봤다)
  const done = only ?? Object.keys(req).filter((k) => req[k].takenAt);

  if (done.some((k) => req[k])) {
    for (const k of done) if (req[k]?.takenAt) delete req[k];
    await writeKeyScanApps(req);
  }

  return apps.length;
}

/** 마지막 키 점검 결과와, 아직 PC 가 가져가지 않은 요청 시각 */
async function getKeyScan(): Promise<{ at: string | null; apps: KeyScanApp[]; requestedAt: string | null; appRequests: KeyScanAppRequests }> {
  const [row, req, appRequests] = await Promise.all([
    prisma.factorySetting.findUnique({ where: { key: KEY_SCAN_RESULT } }),
    prisma.factorySetting.findUnique({ where: { key: KEY_SCAN_REQUEST } }),
    readKeyScanApps(),
  ]);
  let saved: { at: string; apps: KeyScanApp[] } | null = null;

  try {
    saved = row ? (JSON.parse(row.value) as { at: string; apps: KeyScanApp[] }) : null;
  } catch {
    saved = null;
  }

  return { at: saved?.at ?? null, apps: saved?.apps ?? [], requestedAt: req?.value ?? null, appRequests };
}

// ───────── 앱이 쓸 업로드 키 ─────────

// 키 보관함 항목(필요한 칸만)
type VaultKeyRow = {
  id: string;
  name: string;
  kind: string;
  keystorePath: string;
  keyAlias: string;
  production: boolean;
  createState: string | null;
  passwordRef: string | null;
};
type AccountRow = {
  label: string;
  name: string;
  developerName: string | null;
  keystorePath: string | null;
  keyAlias: string | null;
  defaultKey?: VaultKeyRow | null;
};
type AppKeyRow = { customKeystorePath: string | null; customKeyAlias: string | null; key?: VaultKeyRow | null };

const fromVault = (source: "custom" | "account", k: VaultKeyRow) => ({
  source,
  path: k.keystorePath,
  alias: k.keyAlias,
  ref: k.passwordRef || keyRefOf(k.keystorePath, k.keyAlias), // 경로를 바꾼 키는 처음 구분값으로 비밀번호를 찾는다
  keyId: k.id as string | null,
  name: k.name as string | null,
  kind: k.kind as string | null,
  production: k.production,
  createState: k.createState,
});

/**
 * 앱이 쓸 업로드 키: 앱이 고른 보관함 키 → (예전 값) 앱별 '다른 키' → 배포 계정 기본 키(보관함) → (예전 값) 계정 서명 키. 없으면 null.
 * 예전 값은 보관함으로 가져오기 전에만 쓰인다(importLegacyKeys).
 */
export function effectiveKey(app: AppKeyRow | null, acc: AccountRow | null) {
  const legacy = (source: "custom" | "account", path: string, aliasIn: string | null) => {
    const alias = aliasIn || DEFAULT_KEY_ALIAS;

    return { source, path, alias, ref: keyRefOf(path, alias), keyId: null, name: null, kind: null, production: false, createState: null };
  };

  if (app?.key) return fromVault("custom", app.key);
  if (app?.customKeystorePath) return legacy("custom", app.customKeystorePath, app.customKeyAlias);
  if (acc?.defaultKey) return fromVault("account", acc.defaultKey);
  if (acc?.keystorePath) return legacy("account", acc.keystorePath, acc.keyAlias);

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

// ───────── 종류별 '필요한 준비' (출시 카드 체크 목록, 승인 전 확인) ─────────

/** ok: true ✅ / false ⬜(부족: 승인 막음) / null ⏳(확인 전·직접 확인: 막지 않음) */
export interface ReadyItem {
  label: string;
  ok: boolean | null;
  note?: string | null;
}

type ReadyInput = {
  app: { packageName: string | null; firstUploadDone: boolean; releaseAccountId: string | null } | null;
  account: { label: string; serviceAccountKeyPath: string | null } | null;
  accountSecretsRegistered: boolean; // 예전 방식(계정 라벨 이름)으로 비밀번호 이름을 등록해 둔 계정
  key: { source: string; keyId: string | null; name: string | null; path: string } | null;
  keyCheckExists: boolean | null; // 보관함 조회 결과(파일 있음). 모르면 null
  keyPassword: string; // none | waiting | delivered
  ownKeyProperties: boolean; // 앱 폴더에 key.properties 가 있음(키 후보 찾기 결과)
  serviceAccountExists: boolean | null; // PC 에 서비스 계정 키 파일이 있는지(감독 프로그램 확인). 모르면 null
  stack?: string | null; // 앱 종류(시험용 APK 지원 여부)
};

/** 종류마다 승인 전에 필요한 준비. 저장된 값 기준(카드에서 고친 뒤 [저장]해야 반영) */
export function releaseReadiness(r: ReadyInput): Record<"first" | "store" | "update" | "apk", ReadyItem[]> {
  const account: ReadyItem = { label: "배포 계정 선택", ok: !!r.app?.releaseAccountId && !!r.account, note: r.account ? `계정 ${r.account.label}` : "카드에서 계정을 골라 [저장]" };
  const pkg: ReadyItem = { label: "패키지 이름", ok: !!r.app?.packageName, note: r.app?.packageName ?? "카드에서 패키지 이름을 넣고 [저장]" };
  const own = r.ownKeyProperties;
  const key: ReadyItem = own
    ? { label: "이 앱이 쓸 키", ok: true, note: "앱 자체 key.properties 를 그대로 써요" }
    : { label: "이 앱이 쓸 키", ok: !!r.key, note: r.key ? `${r.key.name ?? r.key.path}${r.key.source === "custom" ? "(이 앱에 고른 키)" : "(계정 기본 키)"}` : "키 보관함에서 고르거나 계정 기본 키를 정하세요" };
  const password: ReadyItem = own
    ? { label: "키 비밀번호 등록", ok: true, note: "앱 자체 key.properties 의 비밀번호를 써요" }
    : !r.key
      ? { label: "키 비밀번호 등록", ok: false, note: "키를 먼저 정하세요" }
      : r.keyPassword !== "none"
        ? { label: "키 비밀번호 등록", ok: true, note: r.keyPassword === "delivered" ? "작업 PC 에 저장됨" : "작업 PC 가 가져가기 대기" }
        : r.key.source === "account" && r.accountSecretsRegistered
          ? { label: "키 비밀번호 등록", ok: null, note: "통제실에 등록된 비밀번호는 없어요. PC secrets.env 에 예전 이름으로 직접 넣었다면 괜찮아요" }
          : { label: "키 비밀번호 등록", ok: false, note: "설정 → 키 보관함에서 이 키의 비밀번호를 등록하세요" };
  const keyFile: ReadyItem | null = own || !r.key
    ? null
    : { label: "키 파일 있음", ok: r.keyCheckExists, note: r.keyCheckExists === null ? "아직 조회하지 않았어요([🔍 조회])" : r.keyCheckExists ? null : `파일이 없어요: ${r.key.path}` };
  const sa: ReadyItem = { label: "서비스 계정 키(Play API)", ok: !!r.account?.serviceAccountKeyPath, note: r.account?.serviceAccountKeyPath ?? "설정 → 배포 계정에 서비스 계정 키 경로를 넣으세요" };
  const saFile: ReadyItem | null = r.account?.serviceAccountKeyPath
    ? { label: "서비스 계정 키 파일 있음", ok: r.serviceAccountExists, note: r.serviceAccountExists === null ? "작업 PC 확인 전" : r.serviceAccountExists ? null : "작업 PC 에 파일이 없어요" }
    : null;
  const firstUpload: ReadyItem = { label: "최초 AAB 업로드 완료", ok: !!r.app?.firstUploadDone, note: r.app?.firstUploadDone ? null : "먼저 첫 출시를 끝내고 Console 에 최초 AAB 를 올린 뒤 체크하세요" };
  const keep = (xs: (ReadyItem | null)[]) => xs.filter((x): x is ReadyItem => !!x);

  return {
    // 첫 출시는 Play API 를 쓰지 않아 서비스 계정·최초 업로드가 필요 없다
    first: keep([account, pkg, key, password, keyFile]),
    // 스토어 수정은 AAB 를 만들지 않아 키가 필요 없다(갱신 항목 1개 이상은 카드에서 고를 때 확인)
    store: keep([account, pkg, sa, saFile, firstUpload]),
    // 앱 업데이트(업데이트 내용은 카드에서 입력할 때 확인)
    update: keep([account, pkg, key, password, keyFile, sa, saFile, firstUpload]),
    // 시험용 APK: 서명 키만 있으면 된다(서비스 계정·최초 업로드 필요 없음). 출시 카드의 '시험용 APK' 영역에서 따로 본다
    apk: apkReadiness({
      stack: r.stack ?? null,
      accountLabel: r.app?.releaseAccountId && r.account ? r.account.label : null,
      packageName: r.app?.packageName ?? null,
      key: r.key,
      keyPassword: r.keyPassword,
      keyFileExists: r.keyCheckExists,
      ownKeyProperties: r.ownKeyProperties,
    }),
  };
}

/** 부족한 준비(⬜)만 한 줄로. 없으면 null */
export function readinessProblem(items: ReadyItem[] | undefined): string | null {
  const bad = (items ?? []).filter((i) => i.ok === false);

  return bad.length ? bad.map((i) => `${i.label}${i.note ? `(${i.note})` : ""}`).join(", ") : null;
}

/** 출시 일감의 카드 표시 상태 */
function jobState(j: { status: string; reviewRequired: boolean; reviewApprovedAt: Date | null }): string {
  if (j.status === "review") return "review";
  if (j.status === "linkwait") return "linkwait";
  if (["pending", "approved", "running"].includes(j.status)) return j.reviewRequired && j.reviewApprovedAt ? "publishing" : j.status === "pending" ? "pending" : "generating";
  return j.status; // done | failed | cancelled
}

/** 통제실 "출시 패키지" 화면에 필요한 것 전부. 키 값은 없다(경로·이름·존재 여부만). */
export async function releaseOverview() {
  // 키 보관함(예전 키 경로를 먼저 보관함 항목으로 가져온다)
  const vault = await listVault();
  const vaultById = new Map(vault.map((k) => [k.id, k]));
  const [accounts, apps, jobs, pcStatus, secretNames, keyPasswords, keyScan] = await Promise.all([
    prisma.factoryReleaseAccount.findMany({ orderBy: { label: "asc" }, include: { defaultKey: true } }),
    prisma.factoryApp.findMany({ include: { key: true } }),
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
        updateItems: true,
        summary: true,
        reviewRequired: true,
        reviewAt: true,
        reviewApprovedAt: true,
        redoNote: true,
        versionName: true,
        releaseNotes: true,
        buildResult: true,
        aiEngine: true,
      },
    }),
    getPcPathStatus(),
    prisma.factorySecretName.findMany({ select: { name: true } }),
    keyPasswordStatuses(),
    getKeyScan(),
  ]);
  const appBySlug = new Map(apps.map((a) => [a.appSlug, a]));
  const names = new Set(secretNames.map((s) => s.name));
  // 홈페이지 프로젝트: 카드 제목(앱 이름)·연결 표시용 제목, 연결 바꾸기에서 고를 목록(다른 앱에 연결된 건 linkedApp)
  const allProjects = await prisma.project.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, title: true, platform: true, status: true } });
  const projectTitle = new Map(allProjects.map((p) => [p.id, p.title]));
  const linkedApp = new Map(apps.filter((a) => a.projectId).map((a) => [a.projectId as string, a.appSlug]));
  const projectLink = (app: { projectId: string | null } | undefined) => ({
    projectId: app?.projectId ?? null,
    projectTitle: app?.projectId ? (projectTitle.get(app.projectId) ?? "(삭제된 프로젝트)") : null,
  });
  // 앱별 키 조회 결과. 예전 결과에 시각이 없으면 전체 점검 시각. 전체 점검에 없던 앱은 PC 에 앱 폴더가 없는 것
  const keyScanOf = (slug: string): KeyScanApp | null => {
    const s = keyScan.apps.find((x) => x.appSlug === slug);

    if (s) return { ...s, at: s.at ?? keyScan.at };

    return keyScan.at ? { appSlug: slug, keys: [], keyProperties: [], missing: true, at: keyScan.at } : null;
  };
  const pwByRef = new Map(keyPasswords.map((k) => [k.keyRef, k]));
  const testApks = await listTestApks([...new Set(jobs.map((j) => j.appSlug))]);
  const seen = new Set<string>();
  const rows = [];
  // 출시 대상이 아닌 앱(목록 아래 '출시 대상이 아닌 앱'). 이름·종류·마지막 일감 상태만
  const others: {
    appSlug: string;
    displayName: string;
    stack: string;
    done: boolean;
    lastJob: { kind: string; status: string; createdAt: Date };
    blockReason: string | null;
    projectId: string | null;
    projectTitle: string | null;
  }[] = [];
  // 마지막 출시 일감의 최근 로그(마스킹). 진행 중이거나 실패한 것만
  const lastRelease = new Map<string, (typeof jobs)[number]>();

  for (const j of jobs) if (j.kind === "release" && j.releaseKind !== "apk" && !lastRelease.has(j.appSlug)) lastRelease.set(j.appSlug, j);
  const logJobs = [...lastRelease.values()].filter((j) => ["running", "failed", "review"].includes(j.status)).slice(0, 30);
  const videos = await reviewVideoInfo([...lastRelease.values()].filter((j) => j.status === "review").map((j) => j.id));
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
    const jobTitle = mine.find((x) => x.kind === "new")?.title ?? j.title;
    const display = pickAppName({ appName: app?.appName, storeTitle: storeTitleOf(app), projectTitle: app?.projectId ? projectTitle.get(app.projectId) : null, jobTitle });

    // 목록에는 출시 대상으로 표시한 앱만(앱 행이 없으면 대상 아님). 새 일감이 생겨도 저절로 들어오지 않는다
    if (!isStoreTarget(app)) {
      others.push({
        appSlug: j.appSlug,
        displayName: display.name,
        stack: j.stack,
        done: mine.some((x) => x.status === "done"),
        lastJob: { kind: j.kind, status: j.status, createdAt: j.createdAt },
        blockReason: storeTargetBlockReason(j.stack),
        ...projectLink(app),
      });
      continue;
    }
    // [삭제]는 출시 대상 표시도 푼다. 다시 추가한 앱은 지운 시각 이전의 출시 일감을 결과로 보이지 않는다
    const lastRelease = mine.find((x) => x.kind === "release" && x.releaseKind !== "apk" && (!removedAt || x.createdAt > removedAt)) ?? null;
    // 시험용 APK 일감은 출시 일감 표시(검토·반영 상태)와 섞지 않고 '시험용 APK' 영역에 따로
    const lastApk = mine.find((x) => x.kind === "release" && x.releaseKind === "apk" && (!removedAt || x.createdAt > removedAt)) ?? null;
    const account = accounts.find((a) => a.id === app?.releaseAccountId) ?? null;
    const key = effectiveKey(app ?? null, account);
    const pw = key ? pwByRef.get(key.ref) : undefined;
    const scan = keyScanOf(j.appSlug);
    const vk = key?.keyId ? vaultById.get(key.keyId) : undefined;
    const legacyKeyPc = key && !key.keyId ? pcStatus?.items.find((i) => i.path === key.path && (i.key.endsWith(".keystore"))) : undefined;
    const saPc = account?.serviceAccountKeyPath ? pcStatus?.items.find((i) => i.key === `${account.label}.serviceAccount` && i.path === account.serviceAccountKeyPath) : undefined;

    rows.push({
      appSlug: j.appSlug,
      title: jobTitle, // 작업 이름(예전 값 그대로)
      // 카드 제목: 직접 정한 이름 → 스토어 문구 앱 이름 → 홈페이지 프로젝트 제목 → 작업 이름
      displayName: display.name,
      nameSource: display.source,
      nameSourceLabel: APP_NAME_SOURCE_LABELS[display.source],
      appName: app?.appName ?? null,
      // 연결된 홈페이지 프로젝트(없으면 null). [홈페이지만 반영]·출시 일감의 홈페이지 반영은 연결이 있어야 한다
      ...projectLink(app),
      // 이미 첫 업로드를 마친 앱(비공개 테스트·출시 상태이거나 최초 AAB 체크): 카드 기본 종류를 스토어 수정으로
      alreadyReleased: !!app?.firstUploadDone || ["testing", "released"].includes(app?.releaseStatus ?? ""),
      requiresTesting: account?.requiresTesting ?? false,
      // 종류별 필요한 준비(✅/⬜/⏳). 부족(⬜)하면 승인을 막는다(서버도 다시 확인)
      readiness: releaseReadiness({
        app: app ? { packageName: app.packageName, firstUploadDone: app.firstUploadDone, releaseAccountId: app.releaseAccountId } : null,
        account,
        accountSecretsRegistered: !!account && names.has(keystorePasswordName(account.label)) && names.has(keyPasswordName(account.label)),
        key: key ? { source: key.source, keyId: key.keyId, name: key.name, path: key.path } : null,
        keyCheckExists: vk ? (vk.check ? vk.check.exists : null) : legacyKeyPc ? legacyKeyPc.exists : null,
        keyPassword: pw?.state ?? "none",
        ownKeyProperties: !!scan && !scan.missing && scan.keyProperties.length > 0,
        serviceAccountExists: saPc ? saPc.exists : null,
        stack: j.stack,
      }),
      stack: j.stack,
      done: mine.some((x) => x.status === "done"),
      // 검토 대기도 진행 중으로 본다(같은 앱의 새 출시 일감·삭제를 막는다)
      active: mine.some((x) => ["pending", "approved", "running", "review"].includes(x.status)),
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
      keyId: app?.keyId ?? null,
      key: key
        ? {
            source: key.source,
            path: key.path,
            alias: key.alias,
            password: pw?.state ?? "none",
            keyId: key.keyId,
            name: key.name,
            kind: key.kind,
            production: key.production,
            // 보관함에서 PC 가 확인한 정보·조회 중·마지막 오류
            check: key.keyId ? (vaultById.get(key.keyId)?.check ?? null) : null,
            checking: key.keyId ? (vaultById.get(key.keyId)?.checking ?? null) : null,
            untracking: key.keyId ? (vaultById.get(key.keyId)?.untracking ?? null) : null,
            untrack: key.keyId ? (vaultById.get(key.keyId)?.untrack ?? null) : null,
            lastError: key.keyId ? (vaultById.get(key.keyId)?.lastError ?? null) : null,
          }
        : null,
      keyScan: keyScanOf(j.appSlug),
      // 시험용 APK: 최근 요청 일감(진행·실패 표시)과 내려받을 수 있는 APK(최신순 최대 5개)
      testApk: {
        supported: apkStackSupported(j.stack),
        job: lastApk
          ? {
              id: lastApk.id,
              status: lastApk.status,
              phase: lastApk.phase,
              phaseLabel: stageLabel(lastApk.phase),
              createdAt: lastApk.createdAt,
              finishedAt: lastApk.finishedAt,
              failStageLabel: lastApk.status === "failed" ? stageLabel(lastApk.failStage ?? lastApk.phase) : null,
              failReason: lastApk.status === "failed" ? (maskSecrets(lastApk.failReason)?.slice(0, 1000) ?? null) : null,
            }
          : null,
        files: testApks.get(j.appSlug) ?? [],
      },
      // 출시 카드 [키 조회] 진행 상태(요청·가져간 시각). 결과가 오면 사라진다
      keyScanRequest: keyScan.appRequests[j.appSlug] ?? null,
      lastReleaseJob: lastRelease
        ? {
            id: lastRelease.id,
            aiEngine: lastRelease.aiEngine,
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
            // 카드에 보일 상태: 생성 중 / 검토 대기 / 반영 중 / 완료 / 실패 / 취소
            state: jobState(lastRelease),
            reviewRequired: lastRelease.reviewRequired,
            reviewAt: lastRelease.reviewAt,
            reviewApprovedAt: lastRelease.reviewApprovedAt,
            redoNote: lastRelease.redoNote,
            summary: ["review", "done", "linkwait"].includes(lastRelease.status) ? (maskSecrets(lastRelease.summary)?.slice(0, 2000) ?? null) : null,
            // 검토 영상: 업로드 서버 주소(store-video)가 있으면 그것, 없으면 예전 방식(DB 조각, 관리자만 재생)
            reviewVideo: (() => {
              const sa = readStoreAssets(app?.storeAssets);
              // 검토 대기·영상 링크 대기·완료(첫 출시 영상 내려받기)에서 쓴다
              const rv = sa?.jobId === lastRelease.id ? sa.reviewVideo : null;
              const old = videos.get(lastRelease.id);

              return rv ? { size: rv.size, url: rv.url, expiresAt: null } : old ? { ...old, url: null } : null;
            })(),
            // 원본 영상(PC 경로). 검토 사본이 줄인 것이면 원본 위치를 알려 준다
            originalVideo: (() => {
              const sa = readStoreAssets(app?.storeAssets);
              const v = sa?.jobId === lastRelease.id ? sa.video : null;

              return v ? { path: v.path, size: v.size, reduced: !!sa?.reviewVideo && v.size !== null && sa.reviewVideo.size !== v.size } : null;
            })(),
            versionName: lastRelease.versionName,
            releaseNotes: lastRelease.releaseNotes,
            buildResult: lastRelease.buildResult,
            updateItems: jobUpdateItems(releaseKindOf(lastRelease.releaseKind), lastRelease.updateItems),
            updateItemsText: (() => {
              const k = releaseKindOf(lastRelease.releaseKind);
              const items = jobUpdateItems(k, lastRelease.updateItems);

              return items ? updateItemsText(k, items) : null;
            })(),
            logs: logs.get(lastRelease.id) ?? [],
          }
        : null,
    });
  }

  return {
    statuses: RELEASE_STATUSES.map((s) => ({ value: s, label: RELEASE_STATUS_LABELS[s] })),
    kinds: RELEASE_KINDS.map((k) => ({
      value: k,
      label: RELEASE_KIND_LABELS[k],
      hint: RELEASE_KIND_HINTS[k],
      canOverwrite: OVERWRITE_KINDS.includes(k),
      items: UPDATE_ITEMS[k] ?? [],
      selectable: SELECTABLE_KINDS.includes(k), // false = 예전 종류(기록 표시용)
      review: REVIEW_KINDS.includes(k),
    })),
    testingDays: TESTING_DAYS,
    accounts: accounts.map(({ defaultKey: _dk, ...a }) => {
      const key = effectiveKey(null, { ...a, defaultKey: _dk });

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
    keyScan: { at: keyScan.at, apps: keyScan.apps.filter((a) => !a.missing), requestedAt: keyScan.requestedAt },
    keys: vault,
    uploadTest: await uploadTestState(), // 통제실 '업로드 시험' 진행·마지막 결과
    keyKinds: Object.entries(KEY_KINDS).map(([value, label]) => ({ value, label })),
    apps: rows,
    otherApps: others,
    // 출시 카드·추가할 때 고를 홈페이지 프로젝트(linkedApp 이 있으면 이미 다른 앱에 연결됨)
    projects: allProjects.map((p) => ({ ...p, linkedApp: linkedApp.get(p.id) ?? null })),
  };
}

export interface AppReleaseInput {
  releaseAccountId?: unknown;
  releaseStatus?: unknown;
  packageName?: unknown;
  firstUploadDone?: unknown;
  customKeystorePath?: unknown;
  customKeyAlias?: unknown;
  keyId?: unknown; // 이 앱이 쓸 키(키 보관함 항목 id). 빈 값이면 배포 계정 기본 키
  appName?: unknown; // 사람이 정한 앱 이름(30자). 빈 값이면 자동
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
    data.keyId = null; // 예전 방식으로 바꾸면 다음 로드 때 보관함으로 가져온다
  }
  if (input.customKeyAlias !== undefined) data.customKeyAlias = cleanStr(input.customKeyAlias, 80);
  // 앱 이름(카드 제목·스토어 문구·홈페이지 빈 제목에 쓴다)
  const nameIn = cleanAppName(input.appName);

  if ("message" in nameIn) return { ok: false, status: 400, message: nameIn.message };
  if (nameIn.value !== undefined) data.appName = nameIn.value;
  // 키 보관함에서 고른 키. 예전 '다른 키' 열은 호환용 사본으로 맞춘다(비우면 같이 비움 → 계정 기본 키)
  if (input.keyId !== undefined) {
    const id = typeof input.keyId === "string" && input.keyId ? input.keyId : null;
    const k = id ? await prisma.factoryKey.findUnique({ where: { id } }) : null;

    if (id && !k) return { ok: false, status: 400, message: "키 보관함에 없는 키예요." };
    data.keyId = k?.id ?? null;
    data.customKeystorePath = k?.keystorePath ?? null;
    data.customKeyAlias = k?.keyAlias ?? null;
  }

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
    storeTarget: false, // 삭제하면 출시 대상 표시도 푼다(다시 넣으려면 '출시 패키지에 추가')
  };

  await prisma.$transaction(slugs.map((appSlug) => prisma.factoryApp.upsert({ where: { appSlug }, create: { appSlug, ...data }, update: data })));

  return { ok: true, status: 200, message: `출시 패키지 목록에서 지웠어요: ${slugs.join(", ")}` };
}

/**
 * 출시 대상 표시 켜기/끄기. 켜면 출시 패키지 목록에 보이고 출시 일감을 보낼 수 있다(nextjs·nestjs 는 안 됨).
 * 끄기는 목록에서만 빠진다: 출시 데이터(배포 계정·패키지 이름·패키지·AAB 정보)는 그대로 남는다. 진행 중 일감이 있으면 막는다.
 * 앱 행이 없으면(일감만 있는 앱) 켤 때 만든다.
 */
export async function setStoreTarget(appSlug: string, on: boolean): Promise<{ ok: boolean; status: number; message: string }> {
  const jobs = await prisma.factoryJob.findMany({ where: { appSlug }, orderBy: { createdAt: "desc" }, select: { stack: true, status: true } });

  if (jobs.length === 0) return { ok: false, status: 404, message: "그런 공장 앱이 없어요." };
  if (on) {
    const reason = storeTargetBlockReason(jobs[0].stack);

    if (reason) return { ok: false, status: 400, message: `${appSlug}: ${reason}(종류 ${jobs[0].stack}).` };
    await prisma.factoryApp.upsert({ where: { appSlug }, create: { appSlug, storeTarget: true }, update: { storeTarget: true } });

    return { ok: true, status: 200, message: `출시 패키지에 추가했어요: ${appSlug}` };
  }
  if (jobs.some((j) => ["pending", "approved", "running"].includes(j.status))) return { ok: false, status: 409, message: `진행 중 일감이 있어요: ${appSlug}` };
  await prisma.factoryApp.updateMany({ where: { appSlug }, data: { storeTarget: false } });

  return { ok: true, status: 200, message: `출시 대상에서 뺐어요: ${appSlug} (출시 데이터는 그대로예요. 다시 추가하면 이어서 써요)` };
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

const PACKAGE_KEYS = ["storeListing", "dataSafety", "contentRating", "checklist", "privacyPolicyDraft", "sdks", "notes", "releaseNotes", "tests"] as const;

export async function receiveReleasePackage(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; message: string }> {
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const job = jobId
    ? await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { appSlug: true, kind: true, status: true, releaseKind: true, updateItems: true } })
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

  // '문구'를 고르지 않은 스토어 자료 수정 일감은 스토어 문구를 바꾸지 않는다
  const skip = kind === "store" && !has(jobUpdateItems(kind, job.updateItems), "listing") ? ["storeListing"] : [];

  for (const k of PACKAGE_KEYS) if (body[k] !== undefined && !skip.includes(k)) pkg[k] = sanitize(body[k]);
  if (JSON.stringify(pkg).length > 200_000) return { ok: false, status: 413, message: "패키지가 너무 커요(200KB 이하)." };

  let aab: Prisma.InputJsonObject | null = null;
  // AAB 정보는 첫 출시·앱 업데이트 일감에서만 받는다
  const a = kind === "first" || kind === "update" ? (body.aab as Record<string, unknown> | undefined) : undefined;

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
  // 첫 출시: 키·빌드·서명 → 패키지 → 스토어 자료(이미지·영상·문구) → 검토 대기 → (승인 뒤) 홈페이지 반영
  first: ["key", "build", "sign", "store", "icon", "screenshots", "video", "listing", "review", "homepage"],
  store: ["icon", "screenshots", "video", "listing", "review", "upload", "homepage"], // review·upload·homepage 는 감독 프로그램(privacy 단계는 갱신 항목으로 고를 때만)
  update: ["code", "test", "version", "key", "build", "sign", "upload", "homepage"],
  project: ["homepage"],
  apk: ["key", "build", "sign", "upload"], // sign = apksigner 확인, upload = 홈페이지로 올리기(감독 프로그램)
};
// 예전(검토 단계가 없던) 일감의 단계. 재시도·표시에만 쓴다
const LEGACY_STAGES: Partial<Record<ReleaseKind, string[]>> = {
  first: ["key", "build", "sign", "store", "upload", "homepage"],
  store: ["icon", "screenshots", "video", "listing", "upload", "homepage"],
};

// 스토어 수정: 갱신 항목 → 단계(review·upload·homepage 는 늘 감독 프로그램이)
const STORE_ITEM_STAGES: Record<string, string[]> = { images: ["icon", "screenshots"], video: ["video"], videoLink: [], listing: ["listing"], privacy: ["privacy"] };

/** 이 일감이 거치는 단계. items 가 null 이면 종류의 전체 단계. review=false 면 예전(검토 없는) 일감 */
export function releaseStages(kind: ReleaseKind, items: string[] | null, review = true): string[] {
  const base = review ? STAGES_BY_KIND[kind] : (LEGACY_STAGES[kind] ?? STAGES_BY_KIND[kind]);

  if (kind !== "store" || !items) return base;
  const wanted = new Set(items.flatMap((i) => STORE_ITEM_STAGES[i] ?? []));

  return ["icon", "screenshots", "video", "listing", "privacy", "review", "upload", "homepage"].filter(
    (s) => wanted.has(s) || (s === "review" && review) || s === "upload" || s === "homepage",
  );
}

// 개인정보처리방침 갱신(store/project 공통)
const PRIVACY_STEPS = [
  "- 코드에서 광고·분석·오류 수집 SDK 를 찾아(pubspec/gradle/package.json 과 import) 판별하고, 지금 앱이 실제로 하는 수집·처리에 맞춰 개인정보처리방침(마크다운)을 새로 쓰세요.",
  "- [[ ... ]] 자리표시자를 남기면 홈페이지가 거절해요. 모두 실제 값으로 채우세요(연락 이메일은 위 배포 계정 정보).",
  '- `.factory/outbox/project.json` 의 "privacyPolicy" 에 넣으세요. 승인 뒤 홈페이지 프로젝트의 기존 방침을 이 내용으로 **덮어써요**.',
  "- Play 의 개인정보처리방침 주소(홈페이지 /project/<이름>/privacy)는 그대로라, 홈페이지 내용이 바뀌면 Play 에서 보이는 내용도 바뀌어요. Play Console 은 건드리지 마세요.",
];

function stageSection(kind: ReleaseKind, items: string[] | null = null): string {
  return [
    "## 진행 단계와 실패 알림",
    `- 단계가 바뀔 때마다 \`.factory/phase.txt\` 에 한 단어를 덮어쓰세요: ${releaseStages(kind, items)
      .filter((s) => !["review", "upload", "homepage"].includes(s))
      .join(", ")} (끝나면 done. review·upload·homepage 는 감독 프로그램이 해요).`,
    '- 더 진행할 수 없으면(빌드·서명 실패 등) `.factory/fail.json` 에 {"stage": "build", "reason": "한국어 한두 문장"} 을 쓰고 끝내세요.',
    "  감독 프로그램이 이걸 보고 그 단계 실패로 알려요. 이유에 비밀번호·키 값은 절대 쓰지 마세요.",
  ].join("\n");
}

// 스토어 자료(.factory/store/) 단계 안내: 이미지·영상·문구 (첫 출시·스토어 수정 공통)
const STORE_IMAGES = [
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
];
const STORE_VIDEO = [
  "## 단계 video: 홍보 영상 (HyperFrames)",
  "- HyperFrames(HeyGen 오픈소스 HTML→MP4, npm 패키지 `hyperframes`, Apache-2.0)로 15~30초 앱 소개 영상 `promo.mp4`(1920x1080 또는 1080x1920)를 만드세요: 스크린샷과 스토어 문구가 움직이게.",
  "- 필요 환경: Node 22 이상, ffmpeg·ffprobe, Chrome(`npx hyperframes doctor` 로 확인). 앱 폴더 밖 임시 폴더에서 `npx hyperframes init` → 구성 HTML 작성 → `npx hyperframes render -c <html> -o <앱 폴더>/.factory/store/promo.mp4`.",
  '- 환경이 안 되거나 렌더가 실패하면 실패로 끝내지 말고 status.json 에 `"video": {"skipped": true, "reason": "이유"}` 를 쓰고 넘어가세요. 확인한 환경(Node·ffmpeg·Chrome·버전·라이선스)을 status.json 의 `"tools": "한두 줄"` 에 적으세요.',
  "- 영상 원본은 PC 에 둬요(검토용 사본은 감독 프로그램이 업로드 서버에 올려 통제실에서 재생해요). YouTube 업로드는 하지 마세요(사람이 직접 올리고 링크만 통제실에 넣어요).",
  "- Play 등록정보의 영상 링크는 감독 프로그램이 통제실에 저장된 링크로 넣어요.",
  "",
];
const STORE_LISTING = [
  "## 단계 listing: 스토어 문구",
  '- `listing.json`: {"ko-KR": {"title": "30자 이내", "shortDescription": "80자 이내", "fullDescription": "4000자 이내"}, "en-US": {...같은 형식}}. 언어 코드는 Play 형식(ko-KR, en-US).',
  "- 영상 링크는 이 폴더에 두지 마세요(통제실에 저장된 링크를 감독 프로그램이 넣어요).",
  "",
];
const REVIEW_NOTE = [
  "## 검토 (감독 프로그램이 해요)",
  "- 다 만들면 감독 프로그램이 파일을 검사해 통제실 **검토 대기**로 올려요. 사람이 확인하고 [이대로 진행]을 눌러야 Play 업로드·홈페이지 반영이 돼요.",
  "- 그러니 여기서 끝낼 때 Play·홈페이지에는 아무것도 하지 마세요. 만든 파일(.factory/store/, .factory/outbox/)은 지우지 마세요(승인 때까지 PC 에 보존).",
  "",
];

export interface ReleasePlanOpts {
  overwriteProject?: boolean;
  updateItems?: string[];
  updateText?: string; // 앱 업데이트: 무엇을 추가·수정할지(필수)
  versionName?: string | null;
  releaseNotes?: string | null;
}

/**
 * 출시 일감(kind=release)에 넣을 지시문. 계정·경로·이름만 들어가고 값은 없다.
 * - first(첫 출시): 키 준비, AAB 빌드, 스토어 문구·체크리스트, 스토어 자료(이미지·영상·문구) → 검토 대기 → (승인 뒤) 홈페이지 빈 칸 채우기.
 *   최초 AAB 는 사람이 Console 에 직접 올린다(Play API 업로드 없음).
 * - store(스토어 수정): 고른 항목만(이미지·문구·홍보 영상·개인정보처리방침) → 검토 대기 → (승인 뒤) Play 업로드·홈페이지 반영은 감독 프로그램이
 * - update(앱 업데이트, 기능 추가): 업데이트 내용대로 코드 수정·시험 → 버전 올림 → 서명 AAB → (최초 업로드한 앱) 비공개 테스트 트랙 업로드
 * - project(프로젝트 업데이트, 예전): 고른 항목만(설명·대표 이미지·개인정보처리방침). Play 업로드·AAB 금지
 * store/project/update 는 opts.overwriteProject 면 홈페이지 프로젝트 기존 값도 바꾼다(update 는 이 체크가 있어야 홈페이지에 반영).
 * 개인정보처리방침은 '개인정보처리방침 갱신'을 골랐을 때만 바꾸고, 그때는 덮어쓰기 선택과 상관없이 덮어쓴다.
 * 키 비밀번호는 requiredSecrets 로 넘기지 않는다. 감독 프로그램이 /next 의 job.release.key 를 보고 필요할 때만 secrets.env 에서 읽는다.
 */
export async function buildReleasePlan(
  appSlug: string,
  kindArg: ReleaseKind = "first",
  opts: ReleasePlanOpts = {},
): Promise<{ ok: true; plan: string; requiredSecrets: string[] } | { ok: false; message: string }> {
  const kind = releaseKindOf(kindArg);
  const app = await prisma.factoryApp.findUnique({ where: { appSlug }, include: { key: true, releaseAccount: { include: { defaultKey: true } } } });
  const acc = app?.releaseAccount ?? null;

  if (!acc) return { ok: false, message: "먼저 출시 패키지 화면에서 이 앱의 배포 계정을 고르세요." };
  const items = jobUpdateItems(kind, opts.updateItems ?? DEFAULT_UPDATE_ITEMS[kind]) ?? [];
  const want = (v: string) => items.includes(v);
  // 고른 항목만 하라는 안내(store/project)
  const scope = () => {
    const defs = UPDATE_ITEMS[kind] ?? [];
    const off = defs.filter((d) => !want(d.value)).map((d) => d.label);

    return [
      "## 이번에 갱신할 항목 (이것만 하세요)",
      ...defs.filter((d) => want(d.value)).map((d) => `- ✅ ${d.label}: ${d.help}`),
      ...(off.length ? [`- ❌ 고르지 않은 항목(${off.join(", ")})은 만들지도, 바꾸지도, 파일로 남기지도 마세요. 감독 프로그램도 그 항목은 올리거나 반영하지 않아요.`] : []),
      "",
    ];
  };

  const head = [
    `# ${RELEASE_KIND_LABELS[kind]} (${appSlug})`,
    "",
    "## 배포 계정",
    `- 계정 ${acc.label}: ${acc.name}${acc.accountType ? ` (${acc.accountType === "organization" ? "조직" : "개인"})` : ""}`,
    `- 개발자 이름: ${acc.developerName ?? "(미정: 체크리스트에 남기기)"}`,
    `- 연락 이메일: ${acc.contactEmail ?? "(미정: 체크리스트에 남기기)"}`,
    `- 비공개 테스트 필요: ${acc.requiresTesting ? "예(테스터 12명·14일). 체크리스트에 넣기" : "아니요"}`,
    `- 패키지 이름(applicationId): ${app?.packageName ?? "(미정: 지금 앱 설정의 applicationId 를 쓰고 release.json notes 에 적기)"}`,
    // 사람이 카드에서 정한 앱 이름: 스토어 문구 제목은 이것으로
    ...(app?.appName
      ? [`- 앱 이름(스토어·홈페이지에 보일 이름, 사람이 정함): **${app.appName}** — 스토어 문구를 만들면 title(ko-KR)은 정확히 이 이름으로 쓰세요(다른 언어는 이 이름을 그 언어 표기로).`]
      : []),
    "",
  ];

  const overwrite = opts.overwriteProject === true && OVERWRITE_KINDS.includes(kind);
  const projectRule = overwrite
    ? "홈페이지 프로젝트 **덮어쓰기**가 선택됐어요: 고른 항목의 값(설명·기술 스택, 대표 이미지, 출시된 앱이면 Play 주소→appLink)이 기존 값을 바꿔요."
    : "홈페이지 프로젝트는 고른 항목 중 **빈 칸만** 채워져요(이미 있는 값은 그대로).";
  const privacyRule = want("privacy")
    ? "개인정보처리방침은 '개인정보처리방침 갱신'을 골랐으니 덮어쓰기 선택과 상관없이 새 내용으로 바뀌어요."
    : "개인정보처리방침은 고르지 않았으니 절대 건드리지 않아요(project.json 에 privacyPolicy 를 넣지 마세요).";
  const key = effectiveKey(app, acc);
  const keySection = (what: string) => [
    `## 서명 키와 AAB (${what})`,
    "- 앱 폴더에 `android/key.properties`(또는 `key.properties`)가 이미 있으면 그 키를 그대로 쓰세요. key.properties 와 그 키 파일은 수정·이동·재생성하지 마세요.",
    key
      ? [
          `- 없으면 ${key.source === "custom" ? "이 앱에 고른 키" : `배포 계정 ${acc.label} 기본 키`}${key.name ? `(키 보관함: ${key.name})` : ""}를 써요: \`${key.path}\` (별칭 ${key.alias}).`,
          "  감독 프로그램이 시작 전에 확인해서(키 파일을 만들거나 바꾸지 않음. 파일이 없으면 키 단계 실패) 환경변수로 넘겨요:",
          "  FACTORY_KEYSTORE_PATH, FACTORY_KEY_ALIAS, FACTORY_KEYSTORE_PASSWORD, FACTORY_KEY_PASSWORD.",
          "- 서명 설정은 빌드 스크립트가 이 환경변수를 읽게 하세요(Flutter: android/app/build.gradle(.kts) 의 signingConfigs.release 에서 System.getenv).",
          "  key.properties 를 새로 만들 때는 storeFile·keyAlias 만 쓰고 비밀번호는 쓰지 마세요. 비밀번호를 파일·로그·커밋·JSON 에 쓰지 마세요.",
          '- 환경변수가 없으면(키 준비 실패) fail.json 에 stage "key" 로 남기고 끝내세요.',
        ].join("\n")
      : "- 이 앱에 쓸 키가 없어요(설정 → 키 보관함). 앱 폴더에 key.properties 도 없으면 AAB 는 만들지 말고 fail.json 에 stage \"key\" 로 남기세요.",
    "- 키 파일을 앱 폴더로 복사하거나 커밋하지 마세요.",
    "",
  ];

  if (kind === "store") {
    const projectFields = [want("listing") ? '"description": "홈페이지 소개 2~3문장", "techStack": [...]' : "", want("privacy") ? '"privacyPolicy": "마크다운"' : ""].filter(Boolean);
    const lines = [
      ...head,
      "이 지시는 **스토어 정보 중 고른 항목만** 다시 만드는 일이에요. 앱 코드·빌드 설정은 바꾸지 마세요(스크린샷용 디버그 빌드는 괜찮아요).",
      "기준 폴더는 앱 폴더의 `.factory/store/` 예요. 파일 이름은 아래 그대로 쓰세요(감독 프로그램이 이 이름만 검사·업로드해요).",
      "",
      ...scope(),
      ...(want("images") ? STORE_IMAGES : []),
      ...(want("video") ? STORE_VIDEO : []),
      ...(want("videoLink") ? ["## 홍보 영상 링크만 반영", "- 할 일 없어요. 감독 프로그램이 통제실에 저장된 링크를 Play 등록정보 영상에 넣어요. 영상 파일을 만들지 마세요.", ""] : []),
      ...(want("listing") ? [...STORE_LISTING.slice(0, -1), "- `.factory/outbox/release.json` 에 storeListing(같은 내용, 키는 ko/en), checklist, notes 만 넣으세요(보낸 항목만 바뀌어요).", ""] : []),
      ...(want("privacy") ? ["## 단계 privacy: 개인정보처리방침 갱신", ...PRIVACY_STEPS, ""] : []),
      "## 홈페이지 프로젝트 (project.json)",
      projectFields.length
        ? `- \`.factory/outbox/project.json\` 에 {${projectFields.join(", ")}} 만 넣으세요(승인 뒤에 반영돼요).`
        : "- `.factory/outbox/project.json` 은 만들지 마세요(필요하면 감독 프로그램이 해요).",
      "",
      ...REVIEW_NOTE,
      "## 승인 뒤 업로드·홈페이지 (감독 프로그램이 해요. 직접 하지 마세요)",
      "- Play 업로드 조건이 맞으면(서비스 계정 키, 패키지 이름, 최초 AAB 업로드 완료) Play Developer API 로 고른 항목만 올려요: 문구→제목·설명, 이미지→종류별 통째 교체, '홍보 영상 링크만 반영'→저장된 링크를 영상에. '홍보 영상 만들기'는 mp4 만 만들고, 링크는 사람이 YouTube 에 올린 뒤 넣어요('영상 링크 대기').",
      `- ${projectRule}`,
      `- ${privacyRule}`,
      "",
      "## 하지 말 것",
      "- AAB 빌드·서명, Play 업로드·Play Console 조작, YouTube 업로드. 키·비밀번호 파일 읽기. 고르지 않은 항목 만들기.",
      "",
      stageSection(kind, items),
    ];

    return { ok: true, plan: lines.join("\n"), requiredSecrets: [] };
  }

  if (kind === "project") {
    const fields = [want("description") ? '"description", "techStack"' : "", want("privacy") ? '"privacyPolicy"' : ""].filter(Boolean);
    const lines = [
      ...head,
      "이 지시는 **홈페이지 프로젝트 정보 중 고른 항목만** 갱신하는 일이에요(예전 종류). 앱 코드·빌드 설정은 바꾸지 마세요.",
      "",
      ...scope(),
      "## 만들 것",
      ...(want("description") ? ["- 지금 앱의 기능을 읽고 홈페이지 소개(description, 2~3문장)와 기술 스택(techStack)을 정리."] : []),
      ...(want("cover") ? ["- 대표 이미지는 서버가 가진 스토어 자료 대표 이미지를 써요. 이미지를 만들지 마세요."] : []),
      ...(want("privacy") ? ["- 개인정보처리방침 갱신:", ...PRIVACY_STEPS.map((l) => `  ${l}`)] : []),
      fields.length
        ? `- \`.factory/outbox/project.json\` 에 {${fields.join(", ")}} 만 넣어 저장.`
        : "- `.factory/outbox/project.json` 에 `{}` 를 저장(서버가 대표 이미지를 넣어요).",
      `- ${projectRule}`,
      `- ${privacyRule}`,
      "",
      "## 하지 말 것",
      "- AAB 빌드·서명, Play 업로드(Play 는 건드리지 않아요), `release.json`. 이 종류에서는 서명 키·비밀번호도 넘기지 않아요.",
      "",
      stageSection(kind),
    ];

    return { ok: true, plan: lines.join("\n"), requiredSecrets: [] };
  }

  if (kind === "apk") {
    const lines = [
      ...head,
      "이 지시는 **실기기 시험용 서명 release APK 를 만드는 일**이에요. 앱 기능·버전·스토어 자료는 바꾸지 마세요. Play Console·Play API 는 건드리지 않아요.",
      "",
      ...keySection("단계 key → build"),
      "## 단계 build: release APK 만들기",
      "- Flutter: `flutter build apk --release` (모든 ABI 가 든 APK 하나). 버전(pubspec.yaml 의 version)은 지금 값 그대로 두세요.",
      "- 서명은 반드시 위 키로(앱 자체 key.properties 또는 FACTORY_KEYSTORE_* 환경변수). 디버그 키로 서명되면 감독 프로그램이 거절해요.",
      "  서명 설정이 아직 없으면 android/app/build.gradle(.kts) 의 signingConfigs.release 만 고치세요(환경변수를 읽게). 그 밖의 코드는 바꾸지 마세요.",
      '- 다 만들면 `.factory/apk.json` 에 {"path": "build/app/outputs/flutter-apk/app-release.apk", "versionName": "1.0.0", "versionCode": 1} 를 쓰세요(경로는 앱 폴더 기준).',
      "- APK 는 PC 에만 두세요. 서버로 올리는 일(검사·홈페이지 업로드)은 감독 프로그램이 해요(sign = apksigner 확인, upload).",
      "",
      "## 하지 말 것",
      "- AAB·Play 업로드·스토어 자료·홈페이지 프로젝트 반영. 키 파일 복사·커밋, 비밀번호를 파일·로그·JSON 에 쓰기, 새 키 만들기.",
      "",
      stageSection(kind),
    ];

    return { ok: true, plan: lines.join("\n"), requiredSecrets: [] };
  }

  if (kind === "update") {
    const lastVersion = (app?.aab as { versionName?: string | null; versionCode?: number | null } | null) ?? null;
    const lines = [
      ...head,
      "이 지시는 **앱에 기능을 추가·수정해 새 버전을 내는 일(앱 업데이트)**이에요. 아래 '업데이트 내용'만 고치고, 그 밖의 기능·설정은 바꾸지 마세요.",
      "",
      "## 업데이트 내용 (이것만 바꾸세요)",
      (opts.updateText ?? "").trim() || "(내용 없음: fail.json 에 stage \"code\" 로 남기고 끝내세요)",
      "",
      "## 단계 code → test: 코드 수정과 시험",
      "- 기존 기획은 PLAN.md 를 참고하되 요청 밖의 부분은 바꾸지 마세요. 수정 지시(revision)와 같은 방식으로 고치세요.",
      "- 끝내기 전에 그 앱 종류의 분석·시험을 통과시키세요(Flutter: flutter analyze, flutter test). 결과를 release.json 의 \"tests\" 에 한두 줄로 적으세요.",
      "",
      "## 단계 version: 버전 올리기",
      opts.versionName
        ? `- 버전 이름을 **${opts.versionName}** 로 바꾸세요.`
        : `- 버전 이름은 지금 버전의 patch 를 1 올리세요(예: 1.2.3 → 1.2.4)${lastVersion?.versionName ? `. 마지막으로 만든 AAB: ${lastVersion.versionName}` : ""}.`,
      `- 버전 코드는 지금 값에서 1 올리세요(Play 에 올라간 값보다 커야 해요${lastVersion?.versionCode ? `. 마지막으로 만든 AAB 의 버전 코드: ${lastVersion.versionCode}` : ""}). Flutter 는 pubspec.yaml 의 version: 이름+코드.`,
      "",
      ...keySection("단계 key → build → sign"),
      "- 서명된 릴리스 AAB 를 만들고(Flutter: flutter build appbundle --release), 경로·버전을 release.json 의 aab 에 적으세요. AAB 는 PC 에만 둡니다(서버로 올리지 않음).",
      "",
      "## 출시 노트 (What's new)",
      opts.releaseNotes
        ? `- 사람이 정한 출시 노트예요. 그대로 release.json 의 "releaseNotes": {"ko-KR": "..."} 에 넣으세요:\n${opts.releaseNotes}`
        : '- 업데이트 내용을 바탕으로 500자 이내 출시 노트를 쓰세요: release.json 의 "releaseNotes": {"ko-KR": "...", "en-US": "..."}.',
      "",
      "## 업로드·홈페이지 (감독 프로그램이 해요. 직접 하지 마세요)",
      `- 최초 AAB 업로드를 마친 앱이라, release.json 의 aab 를 감독 프로그램이 Play Developer API 로 **비공개 테스트 트랙(${PLAY_TEST_TRACK})**에 올려요(출시 노트 포함). 프로덕션 승격은 사람이 Console 에서 해요.`,
      overwrite
        ? '- 홈페이지 프로젝트 반영이 선택됐어요: `.factory/outbox/project.json` 에 {"description": "새 기능이 들어간 소개 2~3문장", "techStack": [...]} 를 넣으세요(기존 값을 바꿔요).'
        : "- 홈페이지 프로젝트는 바꾸지 않아요(project.json 을 만들지 마세요).",
      "",
      "## 하지 말 것",
      "- fastlane·API 로 직접 업로드, 프로덕션 트랙, 키·비밀번호 파일 읽기, 업데이트 내용 밖의 기능 변경.",
      "",
      stageSection(kind),
    ];

    return { ok: true, plan: lines.join("\n"), requiredSecrets: [] };
  }

  // 첫 출시
  const lines = [
    ...head,
    "이 지시는 스토어 첫 출시에 필요한 자료를 만드는 일이에요. 앱 기능은 바꾸지 마세요(출시에 꼭 필요한 설정 변경만).",
    "",
    "## 만들 것 (.factory/outbox/ 에 JSON 으로. 작업 규칙의 '출시 준비' 항목 형식 그대로)",
    "1. 개인정보처리방침 초안: 코드에서 광고·분석·오류 수집 SDK 를 찾아(pubspec/gradle/package.json 과 import) 판별하고, 홈페이지 템플릿(아래 구성)에 맞춰 작성.",
    "2. 스토어 문구 한국어/영어: 제목(30자), 짧은 설명(80자), 자세한 설명(4000자 이내). release.json 의 storeListing 과 아래 listing.json 에 같은 내용.",
    "3. 데이터 보안 답안: 수집·공유 여부, 데이터 유형별 목적, 암호화 전송, 삭제 요청 방법.",
    "4. 콘텐츠 등급 설문 답안(IARC): 폭력·성적 내용·언어·약물·도박·사용자 상호작용·위치 공유·디지털 구매.",
    "5. 출시 체크리스트: 사람이 Play Console 에서 할 일(최초 AAB 직접 업로드, 스토어 문구·이미지 입력 등).",
    "6. 홈페이지 프로젝트 빈 칸: project.json (승인 뒤에 빈 칸만 채워요).",
    "",
    ...keySection("단계 key → build → sign"),
    "- 서명된 릴리스 AAB 를 만들고(Flutter: flutter build appbundle --release), 경로·버전을 release.json 의 aab 에 적으세요. AAB 는 PC 에만 둡니다(서버로 올리지 않음).",
    "- 최초 AAB 는 사람이 Play Console 에 직접 올려요(Play API 로는 올리지 않아요). 체크리스트에 '최초 AAB 직접 업로드'를 넣으세요. 이후 새 버전은 '앱 업데이트' 종류로 내요.",
    "",
    "## 스토어 자료 (.factory/store/, 단계 icon → screenshots → video → listing)",
    "- 기준 폴더는 앱 폴더의 `.factory/store/` 예요. 파일 이름은 아래 그대로 쓰세요. 사람이 검토한 뒤 Console 에 직접 넣어요.",
    "",
    ...STORE_IMAGES,
    ...STORE_VIDEO,
    ...STORE_LISTING,
    ...REVIEW_NOTE,
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
    prisma.factoryJob.findMany({
      where: { id: { in: rel.map((j) => j.id) } },
      select: {
        id: true,
        releaseKind: true,
        resumeFrom: true,
        resumeNote: true,
        overwriteProject: true,
        updateItems: true,
        reviewRequired: true,
        reviewApprovedAt: true,
        redoNote: true,
        releaseNotes: true,
      },
    }),
    prisma.factoryApp.findMany({ where: { appSlug: { in: rel.map((j) => j.appSlug) } }, include: { key: true, releaseAccount: { include: { defaultKey: true } } } }),
  ]);
  const pcStatus = await getPcPathStatus().catch(() => null);

  for (const j of rel) {
    const r = rows.find((x) => x.id === j.id);
    const kind = releaseKindOf(r?.releaseKind);
    const app = apps.find((a) => a.appSlug === j.appSlug) ?? null;
    const acc = app?.releaseAccount ?? null;
    const key = kind === "first" || kind === "update" || kind === "apk" ? effectiveKey(app, acc) : null;
    const names = key ? keySecretNames(key.ref) : null;
    const items = jobUpdateItems(kind, r?.updateItems);
    const reviewRequired = r?.reviewRequired === true;
    const approved = !!r?.reviewApprovedAt;

    out.set(j.id, {
      kind,
      kindLabel: RELEASE_KIND_LABELS[kind],
      stages: releaseStages(kind, items, reviewRequired),
      // 검토 단계: required 면 감독 프로그램은 자료를 만든 뒤 검토 대기로 보고만 하고(업로드·홈페이지·완료 없음),
      // approved(사람이 [이대로 진행])일 때만 반영 단계(Play 업로드·홈페이지)를 한다. redoNote 는 [다시 만들기] 메모
      review: reviewRequired ? { required: true, approved, redoNote: approved ? null : (r?.redoNote ?? null) } : null,
      // 이 서버는 '영상 링크 대기'(status=linkwait)를 받는다: '홍보 영상 만들기'를 고른 스토어 수정은 반영 뒤 완료 대신 링크 대기로 보고
      videoLinkWait: kind === "store" && !!items?.includes("video"),
      // 고른 갱신 항목(store: images·listing·video·privacy, project: description·cover·privacy). null 이면 예전 일감(전부, 예전 동작)
      items,
      itemsLabel: items ? updateItemsText(kind, items) : null,
      outbox: OUTBOX_BY_KIND[kind],
      resumeFrom: r?.resumeFrom && RESUMABLE.includes(r.resumeFrom) ? r.resumeFrom : null,
      resumeNote: r?.resumeNote ?? null,
      overwriteProject: OVERWRITE_KINDS.includes(kind) && r?.overwriteProject === true,
      // Play Developer API 업로드(감독 프로그램이 직접): 스토어 자료 수정 = 등록정보·이미지, 첫 출시 = 업데이트 AAB → 비공개 테스트 트랙.
      // 서비스 계정 키는 경로만 준다(감독 프로그램이 읽어 토큰을 받고, 내용은 어디에도 보내지 않는다). missing 이 있으면 업로드하지 않는다.
      // 첫 출시(검토 단계가 있는 새 일감)는 Play 에 올리지 않는다(최초 AAB 는 사람이 Console 에 직접). 예전 첫 출시 일감만 업데이트 AAB 업로드.
      // 시험용 APK: 올릴 수 있는 최대 크기(감독 프로그램이 미리 확인)
      ...(kind === "apk" ? { apk: { maxBytes: TEST_APK_MAX, keyLabel: key ? (key.name ?? key.path) : null } } : {}),
      play:
        kind === "project" || kind === "apk" || (kind === "first" && reviewRequired)
          ? null
          : {
              packageName: app?.packageName ?? null,
              serviceAccountKeyPath: acc?.serviceAccountKeyPath ?? null,
              track: PLAY_TEST_TRACK,
              // Play 등록정보 영상 링크: '링크만 반영'을 골랐거나 '영상 링크 대기'에서 링크를 넣은 뒤(videolink)만. 예전 일감(항목 없음)은 예전처럼
              videoUrl:
                kind === "store" && (items === null || items.includes("videoLink") || r?.resumeFrom === "videolink") ? (app?.promoVideoUrl ?? null) : null,
              // 앱 업데이트 출시 노트(What's new). release.json 의 releaseNotes 가 있으면 감독 프로그램이 그걸 먼저 쓴다
              releaseNotes: kind === "update" ? (r?.releaseNotes ?? null) : null,
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
              // 출시 일감은 키를 만들지 않는다(운영 키 보호). 키는 설정 → 키 보관함의 [새 공용 키 만들기]에서만 만든다
              generate: false,
              keyId: key.keyId,
              vaultName: key.name, // 보관함 이름(표시용)
              missingMessage:
                key.keyId && (key.createState === "requested" || key.createState === "creating")
                  ? `키 '${key.name}' 를 작업 PC 가 아직 만드는 중이에요. 설정 → 키 보관함에서 만들기가 끝난 뒤 재시도하세요.`
                  : `키 파일이 없어요(${key.path}). 설정 → 키 보관함에서 만들거나 등록하세요.`,
              dname: `CN=${dnamePart(acc.developerName) || dnamePart(acc.name) || "App Factory"}, C=KR`,
            }
          : null,
    });
  }

  return out;
}

/**
 * project.json 을 받아도 되는 일감인지. jobId 가 없으면(예전 감독 프로그램) 예전처럼 빈 칸만 채운다.
 * release: 출시 일감이면 그 종류. overwrite: 덮어쓰기를 고른 store/project 일감
 * fields: 고른 갱신 항목으로 받을 수 있는 칸(null 이면 예전 일감: 전부, 개인정보처리방침은 빈 칸만)
 * privacyOverwrite: '개인정보처리방침 갱신'을 고른 일감(덮어쓰기 선택과 상관없이 방침을 바꾼다)
 */
export type ProjectField = "title" | "description" | "techStack" | "coverImage" | "appLink" | "privacyPolicy";
const ITEM_FIELDS: Record<string, ProjectField[]> = {
  listing: ["title", "description", "techStack", "appLink"], // store: 문구(앱 이름 포함)
  description: ["title", "description", "techStack", "appLink"], // project: 설명
  images: ["coverImage"],
  cover: ["coverImage"],
  video: [], // 홈페이지 Project 에는 영상 칸이 없다(Play 에만)
  videoLink: [],
  privacy: ["privacyPolicy"],
};

export async function projectFillAllowed(
  jobId: unknown,
): Promise<
  | { ok: true; release: ReleaseKind | null; overwrite: boolean; fields: ProjectField[] | null; privacyOverwrite: boolean }
  | { ok: false; message: string }
> {
  const legacy = { ok: true as const, release: null, overwrite: false, fields: null, privacyOverwrite: false };

  if (typeof jobId !== "string" || !jobId) return legacy;
  const job = await prisma.factoryJob.findUnique({
    where: { id: jobId },
    select: { kind: true, releaseKind: true, overwriteProject: true, updateItems: true, reviewRequired: true, reviewApprovedAt: true },
  });

  if (!job || job.kind !== "release") return legacy;
  const kind = releaseKindOf(job.releaseKind);

  if (!OUTBOX_BY_KIND[kind].includes("project.json")) return { ok: false, message: `${RELEASE_KIND_LABELS[kind]} 일감은 홈페이지 프로젝트를 바꿀 수 없어요.` };
  // 검토 안 된 자료가 홈페이지에 먼저 나가지 않게: [이대로 진행] 전에는 받지 않는다
  if (job.reviewRequired && !job.reviewApprovedAt) return { ok: false, message: "검토 승인([이대로 진행]) 전이라 홈페이지 프로젝트에 반영하지 않아요." };
  // 앱 업데이트는 '홈페이지 프로젝트도 반영'을 골랐을 때만
  if (kind === "update" && !job.overwriteProject) return { ok: false, message: "이 앱 업데이트는 홈페이지 프로젝트 반영을 고르지 않았어요." };
  const items = jobUpdateItems(kind, job.updateItems);

  return {
    ok: true,
    release: kind,
    overwrite: OVERWRITE_KINDS.includes(kind) && job.overwriteProject,
    fields: items ? [...new Set(items.flatMap((i) => ITEM_FIELDS[i] ?? []))] : null,
    privacyOverwrite: !!items?.includes("privacy"),
  };
}

// ───────── 검토 결정 (검토 대기 → 이대로 진행 / 다시 만들기 / 취소) ─────────

export type ReviewDecision = "approve" | "redo" | "cancel";

/**
 * 검토 대기(status=review) 일감의 결정.
 * - approve: 반영 단계부터(스토어 수정 = Play 업로드부터, 첫 출시 = 홈페이지 반영) 감독 프로그램이 Claude 없이 한다
 * - redo: 메모(필수)를 넣어 생성부터 다시(메모에 적힌 항목만 다시 만들도록 지시문에 붙는다)
 * - cancel: 취소(PC 의 자료는 그대로)
 * 어느 쪽이든 검토 영상은 지운다.
 */
export async function reviewDecision(jobId: string, decision: unknown, noteIn: unknown): Promise<{ ok: boolean; status: number; message: string }> {
  const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { kind: true, status: true, appSlug: true, releaseKind: true, reviewRequired: true } });

  if (!job || job.kind !== "release" || !job.reviewRequired) return { ok: false, status: 404, message: "검토 단계가 있는 출시 일감이 아니에요." };
  if (job.status !== "review") return { ok: false, status: 409, message: `검토 대기가 아니에요(지금 ${job.status}).` };
  const kind = releaseKindOf(job.releaseKind);
  const now = new Date();
  let data: Prisma.FactoryJobUpdateManyMutationInput;
  let message: string;
  let logMsg: string;

  if (decision === "approve") {
    const resumeFrom = kind === "store" ? "upload" : "homepage";

    data = { status: "approved", approvedAt: now, reviewApprovedAt: now, resumeFrom, resumeNote: null, redoNote: null, attempts: 0, workerId: null, leaseUntil: null, phase: null };
    message = kind === "store" ? "승인했어요. 작업 PC 가 Play 업로드·홈페이지 반영을 해요." : "승인했어요. 작업 PC 가 홈페이지 프로젝트 빈 칸을 채우고 AAB 위치를 알려 줘요.";
    logMsg = "검토 승인([이대로 진행])";
  } else if (decision === "redo") {
    const note = typeof noteIn === "string" ? noteIn.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 2000) : "";

    if (!note) return { ok: false, status: 400, message: "무엇을 다시 만들지 메모를 적어 주세요(예: 스크린샷 3번 다시, 아이콘 색 밝게)." };
    data = { status: "approved", approvedAt: now, reviewApprovedAt: null, reviewAt: null, resumeFrom: null, resumeNote: null, redoNote: maskSecrets(note), attempts: 0, workerId: null, leaseUntil: null, phase: null, summary: null };
    message = "다시 만들기를 요청했어요. 작업 PC 가 메모의 항목만 다시 만든 뒤 다시 검토 대기로 와요.";
    logMsg = `다시 만들기 요청: ${maskSecrets(note).slice(0, 300)}`;
  } else if (decision === "cancel") {
    data = { status: "cancelled", finishedAt: now, leaseUntil: null };
    message = "취소했어요. 작업 PC 의 자료는 그대로 있어요.";
    logMsg = "검토에서 취소";
  } else return { ok: false, status: 400, message: "decision 은 approve, redo, cancel 중 하나예요." };

  const res = await prisma.factoryJob.updateMany({ where: { id: jobId, status: "review" }, data });

  if (res.count === 0) return { ok: false, status: 409, message: "이미 다른 곳에서 처리됐어요." };
  await deleteReviewVideo(jobId).catch(() => {});
  await prisma.factoryJobLog.create({ data: { jobId, level: "info", message: logMsg } });

  return { ok: true, status: 200, message };
}

// ───────── 영상 링크 대기 (스토어 수정 '홍보 영상 만들기' 뒤) ─────────

/**
 * [링크 반영]: 링크(youtube.com/watch, youtu.be)를 앱에 저장하고, 감독 프로그램이 Play 등록정보 영상만 바꾸도록(videolink 단계부터, Claude 없이) 다시 대기열에 넣는다.
 * 같은 앱의 다른 일감이 돌고 있으면 끝난 뒤에 하라고 거절한다.
 */
export async function applyVideoLink(jobId: string, raw: unknown): Promise<{ ok: boolean; status: number; message: string }> {
  const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { kind: true, status: true, appSlug: true } });

  if (!job || job.kind !== "release") return { ok: false, status: 404, message: "없는 출시 일감이에요." };
  if (job.status !== "linkwait") return { ok: false, status: 409, message: `영상 링크 대기가 아니에요(지금 ${job.status}).` };
  const busy = await prisma.factoryJob.count({ where: { appSlug: job.appSlug, id: { not: jobId }, status: { in: [...ACTIVE_STATUSES] } } });

  if (busy > 0) return { ok: false, status: 409, message: "같은 앱의 진행 중인 일감이 끝난 뒤에 링크를 반영하세요." };
  const saved = await savePromoVideoUrl(job.appSlug, raw);

  if (!saved.ok) return saved;
  if (raw === null || (typeof raw === "string" && !raw.trim())) return { ok: false, status: 400, message: "YouTube 링크를 넣어 주세요." };
  const res = await prisma.factoryJob.updateMany({
    where: { id: jobId, status: "linkwait" },
    data: { status: "approved", approvedAt: new Date(), resumeFrom: "videolink", resumeNote: null, attempts: 0, workerId: null, leaseUntil: null, phase: null },
  });

  if (res.count === 0) return { ok: false, status: 409, message: "이미 다른 곳에서 처리됐어요." };
  await prisma.factoryJobLog.create({ data: { jobId, level: "info", message: "영상 링크 반영 요청" } });

  return { ok: true, status: 200, message: "링크를 저장했어요. 작업 PC 가 Play 등록정보 영상만 바꾸고 일감을 완료로 닫아요." };
}

/** [영상 링크 없이 마치기]: 링크 대기 일감을 완료로 닫는다(링크는 나중에 '홍보 영상 링크만 반영'으로) */
export async function finishWithoutVideoLink(jobId: string): Promise<{ ok: boolean; status: number; message: string }> {
  const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { kind: true, status: true, summary: true } });

  if (!job || job.kind !== "release") return { ok: false, status: 404, message: "없는 출시 일감이에요." };
  if (job.status !== "linkwait") return { ok: false, status: 409, message: `영상 링크 대기가 아니에요(지금 ${job.status}).` };
  const summary = `${job.summary ?? ""}\n- 영상 링크 없이 마쳤어요(나중에 스토어 수정의 '홍보 영상 링크만 반영'으로 넣을 수 있어요)`.trim().slice(0, 4000);
  const res = await prisma.factoryJob.updateMany({ where: { id: jobId, status: "linkwait" }, data: { status: "done", finishedAt: new Date(), summary, phase: "done" } });

  if (res.count === 0) return { ok: false, status: 409, message: "이미 다른 곳에서 처리됐어요." };
  await prisma.factoryJobLog.create({ data: { jobId, level: "info", message: "영상 링크 없이 마침" } });

  return { ok: true, status: 200, message: "영상 링크 없이 완료로 닫았어요." };
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

