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
  notes: string | null;
  secretNames: { keystore: string; key: string };
  secretNamesRegistered: boolean;
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
  lastReleaseJob: { id: string; status: string; finishedAt: string | null } | null;
}

export interface ReleaseOverview {
  statuses: { value: string; label: string }[];
  testingDays: number;
  accounts: ReleaseAccount[];
  pcStatus: { at: string; items: PcPathItem[] } | null;
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
