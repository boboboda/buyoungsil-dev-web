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
  logs: { at: string; level: string; message: string }[];
}

export interface PcPathItem {
  key: string;
  path: string;
  exists: boolean;
  size: number | null;
  mtime: string | null;
}

export interface ReleaseApp {
  appSlug: string;
  title: string;
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
  key: { source: "custom" | "account"; path: string; alias: string; password: KeyPasswordState } | null;
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
  stages: Partial<Record<"icon" | "screenshots" | "video" | "listing" | "upload" | "homepage", { status: StoreStageStatus; note: string | null }>>;
  images: Record<string, { width: number | null; height: number | null; size: number | null; url: string | null }>;
  video: { path: string; size: number | null; durationSec: number | null } | null;
  listing: Record<string, { title: string; shortDescription: string; fullDescription: string }> | null;
  tools: string | null;
  upload: { at: string; ok: boolean; note: string; changesNotSentForReview?: boolean } | null;
  aabUpload: { at: string; ok: boolean; note: string; track: string | null; versionCode: number | null } | null;
}

export interface ReleaseOverview {
  statuses: { value: string; label: string }[];
  kinds: { value: string; label: string; canOverwrite: boolean; items: UpdateItem[] }[];
  testingDays: number;
  accounts: ReleaseAccount[];
  pcStatus: { at: string; items: PcPathItem[] } | null;
  keyScan: { at: string | null; apps: KeyScanApp[]; requestedAt: string | null };
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
