// 외부 서비스 키(환경변수) 전달 시험: 서버 쪽(lib/factory/secretEntries.ts, keyPasswords.ts 의 seal/unseal)과 감독 쪽(secrets.mjs).
// DB 는 메모리 가짜, secrets.env 는 임시 폴더. 실제 키·서버·AI CLI 는 쓰지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { aiToolStatus, editSecretsFile, isReservedName, reportSecretNames, secretNamesIn, syncSecretEntries, validValue } from "../secrets.mjs";
import { skipUnlessWebRepo } from "./webrepo.mjs";
skipUnlessWebRepo(import.meta.url);

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

const SECRET = "pixel-SECRET-value-1234567890";
const SECRET2 = "pixel-SECRET-value-NEW-0987654321";

// ───────── 메모리 가짜 Prisma ─────────
function matches(row, where = {}) {
  if (where.OR) return where.OR.some((w) => matches(row, w));
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date) && "not" in v) return row[k] !== v.not;
    if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime();
    return row[k] === v;
  });
}
function fakeDb() {
  const entries = new Map();
  const names = new Map();
  const settings = new Map();
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 9, 12, 0, 0, tick++));
  const apply = (row, data) => {
    for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === "object" && "increment" in v ? row[k] + v.increment : v;
    row.updatedAt = now();
    return row;
  };
  const prisma = {
    factorySecretEntry: {
      findUnique: async ({ where }) => (entries.has(where.name) ? { ...entries.get(where.name) } : null),
      count: async (q = {}) => [...entries.values()].filter((r) => matches(r, q.where)).length,
      findMany: async (q = {}) => [...entries.values()].filter((r) => matches(r, q.where)).map((r) => ({ ...r })),
      upsert: async ({ where, create, update }) => {
        const cur = entries.get(where.name);
        if (cur) return apply(cur, update);
        const row = { description: "", sealed: null, version: 1, status: "pending", storedAt: null, createdAt: now(), ...create };
        row.updatedAt = row.createdAt;
        entries.set(where.name, row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const r of entries.values()) if (matches(r, where)) (apply(r, data), count++);
        return { count };
      },
      deleteMany: async ({ where }) => {
        let count = 0;
        for (const [k, r] of entries) if (matches(r, where)) (entries.delete(k), count++);
        return { count };
      },
    },
    factorySecretName: {
      findUnique: async ({ where }) => (names.has(where.name) ? { ...names.get(where.name) } : null),
      findMany: async () => [...names.values()].sort((a, b) => a.name.localeCompare(b.name)),
      upsert: async ({ where, create, update }) => {
        const cur = names.get(where.name);
        if (cur) return Object.assign(cur, update);
        const row = { createdAt: now(), ...create };
        names.set(where.name, row);
        return row;
      },
    },
  };
  const settingsMod = {
    getSettingValue: async (k) => settings.get(k) ?? null,
    setSettingValue: async (k, v) => (v === null ? settings.delete(k) : settings.set(k, v)),
  };
  return { prisma, settingsMod, entries, names, settings };
}
function server() {
  process.env.FACTORY_SECRET_KEY = "test-factory-secret-key-0123456789";
  const db = fakeDb();
  const keyPasswords = loadTs("lib/factory/keyPasswords.ts", { "@/lib/prisma": { __esModule: true, default: db.prisma } });
  const lib = loadTs("lib/factory/secretEntries.ts", {
    "@/lib/prisma": { __esModule: true, default: db.prisma },
    "@/lib/factory/keyPasswords": keyPasswords,
    "@/lib/factory/settings": db.settingsMod,
  });
  return { db, lib, keyPasswords };
}
function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-secrets-test-"));
  t.after(() => {
    assert.ok(path.basename(dir).startsWith("factory-secrets-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
const noValue = (s, ...values) => {
  for (const v of values.length ? values : [SECRET, SECRET2]) assert.ok(!String(s).includes(v), "값이 새어 나옴");
};

// ───────── 서버 ─────────

test("이름 검사: 예약 이름·소문자·너무 짧음·RELEASE_ 를 거부", () => {
  const { lib } = server();
  assert.equal(lib.checkSecretName("PIXELLAB_TOKEN").ok, true);
  assert.equal(lib.checkSecretName(" PIXELLAB_TOKEN ").ok, true);
  for (const bad of ["pixellab_token", "Pixel_TOKEN", "AB", "A", "1ABC", "PIXEL-TOKEN", "A".repeat(65), "", 123, null]) {
    assert.equal(lib.checkSecretName(bad).ok, false, String(bad));
  }
  const rel = lib.checkSecretName("RELEASE_KEY_ABC_STORE_PASSWORD");
  assert.equal(rel.ok, false);
  assert.match(rel.message, /서명 키 전용/);
  for (const r of ["FACTORY_WORKER_TOKEN", "SERVERCTL_VALUE", "NEXTAUTH_SECRET", "AUTH_SECRET", "DATABASE_URL", "PATH", "NODE_OPTIONS", "HOME", "USERPROFILE", "CLAUDE_CODE_X", "OPENAI_API_KEY"]) {
    assert.equal(lib.checkSecretName(r).ok, false, r);
  }
  // 감독 쪽 목록도 같은 결과
  for (const r of ["RELEASE_X", "FACTORY_X", "PATH", "USERPROFILE"]) assert.equal(isReservedName(r), true, r);
  assert.equal(isReservedName("PIXELLAB_TOKEN"), false);
});

test("값 검사: keyPasswords 와 같은 원칙, 길이 8~4096", () => {
  const { lib } = server();
  assert.equal(lib.checkSecretValue(SECRET).ok, true);
  assert.equal(lib.checkSecretValue("x".repeat(4096)).ok, true);
  for (const bad of ["short7_", "x".repeat(4097), "line\nbreak123", "tab\tinside123", " leading-space1", "trailing-space1 ", '"quoted-value"', "'quoted-value'", 12345678, null]) {
    const r = lib.checkSecretValue(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    if (typeof bad === "string") noValue(r.message, bad);
  }
  // 감독 쪽도 같은 규칙
  assert.equal(validValue(SECRET), true);
  for (const bad of ["short7_", "line\nbreak123", " lead-space1", '"quoted-value"']) assert.equal(validValue(bad), false);
});

test("암호화 왕복(seal/unseal): 기존 v1 형식 유지, 키가 다르면 못 풂", () => {
  const { keyPasswords } = server();
  const sealed = keyPasswords.seal(SECRET);
  assert.match(sealed, /^v1:[^:]+:[^:]+:[^:]+$/);
  noValue(sealed);
  assert.equal(keyPasswords.unseal(sealed), SECRET);
  assert.notEqual(keyPasswords.seal(SECRET), sealed); // iv 가 매번 다름
  assert.equal(keyPasswords.unseal(sealed.replace(/.$/, (c) => (c === "A" ? "B" : "A"))), null); // 변조
  process.env.FACTORY_SECRET_KEY = "another-secret-key-abcdefghijklmn";
  assert.equal(keyPasswords.unseal(sealed), null);
  process.env.FACTORY_SECRET_KEY = "test-factory-secret-key-0123456789";
});

test("등록 → 가져가기 → ack 하면 서버 암호문이 지워지고 저장 기록만 남는다", async () => {
  const { db, lib } = server();
  const r = await lib.registerSecretEntry("PIXELLAB_TOKEN", "도트 이미지 생성", SECRET);
  assert.equal(r.ok, true);
  assert.equal(r.replaced, false);
  noValue(JSON.stringify(r));
  const row = db.entries.get("PIXELLAB_TOKEN");
  assert.equal(row.status, "pending");
  assert.ok(row.sealed && !row.sealed.includes(SECRET)); // DB 에는 암호문만
  assert.equal(db.names.get("PIXELLAB_TOKEN").description, "도트 이미지 생성"); // 이름 카탈로그에도
  assert.equal(await lib.secretEntriesPending(), true);

  const items = await lib.pendingSecretEntries();
  assert.deepEqual(items, [{ name: "PIXELLAB_TOKEN", version: 1, value: SECRET }]);

  // 다른 version 의 확인은 무시
  assert.equal(await lib.ackSecretEntries([{ name: "PIXELLAB_TOKEN", version: 2, action: "store" }]), 0);
  assert.equal(await lib.ackSecretEntries([{ name: "PIXELLAB_TOKEN", version: 1, action: "store" }]), 1);
  assert.equal(row.sealed, null);
  assert.equal(row.status, "stored");
  assert.ok(row.storedAt instanceof Date);
  assert.equal(await lib.secretEntriesPending(), false);
  assert.deepEqual(await lib.pendingSecretEntries(), []);

  const view = await lib.secretEntryStatuses();
  assert.equal(view.items.find((i) => i.name === "PIXELLAB_TOKEN").state, "stored");
  noValue(JSON.stringify(view));
  assert.ok(!JSON.stringify(view).includes("v1:")); // 암호문도 안 나감
});

test("같은 이름을 다시(동시에) 등록하면 version 이 오르고 옛 version 확인은 새 값을 지우지 않는다", async () => {
  const { db, lib } = server();
  await lib.registerSecretEntry("PIXELLAB_TOKEN", "", SECRET);
  const first = await lib.pendingSecretEntries();
  await Promise.all([lib.registerSecretEntry("PIXELLAB_TOKEN", "", SECRET2), lib.registerSecretEntry("PIXELLAB_TOKEN", "", SECRET2)]);
  assert.equal(db.entries.get("PIXELLAB_TOKEN").version, 3);
  assert.equal(await lib.ackSecretEntries([{ name: "PIXELLAB_TOKEN", version: first[0].version, action: "store" }]), 0);
  assert.equal(db.entries.get("PIXELLAB_TOKEN").status, "pending");
  assert.deepEqual(await lib.pendingSecretEntries(), [{ name: "PIXELLAB_TOKEN", version: 3, value: SECRET2 }]);
  // 이미 PC 에 있는 이름이면 "교체"
  await lib.ackSecretEntries([{ name: "PIXELLAB_TOKEN", version: 3, action: "store" }]);
  const again = await lib.registerSecretEntry("PIXELLAB_TOKEN", "", SECRET);
  assert.equal(again.replaced, true);
  assert.match(again.message, /교체/);
});

test("예약 이름·잘못된 값은 등록되지 않고 아무것도 저장하지 않는다", async () => {
  const { db, lib } = server();
  assert.equal((await lib.registerSecretEntry("RELEASE_KEY_X_STORE_PASSWORD", "", SECRET)).status, 400);
  assert.equal((await lib.registerSecretEntry("pixellab", "", SECRET)).status, 400);
  const bad = await lib.registerSecretEntry("PIXELLAB_TOKEN", "", ` ${SECRET}`);
  assert.equal(bad.status, 400);
  noValue(bad.message);
  assert.equal(db.entries.size, 0);
  assert.equal(db.names.size, 0);
});

test("삭제 흐름: 삭제 대기 → PC 확인 → 항목이 지워지고 이름 카탈로그는 남는다", async () => {
  const { db, lib } = server();
  await lib.registerSecretEntry("PIXELLAB_TOKEN", "도트", SECRET);
  await lib.ackSecretEntries([{ name: "PIXELLAB_TOKEN", version: 1, action: "store" }]);
  assert.equal((await lib.requestSecretDelete("NOT_KNOWN_NAME")).status, 404);
  assert.equal((await lib.requestSecretDelete("RELEASE_KEY_X_STORE_PASSWORD")).status, 400);
  const d = await lib.requestSecretDelete("PIXELLAB_TOKEN");
  assert.equal(d.ok, true);
  assert.equal(await lib.secretEntriesPending(), true);
  assert.deepEqual(await lib.pendingSecretEntries(), [{ name: "PIXELLAB_TOKEN", version: 2, delete: true }]);
  assert.equal((await lib.secretEntryStatuses()).items[0].state, "delete_pending");
  assert.equal((await lib.knownSecretNames()).length, 0); // 지우는 중에는 커넥터 목록에서 뺀다
  // 저장 확인(action 다름)으로는 지워지지 않는다
  assert.equal(await lib.ackSecretEntries([{ name: "PIXELLAB_TOKEN", version: 2, action: "store" }]), 0);
  assert.equal(await lib.ackSecretEntries([{ name: "PIXELLAB_TOKEN", version: 2, action: "delete" }]), 1);
  assert.equal(db.entries.size, 0);
  assert.equal(await lib.secretEntriesPending(), false);
  await lib.savePcSecretNames([]);
  assert.equal((await lib.secretEntryStatuses()).items[0].state, "missing"); // PC 에 없음(이름만)
  // PC 보고로만 알려진 이름도 삭제 요청할 수 있다
  await lib.savePcSecretNames(["OTHER_API_KEY"]);
  assert.equal((await lib.requestSecretDelete("OTHER_API_KEY")).ok, true);
});

test("이름 목록: 카탈로그 설명 + PC 보고로만 알려진 이름, 예약 이름은 뺀다", async () => {
  const { db, lib } = server();
  db.names.set("OLD_KEY", { name: "OLD_KEY", description: "직접 등록한 이름", createdAt: new Date() });
  db.names.set("RELEASE_KEY_ABC_STORE_PASSWORD", { name: "RELEASE_KEY_ABC_STORE_PASSWORD", description: "서명", createdAt: new Date() });
  await lib.registerSecretEntry("PIXELLAB_TOKEN", "도트 이미지", SECRET);
  assert.equal(await lib.savePcSecretNames(["PC_ONLY_KEY", "FACTORY_WORKER_TOKEN", "bad name", 3, "PC_ONLY_KEY"]), 1);
  const known = await lib.knownSecretNames();
  assert.deepEqual(
    known.map((k) => k.name),
    ["OLD_KEY", "PC_ONLY_KEY", "PIXELLAB_TOKEN", "RELEASE_KEY_ABC_STORE_PASSWORD"], // 카탈로그의 서명 키 이름은 예전처럼 그대로
  );
  assert.equal(known.find((k) => k.name === "PIXELLAB_TOKEN").description, "도트 이미지");
  assert.match(known.find((k) => k.name === "PC_ONLY_KEY").description, /PC/);
  // 통제실 목록은 서명 키를 빼고 상태를 붙인다
  const view = await lib.secretEntryStatuses();
  assert.deepEqual(
    view.items.map((i) => [i.name, i.state]),
    [["OLD_KEY", "missing"], ["PC_ONLY_KEY", "stored"], ["PIXELLAB_TOKEN", "pending"]],
  );
});

test("예전 감독 프로그램(신호 모름): 가져가지 않으면 값은 암호문으로만 남고 다른 상태는 그대로", async () => {
  const { db, lib } = server();
  await lib.registerSecretEntry("PIXELLAB_TOKEN", "", SECRET);
  // 예전 감독은 /api/factory/secrets 를 부르지 않는다 → 아무 변화 없음, PC 보고도 없음
  const view = await lib.secretEntryStatuses();
  assert.equal(view.pcReportedAt, null);
  assert.equal(view.items[0].state, "pending");
  assert.equal(view.items[0].onPc, null);
  assert.equal(db.settings.size, 0);
  // /next 의 secretsPending 은 할 일이 있을 때만 true(라우트는 true 일 때만 필드를 붙인다)
  const nextRoute = fs.readFileSync(path.join(repo, "app/api/factory/next/route.ts"), "utf8");
  assert.match(nextRoute, /\.\.\.\(secretsPending \? \{ secretsPending: true \} : \{\}\)/);
});

test("관리자·워커 라우트는 값을 로그·목록 응답에 쓰지 않는다(코드 검사)", () => {
  const admin = fs.readFileSync(path.join(repo, "app/api/admin/factory/secrets/route.ts"), "utf8");
  const worker = fs.readFileSync(path.join(repo, "app/api/factory/secrets/route.ts"), "utf8");
  assert.match(admin, /requireAdmin\(\)/);
  assert.match(worker, /guardWorker\(req\)/);
  for (const src of [admin, worker]) {
    for (const line of src.split("\n").filter((l) => /console\.(log|info|warn|error)/.test(l))) assert.ok(!/value|sealed|body\)|error\)/.test(line), line);
  }
  assert.match(worker, /"Cache-Control": "no-store"/);
  assert.equal((admin.match(/body\.value/g) ?? []).length, 1); // 값은 registerSecretEntry 로 넘길 때 한 번만 쓴다
});

// ───────── 감독 프로그램: secrets.env 줄 단위 수정 ─────────

test("secrets.env: 다른 줄·주석 보존, 같은 이름 교체, 줄 삭제, 새 이름 추가, CRLF 유지", (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "secrets.env");
  const original = ["# 외부 서비스 키", "", "OTHER_KEY=keep-me-123", "PIXELLAB_TOKEN=old-value-123", "  # 들여쓴 주석", "REMOVE_ME=bye-bye-123", "PIXELLAB_TOKEN=dup-old-456", "RELEASE_KEY_A_STORE_PASSWORD=sign"].join("\r\n") + "\r\n";
  fs.writeFileSync(file, original);
  editSecretsFile(file, { set: { PIXELLAB_TOKEN: SECRET, NEW_KEY_ONE: SECRET2 }, remove: ["REMOVE_ME"] });
  const text = fs.readFileSync(file, "utf8");
  assert.equal(
    text,
    ["# 외부 서비스 키", "", "OTHER_KEY=keep-me-123", `PIXELLAB_TOKEN=${SECRET}`, "  # 들여쓴 주석", "RELEASE_KEY_A_STORE_PASSWORD=sign", `NEW_KEY_ONE=${SECRET2}`].join("\r\n") + "\r\n",
  );
  // 백업은 바꾸기 전 내용 하나
  assert.equal(fs.readFileSync(`${file}.bak`, "utf8"), original);
  // 임시 파일이 남지 않는다
  assert.deepEqual(fs.readdirSync(dir).sort(), ["secrets.env", "secrets.env.bak"]);
  // 이름만 읽기(예약 이름 제외)
  assert.deepEqual(secretNamesIn(file), ["NEW_KEY_ONE", "OTHER_KEY", "PIXELLAB_TOKEN"]);
  // 파일이 없으면 새로 만든다(백업 없음)
  const fresh = path.join(dir, "sub", "secrets.env");
  editSecretsFile(fresh, { set: { PIXELLAB_TOKEN: SECRET } });
  assert.equal(fs.readFileSync(fresh, "utf8"), `PIXELLAB_TOKEN=${SECRET}\n`);
  assert.equal(fs.existsSync(`${fresh}.bak`), false);
});

test("secrets.env: 잘못된 이름·값은 파일을 건드리지 않고, 오류에 값이 없다", (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "secrets.env");
  fs.writeFileSync(file, "OTHER_KEY=keep-me-123\n");
  for (const args of [{ set: { RELEASE_KEY_X: SECRET } }, { set: { lower_case: SECRET } }, { set: { PIXELLAB_TOKEN: `${SECRET}\nEVIL=1` } }, { remove: ["PATH"] }]) {
    assert.throws(() => editSecretsFile(file, args), (e) => (noValue(e.message), true));
  }
  assert.equal(fs.readFileSync(file, "utf8"), "OTHER_KEY=keep-me-123\n");
  assert.equal(fs.existsSync(`${file}.bak`), false);
});

test("secrets.env: 이름 바꾸기에 실패하면 원래 파일이 그대로고 임시 파일이 남지 않는다(원자적 쓰기)", (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "secrets.env");
  fs.writeFileSync(file, "OTHER_KEY=keep-me-123\n");
  const orig = fs.renameSync;
  fs.renameSync = () => {
    throw Object.assign(new Error(`EPERM ${SECRET}`), { code: "EPERM" });
  };
  try {
    assert.throws(() => editSecretsFile(file, { set: { PIXELLAB_TOKEN: SECRET } }), (e) => (noValue(e.message), /EPERM/.test(e.message)));
  } finally {
    fs.renameSync = orig;
  }
  assert.equal(fs.readFileSync(file, "utf8"), "OTHER_KEY=keep-me-123\n");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["secrets.env", "secrets.env.bak"]);
});

// ───────── 감독 프로그램: 가져오기 → 반영 → ack → 이름 보고 ─────────

function fakeApi(items, { ackStatus = 200 } = {}) {
  const calls = [];
  const api = async (method, pathname, body) => {
    calls.push({ method, pathname, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) });
    if (method === "GET") return { status: 200, data: { items } };
    if (body?.ack) return { status: ackStatus, data: { ok: true } };
    return { status: 200, data: { ok: true } };
  };
  return { api, calls };
}

test("동기화: 저장·삭제를 반영한 뒤에만 ack 하고, 이름만 보고하고, 로그에 값이 없다", async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "secrets.env");
  fs.writeFileSync(file, "# 주석\nOLD_ONE=old-old-old-1\nKEEP_ME=keep-me-123\n");
  const logs = [];
  const { api, calls } = fakeApi([
    { name: "PIXELLAB_TOKEN", version: 2, value: SECRET },
    { name: "OLD_ONE", version: 5, delete: true },
    { name: "RELEASE_KEY_X_STORE_PASSWORD", version: 1, value: SECRET2 }, // 예약 이름은 건너뜀
    { name: "BAD_VALUE_KEY", version: 1, value: `${SECRET2}\nX=1` }, // 값 형식 오류는 건너뜀
  ]);
  await syncSecretEntries({ api, log: (m) => logs.push(m), secretsFile: file });
  assert.equal(fs.readFileSync(file, "utf8"), `# 주석\nKEEP_ME=keep-me-123\nPIXELLAB_TOKEN=${SECRET}\n`);
  const ack = calls.find((c) => c.body?.ack);
  assert.deepEqual(ack.body.ack, [
    { name: "PIXELLAB_TOKEN", version: 2, action: "store" },
    { name: "OLD_ONE", version: 5, action: "delete" },
  ]);
  const report = calls.find((c) => c.body?.names);
  assert.deepEqual(report.body.names, ["KEEP_ME", "PIXELLAB_TOKEN"]);
  assert.ok(calls.indexOf(report) > calls.indexOf(ack));
  noValue(logs.join("\n"));
  noValue(JSON.stringify(report));
  assert.ok(logs.some((l) => /PIXELLAB_TOKEN/.test(l) && /OLD_ONE/.test(l)));
  assert.ok(logs.some((l) => /BAD_VALUE_KEY/.test(l)));
});

test("동기화: 쓰기에 실패하면 ack 하지 않고 로그에는 이름과 이유만", async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "secrets.env");
  fs.writeFileSync(file, "KEEP_ME=keep-me-123\n");
  const logs = [];
  const { api, calls } = fakeApi([{ name: "PIXELLAB_TOKEN", version: 1, value: SECRET }]);
  const orig = fs.renameSync;
  fs.renameSync = () => {
    throw Object.assign(new Error(`disk full ${SECRET}`), { code: "ENOSPC" });
  };
  try {
    await syncSecretEntries({ api, log: (m) => logs.push(m), secretsFile: file });
  } finally {
    fs.renameSync = orig;
  }
  assert.equal(calls.some((c) => c.body?.ack), false);
  assert.equal(fs.readFileSync(file, "utf8"), "KEEP_ME=keep-me-123\n");
  noValue(logs.join("\n"));
  assert.ok(logs.some((l) => /PIXELLAB_TOKEN/.test(l) && /ENOSPC/.test(l)));
});

test("동기화: 가져오기 거절·연결 오류는 던지지 않고 파일을 건드리지 않는다, 이름 보고는 예전 서버(404)면 조용히", async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "secrets.env");
  fs.writeFileSync(file, "KEEP_ME=keep-me-123\n");
  const logs = [];
  await syncSecretEntries({ api: async () => ({ status: 401, data: null }), log: (m) => logs.push(m), secretsFile: file });
  await syncSecretEntries({ api: async () => { throw Object.assign(new Error(`fetch failed ${SECRET}`), { name: "TypeError" }); }, log: (m) => logs.push(m), secretsFile: file });
  await reportSecretNames({ api: async () => ({ status: 404, data: null }), log: (m) => logs.push(m), secretsFile: file });
  assert.equal(fs.readFileSync(file, "utf8"), "KEEP_ME=keep-me-123\n");
  assert.equal(logs.length, 2);
  noValue(logs.join("\n"));
});

// ───────── AI 도구 상태 ─────────

test("AI 도구 상태: 버전과 공식 로그인 상태 명령 결과만, 확인 못 하면 '확인 안 함'", async () => {
  const seen = [];
  const runner = (answers) => async (cmd, args) => {
    seen.push([cmd, ...args].join(" "));
    return answers[args.join(" ")] ?? null;
  };
  const ok = await aiToolStatus(
    { claudeCmd: "claude", codexCmd: "codex" },
    runner({
      "--version": { status: 0, stdout: "2.1.296 (Claude Code)\n" },
      "auth status --json": { status: 0, stdout: JSON.stringify({ loggedIn: true, email: "someone@example.com" }) },
      "login status": { status: 0, stdout: "Logged in using ChatGPT\n" },
    }),
  );
  assert.equal(ok.claudeTool, "2.1.296 (Claude Code) · 로그인됨");
  assert.match(ok.codexTool, /· 로그인됨$/);
  assert.ok(!JSON.stringify(ok).includes("example.com")); // 계정 정보는 버린다
  assert.deepEqual(seen, ["claude --version", "claude auth status --json", "codex --version", "codex login status"]);

  const notIn = await aiToolStatus(
    { claudeCmd: "claude", codexCmd: "codex" },
    runner({
      "--version": { status: 0, stdout: "codex-cli 0.162.1" },
      "auth status --json": { status: 1, stdout: "not json" },
      "login status": { status: 1, stdout: "", stderr: "Not logged in" },
    }),
  );
  assert.match(notIn.claudeTool, /로그인 확인 안 함$/);
  assert.match(notIn.codexTool, /로그인 안 됨$/);

  const missing = await aiToolStatus({ claudeCmd: "claude", codexCmd: "codex" }, runner({}));
  assert.equal(missing.claudeTool, "없음");
  assert.equal(missing.codexTool, "없음");
  assert.match(missing.aiToolsAt, /^\d{4}-\d{2}-\d{2}T/);
  // 자격 파일을 직접 읽는 코드가 없다
  const src = fs.readFileSync(path.join(repo, "tools/factory-supervisor/secrets.mjs"), "utf8");
  assert.ok(!/\.credentials|auth\.json|\.codex[\\/]/.test(src));
});
