// 한 컷 승인 컷 가져오기 시험: 가짜 서버·가짜 한 컷 서버만 쓴다(ssh·네트워크 없음).
import test from "node:test";
import assert from "node:assert/strict";

import { buildForm, fetchApprovedCuts, fetchCutImage, importAll, noteOf, setCellSize, srcKeyOf } from "../importhancut.mjs";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");
const cut = (id, extra = {}) => ({ id, slug: `s${id}`, line: `한 줄 ${id}`, topic: "t", image_file: `images/abc${id}_a1_0.png`, created_at: "2026-10-09T10:08:14.982Z", approved_at: "2026-10-10T00:07:15.316Z", ...extra });

test("폼: 싹이·image-scene·승인·pixellab·srcKey=hancut:<id>·원래 시각·메모", () => {
  const form = buildForm(cut(7), PNG);
  const get = (k) => form.get(k);
  assert.equal(get("appSlug"), "one-tiny-frame");
  assert.equal(get("subject"), "싹이");
  assert.equal(get("kind"), "image-scene");
  assert.equal(get("status"), "approved");
  assert.equal(get("method"), "pixellab");
  assert.equal(get("srcKey"), "hancut:7");
  assert.equal(get("createdAt"), "2026-10-09T10:08:14.982Z");
  assert.equal(get("decidedAt"), "2026-10-10T00:07:15.316Z");
  assert.equal(get("note"), "한 컷 #7 · 2026-10-09 · 한 줄 7");
  assert.equal(srcKeyOf(cut(7)), "hancut:7");
  assert.ok(noteOf(cut(1, { line: "가".repeat(500) })).length <= 200);
});

test("전부 가져오기: 올림·이미 있음·실패를 세고, 이미지 못 읽은 컷은 건너뛰고, --dry 는 올리지 않는다", async () => {
  const cuts = [cut(1), cut(2), cut(3), cut(4)];
  const seen = new Set();
  const posted = [];
  const post = async (form) => {
    posted.push(form.get("srcKey"));
    if (form.get("srcKey") === "hancut:4") return { status: 500, data: null };
    const dup = seen.has(form.get("srcKey"));
    seen.add(form.get("srcKey"));
    return { status: 200, data: { duplicate: dup } };
  };
  const readImage = (f) => (f.includes("abc3") ? null : PNG);
  const first = await importAll({ cuts, readImage, post });
  assert.deepEqual([first.uploaded, first.duplicate, first.failed], [2, 0, 2]);
  const second = await importAll({ cuts, readImage, post });
  assert.deepEqual([second.uploaded, second.duplicate, second.failed], [0, 2, 2], "다시 돌려도 중복 등록 없음");
  posted.length = 0;
  const dry = await importAll({ cuts, readImage, post, dry: true });
  assert.equal(posted.length, 0);
  assert.equal(dry.failed, 1);
});

test("한 컷 서버 읽기: 명령은 읽기 전용 조회·cat 뿐, 이상한 파일 이름·PNG 아닌 데이터는 거절", () => {
  const cmds = [];
  const run = (c) => {
    cmds.push(c);
    return c.includes("node -e") ? { status: 0, stdout: Buffer.from(JSON.stringify([cut(1)])), stderr: "" } : { status: 0, stdout: PNG, stderr: "" };
  };
  assert.equal(fetchApprovedCuts(run).length, 1);
  assert.ok(Buffer.isBuffer(fetchCutImage("images/abc1_a1_0.png", run)));
  assert.equal(fetchCutImage("images/../etc/passwd", run), null);
  assert.equal(fetchCutImage("images/x.png; rm -rf /", run), null);
  assert.equal(fetchCutImage("images/ok.png", () => ({ status: 0, stdout: Buffer.from("not a png at all"), stderr: "" })), null);
  assert.ok(cmds[0].includes("readonly:true"));
  assert.ok(!cmds.some((c) => /\b(rm|mv|cp|sqlite3|insert|update|delete|drop)\b/i.test(c.replace(/readonly|better-sqlite3/gi, ""))), cmds.join("\n"));
  assert.throws(() => fetchApprovedCuts(() => ({ status: 1, stdout: Buffer.alloc(0), stderr: "x" })), /조회 실패/);
});

test("설정 칸 크기: 정비 이름으로 spec.cell_size 128 patch, 결과 문구", async () => {
  let body;
  const ok = await setCellSize(async (b) => ((body = b), { status: 200, data: { unchanged: false, version: 3 } }));
  assert.deepEqual(body.patch, { spec: { cell_size: 128 } });
  assert.equal(body.who, "정비");
  assert.equal(body.appSlug, "one-tiny-frame");
  assert.ok(ok.ok && ok.line.includes("버전 3"));
  assert.ok((await setCellSize(async () => ({ status: 200, data: { unchanged: true } }))).line.includes("이미 그 값"));
  assert.ok((await setCellSize(async () => ({ status: 404, data: null }))).line.includes("배포"));
  assert.equal((await setCellSize(async () => ({ status: 400, data: { message: "나쁨" } }))).ok, false);
});
