// 결과물 카드(2-2) 감독 프로그램 쪽 시험: 카드 파일 쓰기·읽기, 참고 규칙에 맞는 승인 그림 합치기, pixel-art 호출의 card 인자(--settings·고정 그림·키),
// 그림 후보에 카드 id·판 번호 붙이기, 실험 폴더의 카드 설정. 실제 서버·키 없음 — 가짜 서버(post)와 node 로 만든 가짜 진입점을 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { brokerSettings, createBroker, mergeApprovedArts, resolveCard, writeCardFiles, writeProjectSettings } from "../toolbroker.mjs";
import { createArtRegistrar } from "../artregister.mjs";
import { labPrompt, prepareLab, writeLabCard } from "../lab.mjs";

const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");
const SECRET = "supersecretvalue-PIXEL-123";
const U = (n) => `https://img.example/upload-api/${n}.png`;
const ART = (n, subject, kind) => ({ url: U(n), subject, kind, approvedAt: "2026-10-14T00:00:00.000Z" });

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-cards-test-"));
  t.after(() => {
    assert.ok(path.basename(dir).startsWith("factory-cards-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const app = path.join(dir, "app");
  fs.mkdirSync(path.join(app, ".factory", "requests"), { recursive: true });
  return { dir, app, toolkit: path.join(dir, "game-toolkit") };
}

// 서버가 내려 주는 카드 한 장(lib/factory/cardsDb.ts CardRun 모양)
const CARD = (id, name, extra = {}) => ({
  id,
  name,
  version: 2,
  tool: "pixel-art",
  method: "pixellab",
  settings: { version: 1, methods: { "image-prop": { allowed: ["pixellab"], default: "pixellab" } }, results: { allowed_kinds: ["image-prop"], default_kind: "image-prop" }, spec: { cell_size: 128 } },
  rules: { sameSubject: true, sameKind: true },
  pinned: { url: U("pin"), subject: "싹이", kind: "image-prop" },
  ...extra,
});

test("승인 그림 합치기: 참고 규칙에 따라 둘 다 끄면 합치지 않고, 하나만 켜면 다른 쪽 단서를 뺀다", () => {
  const settings = { version: 1, references: { auto_max: 2 } };
  const arts = [ART("a", "싹이", "image-prop")];
  assert.deepEqual(mergeApprovedArts(settings, arts).references.approved, [{ path: U("a"), subject: "싹이", kind: "image-prop" }], "규칙이 없으면 예전 그대로");
  assert.deepEqual(mergeApprovedArts(settings, arts, { sameSubject: true, sameKind: true }).references.approved, [{ path: U("a"), subject: "싹이", kind: "image-prop" }]);
  assert.deepEqual(mergeApprovedArts(settings, arts, { sameSubject: true, sameKind: false }).references.approved, [{ path: U("a"), subject: "싹이" }], "같은 대상만: kind 를 빼서 ③이 못 고른다");
  assert.deepEqual(mergeApprovedArts(settings, arts, { sameSubject: false, sameKind: true }).references.approved, [{ path: U("a"), kind: "image-prop" }], "같은 종류만");
  assert.equal(mergeApprovedArts(settings, arts, { sameSubject: false, sameKind: false }), settings, "둘 다 끄면 합치지 않는다");
});

test("writeProjectSettings: 카드 일감의 규칙(rules)이 승인 그림 합치기에 적용된다", (t) => {
  const f = fixture(t);
  const file = path.join(f.app, ".factory", "project-settings.json");
  assert.equal(writeProjectSettings(f.app, { version: 2, settings: CARD("c1", "x").settings }, [ART("a", "싹이", "image-prop")], { sameSubject: true, sameKind: false }), "written");
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(s.references.approved, [{ path: U("a"), subject: "싹이" }]);
  assert.equal(s.spec.cell_size, 128);
});

test("카드 파일: id.json 과 index.json 을 쓰고, 이름·id 로 찾고, 없는 카드는 있는 이름 목록과 함께 거절한다", (t) => {
  const f = fixture(t);
  assert.equal(writeCardFiles(f.app, [CARD("card_a", "싹이 단독 짤"), CARD("card_b", "여러 환경 짤 128", { rules: { sameSubject: false, sameKind: false }, pinned: null })], [ART("a", "싹이", "image-prop")]), 2);
  const dir = path.join(f.app, ".factory", "cards");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["card_a.json", "card_b.json", "index.json"]);
  const a = resolveCard(f.app, "싹이 단독 짤");
  assert.deepEqual({ id: a.id, version: a.version, rel: a.rel, pinnedUrl: a.pinnedUrl }, { id: "card_a", version: 2, rel: ".factory/cards/card_a.json", pinnedUrl: U("pin") });
  assert.equal(a.settings.spec.cell_size, 128);
  assert.deepEqual(a.settings.references.approved.map((e) => e.path), [U("a")], "카드 파일에 승인 그림이 규칙대로 합쳐진다");
  assert.equal(resolveCard(f.app, "card_b").name, "여러 환경 짤 128");
  assert.equal(resolveCard(f.app, "card_b").settings.references, undefined, "둘 다 끄면 승인 그림을 안 붙인다");
  assert.equal(resolveCard(f.app, "card_b").pinnedUrl, null);
  assert.match(resolveCard(f.app, "없는 카드").error, /이 일감이 받은 카드: 싹이 단독 짤, 여러 환경 짤 128/);
  for (const bad of ["", "  ", "a\nb", 5, null, "x".repeat(80)]) assert.ok(resolveCard(f.app, bad).error, String(bad));
  // 목록이 바뀌면 빠진 카드의 예전 파일은 지운다
  assert.equal(writeCardFiles(f.app, [CARD("card_b", "여러 환경 짤 128")], []), 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["card_b.json", "index.json"]);
  assert.match(resolveCard(f.app, "card_a").error, /찾지 못했어요/);
});

test("카드 파일: 이상한 카드는 건너뛰고, 아직 받은 적 없으면 안내하고, 크면 승인 그림을 줄인다", (t) => {
  const f = fixture(t);
  assert.match(resolveCard(f.app, "아무거나").error, /카드 목록을 아직 받지 못했어요/);
  const many = Array.from({ length: 24 }, (_, i) => ({ url: `https://img.example/upload-api/${"x".repeat(450)}${i}.png`, subject: "싹이", kind: "image-prop", approvedAt: "2026-10-14T00:00:00Z" }));
  const cards = [CARD("../evil", "나쁜 id"), CARD("card_ok", ""), { id: "card_noset", name: "설정 없음" }, CARD("card_big", "큰 카드", { settings: { version: 1, style: { notes: "y".repeat(8000) } } })];
  assert.equal(writeCardFiles(f.app, cards, many), 1, "id 형식·이름·설정이 이상한 카드는 건너뛴다");
  const big = resolveCard(f.app, "큰 카드");
  assert.ok(big.settings.references.approved.length > 0 && big.settings.references.approved.length < 24, "16KB 안에 맞게 승인 그림을 뒤에서부터 줄인다");
  assert.ok(fs.statSync(path.join(f.app, ".factory", "cards", "card_big.json")).size <= 16 * 1024);
  assert.equal(writeCardFiles(f.app, "nope", []), 0);
});

test("카드 파일: .factory/cards 가 심볼릭 링크면 쓰지 않는다", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.dir, "elsewhere"));
  try {
    fs.symlinkSync(path.join(f.dir, "elsewhere"), path.join(f.app, ".factory", "cards"), "junction");
  } catch {
    return t.skip("이 환경은 링크를 만들 수 없어요");
  }
  assert.equal(writeCardFiles(f.app, [CARD("card_a", "카드")], []), 0);
  assert.equal(fs.readdirSync(path.join(f.dir, "elsewhere")).length, 0, "링크 너머에 쓰지 않는다");
});

// ───────── pixel-art 호출의 card 인자 ─────────
const CLI = `
const fs = require("node:fs"), path = require("node:path");
const [cmd, ...args] = process.argv.slice(2);
const get = (k) => args.find((a) => a.startsWith("--" + k + "="))?.slice(k.length + 3);
console.log("settings=" + get("settings") + " refs=" + get("refs") + " token=" + process.env.PIXELLAB_TOKEN + " card=" + get("card"));
const out = get("output_dir");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "sheet.png"), Buffer.from("${PNG.toString("hex")}", "hex"));
const rel = (n) => path.relative(process.cwd(), path.join(out, n)).split(path.sep).join("/");
fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({ project: "", subject: get("subject"), kind: get("kind"), method: "pixellab", steps: [], refs: [], cost: 1, outputs: [rel("sheet.png")], created_at: "2026-10-14T00:00:00Z" }));
`;
const TOOLS = {
  "pixel-art": {
    entry: "cli.py",
    layer: "studio",
    args: [{ name: "kind", type: "string", required: true }, { name: "subject", type: "string", required: true }, { name: "refs", type: "string" }, { name: "method", type: "string" }, { name: "settings", type: "path" }, { name: "output_dir", type: "path", required: true }],
    network: true,
    secrets: [],
    optionalSecrets: ["PIXELLAB_TOKEN"],
    timeoutSec: 30,
  },
};
function artToolkit(f) {
  fs.mkdirSync(f.toolkit, { recursive: true });
  fs.writeFileSync(path.join(f.toolkit, "tools.json"), JSON.stringify({ version: 1, tools: TOOLS, studioTools: { "pixel-art": { kinds: { "image-prop": { defaultMethod: "codex" } } } } }));
  fs.writeFileSync(path.join(f.toolkit, "cli.py"), CLI);
}
const request = (app, id, args) => fs.writeFileSync(path.join(app, ".factory", "requests", `${id}.json`), JSON.stringify({ id, tool: "toolkit.run", args: { command: "pixel-art", args } }));
const response = (app, id) => JSON.parse(fs.readFileSync(path.join(app, ".factory", "responses", `${id}.json`), "utf8"));
const mkBroker = (f, extra = {}) =>
  createBroker({ appDir: f.app, jobId: "job1", engine: "codex", getSettings: () => brokerSettings({ mode: "allow" }), toolkitDir: f.toolkit, pythonCmd: process.execPath, requiredSecrets: ["PIXELLAB_TOKEN"], secrets: { PIXELLAB_TOKEN: SECRET }, ...extra });
const call = (subject, extra = {}) => ({ kind: "image-prop", subject, output_dir: `.factory/assets/${subject}`, ...extra });

test("pixel-art card 인자: 그 카드의 설정을 --settings 로, 고정 그림을 refs 맨 앞에, 방법에 맞는 키를 넘기고, 그림 정보에 카드 id·판을 싣는다", { skip: !canSpawn && "자식 프로세스를 띄울 수 없는 환경" }, async (t) => {
  const f = fixture(t);
  artToolkit(f);
  writeCardFiles(f.app, [CARD("card_a", "싹이 단독 짤"), CARD("card_c", "코덱스 카드", { method: "codex", settings: { version: 1, methods: { "image-prop": { allowed: ["codex"], default: "codex" } } }, pinned: null })], []);
  fs.writeFileSync(path.join(f.app, ".factory", "art-refs.json"), JSON.stringify({ picked: [ART("p1", "싹이", "image-prop")], approved: [] }));
  const arts = [];
  request(f.app, "c1", call("s1", { card: "싹이 단독 짤" }));
  request(f.app, "c2", call("s2", { card: "card_c" }));
  request(f.app, "c3", call("s3")); // 카드 없이: 예전 그대로
  const b = mkBroker(f, { onArt: (src) => arts.push(src) });
  await b.tick();
  const r1 = response(f.app, "c1");
  assert.equal(r1.status, "ok", r1.message);
  assert.match(r1.output, /settings=\.factory\/cards\/card_a\.json/);
  assert.match(r1.output, new RegExp(`refs=${U("pin")},${U("p1")}`), "고정 그림이 picked 보다 먼저");
  assert.match(r1.output, /token=\*\*\*/, "카드 방법(pixellab)에 필요한 키를 넘긴다(값은 가려짐)");
  assert.match(r1.output, /card=undefined/, "card 는 도구 인자가 아니라 중계가 쓰는 값: 도구엔 안 넘어간다");
  assert.match(response(f.app, "c2").output, /settings=\.factory\/cards\/card_c\.json refs=https:\/\/img\.example\/upload-api\/p1\.png token=undefined/, "코덱스 카드는 키가 필요 없다");
  assert.match(response(f.app, "c3").output, /settings=undefined/, "카드를 안 부르면 프로젝트 설정(없음) 그대로");
  assert.deepEqual(arts.map((a) => a.card ?? null), [{ id: "card_a", version: 2 }, { id: "card_c", version: 2 }, null], "카드로 부른 호출만 그림 정보에 카드가 실린다");
  assert.ok(!("card" in response(f.app, "c1")), "응답 파일에는 싣지 않는다");
});

test("pixel-art card 인자: 없는 카드·settings 와 같이 줌·카드를 안 받는 도구는 거절한다", { skip: !canSpawn && "자식 프로세스를 띄울 수 없는 환경" }, async (t) => {
  const f = fixture(t);
  artToolkit(f);
  writeCardFiles(f.app, [CARD("card_a", "싹이 단독 짤")], []);
  request(f.app, "d1", call("s1", { card: "없는 카드" }));
  request(f.app, "d2", call("s2", { card: "싹이 단독 짤", settings: "mine.json" }));
  request(f.app, "d3", call("s3", { card: 7 }));
  const b = mkBroker(f);
  await b.tick();
  assert.match(response(f.app, "d1").message, /카드를 찾지 못했어요: 없는 카드 .*싹이 단독 짤/);
  assert.match(response(f.app, "d2").message, /card 와 settings 는 같이/);
  assert.match(response(f.app, "d3").message, /카드 이름 또는 id/);
  for (const id of ["d1", "d2", "d3"]) assert.notEqual(response(f.app, id).status, "ok");
  // 같은 인자는 다른 도구에서 선언되지 않은 인자 취급이 아니라 카드를 안 받는다는 안내
  const tools = { "pixel-slice": { entry: "cli.py", layer: "internal", args: [{ name: "input", type: "path", required: true }], network: false, secrets: [], timeoutSec: 30 } };
  fs.writeFileSync(path.join(f.toolkit, "tools.json"), JSON.stringify({ version: 1, tools, studioTools: {} }));
  fs.writeFileSync(path.join(f.app, ".factory", "requests", "d4.json"), JSON.stringify({ id: "d4", tool: "toolkit.run", args: { command: "pixel-slice", args: { input: "a.png", card: "x" } } }));
  await b.tick();
  assert.match(response(f.app, "d4").message, /카드를 받지 않아요/);
});

// ───────── 그림 후보에 카드 붙이기 ─────────
function fakeServer() {
  const calls = [];
  const post = async (form) => {
    calls.push(Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `file:${v.name}`])));

    return { status: 200, data: {} };
  };

  return { calls, post };
}
const SRC = (extra = {}) => ({ project: "one-tiny-frame", subject: "싹이", kind: "image-prop", method: "pixellab", outputs: ["out/sheet.png"], summary: { steps: [], refs: [], refsFallback: "", cost: 1 }, ...extra });

test("그림 후보: 일감의 카드 → cardId·cardVersion 을 보내고, 호출의 card 가 있으면 그게 먼저, 카드가 없으면 안 보낸다", async (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.app, "out"), { recursive: true });
  fs.writeFileSync(path.join(f.app, "out", "sheet.png"), PNG);
  const run = async (jobId, card, source) => {
    const server = fakeServer();
    await createArtRegistrar({ appDir: f.app, jobId, appSlug: "one-tiny-frame", post: server.post, card }).register(source);

    return server.calls[0];
  };
  const jobCard = await run("job1", { id: "card_job", version: 4 }, SRC());
  assert.deepEqual([jobCard.cardId, jobCard.cardVersion], ["card_job", "4"]);
  const callCard = await run("job2", { id: "card_job", version: 4 }, SRC({ card: { id: "card_call", version: 1 } }));
  assert.deepEqual([callCard.cardId, callCard.cardVersion], ["card_call", "1"], "호출에 card 인자를 줬으면 그 카드");
  const none = await run("job3", null, SRC());
  assert.equal("cardId" in none, false);
  assert.equal("cardId" in (await run("job4", { id: "bad id", version: 1 }, SRC())), false, "형식이 이상한 카드 정보는 보내지 않는다");
  assert.equal("cardId" in (await run("job5", { id: "card_x", version: 0 }, SRC())), false);
});

// ───────── 실험 ─────────
test("실험: 카드를 불렀으면 card-settings.json 과 지시문 안내가 생기고, 안 불렀으면 없다(예전 파일도 지운다)", (t) => {
  const f = fixture(t);
  const card = { id: "card_a", name: "싹이 단독 짤", version: 2, tool: "pixel-art", method: "pixellab", pinnedUrl: U("pin") };
  const job = { id: "lab1", title: "카드 실험", planMarkdown: "해 보자", card, projectToolSettings: { version: 2, settings: CARD("card_a", "x").settings } };
  const work = path.join(f.dir, "work");
  const paths = prepareLab(work, job);
  const file = path.join(paths.dir, "card-settings.json");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).spec.cell_size, 128);
  const prompt = labPrompt({ job, dir: paths.dir, shared: paths.shared, workDir: work });
  assert.match(prompt, /결과물 카드 '싹이 단독 짤' \(판 2, 도구 pixel-art, 방법 pixellab\)/);
  assert.match(prompt, /card-settings\.json/);
  assert.ok(prompt.includes(U("pin")), "기본 그림 안내");
  assert.ok(prompt.indexOf("## 결과물 카드") < prompt.indexOf("## 실험 내용"));
  // 카드 없는 실험: 안내도 파일도 없다
  const plain = { id: "lab1", title: "x", planMarkdown: "해 보자" };
  assert.doesNotMatch(labPrompt({ job: plain, dir: paths.dir, shared: paths.shared, workDir: work }), /결과물 카드/);
  assert.equal(writeLabCard(paths.dir, plain), false);
  assert.equal(fs.existsSync(file), false, "카드 없이 다시 시작하면 예전 카드 설정이 남지 않는다");
  assert.equal(writeLabCard(paths.dir, { ...job, projectToolSettings: { settings: { version: 1, style: { notes: "z".repeat(20000) } } } }), false, "너무 크면 쓰지 않는다");
});

test("배선: 감독이 카드를 그림 등록기·설정 쓰기·카드 목록 받기·로그에 연결했다", () => {
  const src = fs.readFileSync(new URL("../supervisor.mjs", import.meta.url), "utf8");
  assert.match(src, /writeProjectSettings\(dir, job\.projectToolSettings, job\.approvedArts, job\.card\?\.rules \?\? null\)/);
  assert.match(src, /\/api\/factory\/cards\?appSlug=/, "호출 직전에 카드 목록을 받는다");
  assert.match(src, /writeCardFiles\(dir, job\.cards, job\.approvedArts\)/);
  assert.match(src, /card: job\.card \?\? null/, "그림 등록기에 일감의 카드를 준다");
  assert.match(src, /결과물 카드로 실행해요/);
  assert.match(src, /job\.cardMissing/);
});
