// 도구 일감(kind=tool, 2-3) 직접 실행기(tooljob.mjs) 시험. 실제 외부 서비스·키는 쓰지 않는다.
// 툴킷은 임시 폴더에 가짜(pixel-art 흉내 JS)로 만들고, 그림 저장소 업로드(post)는 가짜 함수로 받는다. 키 값은 시험용 가짜 문자열.
// 실행: node tools/factory-supervisor/tests/tooljob.test.mjs  (npm run test:tool-jobs)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { AI_TURN_METHODS, buildCallArgs, deleteToolJobFolder, kindOf, prepareToolJob, readToolInput, runToolJob, toolJobDirOf } from "../tooljob.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SECRET = "fake-pixellab-token-ZZZ-12345";

// 가짜 pixel-art: result.json 과 그림 파일을 output_dir 에 만든다. subject 가 over-limit 이면 비용 한도 신호로 실패한다
const CLI = `
const fs = require("node:fs"), path = require("node:path");
const [cmd, ...args] = process.argv.slice(2);
const get = (k) => args.find((a) => a.startsWith("--" + k + "="))?.slice(k.length + 3);
console.log("cmd=" + cmd + " method=" + get("method") + " hasToken=" + (process.env.PIXELLAB_TOKEN ? "yes" : "no"));
if (get("subject") === "over-limit") { console.error(JSON.stringify({ error: "cost", needs_confirmation: true })); process.exit(3); }
if (get("subject") === "boom") { console.error("boom happened"); process.exit(2); }
const out = get("output_dir");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "a.png"), Buffer.from("89504e470d0a1a0a0000", "hex"));
fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({
  project: "one-tiny-frame", subject: get("subject"), kind: get("kind"), method: get("method") || "codex", steps: [{ tool: "pixel-codex" }],
  refs: [{ reason: "①picked" }], cost: get("method") === "pixellab" ? 2 : 0, outputs: [out + "/a.png"], created_at: "2026-10-15T00:00:00Z",
}));
`;
const TOOLS = {
  "pixel-art": {
    entry: "cli.py",
    layer: "studio",
    args: [
      { name: "kind", type: "string", required: true },
      { name: "subject", type: "string", required: true },
      { name: "prompt", type: "string" },
      { name: "project", type: "string" },
      { name: "method", type: "string" },
      { name: "refs", type: "string" },
      { name: "settings", type: "path" },
      { name: "frames", type: "int" },
      { name: "output_dir", type: "path", required: true },
    ],
    network: true,
    secrets: [],
    optionalSecrets: ["PIXELLAB_TOKEN"],
    timeoutSec: 30,
  },
};

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-tooljob-test-"));
  t.after(() => {
    assert.ok(path.basename(dir).startsWith("factory-tooljob-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const toolkit = path.join(dir, "game-toolkit");
  fs.mkdirSync(toolkit, { recursive: true });
  fs.writeFileSync(path.join(toolkit, "tools.json"), JSON.stringify({ version: 1, tools: TOOLS }));
  fs.writeFileSync(path.join(toolkit, "cli.py"), CLI);

  return { dir, workDir: path.join(dir, "factory"), toolkit };
}

function job(over = {}) {
  return {
    id: "job_tool_1",
    appSlug: "one-tiny-frame",
    title: "싹이 2장",
    kind: "tool",
    attempts: 1,
    requiredSecrets: [],
    toolInput: { count: 1, subjects: ["싹이"], extra: "", refArtIds: [], estimatedCost: 0 },
    card: { id: "card_abc", name: "싹이 단독 짤", version: 3, tool: "pixel-art", method: "codex", rules: { sameSubject: true, sameKind: true }, pinnedUrl: null },
    projectToolSettings: { version: 3, settings: { version: 1, results: { allowed_kinds: ["image-prop"], default_kind: "image-prop" }, style: { notes: "둥근 몸" }, cost: { pixellab_per_job: 5 } } },
    approvedArts: [{ url: "https://img.example/ok.png", subject: "싹이", kind: "image-prop" }],
    pickedArts: [{ url: "https://img.example/pin.png", subject: "싹이", kind: "image-prop" }],
    ...over,
  };
}

function deps(f, over = {}) {
  const logs = [];
  const forms = [];
  const spawned = [];
  const d = {
    workDir: f.workDir,
    toolkitDir: f.toolkit,
    pythonCmd: process.execPath, // 가짜 진입점은 JS
    secrets: { PIXELLAB_TOKEN: SECRET, OTHER_KEY_NOT_ALLOWED: "other-secret-value-9999" },
    post: async (form) => {
      forms.push(form);
      const n = forms.length;

      return { status: 200, data: { ok: true, art: { id: `art${n}`, url: `https://img.example/new${n}.png`, subject: String(form.get("subject")), kind: String(form.get("kind")) } } };
    },
    log: (level, m) => logs.push(`${level}: ${m}`),
    redact: (s) => s,
    fetchImpl: async () => ({ status: 200, body: null }), // 참고 그림 점검(시작 전 접속)은 늘 성공하는 가짜
    isStopped: () => false,
    // 호출하는 순간의 폴더·환경·설정 파일을 기록한 뒤 진짜로 실행한다
    spawnImpl: (cmd, args, opts) => {
      let settings = null;
      try {
        settings = JSON.parse(fs.readFileSync(path.join(opts.cwd, ".factory", "project-settings.json"), "utf8"));
      } catch {
        /* 설정 파일이 없을 수 있다 */
      }
      spawned.push({ cwd: opts.cwd, envKeys: Object.keys(opts.env), hasToken: opts.env.PIXELLAB_TOKEN === SECRET, other: opts.env.OTHER_KEY_NOT_ALLOWED, argv: args.slice(1), settings });

      return spawn(cmd, args, opts);
    },
    ...over,
  };

  return { d, logs, forms, spawned };
}

test("입력 읽기: 대상 1~8개·장 수 1~8·전체 16장, 이상하면 이유를 돌려준다", () => {
  assert.deepEqual(readToolInput({ count: 2, subjects: [" 싹이 "], extra: "  밝게\n  ", confirmed: true }), { subjects: ["싹이"], count: 2, extra: "밝게", confirmed: true });
  assert.match(readToolInput(null).error, /입력/);
  assert.match(readToolInput({ count: 1, subjects: [] }).error, /대상/);
  assert.match(readToolInput({ count: 0, subjects: ["a"] }).error, /장 수/);
  assert.match(readToolInput({ count: 8, subjects: ["a", "b", "c"] }).error, /16장/);
});

test("호출 인자: 설명서(tools.json)가 선언한 인자만, 프롬프트는 대상 이름 + 추가 지시, 모션 종류만 프레임", () => {
  const declared = new Set(["kind", "subject", "prompt", "project", "method", "frames", "output_dir"]);
  const card = { method: "pixellab" };
  const a = buildCallArgs({ card, appSlug: "p-app", settings: { results: { default_kind: "image-prop" }, motion: { frames: 8 } }, subject: "싹이", extra: "웃는 얼굴", outDir: "out/s01-1", declared });
  assert.deepEqual(a, { kind: "image-prop", subject: "싹이", project: "p-app", output_dir: "out/s01-1", prompt: "싹이. 웃는 얼굴", method: "pixellab" });
  const m = buildCallArgs({ card: { method: "" }, appSlug: "p-app", settings: { results: { default_kind: "motion-game" }, motion: { frames: 6, preset: "idle" } }, subject: "싹이", extra: "", outDir: "o", declared });
  assert.equal(m.frames, 6);
  assert.equal(m.prompt, "싹이");
  assert.equal("method" in m, false, "방법이 비면 프로젝트 설정 기본을 따른다");
  assert.equal("preset" in m, false, "선언 안 된 인자는 빼다");
  assert.equal(kindOf({ results: { default_kind: "nope" } }), "image-prop");
});

test("실행: 임시 폴더에서만 돌고 카드 id·판 번호가 그림에 붙고 업로드 뒤 폴더를 정리한다", async (t) => {
  const f = fixture(t);
  const { d, forms, spawned, logs } = deps(f);
  const j = job({ toolInput: { count: 2, subjects: ["싹이"], extra: "밝게", refArtIds: [], estimatedCost: 0 } });
  const out = await runToolJob(j, d);

  assert.equal(out.status, "done", JSON.stringify(out));
  assert.equal(spawned.length, 2, "장 수만큼 도구를 부른다");
  const dir = toolJobDirOf(f.workDir, j.id);
  for (const s of spawned) assert.ok(path.resolve(s.cwd) === path.resolve(dir), `cwd=${s.cwd}`);
  assert.equal(forms.length, 2, "그림 후보 2장을 올림");
  for (const form of forms) {
    assert.equal(form.get("cardId"), "card_abc");
    assert.equal(form.get("cardVersion"), "3");
    assert.equal(form.get("jobId"), j.id);
  }
  assert.equal(out.toolResult.arts.length, 2);
  assert.equal(out.toolResult.cost, 0);
  assert.equal(out.folder, "deleted");
  assert.equal(fs.existsSync(dir), false, "업로드를 확인한 뒤 임시 폴더를 지웠다");
  assert.ok(fs.existsSync(path.join(f.workDir, "tooljobs")), "tooljobs 루트는 남는다");
  assert.ok(logs.some((l) => /임시 폴더를 정리했어요/.test(l)));
  assert.match(spawned[0].argv.join(" "), /--prompt=싹이\. 밝게/);
  assert.match(spawned[0].argv.join(" "), /--refs=https:\/\/img\.example\/pin\.png/, "카드의 고정 그림이 참고 그림 맨 앞");
});

test("키: 선언된(requiredSecrets) 것만, 이 방법의 키만, 호출하는 순간에만. 값은 로그·결과에 없다", async (t) => {
  const f = fixture(t);
  // codex 방법: 키 없이
  const a = deps(f);
  const r1 = await runToolJob(job({ requiredSecrets: ["PIXELLAB_TOKEN"] }), a.d);
  assert.equal(r1.status, "done");
  assert.equal(a.spawned[0].hasToken, false, "codex 방법은 PixelLab 키를 붙이지 않는다");
  assert.equal(a.spawned[0].other, undefined, "선언하지 않은 키는 없다");
  // pixellab 방법: 선언된 키만
  const b = deps(f);
  const j = job({ requiredSecrets: ["PIXELLAB_TOKEN"], card: { ...job().card, method: "pixellab" }, toolInput: { count: 1, subjects: ["싹이"], extra: "", refArtIds: [], estimatedCost: 1 } });
  const r2 = await runToolJob(j, b.d);
  assert.equal(r2.status, "done");
  assert.equal(b.spawned[0].hasToken, true);
  assert.equal(b.spawned[0].other, undefined);
  assert.equal(r2.toolResult.cost, 2, "실제 비용은 result.json 의 값");
  assert.equal(b.spawned[0].envKeys.some((k) => /TOKEN$/.test(k) && k !== "PIXELLAB_TOKEN"), false, "감독 프로그램 토큰류는 물려주지 않는다");
  const text = JSON.stringify([r1, r2, a.logs, b.logs]);
  assert.equal(text.includes(SECRET), false);
  // pixellab 인데 일감이 키를 선언하지 않았으면 실행하지 않는다
  const c = deps(f);
  const r3 = await runToolJob(job({ requiredSecrets: [], card: { ...job().card, method: "pixellab" } }), c.d);
  assert.equal(r3.status, "failed");
  assert.equal(c.spawned.length, 0);
  assert.match(r3.failReason, /PIXELLAB_TOKEN/);
});

test("비용 한도(needs_confirmation): 도구가 한도 신호를 내면 멈추고, 이미 만든 그림은 올린 채 보고한다", async (t) => {
  const f = fixture(t);
  const { d, forms, spawned } = deps(f);
  const j = job({ toolInput: { count: 1, subjects: ["싹이", "over-limit", "나중"], extra: "", refArtIds: [], estimatedCost: 3 } });
  const out = await runToolJob(j, d);

  assert.equal(out.status, "needs_confirmation");
  assert.equal(out.toolResult.needsConfirmation, true);
  assert.equal(forms.length, 1, "한도 전에 만든 1장은 이미 올렸다");
  assert.equal(spawned.length, 2, "한도에서 멈추고 나머지는 부르지 않는다");
  assert.match(out.failReason, /비용 한도/);
});

test("사람이 확인한 일감(confirmed)은 카드 설정의 비용 한도를 건너뛴다", async (t) => {
  const f = fixture(t);
  const normal = deps(f);
  await runToolJob(job(), normal.d);
  assert.equal(normal.spawned[0].settings.cost.pixellab_per_job, 5, "보통은 카드 설정의 한도가 그대로");
  const sure = deps(f);
  await runToolJob(job({ toolInput: { count: 1, subjects: ["싹이"], extra: "", confirmed: true } }), sure.d);
  assert.equal("cost" in sure.spawned[0].settings, false);
  assert.ok(sure.spawned[0].settings.references.approved.length >= 1, "승인 그림 합치기는 그대로");
});

test("AI 턴이 필요한 방법은 지원 안 함으로 거절한다 (도구는 부르지 않는다)", async (t) => {
  const f = fixture(t);
  AI_TURN_METHODS.add("llm-post");
  t.after(() => AI_TURN_METHODS.delete("llm-post"));
  const { d, spawned } = deps(f);
  const out = await runToolJob(job({ card: { ...job().card, method: "llm-post" } }), d);

  assert.equal(out.status, "failed");
  assert.match(out.failReason, /AI 턴이 필요해서 도구 일감으로는 지원하지 않아요/);
  assert.equal(spawned.length, 0);
  assert.equal(fs.existsSync(path.join(f.workDir, "tooljobs")), false, "폴더도 만들지 않았다");
});

test("카드가 없거나 입력이 이상하면 도구를 부르지 않고 실패로 보고한다", async (t) => {
  const f = fixture(t);
  const { d, spawned } = deps(f);
  const noCard = await runToolJob(job({ card: undefined }), d);
  assert.equal(noCard.status, "failed");
  assert.match(noCard.failReason, /카드/);
  const badInput = await runToolJob(job({ toolInput: { count: 99, subjects: ["a"] } }), d);
  assert.equal(badInput.status, "failed");
  assert.equal(spawned.length, 0);
  const noTool = await runToolJob(job({ card: { ...job().card, tool: "nope" } }), d);
  assert.match(noTool.failReason, /nope/);
});

test("도구가 실패하면 실패 이유를 남기고, 일부만 만들면 완료로 보고하되 실패 건수를 적는다", async (t) => {
  const f = fixture(t);
  const a = deps(f);
  const all = await runToolJob(job({ toolInput: { count: 1, subjects: ["boom"], extra: "" } }), a.d);
  assert.equal(all.status, "failed");
  assert.match(all.failReason, /만든 그림이 없어요/);
  assert.equal(a.forms.length, 0);
  const b = deps(f);
  const some = await runToolJob(job({ id: "job_tool_2", toolInput: { count: 1, subjects: ["싹이", "boom"], extra: "" } }), b.d);
  assert.equal(some.status, "done");
  assert.match(some.summary, /1\/2건/);
  assert.match(some.summary, /실패 1건/);
});

test("업로드를 확인하지 못하면 임시 폴더를 남기고 실패로 보고한다 (정리 함수로만 지움)", async (t) => {
  const f = fixture(t);
  let tries = 0;
  const { d } = deps(f, { post: async () => (tries++, { status: 500, data: {} }) });
  const j = job();
  const out = await runToolJob(j, d);

  assert.equal(out.status, "failed");
  assert.match(out.failReason, /올리지 못한/);
  assert.equal(out.folder, "kept");
  assert.ok(fs.existsSync(toolJobDirOf(f.workDir, j.id)), "그림이 폴더에 남아 있다");
  assert.ok(tries >= 1);
  assert.equal(deleteToolJobFolder(f.workDir, j.id), "deleted");
  assert.equal(deleteToolJobFolder(f.workDir, j.id), "missing");
});

test("취소·종료(isStopped)면 도구를 더 부르지 않는다", async (t) => {
  const f = fixture(t);
  const { d, spawned } = deps(f, { isStopped: () => true });
  const out = await runToolJob(job(), d);

  assert.equal(out.status, "failed");
  assert.match(out.failReason, /중지/);
  assert.equal(spawned.length, 0);
});

test("정리 함수: id 형식·tooljobs 밖·일반 폴더가 아니면 지우지 않는다", async (t) => {
  const f = fixture(t);
  assert.throws(() => toolJobDirOf(f.workDir, "../escape"), /형식/);
  assert.throws(() => deleteToolJobFolder(f.workDir, "a/b"), /형식/);
  assert.equal(deleteToolJobFolder(f.workDir, "nothing_here"), "missing");
  const dir = prepareToolJob(f.workDir, "keep_me");
  fs.writeFileSync(path.join(dir, "x.txt"), "x");
  const other = path.join(f.dir, "outside");
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, "important.txt"), "keep");
  assert.equal(deleteToolJobFolder(f.workDir, "keep_me"), "deleted");
  assert.ok(fs.existsSync(path.join(other, "important.txt")), "다른 폴더는 건드리지 않는다");
  // 심볼릭 링크(만들 수 있을 때만)
  try {
    fs.symlinkSync(other, path.join(f.workDir, "tooljobs", "linked"), "junction");
  } catch {
    return;
  }
  assert.throws(() => deleteToolJobFolder(f.workDir, "linked"), /일반 폴더가 아니라/);
  assert.ok(fs.existsSync(path.join(other, "important.txt")));
});

test("감독 프로그램 연결: 도구 슬롯은 앱 슬롯과 따로, 직접 쉘 삭제 없음, 실행 중 일감 수에 포함", () => {
  const sup = fs.readFileSync(path.join(here, "..", "supervisor.mjs"), "utf8");
  const job = fs.readFileSync(path.join(here, "..", "tooljob.mjs"), "utf8");
  // 주석 줄(// 와 /** … */ 의 * 줄)과 줄 끝 주석을 뺀 코드만 본다
  const code = job
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .map((l) => l.replace(/ \/\/ .*$/, ""))
    .join("\n");

  assert.match(sup, /toolSlots/);
  assert.match(sup, /runToolJobEntry/);
  assert.match(sup, /offeredAll\.filter\(\(j\) => j\.kind === "tool"\)/, "도구 일감은 앱 슬롯(free) 계산과 따로 시작");
  assert.match(sup, /running\.size \+ toolRunning\.size/, "업데이트·드레인은 도구 일감도 기다린다");
  assert.equal(/child_process/.test(job), false, "tooljob.mjs 는 직접 프로세스를 띄우지 않는다(중계 어댑터만)");
  assert.equal(/execSync|spawnSync|\brm\s+-rf/.test(code), false, "코드에 rm -rf·쉘 호출 없음");
  assert.ok(!/supervisor-src|selfdev/.test(code), "정비 폴더·감독 실행 폴더를 가리키지 않는다");
});

// ───────── 참고 그림 점검(스튜디오 ↔ 서비스 연결, 그림 자체 보관) ─────────

const certExpired = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" }) });

test("참고 그림 점검: 고정된 기본 그림이 인증서 만료로 안 받아지면 일감을 실패로 끝낸다(이유·고칠 곳, 임시 폴더·도구 실행 없음)", async (t) => {
  const f = fixture(t);
  const { d, spawned, forms } = deps(f, { fetchImpl: async (url) => { if (/pin\.png/.test(url)) throw certExpired(); return { status: 200, body: null }; } });
  const j = job({ card: { ...job().card, pinnedUrl: "https://img.example/pin.png" } });
  const out = await runToolJob(j, d);

  assert.equal(out.status, "failed");
  assert.match(out.failReason, /기본 그림 주소 접속 실패\(인증서 만료\)/);
  assert.match(out.failReason, /img\.example/);
  assert.match(out.failReason, /고칠 곳/, "고칠 곳이 적혀 있다");
  assert.equal(spawned.length, 0, "도구를 부르지 않았다");
  assert.equal(forms.length, 0);
  assert.equal(fs.existsSync(toolJobDirOf(f.workDir, j.id)), false, "임시 폴더도 만들지 않았다");
  assert.equal(out.folder, "none");
});

test("참고 그림 점검: 고정이 아닌 그림이 안 받아지면 빼고 진행하고, 받아지는 그림은 그대로 쓴다", async (t) => {
  const f = fixture(t);
  const { d, spawned, logs } = deps(f, { fetchImpl: async (url) => { if (/bad\.png/.test(url)) throw certExpired(); return { status: 200, body: null }; } });
  const j = job({ card: { ...job().card, pinnedUrl: "https://img.example/pin.png" }, pickedArts: [{ url: "https://img.example/pin.png", subject: "싹이", kind: "image-prop" }, { url: "https://old.example/bad.png", subject: "싹이", kind: "image-prop" }] });
  const out = await runToolJob(j, d);

  assert.equal(out.status, "done", JSON.stringify(out));
  const refs = spawned[0].argv.join(" ");
  assert.match(refs, /--refs=https:\/\/img\.example\/pin\.png(\s|$)/, "받아지는 고정 그림만 남는다");
  assert.equal(/bad\.png/.test(refs), false, "안 받아지는 그림은 뺐다");
  assert.ok(logs.some((l) => /받지 못해 빼고 진행/.test(l) && /old\.example/.test(l)));
  assert.match(out.summary, /참고 그림 1장은 받지 못해 빼고 진행/);
});

test("참고 그림 점검 도구: 접속 실패 이유(인증서 만료·시간 초과·HTTP 오류)와 같은 주소는 한 번만 접속", async () => {
  const { checkPickedRefs, refFailureReason, probeRef } = await import("../refcheck.mjs");

  assert.equal(refFailureReason(certExpired()), "인증서 만료");
  assert.equal(refFailureReason(Object.assign(new Error("x"), { name: "AbortError" })), "시간 초과");
  assert.equal(refFailureReason(new TypeError("fetch failed")), "연결 실패");
  assert.deepEqual(await probeRef("https://x.example/a.png", { fetchImpl: async () => ({ status: 404, body: null }) }), { ok: false, reason: "HTTP 404" });
  let calls = 0;
  const r = await checkPickedRefs({ picked: [{ url: "https://x.example/a.png", subject: "a", kind: "image-prop" }, { url: "https://x.example/a.png", subject: "a2", kind: "image-prop" }], pinnedUrl: null, fetchImpl: async () => (calls++, { status: 200, body: null }) });

  assert.equal(calls, 1);
  assert.equal(r.keep.length, 2);
  assert.equal(r.pinnedFailure, null);
});
