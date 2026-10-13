#!/usr/bin/env node
// 메인PC 장비 상태(CPU·RAM·GPU·디스크)를 1분마다 홈페이지 통제실 '장비 상태' 패널로 보낸다.
// 감독 프로그램이 시작할 때 startDeviceStats() 로 붙인다(작업 스케줄러 따로 필요 없음). 폴링과 따로 돌고, 실패해도 던지지 않는다.
//
//   node devicestats.mjs once    한 번 읽어서 화면에 보여 준다(서버로 보내지 않음, 값 확인용)
//
// 보내는 값은 숫자뿐: CPU %, RAM 사용/전체 GB, GPU 사용률·VRAM·온도, 드라이브 문자(C: 등)별 사용/전체 GB.
// 호스트 이름·IP·사용자 이름은 보내지 않는다. 프로세스는 running.processes 로만(아래), 명령줄은 읽지도 않는다. 인증은 감독 프로그램의 작업 PC 토큰(api 함수)을 그대로 쓴다.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEVICE_STATS_EVERY_MS = 60_000;
const GPU_TIMEOUT_MS = 5000;
const DISK_TIMEOUT_MS = 3000;
const POST_TIMEOUT_MS = 10_000;
const MAX_DISKS = 4;
const GB = 1024 ** 3;
const PROC_TIMEOUT_MS = 12_000;
export const MAX_RUNNING_ITEMS = 15;
export const MAX_BODY_CHARS = 7600; // 서버 제한 8KB 보다 조금 작게
// 감독 프로그램 자식이 아니어도 모으는 프로세스 이름(node/python/java/dart/flutter/adb/emulator/docker 계열 + 작업 도구)
const WATCH_NAME_RE = /^(node|python[\d.]*|pythonw|java|javaw|dart|flutter|adb|emulator|qemu-system-.*|docker.*|com\.docker\..*|ffmpeg|claude|codex)$/i;

const round1 = (v) => Math.round(v * 10) / 10;
const pctOf = (used, total) => (total > 0 ? round1(Math.min(100, Math.max(0, (used / total) * 100))) : null);

// os.cpus() 누적 시간 합 → { idle, total }
export function cpuTimes(cpus = os.cpus()) {
  let idle = 0;
  let total = 0;
  for (const c of cpus ?? []) {
    const t = c?.times ?? {};
    for (const v of Object.values(t)) total += Number(v) || 0;
    idle += Number(t.idle) || 0;
  }
  return { idle, total };
}

// 두 표본 사이 CPU 사용률(%). 표본이 없거나 시간이 안 흘렀으면 null
export function cpuPctBetween(a, b) {
  if (!a || !b) return null;
  const dt = b.total - a.total;
  const di = b.idle - a.idle;
  if (!(dt > 0) || di < 0) return null;
  return round1(Math.min(100, Math.max(0, (1 - di / dt) * 100)));
}

// nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits
// 줄마다 "37, 2048, 8192, 55" (MiB). 읽을 수 없는 칸은 null. 한 줄도 못 읽으면 null
export function parseNvidiaSmi(text) {
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [u, mu, mt, t] = line.split(",").map((s) => {
      const n = Number(s.trim());
      return s.trim() !== "" && Number.isFinite(n) ? n : null;
    });
    if (u === null && mt === null) continue;
    out.push({
      utilPct: u === null ? null : Math.min(100, Math.max(0, u)),
      memUsedGb: mu === null ? null : round1(mu / 1024),
      memTotalGb: mt === null ? null : round1(mt / 1024),
      tempC: t === null ? null : t,
    });
  }
  return out.length ? out.slice(0, 4) : null;
}

// GPU: nvidia-smi 가 있으면 그것, 없거나 실패하면 '확인 못 함'(Windows 는 다른 회사 GPU 일 수 있어 '없음'이라 단정하지 않음)
export function readGpu({ run = execFile } = {}) {
  return new Promise((resolve) => {
    try {
      run(
        "nvidia-smi",
        ["--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"],
        { timeout: GPU_TIMEOUT_MS, windowsHide: true },
        (err, stdout) => {
          const list = err ? null : parseNvidiaSmi(stdout);
          resolve(list ? { state: "ok", list } : { state: "unknown" });
        },
      );
    } catch {
      resolve({ state: "unknown" });
    }
  });
}

const withTimeout = (p, ms) => {
  let t;
  return Promise.race([p, new Promise((r) => (t = setTimeout(() => r(null), ms)))]).finally(() => clearTimeout(t));
};

// 드라이브(Windows: C:~Z:, 그 밖: /) 사용량. 네트워크 드라이브가 멈춰도 기다리지 않게 드라이브마다 시간 제한.
// 시스템 드라이브(C: 또는 /) 먼저, 나머지는 큰 순서로 최대 4개. statfs 가 없는 옛 node 면 빈 목록
export async function readDisks({ statfs = fs.promises.statfs, platform = process.platform } = {}) {
  if (typeof statfs !== "function") return [];
  const roots = platform === "win32" ? "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}:\\`) : ["/"];
  const found = await Promise.all(
    roots.map(async (root) => {
      const s = await withTimeout(statfs(root).catch(() => null), DISK_TIMEOUT_MS);
      if (!s || !(Number(s.blocks) > 0) || !(Number(s.bsize) > 0)) return null;
      const total = Number(s.blocks) * Number(s.bsize);
      const free = Number(s.bavail ?? s.bfree) * Number(s.bsize);
      return { mount: platform === "win32" ? root.slice(0, 2) : root, usedGb: round1((total - free) / GB), totalGb: round1(total / GB) };
    }),
  );
  const sys = (d) => d.mount === "C:" || d.mount === "/";
  return found
    .filter(Boolean)
    .sort((a, b) => Number(sys(b)) - Number(sys(a)) || b.totalGb - a.totalGb)
    .slice(0, MAX_DISKS);
}

const PS_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue';",
  "$p=@(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId; name=$_.Name;",
  "mem=[math]::Round($_.WorkingSetSize/1MB,1); cpu=[math]::Round(([double]$_.UserModeTime+[double]$_.KernelModeTime)/1e7,1);",
  "start=$(if($_.CreationDate){[DateTimeOffset]::new($_.CreationDate).ToUnixTimeSeconds()}else{$null});",
  "dir=$(if($_.ExecutablePath){Split-Path (Split-Path $_.ExecutablePath -Parent) -Leaf}else{$null}) } });",
  "$l=@(Get-NetTCPConnection -State Listen | ForEach-Object { [pscustomobject]@{ pid=[int]$_.OwningProcess; port=[int]$_.LocalPort } });",
  "[pscustomobject]@{ p=$p; l=$l } | ConvertTo-Json -Compress -Depth 4",
].join(" ");

// 프로세스 목록(이름·메모리·시작 시각·폴더 이름·리슨 포트만; 명령줄은 읽지 않는다). Windows 만. 실패하면 null
export function readProcessList({ run = execFile, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    if (platform !== "win32") return resolve(null);
    try {
      run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", PS_SCRIPT],
        { timeout: PROC_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout) => {
          if (err) return resolve(null);
          try {
            resolve(JSON.parse(String(stdout)));
          } catch {
            resolve(null);
          }
        },
      );
    } catch {
      resolve(null);
    }
  });
}

const asList = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? [v] : []);

// 프로세스 원본 → 보낼 항목. 감독 프로그램 자식(selfPid 의 후손)과 이름이 감시 대상인 것만, 메모리 큰 순 상위 15개
export function pickProcesses(raw, { selfPid = process.pid, limit = MAX_RUNNING_ITEMS } = {}) {
  const procs = asList(raw?.p).filter((p) => p && Number.isFinite(Number(p.pid)));
  const parentOf = new Map(procs.map((p) => [Number(p.pid), Number(p.ppid)]));
  const isChild = (pid) => {
    let cur = parentOf.get(pid);
    for (let i = 0; i < 32 && cur !== undefined; i++) {
      if (cur === selfPid) return true;
      cur = parentOf.get(cur);
    }
    return false;
  };
  const ports = new Map();
  for (const l of asList(raw?.l)) {
    const pid = Number(l?.pid);
    const port = Number(l?.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (!ports.has(pid)) ports.set(pid, new Set());
    ports.get(pid).add(port);
  }
  const items = [];
  for (const p of procs) {
    const pid = Number(p.pid);
    const name = String(p.name ?? "").replace(/\.exe$/i, "");
    const child = pid === selfPid || isChild(pid);
    if (!child && !WATCH_NAME_RE.test(name)) continue;
    items.push({
      pid,
      name: name.slice(0, 60),
      dir: p.dir ? String(p.dir).slice(0, 40) : null,
      memMb: Number.isFinite(Number(p.mem)) ? round1(Number(p.mem)) : null,
      cpuSec: Number.isFinite(Number(p.cpu)) ? round1(Number(p.cpu)) : null,
      startedAt: Number.isFinite(Number(p.start)) ? Math.round(Number(p.start)) : null,
      child,
      ports: [...(ports.get(pid) ?? [])].sort((a, b) => a - b).slice(0, 5),
    });
  }
  items.sort((a, b) => (b.memMb ?? -1) - (a.memMb ?? -1));
  return { items: items.slice(0, limit), truncated: items.length > limit };
}

// 본문이 8KB 를 넘으면 프로세스를 뒤에서부터 줄이고 truncated 표시
export function fitRunning(body, maxChars = MAX_BODY_CHARS) {
  const r = body.running;
  if (!r?.processes) return body;
  while (JSON.stringify(body).length > maxChars && r.processes.length > 0) {
    r.processes.pop();
    r.truncated = true;
  }
  return body;
}

// 실행 중인 프로세스 현황(읽기 전용). 못 읽으면 processes:null + 이유 한 줄(전체 보고는 계속)
export async function collectRunning({ list, selfPid = process.pid } = {}) {
  const raw = list === undefined ? await readProcessList() : list;
  if (!raw) return { containers: null, processes: null, summary: null, error: "프로세스 목록을 읽지 못함", truncated: false };
  const { items, truncated } = pickProcesses(raw, { selfPid });
  return { containers: null, processes: items, summary: null, error: null, truncated };
}

// 서버로 보낼 본문(숫자와 이름만). prevCpu: 지난 표본(1분 평균 CPU 를 내려고)
export async function collect({ prevCpu = null, cpu = cpuTimes(), totalmem = os.totalmem(), freemem = os.freemem(), gpu, disks, running } = {}) {
  const [g, d, r] = await Promise.all([gpu ?? readGpu(), disks ?? readDisks(), running === undefined ? collectRunning().catch(() => null) : running]);
  return fitRunning({
    device: "main-pc",
    measuredAt: Math.round(Date.now() / 1000),
    cpuPct: cpuPctBetween(prevCpu, cpu),
    ram: { usedGb: round1((totalmem - freemem) / GB), totalGb: round1(totalmem / GB) },
    gpu: g,
    disks: d,
    ...(r ? { running: r } : {}),
  });
}

// 감독 프로그램이 부른다. 1분마다 읽어 보낸다. 반환: stop()
// api: 감독 프로그램의 api(method, path, body, opts). 401·연결 실패는 10번에 한 번만 로그(폴링 로그를 덮지 않게)
export function startDeviceStats({ api, log = () => {}, everyMs = DEVICE_STATS_EVERY_MS } = {}) {
  let prev = cpuTimes();
  let busy = false;
  let fails = 0;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = cpuTimes();
      const body = await collect({ prevCpu: prev });
      prev = now;
      const r = await api("POST", "/api/factory/device-stats", body, { timeoutMs: POST_TIMEOUT_MS });
      if (r?.status === 200) fails = 0;
      else if (fails++ % 10 === 0) log(`장비 상태 보내기 실패: ${r?.status ?? "응답 없음"} ${r?.data?.message ?? ""}`.trim());
    } catch (e) {
      if (fails++ % 10 === 0) log(`장비 상태 보내기 실패: ${e?.name === "TimeoutError" ? "시간 초과" : "연결 안 됨"}`);
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(tick, 5000); // 첫 값은 5초 뒤(그 사이 CPU 표본이 쌓임)
  const id = setInterval(tick, everyMs);
  first.unref?.();
  id.unref?.();
  return { stop: () => (clearTimeout(first), clearInterval(id)), tick };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "once") {
    console.error("사용법: node devicestats.mjs once   (감독 프로그램이 1분마다 알아서 보내요)");
    process.exitCode = 2;
  } else {
    const prevCpu = cpuTimes();
    setTimeout(async () => console.log(JSON.stringify(await collect({ prevCpu }), null, 2)), 1000);
  }
}
