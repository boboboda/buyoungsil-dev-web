// lib/factory/factoryMap.ts
// 통제실 지도(4-3): 메인 PC·서버1·서버2와 그 안의 에이전트·도구·카드·앱 폴더·git 원격·도메인·컨테이너를 블록과 선으로 잇는 그래프를 만든다.
// 순수 함수·상수만 둔다(prisma 없음, 읽기는 factoryMapDb.ts). 입력은 이미 있는 자료를 모은 것이다:
//   감독 상태(supervisorSnapshot), 장비 보고(devices: docker ps 이름·상태), 연결 표(projectLinks: 1-6), 도구 설명서(2-1), 결과물 카드(2-2), 에이전트 정의(4-2).
// 선은 기록된 범위만 쓴다. 서버1 nginx 설정은 읽지 않는다(도메인·컨테이너는 연결 표에 사람이 적은 값).
// 블록 그림 계산은 스튜디오 [구성]의 BlockDiagram 과 같은 모양(BlockNode·BlockEdge)을 쓴다. 화면은 읽기 전용이다.
import type { LinkRow } from "@/lib/factory/projectLinks";
import type { BlockBadge, BlockEdge, BlockFrame, BlockNode, BlockStatus } from "@/lib/studio/dashboard";

export type MapStatus = BlockStatus;
export type MapKind = "machine" | "agent" | "tool" | "card" | "app" | "remote" | "proxy" | "domain" | "container";

/** 상태 색: 글자(라벨)와 모양(표시)을 같이 써서 색만으로 구분하지 않는다 */
export const STATUS_INFO: Record<MapStatus, { mark: string; label: string; cls: string; color: string }> = {
  ok: { mark: "●", label: "정상", cls: "fx-ok", color: "var(--fx-ok)" },
  busy: { mark: "◆", label: "작업 중", cls: "fx-run", color: "var(--fx-accent)" },
  pending: { mark: "◔", label: "배포 대기", cls: "fx-warn", color: "var(--fx-warn)" },
  down: { mark: "✕", label: "끊김·못 찾음", cls: "fx-bad", color: "var(--fx-bad)" },
  warn: { mark: "▲", label: "경고", cls: "fx-warn", color: "var(--fx-warn)" },
};
export const STATUS_ORDER: MapStatus[] = ["ok", "busy", "pending", "down", "warn"];

// ───────── 입력 ─────────

export interface MapSupervisor {
  online: boolean;
  enabled: boolean; // false = 일시 정지
  commit: string | null;
  commitSubject: string | null;
  startedAt: string | null;
  appSlots: number;
  running: number;
  approved: number;
  pending: number;
  pausedJobs: number;
  deploying: boolean;
  staleCopies: string[];
  workerName: string | null;
  lastSeenAt: number | null;
}

export type MapDeviceState = "ok" | "stale" | "offline" | "never";
export interface MapContainer {
  name: string;
  state: string; // running | exited | restarting …
  status: string | null;
  restarts: number | null;
  project: string | null;
  flags: string[];
}
export interface MapDevice {
  state: MapDeviceState;
  receivedAt: number | null;
  cpuPct: number | null;
  ramPct: number | null;
  containers: MapContainer[] | null; // docker ps 결과. 못 받았으면 null
}

export interface MapAgentPerm {
  id: string;
  label: string;
  summary: string;
  migrated: boolean;
  engines: string[];
  readOnly: boolean;
  workspace: string;
  tools: string[];
  blockedTools: string[];
  writes: string[];
  noWrites: string[];
  readBlocks: string[];
  network: string[];
  ssh: string[];
  keys: string;
  hooks: string[];
  envNames: string[];
  envFilter: string;
  next: string[];
}

export interface MapTool {
  name: string;
  label: string;
  source: "file" | "fallback";
  version: number;
  methods: { id: string; label: string; secrets: { name: string; ready: boolean }[] }[];
}
export interface MapCard {
  id: string;
  appSlug: string;
  name: string;
  tool: string;
  method: string;
  enabled: boolean;
  version: number;
  warnings: string[];
}
export interface MapJob {
  id: string;
  appSlug: string;
  title: string;
  kind: string;
  releaseKind: string | null;
  status: string;
  phase: string | null;
  parallelGroup: string | null;
  aiEngine: string;
  requiredSecrets: string[];
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface MapInput {
  now: number;
  supervisor: MapSupervisor;
  devices: { "main-pc": MapDevice; server1: MapDevice; server2: MapDevice };
  links: { rows: LinkRow[]; reportAt: string | null; reportStale: boolean; servers: { serverpc: "ok" | "unknown" | "none"; serverpc2: "ok" | "unknown" | "none" } };
  serverNames: { serverpc: string[] | null; serverpc2: string[] | null }; // 연결 표 보고의 docker ps 이름(장비 보고가 없을 때 쓴다)
  agents: MapAgentPerm[];
  agentErrors: { file: string; message: string }[];
  tools: MapTool[];
  cards: MapCard[];
  jobs: MapJob[]; // 진행 중 + 최근 일감
  maintenance: { runningTitle: string | null; needsDeploy: number; deployingNow: boolean };
}

// ───────── 출력 ─────────

export interface DetailRow {
  label: string;
  value: string;
}
export interface DetailList {
  heading: string;
  items: string[];
  tone?: "warn" | "bad";
}
export interface NodeDetail {
  title: string;
  kindLabel: string;
  rows: DetailRow[];
  lists: DetailList[];
}
export interface MapNode extends BlockNode {
  kind: MapKind;
  detail: NodeDetail;
}
export interface MapEdge extends BlockEdge {
  kind: "git" | "tool" | "card" | "route" | "service";
  inferred?: boolean; // 기록된 연결 이름으로 이은 점선(중간 원격 기록 없음)
}
export interface MapGraph {
  nodes: MapNode[];
  edges: MapEdge[];
  frames: BlockFrame[];
  width: number;
  height: number;
  counts: Record<MapStatus, number>;
}

const KIND_LABEL: Record<MapKind, string> = { machine: "기계", agent: "에이전트", tool: "도구", card: "결과물 카드", app: "앱 폴더", remote: "git 원격", proxy: "프록시", domain: "도메인", container: "서비스(컨테이너)" };
export const MAP_KIND_LABEL = KIND_LABEL;
const KEY_TEXT: Record<string, string> = {
  none: "받는 키 없음",
  "job-required": "일감이 요청한 키만(이름이 일감마다 다름)",
  "job-required+release-key": "일감이 요청한 키 + 출시 키",
  "tool-method": "도구 방법이 정한 키(도구를 부르는 순간에만)",
};

export const nodeId = {
  machine: (m: "main-pc" | "server1" | "server2") => `machine:${m}`,
  agent: (id: string) => `agent:${id}`,
  tool: (n: string) => `tool:${n}`,
  card: (id: string) => `card:${id}`,
  app: (slug: string) => `app:${slug}`,
  remote: (slug: string) => `remote:${slug}`,
  proxy: () => "proxy:server1",
  domain: (d: string) => `domain:${d}`,
  container: (server: "serverpc" | "serverpc2", name: string) => `container:${server}:${name}`,
};

// 칸 크기·간격(스튜디오 [구성] 그림보다 약간 낮게: 한 줄 더 들어가도록)
export const MAP_W = 164;
export const MAP_H = 110;
export const MAP_COL_GAP = 40;
export const MAP_ROW_GAP = 12;
export const MAP_PAD = 10;
const FRAME_HEAD = 26;
const FRAME_GAP = 18;
const COLS = { machine: 0, agent: 1, proxy: 1, tool: 2, domain: 2, card: 3, app: 4, remote: 5, container: 6 } as const;
const COL_COUNT = 7;
const AGENT_ORDER = ["C1", "A1", "A2", "A3", "A4", "R1", "L1", "T", "M1", "H1"];
const AGENT_USES_BROKER = ["A1", "A2", "A3", "A4"]; // 도구 요청 중계(toolbroker)를 AI 가 도는 동안 여는 종류
const AGENT_USES_CARD = ["T"]; // 카드의 도구·방법을 AI 없이 바로 실행
const SERVER_OF = { serverpc: "server1", serverpc2: "server2" } as const;

/** 일감 → 에이전트 번호(실제 코드 구분과 같다: lib/factory/lab.ts 등). 병행 그룹이 있으면 A3 */
export function agentOfJob(job: Pick<MapJob, "kind" | "releaseKind" | "parallelGroup">): string {
  if (job.releaseKind) return "R1";
  if (job.kind === "lab") return "L1";
  if (job.kind === "tool") return "T";
  if (job.kind === "new") return "A1";

  return job.parallelGroup ? "A3" : "A2";
}

const ACTIVE = ["running"];
const WAITING = ["pending", "approved", "review"];
const WAIT_TEXT: Record<string, string> = { pending: "승인 대기", approved: "시작 대기", review: "출시 검토 대기" };

const PHASE_TEXT: Record<string, string> = { scaffold: "골격 만드는 중", build: "빌드 중", screenshots: "스크린샷 중", verify: "검증 중", commit: "커밋 중" };
const phaseText = (p: string | null) => (p ? (PHASE_TEXT[p] ?? p) : "진행 중");
const liveLine = (j: MapJob) => `▶ ${j.title.slice(0, 24)} · ${phaseText(j.phase)}`;
const shortCommit = (c: string | null) => (c ? c.slice(0, 7) : "미확인");
const ago = (now: number, t: number | null) => {
  if (t === null) return "기록 없음";
  const s = Math.max(0, Math.round((now - t) / 1000));

  return s < 90 ? `${s}초 전` : s < 5400 ? `${Math.round(s / 60)}분 전` : s < 172800 ? `${Math.round(s / 3600)}시간 전` : `${Math.round(s / 86400)}일 전`;
};

/** 장비 보고 상태 → 블록 상태 */
function deviceStatus(d: MapDevice): { status: MapStatus; text: string } {
  if (d.state === "ok") return { status: "ok", text: "정상" };
  if (d.state === "stale") return { status: "warn", text: "오래된 값" };
  if (d.state === "offline") return { status: "down", text: "끊김" };

  return { status: "down", text: "받은 적 없음" };
}

// 컨테이너 상태 → 블록 상태
function containerStatus(c: MapContainer | null, listKnown: boolean): { status: MapStatus; text: string } {
  if (!c) return listKnown ? { status: "down", text: "못 찾음" } : { status: "warn", text: "상태 미확인" };
  if (c.state === "running") return c.flags.length || (c.restarts ?? 0) >= 3 ? { status: "warn", text: c.flags.length ? "실행 중 · 주의" : "실행 중 · 재시작 잦음" } : { status: "ok", text: "실행 중" };
  if (c.state === "restarting") return { status: "warn", text: "재시작 중" };

  return { status: "down", text: c.state === "exited" ? "멈춤" : c.state };
}

type Draft = Omit<MapNode, "x" | "y" | "w" | "h" | "col"> & { band: "main" | "server1" | "server2"; slot?: number };

export function buildFactoryMap(input: MapInput): MapGraph {
  const { now, supervisor: sv } = input;
  const drafts: Draft[] = [];
  const edges: MapEdge[] = [];
  const have = new Set<string>();
  const add = (d: Draft) => {
    if (have.has(d.id)) return;
    have.add(d.id);
    drafts.push(d);
  };
  const link = (from: string, to: string, kind: MapEdge["kind"], inferred = false) => {
    if (!have.has(from) || !have.has(to) || edges.some((e) => e.from === from && e.to === to)) return;
    edges.push({ from, to, kind, ...(inferred ? { inferred } : {}) });
  };
  const detail = (kind: MapKind, title: string, rows: DetailRow[], lists: DetailList[] = []): NodeDetail => ({ title, kindLabel: KIND_LABEL[kind], rows, lists });
  const jobsByApp = new Map<string, MapJob[]>();

  for (const j of [...input.jobs].sort((a, b) => b.createdAt - a.createdAt)) jobsByApp.set(j.appSlug, [...(jobsByApp.get(j.appSlug) ?? []), j]);
  const running = input.jobs.filter((j) => ACTIVE.includes(j.status));
  const runningByAgent = new Map<string, MapJob[]>();

  for (const j of running) runningByAgent.set(agentOfJob(j), [...(runningByAgent.get(agentOfJob(j)) ?? []), j]);

  // ── 기계 블록 3개
  const pcDev = deviceStatus(input.devices["main-pc"]);
  const pcStatus: { status: MapStatus; text: string } = !sv.online
    ? { status: "down", text: "감독 프로그램 끊김" }
    : !sv.enabled || sv.pausedJobs > 0
      ? { status: "warn", text: sv.enabled ? "업데이트로 일시 중지" : "일시 정지" }
      : sv.running > 0 || input.maintenance.runningTitle
        ? { status: "busy", text: "작업 중" }
        : { status: "ok", text: "정상" };

  add({
    id: nodeId.machine("main-pc"),
    kind: "machine",
    type: "machine",
    band: "main",
    title: "메인 PC",
    sub: `감독 ${shortCommit(sv.commit)}`,
    status: pcStatus.status,
    statusText: pcStatus.text,
    badges: [
      { text: sv.online ? "연결됨" : "끊김", tone: sv.online ? "ok" : "warn" },
      { text: `슬롯 ${sv.running}/${sv.appSlots}`, tone: "muted" },
    ],
    live: input.maintenance.runningTitle ? `▶ 정비 · ${input.maintenance.runningTitle.slice(0, 24)}` : null,
    dim: false,
    detail: detail(
      "machine",
      "메인 PC (감독 프로그램)",
      [
        { label: "감독 버전", value: `${shortCommit(sv.commit)}${sv.commitSubject ? ` · ${sv.commitSubject.slice(0, 60)}` : ""}` },
        { label: "연결 상태", value: sv.online ? `연결됨 (마지막 응답 ${ago(now, sv.lastSeenAt)})` : `끊김 (마지막 응답 ${ago(now, sv.lastSeenAt)})` },
        { label: "슬롯 사용", value: `앱 일감 ${sv.running}/${sv.appSlots}개 진행 · 승인됨 ${sv.approved} · 승인 대기 ${sv.pending}` },
        { label: "받는 일", value: sv.enabled ? "켜짐" : "일시 정지(새 일감을 받지 않음)" },
        { label: "장비 보고", value: `${pcDev.text}${input.devices["main-pc"].cpuPct !== null ? ` · CPU ${Math.round(input.devices["main-pc"].cpuPct)}%` : ""}${input.devices["main-pc"].ramPct !== null ? ` · RAM ${Math.round(input.devices["main-pc"].ramPct)}%` : ""}` },
        ...(sv.startedAt ? [{ label: "시작", value: sv.startedAt.slice(0, 16).replace("T", " ") }] : []),
      ],
      [
        ...(sv.staleCopies.length ? [{ heading: "정리가 필요한 오래된 사본", items: sv.staleCopies, tone: "warn" as const }] : []),
        ...(input.agentErrors.length ? [{ heading: "거절된 에이전트 정의", items: input.agentErrors.map((e) => `${e.file}: ${e.message}`), tone: "warn" as const }] : []),
      ],
    ),
  });

  const serverMachine = (key: "server1" | "server2", short: string, name: string, role: string, extra: { status?: MapStatus; text?: string; live?: string | null } = {}) => {
    const dev = input.devices[key];
    const base = deviceStatus(dev);
    const status = extra.status && base.status === "ok" ? extra.status : base.status;
    const known = dev.containers !== null;
    const list = dev.containers ?? [];

    add({
      id: nodeId.machine(key),
      kind: "machine",
      type: "machine",
      band: key,
      title: short,
      sub: name,
      status,
      statusText: extra.status && base.status === "ok" ? (extra.text ?? base.text) : base.text,
      badges: [{ text: known ? `컨테이너 ${list.length}개` : "컨테이너 미확인", tone: known ? "muted" : "warn" }],
      live: extra.live ?? null,
      dim: false,
      detail: detail("machine", `${short} (${name})`, [
        { label: "역할", value: role },
        { label: "장비 보고", value: `${base.text}${dev.receivedAt !== null ? ` (${ago(now, dev.receivedAt)})` : ""}` },
        { label: "CPU·RAM", value: `${dev.cpuPct !== null ? `${Math.round(dev.cpuPct)}%` : "?"} · ${dev.ramPct !== null ? `${Math.round(dev.ramPct)}%` : "?"}` },
        { label: "컨테이너", value: known ? `${list.length}개 (docker ps 보고)` : "아직 못 받음" },
        ...(extra.status === "pending" ? [{ label: "배포", value: extra.text ?? "배포 대기" }] : []),
      ]),
    });
  };

  serverMachine("server1", "서버1", "serverpc", "홈페이지·서비스 배포 (nginx + Docker)", {
    status: input.maintenance.deployingNow || sv.deploying ? "busy" : input.maintenance.needsDeploy > 0 ? "pending" : undefined,
    text: input.maintenance.deployingNow || sv.deploying ? "배포 중" : `정비 코드 배포 대기 ${input.maintenance.needsDeploy}건`,
    live: input.maintenance.deployingNow || sv.deploying ? "▶ 서버 배포 중" : null,
  });
  serverMachine("server2", "서버2", "serverpc2", "작업 결과 git 저장소 (+ 서비스)");

  // ── 도구 블록(2-1 설명서)
  for (const t of input.tools) {
    const missing = t.methods.filter((m) => m.secrets.some((s) => !s.ready)).length;

    add({
      id: nodeId.tool(t.name),
      kind: "tool",
      type: "tool",
      band: "main",
      title: t.label || t.name,
      sub: t.name,
      status: t.source === "file" ? "ok" : "warn",
      statusText: t.source === "file" ? "설명서 file" : "설명서 fallback(최소)",
      badges: [
        { text: `방법 ${t.methods.length}`, tone: "muted" },
        ...(missing ? [{ text: `키 없음 ${missing}곳`, tone: "warn" as const }] : []),
      ],
      live: null,
      dim: false,
      detail: detail(
        "tool",
        `${t.label || t.name} (${t.name})`,
        [
          { label: "설명서", value: t.source === "file" ? `file · 판 ${t.version}` : "fallback — 도구함 정보로 만든 최소 설명서" },
          { label: "쓰는 카드", value: `${input.cards.filter((c) => c.tool === t.name).length}장` },
        ],
        [{ heading: "방법과 필요한 키 이름(값 없음)", items: t.methods.map((m) => `${m.label || m.id}: ${m.secrets.length ? m.secrets.map((s) => `${s.name} ${s.ready ? "등록됨" : "없음"}`).join(", ") : "키 필요 없음"}`) }],
      ),
    });
  }

  // ── 에이전트 블록(4-2 정의)
  const keyNamesOf = (a: MapAgentPerm): string[] => {
    if (a.keys === "tool-method") return [...new Set(input.tools.flatMap((t) => t.methods.flatMap((m) => m.secrets.map((s) => s.name))))].sort();
    if (a.keys === "none") return [];
    const recent = input.jobs.filter((j) => agentOfJob(j) === a.id).slice(0, 20);

    return [...new Set(recent.flatMap((j) => j.requiredSecrets))].sort();
  };

  for (const a of [...input.agents].sort((x, y) => AGENT_ORDER.indexOf(x.id) - AGENT_ORDER.indexOf(y.id))) {
    const live = (runningByAgent.get(a.id) ?? [])[0] ?? null;
    const maintLive = a.id === "M1" && input.maintenance.runningTitle ? `▶ ${input.maintenance.runningTitle.slice(0, 24)}` : null;
    const keyNames = keyNamesOf(a);

    add({
      id: nodeId.agent(a.id),
      kind: "agent",
      type: "agent",
      band: "main",
      title: `${a.id} ${a.label}`,
      sub: `${a.engines.join("·")} · ${a.readOnly ? "읽기 전용" : a.tools.length ? `도구 ${a.tools.length}` : "도구 없음"}`,
      status: live || maintLive ? "busy" : "ok",
      statusText: live || maintLive ? "작업 중" : "대기",
      badges: [{ text: a.migrated ? "정의로 실행" : "정의 기록용", tone: a.migrated ? "ok" : "muted" }],
      live: live ? liveLine(live) : maintLive,
      dim: false,
      detail: detail(
        "agent",
        `${a.id} ${a.label}`,
        [
          { label: "하는 일", value: a.summary || "—" },
          { label: "엔진", value: a.engines.join(", ") },
          { label: "실행 방식", value: a.migrated ? "정의 파일을 읽어 실행 설정을 만든다" : "정의는 기록용(실제 설정은 코드가 만든다)" },
          { label: "작업 공간", value: a.workspace },
          { label: "키 결정", value: KEY_TEXT[a.keys] ?? a.keys },
          { label: "환경변수 거르기", value: a.envFilter },
          { label: "다음 연결", value: a.next.join(", ") || "없음" },
        ],
        [
          { heading: "허용 도구", items: a.tools.length ? a.tools : ["없음"] },
          { heading: "막은 도구", items: a.blockedTools },
          { heading: "쓸 수 있는 경로", items: a.writes.length ? a.writes : ["없음"] },
          { heading: "쓰기 금지", items: a.noWrites.length ? a.noWrites : ["(별도 금지 없음)"] },
          { heading: "읽기 금지", items: a.readBlocks.length ? a.readBlocks : ["(별도 금지 없음)"] },
          { heading: "네트워크", items: a.network.length ? a.network : ["없음"] },
          { heading: "SSH 대상", items: a.ssh.length ? a.ssh : ["없음"] },
          { heading: "받는 키 이름(값 없음)", items: keyNames.length ? keyNames : [a.keys === "none" ? "없음" : "지금 알려진 이름 없음"] },
          { heading: "훅", items: a.hooks.length ? a.hooks : ["없음"] },
          { heading: "넘기는 환경변수 이름", items: a.envNames.length ? a.envNames : ["없음"] },
        ],
      ),
    });
  }

  // ── 결과물 카드(2-2)
  for (const c of [...input.cards].sort((x, y) => (x.appSlug === y.appSlug ? x.name.localeCompare(y.name) : x.appSlug.localeCompare(y.appSlug)))) {
    add({
      id: nodeId.card(c.id),
      kind: "card",
      type: "card",
      band: "main",
      title: c.name,
      sub: `${c.appSlug} · ${c.tool}${c.method ? ` · ${c.method}` : ""}`,
      status: c.warnings.length ? "warn" : "ok",
      statusText: c.warnings.length ? `경고 ${c.warnings.length}` : c.enabled ? "정상" : "꺼짐",
      badges: [{ text: `판 ${c.version}`, tone: "muted" }, ...(c.enabled ? [] : [{ text: "꺼짐", tone: "muted" as const }])],
      live: null,
      dim: !c.enabled,
      detail: detail("card", c.name, [
        { label: "프로젝트", value: c.appSlug },
        { label: "도구·방법", value: `${c.tool}${c.method ? ` · ${c.method}` : " · 기본 방식"}` },
        { label: "판 / 상태", value: `판 ${c.version} · ${c.enabled ? "켜짐" : "꺼짐"}` },
      ], c.warnings.length ? [{ heading: "경고", items: c.warnings, tone: "warn" }] : []),
    });
  }

  // ── 앱 폴더·git 원격
  const listOf = (srv: "serverpc" | "serverpc2"): { known: boolean; items: MapContainer[] } => {
    const dev = input.devices[SERVER_OF[srv]].containers;

    if (dev) return { known: true, items: dev };
    const names = input.serverNames[srv];

    return names ? { known: true, items: names.map((n) => ({ name: n, state: "running", status: null, restarts: null, project: null, flags: [] })) } : { known: false, items: [] };
  };
  const lists = { serverpc: listOf("serverpc"), serverpc2: listOf("serverpc2") };

  for (const r of input.links.rows) {
    const jobs = jobsByApp.get(r.appSlug) ?? [];
    const live = jobs.find((j) => ACTIVE.includes(j.status)) ?? null;
    const waiting = jobs.find((j) => WAITING.includes(j.status)) ?? null;
    const deployRemote = r.remotes.find((x) => x.purpose === "deploy") ?? null;
    const github = r.remotes.find((x) => x.purpose === "github") ?? null;
    let status: MapStatus = "ok";
    let text = "정상";

    if (r.hasFolder === false) ({ status, text } = { status: "down", text: "폴더 못 찾음" });
    else if (live) ({ status, text } = { status: "busy", text: "작업 중" });
    else if (r.warnings.some((w) => w.kind === "no-remote" || w.kind === "not-git")) ({ status, text } = { status: "warn", text: r.warnings.find((w) => w.kind !== "no-container")?.text ?? "경고" });
    else if (waiting) ({ status, text } = { status: "pending", text: WAIT_TEXT[waiting.status] ?? "대기" });

    add({
      id: nodeId.app(r.appSlug),
      kind: "app",
      type: "app",
      band: "main",
      slot: -1,
      title: r.appSlug,
      sub: `${r.branch ?? "브랜치 ?"}${r.stack ? ` · ${r.stack}` : ""}`,
      status,
      statusText: text,
      badges: [
        ...(r.remotes.length ? [{ text: `원격 ${r.remotes.length}`, tone: "muted" as const }] : [{ text: "원격 없음", tone: "warn" as const }]),
        ...(github ? [{ text: "GitHub", tone: "ok" as const }] : []),
      ],
      live: live ? liveLine(live) : null,
      dim: false,
      detail: detail(
        "app",
        r.appSlug,
        [
          { label: "폴더", value: r.hasFolder === null ? "확인 전(감독 보고 없음)" : r.hasFolder ? `있음${r.isGit === false ? " (git 아님)" : ""}` : "못 찾음" },
          { label: "브랜치", value: r.branch ?? "알 수 없음" },
          { label: "스택", value: r.stack ?? "—" },
          { label: "배포", value: r.deployServer && r.deployServer !== "none" ? `${r.deployServer} · ${r.containerName ?? "컨테이너 이름 없음"}${r.deployMethod ? ` · ${r.deployMethod}` : ""}` : "없음" },
          { label: "도메인", value: r.domain ?? "없음" },
          { label: "원격 출처", value: r.remotesSource === "report" ? "감독 프로그램 보고" : r.remotesSource === "initial" ? "초기 조사 기록" : "없음" },
        ],
        [
          { heading: "git 원격", items: r.remotes.length ? r.remotes.map((x) => `${x.name} → ${x.host}${x.path ? `:${x.path}` : ""} (${x.purpose === "deploy" ? "배포" : x.purpose === "github" ? "GitHub" : x.purpose === "backup" ? "백업" : "기타"})`) : ["없음"], ...(r.remotes.length ? {} : { tone: "warn" as const }) },
          {
            heading: "최근 일감",
            items: jobs.length ? jobs.slice(0, 5).map((j) => `${j.status === "running" ? "▶" : j.status === "done" ? "✓" : j.status === "failed" ? "✕" : "·"} ${j.title.slice(0, 40)} (${agentOfJob(j)} · ${j.status}${j.phase && j.status === "running" ? ` · ${phaseText(j.phase)}` : ""} · ${ago(now, j.finishedAt ?? j.startedAt ?? j.createdAt)})`) : ["일감 없음"],
          },
          ...(r.warnings.length ? [{ heading: "경고", items: r.warnings.map((w) => w.text), tone: "warn" as const }] : []),
        ],
      ),
    });

    if (deployRemote) {
      add({
        id: nodeId.remote(r.appSlug),
        kind: "remote",
        type: "remote",
        band: "main",
        slot: -1,
        title: `git ${deployRemote.host}`,
        sub: deployRemote.path ? `${deployRemote.path}`.slice(0, 40) : deployRemote.name,
        status: "ok",
        statusText: "배포 원격",
        badges: [{ text: deployRemote.name, tone: "muted" }],
        live: null,
        dim: false,
        detail: detail("remote", `${r.appSlug} 배포 원격`, [
          { label: "원격 이름", value: deployRemote.name },
          { label: "주소", value: `${deployRemote.host}${deployRemote.path ? `:${deployRemote.path}` : ""}` },
          { label: "용도", value: "배포 저장소 — 서버 배포는 통제실 [배포]로만" },
        ]),
      });
    }
  }

  // ── 서버 안: 컨테이너, 프록시, 도메인
  const proxyHere = input.links.rows.some((r) => r.domain && r.deployServer === "serverpc");

  for (const srv of ["serverpc", "serverpc2"] as const) {
    const { known, items } = lists[srv];
    const band = SERVER_OF[srv];
    const names = new Set(items.map((c) => c.name));
    const used = (name: string) => input.links.rows.filter((r) => (r.containerName === name && r.deployServer === srv) || (r.services.includes(name) && r.deployServer === srv));

    for (const c of [...items].sort((a, b) => a.name.localeCompare(b.name))) {
      const st = containerStatus(c, known);
      const rows = used(c.name);

      add({
        id: nodeId.container(srv, c.name),
        kind: "container",
        type: "container",
        band,
        title: c.name,
        sub: rows.length ? rows.map((r) => r.appSlug).join(", ") : (c.project ?? "연결된 프로젝트 기록 없음"),
        status: st.status,
        statusText: st.text,
        badges: [
          ...(rows.some((r) => r.domain) ? [{ text: rows.find((r) => r.domain)!.domain!.slice(0, 22), tone: "muted" as const }] : []),
          ...((c.restarts ?? 0) > 0 ? [{ text: `재시작 ${c.restarts}`, tone: (c.restarts ?? 0) >= 3 ? ("warn" as const) : ("muted" as const) }] : []),
        ],
        live: null,
        dim: false,
        detail: detail(
          "container",
          c.name,
          [
            { label: "서버", value: srv === "serverpc" ? "서버1 (serverpc)" : "서버2 (serverpc2)" },
            { label: "상태", value: `${st.text}${c.status ? ` · ${c.status}` : ""}` },
            { label: "도메인", value: [...new Set(rows.map((r) => r.domain).filter(Boolean))].join(", ") || "기록 없음" },
            { label: "연결된 프로젝트", value: rows.map((r) => r.appSlug).join(", ") || (c.project ? `compose: ${c.project}` : "기록 없음") },
            { label: "재시작", value: c.restarts === null ? "?" : `${c.restarts}회` },
          ],
          c.flags.length ? [{ heading: "주의 표시", items: c.flags, tone: "warn" }] : [],
        ),
      });
    }
    // 연결 표에는 있는데 서버 목록에 없는 컨테이너(목록을 읽은 서버만)
    for (const r of input.links.rows) {
      if (r.deployServer !== srv) continue;
      for (const name of [r.containerName, ...r.services].filter((n): n is string => !!n)) {
        if (names.has(name) || have.has(nodeId.container(srv, name))) continue;
        const st = containerStatus(null, known);

        add({
          id: nodeId.container(srv, name),
          kind: "container",
          type: "container",
          band,
          title: name,
          sub: r.appSlug,
          status: st.status,
          statusText: st.text,
          badges: [{ text: known ? "서버 목록에 없음" : "서버 목록 미확인", tone: "warn" }],
          live: null,
          dim: true,
          detail: detail("container", name, [
            { label: "서버", value: srv === "serverpc" ? "서버1 (serverpc)" : "서버2 (serverpc2)" },
            { label: "상태", value: known ? "연결 표에 적힌 컨테이너를 서버 목록(docker ps)에서 못 찾음" : "서버 목록을 아직 못 받아 확인하지 못함" },
            { label: "연결된 프로젝트", value: r.appSlug },
            { label: "도메인", value: r.domain ?? "기록 없음" },
          ]),
        });
      }
    }
  }

  if (proxyHere) {
    add({
      id: nodeId.proxy(),
      kind: "proxy",
      type: "proxy",
      band: "server1",
      title: "프록시 (nginx)",
      sub: "서버1 · 기록된 도메인만",
      status: input.devices.server1.state === "ok" ? "ok" : deviceStatus(input.devices.server1).status,
      statusText: "설정은 읽지 않음",
      badges: [{ text: "연결 표 기준", tone: "muted" }],
      live: null,
      dim: false,
      detail: detail("proxy", "서버1 프록시 (nginx)", [
        { label: "범위", value: "연결 표(통제실 설정)에 적힌 도메인과 컨테이너 이름만 그린다. nginx 설정 파일은 읽지 않는다." },
        { label: "도메인 수", value: `${input.links.rows.filter((r) => r.domain && r.deployServer === "serverpc").length}개` },
      ]),
    });
  }
  const seenDomain = new Set<string>();

  for (const r of input.links.rows) {
    if (!r.domain || seenDomain.has(r.domain)) continue;
    seenDomain.add(r.domain);
    const srv = r.deployServer === "serverpc" || r.deployServer === "serverpc2" ? r.deployServer : null;
    const containerOk = srv && r.containerName ? have.has(nodeId.container(srv, r.containerName)) && drafts.find((d) => d.id === nodeId.container(srv, r.containerName!))?.status !== "down" : null;

    add({
      id: nodeId.domain(r.domain),
      kind: "domain",
      type: "domain",
      band: srv === "serverpc2" ? "server2" : "server1",
      title: r.domain,
      sub: r.appSlug,
      status: containerOk === false || !r.containerName ? "warn" : "ok",
      statusText: !r.containerName ? "컨테이너 기록 없음" : containerOk === false ? "컨테이너 못 찾음" : "기록됨",
      badges: srv === "serverpc2" ? [{ text: "프록시 연결 기록 없음", tone: "muted" }] : [],
      live: null,
      dim: false,
      detail: detail("domain", r.domain, [
        { label: "프로젝트", value: r.appSlug },
        { label: "배포 서버", value: srv ? (srv === "serverpc" ? "서버1" : "서버2") : "기록 없음" },
        { label: "컨테이너", value: r.containerName ?? "기록 없음" },
        { label: "출처", value: "연결 표(사람이 적은 값). nginx 설정은 읽지 않음" },
      ]),
    });
  }

  // ── 선
  for (const a of input.agents) {
    if (AGENT_USES_BROKER.includes(a.id)) for (const t of input.tools) link(nodeId.agent(a.id), nodeId.tool(t.name), "tool");
    if (AGENT_USES_CARD.includes(a.id)) for (const t of new Set(input.cards.map((c) => c.tool))) link(nodeId.agent(a.id), nodeId.tool(t), "tool");
  }
  for (const c of input.cards) {
    link(nodeId.card(c.id), nodeId.tool(c.tool), "tool");
    link(nodeId.card(c.id), nodeId.app(c.appSlug), "card");
  }
  for (const r of input.links.rows) {
    const srv = r.deployServer === "serverpc" || r.deployServer === "serverpc2" ? r.deployServer : null;
    const target = srv && r.containerName ? nodeId.container(srv, r.containerName) : null;

    link(nodeId.app(r.appSlug), nodeId.remote(r.appSlug), "git");
    if (target) {
      if (have.has(nodeId.remote(r.appSlug))) link(nodeId.remote(r.appSlug), target, "git");
      else link(nodeId.app(r.appSlug), target, "git", true);
    }
    if (srv) for (const s of r.services) link(target ?? nodeId.app(r.appSlug), nodeId.container(srv, s), "service", true);
    if (r.domain) {
      if (r.deployServer === "serverpc") link(nodeId.proxy(), nodeId.domain(r.domain), "route");
      if (target) link(nodeId.domain(r.domain), target, "route");
    }
  }

  return layout(drafts, edges);
}

// ───────── 배치 ─────────

function layout(drafts: Draft[], edges: MapEdge[]): MapGraph {
  const bands: ("main" | "server1" | "server2")[] = ["main", "server1", "server2"];
  const nodes: MapNode[] = [];
  const frames: BlockFrame[] = [];
  const width = MAP_PAD * 2 + COL_COUNT * MAP_W + (COL_COUNT - 1) * MAP_COL_GAP;
  let y = MAP_PAD;

  for (const band of bands) {
    const list = drafts.filter((d) => d.band === band);

    if (!list.length) continue;
    const byCol = new Map<number, Draft[]>();

    for (const d of list) {
      const col = COLS[d.kind];

      byCol.set(col, [...(byCol.get(col) ?? []), d]);
    }
    // 앱 폴더와 그 배포 원격은 같은 줄에 놓는다(선이 수평). 나머지는 각 열을 위에서부터 쌓는다
    const appRows = new Map<string, number>();

    (byCol.get(COLS.app) ?? []).forEach((d, i) => appRows.set(d.id.slice(4), i));
    const rowOf = (d: Draft, i: number) => (d.kind === "remote" ? (appRows.get(d.id.slice(7)) ?? i) : i);
    const rows = Math.max(1, ...[...byCol.entries()].map(([, v]) => Math.max(v.length, ...v.map((d, i) => rowOf(d, i) + 1))));
    const top = y + FRAME_HEAD;

    for (const [col, items] of byCol) {
      items.forEach((d, i) => {
        const node: MapNode = { ...d, col, x: MAP_PAD + col * (MAP_W + MAP_COL_GAP), y: top + rowOf(d, i) * (MAP_H + MAP_ROW_GAP), w: MAP_W, h: MAP_H };

        delete (node as { band?: unknown }).band;
        delete (node as { slot?: unknown }).slot;
        nodes.push(node);
      });
    }
    const h = FRAME_HEAD + rows * MAP_H + (rows - 1) * MAP_ROW_GAP + 8;

    frames.push({ id: `frame:${band}`, label: band === "main" ? "메인 PC" : band === "server1" ? "서버1 (serverpc)" : "서버2 (serverpc2)", x: 2, y, w: width - 4, h });
    y += h + FRAME_GAP;
  }
  const counts: Record<MapStatus, number> = { ok: 0, busy: 0, pending: 0, down: 0, warn: 0 };

  for (const n of nodes) counts[n.status ?? "ok"] += 1;

  return { nodes, edges, frames, width, height: y - FRAME_GAP + MAP_PAD, counts };
}
