// lib/factory/projectLinks.ts
// 앱별 배포·저장소 연결 정보(git 원격·배포 서버·배포 방법·도메인·컨테이너·연결된 서비스)를 한 곳에 기록하고 보여 준다. 통일은 하지 않고 기록만 한다.
// - 사람이 입력하는 값(도메인·배포 방법·컨테이너 이름·서비스·비고 등): factory_app_connections 테이블(마이그레이션이 현황 조사 초기값을 채운다).
// - 감독 프로그램이 읽어 보내는 값(앱 폴더의 git 원격·브랜치·종류, 서버 컨테이너 이름): factory_settings 의 projectLinksReport. 읽기 전용 자료다.
// - 앱 폴더 이름 = 공장 앱 이름(appSlug). 받은 값은 모양을 검사하고 자격 증명(user:pass@)은 버린다. 비밀값은 받지도 저장하지도 않는다.
// 이 파일은 순수 함수·상수만 둔다(통제실 화면도 가져다 쓰므로 prisma 를 넣지 않는다). DB 를 부르는 함수는 projectLinksDb.ts.

export const PROJECT_LINKS_REPORT_KEY = "projectLinksReport";
export const PROJECT_LINKS_SCAN_KEY = "projectLinksScanRequest";
export const REPORT_STALE_MS = 36 * 60 * 60 * 1000; // 하루 1회 보고라서 36시간이 지나면 낡은 값으로 본다

export const DEPLOY_SERVERS = ["serverpc", "serverpc2", "none"] as const;
export type DeployServer = (typeof DEPLOY_SERVERS)[number];
export const SERVER_LABELS: Record<DeployServer, string> = { serverpc: "서버1(serverpc)", serverpc2: "서버2(serverpc2)", none: "없음" };

export const REMOTE_PURPOSES = ["backup", "deploy", "github", "other"] as const;
export type RemotePurpose = (typeof REMOTE_PURPOSES)[number];
export const PURPOSE_LABELS: Record<RemotePurpose, string> = { backup: "백업", deploy: "배포", github: "GitHub", other: "기타" };

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/;
const REMOTE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$/;
const CONTAINER_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,99}$/;
const STACKS = ["flutter", "kotlin-compose", "swift-swiftui", "nextjs", "nestjs"];
const MAX_APPS = 60;
const MAX_REMOTES = 8;
const MAX_CONTAINERS = 60;

export const EXPORT_KINDS = ["folder", "upload"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export const EXPORT_LABELS: Record<ExportKind, string> = { folder: "앱 폴더 경로", upload: "서비스 업로드" };
const EXPORT_PATH_RE = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9가-힣_.\-][A-Za-z0-9가-힣_.\-/ ]{0,199}$/;

export const isSlug = (v: unknown): v is string => typeof v === "string" && SLUG_RE.test(v);
export const isDeployServer = (v: unknown): v is DeployServer => typeof v === "string" && (DEPLOY_SERVERS as readonly string[]).includes(v);

export interface RemoteInfo {
  name: string;
  host: string; // github.com / serverpc2 / ...
  path: string; // 저장소 경로(자격 증명 없음)
  purpose: RemotePurpose;
}

/** git 원격 주소(host:경로 꼴, 프로토콜 주소)에서 호스트와 경로만 뽑는다. 자격 증명은 버린다. 못 읽으면 null */
export function parseRemoteUrl(url: string): { host: string; path: string } | null {
  const u = url.trim();
  let host = "";
  let path = "";
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.*)$/i.exec(u);

  if (m) {
    host = m[1];
    path = m[2];
  } else {
    const s = /^(?:[^@\s:/]+@)?([^:/\s]+):(.*)$/.exec(u); // git@github.com:a/b.git, serverpc2:git-server/…

    if (!s) return null;
    host = s[1];
    path = s[2];
  }
  path = path.replace(/^~?\/+/, "").replace(/^~\//, "").slice(0, 120);

  return HOST_RE.test(host) ? { host: host.slice(0, 100), path } : null;
}

/** 원격 이름·주소로 용도를 짐작한다: GitHub / 서버 배포 저장소(git-server/repo) / 백업(git-server/claude-work) / 기타 */
export function classifyRemote(name: string, host: string, path: string): RemotePurpose {
  if (/github\.com$/i.test(host)) return "github";
  if (/(^|\/)claude-work\//.test(path) || name === "claude-backup") return "backup";
  if (/(^|\/)git-server\/repo\//.test(path)) return "deploy";

  return "other";
}

export interface ReportApp {
  folder: string;
  isGit: boolean;
  branch: string | null;
  stack: string | null;
  remotes: RemoteInfo[];
}
export type ServerContainers = { state: "ok"; names: string[] } | { state: "unknown" };
export interface ProjectLinksReport {
  at: string; // 감독 프로그램이 읽은 시각(ISO)
  apps: ReportApp[];
  servers: Partial<Record<"serverpc" | "serverpc2", ServerContainers>>;
}

/** 감독 프로그램이 보낸 본문을 검사해 깨끗한 보고로 바꾼다. 모양이 틀린 항목은 버린다(전체가 틀리면 오류) */
export function validateReport(raw: unknown, now = new Date()): { ok: true; report: ProjectLinksReport } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "본문이 객체가 아니에요." };
  const o = raw as Record<string, unknown>;

  if (!Array.isArray(o.apps)) return { ok: false, reason: "apps 배열이 필요해요." };
  const apps: ReportApp[] = [];

  for (const a of o.apps.slice(0, MAX_APPS)) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;

    if (!isSlug(r.folder)) continue;
    const remotes: RemoteInfo[] = [];

    for (const x of (Array.isArray(r.remotes) ? r.remotes : []).slice(0, MAX_REMOTES)) {
      if (!x || typeof x !== "object") continue;
      const e = x as Record<string, unknown>;
      const parsed = typeof e.url === "string" ? parseRemoteUrl(e.url) : typeof e.host === "string" ? { host: e.host, path: typeof e.path === "string" ? e.path.slice(0, 120) : "" } : null;

      if (typeof e.name !== "string" || !REMOTE_NAME_RE.test(e.name) || !parsed || !HOST_RE.test(parsed.host)) continue;
      remotes.push({ name: e.name, host: parsed.host, path: parsed.path, purpose: classifyRemote(e.name, parsed.host, parsed.path) });
    }
    apps.push({
      folder: r.folder,
      isGit: r.isGit === true,
      branch: typeof r.branch === "string" && BRANCH_RE.test(r.branch) ? r.branch : null,
      stack: typeof r.stack === "string" && STACKS.includes(r.stack) ? r.stack : null,
      remotes,
    });
  }
  const servers: ProjectLinksReport["servers"] = {};
  const sv = o.servers && typeof o.servers === "object" ? (o.servers as Record<string, unknown>) : {};

  for (const key of ["serverpc", "serverpc2"] as const) {
    const s = sv[key];

    if (!s || typeof s !== "object") continue;
    const e = s as { state?: unknown; names?: unknown };

    servers[key] =
      e.state === "ok" && Array.isArray(e.names)
        ? { state: "ok", names: e.names.filter((n): n is string => typeof n === "string" && CONTAINER_RE.test(n)).slice(0, MAX_CONTAINERS) }
        : { state: "unknown" };
  }

  return { ok: true, report: { at: now.toISOString(), apps, servers } };
}

/** 저장된 보고(JSON 글자)를 읽는다. 읽은 시각(at)은 저장된 값을 그대로 쓴다 */
export function parseStoredReport(raw: string | null | undefined): ProjectLinksReport | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { at?: unknown };
    const r = validateReport(parsed);

    if (!r.ok) return null;

    return { ...r.report, at: typeof parsed.at === "string" ? parsed.at : r.report.at };
  } catch {
    return null;
  }
}

// ───────── 사람이 입력하는 값 ─────────

export interface ConnectionRow {
  appSlug: string;
  folder: string | null;
  stack: string | null;
  defaultBranch: string | null;
  remotes: RemoteInfo[] | null; // 초기값(현황 조사). 감독 프로그램 보고가 있으면 보고가 우선
  deployServer: DeployServer | null;
  deployMethod: string | null;
  domain: string | null;
  containerName: string | null;
  services: string[];
  notes: string | null;
  exportKind: ExportKind | null; // 승인 그림을 내보낼 곳(2-2)
  exportPath: string | null; // exportKind=folder 일 때 앱 폴더 안 상대 경로
  studioBatch: boolean; // 스튜디오 기능: 배치
  studioService: boolean; // 스튜디오 기능: 서비스 운영
}

export interface ConnectionPatch {
  stack?: string | null;
  defaultBranch?: string | null;
  deployServer?: DeployServer | null;
  deployMethod?: string | null;
  domain?: string | null;
  containerName?: string | null;
  services?: string[];
  notes?: string | null;
  exportKind?: ExportKind | null;
  exportPath?: string | null;
  studioBatch?: boolean;
  studioService?: boolean;
}

const clean = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** 통제실에서 보낸 수정 값을 검사한다. 보낸 칸만 바꾼다. 빈 문자열·null 은 비우기 */
export function validatePatch(raw: unknown): { ok: true; patch: ConnectionPatch } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "본문이 객체가 아니에요." };
  const o = raw as Record<string, unknown>;
  const patch: ConnectionPatch = {};
  const has = (k: string) => k in o;

  if (has("stack")) {
    const v = clean(o.stack, 30);

    if (v && !STACKS.includes(v)) return { ok: false, reason: `stack 은 ${STACKS.join(", ")} 중 하나여야 해요.` };
    patch.stack = v;
  }
  if (has("defaultBranch")) {
    const v = clean(o.defaultBranch, 100);

    if (v && !BRANCH_RE.test(v)) return { ok: false, reason: "브랜치 이름 모양이 틀려요." };
    patch.defaultBranch = v;
  }
  if (has("deployServer")) {
    if (o.deployServer !== null && o.deployServer !== "" && !isDeployServer(o.deployServer)) return { ok: false, reason: "배포 서버는 serverpc / serverpc2 / none 중 하나예요." };
    patch.deployServer = o.deployServer ? (o.deployServer as DeployServer) : null;
  }
  if (has("deployMethod")) patch.deployMethod = clean(o.deployMethod, 100);
  if (has("domain")) {
    const v = clean(o.domain, 120);

    if (v && !/^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(v)) return { ok: false, reason: "도메인 모양이 틀려요(예: app.example.com)." };
    patch.domain = v;
  }
  if (has("containerName")) {
    const v = clean(o.containerName, 100);

    if (v && !CONTAINER_RE.test(v)) return { ok: false, reason: "컨테이너 이름 모양이 틀려요." };
    patch.containerName = v;
  }
  if (has("services")) {
    const list = Array.isArray(o.services) ? o.services : typeof o.services === "string" ? o.services.split(/[,\s]+/) : null;

    if (!list) return { ok: false, reason: "services 는 이름 목록이에요." };
    const names = list.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean);

    if (names.length > 10 || names.some((n) => !CONTAINER_RE.test(n))) return { ok: false, reason: "연결된 서비스는 컨테이너 이름 모양으로 10개까지 적을 수 있어요." };
    patch.services = [...new Set(names)];
  }
  if (has("notes")) patch.notes = clean(o.notes, 500);
  if (has("exportKind")) {
    if (o.exportKind !== null && o.exportKind !== "" && !(EXPORT_KINDS as readonly string[]).includes(o.exportKind as string)) return { ok: false, reason: "승인 그림을 내보낼 곳은 folder(앱 폴더 경로) / upload(서비스 업로드) 중 하나예요." };
    patch.exportKind = o.exportKind ? (o.exportKind as ExportKind) : null;
    if (patch.exportKind !== "folder") patch.exportPath = null;
  }
  if (has("exportPath") && (patch.exportKind === undefined || patch.exportKind === "folder")) {
    const v = clean(o.exportPath, 200);

    if (v && !EXPORT_PATH_RE.test(v)) return { ok: false, reason: "내보낼 앱 폴더 경로는 앱 폴더 안의 상대 경로여야 해요(절대 경로·.. 은 안 돼요)." };
    patch.exportPath = v;
  }
  if (patch.exportKind === "folder" && !patch.exportPath) return { ok: false, reason: "앱 폴더 경로로 내보내려면 폴더 경로도 적어 주세요(예: assets/sprites)." };
  for (const k of ["studioBatch", "studioService"] as const) {
    if (has(k)) {
      if (typeof o[k] !== "boolean") return { ok: false, reason: `${k} 는 true/false 예요.` };
      patch[k] = o[k] as boolean;
    }
  }

  return { ok: true, patch };
}

// ───────── 합쳐서 보여 주기 ─────────

export type WarningKind = "no-remote" | "no-container" | "not-git";
export const WARNING_LABELS: Record<WarningKind, string> = {
  "no-remote": "git 원격이 없어요",
  "no-container": "배포 서버에서 컨테이너를 못 찾았어요",
  "not-git": "git 폴더가 아니에요",
};

export interface LinkRow {
  appSlug: string;
  folder: string;
  hasFolder: boolean | null; // 감독 프로그램 보고가 없으면 null(모름)
  isGit: boolean | null;
  stack: string | null;
  branch: string | null;
  remotes: RemoteInfo[];
  remotesSource: "report" | "initial" | "none";
  deployServer: DeployServer | null;
  deployMethod: string | null;
  domain: string | null;
  containerName: string | null;
  services: string[];
  containersFound: boolean | null; // 컨테이너 이름이 서버 목록에 있는지(서버 목록을 못 읽었으면 null)
  notes: string | null;
  exportKind: ExportKind | null;
  exportPath: string | null;
  studioBatch: boolean;
  studioService: boolean;
  warnings: { kind: WarningKind; text: string }[];
}

export interface LinksView {
  rows: LinkRow[];
  reportAt: string | null;
  reportStale: boolean;
  servers: { serverpc: "ok" | "unknown" | "none"; serverpc2: "ok" | "unknown" | "none" };
  warningCount: number;
}

/** 공장 앱 이름 목록 + 사람이 입력한 값 + 감독 프로그램 보고를 한 표로 합친다 */
export function buildLinksView(input: { appSlugs: string[]; connections: ConnectionRow[]; report: ProjectLinksReport | null; stacks?: Record<string, string>; now?: number }): LinksView {
  const { report, connections } = input;
  const conn = new Map(connections.map((c) => [c.appSlug, c]));
  const folders = new Map((report?.apps ?? []).map((a) => [a.folder, a]));
  const slugs = [...new Set([...connections.map((c) => c.appSlug), ...(report?.apps ?? []).map((a) => a.folder), ...input.appSlugs])].filter((s) => s !== "lab").sort();
  const now = input.now ?? Date.now();
  const reportStale = report ? now - Date.parse(report.at) > REPORT_STALE_MS : false;
  const rows: LinkRow[] = slugs.map((appSlug) => {
    const c = conn.get(appSlug);
    const folder = c?.folder || appSlug;
    const f = folders.get(folder);
    const remotes = f ? f.remotes : (c?.remotes ?? []);
    const server = c?.deployServer ?? null;
    const list = server === "serverpc" || server === "serverpc2" ? report?.servers[server] : undefined;
    const containersFound = list?.state === "ok" && c?.containerName ? list.names.includes(c.containerName) : null;
    const warnings: LinkRow["warnings"] = [];

    if (f && !f.isGit) warnings.push({ kind: "not-git", text: WARNING_LABELS["not-git"] });
    else if (remotes.length === 0 && (f ? f.isGit : true)) warnings.push({ kind: "no-remote", text: WARNING_LABELS["no-remote"] });
    if (server && server !== "none") {
      if (!c?.containerName) warnings.push({ kind: "no-container", text: "배포 서버는 있는데 컨테이너 이름이 비어 있어요" });
      else if (containersFound === false) warnings.push({ kind: "no-container", text: `${SERVER_LABELS[server]} 에서 컨테이너 ${c.containerName} 을(를) 못 찾았어요` });
    }

    return {
      appSlug,
      folder,
      hasFolder: report ? !!f : null,
      isGit: f ? f.isGit : null,
      stack: c?.stack ?? f?.stack ?? input.stacks?.[appSlug] ?? null,
      branch: f?.branch ?? c?.defaultBranch ?? null,
      remotes,
      remotesSource: f ? "report" : remotes.length ? "initial" : "none",
      deployServer: server,
      deployMethod: c?.deployMethod ?? null,
      domain: c?.domain ?? null,
      containerName: c?.containerName ?? null,
      services: c?.services ?? [],
      containersFound,
      notes: c?.notes ?? null,
      exportKind: c?.exportKind ?? null,
      exportPath: c?.exportPath ?? null,
      studioBatch: c?.studioBatch ?? false,
      studioService: c?.studioService ?? false,
      warnings,
    };
  });
  const state = (k: "serverpc" | "serverpc2") => report?.servers[k]?.state ?? "none";

  return { rows, reportAt: report?.at ?? null, reportStale, servers: { serverpc: state("serverpc"), serverpc2: state("serverpc2") }, warningCount: rows.reduce((n, r) => n + r.warnings.length, 0) };
}
