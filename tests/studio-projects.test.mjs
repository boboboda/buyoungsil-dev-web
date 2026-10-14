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
const roles = loadTs("lib/factory/appRoles.ts");
const lib = loadTs("lib/factory/studioProjects.ts", { "@/lib/factory/toolkit": toolkit, "@/lib/factory/appRoles": roles });
const { default: Workbench } = loadTs("components/admin/factory/StudioWorkbench.tsx", { "@/lib/factory/toolkit": toolkit, "@/lib/factory/studioProjects": lib, "./ProjectToolSettingsCard": { __esModule: true, default: () => null }, "./CardsPanel": { __esModule: true, default: () => null }, "./StudioArtsCard": { __esModule: true, default: () => null }, "./AppQueue": { __esModule: true, default: () => null } }); // 도구 설정 카드는 tests/project-tool-settings.test.mjs 에서 따로 시험

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
  assert.match(game, /<a class="rounded border border-default-300 px-3 py-1 font-semibold" data-studio-open="true" href="https:\/\/hub\.example\.com\/s" rel="noopener noreferrer" target="_blank">\[스튜디오 열기\] ↗<\/a>/);
  assert.ok(game.indexOf("data-studio-open") < game.indexOf("data-studio-tools"), "[스튜디오 열기]는 상세 맨 위");
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

test("일감 보내기 카드: 저장된 연결 도구만 고르고, 종류 3가지·메모·버튼·최근 일감 링크가 보인다", () => {
  const apps = [{ appSlug: "saessak-hub", title: "새싹 허브", stack: "flutter", status: "done", finishedAt: null, done: true }];
  const tools = [
    { id: "pixel-generate", desc: "", purpose: "game", purposeSource: "saved", enabled: true },
    { id: "pixel-anim", desc: "", purpose: "cut", purposeSource: "saved", enabled: true },
    { id: "setup-runtime", desc: "", purpose: "common", purposeSource: "guess", enabled: true },
  ];
  const initial = { "saessak-hub": { kind: "game", tools: ["pixel-generate", "setup-runtime"] } };
  const recent = { "saessak-hub": [{ id: "j9", title: "새싹 허브 (Studio: 배치 적용)", status: "pending", createdAt: "2026-10-13T14:20:00.000Z" }] };
  const out = renderToStaticMarkup(h(Workbench, { apps, tools, toolsReported: true, initial, recent, initialPicked: "saessak-hub" }));
  assert.match(out, /data-studio-send/);
  assert.match(out, /<option value="pixel-generate"/);
  assert.doesNotMatch(out, /<option value="pixel-anim"/, "연결 안 한 도구는 고를 수 없다");
  assert.doesNotMatch(out, /<option value="setup-runtime"/, "manual 도구는 고를 수 없다");
  for (const k of ["regen", "layout", "free"]) assert.ok(out.includes('data-send-kind="' + k + '"'), k);
  assert.match(out, /data-send-submit/);
  assert.match(out, /data-send-submit="true" disabled=""/);
  assert.ok(out.includes("/admin/factory?tab=jobs&amp;job=j9"));
  const none = renderToStaticMarkup(h(Workbench, { apps, tools, toolsReported: true, initial: { "saessak-hub": { kind: "game", tools: [] } }, initialPicked: "saessak-hub" }));
  assert.match(none, /연결된 도구가 없어요/);
  assert.doesNotMatch(none, /data-send-submit/);
});

test("앱 역할: 값 없음 → product, game-toolkit·app-kit 기본 tool, 저장값이 기본값을 이김", () => {
  assert.equal(roles.APP_ROLE_LABELS.product, "제품");
  assert.equal(roles.APP_ROLE_LABELS.tool, "도구·플랫폼");
  assert.equal(roles.resolveAppRole({}, "saessak-hub"), "product");
  assert.equal(roles.resolveAppRole({}, "game-toolkit"), "tool");
  assert.equal(roles.resolveAppRole({}, "app-kit"), "tool");
  assert.equal(roles.resolveAppRole({ "game-toolkit": "product" }, "game-toolkit"), "product");
  assert.equal(roles.resolveAppRole({ "saessak-hub": "tool" }, "saessak-hub"), "tool");
  assert.deepEqual(roles.readAppRoles(JSON.stringify({ "app-kit": "product", "memo-app": "tool", bad: "x", "ok-app": "owner", "BAD SLUG": "tool" })), { "app-kit": "product", "memo-app": "tool" });
  assert.deepEqual(roles.readAppRoles("{깨짐"), {});
  assert.deepEqual(roles.readAppRoles(null), {});
});

test("앱 역할 저장: 잘못된 값·모르는 앱 거절, 저장 가능", () => {
  const k = new Set(["saessak-hub"]);

  assert.equal(roles.applyAppRolePatch({}, { appSlug: "saessak-hub", role: "owner" }, k).ok, false);
  assert.equal(roles.applyAppRolePatch({}, { appSlug: "saessak-hub" }, k).ok, false);
  assert.equal(roles.applyAppRolePatch({}, { appSlug: "BAD", role: "tool" }, k).ok, false);
  assert.equal(roles.applyAppRolePatch({}, { appSlug: "no-such-app", role: "tool" }, k).ok, false);
  assert.equal(roles.applyAppRolePatch({}, null, k).ok, false);
  const r = roles.applyAppRolePatch({}, { appSlug: "saessak-hub", role: "tool" }, k);

  assert.ok(r.ok);
  assert.deepEqual(r.roles, { "saessak-hub": "tool" });
  assert.ok(roles.applyAppRolePatch({}, { appSlug: "game-toolkit", role: "product" }, k).ok, "일감이 없어도 기본 목록 앱은 정할 수 있다");
});

test("스튜디오 목록 필터: 제품만 프로젝트 목록, tool 은 접힌 구역에 이름만, 저장값은 그대로", () => {
  const all = ["saessak-hub", "game-toolkit", "app-kit", "memo-app"].map((appSlug) => ({ appSlug, title: appSlug, stack: "", status: "done", finishedAt: null, done: true }));
  const { products, toolApps } = lib.splitStudioApps(all, {});

  assert.deepEqual(products.map((a) => a.appSlug), ["saessak-hub", "memo-app"]);
  assert.deepEqual(toolApps.map((a) => a.appSlug), ["game-toolkit", "app-kit"]);
  const moved = lib.splitStudioApps(all, { "game-toolkit": "product", "memo-app": "tool" });

  assert.deepEqual(moved.products.map((a) => a.appSlug), ["saessak-hub", "game-toolkit"]);
  const tools = [{ id: "pixel-generate", desc: "", purpose: "game", purposeSource: "saved", enabled: true }];
  // tool 앱에 예전 studioProjects 값이 있어도 읽히고(지우지 않음), 프로젝트 목록·미분류에는 나오지 않는다
  const initial = { "saessak-hub": { kind: "game", tools: [] }, "game-toolkit": { kind: "game", tools: ["pixel-generate"] } };

  assert.ok(lib.readStudioProjects(JSON.stringify(initial))["game-toolkit"]);
  const out = renderToStaticMarkup(h(Workbench, { apps: products, toolApps, tools, toolsReported: true, initial, initialPicked: "saessak-hub" }));

  assert.match(out, /data-studio-tool-apps/);
  assert.ok(out.includes("도구·플랫폼 (2)"));
  assert.equal((out.match(/data-studio-project="game-toolkit"/g) ?? []).length, 0);
  assert.match(out, /data-studio-project="saessak-hub"/);
  assert.match(out, /data-studio-project="memo-app"/);
  const none = renderToStaticMarkup(h(Workbench, { apps: products, tools, toolsReported: true, initial: {} }));

  assert.doesNotMatch(none, /data-studio-tool-apps/);
});

test("새 툴킷 구조: 스튜디오 도구(pixel-art)만 고르고, 예전에 연결한 내부 도구 이름은 깨지지 않게 남는다", () => {
  const rows = [
    { id: "pixel-art", layer: "studio" },
    { id: "pixel-generate", layer: "internal" },
    { id: "pixel-anim", layer: "internal" },
  ];
  assert.deepEqual([...toolkit.allowedStudioToolIds(rows, [])].sort(), ["pixel-art"], "새로 연결·일감 보내기 허용은 pixel-art 뿐");
  assert.deepEqual([...toolkit.allowedStudioToolIds(rows, ["pixel-generate", "gone-tool"])].sort(), ["pixel-art", "pixel-generate"], "이미 연결된 내부 이름은 읽기 호환");
  const old = [{ id: "a", layer: "" }, { id: "b", layer: "" }];
  assert.deepEqual([...toolkit.allowedStudioToolIds(old, [])].sort(), ["a", "b"], "layer 구분 없는 옛 툴킷은 전부");

  // 저장: 새로 내부 도구를 고르면 거절, 이미 연결된 내부 도구를 유지한 채 pixel-art 를 더하는 건 허용
  const cur = { "memo-app": { kind: "app", tools: ["pixel-generate"] } };
  assert.equal(lib.applyStudioPatch(cur, { appSlug: "memo-app", tools: ["pixel-generate", "pixel-art"] }, known, toolkit.allowedStudioToolIds(rows, cur["memo-app"].tools)).ok, true);
  assert.equal(lib.applyStudioPatch(cur, { appSlug: "memo-app", tools: ["pixel-anim"] }, known, toolkit.allowedStudioToolIds(rows, cur["memo-app"].tools)).ok, false, "새 내부 도구는 거절");

  const tools = [
    { id: "pixel-art", desc: "도트 이미지 생성", purpose: "common", purposeSource: "guess", enabled: true, layer: "studio", kinds: [{ id: "image-prop", label: "소품·캐릭터 한 장", output: "", background: "transparent", defaultMethod: "codex", methods: ["codex", "pixellab"] }] },
    ...rows.slice(1).map((r) => ({ id: r.id, desc: "", purpose: "game", purposeSource: "guess", enabled: true, layer: "internal" })),
  ];
  const apps = [{ appSlug: "memo-app", title: "메모", stack: "flutter", status: "done", finishedAt: null, done: true }];
  const html = renderToStaticMarkup(h(Workbench, { apps, tools, toolsReported: true, initial: { "memo-app": { kind: "app", tools: ["pixel-generate"] } }, initialStudio: "app", initialPicked: "memo-app" }));
  assert.match(html, /data-studio-tool="pixel-art"/);
  assert.match(html, /소품·캐릭터 한 장: codex\(기본\)·pixellab/, "결과 종류와 기본 방식");
  assert.match(html, /data-studio-legacy-tools/, "연결돼 있던 내부 도구는 따로 남는다");
  assert.match(html, /data-studio-tool="pixel-generate"/);
  assert.equal(html.includes('data-studio-tool="pixel-anim"'), false, "연결 안 된 내부 도구는 고르는 목록에 없다");
  // 일감 보내기: 연결돼 있던 내부 이름도 깨지지 않고 고를 수 있다
  assert.match(html, /<option[^>]*value="pixel-generate"/);
});

test("미분류(none): 주소만 먼저 적어도 만들어지고, 도구는 게임·앱으로 분류해야 연결된다, 되돌릴 수 있다", () => {
  assert.equal(lib.STUDIO_KIND_LABELS.none, "미분류");
  const urlOnly = apply({}, { appSlug: "memo-app", studioUrl: "https://example.com/s/" });
  assert.ok(urlOnly.ok);
  assert.deepEqual(urlOnly.projects["memo-app"], { kind: "none", tools: [], studioUrl: "https://example.com/s/" });
  assert.equal(apply({}, { appSlug: "memo-app", tools: ["pixel-anim"] }).ok, false, "도구는 종류 없이 못 연결");
  const none = apply({}, { appSlug: "memo-app", kind: "none" });
  assert.deepEqual(none.projects["memo-app"], { kind: "none", tools: [] });
  const game = apply(none.projects, { appSlug: "memo-app", kind: "game", tools: ["pixel-anim"] });
  assert.equal(game.projects["memo-app"].kind, "game");
  const back = apply(game.projects, { appSlug: "memo-app", kind: "none" });
  assert.equal(back.projects["memo-app"].kind, "none");
  assert.deepEqual(back.projects["memo-app"].tools, ["pixel-anim"], "미분류로 옮겨도 연결해 둔 도구·주소는 지우지 않는다");
  assert.equal(apply({}, { appSlug: "memo-app", kind: "movie" }).ok, false);
  assert.deepEqual(lib.readStudioProjects(JSON.stringify({ "memo-app": { kind: "none", tools: [] } })), { "memo-app": { kind: "none", tools: [] } });
  assert.deepEqual(lib.orderToolsFor("none", [{ purpose: "game" }, { purpose: "common" }]).map((r) => r.purpose), ["common", "game"]);
});

test("바로가기 목록: 이름+https 주소 여러 개, 중복·잘못된 항목 거절, null 로 비움, 저장값 읽기에서 이상한 항목은 버림", () => {
  const links = [{ name: "게임 Studio", url: "https://studio.example.com/p/hub/studio/" }, { name: " 관리자  페이지 ", url: "https://hancut.example.com/admin" }];
  const ok = apply({}, { appSlug: "memo-app", kind: "app", links });
  assert.ok(ok.ok);
  assert.deepEqual(ok.projects["memo-app"].links.map((l) => l.name), ["게임 Studio", "관리자 페이지"], "이름 공백 정리");
  assert.equal(apply(ok.projects, { appSlug: "memo-app", tools: [] }).projects["memo-app"].links.length, 2, "다른 칸만 바꿔도 바로가기 유지");
  assert.equal(apply({}, { appSlug: "memo-app", kind: "app", links: [{ name: "x", url: "http://insecure.example.com" }] }).ok, false, "https 만");
  assert.equal(apply({}, { appSlug: "memo-app", kind: "app", links: [{ name: "", url: "https://a.example.com" }] }).ok, false, "이름 필수");
  assert.equal(apply({}, { appSlug: "memo-app", kind: "app", links: [{ name: "a", url: "https://a.example.com" }, { name: "b", url: "https://a.example.com" }] }).ok, false, "같은 주소 중복");
  assert.equal(apply({}, { appSlug: "memo-app", kind: "app", links: Array.from({ length: 9 }, (_, i) => ({ name: "n" + i, url: `https://a${i}.example.com` })) }).ok, false, "최대 8개");
  assert.equal(apply({}, { appSlug: "memo-app", kind: "app", links: "x" }).ok, false);
  assert.equal(apply(ok.projects, { appSlug: "memo-app", links: null }).projects["memo-app"].links, undefined);
  assert.equal(apply(ok.projects, { appSlug: "memo-app", links: [] }).projects["memo-app"].links, undefined, "빈 목록도 비움");
  const raw = JSON.stringify({ "memo-app": { kind: "app", tools: [], links: [{ name: "ok", url: "https://a.example.com" }, { name: "bad", url: "javascript:1" }, 5, { url: "https://b.example.com" }] } });
  assert.deepEqual(lib.readStudioProjects(raw)["memo-app"].links, [{ name: "ok", url: "https://a.example.com/" }]);
});

test("기본 바로가기: 새싹 허브는 확인한 Studio 주소, 하찮은 한 컷은 관리자·앱 서버 주소. 저장값이 있으면 건드리지 않는다", () => {
  const d = lib.DEFAULT_STUDIO_SHORTCUTS;
  assert.equal(d["saessak-hub"].studioUrl, "https://studio.buyoungsilcoding.com/p/hub/studio/");
  assert.deepEqual(d["one-tiny-frame"].links.map((l) => l.url), ["https://hancut.buyoungsilcoding.com/admin", "https://hancut.buyoungsilcoding.com/today"]);
  for (const v of Object.values(d)) for (const u of [v.studioUrl, ...(v.links ?? []).map((l) => l.url)].filter(Boolean)) assert.equal(lib.cleanStudioUrl(u), u, u);
  const merged = lib.withDefaultShortcuts({}, ["saessak-hub", "one-tiny-frame", "memo-app"]);
  assert.deepEqual(Object.keys(merged).sort(), ["one-tiny-frame", "saessak-hub"]);
  assert.equal(merged["saessak-hub"].kind, "none", "설정이 없으면 미분류로 보인다");
  const kept = lib.withDefaultShortcuts({ "saessak-hub": { kind: "game", tools: ["pixel-art"], studioUrl: "https://mine.example.com/" }, "one-tiny-frame": { kind: "app", tools: [], links: [] } }, ["saessak-hub", "one-tiny-frame"]);
  assert.equal(kept["saessak-hub"].studioUrl, "https://mine.example.com/");
  assert.equal(kept["saessak-hub"].kind, "game");
  assert.deepEqual(kept["one-tiny-frame"].links, [], "관리자가 비운 바로가기(빈 목록)는 그대로");
});

test("화면: 맨 위 [스튜디오 열기]·바로가기 링크, 주소가 없으면 맨 위에서 바로 입력, 목록 카드 아이콘, 미분류 묶음·[미분류] 버튼", () => {
  const apps = [
    { appSlug: "saessak-hub", title: "새싹 허브", stack: "flutter", status: "done", finishedAt: null, done: true },
    { appSlug: "memo-app", title: "메모", stack: "flutter", status: "done", finishedAt: null, done: true },
    { appSlug: "free-app", title: "자유", stack: "flutter", status: "done", finishedAt: null, done: true },
  ];
  const initial = {
    "saessak-hub": { kind: "game", tools: [], studioUrl: "https://hub.example.com/s", links: [{ name: "관리자", url: "https://hub.example.com/admin" }] },
    "memo-app": { kind: "none", tools: [] },
  };
  const hub = renderToStaticMarkup(h(Workbench, { apps, tools: [], toolsReported: true, initial, initialPicked: "saessak-hub" }));
  assert.match(hub, /data-studio-shortcut="saessak-hub"[^>]*>\s*↗/);
  assert.ok(!/data-studio-shortcut="memo-app"/.test(hub), "주소 없는 프로젝트는 아이콘 없음");
  assert.match(hub, /data-studio-link="true" href="https:\/\/hub\.example\.com\/admin"[^>]*>관리자 ↗/);
  assert.match(hub, /data-studio-links-edit/);
  assert.match(hub, /data-link-add/);
  assert.match(hub, /미분류 \(2\)/, "저장값 없음(free-app) + 미분류로 정한 것(memo-app)");
  assert.ok(!/data-studio-quick-url/.test(hub), "주소가 있으면 빠른 입력 칸 없음");
  assert.match(hub, /data-studio-kind="game"[^>]*>게임/);
  for (const k of ["game", "app", "none"]) assert.ok(hub.includes(`data-classify="${k}"`), k);
  assert.match(hub, /data-classify="none"[^>]*>\[미분류\]/);
  assert.match(hub, /data-classify="game"[^>]*disabled=""/, "현재 분류 버튼은 꺼짐");
  assert.match(hub, /제품 \/ 도구·플랫폼/, "분류와 앱 역할을 구분하는 안내");
  const memo = renderToStaticMarkup(h(Workbench, { apps, tools: [], toolsReported: true, initial, initialPicked: "memo-app" }));
  assert.match(memo, /data-studio-quick-url/, "주소가 없으면 맨 위에서 바로 입력");
  assert.match(memo, /data-quick-url-save/);
  assert.ok(!/data-studio-open/.test(memo));
  assert.match(memo, /data-studio-kind="none"[^>]*>미분류/);
  assert.match(memo, /종류를 정하면 도구를 연결할 수 있어요/, "미분류는 도구 연결·일감 보내기 없음");
  assert.ok(!/data-studio-send/.test(memo) && !/data-studio-tools/.test(memo));
  assert.match(memo, /data-studio-url/, "미분류에도 주소·바로가기 편집은 된다");
  const free = renderToStaticMarkup(h(Workbench, { apps, tools: [], toolsReported: true, initial, initialPicked: "free-app" }));
  assert.match(free, /data-studio-kind="none"[^>]*>미분류/, "저장값이 없는 프로젝트도 미분류");
  assert.match(free, /data-studio-quick-url/);
  // 저장 본문: 분류가 게임·앱이면 도구도, 아니면 주소·바로가기만
  assert.match(read("components/admin/factory/StudioWorkbench.tsx"), /\.\.\.\(classified \? \{ tools: draftTools \} : \{\}\)/);
});
