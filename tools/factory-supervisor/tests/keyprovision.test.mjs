// 통제실 키 → 서버2 .env 자동 반영 시험: 서버(lib/factory/keyProvision.ts)와 감독 쪽(keyprovision.mjs).
// DB·secretEntries 는 가짜, provision-key.sh 는 임시 폴더의 가짜 스크립트(node 로 실행). 실제 서버·ssh 는 쓰지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mappedKeyNames, reportProvisionNames, runProvisionScript, syncProvisions } from "../keyprovision.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const VALUE = "token-SECRET-value-1234567890";
const SERVER_KEY = "REVIEW_STATUS_TOKEN_ONE_TINY_FRAME";
const PC_KEY = "APPKIT_SYNC_TOKEN_ONE_TINY_FRAME";

function server() {
  const settings = new Map();
  const mask = loadTs("lib/factory/mask.ts");
  const lib = loadTs("lib/factory/keyProvision.ts", {
    "@/lib/factory/mask": mask,
    "@/lib/factory/settings": { getSettingValue: async (k) => settings.get(k) ?? null, setSettingValue: async (k, v) => (v === null ? settings.delete(k) : settings.set(k, v)) },
    "@/lib/factory/secretEntries": {
      SECRET_ENTRY_NAME_RE: /^[A-Z][A-Z0-9_]{2,63}$/,
      isServerSecretName: (n) => n.startsWith("REVIEW_STATUS_TOKEN_"),
      readServerSecret: async (n) => (n === SERVER_KEY ? VALUE : null),
    },
  });
  return { lib, settings };
}
const noValue = (s) => assert.ok(!JSON.stringify(s).includes(VALUE), "값이 새어 나옴");

test("반영 대상 이름이 아니면 요청이 생기지 않는다(지금처럼 아무 일 없음)", async () => {
  const { lib, settings } = server();
  assert.equal(await lib.requestProvision(PC_KEY), false); // 이름 보고 전
  await lib.saveProvisionNames([PC_KEY, SERVER_KEY, "bad name", 5]);
  assert.equal(await lib.requestProvision("PIXELLAB_TOKEN"), false);
  assert.equal(await lib.provisionPending(), false);
  assert.ok(![...settings.keys()].some((k) => k.startsWith("keyProvision:")));
  assert.deepEqual((await lib.provisionNames()).names, [PC_KEY, SERVER_KEY].sort());
});

test("등록·교체하면 pending 이 생기고, 서버 보관 키만 값이 실린다", async () => {
  const { lib } = server();
  await lib.saveProvisionNames([PC_KEY, SERVER_KEY]);
  assert.equal(await lib.requestProvision(PC_KEY), true);
  assert.equal(await lib.requestProvision(SERVER_KEY), true);
  assert.equal(await lib.provisionPending(), true);
  const list = await lib.pendingProvisions();
  const pc = list.find((x) => x.name === PC_KEY);
  const sv = list.find((x) => x.name === SERVER_KEY);
  assert.equal(pc.value, undefined);
  assert.equal(sv.value, VALUE);
  noValue(await lib.provisionStatuses()); // 화면용 상태에는 값이 없다
  await lib.requestProvision(PC_KEY); // 교체하면 번호가 올라간다
  assert.equal((await lib.pendingProvisions()).find((x) => x.name === PC_KEY).seq, 2);
});

test("결과 보고: 실행 중 → 성공/실패, 오래된 번호는 무시, 줄은 다듬는다", async () => {
  const { lib } = server();
  await lib.saveProvisionNames([PC_KEY]);
  await lib.requestProvision(PC_KEY);
  assert.deepEqual(await lib.reportProvision({ name: PC_KEY, seq: 1, state: "running", exitCode: null, lines: [] }), { ok: true, applied: true });
  assert.equal(await lib.provisionPending(), false);
  await lib.reportProvision({ name: PC_KEY, seq: 1, state: "failed", exitCode: 4, lines: ["FAILED APPKIT_SYNC_TOKEN one-tiny-frame\u0007", "RESULT rolled-back", 7, "storePassword=abc123456", "x".repeat(500)] });
  let st = (await lib.provisionStatuses()).records[PC_KEY];
  assert.equal(st.state, "failed");
  assert.equal(st.exitCode, 4);
  assert.equal(st.lines.length, 4);
  assert.ok(st.lines.every((l) => l.length <= 200 && !/[\u0000-\u001f]/.test(l)));
  assert.ok(!st.lines.join("\n").includes("abc123456"));
  // 그 사이 다시 요청됨(seq 2) → 이전 번호 결과는 무시
  await lib.requestProvision(PC_KEY);
  assert.equal((await lib.reportProvision({ name: PC_KEY, seq: 1, state: "ok", exitCode: 0, lines: [] })).applied, false);
  assert.equal((await lib.provisionStatuses()).records[PC_KEY].state, "pending");
  for (const bad of [null, {}, { name: "x", seq: 1, state: "ok" }, { name: PC_KEY, seq: 2, state: "pending" }, { name: PC_KEY, seq: 2, state: "nope" }]) {
    assert.equal((await lib.reportProvision(bad)).applied, false);
  }
  await lib.reportProvision({ name: PC_KEY, seq: 2, state: "unchanged", exitCode: 0, lines: ["UNCHANGED APPKIT_SYNC_TOKEN one-tiny-frame"] });
  st = (await lib.provisionStatuses()).records[PC_KEY];
  assert.equal(st.state, "unchanged");
});

test("삭제하면 반영 기록만 지운다", async () => {
  const { lib } = server();
  await lib.saveProvisionNames([PC_KEY]);
  await lib.requestProvision(PC_KEY);
  await lib.clearProvision(PC_KEY);
  assert.deepEqual((await lib.provisionStatuses()).records, {});
  assert.equal(await lib.provisionPending(), false);
});

test("실행 중으로 오래 남은 것은 다시 요청으로 본다", async () => {
  const { lib, settings } = server();
  await lib.saveProvisionNames([PC_KEY]);
  await lib.requestProvision(PC_KEY);
  await lib.reportProvision({ name: PC_KEY, seq: 1, state: "running", exitCode: null, lines: [] });
  const k = `keyProvision:${PC_KEY}`;
  const rec = JSON.parse(settings.get(k));
  rec.at = new Date(Date.now() - 20 * 60_000).toISOString();
  settings.set(k, JSON.stringify(rec));
  assert.equal(await lib.provisionPending(), true);
});

// ───────── 감독 쪽 ─────────
function fakeAppKit(t, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-keyprov-test-"));
  t.after(() => {
    assert.ok(path.basename(dir).startsWith("factory-keyprov-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(dir, "docs"));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.writeFileSync(path.join(dir, "docs", "key-map.json"), JSON.stringify({ keys: { [PC_KEY]: { targets: [] }, [SERVER_KEY]: { targets: [] }, lower: {} } }));
  fs.writeFileSync(path.join(dir, "scripts", "provision-key.sh"), script);
  return dir;
}
// bash 대신 node 로 가짜 provision-key.sh(자바스크립트)를 실행한다
const NODE = process.execPath;

test("key-map.json 의 이름만 읽는다(없으면 빈 목록)", (t) => {
  const dir = fakeAppKit(t, "");
  assert.deepEqual(mappedKeyNames(dir), [PC_KEY, SERVER_KEY].sort());
  assert.deepEqual(mappedKeyNames(path.join(dir, "nope")), []);
});

test("스크립트 실행: 값은 환경변수로만, 종료 코드·출력 분류, 값은 가린다", async (t) => {
  const dir = fakeAppKit(
    t,
    `const n = process.argv[2]; const v = process.env[n];
console.log("CHANGED APPKIT_SYNC_TOKEN one-tiny-frame"); console.log("RESULT ok");
console.error("디버그 " + v);
process.exit(process.argv.length === 3 && v ? 0 : 9);`,
  );
  const r = await runProvisionScript({ appKitDir: dir, bashCmd: NODE, name: PC_KEY, value: VALUE });
  assert.equal(r.exitCode, 0);
  assert.equal(r.state, "ok");
  assert.ok(r.lines.includes("CHANGED APPKIT_SYNC_TOKEN one-tiny-frame"));
  noValue(r);
  assert.ok(r.lines.some((l) => l.includes("***")));
});

test("스크립트 실행: UNCHANGED 만 있으면 변화 없음, 코드 2~5 는 실패, 실행 불가·시간 초과도 실패", async (t) => {
  let dir = fakeAppKit(t, `console.log("UNCHANGED A b"); console.log("RESULT ok");`);
  assert.equal((await runProvisionScript({ appKitDir: dir, bashCmd: NODE, name: PC_KEY, value: VALUE })).state, "unchanged");
  dir = fakeAppKit(t, `console.log("CHANGED A b"); console.log("UNCHANGED C d"); process.exit(0);`);
  assert.equal((await runProvisionScript({ appKitDir: dir, bashCmd: NODE, name: PC_KEY, value: VALUE })).state, "ok");
  for (const code of [2, 3, 4, 5]) {
    dir = fakeAppKit(t, `console.log("RESULT failed"); process.exit(${code});`);
    const r = await runProvisionScript({ appKitDir: dir, bashCmd: NODE, name: PC_KEY, value: VALUE });
    assert.equal(r.exitCode, code);
    assert.equal(r.state, "failed");
  }
  const missing = await runProvisionScript({ appKitDir: dir, bashCmd: path.join(dir, "no-such-bash"), name: PC_KEY, value: VALUE });
  assert.equal(missing.state, "failed");
  assert.equal(missing.exitCode, null);
  dir = fakeAppKit(t, `setTimeout(() => {}, 60000);`);
  const slow = await runProvisionScript({ appKitDir: dir, bashCmd: NODE, name: PC_KEY, value: VALUE, timeoutMs: 300 });
  assert.equal(slow.state, "failed");
  assert.match(slow.lines[0], /시간 초과/);
});

function fakeApi(items) {
  const posts = [];
  const api = async (method, url, body) => {
    if (method === "GET") return { status: 200, data: { provision: items } };
    posts.push(body);
    return { status: 200, data: { ok: true } };
  };
  return { api, posts };
}

test("syncProvisions: PC 키는 secrets.env 값, 서버 보관 키는 받은 값으로 실행하고 보고한다", async (t) => {
  const dir = fakeAppKit(t, "");
  const calls = [];
  const run = async ({ name, value }) => {
    calls.push({ name, value });
    return { exitCode: 0, state: "ok", lines: [`CHANGED X ${name}`, `값 ${value}`] };
  };
  const { api, posts } = fakeApi([{ name: PC_KEY, seq: 3 }, { name: SERVER_KEY, seq: 1, value: VALUE }]);
  const logs = [];
  await syncProvisions({ api, log: (m) => logs.push(m), appKitDir: dir, bashCmd: "bash", readSecrets: () => ({ [PC_KEY]: "pc-value-from-secrets-env" }), run });
  assert.deepEqual(calls, [{ name: PC_KEY, value: "pc-value-from-secrets-env" }, { name: SERVER_KEY, value: VALUE }]);
  const reports = posts.map((p) => p.provisionReport);
  assert.deepEqual(reports.map((r) => [r.name, r.seq, r.state]), [[PC_KEY, 3, "running"], [PC_KEY, 3, "ok"], [SERVER_KEY, 1, "running"], [SERVER_KEY, 1, "ok"]]);
  noValue([posts, logs]);
  assert.ok(!JSON.stringify([posts, logs]).includes("pc-value-from-secrets-env"));
});

test("syncProvisions: 값이 없으면 3, 매핑에 없으면 2 로 보고하고 스크립트는 안 돌린다", async (t) => {
  const dir = fakeAppKit(t, "");
  let ran = 0;
  const { api, posts } = fakeApi([{ name: PC_KEY, seq: 1 }, { name: "OTHER_TOKEN_KEY", seq: 1 }, { name: SERVER_KEY, seq: 2 }]);
  await syncProvisions({ api, log: () => {}, appKitDir: dir, bashCmd: "bash", readSecrets: () => ({}), run: async () => (ran++, { exitCode: 0, state: "ok", lines: [] }) });
  assert.equal(ran, 0);
  assert.deepEqual(posts.map((p) => [p.provisionReport.name, p.provisionReport.exitCode, p.provisionReport.state]), [[PC_KEY, 3, "failed"], ["OTHER_TOKEN_KEY", 2, "failed"], [SERVER_KEY, 3, "failed"]]);
});

test("syncProvisions: 예전 서버(404)·거절은 조용히 넘어가고 던지지 않는다", async (t) => {
  const dir = fakeAppKit(t, "");
  for (const status of [404, 401, 500]) {
    const logs = [];
    await syncProvisions({ api: async () => ({ status, data: null }), log: (m) => logs.push(m), appKitDir: dir, bashCmd: "bash", readSecrets: () => ({}) });
    assert.equal(logs.length, status === 404 ? 0 : 1);
  }
  await syncProvisions({
    api: async () => {
      throw Object.assign(new Error("x"), { code: "ECONNRESET" });
    },
    log: () => {},
    appKitDir: dir,
    bashCmd: "bash",
    readSecrets: () => ({}),
  });
});

test("이름 보고: key-map 이름만 보내고 값은 없다", async (t) => {
  const dir = fakeAppKit(t, "");
  const { api, posts } = fakeApi([]);
  await reportProvisionNames({ api, log: () => {}, appKitDir: dir });
  assert.deepEqual(posts, [{ provisionNames: [PC_KEY, SERVER_KEY].sort() }]);
});
