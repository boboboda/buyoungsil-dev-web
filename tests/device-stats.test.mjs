// 통제실 '장비 상태' 시험: lib/factory/devices.ts(값 검증·허용 목록·저장·5분 이력·오래된/끊김 판정) +
// POST /api/factory/device-stats(토큰·크기 제한) + GET /api/admin/factory/devices(관리자만·no-store) +
// 패널 보기(DevicePanelView: 임계값 색·GPU 없음·비밀값 미노출) + 하단 상태바 요약 + 수집 스크립트(메인PC devicestats.mjs, 서버 device-stats.sh).
// 가짜 DB(메모리)로 돌린다. 실제 DB·네트워크는 쓰지 않는다.
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
const { NextRequest, NextResponse } = require("next/server");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

// ── 가짜 DB ──
const db = { stats: new Map(), samples: [], nextId: 1, fail: false };
const prisma = {
  deviceStat: {
    upsert: async ({ where, create, update }) => {
      const row = db.stats.has(where.device) ? { ...db.stats.get(where.device), ...update } : { ...create };
      db.stats.set(where.device, row);
      return row;
    },
    findMany: async () => {
      if (db.fail) throw new Error("db down");
      return [...db.stats.values()];
    },
  },
  deviceStatSample: {
    findFirst: async ({ where }) => db.samples.filter((s) => s.device === where.device).sort((a, b) => b.at - a.at)[0] ?? null,
    create: async ({ data }) => (db.samples.push({ id: db.nextId++, ...data }), data),
    deleteMany: async ({ where }) => {
      const before = db.samples.length;
      db.samples = db.samples.filter((s) => !(s.at < where.at.lt));
      return { count: before - db.samples.length };
    },
    findMany: async ({ where }) => {
      if (db.fail) throw new Error("db down");
      return db.samples.filter((s) => s.at >= where.at.gte).sort((a, b) => a.at - b.at);
    },
  },
  project: { count: async ({ where } = {}) => (where?.status === "released" ? 4 : 11) },
  factoryApp: { count: async () => 2 },
};
const reset = () => {
  db.stats.clear();
  db.samples = [];
  db.fail = false;
};

const devices = loadTs("lib/factory/devices.ts", { "@/lib/prisma": { __esModule: true, default: prisma } });

const NOW = Date.UTC(2026, 9, 13, 3, 0, 0);
const MIN = 60_000;
const good = (over = {}) => ({
  device: "server1",
  measuredAt: Math.round(NOW / 1000) - 5,
  cpuPct: 37.25,
  ram: { usedGb: 12.3, totalGb: 31.2 },
  gpu: { state: "none" },
  disks: [{ mount: "/", usedGb: 120, totalGb: 468.4 }],
  containers: { state: "ok", names: ["web", "db", "nginx-proxy"] },
  ...over,
});

// ── 값 검증 ──
test("허용 목록: server1·server2·main-pc 만 받고 나머지는 거부", () => {
  for (const d of ["server1", "server2", "main-pc"]) assert.equal(devices.validateDevicePayload(good({ device: d }), NOW).ok, true, d);
  for (const d of ["server3", "SERVER1", "mainpc", "", null, 1, "../server1"]) {
    const r = devices.validateDevicePayload(good({ device: d }), NOW);
    assert.equal(r.ok, false, String(d));
    assert.match(r.reason, /장비 이름/);
  }
});

test("값 범위: 0~100 만, 음수·100 초과·NaN·문자열·Infinity 거부", () => {
  for (const v of [0, 0.1, 50, 100]) assert.equal(devices.validateDevicePayload(good({ cpuPct: v }), NOW).ok, true, String(v));
  for (const v of [-1, -0.01, 100.1, 1000, NaN, Infinity, "50", true, {}]) {
    const r = devices.validateDevicePayload(good({ cpuPct: v }), NOW);
    assert.equal(r.ok, false, String(v));
    assert.match(r.reason, /CPU/);
  }
  // RAM: 음수·NaN·사용 > 전체·전체 0 거부
  for (const ram of [{ usedGb: -1, totalGb: 8 }, { usedGb: NaN, totalGb: 8 }, { usedGb: 9, totalGb: 8 }, { usedGb: 0, totalGb: 0 }, { usedGb: "1", totalGb: 8 }, [1, 2]])
    assert.equal(devices.validateDevicePayload(good({ ram }), NOW).ok, false, JSON.stringify(ram));
  // GPU: 사용률 범위, 상태 이름
  assert.equal(devices.validateDevicePayload(good({ gpu: { state: "ok", list: [{ utilPct: 101, memUsedGb: 1, memTotalGb: 8, tempC: 50 }] } }), NOW).ok, false);
  assert.equal(devices.validateDevicePayload(good({ gpu: { state: "ok", list: [{ utilPct: -3 }] } }), NOW).ok, false);
  assert.equal(devices.validateDevicePayload(good({ gpu: { state: "maybe" } }), NOW).ok, false);
  assert.equal(devices.validateDevicePayload(good({ gpu: { state: "ok", list: [] } }), NOW).ok, false);
  // 디스크
  assert.equal(devices.validateDevicePayload(good({ disks: [{ mount: "/", usedGb: -5, totalGb: 10 }] }), NOW).ok, false);
  assert.equal(devices.validateDevicePayload(good({ disks: "C:" }), NOW).ok, false);
  // 1시간 넘게 지난 값, 형식 아닌 본문
  assert.equal(devices.validateDevicePayload(good({ measuredAt: Math.round((NOW - 2 * 60 * MIN) / 1000) }), NOW).ok, false);
  assert.equal(devices.validateDevicePayload(null, NOW).ok, false);
  assert.equal(devices.validateDevicePayload([], NOW).ok, false);
});

test("정해진 필드만 남긴다: 호스트 이름·IP·프로세스·환경변수는 버리고, 컨테이너는 서버1의 이름만", () => {
  const r = devices.validateDevicePayload(
    good({
      hostname: "serverpc.local",
      ip: "192.168.0.10",
      processes: ["postgres"],
      env: { SECRET: "x" },
      disks: [{ mount: "/data<x>", usedGb: 1, totalGb: 2, uuid: "abcd-1234" }],
      containers: { state: "ok", names: ["web", "web", "bad name!", "x".repeat(80), "db"], images: ["secret/registry:tag"] },
    }),
    NOW,
  );
  assert.equal(r.ok, true);
  const json = JSON.stringify(r.payload);
  for (const s of ["serverpc", "192.168", "postgres", "SECRET", "abcd-1234", "registry", "<x>"]) assert.ok(!json.includes(s), s);
  assert.deepEqual(r.payload.data.containers, { state: "ok", names: ["db", "web"] });
  assert.equal(r.payload.data.disks[0].mount, "/datax");
  assert.equal(r.payload.data.cpuPct, 37.3); // 소수 첫째 자리
  // 서버2·메인PC 가 보낸 컨테이너 목록은 받지 않는다
  assert.equal(devices.validateDevicePayload(good({ device: "server2" }), NOW).payload.data.containers, undefined);
  // GPU 를 안 보내면 '확인 못 함'
  assert.deepEqual(devices.validateDevicePayload(good({ gpu: undefined }), NOW).payload.data.gpu, { state: "unknown" });
});

test("오래된 값·끊김 판정: 10분 넘으면 오래된 값, 30분 넘으면 끊김, 받은 적 없으면 never", () => {
  assert.equal(devices.deviceState(NOW - 9 * MIN, NOW), "ok");
  assert.equal(devices.deviceState(NOW - 10 * MIN, NOW), "ok");
  assert.equal(devices.deviceState(NOW - 10 * MIN - 1, NOW), "stale");
  assert.equal(devices.deviceState(NOW - 30 * MIN, NOW), "stale");
  assert.equal(devices.deviceState(NOW - 30 * MIN - 1, NOW), "offline");
  assert.equal(devices.deviceState(null, NOW), "never");
  assert.equal(devices.DEVICE_STATE_TEXT.stale, "오래된 값");
  assert.equal(devices.DEVICE_STATE_TEXT.offline, "끊김");
});

test("저장: 최신 값은 덮어쓰고, 이력은 5분에 한 점, 24시간 지난 점은 지운다", async () => {
  reset();
  db.samples.push({ id: 999, device: "server2", at: new Date(NOW - 25 * 60 * MIN), cpuPct: 1, ramPct: 1, gpuPct: null, diskPct: 1 });
  const p = devices.validateDevicePayload(good(), NOW).payload;
  for (let i = 0; i < 12; i++) await devices.saveDeviceStat(p, new Date(NOW + i * MIN)); // 1분마다 12번
  assert.equal(db.stats.size, 1);
  assert.equal(db.stats.get("server1").receivedAt.getTime(), NOW + 11 * MIN);
  const mine = db.samples.filter((s) => s.device === "server1");
  assert.deepEqual(mine.map((s) => (s.at.getTime() - NOW) / MIN), [0, 5, 10]);
  assert.equal(mine[0].cpuPct, 37.3);
  assert.equal(mine[0].ramPct, 39.4);
  assert.equal(mine[0].diskPct, 25.6);
  assert.ok(!db.samples.some((s) => s.id === 999), "24시간 지난 점 정리");
});

test("화면 값: 장비 3개 늘 나옴, 24칸 이력, 컨테이너 수와 홈페이지·스토어 출시 수를 따로", async () => {
  reset();
  const save = (body, at) => devices.saveDeviceStat(devices.validateDevicePayload(body, at).payload, new Date(at));
  await save(good({ cpuPct: 20 }), NOW - 3 * 60 * MIN);
  await save(good({ cpuPct: 80 }), NOW - 2 * MIN);
  await save(good({ device: "main-pc", gpu: { state: "ok", list: [{ utilPct: 2, memUsedGb: 9.6, memTotalGb: 15.9, tempC: 41 }] } }), NOW - 15 * MIN);
  const snap = await devices.devicesSnapshot(NOW);
  assert.deepEqual(snap.devices.map((d) => [d.device, d.state]), [["server1", "ok"], ["server2", "never"], ["main-pc", "stale"]]);
  const s1 = snap.devices[0];
  assert.equal(s1.history.cpu.length, 24);
  assert.equal(s1.history.cpu[23], 80);
  assert.equal(s1.history.cpu[20], 20);
  assert.equal(s1.ram.pct, 39.4);
  assert.deepEqual(snap.deploys.containers.names, ["db", "nginx-proxy", "web"]);
  assert.equal(snap.deploys.containers.count, 3);
  assert.deepEqual(snap.deploys.homepage, { released: 4, total: 11 });
  assert.equal(snap.deploys.storeReleased, 2);
  // 서버1이 30분 넘게 끊기면 컨테이너 수는 숫자 대신 '끊김'
  const late = await devices.devicesSnapshot(NOW + 40 * MIN);
  assert.equal(late.deploys.containers.state, "offline");
  assert.equal(late.devices[0].state, "offline");
  // DB 를 못 읽어도 던지지 않는다(다른 화면 영향 없음)
  db.fail = true;
  const broken = await devices.devicesSnapshot(NOW);
  assert.deepEqual(broken.devices.map((d) => d.state), ["never", "never", "never"]);
  db.fail = false;
});

// ── API ──
let workerOk = false;
const post = loadTs("app/api/factory/device-stats/route.ts", {
  "@/lib/claude-status/auth": loadTs("lib/claude-status/auth.ts"),
  "@/lib/factory/auth": { isValidFactoryWorkerToken: async (a) => workerOk && a === "Bearer worker-token-xxxxxxxxxxxx" },
  "@/lib/factory/supervisorLog": { noteDeviceReport: async () => {} },
  "@/lib/factory/toolkit": { saveToolkitInfo: async () => ({}), validateToolkitReport: () => ({ ok: false, reason: "x" }) },
  "@/lib/prisma": { __esModule: true, default: prisma },
  "@/lib/factory/devices": devices,
  "@/lib/factory/http": loadTs("lib/factory/http.ts", { "@/lib/factory/auth": {} }),
});
const STATUS_TOKEN = "status-token-0123456789abcdef";
process.env.CLAUDE_STATUS_TOKEN = STATUS_TOKEN;
let ipN = 0;
const live = (over = {}) => good({ measuredAt: Math.round(Date.now() / 1000), ...over });
const req = (body, auth = `Bearer ${STATUS_TOKEN}`) =>
  new NextRequest("https://example.com/api/factory/device-stats", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json", "x-forwarded-for": `10.0.0.${ipN++ % 250}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("POST: 토큰 불일치 401, 상태 수신 토큰·작업 PC 토큰은 통과, 큰 본문 413, 잘못된 값 400", async () => {
  reset();
  for (const auth of ["", "Bearer wrong-token-0123456789abcdef", `Bearer ${STATUS_TOKEN}x`]) {
    const r = await post.POST(req(live(), auth));
    assert.equal(r.status, 401, auth);
    assert.ok(!JSON.stringify(await r.json()).includes(STATUS_TOKEN));
  }
  assert.equal(db.stats.size, 0);
  assert.equal((await post.POST(req(live()))).status, 200);
  workerOk = true;
  assert.equal((await post.POST(req(live({ device: "main-pc" }), "Bearer worker-token-xxxxxxxxxxxx"))).status, 200);
  workerOk = false;
  assert.deepEqual([...db.stats.keys()].sort(), ["main-pc", "server1"]);
  assert.equal((await post.POST(req(JSON.stringify(live({ pad: "x".repeat(9000) }))))).status, 413);
  assert.equal((await post.POST(req("{not json"))).status, 400);
  const bad = await post.POST(req(live({ cpuPct: -5 })));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).message, /0~100/);
  assert.equal((await post.POST(req(live({ device: "server9" })))).status, 400);
});

test("GET 관리자 전용: 관리자 아니면 막고, 관리자는 no-store 로 받는다", async () => {
  let admin = false;
  const route = loadTs("app/api/admin/factory/devices/route.ts", {
    "@/lib/factory/admin": { requireAdmin: async () => (admin ? null : NextResponse.json({ message: "권한이 없습니다." }, { status: 403 })) },
    "@/lib/factory/devices": devices,
  });
  const denied = await route.GET();
  assert.equal(denied.status, 403);
  admin = true;
  const ok = await route.GET();
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  const body = await ok.json();
  assert.equal(body.devices.length, 3);
});

// ── 화면 ──
const meters = loadTs("components/admin/ui/meters.tsx");
const panel = loadTs("components/admin/factory/DevicePanel.tsx", { "@/components/admin/ui/meters": meters });

test("임계값 색: 70% 미만 정상, 70% 이상 주의, 90% 이상 위험, 끊긴 장비는 회색 + '지난 값'", () => {
  assert.deepEqual(panel.metricReading(69.4, true), { pct: 69, tone: "ok", state: "정상" });
  assert.deepEqual(panel.metricReading(70, true), { pct: 70, tone: "warn", state: "주의" });
  assert.deepEqual(panel.metricReading(89, true), { pct: 89, tone: "warn", state: "주의" });
  assert.deepEqual(panel.metricReading(90, true), { pct: 90, tone: "bad", state: "위험" });
  assert.deepEqual(panel.metricReading(95, false), { pct: 95, tone: "idle", state: "위험 · 지난 값" });
  assert.equal(panel.metricReading(null, true).state, "값 없음");
});

async function sampleSnapshot() {
  reset();
  const save = (body, at) => devices.saveDeviceStat(devices.validateDevicePayload(body, at).payload, new Date(at));
  await save(good({ cpuPct: 95, ram: { usedGb: 24, totalGb: 31.2 } }), NOW - MIN);
  await save(good({ device: "server2", cpuPct: 5, gpu: { state: "none" } }), NOW - 40 * MIN);
  await save(good({ device: "main-pc", gpu: { state: "unknown" }, disks: [{ mount: "C:", usedGb: 819.8, totalGb: 930.5 }] }), NOW - 12 * MIN);
  return devices.devicesSnapshot(NOW);
}

test("패널: 장비 3개 카드·연결 상태·GPU 없음/확인 못 함·임계값 글자·배포 수 라벨·비밀값 없음", async () => {
  const snap = await sampleSnapshot();
  const html = renderToStaticMarkup(h(panel.DevicePanelView, { data: snap, now: NOW }));
  for (const d of ["server1", "server2", "main-pc"]) assert.match(html, new RegExp(`data-device="${d}"`));
  assert.match(html, /data-device="server1" data-state="ok"/);
  assert.match(html, /data-device="server2" data-state="offline"/);
  assert.match(html, /data-device="main-pc" data-state="stale"/);
  assert.match(html, /끊김/);
  assert.match(html, /오래된 값/);
  assert.match(html, /GPU 없음/); // 서버2
  assert.match(html, /GPU 확인 못 함/); // 메인PC
  assert.match(html, /fx-seg fx-bad/); // CPU 95% 위험 막대
  assert.match(html, /위험/);
  assert.match(html, /주의/); // RAM 77% 주의
  assert.match(html, /aria-valuetext="95% 사용 \(위험\)"/);
  assert.match(html, /24\.0 \/ 31\.2 GB/);
  assert.match(html, /디스크 C:/);
  assert.match(html, /819\.8 \/ 930\.5 GB 사용/);
  assert.equal((html.match(/<span aria-hidden="true"( class="fx-on")?><\/span>/g) ?? []).length % 24, 0, "24칸 막대");
  // 배포 수: 무엇을 센 숫자인지 라벨
  assert.match(html, /서버1에서 실행 중인 Docker 컨테이너/);
  assert.match(html, /docker ps 로 센 실행 중 컨테이너/);
  assert.match(html, /홈페이지 &#x27;출시&#x27; 프로젝트/);
  assert.match(html, /전체 11개 중/);
  assert.match(html, /스토어 출시 앱/);
  assert.match(html, /<details[^>]*><summary[^>]*>컨테이너 이름 보기 \(3\)<\/summary>/);
  // 비밀값·호스트 정보 없음
  for (const s of [STATUS_TOKEN, "Bearer", "192.168", "hostname", "image", "PORT", "env"]) assert.ok(!html.includes(s), s);
});

test("패널: 읽기 실패·첫 값 없음·받은 적 없는 장비", () => {
  const err = renderToStaticMarkup(h(panel.DevicePanelView, { data: null, now: NOW, error: "갱신 실패" }));
  assert.match(err, /갱신 실패/);
  assert.match(err, /장비 상태를 읽지 못했어요/);
  const never = renderToStaticMarkup(
    h(panel.DevicePanelView, {
      data: { asOf: NOW, devices: devices.DEVICES.map((d) => devices.toDeviceView(d, null, [], NOW)), deploys: { containers: { state: "never", asOf: null }, homepage: null, storeReleased: null } },
      now: NOW,
    }),
  );
  assert.equal((never.match(/받은 적 없음/g) ?? []).length, 3);
  assert.match(never, /수집 스크립트를 설치하면/);
  assert.match(never, /서버1 값 없음/);
  assert.match(never, /확인 못 함/);
  assert.equal(panel.containersText({ state: "unknown", asOf: NOW }), "확인 못 함");
});

test("하단 상태바: 장비별 CPU/RAM 한 칸, 끊김 표시, 받은 값이 없으면 칸 생략", async () => {
  const bar = loadTs("components/admin/ui/AdminStatusBar.tsx", { "@/components/admin/ui/meters": meters, "@/lib/claude-status/fable": loadTs("lib/claude-status/fable.ts") });
  await sampleSnapshot();
  const briefs = await devices.deviceBriefs(NOW);
  assert.equal(bar.deviceSummary(briefs), "서버1 CPU 95% RAM 77% · 서버2 끊김 · 메인PC CPU 37% RAM 39% (오래됨)");
  const parts = bar.statusBarParts({ asOf: NOW, supervisor: null, build: null, claude: null, codex: null, devices: briefs }, NOW);
  const part = parts.find((p) => p.key === "devices");
  assert.equal(part.tone, "bad");
  assert.equal(part.label, "장비 CPU·RAM");
  reset();
  const none = await devices.deviceBriefs(NOW);
  assert.equal(bar.deviceSummary(none), null);
  assert.ok(!bar.statusBarParts({ asOf: NOW, supervisor: null, build: null, claude: null, codex: null, devices: none }, NOW).some((p) => p.key === "devices"));
  assert.ok(!bar.statusBarParts({ asOf: NOW, supervisor: null, build: null, claude: null, codex: null }, NOW).some((p) => p.key === "devices"), "옛 서버 응답");
});

// ── 수집 스크립트 ──
const collector = await import(pathToFileURL(path.join(repo, "tools/factory-supervisor/devicestats.mjs")).href);

test("메인PC 수집: nvidia-smi 읽기·CPU 차이·없으면 '확인 못 함', 보낸 본문은 서버 검증을 통과하고 숫자만", async () => {
  assert.deepEqual(collector.parseNvidiaSmi("37, 2048, 8192, 55\r\n"), [{ utilPct: 37, memUsedGb: 2, memTotalGb: 8, tempC: 55 }]);
  assert.deepEqual(collector.parseNvidiaSmi("[N/A], 100, 4096, [N/A]"), [{ utilPct: null, memUsedGb: 0.1, memTotalGb: 4, tempC: null }]);
  assert.equal(collector.parseNvidiaSmi(""), null);
  assert.equal(collector.cpuPctBetween({ idle: 100, total: 200 }, { idle: 150, total: 400 }), 75);
  assert.equal(collector.cpuPctBetween(null, { idle: 1, total: 2 }), null);
  assert.equal(collector.cpuPctBetween({ idle: 1, total: 2 }, { idle: 1, total: 2 }), null);
  const missing = await collector.readGpu({ run: (_c, _a, _o, cb) => cb(Object.assign(new Error("not found"), { code: "ENOENT" })) });
  assert.deepEqual(missing, { state: "unknown" });
  const disks = await collector.readDisks({
    platform: "win32",
    statfs: async (root) => {
      if (root === "C:\\") return { blocks: 1000, bsize: 1024 ** 3 / 1000 * 1000 / 1000, bavail: 250 };
      if (root === "D:\\") return { blocks: 2000, bsize: 1024 ** 3 / 1000 * 1000 / 1000, bavail: 1000 };
      if (root === "Z:\\") return new Promise(() => {}); // 멈춘 네트워크 드라이브
      throw new Error("ENOENT");
    },
  });
  assert.deepEqual(disks.map((d) => d.mount), ["C:", "D:"]); // 시스템 드라이브 먼저
  const body = await collector.collect({ prevCpu: { idle: 0, total: 0 }, cpu: { idle: 50, total: 100 }, totalmem: 32 * 1024 ** 3, freemem: 8 * 1024 ** 3, gpu: missing, disks, running: null });
  assert.deepEqual(Object.keys(body).sort(), ["cpuPct", "device", "disks", "gpu", "measuredAt", "ram"]);
  assert.equal(body.device, "main-pc");
  assert.equal(body.cpuPct, 50);
  assert.deepEqual(body.ram, { usedGb: 24, totalGb: 32 });
  const v = devices.validateDevicePayload(JSON.parse(JSON.stringify(body)));
  assert.equal(v.ok, true, v.reason);
});

test("메인PC 수집: 보내기가 실패·던져도 감독 프로그램을 멈추지 않고, 로그는 10번에 한 번", async () => {
  const logs = [];
  let n = 0;
  const s = collector.startDeviceStats({
    api: async () => {
      n++;
      throw new Error("ECONNREFUSED");
    },
    log: (l) => logs.push(l),
    everyMs: 3_600_000,
  });
  for (let i = 0; i < 12; i++) await s.tick();
  s.stop();
  assert.equal(n, 12);
  assert.equal(logs.length, 2);
  assert.match(logs[0], /장비 상태 보내기 실패: 연결 안 됨/);
  const sent = [];
  const ok = collector.startDeviceStats({ api: async (m, p, b) => (sent.push([m, p, b]), { status: 200 }), everyMs: 3_600_000 });
  await ok.tick();
  ok.stop();
  assert.equal(sent[0][0], "POST");
  assert.equal(sent[0][1], "/api/factory/device-stats");
});

test("감독 프로그램: 시작할 때 장비 상태 보내기를 붙이고, 실패해도 폴링으로 넘어간다", () => {
  const src = fs.readFileSync(path.join(repo, "tools/factory-supervisor/supervisor.mjs"), "utf8");
  assert.match(src, /import \{ startDeviceStats \} from "\.\/devicestats\.mjs";/);
  assert.match(src, /try \{\s*startDeviceStats\(\{ api, log \}\);\s*\} catch[\s\S]*?\}\s*await loop\(\);/);
});

test("서버 수집 스크립트(bash): 문법 확인, print 결과가 서버 검증을 통과하고 비밀값을 출력하지 않음", (t) => {
  const script = path.join(repo, "tools/factory-supervisor/device-stats.sh");
  const src = fs.readFileSync(script, "utf8");
  assert.match(src, /docker ps --format '\{\{\.Names\}\}'/);
  assert.ok(!/docker (ps --format '[^']*(Ports|Env|Mounts|Command)|inspect[^\n]*(\.Env|\.Cmd|Mounts|Args))/.test(src), "환경변수·명령줄·마운트·포트는 안 읽음");
  assert.ok(!/docker (rm|stop|kill|restart|prune|rmi|system prune|volume rm|exec|run)\b/.test(src), "읽기 전용: 종료·삭제·정리 명령 없음");
  assert.ok(!/hostname|ip addr|ifconfig/.test(src), "호스트 정보 안 읽음");
  assert.match(src, /-H @<\(printf 'Authorization: Bearer %s\\n' "\$tok"\)/, "토큰은 명령줄에 안 보이게");
  const bash = spawnSync("bash", ["-n", script]);
  if (bash.error) return t.skip("bash 없음");
  assert.equal(bash.status, 0, String(bash.stderr));
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || "/tmp"), "devstat-"));
  fs.writeFileSync(path.join(tmp, "token"), "secret-token-should-not-print-123456\n");
  fs.writeFileSync(path.join(tmp, "env"), "DEVICE_STATS_DEVICE=server2\nDEVICE_STATS_URL=http://127.0.0.1:9/none\n");
  const run = spawnSync("bash", [script, "print"], { env: { ...process.env, DEVICE_STATS_CONF: tmp.replace(/\\/g, "/") }, encoding: "utf8", timeout: 30_000 });
  const chk = spawnSync("bash", [script, "check"], { env: { ...process.env, DEVICE_STATS_CONF: tmp.replace(/\\/g, "/") }, encoding: "utf8", timeout: 30_000 });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!fs.existsSync("/proc/stat") && run.status !== 0) return t.skip("이 PC 셸에는 /proc 이 없음");
  assert.equal(run.status, 0, run.stderr);
  const body = JSON.parse(run.stdout);
  assert.equal(body.device, "server2");
  const v = devices.validateDevicePayload(body);
  assert.equal(v.ok, true, v.reason);
  assert.ok(!(run.stdout + chk.stdout + chk.stderr).includes("secret-token-should-not-print"), "토큰 미출력");
  assert.match(chk.stdout, /토큰 파일: 있음/);
});
