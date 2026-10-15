// 시험용 APK 시험: 준비 조건(막기), 받기(조각·SHA-256·정리), 목록, 관리자 내려받기(인증·id 검사·스트림),
// 감독 프로그램의 APK 경로 검사·apksigner 결과 판정·조각 올리기. DB 는 메모리 가짜. 실제 DB·서버·키는 쓰지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { APK_CHUNK, apkAbis, judgeSignature, parseApksigner, readApkInfo, uploadTestApk, isDebugCert, why } from "../apk.mjs";
import { skipUnlessWebRepo } from "./webrepo.mjs";
skipUnlessWebRepo(import.meta.url);

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.startsWith("@/")) throw new Error(`시험에 없는 모듈: ${name}`);
    return require(name);
  }, module, module.exports);
  return module.exports;
}

// ───── 가짜 DB (factoryJob, factoryTestApk, factoryTestApkChunk) ─────
function fakeDb(jobs = []) {
  const s = { jobs: jobs.map((j) => ({ ...j })), apks: [], chunks: new Map(), seq: 0, clock: Date.parse("2026-10-13T00:00:00Z") };
  const key = (apkId, idx) => `${apkId}#${idx}`;
  const match = (row, where = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        if ("in" in v) return v.in.includes(row[k]);
        if ("lt" in v) return row[k] < v.lt;
      }
      return row[k] === v;
    });
  const dropChunks = (id) => {
    for (const k of [...s.chunks.keys()]) if (k.startsWith(`${id}#`)) s.chunks.delete(k);
  };
  return {
    s,
    factoryJob: { findUnique: async ({ where }) => s.jobs.find((j) => j.id === where.id) ?? null },
    factoryTestApk: {
      create: async ({ data }) => {
        const row = { id: `apk${++s.seq}`, received: 0, complete: false, createdAt: new Date(s.clock + s.seq * 1000), ...data };
        s.apks.push(row);
        return { id: row.id };
      },
      findUnique: async ({ where }) => s.apks.find((a) => a.id === where.id) ?? null,
      findMany: async ({ where, orderBy }) => {
        const rows = s.apks.filter((a) => match(a, where));
        if (orderBy?.createdAt === "desc") rows.sort((a, b) => b.createdAt - a.createdAt);
        return rows.map((r) => ({ ...r }));
      },
      update: async ({ where, data }) => Object.assign(s.apks.find((a) => a.id === where.id), data),
      delete: async ({ where }) => {
        dropChunks(where.id);
        s.apks = s.apks.filter((a) => a.id !== where.id);
      },
      deleteMany: async ({ where }) => {
        const gone = s.apks.filter((a) => match(a, where));
        gone.forEach((a) => dropChunks(a.id));
        s.apks = s.apks.filter((a) => !gone.includes(a));
        return { count: gone.length };
      },
    },
    factoryTestApkChunk: {
      upsert: async ({ where, create }) => s.chunks.set(key(where.apkId_idx.apkId, where.apkId_idx.idx), Buffer.from(create.data)),
      count: async ({ where }) => [...s.chunks.keys()].filter((k) => k.startsWith(`${where.apkId}#`)).length,
      findUnique: async ({ where }) => {
        const d = s.chunks.get(key(where.apkId_idx.apkId, where.apkId_idx.idx));
        return d ? { data: d } : null;
      },
    },
  };
}

const loadApk = (prisma) => loadTs("lib/factory/testApk.ts", { "@/lib/prisma": prisma });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const runningApkJob = { id: "jobapk", appSlug: "tiny-todo", kind: "release", status: "running", releaseKind: "apk" };

// ───── 준비 조건 ─────

test("준비 조건: 키·비밀번호·키 파일·패키지 이름·앱 종류가 모자라면 ⬜ 로 막고 이유를 보여 준다", () => {
  const { apkReadiness } = loadApk({});
  const base = { stack: "flutter", accountLabel: "A", packageName: "com.factory.tiny", key: { name: "공용", path: "~/k.jks", source: "account" }, keyPassword: "delivered", keyFileExists: true, ownKeyProperties: false };
  const lacks = (r) => apkReadiness(r).filter((i) => i.ok === false).map((i) => i.label);

  assert.deepEqual(lacks(base), []);
  const noKey = apkReadiness({ ...base, key: null });
  assert.deepEqual(noKey.filter((i) => i.ok === false).map((i) => i.label), ["서명 키"]);
  assert.match(noKey.find((i) => i.label === "서명 키").note, /키 없음/);
  assert.deepEqual(lacks({ ...base, packageName: null }), ["패키지 이름"]);
  assert.deepEqual(lacks({ ...base, keyPassword: "none" }), ["키 비밀번호"]);
  assert.deepEqual(lacks({ ...base, keyFileExists: false }), ["키 파일 있음"]);
  assert.deepEqual(lacks({ ...base, accountLabel: null }), ["배포 계정 선택"]);
  const kotlin = apkReadiness({ ...base, stack: "kotlin-compose" }).find((i) => i.label === "앱 종류");
  assert.equal(kotlin.ok, false);
  assert.match(kotlin.note, /미지원/);
  // 키 파일 조회 전(⏳)은 막지 않는다, 앱 자체 key.properties 는 키 항목이 통과
  assert.deepEqual(lacks({ ...base, keyFileExists: null }), []);
  assert.deepEqual(lacks({ ...base, key: null, keyPassword: "none", ownKeyProperties: true }), []);
});

// ───── 받기 ─────

test("올리기 시작: 시험용 APK 일감·실행 중·크기·SHA-256 형식을 확인하고, 파일 이름은 안전한 글자만", async () => {
  const db = fakeDb([runningApkJob, { ...runningApkJob, id: "jobstore", releaseKind: "store" }, { ...runningApkJob, id: "jobdone", status: "done" }]);
  const t = loadApk(db);
  const good = { jobId: "jobapk", size: 10, sha256: "a".repeat(64), versionName: "1.0.0+3/../../x", builtAt: "2026-10-13T09:12:00Z" };

  assert.equal((await t.startTestApk({ ...good, jobId: "../etc" })).status, 400);
  assert.equal((await t.startTestApk({ ...good, jobId: "jobstore" })).status, 404);
  assert.equal((await t.startTestApk({ ...good, jobId: "jobdone" })).status, 409);
  assert.equal((await t.startTestApk({ ...good, size: t.TEST_APK_MAX + 1 })).status, 413);
  assert.equal((await t.startTestApk({ ...good, sha256: "xyz" })).status, 400);
  const r = await t.startTestApk(good);
  assert.equal(r.ok, true);
  const row = db.s.apks[0];
  assert.match(row.fileName, /^[0-9A-Za-z._-]+\.apk$/);
  assert.ok(!row.fileName.includes("/") && !row.fileName.includes(".."), row.fileName);
  assert.equal(row.chunkCount, 1);
  assert.equal(row.abi, null); // 예전 감독 프로그램(abi 없음)
  await t.startTestApk({ ...good, jobId: "jobapk", abi: "arm64-v8a" });
  assert.equal(db.s.apks.at(-1).abi, "arm64-v8a");
  await t.startTestApk({ ...good, jobId: "jobapk", abi: "<script>" });
  assert.equal(db.s.apks.at(-1).abi, null); // 모르는 값은 버림
});

test("조각 받기: 크기·번호 확인, 다 받으면 SHA-256 을 다시 재서 맞을 때만 완료(틀리면 지움)", async () => {
  const db = fakeDb([runningApkJob]);
  const t = loadApk(db);
  const C = t.TEST_APK_CHUNK;
  const data = Buffer.alloc(C + 5, 7);
  data[C + 1] = 9;
  const { apkId } = await t.startTestApk({ jobId: "jobapk", size: data.length, sha256: sha(data) });

  assert.equal((await t.receiveTestApkChunk(apkId, 2, data.subarray(0, 5))).status, 400); // 없는 번호
  assert.equal((await t.receiveTestApkChunk(apkId, 0, data.subarray(0, 10))).status, 400); // 크기 틀림
  assert.equal((await t.receiveTestApkChunk("../x", 0, data)).status, 400);
  const a = await t.receiveTestApkChunk(apkId, 1, data.subarray(C));
  assert.equal(a.complete, false);
  const b = await t.receiveTestApkChunk(apkId, 0, data.subarray(0, C));
  assert.equal(b.complete, true);
  assert.equal(db.s.apks[0].complete, true);

  // SHA-256 이 틀리면 완료하지 않고 지운다
  const bad = Buffer.from("hello apk");
  const s2 = await t.startTestApk({ jobId: "jobapk", size: bad.length, sha256: "0".repeat(64) });
  const r2 = await t.receiveTestApkChunk(s2.apkId, 0, bad);
  assert.equal(r2.status, 422);
  assert.equal(db.s.apks.some((x) => x.id === s2.apkId), false);

  // 일감이 끝난 뒤에는 받지 않는다
  const s3 = await t.startTestApk({ jobId: "jobapk", size: 3, sha256: sha(Buffer.from("abc")) });
  db.s.jobs[0].status = "done";
  assert.equal((await t.receiveTestApkChunk(s3.apkId, 0, Buffer.from("abc"))).status, 409);
});

test("정리: 앱당 다 받은 APK 는 최근 5개만, 목록도 최신순 5개, 다른 앱 것은 건드리지 않는다", async () => {
  const db = fakeDb([runningApkJob, { ...runningApkJob, id: "jobother", appSlug: "other-app" }]);
  const t = loadApk(db);
  const put = async (jobId, text) => {
    const b = Buffer.from(text);
    const { apkId } = await t.startTestApk({ jobId, size: b.length, sha256: sha(b), versionName: text });
    await t.receiveTestApkChunk(apkId, 0, b);
    return apkId;
  };
  await put("jobother", "other");
  const ids = [];
  for (let i = 1; i <= 7; i++) ids.push(await put("jobapk", `v${i}`));

  const mine = db.s.apks.filter((a) => a.appSlug === "tiny-todo");
  assert.equal(mine.length, 5);
  assert.deepEqual(mine.map((a) => a.id).sort(), ids.slice(2).sort());
  assert.equal(db.s.apks.filter((a) => a.appSlug === "other-app").length, 1);
  const list = await t.listTestApks(["tiny-todo", "other-app"]);
  assert.deepEqual(list.get("tiny-todo").map((a) => a.versionName), ["v7", "v6", "v5", "v4", "v3"]);
  assert.equal(list.get("other-app").length, 1);
  assert.equal("chunks" in list.get("tiny-todo")[0], false);
});

// ───── 관리자 내려받기 ─────

test("내려받기: 관리자가 아니면 403, id 형식이 틀리면 400, 없거나 덜 받은 건 404, 있으면 첨부 파일로 스트림", async () => {
  const db = fakeDb([runningApkJob]);
  const t = loadApk(db);
  const data = Buffer.alloc(t.TEST_APK_CHUNK * 2 + 3, 1);
  data[0] = 0x50;
  const { apkId } = await t.startTestApk({ jobId: "jobapk", size: data.length, sha256: sha(data), versionName: "1.2.0" });
  for (let i = 0; i < 3; i++) await t.receiveTestApkChunk(apkId, i, data.subarray(i * t.TEST_APK_CHUNK, (i + 1) * t.TEST_APK_CHUNK));
  const pending = await t.startTestApk({ jobId: "jobapk", size: 3, sha256: sha(Buffer.from("abc")) });

  let admin = false;
  const { NextResponse } = require("next/server");
  const route = loadTs("app/api/admin/factory/test-apk/[id]/route.ts", {
    "next/server": require("next/server"),
    "@/lib/factory/admin": { requireAdmin: async () => (admin ? null : NextResponse.json({ message: "권한이 없습니다." }, { status: 403 })) },
    "@/lib/factory/testApk": t,
  });
  const get = (id) => route.GET(new Request("http://x/"), { params: Promise.resolve({ id }) });

  assert.equal((await get(apkId)).status, 403);
  admin = true;
  assert.equal((await get("../../etc")).status, 400);
  assert.equal((await get("nope")).status, 404);
  assert.equal((await get(pending.apkId)).status, 404);
  const res = await get(apkId);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/vnd.android.package-archive");
  assert.match(res.headers.get("content-disposition"), /^attachment; filename="tiny-todo-1\.2\.0-\d{8}T\d{4}\.apk"$/);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(sha(body), sha(data));
});

test("워커 주소: 토큰이 없으면 막고, 8MB 넘는 조각은 읽기 전에 거절", async () => {
  const { NextResponse } = require("next/server");
  const route = loadTs("app/api/factory/test-apk/route.ts", {
    "next/server": require("next/server"),
    "@/lib/factory/http": {
      guardWorker: async (req) => (req.headers.get("authorization") === "Bearer ok" ? null : NextResponse.json({ message: "권한이 없습니다." }, { status: 401 })),
      readJson: async (req) => ({ ok: true, body: await req.json() }),
      fail: (status, message) => NextResponse.json({ message }, { status }),
    },
    "@/lib/factory/testApk": { TEST_APK_CHUNK_MAX: 8 * 1024 * 1024, startTestApk: async () => ({ ok: true, apkId: "a1" }), receiveTestApkChunk: async () => ({ ok: true }) },
  });
  const { NextRequest } = require("next/server");
  const put = (auth, len) => route.PUT(new NextRequest("http://x/api/factory/test-apk?apkId=a1&idx=0", { method: "PUT", headers: { authorization: auth, "content-length": String(len) }, body: "x" }));
  assert.equal((await put("Bearer no", 1)).status, 401);
  assert.equal((await put("Bearer ok", 8 * 1024 * 1024 + 1)).status, 413);
});

test("조각 크기: 상수 하나(기본 512KB, nginx 기본 1MB 아래)로 알려 주고, APK 마다 저장한 크기로 검사(크기가 달라도 이어붙이기·해시 확인)", async () => {
  const db = fakeDb([runningApkJob]);
  const t = loadApk(db);
  assert.equal(t.TEST_APK_CHUNK, 512 * 1024);
  assert.ok(t.TEST_APK_CHUNK < 1024 * 1024);
  const data = Buffer.alloc(t.TEST_APK_CHUNK * 3 + 7, 2);
  data[t.TEST_APK_CHUNK + 3] = 5;
  const s = await t.startTestApk({ jobId: "jobapk", size: data.length, sha256: sha(data) });
  assert.equal(s.chunkSize, t.TEST_APK_CHUNK);
  assert.equal(s.count, 4);
  assert.equal(db.s.apks[0].chunkSize, t.TEST_APK_CHUNK);
  // 순서가 섞여도, 마지막 조각만 작아도 받는다
  for (const i of [3, 1, 0]) assert.equal((await t.receiveTestApkChunk(s.apkId, i, data.subarray(i * s.chunkSize, (i + 1) * s.chunkSize))).complete, false);
  assert.equal((await t.receiveTestApkChunk(s.apkId, 2, data.subarray(2 * s.chunkSize, 3 * s.chunkSize))).complete, true);

  // 예전 8MB 로 시작한 행처럼 다른 크기가 저장돼 있으면 그 크기로 검사한다
  const other = Buffer.from("0123456789abcdefXYZ");
  const s2 = await t.startTestApk({ jobId: "jobapk", size: other.length, sha256: sha(other) });
  const row = db.s.apks.find((a) => a.id === s2.apkId);
  Object.assign(row, { chunkSize: 8, chunkCount: 3 });
  assert.equal((await t.receiveTestApkChunk(s2.apkId, 0, other.subarray(0, 5))).status, 400); // 저장된 크기와 다름
  assert.equal((await t.receiveTestApkChunk(s2.apkId, 0, other.subarray(0, 8))).complete, false);
  assert.equal((await t.receiveTestApkChunk(s2.apkId, 2, other.subarray(16))).complete, false);
  assert.equal((await t.receiveTestApkChunk(s2.apkId, 1, other.subarray(8, 16))).complete, true);
});

// ───── 감독 프로그램 ─────

test("APK 경로 검사: 앱 폴더 밖·.apk 아님·없음·너무 큼은 거절, 정상이면 크기·버전", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apktest-"));
  try {
    fs.mkdirSync(path.join(dir, ".factory"), { recursive: true });
    fs.mkdirSync(path.join(dir, "build"), { recursive: true });
    fs.writeFileSync(path.join(dir, "build", "app.apk"), Buffer.alloc(100, 1));
    fs.writeFileSync(path.join(dir, "build", "note.txt"), "x");
    const w = (v) => fs.writeFileSync(path.join(dir, ".factory", "apk.json"), JSON.stringify(v));

    assert.equal(readApkInfo(dir).ok, false); // apk.json 없음
    w({ path: "../outside.apk" });
    assert.match(readApkInfo(dir).reason, /앱 폴더 밖/);
    w({ path: path.join(os.tmpdir(), "x.apk") });
    assert.match(readApkInfo(dir).reason, /앱 폴더 밖/);
    w({ path: "build/note.txt" });
    assert.match(readApkInfo(dir).reason, /\.apk/);
    w({ path: "build/missing.apk" });
    assert.match(readApkInfo(dir).reason, /없어요/);
    w({ path: "build/app.apk", versionName: "1.0.0", versionCode: 3 });
    assert.match(readApkInfo(dir, { maxBytes: 50 }).reason, /이하만/);
    const ok = readApkInfo(dir);
    assert.equal(ok.ok, true);
    assert.equal(ok.size, 100);
    assert.equal(ok.versionCode, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// 시험용 최소 zip(저장 방식, 내용 없음): 이름만 중앙 디렉터리에 넣는다. 앞에 APK 서명 블록 흉내로 쓰레기 바이트를 둔다
function fakeApk(names) {
  const locals = [];
  const cds = [];
  let off = 0;
  for (const n of names) {
    const nb = Buffer.from(n);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(nb.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(nb.length, 28);
    cd.writeUInt32LE(off, 42);
    locals.push(lh, nb);
    cds.push(cd, nb);
    off += 30 + nb.length;
  }
  const junk = Buffer.alloc(64, 0xab);
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(off + junk.length, 16);
  return Buffer.concat([...locals, junk, cdBuf, eocd]);
}

test("ABI: arm64 전용 APK 만 받고(새 일감), 모든 ABI·다른 ABI 는 거절, 예전 일감(abi 없음)은 그대로", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apkabi-"));
  try {
    const out = path.join(dir, "build", "app", "outputs", "flutter-apk");
    fs.mkdirSync(path.join(dir, ".factory"), { recursive: true });
    fs.mkdirSync(out, { recursive: true });
    const so = (abi) => [`lib/${abi}/libflutter.so`, `lib/${abi}/libapp.so`];
    fs.writeFileSync(path.join(out, "app-arm64-v8a-release.apk"), fakeApk(["AndroidManifest.xml", "classes.dex", ...so("arm64-v8a")]));
    fs.writeFileSync(path.join(out, "app-x86_64-release.apk"), fakeApk(["AndroidManifest.xml", ...so("x86_64")]));
    fs.writeFileSync(path.join(out, "app-release.apk"), fakeApk(["AndroidManifest.xml", ...so("arm64-v8a"), ...so("armeabi-v7a"), ...so("x86_64")]));
    fs.writeFileSync(path.join(out, "broken.apk"), Buffer.alloc(100, 1));
    const w = (name) => fs.writeFileSync(path.join(dir, ".factory", "apk.json"), JSON.stringify({ path: `build/app/outputs/flutter-apk/${name}`, versionName: "1.0.0", versionCode: 1 }));

    assert.deepEqual(apkAbis(path.join(out, "app-release.apk")), ["arm64-v8a", "armeabi-v7a", "x86_64"]);
    assert.equal(apkAbis(path.join(out, "broken.apk")), null);

    w("app-arm64-v8a-release.apk");
    const ok = readApkInfo(dir, { abi: "arm64-v8a" });
    assert.equal(ok.ok, true, ok.reason);
    assert.equal(ok.abi, "arm64-v8a");
    w("app-release.apk");
    const uni = readApkInfo(dir, { abi: "arm64-v8a" });
    assert.equal(uni.ok, false);
    assert.match(uni.reason, /arm64-v8a 전용 APK 가 아니에요\(app-release\.apk: arm64-v8a·armeabi-v7a·x86_64\).*--split-per-abi.*app-arm64-v8a-release\.apk/);
    assert.equal(readApkInfo(dir).abi, "universal"); // 예전 일감: 거절하지 않고 기록만
    w("app-x86_64-release.apk");
    assert.match(readApkInfo(dir, { abi: "arm64-v8a" }).reason, /x86_64/);
    w("broken.apk");
    assert.match(readApkInfo(dir, { abi: "arm64-v8a" }).reason, /zip 으로 읽지 못함/);
    assert.equal(readApkInfo(dir).ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("지시문: 시험용 APK 는 --split-per-abi 로 만들고 app-arm64-v8a-release.apk 만 쓴다, 새 지시문 일감만 abi 를 준다", () => {
  const src = fs.readFileSync(path.join(repo, "lib/factory/release.ts"), "utf8");
  assert.match(src, /flutter build apk --release --split-per-abi/);
  assert.match(src, /flutter-apk\/app-arm64-v8a-release\.apk/);
  assert.ok(!/"path": "build\/app\/outputs\/flutter-apk\/app-release\.apk"/.test(src));
  assert.match(src, /planMarkdown\.includes\("--split-per-abi"\) \? TEST_APK_ABI : null/);
});

const SIGNED = `Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Number of signers: 1
Signer #1 certificate DN: CN=App Factory, C=KR
Signer #1 certificate SHA-256 digest: 0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9
Signer #1 certificate SHA-1 digest: 0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d`;

test("서명 판정: 디버그 키·다른 키·서명 실패는 거절, 같은 키면 통과, 비교할 지문을 모르면 통과하되 메모", () => {
  const p = parseApksigner(SIGNED);
  assert.deepEqual(p.schemes, ["v2", "v3"]);
  assert.equal(p.signers[0].dn, "CN=App Factory, C=KR");
  const v = { ok: true, ...p };
  const fp = p.signers[0].sha256;

  assert.equal(judgeSignature(v, { sha256: fp, label: "k.jks" }).ok, true);
  assert.match(judgeSignature(v, { sha256: "f".repeat(64), label: "k.jks" }).reason, /다른 키/);
  const unknown = judgeSignature(v, { sha256: null, note: "비교하지 못했어요" });
  assert.equal(unknown.ok, true);
  assert.match(unknown.note, /비교하지 못했어요/);
  const debug = { ok: true, ...parseApksigner(SIGNED.replace("CN=App Factory, C=KR", "C=US, O=Android, CN=Android Debug")) };
  assert.equal(isDebugCert(debug.signers[0].dn), true);
  assert.match(judgeSignature(debug, { sha256: null }).reason, /디버그 키/);
  assert.equal(judgeSignature({ ok: false, reason: "apksigner 서명 확인 실패" }, { sha256: fp }).ok, false);
});

test("조각 올리기: 시작 → 8MB 조각, 5xx 는 다시, 마지막에 complete 를 확인", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apkup-"));
  try {
    const file = path.join(dir, "a.apk");
    const size = 8 * 1024 * 1024 * 2 + 10;
    fs.writeFileSync(file, Buffer.alloc(size, 3));
    const calls = [];
    let flaky = true;
    const api = async (method, p, body) => {
      calls.push(`${method} ${p.replace(/\?.*idx=(\d+).*/, "#$1")} ${body instanceof Uint8Array ? body.length : ""}`.trim());
      if (method === "POST") return { status: 200, data: { apkId: "apk1", chunkSize: 8 * 1024 * 1024 } };
      if (flaky && p.endsWith("idx=1")) {
        flaky = false;
        return { status: 502, data: {} };
      }
      return { status: 200, data: { complete: p.endsWith("idx=2") } };
    };
    const r = await uploadTestApk({ file, meta: { jobId: "j", size, sha256: "a".repeat(64) }, api });
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(calls, ["POST /api/factory/test-apk", `PUT /api/factory/test-apk#0 ${8 * 1024 * 1024}`, `PUT /api/factory/test-apk#1 ${8 * 1024 * 1024}`, `PUT /api/factory/test-apk#1 ${8 * 1024 * 1024}`, "PUT /api/factory/test-apk#2 10"]);
    // 4xx 는 다시 하지 않고 멈춘다
    const r2 = await uploadTestApk({ file, meta: { jobId: "j", size, sha256: "a".repeat(64) }, api: async (m) => (m === "POST" ? { status: 409, data: { message: "실행 중이 아님" } } : { status: 200, data: {} }) });
    assert.equal(r2.ok, false);
    assert.match(r2.message, /409/);
    assert.match(r2.message, /실행 중이 아님/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("조각 올리기: 홈페이지가 정한 조각 크기(기본 512KB)를 따르고, 413 이면 응답 본문과 조각 크기를 사유에 남긴다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apkup-"));
  try {
    const file = path.join(dir, "a.apk");
    const size = 512 * 1024 * 3 + 1;
    fs.writeFileSync(file, Buffer.alloc(size, 4));
    const meta = { jobId: "j", size, sha256: "a".repeat(64) };
    const lens = [];
    const ok = await uploadTestApk({
      file,
      meta,
      api: async (m, p, body) => {
        if (m === "POST") return { status: 200, data: { apkId: "apk1" } }; // chunkSize 없음 → 기본값
        lens.push(body.length);
        return { status: 200, data: { complete: p.endsWith("idx=3") } };
      },
    });
    assert.equal(ok.ok, true, ok.message);
    assert.equal(APK_CHUNK, 512 * 1024);
    assert.deepEqual(lens, [APK_CHUNK, APK_CHUNK, APK_CHUNK, 1]);

    // nginx 413: JSON 이 아닌 HTML 본문
    const html = "<html><head><title>413 Request Entity Too Large</title></head><body><center><h1>413 Request Entity Too Large</h1></center><hr><center>nginx</center></body></html>";
    const r = await uploadTestApk({ file, meta, api: async (m) => (m === "POST" ? { status: 200, data: { apkId: "apk1", chunkSize: 256 * 1024 } } : { status: 413, data: null, text: html }) });
    assert.equal(r.ok, false);
    assert.match(r.message, /조각 1\/7 올리기 거절\(413, 조각 262144바이트=256KB\)/);
    assert.match(r.message, /응답 본문: 413 Request Entity Too Large .*nginx/);
    // 본문도 없으면 그렇다고 적는다
    const r3 = await uploadTestApk({ file, meta, api: async (m) => (m === "POST" ? { status: 200, data: { apkId: "apk1" } } : { status: 413, data: null, text: "" }) });
    assert.match(r3.message, /413, 조각 524288바이트=512KB\).*응답 본문 없음/);
    assert.equal(why({ status: 400, data: { message: "조각 크기가 맞지 않아요" } }), "조각 크기가 맞지 않아요");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
