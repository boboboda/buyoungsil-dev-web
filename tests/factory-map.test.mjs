// 4-3 시험: 통제실 [지도]
//  - 데이터 조립: 연결 정보·에이전트 정의·컨테이너·도구·카드를 합친 그래프(블록·선·상태·진행 중 한 줄)
//  - 권한 표시: 정의와 코드의 권한 상한·훅이 합쳐진 '실제 적용 권한'(허용 도구·쓰기 경로·네트워크·SSH 대상·키 이름·훅), 상한을 넓힌 정의는 목록에 없다
//  - 화면: 보기 전용(GET 만, 고치는 단추·요청 없음), 비밀 값·nginx 설정을 읽지 않는다, 탭 목록
// 실행: node tests/factory-map.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const specMod = await import(pathToFileURL(path.join(repo, "tools/factory-supervisor/agentspec.mjs")).href);
const accessMod = await import(pathToFileURL(path.join(repo, "tools/factory-supervisor/serveraccess.mjs")).href);
const agentsLib = loadTs("lib/factory/agents.ts", { "../../tools/factory-supervisor/agentspec.mjs": specMod });
const mapLib = loadTs("lib/factory/factoryMap.ts");
const diagram = loadTs("components/studio/BlockDiagram.tsx");
const panel = loadTs("components/admin/factory/FactoryMap.tsx", { "@/components/studio/BlockDiagram": diagram, "@/lib/factory/factoryMap": mapLib });
const realDir = path.join(repo, "tools", "factory-supervisor", "agents");

// ───────── 가짜 입력 ─────────
const NOW = Date.parse("2026-10-15T03:00:00Z");
const { agents: realAgents, errors: realErrors } = agentsLib.readAgentPerms(realDir);
const dev = (state, containers) => ({ state, receivedAt: NOW - 60_000, cpuPct: 12, ramPct: 40, containers });
const c = (name, state = "running", extra = {}) => ({ name, state, status: null, restarts: 0, project: null, flags: [], ...extra });
const row = (o) => ({
  appSlug: "x", folder: "x", hasFolder: true, isGit: true, stack: "flutter", branch: "main", remotes: [], remotesSource: "report", deployServer: null, deployMethod: null, domain: null, containerName: null, services: [],
  containersFound: null, notes: null, exportKind: null, exportPath: null, studioBatch: false, studioService: false, layoutConfig: null, warnings: [], ...o,
});
const remote = (name, host, p, purpose) => ({ name, host, path: p, purpose });
const job = (o) => ({ id: "j1", appSlug: "x", title: "작업", kind: "revision", releaseKind: null, status: "done", phase: null, parallelGroup: null, aiEngine: "claude", requiredSecrets: [], createdAt: NOW - 3600_000, startedAt: null, finishedAt: null, ...o });

function baseInput(over = {}) {
  return {
    now: NOW,
    supervisor: { online: true, enabled: true, commit: "422f5fd5efdede39e9b73806593904a72c867098", commitSubject: "에이전트 블록 정의", startedAt: "2026-10-15T00:00:00Z", appSlots: 3, running: 0, approved: 0, pending: 0, pausedJobs: 0, deploying: false, staleCopies: [], workerName: "pc", lastSeenAt: NOW - 5000 },
    devices: { "main-pc": dev("ok", null), server1: dev("ok", [c("homepage"), c("studio-api"), c("old-app", "exited")]), server2: dev("ok", [c("game-api")]) },
    links: {
      rows: [
        row({ appSlug: "alpha", remotes: [remote("origin", "github.com", "a/alpha.git", "github"), remote("deploy", "serverpc2", "git-server/repo/alpha.git", "deploy")], deployServer: "serverpc", containerName: "homepage", domain: "alpha.example.com" }),
        row({ appSlug: "beta", remotes: [], deployServer: "serverpc2", containerName: "game-api", services: ["redis-missing"], warnings: [{ kind: "no-remote", text: "git 원격이 없어요" }] }),
        row({ appSlug: "gamma", remotes: [remote("origin", "github.com", "a/gamma.git", "github")], deployServer: "serverpc", containerName: "ghost", domain: "gamma.example.com", warnings: [{ kind: "no-container", text: "ghost 없음" }] }),
      ],
      reportAt: new Date(NOW).toISOString(),
      reportStale: false,
      servers: { serverpc: "ok", serverpc2: "ok" },
    },
    serverNames: { serverpc: null, serverpc2: null },
    agents: realAgents,
    agentErrors: realErrors,
    tools: [
      { name: "pixel-art", label: "픽셀 그림", source: "file", version: 2, methods: [{ id: "pixellab", label: "PixelLab", secrets: [{ name: "PIXELLAB_API_KEY", ready: true }] }] },
      { name: "sfx", label: "효과음", source: "fallback", version: 1, methods: [{ id: "default", label: "기본", secrets: [] }] },
    ],
    cards: [
      { id: "c1", appSlug: "alpha", name: "캐릭터", tool: "pixel-art", method: "pixellab", enabled: true, version: 3, warnings: [] },
      { id: "c2", appSlug: "alpha", name: "소리", tool: "sfx", method: "", enabled: false, version: 1, warnings: ["경고 하나"] },
    ],
    jobs: [job({ id: "j2", appSlug: "alpha", title: "알파 수정", status: "running", phase: "build", startedAt: NOW - 1000, requiredSecrets: ["PIXELLAB_API_KEY"] }), job({ id: "j3", appSlug: "beta", title: "베타 새 앱", kind: "new", status: "approved" })],
    maintenance: { runningTitle: null, needsDeploy: 0, deployingNow: false },
    ...over,
  };
}
const byId = (g, id) => g.nodes.find((n) => n.id === id);
const hasEdge = (g, a, b) => g.edges.some((e) => e.from === a && e.to === b);
const listOf = (d, heading) => d.lists.find((l) => l.heading === heading)?.items ?? [];

// ───────── 데이터 조립 ─────────
test("그래프: 기계 3개·에이전트 10개·도구·카드·앱·원격·도메인·컨테이너 블록이 생긴다", () => {
  const g = mapLib.buildFactoryMap(baseInput());
  const kinds = (k) => g.nodes.filter((n) => n.kind === k);

  assert.equal(kinds("machine").length, 3);
  assert.deepEqual(kinds("machine").map((n) => n.id).sort(), ["machine:main-pc", "machine:server1", "machine:server2"]);
  assert.equal(kinds("agent").length, 10, "정의 10종");
  assert.equal(kinds("tool").length, 2);
  assert.equal(kinds("card").length, 2);
  assert.equal(kinds("app").length, 3);
  assert.equal(kinds("remote").length, 1, "배포 원격이 기록된 앱만");
  assert.equal(kinds("domain").length, 2);
  assert.ok(byId(g, "proxy:server1"), "서버1 도메인이 있으면 프록시");
  assert.equal(g.frames.length, 3, "기계마다 상자");
  for (const a of g.nodes) {
    for (const b of g.nodes) {
      if (a.id < b.id) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} 와 ${b.id} 가 겹쳐요`);
    }
  }
  for (const n of g.nodes) assert.ok(g.frames.some((f) => n.x >= f.x && n.x + n.w <= f.x + f.w && n.y >= f.y && n.y + n.h <= f.y + f.h), `${n.id} 가 상자 밖`);
});

test("선: 앱 폴더 → git 원격 → 컨테이너, 에이전트 → 도구, 카드 → 도구, 프록시 → 도메인 → 컨테이너", () => {
  const g = mapLib.buildFactoryMap(baseInput());

  assert.ok(hasEdge(g, "app:alpha", "remote:alpha"));
  assert.ok(hasEdge(g, "remote:alpha", "container:serverpc:homepage"));
  assert.ok(hasEdge(g, "agent:A2", "tool:pixel-art"), "수정 에이전트는 도구 요청 중계로 도구를 쓴다");
  assert.ok(hasEdge(g, "agent:T", "tool:pixel-art") && hasEdge(g, "agent:T", "tool:sfx"), "도구 일감은 카드가 쓰는 도구를 직접 실행");
  assert.ok(!hasEdge(g, "agent:C1", "tool:pixel-art"), "지휘자는 도구를 쓰지 않는다");
  assert.ok(hasEdge(g, "card:c1", "tool:pixel-art") && hasEdge(g, "card:c2", "tool:sfx"));
  assert.ok(hasEdge(g, "card:c1", "app:alpha"));
  assert.ok(hasEdge(g, "proxy:server1", "domain:alpha.example.com"));
  assert.ok(hasEdge(g, "domain:alpha.example.com", "container:serverpc:homepage"));
  const inferred = g.edges.find((e) => e.from === "app:beta" && e.to === "container:serverpc2:game-api");

  assert.ok(inferred?.inferred, "원격 기록이 없는 앱은 점선");
  assert.ok(g.edges.filter((e) => e.from === "proxy:server1").every((e) => e.to.startsWith("domain:")));
  for (const e of g.edges) assert.ok(byId(g, e.from) && byId(g, e.to), `${e.from}>${e.to}`);
});

test("상태 색: 정상 / 작업 중 / 배포 대기 / 끊김·못 찾음 / 경고", () => {
  const g = mapLib.buildFactoryMap(baseInput({ maintenance: { runningTitle: null, needsDeploy: 2, deployingNow: false } }));

  assert.equal(byId(g, "machine:server1").status, "pending", "정비 코드 배포 대기");
  assert.match(byId(g, "machine:server1").statusText, /배포 대기 2건/);
  assert.equal(byId(g, "app:alpha").status, "busy", "일감 진행 중");
  assert.equal(byId(g, "app:beta").status, "warn", "원격 없음");
  assert.equal(byId(g, "container:serverpc:ghost").status, "down", "연결 표에는 있는데 서버 목록에 없음 = 못 찾음");
  assert.equal(byId(g, "container:serverpc:old-app").status, "down", "멈춘 컨테이너");
  assert.equal(byId(g, "container:serverpc:homepage").status, "ok");
  assert.equal(byId(g, "container:serverpc2:redis-missing").status, "down", "연결된 서비스 컨테이너도 못 찾으면 표시");
  assert.equal(byId(g, "tool:sfx").status, "warn", "설명서 fallback");
  assert.equal(byId(g, "card:c2").status, "warn");
  assert.ok(byId(g, "card:c2").dim, "꺼진 카드는 흐리게");
  const g2 = mapLib.buildFactoryMap(baseInput({ links: { ...baseInput().links, rows: [row({ appSlug: "beta", remotes: [remote("origin", "github.com", "a/b.git", "github")] })] }, jobs: [job({ appSlug: "beta", status: "approved" })] }));

  assert.equal(byId(g2, "app:beta").status, "pending");
  const g3 = mapLib.buildFactoryMap(baseInput({ devices: { "main-pc": dev("ok", null), server1: dev("offline", null), server2: dev("stale", [c("game-api")]) } }));

  assert.equal(byId(g3, "machine:server1").status, "down");
  assert.equal(byId(g3, "machine:server2").status, "warn");
  assert.equal(Object.values(g.counts).reduce((a, b) => a + b, 0), g.nodes.length);
});

test("컨테이너 목록을 못 받은 서버는 '못 찾음'이 아니라 '상태 미확인'", () => {
  const none = { "main-pc": dev("ok", null), server1: dev("ok", null), server2: dev("ok", null) };
  const g = mapLib.buildFactoryMap(baseInput({ devices: none }));
  const ghost = byId(g, "container:serverpc:ghost");

  assert.equal(ghost.status, "warn");
  assert.match(ghost.statusText, /미확인/);
  const g2 = mapLib.buildFactoryMap(baseInput({ devices: none, serverNames: { serverpc: ["homepage", "ghost"], serverpc2: ["game-api"] } }));

  assert.equal(byId(g2, "container:serverpc:ghost").status, "ok", "연결 표 보고의 docker ps 이름을 쓴다");
});

test("메인 PC 블록: 감독 버전·연결 상태·슬롯 사용", () => {
  const sv = baseInput().supervisor;
  const g = mapLib.buildFactoryMap(baseInput({ supervisor: { ...sv, running: 2, appSlots: 3 } }));
  const pc = byId(g, "machine:main-pc");

  assert.match(pc.sub, /422f5fd/);
  assert.ok(pc.badges.some((b) => b.text === "연결됨") && pc.badges.some((b) => b.text === "슬롯 2/3"));
  assert.equal(pc.status, "busy");
  assert.ok(pc.detail.rows.some((r) => r.label === "감독 버전" && r.value.includes("422f5fd")));
  assert.ok(pc.detail.rows.some((r) => r.label === "슬롯 사용" && r.value.includes("2/3")));
  assert.equal(byId(mapLib.buildFactoryMap(baseInput({ supervisor: { ...sv, online: false } })), "machine:main-pc").status, "down");
  assert.equal(byId(mapLib.buildFactoryMap(baseInput({ supervisor: { ...sv, enabled: false } })), "machine:main-pc").status, "warn");
});

test("진행 중 일감은 에이전트·앱 블록에 실시간 한 줄로 뜬다", () => {
  const g = mapLib.buildFactoryMap(baseInput());

  assert.match(byId(g, "agent:A2").live, /알파 수정/);
  assert.match(byId(g, "agent:A2").live, /빌드 중/);
  assert.equal(byId(g, "agent:A2").status, "busy");
  assert.equal(byId(g, "agent:A1").live, null);
  assert.match(byId(g, "app:alpha").live, /알파 수정/);
  assert.equal(byId(g, "app:beta").live, null);
  assert.equal(mapLib.agentOfJob({ kind: "new", releaseKind: null, parallelGroup: null }), "A1");
  assert.equal(mapLib.agentOfJob({ kind: "revision", releaseKind: null, parallelGroup: "g" }), "A3");
  assert.equal(mapLib.agentOfJob({ kind: "revision", releaseKind: "first", parallelGroup: null }), "R1");
  assert.equal(mapLib.agentOfJob({ kind: "lab", releaseKind: null, parallelGroup: null }), "L1");
  assert.equal(mapLib.agentOfJob({ kind: "tool", releaseKind: null, parallelGroup: null }), "T");
  const m = mapLib.buildFactoryMap(baseInput({ maintenance: { runningTitle: "4-3 지도", needsDeploy: 0, deployingNow: false } }));

  assert.match(byId(m, "agent:M1").live, /4-3 지도/);
  assert.match(byId(m, "machine:main-pc").live, /정비/);
  const d = mapLib.buildFactoryMap(baseInput({ maintenance: { runningTitle: null, needsDeploy: 1, deployingNow: true } }));

  assert.equal(byId(d, "machine:server1").status, "busy");
  assert.match(byId(d, "machine:server1").live, /배포 중/);
});

test("앱·서비스 상세: 원격·브랜치·최근 일감 / 컨테이너 상태·도메인·연결된 프로젝트", () => {
  const g = mapLib.buildFactoryMap(baseInput());
  const app = byId(g, "app:alpha").detail;

  assert.ok(app.rows.some((r) => r.label === "브랜치" && r.value === "main"));
  assert.ok(listOf(app, "git 원격").some((s) => s.includes("serverpc2") && s.includes("배포")));
  assert.ok(listOf(app, "git 원격").some((s) => s.includes("github.com")));
  assert.ok(listOf(app, "최근 일감").some((s) => s.includes("알파 수정")));
  const svc = byId(g, "container:serverpc:homepage").detail;

  assert.ok(svc.rows.some((r) => r.label === "도메인" && r.value.includes("alpha.example.com")));
  assert.ok(svc.rows.some((r) => r.label === "연결된 프로젝트" && r.value.includes("alpha")));
  assert.ok(svc.rows.some((r) => r.label === "상태" && r.value.includes("실행 중")));
});

test("조립 모듈은 nginx 설정·파일을 읽지 않는다", () => {
  const src = read("lib/factory/factoryMap.ts") + read("lib/factory/factoryMapDb.ts");

  assert.ok(!/from "node:fs"|require\("fs"\)|readFileSync|nginx\.conf|sites-enabled/.test(src), "파일을 읽는 코드가 없다");
  assert.ok(!/process\.env/.test(src), "환경변수(키 값)를 읽지 않는다");
  assert.match(read("lib/factory/factoryMap.ts"), /nginx 설정은 읽지 않는다/);
});

// ───────── 권한 표시 ─────────
const perm = (id) => realAgents.find((a) => a.id === id);

test("권한 표시: 정의에 있는 10종이 모두 실제 적용 권한으로 나온다", () => {
  assert.deepEqual(realErrors, []);
  assert.deepEqual(realAgents.map((a) => a.id).sort(), ["A1", "A2", "A3", "A4", "C1", "H1", "L1", "M1", "R1", "T"]);
  for (const a of realAgents) {
    for (const k of ["tools", "blockedTools", "writes", "noWrites", "readBlocks", "network", "ssh", "hooks", "envNames"]) assert.ok(Array.isArray(a[k]), `${a.id}.${k}`);
    assert.match(a.envFilter, /키·토큰/);
  }
});

test("권한 표시: 수정(A2) — 도구·쓰기·SSH 대상·훅이 정의와 상한을 합친 값", () => {
  const a = perm("A2");

  assert.deepEqual(a.tools, ["Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebFetch", "WebSearch"]);
  for (const t of ["NotebookEdit", "Task", "Agent"]) assert.ok(a.blockedTools.includes(t), `${t} 는 정의로 열 수 없다`);
  assert.ok(a.writes.some((w) => w.includes("앱 폴더")));
  assert.ok(a.noWrites.some((w) => w.includes("보호 폴더")) && a.noWrites.some((w) => w.includes("키 파일")));
  assert.ok(a.readBlocks.some((w) => w.includes("~/.ssh")) && a.readBlocks.some((w) => w.includes("supervisor.config.json")));
  assert.deepEqual(a.ssh.filter((s) => s.startsWith("serverpc")).map((s) => s.split(" ")[0]), ["serverpc", "serverpc2"]);
  assert.ok(a.hooks.some((x) => x.startsWith("ssh-guard")));
  assert.ok(a.network.some((x) => x.includes("Codex") && x.includes("꺼짐")));
  assert.deepEqual([...a.envNames].sort(), ["FACTORY_APP_SLUG", "FACTORY_JOB_ID"]);
});

test("권한 표시: 지휘자(C1)는 읽기 전용, 도구 일감(T)은 AI·SSH 없음, 실험(L1)만 Codex 인터넷", () => {
  const c1 = perm("C1");

  assert.equal(c1.readOnly, true);
  assert.deepEqual(c1.tools, ["Read", "Glob", "Grep"]);
  for (const t of ["Bash", "Edit", "Write", "WebFetch", "WebSearch"]) assert.ok(c1.blockedTools.includes(t));
  assert.deepEqual(c1.writes, []);
  assert.ok(c1.ssh.every((s) => s.startsWith("없음")));
  const t = perm("T");

  assert.deepEqual(t.tools, []);
  assert.ok(t.ssh.every((s) => s.startsWith("없음")));
  assert.ok(t.writes.some((w) => w.includes("tooljobs")));
  assert.equal(t.keys, "tool-method");
  const l1 = perm("L1");

  assert.ok(l1.network.some((x) => x.includes("Codex: 인터넷 허용")));
  assert.ok(l1.writes.some((w) => w.includes("실험 폴더")) && l1.writes.some((w) => w.includes("공용 폴더")));
  for (const a of realAgents.filter((x) => x.id !== "L1")) assert.ok(!a.network.some((x) => x.includes("Codex: 인터넷 허용")), `${a.id} 는 Codex 인터넷이 꺼져 있다`);
  const m1 = perm("M1");

  assert.ok(m1.hooks.some((x) => x.startsWith("maintenance-guard")));
  assert.ok(m1.noWrites.some((x) => x.includes("코드")), "정비 경로 규칙은 코드가 만든다");
});

test("권한 표시: 정의가 상한을 넓히면 불러올 때 거절되어 권한 목록에 나오지 않는다(예전 코드가 그대로 돈다)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "map-agents-"));

  try {
    fs.mkdirSync(path.join(dir, "flows"));
    for (const f of fs.readdirSync(realDir).filter((x) => x.endsWith(".json"))) fs.copyFileSync(path.join(realDir, f), path.join(dir, f));
    const a2 = JSON.parse(fs.readFileSync(path.join(dir, "app-revision.json"), "utf8"));

    a2.tools.allow = [...a2.tools.allow, "Task"];
    a2.hooks = [];
    fs.writeFileSync(path.join(dir, "app-revision.json"), JSON.stringify(a2));
    const r = agentsLib.readAgentPerms(dir);

    assert.ok(!r.agents.some((a) => a.id === "A2"), "넓힌 정의는 빠진다");
    assert.equal(r.agents.length, 9);
    assert.ok(r.errors.some((e) => e.file === "app-revision.json" && /상한/.test(e.message)));
    const g = mapLib.buildFactoryMap(baseInput({ agents: r.agents, agentErrors: r.errors }));

    assert.ok(!byId(g, "agent:A2"));
    assert.ok(byId(g, "machine:main-pc").detail.lists.some((l) => l.heading === "거절된 에이전트 정의" && l.items.some((i) => i.includes("app-revision.json"))));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("권한 표시: SSH 대상 상수는 서버 접근 규칙(serveraccess)의 서버 목록과 같다", () => {
  assert.deepEqual(specMod.SERVER_HOSTS, accessMod.SERVER_HOSTS);
});

test("블록 상세: 에이전트 상세에 권한 항목이 모두 있고, 키는 이름만 나온다(값 없음)", () => {
  const g = mapLib.buildFactoryMap(baseInput());
  const d = byId(g, "agent:A2").detail;
  const heads = d.lists.map((l) => l.heading);

  for (const hd of ["허용 도구", "막은 도구", "쓸 수 있는 경로", "쓰기 금지", "읽기 금지", "네트워크", "SSH 대상", "받는 키 이름(값 없음)", "훅", "넘기는 환경변수 이름"]) assert.ok(heads.includes(hd), hd);
  assert.deepEqual(listOf(d, "받는 키 이름(값 없음)"), ["PIXELLAB_API_KEY"], "최근 일감이 요청한 키 이름");
  assert.deepEqual(listOf(byId(g, "agent:T").detail, "받는 키 이름(값 없음)"), ["PIXELLAB_API_KEY"], "도구 일감은 설명서 방법의 키 이름");
  assert.deepEqual(listOf(byId(g, "agent:C1").detail, "받는 키 이름(값 없음)"), ["없음"]);
  assert.ok(!/sk-[A-Za-z0-9]{10}|Bearer |password=/i.test(JSON.stringify(g)));
});

// ───────── 화면·배선 ─────────
test("화면: 범례·블록·선·상세가 그려지고, 고치는 단추·입력이 없다", () => {
  const g = mapLib.buildFactoryMap(baseInput());
  const html = renderToStaticMarkup(h(panel.default, { initial: { graph: g, asOf: NOW, reportAt: null, reportStale: false } }));

  assert.match(html, /data-factory-map/);
  for (const s of ["정상", "작업 중", "배포 대기", "끊김·못 찾음", "경고"]) assert.ok(html.includes(s), `범례 ${s}`);
  assert.ok(html.includes('data-block="machine:main-pc"') && html.includes('data-block="container:serverpc:homepage"'));
  assert.ok(html.includes('data-block-status="down"') && html.includes('data-block-status="busy"'));
  assert.ok(html.includes("data-frame="), "기계 상자");
  assert.ok(html.includes('data-edge-kind="git"') && html.includes('data-edge-kind="tool"') && html.includes('data-edge-kind="route"'));
  assert.match(html, /data-block-live/);
  assert.match(html, /data-map-detail/);
  assert.match(html, /감독 버전/);
  assert.ok(!/<input|<textarea|<select|type="submit"/.test(html), "입력칸이 없다");
  const src = read("components/admin/factory/FactoryMap.tsx");

  assert.ok(!/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(src), "GET 만 부른다");
  assert.ok(!/<form/.test(src));
  assert.match(src, /5000/);
});

test("배선: 지도 탭·관리자 전용 읽기 API·[구성]과 같은 블록 그림", () => {
  assert.match(read("components/admin/factory/consoleTabs.ts"), /\{ key: "map", label: "지도" \}/);
  assert.match(read("components/admin/factory/FactoryConsole.tsx"), /\{tab === "map" && <FactoryMap \/>\}/);
  const route = read("app/api/admin/factory/map/route.ts");

  assert.match(route, /requireAdmin/);
  assert.ok(!/export async function (POST|PUT|PATCH|DELETE)/.test(route), "GET 만 있다");
  assert.match(route, /no-store/);
  assert.match(read("components/admin/factory/FactoryMap.tsx"), /from "@\/components\/studio\/BlockDiagram"/);
  const dash = loadTs("lib/studio/dashboard.ts");
  const plain = dash.buildBlockGraph({ appSlug: "x", title: "X", kindLabel: "게임", cards: [{ id: "c", name: "카드", version: 1, tool: "pixel-art", method: "", enabled: true, warnings: [] }], tools: [], toolkitCommit: "" });
  const out = renderToStaticMarkup(h(diagram.default, { graph: plain, selected: null, onSelect() {} }));

  assert.ok(out.includes('data-block="project:x"') && !out.includes("data-block-state") && !out.includes("data-frame="), "[구성] 그림은 그대로");
});
