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
  notes?: unknown;
}

export async function saveReleaseAccount(input: AccountInput): Promise<{ ok: boolean; status: number; message: string }> {
  const label = typeof input.label === "string" ? input.label.trim().toUpperCase() : "";

  if (!LABEL_RE.test(label)) return { ok: false, status: 400, message: "계정 라벨은 영문 대문자 한 글자예요(예: A, B)." };
  const name = cleanStr(input.name, 60);

  if (!name) return { ok: false, status: 400, message: "계정 이름이 필요해요." };
  const email = cleanStr(input.contactEmail, 120);

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, status: 400, message: "연락 이메일 형식이 올바르지 않아요." };
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

// ───────── 앱별 출시 상태 ─────────

/** 통제실 "출시 패키지" 화면에 필요한 것 전부. 키 값은 없다(경로·이름·존재 여부만). */
export async function releaseOverview() {
  const [accounts, apps, jobs, pcStatus, secretNames] = await Promise.all([
    prisma.factoryReleaseAccount.findMany({ orderBy: { label: "asc" } }),
    prisma.factoryApp.findMany(),
    prisma.factoryJob.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, appSlug: true, title: true, kind: true, stack: true, status: true, createdAt: true, finishedAt: true },
    }),
    getPcPathStatus(),
    prisma.factorySecretName.findMany({ select: { name: true } }),
  ]);
  const appBySlug = new Map(apps.map((a) => [a.appSlug, a]));
  const names = new Set(secretNames.map((s) => s.name));
  const seen = new Set<string>();
  const rows = [];

  for (const j of jobs) {
    if (seen.has(j.appSlug)) continue;
    seen.add(j.appSlug);
    const mine = jobs.filter((x) => x.appSlug === j.appSlug);
    const app = appBySlug.get(j.appSlug);
    const removedAt = app?.releaseRemovedAt ?? null;

    // 목록에서 지운 앱은 그 뒤에 새 일감이 생기기 전까지 숨긴다(지시 기록은 그대로 남아 있다)
    if (removedAt && !mine.some((x) => x.createdAt > removedAt)) continue;
    const lastRelease = mine.find((x) => x.kind === "release" && (!removedAt || x.createdAt > removedAt)) ?? null;

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
      lastReleaseJob: lastRelease ? { id: lastRelease.id, status: lastRelease.status, finishedAt: lastRelease.finishedAt } : null,
    });
  }

  return {
    statuses: RELEASE_STATUSES.map((s) => ({ value: s, label: RELEASE_STATUS_LABELS[s] })),
    testingDays: TESTING_DAYS,
    accounts: accounts.map((a) => ({
      ...a,
      secretNames: { keystore: keystorePasswordName(a.label), key: keyPasswordName(a.label) },
      secretNamesRegistered: names.has(keystorePasswordName(a.label)) && names.has(keyPasswordName(a.label)),
    })),
    pcStatus,
    apps: rows,
  };
}

export interface AppReleaseInput {
  releaseAccountId?: unknown;
  releaseStatus?: unknown;
  packageName?: unknown;
  firstUploadDone?: unknown;
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
  const job = jobId ? await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { appSlug: true, kind: true, status: true } }) : null;

  if (!job) return { ok: false, status: 404, message: "없는 지시입니다." };
  if (job.kind !== "release") return { ok: false, status: 400, message: "출시 준비 일감만 패키지를 보낼 수 있어요." };
  if (job.status !== "running") return { ok: false, status: 409, message: `지시가 실행 중이 아닙니다(${job.status}).` };

  const pkg: Record<string, unknown> = {};

  for (const k of PACKAGE_KEYS) if (body[k] !== undefined) pkg[k] = sanitize(body[k]);
  if (JSON.stringify(pkg).length > 200_000) return { ok: false, status: 413, message: "패키지가 너무 커요(200KB 이하)." };

  let aab: Prisma.InputJsonObject | null = null;
  const a = body.aab as Record<string, unknown> | undefined;

  if (a && typeof a === "object" && typeof a.path === "string") {
    aab = {
      path: a.path.slice(0, 300),
      size: typeof a.size === "number" ? a.size : null,
      versionName: typeof a.versionName === "string" ? a.versionName.slice(0, 40) : null,
      versionCode: typeof a.versionCode === "number" ? a.versionCode : null,
      builtAt: typeof a.builtAt === "string" ? a.builtAt.slice(0, 40) : null,
    };
  }

  const cur = await prisma.factoryApp.findUnique({ where: { appSlug: job.appSlug } });
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

// ───────── 출시 준비 일감 기획서 ─────────

/** 출시 준비 일감(kind=release)에 넣을 지시문과 필요한 키 이름. 계정·경로·이름만 들어가고 값은 없다. */
export async function buildReleasePlan(appSlug: string): Promise<{ ok: true; plan: string; requiredSecrets: string[] } | { ok: false; message: string }> {
  const app = await prisma.factoryApp.findUnique({ where: { appSlug }, include: { releaseAccount: true } });
  const acc = app?.releaseAccount ?? null;

  if (!acc) return { ok: false, message: "먼저 출시 패키지 화면에서 이 앱의 배포 계정을 고르세요." };

  const signing = !!acc.keystorePath;
  const upload = signing && !!acc.serviceAccountKeyPath && app?.firstUploadDone === true && !!app?.packageName;
  const requiredSecrets = signing ? [keystorePasswordName(acc.label), keyPasswordName(acc.label)] : [];
  const lines = [
    `# 출시 준비 (${appSlug})`,
    "",
    "이 지시는 스토어 출시에 필요한 자료를 만드는 일이에요. 앱 기능은 바꾸지 마세요(출시에 꼭 필요한 설정 변경만).",
    "",
    "## 배포 계정",
    `- 계정 ${acc.label}: ${acc.name}`,
    `- 개발자 이름: ${acc.developerName ?? "(미정: 체크리스트에 남기기)"}`,
    `- 연락 이메일: ${acc.contactEmail ?? "(미정: 체크리스트에 남기기)"}`,
    `- 비공개 테스트 필요: ${acc.requiresTesting ? "예(테스터 12명·14일). 체크리스트에 넣기" : "아니요"}`,
    `- 패키지 이름(applicationId): ${app?.packageName ?? "(미정: 지금 앱 설정의 applicationId 를 쓰고 release.json notes 에 적기)"}`,
    "",
    "## 만들 것 (.factory/outbox/ 에 JSON 으로. 작업 규칙의 '출시 준비' 항목 형식 그대로)",
    "1. 개인정보처리방침 초안: 코드에서 광고·분석·오류 수집 SDK 를 찾아(pubspec/gradle/package.json 과 import) 판별하고, 홈페이지 템플릿(아래 구성)에 맞춰 작성.",
    "2. 스토어 문구 한국어/영어: 제목(30자), 짧은 설명(80자), 자세한 설명(4000자 이내).",
    "3. 데이터 보안 답안: 수집·공유 여부, 데이터 유형별 목적, 암호화 전송, 삭제 요청 방법.",
    "4. 콘텐츠 등급 설문 답안(IARC): 폭력·성적 내용·언어·약물·도박·사용자 상호작용·위치 공유·디지털 구매.",
    "5. 출시 체크리스트: 사람이 Play Console 에서 할 일, 그래픽(아이콘 512, 그래픽 이미지 1024x500, 스크린샷) 준비 여부.",
    "",
    "## AAB",
    signing
      ? [
          `- 서명 키: \`${acc.keystorePath}\` (별칭 ${acc.keyAlias ?? "(PC 에서 확인)"})`,
          `- 비밀번호는 환경변수 ${keystorePasswordName(acc.label)}, ${keyPasswordName(acc.label)} 로만 읽으세요. 파일·로그·커밋에 쓰지 마세요.`,
          "- 서명된 릴리스 AAB 를 만들고(Flutter: flutter build appbundle --release), 경로·버전을 release.json 의 aab 에 적으세요. AAB 는 PC 에만 둡니다(서버로 올리지 않음).",
          "- 키 파일을 앱 폴더로 복사하거나 커밋하지 마세요(key.properties 는 .gitignore 에 있고, 경로만 참조).",
        ].join("\n")
      : "- 이 계정에 서명 키 경로가 없어서 AAB 는 만들지 않아요. 체크리스트에 '서명 키 준비'를 넣으세요.",
    "",
    "## 스토어 업로드",
    upload
      ? [
          `- 최초 업로드를 마친 앱이라 Play Developer API 로 **비공개 테스트 트랙(alpha)** 에만 올리세요. 서비스 계정 키: \`${acc.serviceAccountKeyPath}\`.`,
          "- fastlane supply 또는 google-api-python-client 중 이 PC 에 쉽게 쓸 수 있는 것을 쓰세요. 설치가 필요하면 앱 폴더 밖 임시 위치에.",
          "- 프로덕션 트랙에는 절대 올리지 마세요(프로덕션은 사람이 '라이브러리에서 추가'로 진행). 결과를 release.json notes 에 적으세요.",
        ].join("\n")
      : "- 이번에는 업로드하지 않아요(최초 업로드는 사람이 Play Console 에 직접). 체크리스트에 '최초 AAB 직접 업로드'를 넣으세요.",
  ];

  return { ok: true, plan: lines.join("\n"), requiredSecrets };
}
