// 장비 상태 '실행 중인 모든 것'(running) 시험: lib/factory/devices.ts 검증·추이·의심 표시 + POST /api/factory/device-stats +
// 메인PC 수집(devicestats.mjs 프로세스 고르기·8KB 줄이기) + 서버 수집 스크립트(device-stats.sh, 가짜 docker).
// 가짜 DB(메모리)로 돌린다. 실제 DB·docker·네트워크는 쓰지 않는다.
// 실행: npm run test:device-stats
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { NextRequest } = require("next/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const db = { stats: new Map(), samples: [] };
const prisma = {
  deviceStat: {
    upsert: async ({ where, create, update }) => {
      const row = db.stats.has(where.device) ? { ...db.stats.get(where.device), ...update } : { ...create };
      db.stats.set(where.device, row);
      return row;
    },
    findUnique: async ({ where }) => db.stats.get(where.device) ?? null,
    findMany: async () => [...db.stats.values()],
  },
  deviceStatSample: {
    findFirst: async ({ where }) => db.samples.filter((s) => s.device === where.device).sort((a, b) => b.at - a.at)[0] ?? null,
    create: async ({ data }) => (db.samples.push(data), data),
    deleteMany: async () => ({ count: 0 }),
    findMany: async () => db.samples,
  },
  project: { count: async () => 0 },
  factoryApp: { count: async () => 0 },
};
const reset = () => {
  db.stats.clear();
  db.samples = [];
};

const devices = loadTs("lib/factory/devices.ts", { "@/lib/prisma": { __esModule: true, default: prisma } });
const collector = await import(pathToFileURL(path.join(repo, "tools/factory-supervisor/devicestats.mjs")).href);

const NOW = Date.UTC(2026, 9, 13, 3, 0, 0);
const MIN = 60_000;
const good = (over = {}) => ({
  device: "server1",
  measuredAt: Math.round(NOW / 1000) - 5,
  cpuPct: 37.25,
  ram: { usedGb: 12.3, totalGb: 31.2 },
  gpu: { state: "none" },
  disks: [{ mount: "/", usedGb: 120, totalGb: 468.4 }],
  ...over,
});
const cont = (over = {}) => ({ name: "web", image: "nginx:1.25", state: "running", status: "Up 9 days (healthy)", uptimeSec: 9 * 86400, stoppedSec: null, restarts: 0, cpuPct: 0.5, memMb: 120.5, project: "shop", ...over });
const proc = (over = {}) => ({ pid: 4242, name: "node", dir: "nodejs", memMb: 300, cpuSec: 12.5, startedAt: Math.round(NOW / 1000) - 3600, child: false, ports: [3000], ...over });
const running = (over = {}) => ({ containers: [cont()], processes: null, summary: { stoppedContainers: 1, danglingImages: 2, imageBytes: 1_200_000_000, volumes: 3 }, error: null, truncated: false, ...over });
const withRun = (r, over = {}) => good({ running: r, ...over });
const validate = (body, now = NOW) => devices.validateDevicePayload(body, now);
const BS = String.fromCharCode(92);

test("running: 기존 형식 요청은 그대로 통과하고 running 칸이 생기지 않는다", () => {
  const r = validate(good());
  assert.equal(r.ok, true);
  assert.equal("running" in r.payload.data, false);
});

test("running: 컨테이너·요약을 받고 알 수 없는 필드는 버린다, docker 를 못 읽은 장비는 null + 이유 한 줄", () => {
  const r = validate(withRun(running({ extra: "x", containers: [cont({ hostPort: 8080, note: "zzz" })] })));
  assert.equal(r.ok, true, r.reason);
  const run = r.payload.data.running;
  assert.equal(run.containers[0].name, "web");
  assert.equal(run.containers[0].image, "nginx:1.25");
  assert.deepEqual(run.summary, { stoppedContainers: 1, danglingImages: 2, imageBytes: 1_200_000_000, volumes: 3 });
  const json = JSON.stringify(run);
  for (const x of ["hostPort", "zzz", "extra"]) assert.ok(!json.includes(x), x);
  const none = validate(withRun({ containers: null, processes: null, summary: null, error: "docker 권한 없음 또는 응답 없음" }));
  assert.equal(none.ok, true, none.reason);
  assert.equal(none.payload.data.running.containers, null);
  assert.equal(none.payload.data.running.error, "docker 권한 없음 또는 응답 없음");
});

test("running: 숫자 경계값 — 범위 안은 통과, 범위 밖·음수·문자열·NaN 은 거절", () => {
  const ok = (c) => validate(withRun(running({ containers: [cont(c)] }))).ok;
  assert.equal(ok({ memMb: 0 }), true);
  assert.equal(ok({ memMb: 10_000_000 }), true);
  assert.equal(ok({ restarts: 10_000_000 }), true);
  assert.equal(ok({ cpuPct: 10_000 }), true);
  for (const bad of [{ memMb: -1 }, { memMb: 10_000_001 }, { restarts: -1 }, { restarts: 10_000_001 }, { cpuPct: 10_001 }, { uptimeSec: -5 }, { uptimeSec: "9" }, { memMb: NaN }, { state: "weird" }, { name: "bad name!" }, { name: "x".repeat(61) }])
    assert.equal(ok(bad), false, JSON.stringify(bad));
  const okP = (p) => validate(withRun(running({ containers: null, processes: [proc(p)] }), { device: "main-pc" })).ok;
  assert.equal(okP({ ports: [1, 65535] }), true);
  for (const bad of [{ ports: [0] }, { ports: [65536] }, { pid: -1 }, { pid: 4_294_967_296 }, { memMb: -2 }, { name: "" }, { name: "..." }]) assert.equal(okP(bad), false, JSON.stringify(bad));
  const sum = (s) => validate(withRun(running({ summary: s }))).ok;
  assert.equal(sum({ stoppedContainers: 1e6, danglingImages: 0, imageBytes: 1e15, volumes: 0 }), true);
  assert.equal(sum({ stoppedContainers: 1e6 + 1 }), false);
  assert.equal(sum({ imageBytes: -1 }), false);
});

test("running: 비밀이 섞일 수 있는 칸(env·명령줄·마운트·라벨)이 있으면 거절, 이미지 인증정보 모양도 거절", () => {
  for (const key of ["env", "environment", "cmd", "command", "args", "cmdline", "mounts", "labels", "Env"]) {
    const r = validate(withRun(running({ containers: [cont({ [key]: ["TOKEN=abc"] })] })));
    assert.equal(r.ok, false, key);
    assert.match(r.reason, /running/);
    assert.equal(validate(withRun(running({ containers: null, processes: [proc({ [key]: "node --token=abc" })] }), { device: "main-pc" })).ok, false, "process " + key);
  }
  assert.equal(validate(withRun(running({ env: { A: "1" } }))).ok, false, "running 바로 아래");
  assert.equal(validate(withRun(running({ summary: { volumes: 1, mounts: ["/home/x"] } }))).ok, false);
  for (const image of ["user:pass@registry.example.com/app:1", "app tag", "https://x/y", "$(whoami)"]) assert.equal(validate(withRun(running({ containers: [cont({ image })] }))).ok, false, image);
  const dir = ["C:", "Users", "kju90", "nodejs"].join(BS);
  const r = validate(withRun(running({ containers: null, processes: [proc({ dir, name: "node.exe" })] }), { device: "main-pc" }));
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.payload.data.running.processes[0].dir, "nodejs");
  assert.equal(r.payload.data.running.processes[0].name, "node");
  assert.ok(!JSON.stringify(r.payload).includes("kju90"));
});

test("running: 항목은 장비당 15개까지(넘으면 자르고 truncated:true), 100개 넘는 배열은 거절", () => {
  const many = (n) => Array.from({ length: n }, (_, i) => cont({ name: "c" + i }));
  const r15 = validate(withRun(running({ containers: many(15) }))).payload.data.running;
  assert.equal(r15.containers.length, 15);
  assert.equal(r15.truncated, false);
  const r20 = validate(withRun(running({ containers: many(20) }))).payload.data.running;
  assert.equal(r20.containers.length, 15);
  assert.equal(r20.truncated, true);
  assert.equal(validate(withRun(running({ containers: many(101) }))).ok, false);
});

test("running: 서버가 flags 를 계산(보낸 flags 는 무시) — 재시작 3 이상·멈춘 지 오래됨·라벨 없음·가동 7일 초과+메모리 증가", async () => {
  reset();
  const list = (mem) => [
    cont({ name: "leaky", uptimeSec: 8 * 86400, memMb: mem, flags: ["stopped"] }),
    cont({ name: "steady", uptimeSec: 8 * 86400, memMb: 100 }),
    cont({ name: "loop", restarts: 3, project: null }),
    cont({ name: "old", state: "exited", uptimeSec: null, stoppedSec: 86400, memMb: null }),
    cont({ name: "fresh", state: "exited", uptimeSec: null, stoppedSec: 3600, memMb: null }),
    cont({ name: "two", restarts: 2 }),
  ];
  let t = NOW;
  for (const mem of [100, 110, 125, 140, 160]) {
    const p = validate(withRun(running({ containers: list(mem) }), { measuredAt: Math.round(t / 1000) }), t);
    assert.equal(p.ok, true, p.reason);
    await devices.saveDeviceStat(p.payload, new Date(t));
    t += 4 * MIN;
  }
  const saved = db.stats.get("server1").data.running.containers;
  const flagsOf = Object.fromEntries(saved.map((c) => [c.name, c.flags]));
  assert.deepEqual(flagsOf.leaky, ["long_running"], "보낸 stopped 는 버리고 증가 추세만 표시");
  assert.deepEqual(flagsOf.steady, []);
  assert.deepEqual(flagsOf.loop, ["restart_loop", "unlabeled"]);
  assert.deepEqual(flagsOf.old, ["stopped"]);
  assert.deepEqual(flagsOf.fresh, []);
  assert.deepEqual(flagsOf.two, []);
  const leaky = saved.find((c) => c.name === "leaky");
  assert.deepEqual(leaky.memTrend.map((p) => p.mb), [100, 110, 125, 140, 160]);
  assert.equal(saved.filter((c) => c.memTrend).length, 4, "메모리 값이 있는 컨테이너 중 상위 5개만");
  // 추이 점은 3분 넘게 지났을 때만 늘고, 30분 지난 점은 사라진다
  const next = validate(withRun(running({ containers: list(170) }))).payload;
  const last = t - 4 * MIN;
  await devices.saveDeviceStat(next, new Date(last + MIN));
  assert.equal(db.stats.get("server1").data.running.containers.find((c) => c.name === "leaky").memTrend.length, 5);
  await devices.saveDeviceStat(next, new Date(last + 40 * MIN));
  assert.deepEqual(db.stats.get("server1").data.running.containers.find((c) => c.name === "leaky").memTrend.map((p) => p.mb), [170]);
  // 추세가 없으면 가동이 길어도 표시하지 않는다
  assert.equal(devices.enrichRunning(running({ containers: [cont({ uptimeSec: 9 * 86400 })] }), undefined, NOW).containers[0].flags.length, 0);
});

test("running: 추이는 최대 10점 — 3분마다 15번 보내도 10점까지", async () => {
  reset();
  let t = NOW;
  for (let i = 0; i < 15; i++) {
    await devices.saveDeviceStat(validate(withRun(running({ containers: [cont({ memMb: 100 + i })] })), t).payload, new Date(t));
    t += 3 * MIN;
  }
  const pts = db.stats.get("server1").data.running.containers[0].memTrend;
  assert.ok(pts.length <= 10 && pts.length >= 9, String(pts.length));
  assert.equal(pts[pts.length - 1].mb, 114);
});

test("running: 감독 자식이 아닌 500MB 초과 node/python 만 heavy_orphan", () => {
  const procs = [
    proc({ pid: 1, name: "node", memMb: 800 }),
    proc({ pid: 2, name: "python3", memMb: 501 }),
    proc({ pid: 3, name: "node", memMb: 900, child: true }),
    proc({ pid: 4, name: "node", memMb: 500 }),
    proc({ pid: 5, name: "java", memMb: 4000 }),
  ];
  const out = devices.enrichRunning(running({ containers: null, processes: procs }), undefined, NOW).processes;
  assert.deepEqual(out.map((p) => p.flags), [["heavy_orphan"], ["heavy_orphan"], [], [], []]);
});

test("running: 이전 저장값이 깨져 있어도 저장은 계속되고 화면용 재검증도 통과", async () => {
  reset();
  db.stats.set("server1", { device: "server1", data: { running: "broken" }, measuredAt: new Date(NOW), receivedAt: new Date(NOW) });
  await devices.saveDeviceStat(validate(withRun(running())).payload, new Date(NOW));
  const snap = await devices.devicesSnapshot(NOW);
  assert.equal(snap.devices[0].state, "ok");
  assert.equal(db.stats.get("server1").data.running.containers[0].name, "web");
});

// ── API ──
const post = loadTs("app/api/factory/device-stats/route.ts", {
  "@/lib/claude-status/auth": loadTs("lib/claude-status/auth.ts"),
  "@/lib/factory/auth": { isValidFactoryWorkerToken: async () => false },
  "@/lib/factory/supervisorLog": { noteDeviceReport: async () => {} },
  "@/lib/factory/toolkit": { saveToolkitInfo: async () => ({}), validateToolkitReport: () => ({ ok: false, reason: "x" }) },
  "@/lib/prisma": { __esModule: true, default: prisma },
  "@/lib/factory/devices": devices,
  "@/lib/factory/http": loadTs("lib/factory/http.ts", { "@/lib/factory/auth": {} }),
});
const STATUS_TOKEN = "status-token-0123456789abcdef";
process.env.CLAUDE_STATUS_TOKEN = STATUS_TOKEN;
let ipN = 100;
const req = (body) =>
  new NextRequest("https://example.com/api/factory/device-stats", {
    method: "POST",
    headers: { authorization: `Bearer ${STATUS_TOKEN}`, "content-type": "application/json", "x-forwarded-for": `10.1.0.${ipN++ % 250}` },
    body: JSON.stringify(body),
  });
const live = (over = {}) => good({ measuredAt: Math.round(Date.now() / 1000), ...over });

test("POST: running 이 든 요청은 저장, 비밀 칸은 400, 8KB 초과는 413", async () => {
  reset();
  assert.equal((await post.POST(req(live({ running: running() })))).status, 200);
  assert.equal(db.stats.get("server1").data.running.containers.length, 1);
  const bad = await post.POST(req(live({ running: running({ containers: [cont({ env: ["A=b"] })] }) })));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).message, /running/);
  const big = running({ containers: Array.from({ length: 15 }, (_, i) => cont({ name: "c" + i, status: "s".repeat(80), image: "i".repeat(190) })) });
  assert.equal((await post.POST(req(live({ running: big, pad: "x".repeat(2000) })))).status, 413);
});

// ── 메인PC 수집 ──
test("메인PC 수집: 감독 자식 + node/python/docker 계열만, 메모리 큰 순 15개, 명령줄·경로 없음, 8KB 넘으면 줄이고 truncated", async () => {
  const raw = {
    p: [
      { pid: 100, ppid: 1, name: "node.exe", mem: 90, cpu: 5, start: 1700000000, dir: "nodejs" }, // 감독 프로그램 자신
      { pid: 101, ppid: 100, name: "claude.exe", mem: 400, cpu: 20, start: 1700000100, dir: "claude" },
      { pid: 102, ppid: 101, name: "cmd.exe", mem: 5, cpu: 0, start: 1700000200, dir: "System32" }, // 후손
      { pid: 200, ppid: 1, name: "python.exe", mem: 700, cpu: 9, start: 1700000300, dir: "Python312" },
      { pid: 201, ppid: 1, name: "chrome.exe", mem: 3000, cpu: 9, start: 1700000300, dir: "Chrome" }, // 대상 아님
      { pid: 202, ppid: 1, name: "Docker Desktop.exe", mem: 250, cpu: 1, start: 1700000300, dir: "Docker" },
      { pid: 203, ppid: 1, name: "svchost.exe", mem: 50, cpu: 1, start: 1, dir: "System32" },
    ],
    l: [{ pid: 200, port: 8000 }, { pid: 200, port: 8000 }, { pid: 200, port: 8001 }, { pid: 201, port: 9 }],
  };
  const { items } = collector.pickProcesses(raw, { selfPid: 100 });
  assert.deepEqual(items.map((p) => p.pid), [200, 101, 202, 100, 102]);
  assert.deepEqual(items.map((p) => p.child), [false, true, false, true, true]);
  assert.deepEqual(items[0].ports, [8000, 8001]);
  assert.deepEqual(Object.keys(items[0]).sort(), ["child", "cpuSec", "dir", "memMb", "name", "pid", "ports", "startedAt"]);
  assert.equal(items[0].name, "python");
  const manyRaw = { p: Array.from({ length: 40 }, (_, i) => ({ pid: 1000 + i, ppid: 1, name: "node.exe", mem: i, cpu: 0, start: 1, dir: "nodejs" })), l: [] };
  const lim = collector.pickProcesses(manyRaw, { selfPid: 1 });
  assert.equal(lim.items.length, 15);
  assert.equal(lim.truncated, true);
  assert.equal(lim.items[0].memMb, 39);
  const body = {
    device: "main-pc",
    running: { containers: null, processes: Array.from({ length: 15 }, (_, i) => ({ pid: i, name: "n".repeat(60), dir: "d".repeat(40), memMb: 1, cpuSec: 1, startedAt: 1, child: false, ports: [1, 2, 3, 4, 5] })), summary: null, error: null, truncated: false },
    pad: "x".repeat(6000),
  };
  const fit = collector.fitRunning(body);
  assert.ok(JSON.stringify(fit).length <= 7600);
  assert.equal(fit.running.truncated, true);
  assert.ok(fit.running.processes.length < 15);
  const failed = await collector.collectRunning({ list: null });
  assert.deepEqual([failed.processes, failed.containers], [null, null]);
  assert.match(failed.error, /프로세스 목록/);
  assert.equal(await collector.readProcessList({ platform: "linux" }), null);
  assert.equal(await collector.readProcessList({ run: (_c, _a, _o, cb) => cb(new Error("boom")), platform: "win32" }), null);
  const sent = await collector.collect({ prevCpu: { idle: 0, total: 0 }, cpu: { idle: 50, total: 100 }, gpu: { state: "unknown" }, disks: [], running: await collector.collectRunning({ list: raw, selfPid: 100 }) });
  const v = validate(JSON.parse(JSON.stringify(sent)), Date.now());
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.payload.data.running.processes.length, 5);
  assert.ok(!/cmdline|commandline|args|env/i.test(JSON.stringify(sent)));
});

// ── 서버 수집 스크립트 ──
test("서버 수집 스크립트(bash): 가짜 docker 로 running 이 서버 검증을 통과하고 읽기 전용 명령만 부른다", (t) => {
  const script = path.join(repo, "tools/factory-supervisor/device-stats.sh");
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || "/tmp"), "devstat-run-"));
  const posix = (p) => p.split(BS).join("/");
  fs.mkdirSync(path.join(tmp, "bin"));
  fs.writeFileSync(
    path.join(tmp, "bin", "docker"),
    [
      "#!/usr/bin/env bash",
      'echo "$@" >> "$FAKE_DOCKER_LOG"',
      'case "$1 $2" in',
      '"ps -a") echo "web|nginx:1.25|running|Up 9 days (healthy)|shop"; echo "old|alpine:3|exited|Exited (0) 3 days ago|";;',
      '"ps -aq") echo a; echo b;;',
      '"inspect --format") echo "/web|2026-10-01T03:04:05.123456789Z|0001-01-01T00:00:00Z|0"; echo "/old|2026-09-01T00:00:00Z|2026-10-10T00:00:00Z|4";;',
      '"stats --no-stream") echo "web|0.50%|120.5MiB / 31GiB";;',
      '"images -f") echo 12.5MB;;',
      '"volume ls") echo v1;;',
      "*) exit 1;;",
      "esac",
    ].join("\n") + "\n",
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(tmp, "env"), "DEVICE_STATS_DEVICE=server2\nDEVICE_STATS_URL=http://127.0.0.1:9/none\n");
  const log = path.join(tmp, "docker.log");
  const env = { ...process.env, PATH: posix(path.join(tmp, "bin")) + ":" + process.env.PATH, DEVICE_STATS_CONF: posix(tmp), FAKE_DOCKER_LOG: posix(log) };
  const run = spawnSync("bash", [script, "print"], { env, encoding: "utf8", timeout: 30_000 });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
  fs.rmSync(tmp, { recursive: true, force: true });
  if (run.error) return t.skip("bash 없음");
  if (!fs.existsSync("/proc/stat") && run.status !== 0) return t.skip("이 PC 셸에는 /proc 이 없음");
  assert.equal(run.status, 0, run.stderr);
  const v = validate(JSON.parse(run.stdout), Date.now());
  assert.equal(v.ok, true, v.reason);
  const rc = v.payload.data.running.containers;
  assert.deepEqual(rc.map((c) => c.name), ["web", "old"]);
  assert.equal(rc[0].project, "shop");
  assert.equal(rc[0].memMb, 120.5);
  assert.equal(rc[1].restarts, 4);
  assert.ok(rc[1].stoppedSec > 86400);
  assert.deepEqual(v.payload.data.running.summary, { stoppedContainers: 1, danglingImages: 1, imageBytes: 12_500_000, volumes: 1 });
  assert.equal(v.payload.data.running.truncated, false);
  for (const line of calls.split("\n").filter(Boolean)) assert.match(line, /^(ps|inspect|stats|images|volume ls)/, line);
});
