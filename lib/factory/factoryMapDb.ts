// lib/factory/factoryMapDb.ts
// 통제실 지도(4-3)에 쓸 자료를 읽어 모은다(읽기만 한다). 그래프 계산은 factoryMap.ts(순수).
// 자료: 감독 상태, 장비 보고(docker ps 이름·상태), 연결 표(1-6), 도구 설명서(2-1), 결과물 카드(2-2), 에이전트 정의와 권한(4-2), 진행 중·최근 일감, 정비 배포 대기.
// 키는 이름만 다룬다. 값·nginx 설정은 읽지 않는다.
import prisma from "@/lib/prisma";
import { readAgentPerms } from "@/lib/factory/agents";
import { devicesSnapshot, type DeviceView } from "@/lib/factory/devices";
import { buildFactoryMap, type MapCard, type MapDevice, type MapInput, type MapJob, type MapGraph } from "@/lib/factory/factoryMap";
import { parseStoredReport, PROJECT_LINKS_REPORT_KEY } from "@/lib/factory/projectLinks";
import { readLinksView } from "@/lib/factory/projectLinksDb";
import { supervisorSnapshot } from "@/lib/factory/supervisor";
import { readManifestsView } from "@/lib/factory/toolManifestDb";

const RECENT_JOBS_DAYS = 14;
const MAX_JOBS = 300;
const AGENTS_TTL_MS = 30_000;
let agentsCache: { at: number; value: ReturnType<typeof readAgentPerms> } | null = null;

function agentPerms(now: number) {
  if (!agentsCache || now - agentsCache.at > AGENTS_TTL_MS) agentsCache = { at: now, value: readAgentPerms() };

  return agentsCache.value;
}

function toDevice(v: DeviceView | undefined): MapDevice {
  if (!v) return { state: "never", receivedAt: null, cpuPct: null, ramPct: null, containers: null };

  return {
    state: v.state,
    receivedAt: v.receivedAt,
    cpuPct: v.cpuPct,
    ramPct: v.ram?.pct ?? null,
    containers: v.running?.containers
      ? v.running.containers.map((c) => ({ name: c.name, state: c.state, status: c.status, restarts: c.restarts, project: c.project, flags: [...c.flags] }))
      : null,
  };
}

/** 지도 입력을 모은다. 일부를 못 읽어도 나머지로 그린다(못 읽은 칸은 빈 값) */
export async function readMapInput(now = Date.now()): Promise<MapInput> {
  const since = new Date(now - RECENT_JOBS_DAYS * 24 * 3600_000);
  const settle = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (e) {
      console.error("[factory-map] 읽기 실패:", e);

      return fallback;
    }
  };
  const [sv, devs, links, manifest, cardRows, jobRows, reportSetting, runningTurn, needsDeploy, deployingNow] = await Promise.all([
    supervisorSnapshot(),
    settle(devicesSnapshot(now), null),
    settle(readLinksView(now), { rows: [], reportAt: null, reportStale: false, servers: { serverpc: "none" as const, serverpc2: "none" as const }, warningCount: 0 }),
    settle(readManifestsView(), { commit: "", reportedAt: null, tools: [] }),
    settle(prisma.factoryCard.findMany({ select: { id: true, appSlug: true, name: true, tool: true, method: true, enabled: true, version: true }, orderBy: [{ appSlug: "asc" }, { name: "asc" }], take: 200 }), []),
    settle(
      prisma.factoryJob.findMany({
        where: { OR: [{ status: { in: ["running", "pending", "approved", "review"] } }, { createdAt: { gte: since } }] },
        orderBy: { createdAt: "desc" },
        take: MAX_JOBS,
        select: { id: true, appSlug: true, title: true, kind: true, releaseKind: true, status: true, phase: true, parallelGroup: true, aiEngine: true, requiredSecrets: true, createdAt: true, startedAt: true, finishedAt: true },
      }),
      [],
    ),
    settle(prisma.factorySetting.findUnique({ where: { key: PROJECT_LINKS_REPORT_KEY } }), null),
    settle(prisma.factoryMaintenanceMessage.findFirst({ where: { role: "user", status: "running" }, orderBy: { startedAt: "asc" }, include: { maintenance: { select: { title: true } } } }), null),
    settle(prisma.factoryMaintenance.count({ where: { needsDeploy: true, pushedCommit: { not: null } } }), 0),
    settle(prisma.factoryMaintenance.count({ where: { deployRequestedAt: { not: null }, deployedAt: null, deployResult: null } }), 0),
  ]);
  const byDevice = new Map((devs?.devices ?? []).map((d) => [d.device, d]));
  const report = parseStoredReport(reportSetting?.value);
  const serverNames = (k: "serverpc" | "serverpc2") => (report?.servers[k]?.state === "ok" ? (report.servers[k] as { names: string[] }).names : null);
  const perms = agentPerms(now);
  const tools = manifest.tools.map((t) => ({
    name: t.name,
    label: t.label,
    source: t.source,
    version: t.version,
    methods: t.methods.map((m) => ({ id: m.id, label: m.label, secrets: m.secretStates })),
  }));
  const toolOf = new Map(tools.map((t) => [t.name, t]));
  const cards: MapCard[] = cardRows.map((c) => {
    const t = toolOf.get(c.tool);
    const m = t?.methods.find((x) => x.id.toLowerCase() === c.method.toLowerCase());
    const warnings: string[] = [];

    if (tools.length && !t) warnings.push(`도구 설명서에 ${c.tool} 가 없어요.`);
    for (const s of m?.secrets ?? []) if (!s.ready) warnings.push(`${s.name} 키 이름이 등록돼 있지 않아요.`);

    return { id: c.id, appSlug: c.appSlug, name: c.name, tool: c.tool, method: c.method, enabled: c.enabled, version: c.version, warnings };
  });
  const jobs: MapJob[] = jobRows.map((j) => ({
    id: j.id,
    appSlug: j.appSlug,
    title: j.title,
    kind: j.kind,
    releaseKind: j.releaseKind,
    status: j.status,
    phase: j.phase,
    parallelGroup: j.parallelGroup,
    aiEngine: j.aiEngine,
    requiredSecrets: j.requiredSecrets,
    createdAt: j.createdAt.getTime(),
    startedAt: j.startedAt ? j.startedAt.getTime() : null,
    finishedAt: j.finishedAt ? j.finishedAt.getTime() : null,
  }));

  return {
    now,
    supervisor: {
      online: sv.online,
      enabled: sv.enabled,
      commit: sv.commit,
      commitSubject: sv.commitSubject,
      startedAt: sv.startedAt,
      appSlots: sv.appSlots,
      running: sv.running,
      approved: sv.approved,
      pending: sv.pending,
      pausedJobs: sv.pausedJobs,
      deploying: sv.deploying,
      staleCopies: sv.staleCopies,
      workerName: sv.workerName,
      lastSeenAt: sv.lastSeenAt ? sv.lastSeenAt.getTime() : null,
    },
    devices: { "main-pc": toDevice(byDevice.get("main-pc")), server1: toDevice(byDevice.get("server1")), server2: toDevice(byDevice.get("server2")) },
    links,
    serverNames: { serverpc: serverNames("serverpc"), serverpc2: serverNames("serverpc2") },
    agents: perms.agents,
    agentErrors: perms.errors,
    tools,
    cards,
    jobs,
    maintenance: { runningTitle: runningTurn?.maintenance.title ?? null, needsDeploy, deployingNow: deployingNow > 0 },
  };
}

export async function readFactoryMap(now = Date.now()): Promise<{ graph: MapGraph; asOf: number; reportAt: string | null; reportStale: boolean }> {
  const input = await readMapInput(now);

  return { graph: buildFactoryMap(input), asOf: now, reportAt: input.links.reportAt, reportStale: input.links.reportStale };
}
