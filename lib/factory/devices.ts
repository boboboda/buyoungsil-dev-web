// lib/factory/devices.ts
// 통제실 '장비 상태': 서버1·서버2·메인PC 가 1분마다 보내는 CPU·RAM·GPU·디스크 값을 검증·저장하고 화면용으로 바꾼다.
// - 받는 쪽: POST /api/factory/device-stats (상태 수신 토큰 CLAUDE_STATUS_TOKEN 또는 작업 PC 토큰)
// - 보는 쪽: GET /api/admin/factory/devices (관리자만), 하단 상태바 요약
// 값은 숫자뿐이다. 장비 이름은 허용 목록만, 사용률은 0~100, 음수·NaN·문자열은 거부한다.
// 서버1은 실행 중인 Docker 컨테이너 '이름'만 같이 보낸다(이미지·포트·환경변수 없음).
// 실행 중인 모든 것(running: 컨테이너·프로세스 이름/상태/메모리)도 같은 행에 넣고, 메모리 추이·의심 표시를 서버가 붙인다(화면은 따로).
// 최신 값은 장비마다 1행(device_stats), 이력은 5분에 한 점씩 24시간(device_stat_samples, 오래된 건 저장할 때 지움).
import prisma from "@/lib/prisma";

export const DEVICES = ["server1", "server2", "main-pc"] as const;

export type DeviceKey = (typeof DEVICES)[number];

export const DEVICE_INFO: Record<
  DeviceKey,
  { name: string; short: string; role: string }
> = {
  server1: {
    name: "서버1 (serverpc)",
    short: "서버1",
    role: "홈페이지·서비스 배포 (nginx + Docker)",
  },
  server2: {
    name: "서버2 (serverpc2)",
    short: "서버2",
    role: "작업 결과 git 저장소",
  },
  "main-pc": {
    name: "메인PC (main-pc)",
    short: "메인PC",
    role: "감독 프로그램이 도는 Windows PC",
  },
};

export const DEVICE_STALE_MS = 10 * 60_000; // 10분 넘게 안 오면 '오래된 값'
export const DEVICE_OFFLINE_MS = 30 * 60_000; // 30분 넘게 안 오면 '끊김'
export const SAMPLE_EVERY_MS = 5 * 60_000;
export const HISTORY_MS = 24 * 60 * 60_000;
export const MAX_DEVICE_BODY_CHARS = 8 * 1024;
const MAX_MEASURED_PAST_MS = 60 * 60_000;
const MAX_GB = 1_000_000;
const MAX_DISKS = 4;
const MAX_GPUS = 4;
const MAX_CONTAINERS = 60;
const CONTAINER_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/;

export interface GbPair {
  usedGb: number;
  totalGb: number;
}

export interface GpuItem {
  utilPct: number | null;
  memUsedGb: number | null;
  memTotalGb: number | null;
  tempC: number | null;
}

export type GpuInput =
  | { state: "ok"; list: GpuItem[] }
  | { state: "none" } // GPU 없음(nvidia-smi 없음, Linux)
  | { state: "unknown" }; // 확인 못 함

export type ContainersInput =
  | { state: "ok"; names: string[] }
  | { state: "unknown" }; // docker 권한 없음 등

export const RUN_FLAGS = [
  "long_running",
  "restart_loop",
  "stopped",
  "unlabeled",
  "heavy_orphan",
] as const;

export type RunFlag = (typeof RUN_FLAGS)[number];

export interface TrendPoint {
  t: number; // 유닉스 초
  mb: number;
}

export interface RunningContainer {
  name: string;
  image: string | null;
  state: string;
  status: string | null;
  uptimeSec: number | null;
  stoppedSec: number | null;
  restarts: number | null;
  cpuPct: number | null;
  memMb: number | null;
  project: string | null;
  flags: RunFlag[];
  memTrend?: TrendPoint[];
}

export interface RunningProcess {
  pid: number;
  name: string;
  dir: string | null;
  memMb: number | null;
  cpuSec: number | null;
  startedAt: number | null;
  child: boolean;
  ports: number[];
  flags: RunFlag[];
  memTrend?: TrendPoint[];
}

export interface RunningSummary {
  stoppedContainers: number | null;
  danglingImages: number | null;
  imageBytes: number | null;
  volumes: number | null;
}

export interface RunningInput {
  containers: RunningContainer[] | null;
  processes: RunningProcess[] | null;
  summary: RunningSummary | null;
  error: string | null;
  truncated: boolean;
}

export interface DeviceData {
  cpuPct: number | null;
  ram: GbPair | null;
  gpu: GpuInput;
  disks: (GbPair & { mount: string })[];
  containers?: ContainersInput;
  running?: RunningInput;
}

export interface DevicePayload {
  device: DeviceKey;
  measuredAt: Date | null;
  data: DeviceData;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const BAD = Symbol("bad");

// 숫자 하나: 없으면(null·undefined) null, 범위 밖·숫자 아님(NaN·문자열)이면 BAD
function numIn(v: unknown, min: number, max: number): number | null | typeof BAD {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    return BAD;

  return Math.round(v * 10) / 10;
}

function gbPair(v: unknown): GbPair | null | typeof BAD {
  if (v === undefined || v === null) return null;
  if (!isRecord(v)) return BAD;

  const used = numIn(v.usedGb, 0, MAX_GB);
  const total = numIn(v.totalGb, 0, MAX_GB);

  if (used === BAD || total === BAD || used === null || total === null)
    return BAD;
  if (total <= 0 || used > total * 1.01) return BAD;

  return { usedGb: Math.min(used, total), totalGb: total };
}

function parseGpu(v: unknown): GpuInput | typeof BAD {
  if (v === undefined || v === null) return { state: "unknown" };
  if (!isRecord(v)) return BAD;
  if (v.state === "none" || v.state === "unknown") return { state: v.state };
  if (v.state !== "ok" || !Array.isArray(v.list) || v.list.length === 0)
    return BAD;

  const list: GpuItem[] = [];

  for (const g of v.list.slice(0, MAX_GPUS)) {
    if (!isRecord(g)) return BAD;

    const utilPct = numIn(g.utilPct, 0, 100);
    const memUsedGb = numIn(g.memUsedGb, 0, MAX_GB);
    const memTotalGb = numIn(g.memTotalGb, 0, MAX_GB);
    const tempC = numIn(g.tempC, -50, 150);

    if ([utilPct, memUsedGb, memTotalGb, tempC].includes(BAD)) return BAD;
    list.push({
      utilPct: utilPct as number | null,
      memUsedGb: memUsedGb as number | null,
      memTotalGb: memTotalGb as number | null,
      tempC: tempC as number | null,
    });
  }

  return { state: "ok", list };
}

function parseDisks(v: unknown): DeviceData["disks"] | typeof BAD {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 16) return BAD;

  const out: DeviceData["disks"] = [];

  for (const d of v.slice(0, MAX_DISKS)) {
    if (!isRecord(d) || typeof d.mount !== "string") return BAD;

    const mount = d.mount.replace(/[^A-Za-z0-9_/.:-]/g, "").slice(0, 40);
    const pair = gbPair(d);

    if (!mount || pair === BAD || pair === null) return BAD;
    out.push({ mount, ...pair });
  }

  return out;
}

function parseContainers(v: unknown): ContainersInput | undefined | typeof BAD {
  if (v === undefined || v === null) return undefined;
  if (!isRecord(v)) return BAD;
  if (v.state === "unknown") return { state: "unknown" };
  if (v.state !== "ok" || !Array.isArray(v.names)) return BAD;

  const names = v.names
    .filter((n): n is string => typeof n === "string" && CONTAINER_RE.test(n))
    .slice(0, MAX_CONTAINERS);

  return { state: "ok", names: [...new Set(names)].sort() };
}

// ── 실행 중인 것(running) ─────────────────────
// 컨테이너(서버)·프로세스(메인PC)의 이름·상태·메모리만 받는다. 명령줄·환경변수·마운트가 든 항목은 400.
// 저장할 때 메모리 추이(최근 30분, 최대 10점, 상위 5개)와 의심 표시(flags)를 서버가 계산해 붙인다(보낸 쪽 값은 버림).

export const MAX_RUNNING_ITEMS = 15;
export const LONG_RUNNING_SEC = 7 * 24 * 3600;
export const STOPPED_LONG_SEC = 24 * 3600;
export const RESTART_LOOP_COUNT = 3;
export const HEAVY_ORPHAN_MB = 500;
export const TREND_EVERY_MS = 3 * 60_000;
export const TREND_WINDOW_MS = 30 * 60_000;
export const TREND_MAX_POINTS = 10;
export const TREND_TOP = 5;
const RUN_STATES = ["running", "exited", "restarting", "paused", "created", "dead", "removing"];
const IMAGE_RE = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,199}$/;
const FORBIDDEN_KEYS = new Set([
  "env", "environment", "cmd", "command", "cmdline", "commandline", "args", "argv",
  "entrypoint", "mounts", "binds", "labels", "path", "exe", "token", "password", "secret", "auth",
]);

const hasForbidden = (o: Record<string, unknown>) =>
  Object.keys(o).some((k) => FORBIDDEN_KEYS.has(k.toLowerCase()));

function cleanStr(v: unknown, max: number, strip: RegExp): string | null {
  if (typeof v !== "string") return null;

  const out = v.replace(strip, "").trim().slice(0, max);

  return out || null;
}

function runInt(v: unknown, min: number, max: number): number | null | typeof BAD {
  const n = numIn(v, min, max);

  return n === BAD || n === null ? n : Math.round(n);
}

function parseTrend(v: unknown): TrendPoint[] | undefined {
  if (!Array.isArray(v)) return undefined;

  const out: TrendPoint[] = [];

  for (const p of v.slice(-TREND_MAX_POINTS)) {
    if (!isRecord(p)) continue;

    const t = numIn(p.t, 0, 4e9);
    const mb = numIn(p.mb, 0, 1e7);

    if (t === BAD || mb === BAD || t === null || mb === null) continue;
    out.push({ t: Math.round(t), mb });
  }

  return out.length ? out : undefined;
}

const parseFlags = (v: unknown): RunFlag[] =>
  Array.isArray(v) ? RUN_FLAGS.filter((f) => v.includes(f)) : [];

function parseContainerItem(c: unknown): RunningContainer | typeof BAD {
  if (!isRecord(c) || hasForbidden(c)) return BAD;
  if (typeof c.name !== "string" || !CONTAINER_RE.test(c.name)) return BAD;

  let image: string | null = null;

  if (c.image !== undefined && c.image !== null) {
    if (typeof c.image !== "string" || !IMAGE_RE.test(c.image) || c.image.includes("//")) return BAD;
    image = c.image;
  }

  const state = typeof c.state === "string" ? c.state.toLowerCase() : "";

  if (!RUN_STATES.includes(state)) return BAD;

  const uptimeSec = runInt(c.uptimeSec, 0, 1e9);
  const stoppedSec = runInt(c.stoppedSec, 0, 1e9);
  const restarts = runInt(c.restarts, 0, 1e7);
  const cpuPct = numIn(c.cpuPct, 0, 10_000);
  const memMb = numIn(c.memMb, 0, 1e7);

  if ([uptimeSec, stoppedSec, restarts, cpuPct, memMb].includes(BAD)) return BAD;

  const memTrend = parseTrend(c.memTrend);

  return {
    name: c.name,
    image,
    state,
    status: cleanStr(c.status, 80, /[^A-Za-z0-9 _.,:()/-]/g),
    uptimeSec: uptimeSec as number | null,
    stoppedSec: stoppedSec as number | null,
    restarts: restarts as number | null,
    cpuPct: cpuPct as number | null,
    memMb: memMb as number | null,
    project: cleanStr(c.project, 60, /[^A-Za-z0-9_.-]/g),
    flags: parseFlags(c.flags),
    ...(memTrend ? { memTrend } : {}),
  };
}

function parseProcessItem(p: unknown): RunningProcess | typeof BAD {
  if (!isRecord(p) || hasForbidden(p)) return BAD;

  const pid = runInt(p.pid, 0, 4_294_967_295);
  const name = cleanStr(
    typeof p.name === "string" ? p.name.replace(/\.exe$/i, "") : null,
    60,
    /[^A-Za-z0-9 _.()-]/g,
  );

  if (pid === BAD || pid === null || !name || !/[A-Za-z0-9]/.test(name)) return BAD;

  const memMb = numIn(p.memMb, 0, 1e7);
  const cpuSec = numIn(p.cpuSec, 0, 1e9);
  const startedAt = runInt(p.startedAt, 0, 4e9);

  if ([memMb, cpuSec, startedAt].includes(BAD)) return BAD;
  if (p.ports !== undefined && p.ports !== null && !Array.isArray(p.ports)) return BAD;

  const ports: number[] = [];

  for (const port of (p.ports as unknown[] | undefined)?.slice(0, 8) ?? []) {
    const n = runInt(port, 1, 65535);

    if (n === BAD || n === null) return BAD;
    if (!ports.includes(n)) ports.push(n);
  }

  // 폴더는 마지막 이름 하나만(경로 전체·사용자 폴더는 받지 않는다)
  const dirLeaf =
    typeof p.dir === "string" ? (p.dir.split(/[\\/]/).filter(Boolean).pop() ?? "") : null;
  const memTrend = parseTrend(p.memTrend);

  return {
    pid,
    name,
    dir: cleanStr(dirLeaf, 40, /[^A-Za-z0-9 _.()-]/g),
    memMb: memMb as number | null,
    cpuSec: cpuSec as number | null,
    startedAt: startedAt as number | null,
    child: p.child === true,
    ports,
    flags: parseFlags(p.flags),
    ...(memTrend ? { memTrend } : {}),
  };
}

function parseRunning(v: unknown): RunningInput | undefined | typeof BAD {
  if (v === undefined || v === null) return undefined;
  if (!isRecord(v) || hasForbidden(v)) return BAD;

  let truncated = v.truncated === true;
  let containers: RunningContainer[] | null = null;
  let processes: RunningProcess[] | null = null;

  for (const key of ["containers", "processes"] as const) {
    const raw = v[key];

    if (raw === undefined || raw === null) continue;
    if (!Array.isArray(raw) || raw.length > 100) return BAD;
    if (raw.length > MAX_RUNNING_ITEMS) truncated = true;

    const items: unknown[] = [];

    for (const item of raw.slice(0, MAX_RUNNING_ITEMS)) {
      const parsed =
        key === "containers" ? parseContainerItem(item) : parseProcessItem(item);

      if (parsed === BAD) return BAD;
      items.push(parsed);
    }
    if (key === "containers") containers = items as RunningContainer[];
    else processes = items as RunningProcess[];
  }

  let summary: RunningSummary | null = null;

  if (v.summary !== undefined && v.summary !== null) {
    if (!isRecord(v.summary) || hasForbidden(v.summary)) return BAD;

    const s = v.summary;
    const stoppedContainers = runInt(s.stoppedContainers, 0, 1e6);
    const danglingImages = runInt(s.danglingImages, 0, 1e6);
    const imageBytes = runInt(s.imageBytes, 0, 1e15);
    const volumes = runInt(s.volumes, 0, 1e6);

    if ([stoppedContainers, danglingImages, imageBytes, volumes].includes(BAD)) return BAD;
    summary = {
      stoppedContainers: stoppedContainers as number | null,
      danglingImages: danglingImages as number | null,
      imageBytes: imageBytes as number | null,
      volumes: volumes as number | null,
    };
  }

  return {
    containers,
    processes,
    summary,
    error: cleanStr(v.error, 80, /[^\p{L}\p{N} _.,:()/-]/gu),
    truncated,
  };
}

// 메모리가 계속 늘어나는가: 4점 이상, 처음보다 10MB·5% 이상 늘고, 단계의 75% 이상이 줄지 않음
function rising(pts: TrendPoint[] | undefined): boolean {
  if (!pts || pts.length < 4) return false;

  const first = pts[0].mb;
  const last = pts[pts.length - 1].mb;

  if (last - first < Math.max(10, first * 0.05)) return false;

  let up = 0;

  for (let i = 1; i < pts.length; i++) if (pts[i].mb >= pts[i - 1].mb) up++;

  return up >= (pts.length - 1) * 0.75;
}

// 이전 추이에 지금 값을 이어 붙인다: 마지막 점에서 3분 넘게 지났을 때만 새 점, 30분 지난 점은 버리고 최대 10점
function nextTrend(
  prev: TrendPoint[] | undefined,
  memMb: number | null,
  nowMs: number,
): TrendPoint[] | undefined {
  const nowSec = Math.round(nowMs / 1000);
  const pts = (prev ?? []).filter(
    (p) => p.t * 1000 >= nowMs - TREND_WINDOW_MS && p.t <= nowSec,
  );
  const last = pts[pts.length - 1];

  if (memMb !== null && (!last || nowMs - last.t * 1000 >= TREND_EVERY_MS))
    pts.push({ t: nowSec, mb: memMb });

  return pts.length ? pts.slice(-TREND_MAX_POINTS) : undefined;
}

function topIndexes(items: { memMb: number | null }[]): Set<number> {
  return new Set(
    items
      .map((it, i) => [it.memMb ?? -1, i] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, TREND_TOP)
      .filter(([m]) => m >= 0)
      .map(([, i]) => i),
  );
}

/** 저장 직전: 이전 값과 이어 메모리 추이(상위 5개)를 만들고 의심 표시(flags)를 계산한다. 보낸 쪽의 flags·추이는 버린다 */
export function enrichRunning(
  cur: RunningInput,
  prev: RunningInput | undefined,
  nowMs = Date.now(),
): RunningInput {
  const nowSec = nowMs / 1000;
  const procKey = (p: RunningProcess) => `${p.name}:${p.pid}:${p.startedAt ?? ""}`;
  const prevC = new Map((prev?.containers ?? []).map((c) => [c.name, c]));
  const prevP = new Map((prev?.processes ?? []).map((p) => [procKey(p), p]));

  const withTrend = <T extends { memMb: number | null; memTrend?: TrendPoint[] }>(
    items: T[],
    old: (it: T) => TrendPoint[] | undefined,
  ): T[] => {
    const top = topIndexes(items);

    return items.map((it, i) => {
      const { memTrend: _dropped, ...rest } = it;
      const trend = top.has(i) ? nextTrend(old(it), it.memMb, nowMs) : undefined;

      return (trend ? { ...rest, memTrend: trend } : rest) as T;
    });
  };

  const containers = cur.containers
    ? withTrend(cur.containers, (c) => prevC.get(c.name)?.memTrend).map(
        (c): RunningContainer => {
          const flags: RunFlag[] = [];

          if (c.state === "running" && (c.uptimeSec ?? 0) > LONG_RUNNING_SEC && rising(c.memTrend))
            flags.push("long_running");
          if ((c.restarts ?? 0) >= RESTART_LOOP_COUNT) flags.push("restart_loop");
          if (c.state !== "running" && (c.stoppedSec ?? 0) >= STOPPED_LONG_SEC)
            flags.push("stopped");
          if (!c.project) flags.push("unlabeled");

          return { ...c, flags };
        },
      )
    : null;

  const processes = cur.processes
    ? withTrend(cur.processes, (p) => prevP.get(procKey(p))?.memTrend).map(
        (p): RunningProcess => {
          const flags: RunFlag[] = [];

          if (p.startedAt !== null && nowSec - p.startedAt > LONG_RUNNING_SEC && rising(p.memTrend))
            flags.push("long_running");
          if (!p.child && (p.memMb ?? 0) > HEAVY_ORPHAN_MB && /^(node|python)/i.test(p.name))
            flags.push("heavy_orphan");

          return { ...p, flags };
        },
      )
    : null;

  return { ...cur, containers, processes };
}

export type DeviceValidateResult =
  | { ok: true; payload: DevicePayload }
  | { ok: false; reason: string };

// 정해진 필드만 읽는다. 그 밖의 값(호스트 이름 등)은 버린다.
export function validateDevicePayload(
  body: unknown,
  now = Date.now(),
): DeviceValidateResult {
  if (!isRecord(body))
    return { ok: false, reason: "요청 형식이 올바르지 않습니다." };

  const device = body.device;

  if (typeof device !== "string" || !(DEVICES as readonly string[]).includes(device))
    return { ok: false, reason: "허용되지 않은 장비 이름입니다." };

  let measuredAt: Date | null = null;

  if (body.measuredAt !== undefined && body.measuredAt !== null) {
    const sec = body.measuredAt;

    if (typeof sec !== "number" || !Number.isFinite(sec))
      return { ok: false, reason: "measuredAt 이 올바르지 않습니다." };

    const ms = Math.round(sec * 1000);

    if (ms < now - MAX_MEASURED_PAST_MS)
      return { ok: false, reason: "measuredAt 이 너무 오래됐습니다." };
    measuredAt = new Date(Math.min(ms, now));
  }

  const cpuPct = numIn(body.cpuPct, 0, 100);

  if (cpuPct === BAD)
    return { ok: false, reason: "CPU 사용률은 0~100 이어야 합니다." };

  const ram = gbPair(body.ram);

  if (ram === BAD) return { ok: false, reason: "RAM 값이 올바르지 않습니다." };

  const gpu = parseGpu(body.gpu);

  if (gpu === BAD) return { ok: false, reason: "GPU 값이 올바르지 않습니다." };

  const disks = parseDisks(body.disks);

  if (disks === BAD)
    return { ok: false, reason: "디스크 값이 올바르지 않습니다." };

  // 컨테이너 목록은 서버1(홈페이지·서비스 배포 서버)에서만 받는다
  const containers =
    device === "server1" ? parseContainers(body.containers) : undefined;

  if (containers === BAD)
    return { ok: false, reason: "컨테이너 목록이 올바르지 않습니다." };

  const running = parseRunning(body.running);

  if (running === BAD)
    return { ok: false, reason: "실행 현황(running) 값이 올바르지 않습니다." };

  return {
    ok: true,
    payload: {
      device: device as DeviceKey,
      measuredAt,
      data: {
        cpuPct,
        ram,
        gpu,
        disks,
        ...(containers ? { containers } : {}),
        ...(running ? { running } : {}),
      },
    },
  };
}

const pctOf = (p: GbPair | null) =>
  p && p.totalGb > 0
    ? Math.round(Math.min(100, (p.usedGb / p.totalGb) * 100) * 10) / 10
    : null;

// 이력 한 점의 값(가장 많이 찬 디스크, 첫 GPU)
export function samplePoint(d: DeviceData) {
  const disks = d.disks.map(pctOf).filter((v): v is number => v !== null);

  return {
    cpuPct: d.cpuPct,
    ramPct: pctOf(d.ram),
    gpuPct: d.gpu.state === "ok" ? (d.gpu.list[0]?.utilPct ?? null) : null,
    diskPct: disks.length ? Math.max(...disks) : null,
  };
}

// 최신 값을 덮어쓰고, 마지막 이력 점이 5분 넘게 지났으면 한 점 더 남긴다(그때 24시간 지난 점은 지운다).
export async function saveDeviceStat(
  p: DevicePayload,
  now = new Date(),
): Promise<{ sampled: boolean }> {
  let data = p.data;

  // 실행 현황은 이전 값과 이어서 추이·의심 표시를 만든다(이전 값을 못 읽어도 저장은 계속)
  if (data.running) {
    let prev: RunningInput | undefined;

    try {
      const row = await prisma.deviceStat.findUnique({
        where: { device: p.device },
        select: { data: true },
      });

      prev = row ? storedData(p.device, row.data)?.running : undefined;
    } catch {
      prev = undefined;
    }
    data = { ...data, running: enrichRunning(data.running, prev, now.getTime()) };
  }

  const values = {
    data: data as object,
    measuredAt: p.measuredAt ?? now,
    receivedAt: now,
  };

  await prisma.deviceStat.upsert({
    where: { device: p.device },
    create: { device: p.device, ...values },
    update: values,
  });

  const last = await prisma.deviceStatSample.findFirst({
    where: { device: p.device },
    orderBy: { at: "desc" },
    select: { at: true },
  });

  if (last && now.getTime() - last.at.getTime() < SAMPLE_EVERY_MS)
    return { sampled: false };

  await prisma.deviceStatSample.create({
    data: { device: p.device, at: now, ...samplePoint(data) },
  });
  await prisma.deviceStatSample.deleteMany({
    where: { at: { lt: new Date(now.getTime() - HISTORY_MS) } },
  });

  return { sampled: true };
}

// ── 화면용 ─────────────────────────────────────

export type DeviceState = "ok" | "stale" | "offline" | "never";

export const DEVICE_STATE_TEXT: Record<DeviceState, string> = {
  ok: "정상",
  stale: "오래된 값",
  offline: "끊김",
  never: "받은 적 없음",
};

/** 받은 시각 → 연결 상태. 10분 넘으면 오래된 값, 30분 넘으면 끊김 */
export function deviceState(
  receivedAt: number | null,
  now: number,
): DeviceState {
  if (receivedAt === null) return "never";

  const age = now - receivedAt;

  if (age > DEVICE_OFFLINE_MS) return "offline";
  if (age > DEVICE_STALE_MS) return "stale";

  return "ok";
}

export interface DeviceView {
  device: DeviceKey;
  name: string;
  short: string;
  role: string;
  state: DeviceState;
  receivedAt: number | null;
  measuredAt: number | null;
  cpuPct: number | null;
  ram: (GbPair & { pct: number | null }) | null;
  gpu: GpuInput;
  disks: (GbPair & { mount: string; pct: number | null })[];
  // 최근 24시간, 1시간씩 24칸(그 시간의 최고값, 값이 없으면 null). 마지막 칸 = 지금 시간
  history: { cpu: (number | null)[]; ram: (number | null)[] };
}

export interface DeployCounts {
  // 서버1 에서 실행 중인 Docker 컨테이너(서버1 수집 스크립트가 보낸 이름). 서버1 값이 없거나 끊겼으면 상태로 알림
  containers:
    | { state: "ok"; count: number; names: string[]; asOf: number }
    | { state: "unknown" | "never" | "offline"; asOf: number | null };
  // 홈페이지 DB projects: 상태가 '출시(released)'인 것 / 전체
  homepage: { released: number; total: number } | null;
  // 앱 공장 출시 단계가 '출시(released)'인 앱(factory_apps)
  storeReleased: number | null;
}

export interface DevicesSnapshot {
  asOf: number;
  devices: DeviceView[];
  deploys: DeployCounts;
}

export interface DeviceRow {
  device: string;
  data: unknown;
  measuredAt: Date;
  receivedAt: Date;
}

export interface SampleRow {
  device: string;
  at: Date;
  cpuPct: number | null;
  ramPct: number | null;
}

/** 이력 점 → 1시간씩 24칸(칸마다 최고값) */
export function hourlyMax(
  samples: { at: number; v: number | null }[],
  now: number,
): (number | null)[] {
  const out: (number | null)[] = Array(24).fill(null);
  const HOUR = 60 * 60_000;

  for (const s of samples) {
    if (s.v === null) continue;

    const idx = 23 - Math.floor((now - s.at) / HOUR);

    if (idx < 0 || idx > 23) continue;
    out[idx] = Math.max(out[idx] ?? 0, s.v);
  }

  return out;
}

// 저장된 JSON 을 다시 한 번 검증한다(옛 형식·손상된 값이면 빈 값)
function storedData(device: DeviceKey, raw: unknown): DeviceData | null {
  if (!isRecord(raw)) return null;

  const r = validateDevicePayload({ ...raw, device });

  return r.ok ? r.payload.data : null;
}

export function toDeviceView(
  device: DeviceKey,
  row: DeviceRow | null,
  samples: SampleRow[],
  now: number,
): DeviceView {
  const info = DEVICE_INFO[device];
  const data = row ? storedData(device, row.data) : null;
  const mine = samples.filter((s) => s.device === device);
  const receivedAt = row ? row.receivedAt.getTime() : null;

  return {
    device,
    ...info,
    state: deviceState(receivedAt, now),
    receivedAt,
    measuredAt: row ? row.measuredAt.getTime() : null,
    cpuPct: data?.cpuPct ?? null,
    ram: data?.ram ? { ...data.ram, pct: pctOf(data.ram) } : null,
    gpu: data?.gpu ?? { state: "unknown" },
    disks: (data?.disks ?? []).map((d) => ({ ...d, pct: pctOf(d) })),
    history: {
      cpu: hourlyMax(
        mine.map((s) => ({ at: s.at.getTime(), v: s.cpuPct })),
        now,
      ),
      ram: hourlyMax(
        mine.map((s) => ({ at: s.at.getTime(), v: s.ramPct })),
        now,
      ),
    },
  };
}

export function deployContainers(
  row: DeviceRow | null,
  now: number,
): DeployCounts["containers"] {
  if (!row) return { state: "never", asOf: null };

  const asOf = row.receivedAt.getTime();

  if (deviceState(asOf, now) === "offline") return { state: "offline", asOf };

  const c = storedData("server1", row.data)?.containers;

  return c?.state === "ok"
    ? { state: "ok", count: c.names.length, names: c.names, asOf }
    : { state: "unknown", asOf };
}

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    console.error("[devices] 읽기 실패:", e);

    return null;
  }
}

/** 통제실 패널 전체. 표가 없거나 읽기에 실패한 칸은 빈 값(다른 화면에는 영향 없음) */
export async function devicesSnapshot(now = Date.now()): Promise<DevicesSnapshot> {
  const since = new Date(now - HISTORY_MS);
  const [rows, samples, released, total, store] = await Promise.all([
    settle(prisma.deviceStat.findMany()),
    settle(
      prisma.deviceStatSample.findMany({
        where: { at: { gte: since } },
        orderBy: { at: "asc" },
        select: { device: true, at: true, cpuPct: true, ramPct: true },
      }),
    ),
    settle(prisma.project.count({ where: { status: "released" } })),
    settle(prisma.project.count()),
    settle(prisma.factoryApp.count({ where: { releaseStatus: "released" } })),
  ]);
  const byDevice = new Map((rows ?? []).map((r) => [r.device, r as DeviceRow]));

  return {
    asOf: now,
    devices: DEVICES.map((d) =>
      toDeviceView(d, byDevice.get(d) ?? null, samples ?? [], now),
    ),
    deploys: {
      containers: deployContainers(byDevice.get("server1") ?? null, now),
      homepage:
        released === null || total === null ? null : { released, total },
      storeReleased: store,
    },
  };
}

// ── 하단 상태바 요약 ───────────────────────────

export interface DeviceBrief {
  device: DeviceKey;
  short: string;
  state: DeviceState;
  cpuPct: number | null;
  ramPct: number | null;
}

export async function deviceBriefs(now = Date.now()): Promise<DeviceBrief[]> {
  const rows = (await prisma.deviceStat.findMany()) as DeviceRow[];

  return DEVICES.map((device) => {
    const row = rows.find((r) => r.device === device) ?? null;
    const data = row ? storedData(device, row.data) : null;

    return {
      device,
      short: DEVICE_INFO[device].short,
      state: deviceState(row ? row.receivedAt.getTime() : null, now),
      cpuPct: data?.cpuPct ?? null,
      ramPct: data ? pctOf(data.ram) : null,
    };
  });
}
