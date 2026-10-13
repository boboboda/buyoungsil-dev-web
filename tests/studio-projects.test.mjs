// 통제실 [스튜디오] 탭 시험: lib/factory/studioProjects.ts(검증·정렬·앱 목록) + StudioWorkbench(그림). 가짜 데이터, API·DB 없음.
// 실행: npm run test:studio-projects
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const mask = loadTs("lib/factory/mask.ts");
const toolkit = loadTs("lib/factory/toolkit.ts", { "@/lib/factory/mask": mask });
const lib = loadTs("lib/factory/studioProjects.ts", { "@/lib/factory/toolkit": toolkit });
const { default: Workbench } = loadTs("components/admin/factory/StudioWorkbench.tsx", { "@/lib/factory/toolkit": toolkit, "@/lib/factory/studioProjects": lib });

const reported = new Set(["pixel-generate", "pixel-anim", "env-doctor"]);
const known = new Set(["saessak-hub", "memo-app"]);
const apply = (cur, body) => lib.applyStudioPatch(cur, body, known, reported);

test("탭 주소·키 이름", () => {
  assert.equal(lib.STUDIO_PROJECTS_KEY, "studioProjects");
  assert.ok(read("components/admin/factory/consoleTabs.ts").includes('{ key: "studio", label: "스튜디오" }'));
});

test("종류 지정: 자동 분류 없음, 처음엔 kind 필수", () => {
  assert.equal(apply({}, { appSlug: "saessak-hub", tools: [] }).ok, false);
  const r = apply({}, { appSlug: "saessak-hub", kind: "game" });
  assert.ok(r.ok);
  assert.deepEqual(r.projects, { "saessak-hub": { kind: "game", tools: [] } });
  assert.equal(apply({}, { appSlug: "saessak-hub", kind: "movie" }).ok, false);
  assert.equal(apply({}, { appSlug: "nope-app", kind: "app" }).ok, false, "모르는 앱");
  assert.equal(apply({}, { appSlug: "Bad Slug", kind: "app" }).ok, false, "appSlug 형식");
});

test("도구: 보고된 목록 안에서만, manual 금지, 중복 제거, 다른 칸 유지", () => {
  const base = apply({}, { appSlug: "memo-app", kind: "app" }).projects;
  const ok = apply(base, { appSlug: "memo-app", tools: ["pixel-anim", "pixel-anim", "env-doctor"] });
  assert.ok(ok.ok);
  assert.deepEqual(ok.projects["memo-app"].tools, ["pixel-anim", "env-doctor"]);
  assert.equal(apply(base, { appSlug: "memo-app", tools: ["not-reported"] }).ok, false);
  assert.equal(apply(base, { appSlug: "memo-app", tools: ["setup-runtime"] }).ok, false);
  assert.equal(apply(base, { appSlug: "memo-app", tools: "pixel-anim" }).ok, false);
  assert.equal(lib.applyStudioPatch(base, { appSlug: "memo-app", tools: ["setup-runtime"] }, known, new Set(["setup-runtime"])).ok, false);
  const withUrl = apply(ok.projects, { appSlug: "memo-app", studioUrl: "https://example.com/studio/" });
  assert.equal(withUrl.projects["memo-app"].studioUrl, "https://example.com/studio/");
  assert.deepEqual(withUrl.projects["memo-app"].tools, ["pixel-anim", "env-doctor"], "주소만 바꿔도 도구 유지");
  assert.equal(apply(withUrl.projects, { appSlug: "memo-app", studioUrl: null }).projects["memo-app"].studioUrl, undefined);
});

test("studioUrl: https 만, 길이 제한, 아이디·비밀번호·공백 금지", () => {
  for (const bad of ["http://example.com", "javascript:alert(1)", "https://u:p@example.com", "https://exa mple.com", "ftp://x.com", "//x.com", "https://" + "a".repeat(200) + ".com", 5]) assert.equal(lib.cleanStudioUrl(bad), null, String(bad));
  assert.equal(lib.cleanStudioUrl("https://hub.example.com/studio"), "https://hub.example.com/studio");
});

test("저장값 읽기: 깨진 항목 버림", () => {
  const raw = JSON.stringify({ "saessak-hub": { kind: "game", tools: ["pixel-anim", "BAD ID", 3], studioUrl: "http://x.com" }, "x": { kind: "game" }, "memo-app": { kind: "zzz" }, "ok-app": { kind: "app", templateId: "tpl-1" } });
  assert.deepEqual(lib.readStudioProjects(raw), { "saessak-hub": { kind: "game", tools: ["pixel-anim"] }, "ok-app": { kind: "app", tools: [], templateId: "tpl-1" } });
  assert.deepEqual(lib.readStudioProjects("not json"), {});
  assert.deepEqual(lib.readStudioProjects(null), {});
});

test("도구 정렬: 게임은 game/common 먼저, 앱은 cut/common 먼저, 모두 남김", () => {
  const rows = ["unclassified", "cut", "game", "common"].map((purpose) => ({ id: purpose, purpose }));
  assert.deepEqual(lib.orderToolsFor("game", rows).map((r) => r.id), ["game", "common", "unclassified", "cut"]);
  assert.deepEqual(lib.orderToolsFor("app", rows).map((r) => r.id), ["cut", "common", "unclassified", "game"]);
});

test("앱 목록: 앱마다 최근 일감 한 건, 완료된 앱이 먼저", () => {
  const jobs = [
    { appSlug: "a-app", title: "A", stack: "flutter", status: "running", finishedAt: null },
    { appSlug: "b-app", title: "B", stack: "flutter", status: "done", finishedAt: "2026-10-12T01:02:03Z" },
    { appSlug: "a-app", title: "A", stack: "flutter", status: "done", finishedAt: "2026-10-10T00:00:00Z" },
  ];
  const apps = lib.buildStudioApps(jobs);
  assert.deepEqual(apps.map((a) => [a.appSlug, a.status, a.done]), [["a-app", "running", true], ["b-app", "done", true]]);
});

test("화면: 서브탭·미분류·카드·manual 체크 불가·주소 링크는 설정됐을 때만", () => {
  const tools = [
    { id: "pixel-anim", desc: "움짤", purpose: "cut", purposeSource: "guess", enabled: true },
    { id: "pixel-generate", desc: "도트", purpose: "game", purposeSource: "saved", enabled: true },
    { id: "setup-runtime", desc: "런타임 설치", purpose: "common", purposeSource: "guess", enabled: true },
  ];
  const apps = [
    { appSlug: "saessak-hub", title: "새싹 허브", stack: "flutter", status: "done", finishedAt: "2026-10-12T01:02:03Z", done: true },
    { appSlug: "memo-app", title: "메모", stack: "flutter", status: "running", finishedAt: null, done: false },
  ];
  const out = renderToStaticMarkup(h(Workbench, { apps, tools, toolsReported: true, initial: { "saessak-hub": { kind: "game", tools: ["pixel-generate"], studioUrl: "https://hub.example.com/s" } } }));
  assert.match(out, /data-studio-tab="game"[^>]*>게임 스튜디오 \(1\)/);
  assert.match(out, /data-studio-tab="app"[^>]*>앱 스튜디오 \(0\)/);
  assert.match(out, /미분류 \(1\)/);
  assert.match(out, /data-studio-project="memo-app"/);
  assert.match(out, /왼쪽에서 프로젝트를 고르세요/);
  assert.doesNotMatch(out, /data-studio-open/, "프로젝트를 고르기 전엔 카드·링크 없음");
});

test("화면: 프로젝트를 고른 상태 — 게임은 game/common 먼저, setup-runtime 체크 불가, 주소 링크", () => {
  const tools = [
    { id: "pixel-anim", desc: "움짤", purpose: "cut", purposeSource: "guess", enabled: true },
    { id: "pixel-generate", desc: "도트", purpose: "game", purposeSource: "saved", enabled: true },
    { id: "setup-runtime", desc: "런타임 설치", purpose: "common", purposeSource: "guess", enabled: true },
  ];
  const apps = [{ appSlug: "saessak-hub", title: "새싹 허브", stack: "flutter", status: "done", finishedAt: "2026-10-12T01:02:03Z", done: true }];
  const initial = { "saessak-hub": { kind: "game", tools: ["pixel-generate"], studioUrl: "https://hub.example.com/s" } };
  const game = renderToStaticMarkup(h(Workbench, { apps, tools, toolsReported: true, initial, initialPicked: "saessak-hub" }));
  assert.ok(game.indexOf('data-studio-tool="pixel-generate"') < game.indexOf('data-studio-tool="setup-runtime"'));
  assert.ok(game.indexOf('data-studio-tool="setup-runtime"') < game.indexOf('data-studio-tool="pixel-anim"'), "게임: game·common 다음에 cut");
  assert.match(game, /<a class="underline" data-studio-open="true" href="https:\/\/hub\.example\.com\/s" rel="noopener noreferrer" target="_blank">/);
  assert.match(game, /<input class="mt-1" disabled="" type="checkbox"\/>.*?setup-runtime<\/span><span class="fx-muted"> · 공용\(추정\) · 직접 해야 하는 도구라 연결 불가/, "setup-runtime 은 체크 불가");
  assert.match(game, /data-studio-tool="pixel-generate"><label[^>]*><input class="mt-1" type="checkbox" checked=""/, "저장된 도구는 체크됨");
  assert.match(game, /완료 시각 2026-10-12 01:02\(UTC\)/);
  const app = renderToStaticMarkup(h(Workbench, { apps, tools, toolsReported: true, initial: { "saessak-hub": { kind: "app", tools: [] } }, initialStudio: "app", initialPicked: "saessak-hub" }));
  assert.ok(app.indexOf('data-studio-tool="pixel-anim"') < app.indexOf('data-studio-tool="pixel-generate"'), "앱: cut 먼저");
  assert.doesNotMatch(app, /data-studio-open/, "주소를 안 정했으면 링크 없음");
  const none = renderToStaticMarkup(h(Workbench, { apps, tools, toolsReported: true, initial: {}, initialPicked: "saessak-hub" }));
  assert.match(none, /종류를 정하면 도구를 연결할 수 있어요/);
  assert.doesNotMatch(none, /data-studio-tool=/);
});
