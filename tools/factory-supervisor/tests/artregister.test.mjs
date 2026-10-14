// 도트 그림 저장소(감독 프로그램 쪽) 시험: 승인 그림을 설정에 합치기, picked 파일·refs 자동 인자, result.json 읽기, 후보 올리기, 처음 값 올리기.
// 실제 서버·키 없음. 가짜 서버(post)와 node 로 만든 가짜 진입점을 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { cleanArtList, createBroker, brokerRules, brokerSettings, mergeApprovedArts, readPickedRefs, readStudioArtSource, writeArtRefs, writeProjectSettings } from "../toolbroker.mjs";
import { createArtRegistrar, pickArtOutputs } from "../artregister.mjs";
import { SEEDS, seedOne } from "../seedart.mjs";

const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-art-test-"));
  t.after(() => {
    assert.ok(path.basename(dir).startsWith("factory-art-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const app = path.join(dir, "app");
  fs.mkdirSync(path.join(app, ".factory", "requests"), { recursive: true });
  return { dir, app, toolkit: path.join(dir, "game-toolkit") };
}
const put = (f, rel, data = PNG) => {
  const full = path.join(f.app, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
};
const U = (n) => `https://img.example/upload-api/${n}.png`;
const ART = (n, subject, kind, at = "2026-10-14T00:00:00.000Z") => ({ url: U(n), subject, kind, approvedAt: at });

test("합치기: 승인 그림이 앞, 설정에 있던 항목은 뒤, 같은 path 는 한 번, project 는 넣지 않는다", () => {
  const stored = { version: 1, references: { auto_max: 3, approved: [{ path: "style-anchors/ssagi/side.png", subject: "싹이", kind: "motion-game", project: "one-tiny-frame" }, { path: U("a") }] }, aliases: { 싹이: ["감자"] } };
  const merged = mergeApprovedArts(stored, [ART("a", "싹이", "image-prop"), ART("b", "싹이", "motion-game")]);
  assert.deepEqual(merged.references.approved.map((e) => e.path), [U("a"), U("b"), "style-anchors/ssagi/side.png"]);
  assert.equal(merged.references.approved[0].project, undefined);
  assert.equal(merged.references.auto_max, 3, "설정의 다른 값은 그대로");
  assert.deepEqual(merged.aliases, stored.aliases);
  assert.deepEqual(stored.references.approved.length, 2, "원본 설정은 바뀌지 않는다");
  assert.equal(mergeApprovedArts(stored, []), stored, "승인 그림이 없으면 설정 그대로");
  assert.deepEqual(mergeApprovedArts(null, [ART("a", "싹이", "image-prop")]), { version: 1, references: { approved: [{ path: U("a"), subject: "싹이", kind: "image-prop" }] } });
});

test("목록 정리: 주소·대상 이름·결과 종류가 이상한 항목은 버린다", () => {
  const list = cleanArtList([ART("a", "싹이", "image-prop"), { url: "file:///etc/passwd", subject: "x", kind: "image-prop" }, { url: U("b"), subject: "", kind: "image-prop" }, { url: U("c"), subject: "x", kind: "weird" }, null, "문자열"], 10);
  assert.deepEqual(list.map((e) => e.url), [U("a")]);
  assert.equal(cleanArtList("nope", 5).length, 0);
  assert.equal(cleanArtList(Array.from({ length: 9 }, (_, i) => ART(String(i), "s", "image-prop")), 3).length, 3);
});

test("writeProjectSettings: 설정이 없어도 승인 그림이 있으면 쓰고, 둘 다 없으면 지운다", (t) => {
  const f = fixture(t);
  const file = path.join(f.app, ".factory", "project-settings.json");
  assert.equal(writeProjectSettings(f.app, undefined, [ART("a", "싹이", "image-prop")]), "written");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { version: 1, references: { approved: [{ path: U("a"), subject: "싹이", kind: "image-prop" }] } });
  assert.equal(writeProjectSettings(f.app, undefined, []), "removed");
  assert.equal(fs.existsSync(file), false);
  // 16KB 가 넘으면 승인 그림을 뒤에서부터 줄여서 맞춘다(설정이 그대로 크면 쓰지 않는다)
  const many = Array.from({ length: 24 }, (_, i) => ({ url: `https://img.example/upload-api/${"x".repeat(450)}${i}.png`, subject: "싹이", kind: "image-prop", approvedAt: "2026-10-14T00:00:00Z" }));
  assert.equal(writeProjectSettings(f.app, { version: 1, settings: { version: 1, style: { notes: "y".repeat(8000) } } }, many), "written");
  const written = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(Buffer.byteLength(fs.readFileSync(file)) <= 16 * 1024);
  assert.ok(written.references.approved.length > 0 && written.references.approved.length < 24);
  assert.equal(written.style.notes.length, 8000);
});

test("art-refs.json: picked 를 쓰고 읽고(최대 4장), 비면 지운다", (t) => {
  const f = fixture(t);
  const picked = Array.from({ length: 6 }, (_, i) => ART(String(i), "싹이", "image-prop"));
  assert.equal(writeArtRefs(f.app, picked, []), 4);
  assert.deepEqual(readPickedRefs(f.app), [0, 1, 2, 3].map((i) => U(String(i))));
  assert.equal(writeArtRefs(f.app, [], []), 0);
  assert.deepEqual(readPickedRefs(f.app), [], "다음 일감에 이전 picked 가 남지 않는다");
  assert.equal(fs.existsSync(path.join(f.app, ".factory", "art-refs.json")), false);
});

// ───────── pixel-art 호출에 picked 를 refs 로 자동 ─────────
const CLI = `
const fs = require("node:fs"), path = require("node:path");
const [cmd, ...args] = process.argv.slice(2);
const get = (k) => args.find((a) => a.startsWith("--" + k + "="))?.slice(k.length + 3);
console.log("refs=" + get("refs") + " settings=" + get("settings"));
const out = get("output_dir");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "sheet.png"), Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex"));
fs.writeFileSync(path.join(out, "walk.gif"), "GIF89a-fake");
fs.mkdirSync(path.join(out, "_steps"), { recursive: true });
fs.writeFileSync(path.join(out, "_steps", "mid.png"), "x");
const rel = (n) => path.relative(process.cwd(), path.join(out, n)).split(path.sep).join("/");
fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({ project: get("project") || "", subject: get("subject"), kind: get("kind"), method: "codex", steps: [{ tool: "pixel-codex", argv: ["--prompt=SECRET-PROMPT"] }], refs: [{ path: "a", reason: "①picked" }, { path: "b", reason: "②subject" }], refs_fallback: null, cost: 2, outputs: [rel("sheet.png"), rel("walk.gif"), rel("_steps/mid.png")], created_at: "2026-10-14T00:00:00Z" }));
`;
const TOOLS = {
  "pixel-art": { entry: "cli.py", layer: "studio", args: [{ name: "kind", type: "string", required: true }, { name: "subject", type: "string", required: true }, { name: "project", type: "string" }, { name: "refs", type: "string" }, { name: "settings", type: "path" }, { name: "output_dir", type: "path", required: true }], network: false, secrets: [], timeoutSec: 30 },
};
function artToolkit(f) {
  fs.mkdirSync(f.toolkit, { recursive: true });
  fs.writeFileSync(path.join(f.toolkit, "tools.json"), JSON.stringify({ version: 1, tools: TOOLS, studioTools: { "pixel-art": { "image-prop": "codex" } } }));
  fs.writeFileSync(path.join(f.toolkit, "cli.py"), CLI);
}
const request = (app, id, args) => fs.writeFileSync(path.join(app, ".factory", "requests", `${id}.json`), JSON.stringify({ id, tool: "toolkit.run", args: { command: "pixel-art", args } }));
const response = (app, id) => JSON.parse(fs.readFileSync(path.join(app, ".factory", "responses", `${id}.json`), "utf8"));
const mkBroker = (f, extra = {}) =>
  createBroker({ appDir: f.app, jobId: "job1", engine: "codex", getSettings: () => brokerSettings({ mode: "allow" }), toolkitDir: f.toolkit, pythonCmd: process.execPath, requiredSecrets: [], secrets: {}, ...extra });

test("pixel-art: refs 가 없으면 picked 를 자동으로 붙이고, 요청에 refs 가 있으면 그대로, picked 가 없으면 안 붙인다", { skip: !canSpawn && "자식 프로세스를 띄울 수 없는 환경" }, async (t) => {
  const f = fixture(t);
  artToolkit(f);
  writeArtRefs(f.app, [ART("p1", "싹이", "image-prop"), ART("p2", "싹이", "image-prop")], []);
  request(f.app, "r1", { kind: "image-prop", subject: "싹이", output_dir: ".factory/assets/r1" });
  request(f.app, "r2", { kind: "image-prop", subject: "싹이", refs: "mine.png", output_dir: ".factory/assets/r2" });
  const b = mkBroker(f);
  await b.tick();
  assert.match(response(f.app, "r1").output, new RegExp(`refs=${U("p1")},${U("p2")}`), "picked 가 먼저, 순서대로");
  assert.match(response(f.app, "r2").output, /refs=mine\.png/, "요청에 적은 refs 가 먼저");
  writeArtRefs(f.app, [], []);
  request(f.app, "r3", { kind: "image-prop", subject: "싹이", output_dir: ".factory/assets/r3" });
  await b.tick();
  assert.match(response(f.app, "r3").output, /refs=undefined/);
});

test("중계: 실행 직전에 승인 그림 목록을 갈아 끼우고(refreshArts), 끝나면 onArt 로 후보 정보를 넘긴다(응답 파일에는 안 싣는다)", { skip: !canSpawn && "자식 프로세스를 띄울 수 없는 환경" }, async (t) => {
  const f = fixture(t);
  artToolkit(f);
  const arts = [];
  let refreshed = 0;
  const b = mkBroker(f, {
    refreshArts: async () => {
      refreshed++;
      writeProjectSettings(f.app, undefined, [ART("new", "싹이", "image-prop")]);
    },
    onArt: (src) => arts.push(src),
  });
  request(f.app, "a1", { kind: "image-prop", subject: "싹이", project: "one-tiny-frame", output_dir: ".factory/assets/a1" });
  await b.tick();
  assert.equal(refreshed, 1);
  assert.match(response(f.app, "a1").output, /settings=\.factory\/project-settings\.json/, "승인 그림만 있어도 설정 파일이 자동으로 붙는다");
  assert.equal(arts.length, 1);
  const src = arts[0];
  assert.deepEqual({ project: src.project, subject: src.subject, kind: src.kind, method: src.method }, { project: "one-tiny-frame", subject: "싹이", kind: "image-prop", method: "codex" });
  assert.deepEqual(src.summary, { steps: ["pixel-codex"], refs: ["①picked", "②subject"], refsFallback: "", cost: 2 });
  assert.ok(!JSON.stringify(src).includes("SECRET-PROMPT"), "프롬프트(argv)는 담지 않는다");
  assert.ok(!("artSource" in response(f.app, "a1")), "응답 파일에는 싣지 않는다");
  // 실패한 호출은 후보로 올리지 않는다
  request(f.app, "a2", { kind: "image-prop", output_dir: ".factory/assets/a2" });
  await b.tick();
  assert.equal(arts.length, 1);
});

test("readStudioArtSource: output_dir 이 없거나 subject·kind 가 이상하면 null", (t) => {
  const f = fixture(t);
  assert.equal(readStudioArtSource(f.app, ["--kind=image-prop"]), null);
  put(f, "out/result.json", JSON.stringify({ subject: "", kind: "image-prop" }));
  assert.equal(readStudioArtSource(f.app, ["--output_dir=out"]), null);
  put(f, "out/result.json", JSON.stringify({ subject: "싹이", kind: "nope" }));
  assert.equal(readStudioArtSource(f.app, ["--output_dir=out"]), null);
  put(f, "out/result.json", JSON.stringify({ subject: "싹이", kind: "motion-game", cost: { pixellab_calls: 3 }, outputs: ["a.png"] }));
  assert.equal(readStudioArtSource(f.app, ["--output_dir=out"]).summary.cost, 3);
});

// ───────── 후보 올리기 ─────────
function fakeServer(statuses = []) {
  const calls = [];
  const post = async (form) => {
    calls.push(Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `file:${v.name}:${v.type}`])));
    const s = statuses.length ? statuses.shift() : 200;
    if (s instanceof Error) throw s;
    return typeof s === "object" ? s : { status: s, data: {} };
  };
  return { calls, post };
}
const SRC = (extra = {}) => ({ project: "one-tiny-frame", subject: "싹이", kind: "motion-game", method: "codex", outputs: ["out/sheet.png", "out/walk.gif", "out/_steps/mid.png", "out/other.png"], summary: { steps: ["pixel-codex"], refs: [], refsFallback: "", cost: 0 }, ...extra });
function outputs(f) {
  put(f, "out/sheet.png");
  put(f, "out/walk.gif", "GIF89a-fake");
  put(f, "out/_steps/mid.png");
  put(f, "out/other.png");
}

test("올릴 파일 고르기: 대표 그림 1장 + GIF 1장만, _steps·-raw·빈 파일·앱 폴더 밖 경로는 뺀다", (t) => {
  const f = fixture(t);
  outputs(f);
  put(f, "out/x-raw.png");
  put(f, "out/empty.png", Buffer.alloc(0));
  assert.deepEqual(pickArtOutputs(f.app, ["out/_steps/mid.png", "../evil.png", "out/empty.png", "out/x-raw.png", "out/sheet.png", "out/other.png", "out/walk.gif", "C:/abs.png", 5]).map((x) => x.name), ["sheet.png", "walk.gif"]);
  assert.deepEqual(pickArtOutputs(f.app, "nope"), []);
});

test("후보 올리기: project·subject·kind·method·요약을 보내고 status 는 보내지 않는다(서버가 후보로 둔다), project 가 비면 앱 이름", async (t) => {
  const f = fixture(t);
  outputs(f);
  const server = fakeServer();
  const logs = [];
  const reg = createArtRegistrar({ appDir: f.app, jobId: "job1", appSlug: "my-app", post: server.post, log: (l, m) => logs.push(`${l}: ${m}`) });
  await reg.register(SRC());
  assert.equal(server.calls.length, 2);
  const [c1, c2] = server.calls;
  assert.equal(c1.appSlug, "one-tiny-frame");
  assert.deepEqual({ subject: c1.subject, kind: c1.kind, method: c1.method, jobId: c1.jobId, file: c1.file }, { subject: "싹이", kind: "motion-game", method: "codex", jobId: "job1", file: "file:sheet.png:image/png" });
  assert.equal(c2.file, "file:walk.gif:image/gif");
  assert.ok(!("status" in c1), "상태는 보내지 않는다: 일감이 올린 그림은 언제나 후보");
  assert.deepEqual(JSON.parse(c1.summary).steps, ["pixel-codex"]);
  assert.match(c1.srcKey, /^job1:out\/sheet\.png:\d+$/);
  assert.equal(reg.registered, 2);
  for (const [i, project] of ["", "Not A Slug!"].entries()) {
    const s2 = fakeServer();
    await createArtRegistrar({ appDir: f.app, jobId: `job${i + 2}`, appSlug: "my-app", post: s2.post }).register(SRC({ project }));
    assert.equal(s2.calls[0].appSlug, "my-app", "project 가 비었거나 이름 형식이 아니면 그 일감의 앱 이름");
  }
  assert.match(logs.join("\n"), /그림 후보로 등록: sheet\.png/);
});

test("후보 올리기: 409·429·404 는 그 일감에서 멈추고, 서버 오류는 한 번 더 시도하고, 예외 없이 끝난다", async (t) => {
  const f = fixture(t);
  outputs(f);
  const logs = [];
  const run = async (statuses) => {
    const server = fakeServer(statuses);
    const reg = createArtRegistrar({ appDir: f.app, jobId: "job1", appSlug: "my-app", post: server.post, log: (l, m) => logs.push(m) });
    await reg.register(SRC());
    await reg.idle();
    return { server, reg };
  };
  const a = await run([409]);
  assert.equal(a.server.calls.length, 1);
  assert.equal(a.reg.stopped, true);
  const b = await run([404]);
  assert.equal(b.server.calls.length, 1);
  assert.match(logs.join("\n"), /배포 전/);
  const c = await run([500, 200, 200]);
  assert.equal(c.server.calls.length, 3, "500 한 번 재시도 뒤 성공, 다음 파일도 성공");
  assert.equal(c.reg.registered, 2);
  const d = await run([new Error("net"), 200, 200]);
  assert.equal(d.reg.registered, 2);
  const e = await run([400, 200]);
  assert.equal(e.reg.registered, 1, "400 은 다시 하지 않고 다음 파일로");
});

test("후보 올리기: 같은 파일을 같은 일감에서 두 번 부르면 한 번만 올린다", async (t) => {
  const f = fixture(t);
  outputs(f);
  const server = fakeServer();
  const reg = createArtRegistrar({ appDir: f.app, jobId: "job1", appSlug: "my-app", post: server.post });
  await Promise.all([reg.register(SRC()), reg.register(SRC())]);
  await reg.idle();
  assert.equal(server.calls.length, 2, "두 번 불러도 파일(대표+GIF)은 각각 한 번씩만");
  assert.equal(new Set(server.calls.map((c) => c.srcKey)).size, 2);
});

// ───────── 처음 값 올리기 ─────────
test("처음 값: 싹이 정면은 승인, 옆모습은 후보로 올리고 원본은 그대로", async (t) => {
  const f = fixture(t);
  const work = f.dir;
  for (const s of SEEDS) {
    const full = path.join(work, s.src);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, PNG);
  }
  const server = fakeServer();
  const lines = [];
  for (const s of SEEDS) lines.push((await seedOne(s, work, server.post)).line);
  assert.equal(server.calls.length, 2);
  assert.deepEqual(server.calls.map((c) => [c.appSlug, c.subject, c.status, c.kind]), [["one-tiny-frame", "싹이", "approved", "image-prop"], ["one-tiny-frame", "싹이", "candidate", "motion-game"]]);
  assert.ok(server.calls.every((c) => !("jobId" in c)), "일감 없이 손으로 올리는 값");
  assert.deepEqual(server.calls.map((c) => c.srcKey), ["seed:one-tiny-frame:ssagi_ref", "seed:one-tiny-frame:codex-side"]);
  assert.ok(SEEDS.every((s) => fs.readFileSync(path.join(work, s.src)).equals(PNG)), "원본은 읽기만");
  assert.ok(lines.every((l) => !/https?:|Bearer/.test(l)));
  // 없는 파일·서버 미배포(404)는 이유를 적고 멈추지 않는다
  assert.match((await seedOne(SEEDS[0], path.join(work, "nowhere"), server.post)).line, /파일이 없어요/);
  const old = await seedOne(SEEDS[0], work, fakeServer([404]).post);
  assert.equal(old.ok, false);
  assert.match(old.line, /배포/);
});

test("규칙 블록: 참고 그림은 자동이고 결과는 후보로 등록된다는 안내", () => {
  assert.match(brokerRules("allow", null), /승인한 그림/);
  assert.match(brokerRules("allow", null), /후보로 자동 등록/);
});
