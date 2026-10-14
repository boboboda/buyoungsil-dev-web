// 앱별 배포·저장소 연결 기록 시험(1-6): 순수 함수(원격 주소 읽기·용도 추정·보고 검사·수정 검사·경고), 가짜 DB(표·새로 읽기 요청),
// 감독 프로그램 수집기(진짜 임시 git 저장소, 가짜 ssh)와 연결 배선(/next·커넥터 도구·통제실).
// 실행: npm run test:project-links
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const layoutLib = loadTs("lib/studio/layout.ts");
const lib = loadTs("lib/factory/projectLinks.ts", { "@/lib/studio/layout": layoutLib });

// 가짜 DB: factoryAppConnection · factoryJob · factorySetting
function fakeDb(conns = [], jobs = []) {
  const settings = new Map();
  const connections = new Map(conns.map((c) => [c.appSlug, { ...c }]));
  return {
    settings,
    connections,
    factoryAppConnection: {
      findMany: async () => [...connections.values()],
      upsert: async ({ where, create, update }) => {
        const cur = connections.get(where.appSlug);
        connections.set(where.appSlug, cur ? { ...cur, ...update } : { ...create });
      },
    },
    factoryJob: { findMany: async () => jobs },
    factorySetting: {
      findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      upsert: async ({ where, create, update }) => void settings.set(where.key, settings.has(where.key) ? update.value : create.value),
      update: async ({ where, data }) => void settings.set(where.key, data.value),
      deleteMany: async ({ where }) => void settings.delete(where.key),
    },
  };
}
const loadDb = (db) => loadTs("lib/factory/projectLinksDb.ts", { "@/lib/prisma": { __esModule: true, default: db }, "@/lib/factory/projectLinks": lib, "@/lib/studio/layout": layoutLib });

test("원격 주소: 호스트·경로만 뽑고 자격 증명은 버린다. 용도는 이름·경로로 짐작한다", () => {
  assert.deepEqual(lib.parseRemoteUrl("serverpc2:git-server/claude-work/a.git"), { host: "serverpc2", path: "git-server/claude-work/a.git" });
  assert.deepEqual(lib.parseRemoteUrl("serverpc2:~/git-server/repo/x.git"), { host: "serverpc2", path: "git-server/repo/x.git" });
  assert.deepEqual(lib.parseRemoteUrl("git@github.com:boboboda/investCalculator.git"), { host: "github.com", path: "boboboda/investCalculator.git" });
  const withPass = lib.parseRemoteUrl("https://user:secretpass@github.com/boboboda/x.git");
  assert.deepEqual(withPass, { host: "github.com", path: "boboboda/x.git" });
  assert.ok(!JSON.stringify(withPass).includes("secretpass"));
  assert.equal(lib.parseRemoteUrl("그냥 글자"), null);
  assert.equal(lib.classifyRemote("origin", "github.com", "a/b.git"), "github");
  assert.equal(lib.classifyRemote("claude-backup", "serverpc2", "git-server/claude-work/a.git"), "backup");
  assert.equal(lib.classifyRemote("prod", "serverpc", "git-server/repo/a.git"), "deploy");
  assert.equal(lib.classifyRemote("x", "other", "somewhere"), "other");
});

test("보고 검사: 이상한 폴더 이름·원격은 버리고, 자격 증명은 저장되지 않는다", () => {
  const r = lib.validateReport({
    apps: [
      { folder: "good", isGit: true, branch: "main", stack: "nextjs", remotes: [{ name: "origin", url: "https://u:pw@github.com/a/b.git" }, { name: "bad name", url: "x:y" }] },
      { folder: "../evil", isGit: true },
      { folder: "plain", isGit: false },
    ],
    servers: { serverpc: { state: "ok", names: ["web", "bad name!", "db-1"] }, serverpc2: { state: "weird" }, other: { state: "ok", names: ["x"] } },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.report.apps.map((a) => a.folder), ["good", "plain"]);
  assert.equal(r.report.apps[0].remotes.length, 1);
  assert.equal(r.report.apps[0].remotes[0].purpose, "github");
  assert.ok(!JSON.stringify(r.report).includes("pw@"));
  assert.deepEqual(r.report.servers.serverpc, { state: "ok", names: ["web", "db-1"] });
  assert.deepEqual(r.report.servers.serverpc2, { state: "unknown" });
  assert.equal(r.report.servers.other, undefined);
  assert.equal(lib.validateReport({}).ok, false);
  assert.equal(lib.validateReport(null).ok, false);
});

test("수정 검사: 보낸 칸만, 모양이 틀리면 거부, 서비스는 쉼표로도", () => {
  const ok = lib.validatePatch({ deployServer: "serverpc2", domain: "app.example.com", services: "a-1, b-2", notes: " 메모 " });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.patch, { deployServer: "serverpc2", domain: "app.example.com", services: ["a-1", "b-2"], notes: "메모" });
  assert.deepEqual(lib.validatePatch({ domain: "" }).patch, { domain: null });
  assert.equal(lib.validatePatch({ deployServer: "serverpc3" }).ok, false);
  assert.equal(lib.validatePatch({ domain: "not a domain" }).ok, false);
  assert.equal(lib.validatePatch({ containerName: "a b" }).ok, false);
  assert.equal(lib.validatePatch({ stack: "cobol" }).ok, false);
  assert.equal(lib.validatePatch([]).ok, false);
});

const conn = (over) => ({ appSlug: "x", folder: null, stack: null, defaultBranch: null, remotes: null, deployServer: null, deployMethod: null, domain: null, containerName: null, services: [], notes: null, ...over });
const report = (over = {}) => ({ at: "2026-10-15T00:00:00.000Z", apps: [], servers: {}, ...over });
const remote = (name, host, path) => ({ name, host, path, purpose: lib.classifyRemote(name, host, path) });

test("경고: 원격 없음 · git 아님 · 컨테이너 못 찾음 · 컨테이너 이름 비어 있음. 서버 목록을 못 읽었으면 컨테이너 경고는 없다", () => {
  const view = lib.buildLinksView({
    appSlugs: ["jobonly"],
    connections: [
      conn({ appSlug: "norem", deployServer: "none" }),
      conn({ appSlug: "gone", deployServer: "serverpc2", containerName: "gone-web" }),
      conn({ appSlug: "fine", deployServer: "serverpc2", containerName: "fine-web" }),
      conn({ appSlug: "nocont", deployServer: "serverpc" }),
      conn({ appSlug: "unknownlist", deployServer: "serverpc", containerName: "u" }),
      conn({ appSlug: "lab" }),
    ],
    report: report({
      apps: [
        { folder: "norem", isGit: true, branch: "main", stack: null, remotes: [] },
        { folder: "gone", isGit: true, branch: "main", stack: null, remotes: [remote("prod", "serverpc2", "git-server/repo/gone.git")] },
        { folder: "fine", isGit: true, branch: "main", stack: null, remotes: [remote("prod", "serverpc2", "git-server/repo/fine.git")] },
        { folder: "novels", isGit: false, branch: null, stack: null, remotes: [] },
        { folder: "nocont", isGit: true, branch: "main", stack: null, remotes: [remote("prod", "serverpc", "git-server/repo/n.git")] },
        { folder: "unknownlist", isGit: true, branch: "main", stack: null, remotes: [remote("o", "h", "p")] },
      ],
      servers: { serverpc2: { state: "ok", names: ["fine-web"] }, serverpc: { state: "unknown" } },
    }),
    now: Date.parse("2026-10-15T01:00:00Z"),
  });
  const by = (s) => view.rows.find((r) => r.appSlug === s);
  assert.deepEqual(by("norem").warnings.map((w) => w.kind), ["no-remote"]);
  assert.deepEqual(by("gone").warnings.map((w) => w.kind), ["no-container"]);
  assert.equal(by("gone").containersFound, false);
  assert.deepEqual(by("fine").warnings, []);
  assert.equal(by("fine").containersFound, true);
  assert.deepEqual(by("novels").warnings.map((w) => w.kind), ["not-git"]);
  assert.deepEqual(by("nocont").warnings.map((w) => w.kind), ["no-container"]);
  assert.deepEqual(by("unknownlist").warnings, [], "서버 목록을 못 읽었으면 컨테이너를 못 찾았다고 말하지 않는다");
  assert.equal(by("lab"), undefined, "실험 폴더는 앱이 아니다");
  assert.ok(by("jobonly"), "일감만 있는 앱도 표에 나온다");
  assert.equal(view.reportStale, false);
  assert.equal(view.warningCount, 4 + 1 /* jobonly: 보고에 폴더가 없고 초기값도 없어 원격 없음 */);
  assert.equal(lib.buildLinksView({ appSlugs: [], connections: [], report: report(), now: Date.parse("2026-10-17T00:00:00Z") }).reportStale, true);
});

test("보고가 없으면 초기값 원격을 보여 주고, 보고가 있으면 보고가 우선한다", () => {
  const initial = [remote("origin", "serverpc2", "git-server/repo/a.git")];
  const noReport = lib.buildLinksView({ appSlugs: [], connections: [conn({ appSlug: "a", remotes: initial, defaultBranch: "main" })], report: null });
  assert.equal(noReport.rows[0].remotesSource, "initial");
  assert.equal(noReport.rows[0].branch, "main");
  assert.deepEqual(noReport.rows[0].warnings, []);
  const withReport = lib.buildLinksView({ appSlugs: [], connections: [conn({ appSlug: "a", remotes: initial })], report: report({ apps: [{ folder: "a", isGit: true, branch: "dev", stack: "flutter", remotes: [] }] }) });
  assert.equal(withReport.rows[0].remotesSource, "report");
  assert.equal(withReport.rows[0].branch, "dev");
  assert.equal(withReport.rows[0].stack, "flutter");
  assert.deepEqual(withReport.rows[0].warnings.map((w) => w.kind), ["no-remote"]);
});

test("DB: 보고 저장은 새로 읽기 요청을 지우고, 새로 읽기는 한 번만 내려가고, 수정은 보낸 칸만 바꾼다", async () => {
  const db = fakeDb([conn({ appSlug: "a", domain: "keep.example.com", notes: "옛 메모" })], [{ appSlug: "a", stack: "nextjs" }, { appSlug: "b", stack: "flutter" }]);
  const dbl = loadDb(db);
  assert.equal(await dbl.consumeScan(), false);
  await dbl.requestScan();
  assert.equal(await dbl.consumeScan(1e15), false, "요청 시각이 너무 오래되면 버린다");
  await dbl.requestScan();
  assert.equal(await dbl.consumeScan(), true);
  assert.equal(await dbl.consumeScan(), false, "가져간 직후엔 다시 내리지 않는다");
  const parsed = lib.validateReport({ apps: [{ folder: "a", isGit: true, branch: "main", remotes: [{ name: "origin", url: "x:y/z.git" }] }] });
  await dbl.saveReport(parsed.report);
  assert.equal(db.settings.has("projectLinksScanRequest"), false, "보고를 받으면 요청이 끝난다");
  await dbl.updateConnection("a", { notes: "새 메모" });
  assert.equal(db.connections.get("a").domain, "keep.example.com");
  assert.equal(db.connections.get("a").notes, "새 메모");
  await dbl.updateConnection("c", { domain: "c.example.com" });
  assert.equal(db.connections.get("c").appSlug, "c");
  const view = await dbl.readLinksView();
  assert.deepEqual(view.rows.map((r) => r.appSlug), ["a", "b", "c"]);
  assert.equal(view.rows.find((r) => r.appSlug === "b").stack, "flutter", "종류는 일감에서 채운다");
  assert.equal(view.rows[0].remotes[0].host, "x");
});

test("감독 수집기: 진짜 임시 git 저장소의 원격·브랜치를 읽고, 제외 폴더·git 아닌 폴더를 구분하고, 자격 증명을 지운다", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plinks-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "ignore" });
  fs.mkdirSync(path.join(dir, "appa"));
  git(path.join(dir, "appa"), "init", "-q", "-b", "trunk");
  git(path.join(dir, "appa"), "remote", "add", "origin", "https://user:topsecret@github.com/o/r.git");
  git(path.join(dir, "appa"), "remote", "add", "prod", "serverpc2:git-server/repo/appa.git");
  fs.writeFileSync(path.join(dir, "appa", "pubspec.yaml"), "name: a\n");
  fs.mkdirSync(path.join(dir, "plain"));
  for (const skip of ["lab", "supervisor-src", "selfdev", "buyoungsil-dev-web", ".hidden"]) fs.mkdirSync(path.join(dir, skip, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, "afile.txt"), "x");
  const mod = await import(pathToFileURL(path.join(repo, "tools/factory-supervisor/projectlinks.mjs")).href);
  const apps = await mod.collectApps(dir);
  assert.deepEqual(apps.map((a) => a.folder), ["appa", "plain"]);
  assert.equal(apps[0].isGit, true);
  assert.equal(apps[0].branch, "trunk");
  assert.equal(apps[0].stack, "flutter");
  assert.deepEqual(apps[0].remotes.map((r) => r.name), ["origin", "prod"]);
  assert.ok(!JSON.stringify(apps).includes("topsecret"), "원격 주소의 비밀번호는 보내지 않는다");
  assert.equal(apps[1].isGit, false);
  assert.deepEqual(apps[1].remotes, []);
  // 모은 값이 서버 검사를 그대로 통과한다
  const v = lib.validateReport({ apps, servers: {} });
  assert.equal(v.ok, true);
  assert.deepEqual(v.report.apps[0].remotes.map((r) => r.purpose), ["github", "deploy"]);
});

test("감독 수집기: 서버 컨테이너는 ssh 로 docker ps --format 한 줄만 읽고, 못 읽으면 unknown. 보고는 홈페이지로 POST", async () => {
  const mod = await import(pathToFileURL(path.join(repo, "tools/factory-supervisor/projectlinks.mjs")).href);
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (file === "ssh") return args.includes("serverpc2") ? "web-1\nweb-db-1\n\n" : null;
    return null;
  };
  const servers = await mod.readContainers({ exec });
  assert.deepEqual(servers, { serverpc: { state: "unknown" }, serverpc2: { state: "ok", names: ["web-1", "web-db-1"] } });
  for (const c of calls) {
    assert.equal(c[0], "ssh");
    assert.ok(c.includes("BatchMode=yes"));
    assert.equal(c.at(-1), "docker ps --format '{{.Names}}'");
    assert.ok(["serverpc", "serverpc2"].includes(c.at(-2)));
  }
  const posts = [];
  const api = async (method, url, body) => (posts.push({ method, url, body }), { status: 200, data: { ok: true } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plinks2-"));
  try {
    const job = mod.startProjectLinksReport({ api, workDir: dir, exec, everyMs: 1e9 });
    assert.equal(await job.tick(), true);
    job.stop();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].method, "POST");
    assert.equal(posts[0].url, "/api/factory/project-links");
    assert.deepEqual(Object.keys(posts[0].body.servers), ["serverpc", "serverpc2"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // 읽기 전용 약속: 원격을 바꾸거나 컨테이너를 조작하는 명령은 수집기에 없다
  const src = read("tools/factory-supervisor/projectlinks.mjs").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(src, /remote["',\s]+(add|remove|rename|set-url)|docker (rm|stop|restart|kill|exec|compose)|nginx/);
});

test("배선: /next 새로 읽기 신호, 보고 주소(작업 PC 토큰), 관리자 주소, 커넥터 읽기 전용 도구, 통제실 표, 감독 프로그램", () => {
  const next = read("app/api/factory/next/route.ts");
  assert.match(next, /consumeProjectLinksScan\(\)\.catch\(\(\) => false\)/);
  assert.match(next, /\.\.\.\(projectLinksScan \? \{ projectLinksScan: true \} : \{\}\)/);
  assert.match(read("app/api/factory/project-links/route.ts"), /guardWorker\(req\)[\s\S]*validateReport/);
  const admin = read("app/api/admin/factory/project-links/route.ts");
  assert.equal((admin.match(/requireAdmin\(\)/g) ?? []).length, 2);
  const mcp = read("lib/factory/mcp.ts");
  const tool = mcp.slice(mcp.indexOf('name: "get_project_links"'), mcp.indexOf('name: "enqueue_release_job"'));
  assert.match(tool, /annotations: READ_ONLY/);
  assert.match(mcp, /case "get_project_links":\s+return getProjectLinks\(args\)/);
  const ui = read("components/admin/factory/ProjectConnections.tsx");
  assert.match(ui, /data-link-warning/);
  assert.match(ui, /새로 읽기/);
  assert.match(read("components/admin/factory/FactoryConsole.tsx"), /<ProjectConnections \/>/);
  assert.doesNotMatch(ui, /from "@\/lib\/prisma|projectLinksDb/, "화면은 서버 전용 모듈을 가져오지 않는다");
  const sup = read("tools/factory-supervisor/supervisor.mjs");
  assert.match(sup, /startProjectLinksReport\(\{ api, log, workDir: \(\) => cfg\.workDir \}\)/);
  assert.match(sup, /r\.data\?\.projectLinksScan === true\) projectLinks\?\.request\(\)/);
  const migration = read("prisma/migrations/20261113090000_app_connections/migration.sql");
  assert.match(migration, /CREATE TABLE "factory_app_connections"/);
  assert.doesNotMatch(migration, /b(DELETE|DROP|TRUNCATE|UPDATE|ALTER)b/i, "기존 데이터를 지우거나 고치지 않는다");
  assert.equal((migration.match(/ON CONFLICT \("appSlug"\) DO NOTHING/g) ?? []).length, 13);
});
