// lib/factory/projectLinksDb.ts
// 앱별 연결 정보의 DB 읽기·쓰기(순수 부분은 projectLinks.ts). 표 = factory_app_connections + factory_settings 의 감독 보고·새로 읽기 요청.
import prisma from "@/lib/prisma";
import {
  buildLinksView,
  classifyRemote,
  isDeployServer,
  parseStoredReport,
  PROJECT_LINKS_REPORT_KEY,
  PROJECT_LINKS_SCAN_KEY,
  REMOTE_PURPOSES,
  type ConnectionPatch,
  type ConnectionRow,
  type LinksView,
  type ProjectLinksReport,
  type RemotePurpose,
} from "@/lib/factory/projectLinks";

// ───────── DB ─────────

type DbRow = { appSlug: string; folder: string | null; stack: string | null; defaultBranch: string | null; remotes: unknown; deployServer: string | null; deployMethod: string | null; domain: string | null; containerName: string | null; services: unknown; notes: string | null };

function toConnection(r: DbRow): ConnectionRow {
  const remotes = Array.isArray(r.remotes)
    ? (r.remotes as Record<string, unknown>[]).flatMap((x) => {
        if (typeof x?.name !== "string" || typeof x?.host !== "string") return [];
        const path = typeof x.path === "string" ? x.path : "";

        return [{ name: x.name, host: x.host, path, purpose: (REMOTE_PURPOSES as readonly string[]).includes(x.purpose as string) ? (x.purpose as RemotePurpose) : classifyRemote(x.name, x.host, path) }];
      })
    : null;

  return {
    appSlug: r.appSlug,
    folder: r.folder,
    stack: r.stack,
    defaultBranch: r.defaultBranch,
    remotes,
    deployServer: isDeployServer(r.deployServer) ? r.deployServer : null,
    deployMethod: r.deployMethod,
    domain: r.domain,
    containerName: r.containerName,
    services: Array.isArray(r.services) ? r.services.filter((s): s is string => typeof s === "string") : [],
    notes: r.notes,
  };
}

export async function readLinksView(now = Date.now()): Promise<LinksView> {
  const [rows, jobs, setting] = await Promise.all([
    prisma.factoryAppConnection.findMany(),
    prisma.factoryJob.findMany({ where: { kind: { not: "lab" } }, orderBy: { createdAt: "desc" }, select: { appSlug: true, stack: true } }),
    prisma.factorySetting.findUnique({ where: { key: PROJECT_LINKS_REPORT_KEY } }),
  ]);
  const stacks: Record<string, string> = {};

  for (const j of jobs) if (!(j.appSlug in stacks)) stacks[j.appSlug] = j.stack;

  return buildLinksView({ appSlugs: Object.keys(stacks), connections: rows.map(toConnection), report: parseStoredReport(setting?.value), stacks, now });
}

export async function saveReport(report: ProjectLinksReport): Promise<void> {
  const value = JSON.stringify(report);

  await prisma.factorySetting.upsert({ where: { key: PROJECT_LINKS_REPORT_KEY }, create: { key: PROJECT_LINKS_REPORT_KEY, value }, update: { value } });
  await prisma.factorySetting.deleteMany({ where: { key: PROJECT_LINKS_SCAN_KEY } }); // 받았으니 새로 읽기 요청은 끝
}

export async function updateConnection(appSlug: string, patch: ConnectionPatch): Promise<void> {
  await prisma.factoryAppConnection.upsert({ where: { appSlug }, create: { appSlug, ...patch }, update: patch });
}

/** 통제실 [새로 읽기]: 다음 /next 응답 한 번에 projectLinksScan: true 를 붙인다 */
export async function requestScan(): Promise<void> {
  const value = new Date().toISOString();

  await prisma.factorySetting.upsert({ where: { key: PROJECT_LINKS_SCAN_KEY }, create: { key: PROJECT_LINKS_SCAN_KEY, value }, update: { value } });
}

/** /next 에서 부른다: 요청이 있으면 한 번 true. 감독 프로그램이 보고하면(saveReport) 요청이 지워진다. 가져간 뒤 2분 안엔 다시 내리지 않는다 */
export async function consumeScan(now = Date.now()): Promise<boolean> {
  const row = await prisma.factorySetting.findUnique({ where: { key: PROJECT_LINKS_SCAN_KEY } });

  if (!row) return false;
  const [requestedAt, takenAt] = row.value.split("|");

  if (takenAt && now - Date.parse(takenAt) < 2 * 60_000) return false;
  if (now - Date.parse(requestedAt) > 60 * 60_000) {
    await prisma.factorySetting.deleteMany({ where: { key: PROJECT_LINKS_SCAN_KEY } });

    return false;
  }
  await prisma.factorySetting.update({ where: { key: PROJECT_LINKS_SCAN_KEY }, data: { value: `${requestedAt}|${new Date(now).toISOString()}` } });

  return true;
}
