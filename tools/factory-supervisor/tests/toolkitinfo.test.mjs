// 툴킷 도구 목록 읽기(toolkitinfo.mjs) 시험: 가짜 툴킷 폴더에서 정적으로 읽고, 8KB 이하로 줄이고, 비밀값·절대 경로를 보내지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectToolkitInfo, projectSettingsSchemaHash, readModes, fitReport, leadingDoc, scanEntry, startToolkitReport } from "../toolkitinfo.mjs";

const SECRET = "SECRET-VALUE-123";
function makeKit(extraTools = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-"));
  fs.mkdirSync(path.join(dir, "toolkit"));
  fs.writeFileSync(path.join(dir, "toolkit", "anim.py"), '"""pixel-anim: 프레임을 GIF·WebP 움짤로 묶는다."""\nraise SystemExit("실행되면 안 돼요")\n');
  fs.writeFileSync(path.join(dir, "toolkit", "slice.py"), "# 시트를 소품별로 자른다\n# 두번째 줄\nimport os\n");
  fs.writeFileSync(
    path.join(dir, "cli.py"),
    `"""진입점"""
def build(sub):
    pa = sub.add_parser("pixel-anim")
    pa.add_argument("--frames")
    pa.add_argument("--fps", type=int)
    ps = sub.add_parser("pixel-slice")
    ps.add_argument("--input", required=True)
def run(a):
    if a.command == "pixel-anim":
        from toolkit.anim import make as fn
    elif a.command == "pixel-slice":
        from toolkit.slice import slice_sheet as fn
`,
  );
  const tools = {
    "pixel-anim": { description: "GIF 움짤 만들기", enabled: true, entry: "cli.py", args: [{ name: "frames", type: "string" }, { name: "out", type: "string" }], network: false, secrets: [], timeoutSec: 60 },
    "pixel-slice": { description: "스프라이트 시트 자르기", entry: "cli.py", args: [{ name: "input", type: "path", required: true }, { name: "output_dir", type: "path", required: true }], network: true, secrets: ["PIXELLAB_TOKEN", "bad name"], timeoutSec: 30 },
    ...extraTools,
  };
  fs.writeFileSync(path.join(dir, "tools.json"), JSON.stringify({ version: 1, tools, note: SECRET }));
  return dir;
}

test("도구·스크립트·docstring·옵션을 정적으로 읽는다(파이썬 실행 안 함)", () => {
  const r = collectToolkitInfo(makeKit());
  assert.equal(r.state, "ok");
  assert.equal(r.count, 2);
  const anim = r.tools.find((t) => t.id === "pixel-anim");
  assert.equal(anim.script, "toolkit/anim.py");
  assert.equal(anim.dir, "toolkit");
  assert.match(anim.doc, /움짤/);
  assert.deepEqual(anim.opts, ["frames", "fps"]);
  assert.deepEqual(anim.a, ["frames:string", "out:string"]);
  assert.deepEqual(anim.tags.sort(), ["gif"]);
  const slice = r.tools.find((t) => t.id === "pixel-slice");
  assert.match(slice.doc, /시트를 소품별로/);
  assert.deepEqual(slice.sec, ["PIXELLAB_TOKEN"], "키는 이름만, 형식이 틀린 이름은 버린다");
  assert.equal(slice.net, true);
  assert.match(anim.mod, /^\d{4}-\d{2}-\d{2}$/);
});

test("보고서에 비밀값·절대 경로가 없다", () => {
  const dir = makeKit();
  const text = JSON.stringify(collectToolkitInfo(dir));
  assert.ok(!text.includes(SECRET));
  assert.ok(!text.includes(dir.replaceAll("\\", "\\\\")) && !text.includes(os.tmpdir().replaceAll("\\", "\\\\")));
});

test("툴킷이 없거나 tools.json 이 깨졌으면 던지지 않고 상태로 알린다", () => {
  assert.equal(collectToolkitInfo(path.join(os.tmpdir(), "no-such-kit-xyz")).state, "missing");
  const dir = makeKit();
  fs.writeFileSync(path.join(dir, "tools.json"), "{ not json");
  assert.equal(collectToolkitInfo(dir).state, "error");
});

test("도구가 많아도 본문이 8KB 이하로 줄어든다", () => {
  const many = {};
  for (let i = 0; i < 40; i++) many[`tool-${i}`] = { description: "설명이 긴 도구 ".repeat(40), entry: "cli.py", args: Array.from({ length: 20 }, (_, j) => ({ name: `arg_${j}`, type: "string", description: "x".repeat(100) })), network: false, secrets: [], timeoutSec: 60 };
  const r = collectToolkitInfo(makeKit(many));
  assert.ok(Buffer.byteLength(JSON.stringify({ device: "main-pc", toolkit: r })) < 8192);
  assert.equal(r.count, 40, "도구는 40개까지 읽는다");
  assert.ok(r.tools.length >= 1);
  assert.equal(r.count, r.tools.length + (r.omitted ?? 0));
  const tiny = fitReport(r.tools.map((t) => ({ ...t, desc: "d", doc: "", opts: [], args: [], out: [] })), { state: "ok" }, 600);
  assert.ok(tiny.omitted > 0 && Buffer.byteLength(JSON.stringify(tiny)) <= 600);
});

test("leadingDoc·scanEntry", () => {
  assert.equal(leadingDoc('#!/usr/bin/env python\n"""한 줄 설명"""\nx=1').trim(), "한 줄 설명");
  assert.equal(leadingDoc("x = 1\n"), "");
  assert.equal(scanEntry("").fallbackModule, null);
});

test("startToolkitReport: 같은 내용은 다시 보내지 않고 같은 경로(device-stats)로 보낸다", async () => {
  const calls = [];
  const api = async (method, p, body) => (calls.push({ method, p, body }), { status: 200 });
  const s = startToolkitReport({ api, toolkitDir: makeKit(), everyMs: 1e9 });
  await s.tick();
  await s.tick();
  s.stop();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].p, "/api/factory/device-stats");
  assert.equal(calls[0].body.device, "main-pc");
  assert.equal(calls[0].body.toolkit.state, "ok");
});

test("모드: 있으면 담고(clip→cut), 없으면 칸 자체가 없고, 깨진 항목은 건너뛴다", () => {
  const modes = [
    { id: "sprite", purpose: "game", when: "한 장짜리 소품", legacy: "mode 없이 layout=single", io: { in: ["설명"], out: ["PNG", "JSON"] } },
    { id: "scene", purpose: "clip", when: "장면 한 컷", legacy: "background=keep" },
    null,
    "깨짐",
    { id: "Bad Id", purpose: "game" },
    { id: "sprite", purpose: "game" },
  ];
  const r = collectToolkitInfo(makeKit({ "pixel-codex": { description: "코덱스 도트", entry: "cli.py", args: [], modes }, "bad-modes": { description: "깨진 모드", entry: "cli.py", args: [], modes: "문자열" } }));
  assert.equal(r.state, "ok");
  const codex = r.tools.find((t) => t.id === "pixel-codex");
  assert.deepEqual(codex.m.map((m) => [m.id, m.p]), [["sprite", "game"], ["scene", "cut"]]);
  assert.equal(codex.m[0].lg, "mode 없이 layout=single");
  assert.equal(codex.m[0].io, "설명 → PNG, JSON");
  assert.equal(r.tools.find((t) => t.id === "pixel-anim").m, undefined, "모드 없는 도구는 m 이 없다");
  assert.equal(r.tools.find((t) => t.id === "bad-modes").m, undefined, "modes 가 배열이 아니면 없는 것으로");
  assert.deepEqual(readModes(undefined), []);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 8192);
});

test("새 구조: studioTools·layer·optionalSecrets 를 담고, 옛 tools.json 이면 칸 자체가 없다", () => {
  const dir = makeKit({ "pixel-art": { description: "도트 이미지 생성", layer: "studio", entry: "cli.py", args: [{ name: "kind", type: "string", required: true }], network: true, secrets: [], optionalSecrets: ["PIXELLAB_TOKEN", "bad name"], timeoutSec: 900 } });
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "tools.json"), "utf8"));
    manifest.tools["pixel-anim"].layer = "internal";
    manifest.studioTools = {
      "pixel-art": {
        title: "도트 이미지 생성",
        description: "사람이 쓰는 도구",
        methodOrder: ["request", "project", "default"],
        refOrder: ["①picked", "②subject"],
        refsMax: 4,
        kinds: {
          "image-prop": { label: "소품·캐릭터 한 장", background: "transparent", defaultMethod: "codex", methods: ["codex", "pixellab", "claude"] },
          "motion-clip": { label: "움짤", background: "keep", defaultMethod: "manual", methods: ["manual", "codex"] },
          "Bad Kind": { label: "x" },
        },
      },
      "Bad Tool": { kinds: {} },
    };
    fs.writeFileSync(path.join(dir, "tools.json"), JSON.stringify(manifest));
    const r = collectToolkitInfo(dir);
    assert.equal(r.state, "ok");
    const art = r.tools.find((t) => t.id === "pixel-art");
    assert.equal(art.ly, "studio");
    assert.deepEqual(art.osec, ["PIXELLAB_TOKEN"], "선택 키는 이름만, 형식이 틀리면 버림");
    assert.deepEqual(art.sec, []);
    assert.equal(r.tools.find((t) => t.id === "pixel-anim").ly, "internal");
    assert.equal(r.tools.find((t) => t.id === "pixel-slice").ly, undefined, "layer 가 없는 도구는 칸이 없다");
    assert.equal(r.studio.length, 1);
    assert.deepEqual(r.studio[0].k.map((k) => [k.id, k.def, k.m.length]), [["image-prop", "codex", 3], ["motion-clip", "manual", 2]]);
    assert.deepEqual(r.studio[0].ro, ["①picked", "②subject"]);
    assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 7600);
    assert.equal(JSON.stringify(r).includes(SECRET), false);

    delete manifest.studioTools;
    fs.writeFileSync(path.join(dir, "tools.json"), JSON.stringify(manifest));
    const old = collectToolkitInfo(dir);
    assert.equal(old.studio, undefined, "studioTools 가 없으면 지금처럼");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("스튜디오 목록이 있어도 도구가 많으면 8KB 이하로 줄어든다", () => {
  const tools = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, desc: "설명 ".repeat(60), entry: "cli.py", script: "cli.py", dir: ".", args: [], out: [], tags: [], net: false, sec: [], optSec: [], layer: "internal", to: 60, en: true, mod: "2026-10-14", opts: [], modes: [] }));
  const studio = [{ id: "pixel-art", title: "도트", desc: "긴 설명 ".repeat(80), methodOrder: ["a"], refOrder: ["b"], refsMax: 4, kinds: [{ id: "k1", label: "종류", output: "PNG", background: "keep", defaultMethod: "codex", methods: ["codex", "pixellab"] }] }];
  const r = fitReport(tools, { state: "ok" }, 7600, studio);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 7600);
  assert.equal(r.studio[0].id, "pixel-art", "스튜디오 도구는 남는다");
});

test("프로젝트 설정 스키마 지문(psh): 키 순서와 상관없이 같고, 내용이 바뀌면 달라지고, 스키마가 없으면 빼고 보낸다", () => {
  const dir = makeKit();
  assert.equal("psh" in collectToolkitInfo(dir), false, "스키마가 없으면 지문도 없다");
  fs.mkdirSync(path.join(dir, "schemas"));
  const file = path.join(dir, "schemas", "project-settings.schema.json");
  fs.writeFileSync(file, JSON.stringify({ b: 1, a: { y: [1, 2], x: 2 } }));
  const first = collectToolkitInfo(dir).psh;
  assert.match(first, /^[0-9a-f]{16}$/);
  assert.equal(projectSettingsSchemaHash(dir), first);
  fs.writeFileSync(file, JSON.stringify({ a: { x: 2, y: [1, 2] }, b: 1 }, null, 2));
  assert.equal(collectToolkitInfo(dir).psh, first, "키 순서·들여쓰기는 지문에 영향이 없다");
  fs.writeFileSync(file, JSON.stringify({ a: { x: 3, y: [1, 2] }, b: 1 }));
  assert.notEqual(collectToolkitInfo(dir).psh, first);
  fs.writeFileSync(file, "{깨진 json");
  assert.equal("psh" in collectToolkitInfo(dir), false, "읽지 못하면 빼고 보낸다");
  assert.ok(Buffer.byteLength(JSON.stringify(collectToolkitInfo(dir))) <= 7600);
});
