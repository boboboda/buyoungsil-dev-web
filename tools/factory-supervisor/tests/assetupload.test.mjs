// 도구 중계 결과 이미지 올리기(assetupload.mjs)와 작업 규칙의 이미지 도구 안내(brokerRules) 시험.
// 실제 서버·외부 서비스는 쓰지 않는다. 업로드는 가짜 post 함수로 받는다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ASSET_MAX_BYTES, assetLabel, createAssetUploader, listAssetImages, pickAssetUploads } from "../assetupload.mjs";
import { brokerRules, brokerSettings, createBroker, imageToolRules } from "../toolbroker.mjs";

const canSpawn = spawnSync(process.execPath, ["--version"], { windowsHide: true }).status === 0;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-asset-test-"));
  t.after(() => {
    assert.ok(path.basename(dir).startsWith("factory-asset-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const app = path.join(dir, "app");
  const assets = path.join(app, ".factory", "assets");
  fs.mkdirSync(assets, { recursive: true });
  return { dir, app, assets, toolkit: path.join(dir, "game-toolkit") };
}
const put = (f, name, data = PNG) => {
  const full = path.join(f.assets, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
  return full;
};
function fakeServer(statuses = []) {
  const calls = [];
  const post = async (form) => {
    calls.push({ jobId: form.get("jobId"), label: form.get("label"), name: form.get("file").name, type: form.get("file").type, size: form.get("file").size });
    const s = statuses.length ? statuses.shift() : 200;
    if (s instanceof Error) throw s;
    if (typeof s === "object") return s;
    return { status: s, data: {} };
  };
  return { calls, post };
}
function uploader(f, server) {
  const logs = [];
  const u = createAssetUploader({ appDir: f.app, jobId: "job1", post: server.post, log: (level, m) => logs.push(`${level}: ${m}`) });
  return { u, logs };
}

test("label: asset-<파일 이름>, 서버 LABEL_RE(영문·숫자·_- 40자)에 맞게 정리", () => {
  const LABEL_RE = /^[A-Za-z0-9_-]{1,40}$/;
  assert.equal(assetLabel("hero.png"), "asset-hero");
  assert.equal(assetLabel("sub/dir/coin_gold.webp"), "asset-coin_gold");
  assert.equal(assetLabel("슬라임 v2.png"), "asset-____v2");
  const long = assetLabel(`${"a".repeat(80)}.png`);
  assert.equal(long.length, 40);
  for (const n of ["hero.png", "슬라임 v2.png", `${"a".repeat(80)}.png`, "x.y.z.gif", "-.png"]) assert.match(assetLabel(n), LABEL_RE, n);
});

test("대상 고르기: 이미지 확장자만, -raw 제외, 0바이트·10MB 초과 제외, 처리한 것 제외", (t) => {
  const f = fixture(t);
  put(f, "hero.png");
  put(f, "hero-raw.png");
  put(f, "hero.report.json", "{}");
  put(f, "tile.JPG");
  put(f, "anim.gif");
  put(f, "bg.webp");
  put(f, "empty.png", Buffer.alloc(0));
  put(f, "nested/coin.png");
  const files = listAssetImages(f.app);
  assert.deepEqual(files.map((x) => x.rel).sort(), [".factory/assets/anim.gif", ".factory/assets/bg.webp", ".factory/assets/empty.png", ".factory/assets/hero-raw.png", ".factory/assets/hero.png", ".factory/assets/nested/coin.png", ".factory/assets/tile.JPG"]);
  const { pick, skipped } = pickAssetUploads(files);
  assert.deepEqual(pick.map((x) => x.name).sort(), ["anim.gif", "bg.webp", "coin.png", "hero.png", "tile.JPG"]);
  assert.deepEqual(Object.fromEntries(skipped.map((x) => [x.name, x.why])), { "hero-raw.png": "raw", "empty.png": "empty" });
  // 크기 상한은 목록 값으로 확인(10MB 파일을 실제로 만들지 않는다)
  const big = { ...pick[0], size: ASSET_MAX_BYTES + 1, key: "big" };
  assert.equal(pickAssetUploads([big]).skipped[0].why, "too-big");
  assert.equal(pickAssetUploads([{ ...pick[0], size: ASSET_MAX_BYTES }]).pick.length, 1);
  // 이미 처리한 것(경로+수정시각)은 빠진다
  assert.equal(pickAssetUploads(files, new Set(files.map((x) => x.key))).pick.length, 0);
});

test("업로드: 같은 파일은 한 번만, 시작 때 있던 파일은 안 올림, 수정되면 다시", async (t) => {
  const f = fixture(t);
  put(f, "old.png");
  const server = fakeServer();
  const { u, logs } = uploader(f, server);
  u.seed();
  await u.upload();
  assert.equal(server.calls.length, 0, "이전 일감의 파일은 올리지 않는다");
  put(f, "slime.png");
  put(f, "slime-raw.png");
  await Promise.all([u.upload(), u.upload()]); // 동시에 불려도 한 번
  await u.upload();
  assert.deepEqual(server.calls, [{ jobId: "job1", label: "asset-slime", name: "slime.png", type: "image/png", size: PNG.length }]);
  assert.equal(u.uploaded, 1);
  const p = path.join(f.assets, "slime.png");
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(p, later, later);
  await u.upload();
  assert.equal(server.calls.length, 2, "수정 시각이 바뀌면 다시 올린다(서버는 같은 label 이라 주소만 바꿈)");
  assert.ok(logs.every((l) => !/raw/.test(l)));
  assert.match(logs.join("\n"), /도구가 만든 이미지 올림: slime\.png → asset-slime/);
});

test("한도(400 limit): 그 일감의 이미지 올리기만 멈추고 예외 없이 끝난다", async (t) => {
  const f = fixture(t);
  const server = fakeServer([{ status: 400, data: { limit: 30, message: "스크린샷은 지시당 30장까지입니다." } }]);
  const { u, logs } = uploader(f, server);
  u.seed();
  put(f, "a.png");
  put(f, "b.png");
  await u.upload();
  put(f, "c.png");
  await u.upload();
  assert.equal(server.calls.length, 1);
  assert.equal(u.stopped, true);
  assert.match(logs.join("\n"), /한도\(지시당 30장\)/);
});

test("409(취소됨)·서버 오류·네트워크 오류는 로그만 남기고 일감을 실패시키지 않는다", async (t) => {
  const f = fixture(t);
  // 5xx·네트워크: 3번까지 다음 기회에 다시
  const server = fakeServer([500, new TypeError("fetch failed"), 502]);
  const { u, logs } = uploader(f, server);
  u.seed();
  put(f, "a.png");
  for (let i = 0; i < 5; i++) await u.upload();
  assert.equal(server.calls.length, 3, "세 번 시도 뒤에는 포기");
  assert.equal(u.stopped, false);
  assert.match(logs.join("\n"), /실패\(500, 1\/3\)/);
  assert.match(logs.join("\n"), /오류\(2\/3\): a\.png \(TypeError\)/);
  // 400(형식 오류 등)은 다시 해도 같으므로 한 번만
  const s2 = fakeServer([413]);
  const f2 = fixture(t);
  const { u: u2 } = uploader(f2, s2);
  put(f2, "x.png");
  await u2.upload();
  await u2.upload();
  assert.equal(s2.calls.length, 1);
  // 409: 멈춤
  const s3 = fakeServer([{ status: 409, data: { cancelled: true, status: "cancelled" } }]);
  const f3 = fixture(t);
  const { u: u3, logs: l3 } = uploader(f3, s3);
  put(f3, "a.png");
  put(f3, "b.png");
  await u3.upload();
  assert.equal(s3.calls.length, 1);
  assert.equal(u3.stopped, true);
  assert.match(l3.join("\n"), /409, 취소됨/);
});

test("규칙 블록: 이미지 도구 안내는 툴킷 매니페스트에 있는 도구 이름만 쓴다", (t) => {
  const f = fixture(t);
  const write = (names) => {
    fs.mkdirSync(f.toolkit, { recursive: true });
    fs.writeFileSync(path.join(f.toolkit, "tools.json"), JSON.stringify({ version: 1, tools: Object.fromEntries(names.map((n) => [n, { entry: "cli.py" }])) }));
  };
  // 툴킷 없음·toolkitDir 안 줌: 예전 규칙 그대로
  assert.equal(imageToolRules(f.toolkit), "");
  assert.equal(brokerRules("allow"), brokerRules("allow", f.toolkit));
  assert.equal(brokerRules("off", f.toolkit), "");
  write(["env-doctor", "pixel-validate"]);
  assert.equal(imageToolRules(f.toolkit), "", "이미지 생성 도구가 없으면 안내 생략");
  write(["pixel-codex"]);
  let r = brokerRules("allow", f.toolkit);
  assert.match(r, /`pixel-codex` 를 요청/);
  assert.doesNotMatch(r, /pixel-generate/);
  assert.doesNotMatch(r, /asset-export/);
  assert.match(r, /다시 요청/);
  write(["pixel-codex", "pixel-generate", "asset-export"]);
  r = brokerRules("report", f.toolkit);
  assert.match(r, /`pixel-codex` 또는 `pixel-generate`/);
  assert.match(r, /`asset-export` 도구로/);
  assert.match(r, /\.factory\/ 안 파일은 커밋되지 않아요/);
  // 매니페스트가 깨져 있으면 안내 생략
  fs.writeFileSync(path.join(f.toolkit, "tools.json"), "{not json");
  assert.equal(imageToolRules(f.toolkit), "");
});

const FAKE_CLI = `
const fs = require("node:fs"), path = require("node:path");
const name = (process.argv.find((a) => a.startsWith("--name=")) || "--name=sprite").slice(7);
fs.writeFileSync(path.join(process.env.FACTORY_ASSETS_DIR, name + "-raw.png"), "raw");
fs.writeFileSync(path.join(process.env.FACTORY_ASSETS_DIR, name + ".png"), "png");
fs.writeFileSync(path.join(process.env.FACTORY_ASSETS_DIR, name + ".report.json"), "{}");
`;

test("중계 흐름: 요청이 ok 로 끝나면 onResult 로 새 정리본만 한 번 올린다", { skip: !canSpawn && "자식 프로세스를 띄울 수 없는 환경" }, async (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.app, ".factory", "requests"), { recursive: true });
  fs.mkdirSync(f.toolkit, { recursive: true });
  fs.writeFileSync(path.join(f.toolkit, "tools.json"), JSON.stringify({ version: 1, tools: { "pixel-codex": { entry: "cli.py", args: [{ name: "name", type: "string" }] } } }));
  fs.writeFileSync(path.join(f.toolkit, "cli.py"), FAKE_CLI);
  const server = fakeServer();
  const { u } = uploader(f, server);
  u.seed();
  const pending = [];
  const b = createBroker({
    appDir: f.app,
    jobId: "job1",
    getSettings: () => brokerSettings({ mode: "allow" }),
    toolkitDir: f.toolkit,
    pythonCmd: process.execPath,
    onResult: (rec) => {
      if (rec.status === "ok") pending.push(u.upload());
    },
  });
  const req = (id, args) => fs.writeFileSync(path.join(f.app, ".factory", "requests", `${id}.json`), JSON.stringify({ id, tool: "toolkit.run", args: { command: "pixel-codex", args } }));
  req("r1", { name: "slime" });
  req("r2", { bad: 1 }); // denied: 올리지 않음
  await b.tick();
  await Promise.all(pending);
  await u.upload(); // 일감 종료 때 한 번 더(이미 올린 건 다시 안 감)
  assert.deepEqual(server.calls.map((c) => c.label), ["asset-slime"]);
  assert.equal(pending.length, 1);
});
