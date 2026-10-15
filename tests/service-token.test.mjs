// 서비스 관리자 토큰 보관함 쓰기(serverctl service-token 용) 시험: 허용 목록 이름만, 암호화 저장·readServerSecret 로 읽힘, 교체 뒤 되돌리기(이전 값·삭제),
// version 이 다르면 되돌리지 않음, 워커 토큰 없으면 401, 응답·로그에 값 없음. 가짜 DB(메모리)로 돌린다.
// 실행: npm run test:service-token
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { NextRequest, NextResponse } = require("next/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const logs = [];
for (const level of ["log", "info", "warn", "error"]) console[level] = (...args) => logs.push(args.map(String).join(" "));

process.env.FACTORY_SECRET_KEY = randomBytes(24).toString("hex");
const WORKER = "fake-worker-token-" + randomBytes(8).toString("hex");
const NAME = "SERVICE_ADMIN_TOKEN_ONE_TINY_FRAME";

// 가짜 DB: factorySecretEntry · factorySetting · factorySecretName
function fakeDb() {
  const entries = new Map();
  const settings = new Map();
  const bump = (cur, update) => {
    const next = { ...cur };
    for (const [k, v] of Object.entries(update)) next[k] = v && typeof v === "object" && "increment" in v ? cur[k] + v.increment : v;
    return next;
  };
  return {
    entries,
    settings,
    factorySecretEntry: {
      findUnique: async ({ where }) => (entries.has(where.name) ? { ...entries.get(where.name) } : null),
      upsert: async ({ where, create, update }) => {
        const cur = entries.get(where.name);
        entries.set(where.name, cur ? bump(cur, update) : { createdAt: new Date(), updatedAt: new Date(), ...create });
        return { ...entries.get(where.name) };
      },
      updateMany: async ({ where, data }) => {
        const cur = entries.get(where.name);
        if (!cur || (where.version !== undefined && cur.version !== where.version)) return { count: 0 };
        entries.set(where.name, bump(cur, data));
        return { count: 1 };
      },
      deleteMany: async ({ where }) => {
        const cur = entries.get(where.name);
        if (!cur || (where.version !== undefined && cur.version !== where.version)) return { count: 0 };
        entries.delete(where.name);
        return { count: 1 };
      },
      count: async () => entries.size,
      findMany: async () => [...entries.values()],
    },
    factorySetting: {
      findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      upsert: async ({ where, create, update }) => void settings.set(where.key, settings.has(where.key) ? update.value : create.value),
      deleteMany: async ({ where }) => void settings.delete(where.key),
    },
    factorySecretName: { upsert: async () => ({}), findMany: async () => [], findUnique: async () => null },
  };
}

function setup() {
  const db = fakeDb();
  const prismaDep = { "@/lib/prisma": { __esModule: true, default: db } };
  const keyPasswords = loadTs("lib/factory/keyPasswords.ts", prismaDep);
  // settings.ts 는 다른 모듈을 많이 끌어와서, 여기서 쓰는 두 함수만 같은 동작으로 둔다(factory_settings 한 줄 읽기·쓰기·지우기)
  const settings = {
    getSettingValue: async (key) => (await db.factorySetting.findUnique({ where: { key } }))?.value ?? null,
    setSettingValue: async (key, value) => (value === null ? db.factorySetting.deleteMany({ where: { key } }) : db.factorySetting.upsert({ where: { key }, create: { key, value }, update: { value } })),
  };
  const secretEntries = loadTs("lib/factory/secretEntries.ts", { ...prismaDep, "@/lib/factory/keyPasswords": keyPasswords, "@/lib/factory/settings": settings });
  const lib = loadTs("lib/factory/serviceToken.ts", { ...prismaDep, "@/lib/factory/keyPasswords": keyPasswords, "@/lib/factory/secretEntries": secretEntries, "@/lib/factory/settings": settings });
  // 워커 관문은 가짜(토큰만 본다). fail·readJson 은 진짜와 같은 모양
  const http = {
    fail: (status, message) => NextResponse.json({ message }, { status }),
    guardWorker: async (req) => (req.headers.get("authorization") === `Bearer ${WORKER}` ? null : NextResponse.json({ message: "권한이 없습니다." }, { status: 401 })),
    readJson: async (req) => {
      try {
        return { ok: true, body: JSON.parse(await req.text()) };
      } catch {
        return { ok: false, res: NextResponse.json({ message: "JSON 형식이 아닙니다." }, { status: 400 }) };
      }
    },
  };
  const route = loadTs("app/api/factory/service-token/route.ts", { "@/lib/factory/http": http, "@/lib/factory/serviceToken": lib });
  const post = async (body, token = WORKER) => {
    const res = await route.POST(new NextRequest("http://127.0.0.1/api/factory/service-token", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { status: res.status, json: await res.json() };
  };
  return { db, lib, secretEntries, keyPasswords, post };
}

const value = () => "tok-" + randomBytes(32).toString("hex");

test("저장: 허용 목록 이름만, 암호화해 서버 보관 키로, readServerSecret 로 읽히고 응답·로그·설정에 값이 없다", async () => {
  const { db, lib, secretEntries, post } = setup();
  const v1 = value();
  for (const [name, val] of [
    ["PIXELLAB_TOKEN", v1],
    ["REVIEW_STATUS_TOKEN_ONE_TINY_FRAME", v1],
    ["SERVICE_ADMIN_TOKEN_", v1],
    ["service_admin_token_x", v1],
    [NAME, "short"],
    [NAME, `"${v1}"`],
    [NAME, v1 + "\n"],
  ]) {
    const r = await post({ name, value: val });
    assert.equal(r.status, 400, `${name} 거부`);
  }
  assert.equal(db.entries.size, 0, "거부된 요청은 아무것도 저장하지 않는다");

  let r = await post({ name: NAME, value: v1 });
  assert.deepEqual(r, { status: 200, json: { ok: true, version: 1, replaced: false } });
  const row = db.entries.get(NAME);
  assert.equal(row.status, "stored");
  assert.ok(row.sealed && !row.sealed.includes(v1), "암호문에 평문이 없다");
  assert.ok(row.storedAt instanceof Date);
  assert.equal(await secretEntries.readServerSecret(NAME), v1, "기존 읽기 경로로 같은 값이 읽힌다");
  assert.equal((await secretEntries.secretEntryStatuses()).items.find((i) => i.name === NAME)?.state, "server", "통제실 목록에 서버 보관 키로 보인다");
  const prev = JSON.parse(db.settings.get(`serviceTokenPrev:${NAME}`));
  assert.equal(prev.version, 1);
  assert.equal(prev.before, null);
  assert.ok(!JSON.stringify([...db.settings.values()]).includes(v1), "설정에 평문이 없다");

  // 교체: version 2, replaced, 이전 암호문이 되돌리기 기록에 남는다
  const v2 = value();
  r = await post({ name: NAME, value: v2 });
  assert.deepEqual(r, { status: 200, json: { ok: true, version: 2, replaced: true } });
  assert.equal(await secretEntries.readServerSecret(NAME), v2);
  assert.equal(JSON.parse(db.settings.get(`serviceTokenPrev:${NAME}`)).before.sealed, row.sealed);
  assert.ok(!logs.join("\n").includes(v1) && !logs.join("\n").includes(v2), "로그에 값이 없다");
  assert.equal(typeof lib.SERVICE_TOKEN_NAME_RE.test, "function");
});

test("되돌리기: 교체 뒤에는 이전 값으로, 처음 저장이면 삭제. version 이 다르거나 기록이 없으면 409. 두 번은 안 된다", async () => {
  const { db, secretEntries, post } = setup();
  const v1 = value();
  const v2 = value();
  await post({ name: NAME, value: v1 });
  await post({ name: NAME, value: v2 });
  let r = await post({ name: NAME, rollback: true, version: 1 });
  assert.equal(r.status, 409, "지난 version 으로는 되돌리지 않는다");
  assert.equal(await secretEntries.readServerSecret(NAME), v2);
  r = await post({ name: NAME, rollback: true, version: 2 });
  assert.deepEqual(r, { status: 200, json: { ok: true, restored: "previous" } });
  assert.equal(await secretEntries.readServerSecret(NAME), v1, "이전 값으로 돌아간다");
  assert.equal(db.entries.get(NAME).status, "stored");
  assert.equal(db.settings.has(`serviceTokenPrev:${NAME}`), false, "되돌리기 기록은 한 번 쓰면 지운다");
  r = await post({ name: NAME, rollback: true, version: 2 });
  assert.equal(r.status, 409, "두 번은 되돌리지 않는다");
  assert.equal(await secretEntries.readServerSecret(NAME), v1);

  // 처음 저장 되돌리기 → 삭제
  const other = "SERVICE_ADMIN_TOKEN_SAESSAK_HUB";
  r = await post({ name: other, value: value() });
  assert.equal(r.json.version, 1);
  r = await post({ name: other, rollback: true, version: 1 });
  assert.deepEqual(r, { status: 200, json: { ok: true, restored: "deleted" } });
  assert.equal(db.entries.has(other), false);
  assert.equal(await secretEntries.readServerSecret(other), null);

  // 형식 틀림
  for (const body of [{ name: NAME, rollback: true }, { name: NAME, rollback: true, version: "1" }, { name: "PIXELLAB_TOKEN", rollback: true, version: 1 }]) {
    r = await post(body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.ok(!logs.join("\n").includes(v1) && !logs.join("\n").includes(v2));
});

test("워커 토큰이 아니면 401, 본문이 JSON 이 아니면 400, 응답에 값이 실리지 않는다", async () => {
  const { db, post } = setup();
  const v = value();
  let r = await post({ name: NAME, value: v }, "wrong-token");
  assert.equal(r.status, 401);
  assert.equal(db.entries.size, 0);
  r = await post({ name: NAME, value: v });
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.json).includes(v));
  r = await post({ name: NAME, rollback: true, version: 1 });
  assert.ok(!JSON.stringify(r.json).includes(v));
});
