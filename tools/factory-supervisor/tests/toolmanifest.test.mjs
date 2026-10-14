// 도구 설명서(toolmanifest.mjs) 시험: 설명서 파일 읽기, 최소 설명서(fallback), 툴킷 커밋, 보고(시작·커밋 바뀜·실패 재시도),
// 방법 → 필요한 키(설명서 + optionalSecrets 를 합친 한 곳), 도구 중계가 설명서의 키를 쓰는 것. 진짜 서버·키는 쓰지 않는다.
// 실행: node tools/factory-supervisor/tests/toolmanifest.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { brokerSettings, createBroker, neededOptionalSecrets, toolkitSecretNames } from "../toolbroker.mjs";
import {
  collectManifests,
  fallbackManifest,
  loadManifestIndex,
  manifestSecretNames,
  manifestSignature,
  OPTIONAL_SECRET_METHODS,
  readManifestFiles,
  secretsForMethod,
  startManifestReport,
  toolkitCommit,
} from "../toolmanifest.mjs";

const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0;
const hasGit = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const SECRET = "supersecretvalue-FOO-456";

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-manifest-test-"));
  t.after(() => {
    assert.ok(path.basename(dir).startsWith("factory-manifest-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
const manifest = (name, extra = {}) => ({
  $schema: "../../schemas/tool-manifest.schema.json",
  name,
  label: `${name} 라벨`,
  description: "설명",
  layer: "studio",
  version: 1,
  methods: [
    { id: "alpha", label: "알파", secrets: [], network: false, limits: { timeoutSec: 60 } },
    { id: "foo", label: "푸", secrets: ["FOO_KEY"], network: true, limits: { size: { max: 128 } } },
  ],
  inputs: [{ name: "method", type: "string", required: false, description: "방법" }],
  outputs: { formats: ["PNG"], resultFile: "result.json", resultFields: ["method"] },
  proposals: [{ id: "p", status: "proposal", summary: "메모" }],
  ...extra,
});
function toolkit(dir, { tools, manifests = {}, raw = {} }) {
  const kit = path.join(dir, "game-toolkit");
  fs.mkdirSync(path.join(kit, "tools", "manifests"), { recursive: true });
  fs.writeFileSync(path.join(kit, "tools.json"), JSON.stringify({ version: 1, tools }));
  fs.writeFileSync(path.join(kit, "cli.py"), CLI);
  for (const [name, m] of Object.entries(manifests)) fs.writeFileSync(path.join(kit, "tools", "manifests", `${name}.json`), JSON.stringify(m));
  for (const [file, text] of Object.entries(raw)) fs.writeFileSync(path.join(kit, "tools", "manifests", file), text);
  return kit;
}
const TOOLS = {
  "pixel-art": { entry: "cli.py", layer: "studio", description: "스튜디오", args: [{ name: "method", type: "string" }, { name: "output_dir", type: "path", required: true }], network: true, secrets: [], optionalSecrets: ["PIXELLAB_TOKEN"], timeoutSec: 30 },
  "pixel-slice": { entry: "cli.py", layer: "internal", description: "자르기", args: [{ name: "input", type: "path", required: true }], secrets: [], timeoutSec: 20 },
  "other-tool": { entry: "cli.py", description: "다른", args: [], secrets: ["MUST_KEY"], timeoutSec: 20 },
};
const CLI = `
const fs = require("node:fs"), path = require("node:path");
const [cmd, ...args] = process.argv.slice(2);
const get = (k) => args.find((a) => a.startsWith("--" + k + "="))?.slice(k.length + 3);
console.log("cmd=" + cmd + " method=" + get("method") + " foo=" + process.env.FOO_KEY + " pix=" + process.env.PIXELLAB_TOKEN);
const out = get("output_dir");
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, "a.txt"), "x"); }
`;

test("설명서 파일 읽기: 이름이 파일과 같은 것만, 제안 메모와 $schema 는 버리고 source=file", (t) => {
  const kit = toolkit(tmp(t), {
    tools: TOOLS,
    manifests: { "pixel-art": manifest("pixel-art"), "wrong-name": manifest("other") },
    raw: { "broken.json": "{ 깨짐", "no-methods.json": JSON.stringify({ name: "no-methods", methods: [] }), "readme.txt": "무시" },
  });
  const r = readManifestFiles(kit);
  assert.deepEqual(Object.keys(r.manifests), ["pixel-art"]);
  const m = r.manifests["pixel-art"];
  assert.equal(m.source, "file");
  assert.ok(!("proposals" in m) && !("$schema" in m));
  assert.equal(r.skipped.length, 3, r.skipped.join(" | "));
  assert.deepEqual(readManifestFiles(path.join(kit, "없는폴더")), { manifests: {}, skipped: [] });
  assert.deepEqual(readManifestFiles(""), { manifests: {}, skipped: [] });
});

test("최소 설명서: tools.json 정보로 만든다(필수 키는 기본 방법, 선택 키는 가리키는 방법)", () => {
  const m = fallbackManifest("pixel-art", TOOLS["pixel-art"]);
  assert.equal(m.source, "fallback");
  assert.deepEqual(m.methods.map((x) => [x.id, x.secrets]), [["default", []], ["pixellab", ["PIXELLAB_TOKEN"]]]);
  assert.equal(m.methods[0].limits.timeoutSec, 30);
  assert.deepEqual(m.inputs.map((i) => [i.name, i.required]), [["method", false], ["output_dir", true]]);
  const must = fallbackManifest("other-tool", TOOLS["other-tool"]);
  assert.deepEqual(must.methods[0].secrets, ["MUST_KEY"]);
  const odd = fallbackManifest("x", { optionalSecrets: ["UNKNOWN_KEY", "lower"], secrets: ["bad key"] });
  assert.deepEqual(odd.methods.map((x) => [x.id, x.secrets]), [["default", []], ["optional", ["UNKNOWN_KEY"]]]);
});

test("수집: 설명서 파일이 있는 도구는 파일 그대로, 없는 도구는 최소 설명서(스튜디오가 먼저)", (t) => {
  const kit = toolkit(tmp(t), { tools: TOOLS, manifests: { "pixel-art": manifest("pixel-art") } });
  const r = collectManifests(kit);
  assert.deepEqual(r.tools.map((x) => [x.name, x.source]), [["pixel-art", "file"], ["pixel-slice", "fallback"], ["other-tool", "fallback"]]);
  // 설명서 파일이 없는 툴킷(옛 툴킷)도 도구함 정보로 전부 보낸다
  const old = collectManifests(toolkit(tmp(t), { tools: TOOLS }));
  assert.deepEqual(old.tools.map((x) => x.source), ["fallback", "fallback", "fallback"]);
  assert.equal(old.tools[0].name, "pixel-art", "스튜디오 도구가 앞");
  // 툴킷이 없거나 tools.json 이 깨져도 던지지 않는다
  assert.deepEqual(collectManifests(path.join(kit, "없음")).tools, []);
  fs.writeFileSync(path.join(kit, "tools.json"), "{깨짐");
  assert.deepEqual(collectManifests(kit).tools.map((x) => x.name), ["pixel-art"], "설명서 파일만이라도 보낸다");
});

test("수집: 본문이 한도를 넘으면 최소 설명서부터 뺀다(설명서 파일은 남긴다)", (t) => {
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`tool-${i}`, { entry: "cli.py", description: "d".repeat(250), args: Array.from({ length: 12 }, (__, k) => ({ name: `a${k}`, type: "string", description: "x".repeat(150) })), secrets: [] }]));
  const kit = toolkit(tmp(t), { tools: { ...many, "pixel-art": TOOLS["pixel-art"] }, manifests: { "pixel-art": manifest("pixel-art") } });
  const r = collectManifests(kit, { limit: 20 * 1024 });
  assert.ok(Buffer.byteLength(JSON.stringify({ commit: r.commit, tools: r.tools })) <= 20 * 1024);
  assert.equal(r.tools[0].name, "pixel-art");
  assert.equal(r.tools[0].source, "file");
  assert.ok(r.tools.length < 31);
});

test("툴킷 커밋: git 저장소이면 짧은 해시, 아니면 빈 값 (읽기만)", { skip: !hasGit && "git 없음" }, (t) => {
  const dir = tmp(t);
  const kit = toolkit(dir, { tools: TOOLS });
  assert.equal(toolkitCommit(kit), "", "git 저장소가 아니거나 상위 저장소가 없으면 빈 값일 수 있다");
  const git = (...a) => spawnSync("git", ["-C", kit, ...a], { encoding: "utf8", windowsHide: true });
  git("init", "-q");
  git("add", "-A");
  const c = git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "x");
  assert.equal(c.status, 0, c.stderr);
  const head = git("rev-parse", "--short=12", "HEAD").stdout.trim();
  assert.equal(toolkitCommit(kit), head);
  assert.equal(collectManifests(kit).commit, head);
  assert.equal(toolkitCommit(""), "");
});

test("방법 → 필요한 키 한 곳: 설명서 방법의 키 + optionalSecrets 가 가리키는 키, 필수 키는 따로", (t) => {
  const kit = toolkit(tmp(t), { tools: TOOLS, manifests: { "pixel-art": manifest("pixel-art") } });
  const m = loadManifestIndex(kit)["pixel-art"];
  const tool = { secrets: [], optionalSecrets: ["PIXELLAB_TOKEN"] };
  assert.deepEqual(secretsForMethod(tool, "foo", m), ["FOO_KEY"], "설명서에만 적힌 방법");
  assert.deepEqual(secretsForMethod(tool, "pixellab", m), ["PIXELLAB_TOKEN"], "optionalSecrets 경로는 그대로");
  assert.deepEqual(secretsForMethod(tool, "alpha", m), []);
  assert.deepEqual(secretsForMethod(tool, "FOO", m), ["FOO_KEY"], "방법 이름은 대소문자를 가리지 않는다");
  assert.deepEqual(secretsForMethod(tool, "bar", m), [], "없는 방법");
  assert.deepEqual(secretsForMethod(tool, "pixellab", null), ["PIXELLAB_TOKEN"], "설명서가 없으면 예전 그대로");
  assert.deepEqual(secretsForMethod({ secrets: ["FOO_KEY"], optionalSecrets: [] }, "foo", m), [], "필수 키로 이미 있으면 선택 키에서 뺀다");
  assert.deepEqual(secretsForMethod({ secrets: [], optionalSecrets: ["OTHER_KEY"] }, "pixellab", null), [], "모르는 선택 키는 어떤 호출에도 넘기지 않는다");
  assert.equal(OPTIONAL_SECRET_METHODS.PIXELLAB_TOKEN, "pixellab");
  assert.deepEqual(manifestSecretNames(kit), ["FOO_KEY"]);
  assert.deepEqual(toolkitSecretNames(kit).sort(), ["FOO_KEY", "MUST_KEY", "PIXELLAB_TOKEN"], "설명서에만 적힌 키도 도구 전용(AI 환경에서 뺀다)");
});

test("neededOptionalSecrets: 설명서를 주면 설명서의 방법 → 키도 쓴다(기존 시험 동작은 그대로)", (t) => {
  const kit = toolkit(tmp(t), { tools: TOOLS, manifests: { "pixel-art": manifest("pixel-art") } });
  const m = loadManifestIndex(kit)["pixel-art"];
  const tool = { secrets: [], optionalSecrets: [] };
  assert.deepEqual(neededOptionalSecrets("pixel-art", tool, { method: "foo" }, {}, null, m), ["FOO_KEY"]);
  assert.deepEqual(neededOptionalSecrets("pixel-art", tool, { method: "alpha" }, {}, null, m), []);
  assert.deepEqual(neededOptionalSecrets("pixel-art", tool, { kind: "image-pix" }, { "pixel-art": { "image-pix": "foo" } }, null, m), ["FOO_KEY"], "결과 종류 기본 방법도 설명서로 결정");
  assert.deepEqual(neededOptionalSecrets("pixel-art", tool, { kind: "k" }, {}, { methods: { k: { default: "foo" } } }, m), ["FOO_KEY"], "프로젝트 설정의 기본 방법");
  assert.deepEqual(neededOptionalSecrets("pixel-art", tool, {}, {}, null, m), [], "방법을 모르면 넘기지 않는다");
  assert.deepEqual(neededOptionalSecrets("pixel-art", tool, { method: "foo" }), [], "설명서가 없으면 예전 그대로");
});

// ───────── 보고 ─────────
function fakeApi(status = () => 200) {
  const calls = [];
  const api = async (method, url, body) => {
    calls.push({ method, url, body });
    return { status: status(calls.length), data: { message: "x" } };
  };
  return { api, calls };
}

test("보고: 시작할 때 한 번, 같은 내용이면 다시 보내지 않고, 툴킷 커밋·설명서가 바뀌면 다시 보낸다", async (t) => {
  const kit = toolkit(tmp(t), { tools: TOOLS, manifests: { "pixel-art": manifest("pixel-art") } });
  const { api, calls } = fakeApi();
  const logs = [];
  const r = startManifestReport({ api, log: (m) => logs.push(m), toolkitDir: () => kit, everyMs: 1e9, firstMs: 1e9 });
  t.after(() => r.stop());
  await r.tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "/api/factory/tool-manifests");
  assert.deepEqual(calls[0].body.tools.map((x) => x.name).sort(), ["other-tool", "pixel-art", "pixel-slice"]);
  assert.equal(calls[0].body.tools.find((x) => x.name === "pixel-art").source, "file");
  assert.ok(Buffer.byteLength(JSON.stringify(calls[0].body)) < 60 * 1024);
  assert.match(logs.join("\n"), /도구 설명서 3개를 홈페이지에 보냈어요/);
  await r.tick();
  await r.tick();
  assert.equal(calls.length, 1, "바뀐 게 없으면 보내지 않는다");
  // 설명서 내용이 바뀌면(커밋이 같아도) 다시 보낸다
  fs.writeFileSync(path.join(kit, "tools", "manifests", "pixel-art.json"), JSON.stringify(manifest("pixel-art", { version: 2 })));
  await r.tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.tools.find((x) => x.name === "pixel-art").version, 2);
  // 비밀값 모양이 보고에 없다
  assert.equal(JSON.stringify(calls).includes(SECRET), false);
});

test("보고: 커밋이 바뀌면 다시 보낸다 (git)", { skip: !hasGit && "git 없음" }, async (t) => {
  const kit = toolkit(tmp(t), { tools: TOOLS, manifests: { "pixel-art": manifest("pixel-art") } });
  const git = (...a) => spawnSync("git", ["-C", kit, "-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { encoding: "utf8", windowsHide: true });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "1");
  const { api, calls } = fakeApi();
  const r = startManifestReport({ api, toolkitDir: kit, everyMs: 1e9, firstMs: 1e9 });
  t.after(() => r.stop());
  await r.tick();
  fs.writeFileSync(path.join(kit, "memo.txt"), "x");
  git("add", "-A");
  git("commit", "-q", "-m", "2");
  await r.tick();
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].body.commit, calls[1].body.commit);
  assert.match(calls[1].body.commit, /^[0-9a-f]{12}$/);
});

test("보고: 실패하면 늦춰서 다시 시도하고(폴링을 막지 않음), 서버가 되살아나면 보낸다. 예전 서버(404)도 던지지 않는다", async (t) => {
  const kit = toolkit(tmp(t), { tools: TOOLS });
  let ok = false;
  const { api, calls } = fakeApi(() => (ok ? 200 : 404));
  const logs = [];
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  t.after(() => (Date.now = realNow));
  const r = startManifestReport({ api, log: (m) => logs.push(m), toolkitDir: kit, everyMs: 1e9, firstMs: 1e9 });
  t.after(() => r.stop());
  await r.tick();
  await r.tick();
  assert.equal(calls.length, 1, "실패 직후에는 바로 다시 시도하지 않는다");
  assert.match(logs.join("\n"), /도구 설명서 보내기 실패: 404/);
  now += 60_000;
  await r.tick();
  assert.equal(calls.length, 2);
  ok = true;
  now += 11 * 60_000;
  await r.tick();
  assert.equal(calls.length, 3);
  await r.tick();
  assert.equal(calls.length, 3, "성공하면 같은 내용은 다시 보내지 않는다");
  now += 7 * 60 * 60_000;
  await r.tick();
  assert.equal(calls.length, 4, "6시간이 지나면 다시 보낸다");
  // 던지는 api 도 삼킨다
  const thrower = startManifestReport({ api: async () => { throw new Error("연결 안 됨"); }, log: (m) => logs.push(m), toolkitDir: kit, everyMs: 1e9, firstMs: 1e9 });
  await thrower.tick();
  thrower.stop();
  // 툴킷이 없으면 아무것도 보내지 않는다
  const none = fakeApi();
  const empty = startManifestReport({ api: none.api, toolkitDir: path.join(kit, "없음"), everyMs: 1e9, firstMs: 1e9 });
  await empty.tick();
  empty.stop();
  assert.equal(none.calls.length, 0);
});

test("지문: 같은 내용이면 같고 설명서나 커밋이 다르면 달라진다", () => {
  const a = { commit: "abc", tools: [{ name: "x", version: 1 }] };
  assert.equal(manifestSignature(a), manifestSignature({ commit: "abc", tools: [{ name: "x", version: 1 }] }));
  assert.notEqual(manifestSignature(a), manifestSignature({ ...a, commit: "abd" }));
  assert.notEqual(manifestSignature(a), manifestSignature({ ...a, tools: [{ name: "x", version: 2 }] }));
});

// ───────── 도구 중계가 설명서의 키를 쓴다 ─────────
function brokerFor(f, requiredSecrets, secrets) {
  const logs = [];
  const b = createBroker({ appDir: f.app, jobId: "job1", engine: "codex", getSettings: () => brokerSettings({ mode: "allow" }), toolkitDir: f.kit, pythonCmd: process.execPath, requiredSecrets, secrets, log: (m) => logs.push(m) });
  return { b, logs };
}
const request = (app, id, args) => fs.writeFileSync(path.join(app, ".factory", "requests", `${id}.json`), JSON.stringify({ id, tool: "toolkit.run", args }));
const response = (app, id) => JSON.parse(fs.readFileSync(path.join(app, ".factory", "responses", `${id}.json`), "utf8"));

test("중계: 설명서에 적힌 방법의 키가 필요하고, 일감에 있을 때만 도구에 넘긴다 (tools.json 에는 optionalSecrets 가 없다)", { skip: !canSpawn && "자식 프로세스를 띄울 수 없는 환경" }, async (t) => {
  const dir = tmp(t);
  const tools = { "pixel-art": { ...TOOLS["pixel-art"], optionalSecrets: [] } };
  const kit = toolkit(dir, { tools, manifests: { "pixel-art": manifest("pixel-art") } });
  const app = path.join(dir, "app");
  fs.mkdirSync(path.join(app, ".factory", "requests"), { recursive: true });
  const f = { app, kit };
  const args = (method, out) => ({ command: "pixel-art", args: { method, output_dir: `.factory/assets/${out}` } });
  request(app, "m1", args("foo", "m1"));
  request(app, "m2", args("alpha", "m2"));
  const denied = brokerFor(f, [], { FOO_KEY: SECRET });
  await denied.b.tick();
  assert.equal(response(app, "m1").status, "denied");
  assert.match(response(app, "m1").message, /이 일감에 허용되지 않은 키가 필요해요: FOO_KEY.*도구 설명서: foo 방법에 필요한 키/);
  assert.equal(response(app, "m2").status, "ok", "키가 필요 없는 방법은 그대로 돈다");
  assert.match(response(app, "m2").output, /foo=undefined/);
  request(app, "m3", args("foo", "m3"));
  const allowed = brokerFor(f, ["FOO_KEY"], { FOO_KEY: SECRET });
  await allowed.b.tick();
  assert.equal(response(app, "m3").status, "ok", JSON.stringify(response(app, "m3")));
  assert.match(response(app, "m3").output, /foo=\*\*\*/, "키가 도구에 간다(출력에서는 가려진다)");
  request(app, "m4", args("foo", "m4"));
  const noFile = brokerFor(f, ["FOO_KEY"], {});
  await noFile.b.tick();
  assert.match(response(app, "m4").message, /이 PC 의 키 파일에 없는 키: FOO_KEY/);
  const all = ["m1", "m2", "m3", "m4"].map((id) => fs.readFileSync(path.join(app, ".factory", "responses", `${id}.json`), "utf8")).join("\n") + allowed.logs.join("\n") + JSON.stringify(allowed.b.list());
  assert.equal(all.includes(SECRET), false);
});

test("중계: 설명서가 없는 툴킷은 예전과 같다 (optionalSecrets 경로)", { skip: !canSpawn && "자식 프로세스를 띄울 수 없는 환경" }, async (t) => {
  const dir = tmp(t);
  const kit = toolkit(dir, { tools: { "pixel-art": TOOLS["pixel-art"] } });
  const app = path.join(dir, "app");
  fs.mkdirSync(path.join(app, ".factory", "requests"), { recursive: true });
  request(app, "o1", { command: "pixel-art", args: { method: "pixellab", output_dir: ".factory/assets/o1" } });
  request(app, "o2", { command: "pixel-art", args: { method: "codex", output_dir: ".factory/assets/o2" } });
  const { b } = brokerFor({ app, kit }, ["PIXELLAB_TOKEN"], { PIXELLAB_TOKEN: SECRET });
  await b.tick();
  assert.match(response(app, "o1").output, /pix=\*\*\*/);
  assert.match(response(app, "o2").output, /pix=undefined/);
});
