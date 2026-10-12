// 보안 정비 시험: /api/users·/api 루트 라우트 삭제, 업로드 API 관리자 전용·형식·크기·파일명, 관리자 서버 액션 관문.
// 세션은 가짜 auth() 로 바꾼다. 실제 DB·서버는 쓰지 않고, 파일은 임시 폴더에만 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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

const sessionOf = (role) => (role === null ? null : { user: { id: "u1", role } });
const fakeAuth = (role) => ({ auth: async () => sessionOf(role) });

function uploadRequest(field, name, type, size) {
  const form = new FormData();
  form.append(field, new File([new Uint8Array(size)], name, { type }));
  return new Request("http://localhost/api/upload/local", { method: "POST", body: form });
}

test("/api/users 와 /api 루트 라우트는 없다(404)", () => {
  for (const rel of ["app/api/users/route.ts", "app/api/route.ts", "app/api/users/route.js", "app/api/route.js"]) {
    assert.equal(fs.existsSync(path.join(repo, rel)), false, rel);
  }
});

test("업로드 API: 비로그인 401, 일반 사용자 403, 에러 문구에 내부 메시지 없음", async () => {
  for (const [role, status] of [[null, 401], ["user", 403]]) {
    const lib = loadTs("lib/upload/localUpload.ts", { "@/lib/auth/get-sesstion": fakeAuth(role) });
    const img = await lib.handleLocalUpload(uploadRequest("image", "a.png", "image/png", 10), lib.IMAGE_UPLOAD);
    assert.equal(img.status, status);
    assert.equal((await img.json()).success, false);
    const vid = await lib.handleLocalUpload(uploadRequest("video", "a.mp4", "video/mp4", 10), lib.VIDEO_UPLOAD);
    assert.equal(vid.status, status);
  }
  // 라우트 파일이 실제로 이 관문을 쓰는지
  for (const rel of ["app/api/upload/local/route.ts", "app/api/upload/video/local/route.ts"]) {
    const lib = loadTs("lib/upload/localUpload.ts", { "@/lib/auth/get-sesstion": fakeAuth(null) });
    const route = loadTs(rel, { "@/lib/upload/localUpload": lib });
    const res = await route.POST(uploadRequest(rel.includes("video") ? "video" : "image", "a.png", "image/png", 10));
    assert.equal(res.status, 401, rel);
  }
});

test("업로드 API(관리자): 형식·크기 검사, 확장자는 MIME 에 맞게, 임시 폴더에 저장", async () => {
  const lib = loadTs("lib/upload/localUpload.ts", { "@/lib/auth/get-sesstion": fakeAuth("admin") });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "upload-test-"));
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    let res = await lib.handleLocalUpload(uploadRequest("image", "x.svg", "image/svg+xml", 10), lib.IMAGE_UPLOAD);
    assert.equal(res.status, 415);
    res = await lib.handleLocalUpload(uploadRequest("image", "x.html", "text/html", 10), lib.IMAGE_UPLOAD);
    assert.equal(res.status, 415);
    res = await lib.handleLocalUpload(uploadRequest("video", "x.png", "image/png", 10), lib.VIDEO_UPLOAD);
    assert.equal(res.status, 415);
    res = await lib.handleLocalUpload(uploadRequest("image", "big.png", "image/png", lib.IMAGE_UPLOAD.maxBytes + 1), lib.IMAGE_UPLOAD);
    assert.equal(res.status, 413);

    res = await lib.handleLocalUpload(uploadRequest("image", "evil.php", "image/png", 10), lib.IMAGE_UPLOAD);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.match(body.imageUrl, /^\/uploads\/images\/\d+-evil\.png$/);
    assert.ok(fs.existsSync(path.join(tmp, "public", body.imageUrl)));

    res = await lib.handleLocalUpload(uploadRequest("video", "clip.MOV", "video/quicktime", 10), lib.VIDEO_UPLOAD);
    assert.match((await res.json()).videoUrl, /^\/uploads\/videos\/\d+-clip\.mov$/);
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.equal(lib.safeUploadName("../../a.jpeg", ["jpg", "jpeg"], 1), "1-a.jpeg");
  assert.equal(lib.safeUploadName("noext", ["png"], 1), "1-noext.png");
  assert.equal(lib.safeUploadName("x.png.exe", ["png"], 1), "1-xpng.png");
});

test("관리자 서버 액션: 관리자가 아니면 거부, 외주 신청 폼은 공개", async () => {
  const calls = [];
  const prisma = {
    workRequest: {
      findMany: async () => (calls.push("findMany"), []),
      findUnique: async () => (calls.push("findUnique"), null),
      create: async ({ data }) => (calls.push("create"), { id: "w1", ...data }),
      update: async () => (calls.push("update"), {}),
      delete: async () => (calls.push("delete"), {}),
    },
  };
  for (const role of [null, "user"]) {
    const assertAdmin = loadTs("lib/auth/assertAdmin.ts", { "@/lib/auth/get-sesstion": fakeAuth(role) });
    const actions = loadTs("serverActions/workRequests.ts", { "@/lib/prisma": prisma, "@/lib/auth/assertAdmin": assertAdmin, "next/cache": { revalidatePath() {} } });
    await assert.rejects(actions.fetchAllWorkRequests(), /권한/);
    await assert.rejects(actions.fetchWorkRequestById("w1"), /권한/);
    await assert.rejects(actions.updateWorkRequestStatus("w1", "done"), /권한/);
    await assert.rejects(actions.deleteWorkRequest("w1"), /권한/);
    const created = await actions.createWorkRequest({ name: "n", email: "e@x", projectType: "app", budget: "1", timeline: "1", title: "t", description: "d" });
    assert.equal(created.success, true);
  }
  assert.deepEqual(calls, ["create", "create"]);

  const admin = loadTs("lib/auth/assertAdmin.ts", { "@/lib/auth/get-sesstion": fakeAuth("admin") });
  const actions = loadTs("serverActions/workRequests.ts", { "@/lib/prisma": prisma, "@/lib/auth/assertAdmin": admin, "next/cache": { revalidatePath() {} } });
  assert.deepEqual(await actions.fetchAllWorkRequests(), []);
});
