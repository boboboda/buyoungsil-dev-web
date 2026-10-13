#!/usr/bin/env node
// 메인PC 장비 상태(CPU·RAM·GPU·디스크)를 1분마다 홈페이지 통제실 '장비 상태' 패널로 보낸다.
// 감독 프로그램이 시작할 때 startDeviceStats() 로 붙인다(작업 스케줄러 따로 필요 없음). 폴링과 따로 돌고, 실패해도 던지지 않는다.
//
//   node devicestats.mjs once    한 번 읽어서 화면에 보여 준다(서버로 보내지 않음, 값 확인용)
//
// 보내는 값은 숫자뿐: CPU %, RAM 사용/전체 GB, GPU 사용률·VRAM·온도, 드라이브 문자(C: 등)별 사용/전체 GB.
// 호스트 이름·IP·사용자 이름·프로세스 목록은 보내지 않는다. 인증은 감독 프로그램의 작업 PC 토큰(api 함수)을 그대로 쓴다.
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

// 서버로 보낼 본문(숫자만). prevCpu: 지난 표본(1분 평균 CPU 를 내려고)
export async function collect({ prevCpu = null, cpu = cpuTimes(), totalmem = os.totalmem(), freemem = os.freemem(), gpu, disks } = {}) {
  const [g, d] = await Promise.all([gpu ?? readGpu(), disks ?? readDisks()]);
  return {
    device: "main-pc",
    measuredAt: Math.round(Date.now() / 1000),
    cpuPct: cpuPctBetween(prevCpu, cpu),
    ram: { usedGb: round1((totalmem - freemem) / GB), totalGb: round1(totalmem / GB) },
    gpu: g,
    disks: d,
  };
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
