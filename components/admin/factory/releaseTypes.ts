// components/admin/factory/releaseTypes.ts
// 출시 패키지 화면(GET /api/admin/factory/release)이 돌려주는 모양.

export interface ReleaseAccount {
  id: string;
  label: string;
  name: string;
  requiresTesting: boolean;
  developerName: string | null;
  contactEmail: string | null;
  keystorePath: string | null;
  keyAlias: string | null;
  serviceAccountKeyPath: string | null;
  developerAccountId: string | null;
  accountType: string | null; // personal | organization
  loginEmail: string | null;
  playConsoleUrl: string | null;
  notes: string | null;
  secretNames: { keystore: string; key: string };
  secretNamesRegistered: boolean;
  keyPassword: KeyPasswordState | null; // 공용 키 비밀번호 등록 상태(키 경로가 없으면 null)
  defaultKeyId: string | null; // 기본 키(키 보관함)
}

// 키 보관함: PC 에서 확인된 정보(값·개인키 없음)
export interface KeyCheck {
  at: string;
  exists: boolean;
  size: number | null;
  mtime: string | null;
  type: string | null;
  aliases: { alias: string; sha1: string | null }[];
  aliasFound: boolean | null;
  passwordOk: boolean | null;
  inApp: string | null;
  gitTracked: boolean | null;
  note: string | null;
}

// [커밋에서 빼기] 결과(서버 lib/factory/keyVault.ts 의 KeyUntrack 과 같다)
export interface KeyUntrack {
  at: string;
  ok: boolean;
  message: string | null;
  file: string | null;
  wasTracked: boolean;
  stagedOnly: boolean;
  commits: { hash: string; date: string | null; subject: string | null }[];
  hasRemote: boolean | null;
  remotes: string[];
  pushed: { commit: string; branches: string[] }[];
  untracked: boolean;
  gitignoreAdded: string[];
  commit: string | null;
  stillTracked: boolean | null;
}

export interface VaultKey {
  id: string;
  name: string;
  kind: "shared" | "app";
  kindLabel: string;
  keystorePath: string;
  keyAlias: string;
  description: string | null;
  production: boolean;
  dname: string | null;
  createState: string | null; // requested | creating | done | failed | null(등록한 키)
  check: KeyCheck | null;
  checking: "requested" | "taken" | null;
  untracking: "requested" | "taken" | null;
  untrack: KeyUntrack | null;
  lastError: string | null;
  lastErrorAt: string | null;
  password: KeyPasswordState;
  usedBy: { accounts: string[]; apps: string[] };
  createdAt: string;
}

// none: 미등록, waiting: 서버에 암호화 보관 중(PC 가져가기 대기), delivered: PC secrets.env 에 저장됨(서버 값 삭제)
export type KeyPasswordState = "none" | "waiting" | "delivered";

export interface KeyScanApp {
  appSlug: string;
  keys: {
    path: string; // 앱 폴더 기준 상대 경로
    abs?: string | null; // PC 절대 경로(새 감독 프로그램만 보냄)
    type: string;
    aliases: { alias: string; sha1: string | null }[];
    gitTracked: boolean | null;
    note?: string | null;
  }[];
  keyProperties: { path: string; storeFile: string | null; keyAlias: string | null; gitTracked: boolean | null }[];
  missing?: boolean; // PC 에 앱 폴더가 없음
  at?: string | null; // 마지막 조회 시각
}

export interface UpdateItem {
  value: string;
  label: string;
  help: string;
}

export interface ReleaseJobInfo {
  id: string;
  status: string;
  finishedAt: string | null;
  releaseKind: string;
  phase: string | null;
  phaseLabel: string;
  failStage: string | null;
  failStageLabel: string | null;
  failReason: string | null;
  resumeFrom: string | null;
  overwriteProject: boolean;
  updateItems: string[] | null; // 고른 갱신 항목(null: 예전 일감·첫 출시)
  updateItemsText: string | null;
  // 카드 표시 상태: pending | generating(생성 중) | review(검토 대기) | publishing(반영 중) | done | failed | cancelled
  state: string;
  reviewRequired: boolean;
  reviewAt: string | null;
  reviewApprovedAt: string | null;
  redoNote: string | null;
  summary: string | null; // 검토 대기·완료일 때 결과 요약(비밀번호 가림)
  // 통제실에서 재생할 검토 영상: url 이 있으면 업로드 서버 주소(지워지지 않음), 없으면 예전 방식(DB, 관리자만·결정 뒤·7일 뒤 삭제)
  reviewVideo: { size: number; url: string | null; expiresAt: string | null } | null;
  versionName: string | null; // 앱 업데이트 입력
  releaseNotes: string | null;
  buildResult: BuildResult | null;
  logs: { at: string; level: string; message: string }[];
}

// 앱 업데이트 빌드 결과
export interface BuildResult {
  versionName: string | null;
  versionCode: number | null;
  aabPath: string | null;
  aabSize: number | null;
  tests: string | null;
  track: string | null;
  uploaded: boolean;
  uploadNote: string | null;
}

export interface PcPathItem {
  key: string;
  path: string;
  exists: boolean;
  size: number | null;
  mtime: string | null;
}

// 종류별 필요한 준비 한 줄. ok: true ✅ / false ⬜(부족: 승인 막음) / null ⏳(확인 전, 막지 않음)
export interface ReadyItem {
  label: string;
  ok: boolean | null;
  note?: string | null;
}

export interface ReleaseApp {
  appSlug: string;
  title: string; // 작업 이름
  displayName: string; // 카드 제목(앱 이름): 직접 정한 이름 → 스토어 문구 앱 이름 → 홈페이지 프로젝트 제목 → 작업 이름
  nameSource: "manual" | "store" | "project" | "job";
  nameSourceLabel: string;
  appName: string | null; // 직접 정한 앱 이름
  alreadyReleased: boolean; // 이미 첫 업로드를 마친 앱
  requiresTesting: boolean; // 비공개 테스트가 필요한 계정(개인 계정)
  readiness: Record<"first" | "store" | "update", ReadyItem[]>;
  stack: string;
  done: boolean;
  active: boolean;
  releaseAccountId: string | null;
  releaseStatus: string;
  packageName: string | null;
  firstUploadDone: boolean;
  testingStartedAt: string | null;
  testingDueAt: string | null;
  releasePackage: Record<string, unknown> | null;
  releasePackageAt: string | null;
  releasePackageJob: string | null;
  aab: { path: string; size: number | null; versionName: string | null; versionCode: number | null; builtAt: string | null } | null;
  customKeystorePath: string | null;
  customKeyAlias: string | null;
  promoVideoUrl: string | null;
  storeAssets: StoreAssets | null;
  playMissing: string[]; // Play 업로드에 모자란 것(비면 가능)
  keyId: string | null; // 이 앱이 고른 보관함 키(없으면 계정 기본 키)
  key: {
    source: "custom" | "account";
    path: string;
    alias: string;
    password: KeyPasswordState;
    keyId: string | null;
    name: string | null;
    kind: string | null;
    production: boolean;
    check: KeyCheck | null;
    checking: "requested" | "taken" | null;
    untracking: "requested" | "taken" | null;
    untrack: KeyUntrack | null;
    lastError: string | null;
  } | null;
  keyScan: KeyScanApp | null;
  keyScanRequest: { requestedAt: string; takenAt: string | null } | null; // [키 조회] 진행 중
  lastReleaseJob: ReleaseJobInfo | null;
}

// 스토어 자료(.factory/store/) 결과. 서버 lib/factory/storeAssets.ts 의 StoreAssets 와 같다
export type StoreStageStatus = "ok" | "skipped" | "failed";
export interface StoreAssets {
  at: string;
  jobId: string;
  dir: string | null;
  stages: Partial<Record<"icon" | "screenshots" | "video" | "listing" | "review" | "upload" | "homepage", { status: StoreStageStatus; note: string | null }>>;
  images: Record<string, { width: number | null; height: number | null; size: number | null; url: string | null }>;
  video: { path: string; size: number | null; durationSec: number | null } | null;
  reviewVideo?: { url: string; size: number; at: string } | null;
  listing: Record<string, { title: string; shortDescription: string; fullDescription: string }> | null;
  tools: string | null;
  upload: { at: string; ok: boolean; note: string; changesNotSentForReview?: boolean } | null;
  aabUpload: { at: string; ok: boolean; note: string; track: string | null; versionCode: number | null } | null;
}

export interface ReleaseOverview {
  statuses: { value: string; label: string }[];
  kinds: { value: string; label: string; hint: string; canOverwrite: boolean; items: UpdateItem[]; selectable: boolean; review: boolean }[];
  testingDays: number;
  accounts: ReleaseAccount[];
  pcStatus: { at: string; items: PcPathItem[] } | null;
  keyScan: { at: string | null; apps: KeyScanApp[]; requestedAt: string | null };
  keys: VaultKey[];
  keyKinds: { value: string; label: string }[];
  apps: ReleaseApp[];
  message?: string;
}

export async function postRelease(body: Record<string, unknown>): Promise<{ ok: boolean; data: Partial<ReleaseOverview> }> {
  try {
    const res = await fetch("/api/admin/factory/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Partial<ReleaseOverview> };
  } catch {
    return { ok: false, data: { message: "서버에 연결하지 못했어요." } };
  }
}

export const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "-";

export const fmtSize = (n: number | null | undefined) =>
  n == null ? "-" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;

export const KEY_PASSWORD_TEXT: Record<KeyPasswordState, string> = {
  none: "비밀번호 미등록",
  waiting: "비밀번호 등록됨 (작업 PC 가 가져가기 대기 중)",
  delivered: "비밀번호 등록됨 (작업 PC 에 저장 완료)",
};
