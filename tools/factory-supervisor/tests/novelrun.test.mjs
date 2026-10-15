// 소설 실행기(novelrun.mjs) 시험: 순수 함수(인자·메모 이어 붙이기·결과 읽기·비용) + 가짜 홈페이지(127.0.0.1) + 진짜 bash + 가짜 cycle.sh 로 끝까지.
// 진짜 홈페이지·진짜 작품 폴더·진짜 감독 프로그램은 건드리지 않는다(임시 폴더만). 실행: node tools/factory-supervisor/tests/novelrun.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  appendMemo,
  costOfNewRows,
  createNovelRunner,
  cycleArgs,
  epName,
  findBashCmd,
  lastResultBlock,
  listEpisodes,
  listNovelDirs,
  parseChars,
  parseCounts,
  parseVerdict,
  summaryLine,
  usageRows,
  workDirOf,
} from "../novelrun.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "novelrun-"));
const BASH = findBashCmd("");
const hasBash = (() => {
  try {
    return spawnSync(BASH, ["-c", "echo ok"], { encoding: "utf8" }).stdout.trim() === "ok";
  } catch {
    return false;
  }
})();

test("cycleArgs: 모드별 인자", () => {
  assert.deepEqual(cycleArgs(1, { fresh: false, skipWrite: true, maxRewrites: 0 }), ["001", "--skip-write", "--max-rewrites", "0"]);
  assert.deepEqual(cycleArgs(7, { fresh: false, skipWrite: true, maxRewrites: 2 }), ["007", "--skip-write", "--max-rewrites", "2"]);
  assert.deepEqual(cycleArgs(12, { fresh: true, skipWrite: false, maxRewrites: 0 }), ["012", "--fresh", "--max-rewrites", "0"]);
  assert.deepEqual(cycleArgs(3, { maxRewrites: 99 }), ["003", "--max-rewrites", "0"], "범위 밖 값은 0");
  assert.equal(epName(1234), "1234");
});

test("workDirOf: 작품 이름 형식·novelsDir 밖 거부", () => {
  const cfg = { workDir: "/x/factory", novelsDir: "/x/factory/novels" };
  assert.ok(workDirOf(cfg, "murim-first").endsWith("murim-first"));
  for (const bad of ["../etc", "a/b", "A_B", "", "x", null, "..", "murim-first/../../y"]) assert.equal(workDirOf(cfg, bad), null, String(bad));
});

test("appendMemo: 기존 항목 유지·같은 줄 한 번만·새 파일은 머리말", () => {
  const dir = tmp();
  const file = path.join(dir, "reviews", "001-memo.md");
  assert.equal(appendMemo(file, ["- (필수) [L23] 시점 고치기", "- (권장) 비유 줄이기", "잡담 줄", ""], 1), 2);
  const first = fs.readFileSync(file, "utf8");
  assert.match(first, /^# 001화 사람의 수정 요청 메모/);
  assert.match(first, /- \(필수\) \[L23\] 시점 고치기\n- \(권장\) 비유 줄이기\n$/);
  assert.equal(appendMemo(file, ["- (필수) [L23] 시점 고치기", "- (필수) [L5] 새 항목"], 1), 1, "이미 있는 줄은 건너뜀");
  const second = fs.readFileSync(file, "utf8");
  assert.ok(second.startsWith(first), "기존 내용은 그대로");
  assert.equal(second.split("\n").filter((l) => l.startsWith("- ")).length, 3);
  // 줄바꿈 없이 끝난 기존 파일에도 안전하게 이어 붙인다
  fs.writeFileSync(file, "- 기존 항목", "utf8");
  appendMemo(file, ["- (권장) 추가"], 1);
  assert.equal(fs.readFileSync(file, "utf8"), "- 기존 항목\n- (권장) 추가\n");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("결과 읽기: 판정·건수·글자 수·비용", () => {
  const review = "# 001화 검수 결과\n| 등급 | 유형 | 위치 | 내용 | 제안 |\n|---|---|---|---|---|\n| 필수 | quality | L5 | a | b |\n| 권장 | voice | L9 | c | d |\n\n## 최종 판정 (스크립트)\n- checker FAIL, reader PASS, 필수 합계 3건, 권장 18건, 분량 5,468자(범위 안)\n\nVERDICT: FAIL\n";
  assert.equal(parseVerdict(review), "FAIL");
  assert.equal(parseVerdict("VERDICT: PASS\n\n... 본문에 VERDICT: FAIL 이라고 적힌 줄 아님"), "PASS");
  assert.equal(parseVerdict("판정 없음"), null);
  assert.deepEqual(parseCounts(review), { must: 3, rec: 18 });
  assert.deepEqual(parseCounts("| 필수 | a | L1 | x | y |\n| 필수 | a | L2 | x | y |\n| 권장 | a | L3 | x | y |"), { must: 2, rec: 1 });
  assert.deepEqual(parseCounts("없음"), { must: null, rec: null });
  const log = "옛 로그\n===== 001화 사이클 결과 =====\n최종 판정: PASS\n재작성 횟수: 0 / 0\n글자 수: 공백 포함 5,012자 (공백 제외 4,000자)\n";
  const block = lastResultBlock(log + "\n===== 001화 사이클 결과 =====\n최종 판정: FAIL\n재작성 횟수: 2 / 2\n글자 수: 공백 포함 5,468자 (공백 제외 1자)\n", 1);
  assert.match(block, /최종 판정: FAIL/);
  assert.equal(parseChars(block, review), 5468);
  assert.equal(parseChars("", review), 5468, "로그에 없으면 검수 파일의 분량");
  assert.equal(lastResultBlock("없음", 1), "");
  const before = usageRows("| 화 | 역할 |\n|---|---|\n| 1 | checker-1 | m | 1 | 2 | 1분 | 자동 사이클, $0.3725 |\n");
  const after = usageRows("| 1 | checker-1 | m | 1 | 2 | 1분 | 자동 사이클, $0.3725 |\n| 1 | reader-1 | m | 1 | 2 | 1분 | 자동 사이클, 캐시 읽기 8,355, $0.0971 |\n| 1 | writer-1 | m | 1 | 2 | 1분 | 자동 사이클, 권한 거부 1회 |\n");
  assert.equal(before.length, 1);
  assert.equal(costOfNewRows(before, after), 0.0971, "새 행만 더하고, 비용이 없는 행은 0");
  assert.equal(costOfNewRows(after, before), 0, "행이 줄었으면 0");
  assert.equal(summaryLine({ verdict: "PASS", must: 0, rec: 2, chars: 5012, rewrites: "0/0", costUsd: 0.4 }), "판정 PASS · 필수 0건 · 권장 2건 · 5,012자 · 재작성 0/0 · $0.40");
});

test("listNovelDirs·listEpisodes: cycle.sh 가 있는 폴더만", () => {
  const base = tmp();
  fs.mkdirSync(path.join(base, "novels", "my-novel", "chapters"), { recursive: true });
  fs.writeFileSync(path.join(base, "novels", "my-novel", "cycle.sh"), "#!/bin/bash\n");
  fs.writeFileSync(path.join(base, "novels", "my-novel", "chapters", "002.md"), "x");
  fs.writeFileSync(path.join(base, "novels", "my-novel", "chapters", "001.md"), "x");
  fs.writeFileSync(path.join(base, "novels", "my-novel", "chapters", "notes.md"), "x");
  fs.mkdirSync(path.join(base, "novels", "other-dir"), { recursive: true });
  const cfg = { workDir: base };
  assert.deepEqual(listNovelDirs(cfg), ["my-novel"]);
  assert.deepEqual(listEpisodes(path.join(base, "novels", "my-novel")), [1, 2]);
  fs.rmSync(base, { recursive: true, force: true });
});

// ───────── 가짜 홈페이지 ─────────
function fakeServer(handlers) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) : null;
      const url = new URL(req.url, "http://x");
      calls.push({ method: req.method, path: url.pathname, query: url.search, body });
      const h = handlers[`${req.method} ${url.pathname}`];
      const out = h ? h(body, calls) : { status: 404, data: { message: "없음" } };
      res.writeHead(out.status ?? 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.data ?? {}));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

const apiTo = (url) => async (method, p, body) => {
  const res = await fetch(url + p, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer fake" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* JSON 아님 */
  }
  return { status: res.status, data };
};

const killBash = (child) => {
  if (child && child.exitCode === null) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
};

// 가짜 작품 폴더: cycle.sh 는 인자를 args.txt 에 적고 chapters/검수/usage/로그를 만든다(진짜 cycle.sh 의 출력 모양)
function makeNovel(base, slug, script) {
  const dir = path.join(base, "novels", slug);
  fs.mkdirSync(path.join(dir, "chapters"), { recursive: true });
  fs.mkdirSync(path.join(dir, "reviews"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "chapters", "001.md"), "# 001화 시험 제목\n\n첫 문단이다.\n\n둘째 문단이다.\n", "utf8");
  fs.writeFileSync(path.join(dir, "usage.md"), "# 사용량 기록\n\n| 화 | 역할 | 모델 | 입력 | 출력 | 소요 | 메모 |\n|---|---|---|---|---|---|---|\n| 1 | checker-1 | m | 1 | 2 | 1분 | 자동 사이클, $9.0000 |\n", "utf8");
  fs.writeFileSync(path.join(dir, "cycle.sh"), script, { mode: 0o755 });
  return dir;
}

const OK_CYCLE = `#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "$@" > args.txt
cp reviews/001-memo.md memo-seen.txt 2>/dev/null
echo "[로그] 검수 시작 한글 확인"
cat > reviews/001.md <<'EOF'
# 001화 검수 결과
| 등급(필수/권장) | 유형 | 위치 | 내용 | 수정 제안 |
|---|---|---|---|---|
| 필수 | quality | L3 | 문장이 길다 | 줄인다 |
| 권장 | voice | L5 | 말투 | 바꾼다 |

## 최종 판정 (스크립트)
- checker FAIL, reader PASS, 필수 합계 1건, 권장 1건, 분량 5,012자(범위 안)

VERDICT: FAIL
EOF
echo "| 1 | checker-1 | m | 1 | 2 | 1분 | 자동 사이클, \\$0.3000 |" >> usage.md
echo "| 1 | reader-1 | m | 1 | 2 | 1분 | 자동 사이클, \\$0.1000 |" >> usage.md
{
  echo "===== 001화 사이클 결과 ====="
  echo "최종 판정: FAIL"
  echo "재작성 횟수: 0 / 0"
  echo "글자 수: 공백 포함 5,012자 (공백 제외 4,000자)"
} | tee -a logs/cycle-001.log
`;

const nextJob = (over = {}) => ({
  id: "job1",
  workSlug: "my-novel",
  episode: 1,
  mode: "check",
  params: { fresh: false, skipWrite: true, maxRewrites: 0 },
  notes: [
    { id: "n1", line: 3, kind: "필수", text: "첫 문단을 고친다", memoLine: "- (필수) [L3] 첫 문단을 고친다" },
    { id: "n2", line: null, kind: "권장", text: "전체 톤", memoLine: "- (권장) 전체 톤" },
  ],
  timeoutMin: 40,
  ...over,
});

async function waitFor(pred, ms = 20000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

test("끝까지: 메모 이어 붙이기 → cycle.sh 실행 → 결과·원고·비용 완료 보고(+ 메모 applied)", { skip: !hasBash && "git bash 없음" }, async () => {
  const base = tmp();
  const dir = makeNovel(base, "my-novel", OK_CYCLE);
  const fake = await fakeServer({
    "POST /api/novel/jobs/recover": () => ({ data: { ok: true, failed: 2 } }),
    "GET /api/novel/jobs/next": (_b, calls) => ({ data: { job: calls.some((c) => c.path === "/api/novel/jobs/complete") ? null : nextJob() } }),
    "POST /api/novel/jobs/progress": () => ({ data: { ok: true, cancel: false } }),
    "POST /api/novel/jobs/complete": () => ({ data: { ok: true, status: "done" } }),
    "POST /api/novel/jobs/content": () => ({ data: { ok: true } }),
  });
  const logs = [];
  const runner = createNovelRunner({ api: apiTo(fake.url), log: (m) => logs.push(m), cfg: () => ({ workDir: base, bashCmd: BASH }), killTree: killBash, beatMs: 200 });
  assert.equal(runner.busy(), false);
  assert.equal(await runner.tick({ canStart: true }), true, "시작함");
  assert.equal(runner.busy(), true, "시작 즉시 진행 중으로 센다");
  assert.equal(await runner.tick({ canStart: true }), false, "도는 중에는 또 가져오지 않는다(한 번에 하나)");
  assert.ok(await waitFor(() => fake.calls.some((c) => c.path === "/api/novel/jobs/complete")), "완료 보고");
  assert.ok(await waitFor(() => !runner.busy()));
  const done = fake.calls.find((c) => c.path === "/api/novel/jobs/complete").body;
  assert.equal(done.id, "job1");
  assert.equal(done.ok, true);
  assert.equal(done.verdict, "FAIL");
  assert.equal(done.mustCount, 1);
  assert.equal(done.recCount, 1);
  assert.equal(done.charCount, 5012);
  assert.equal(done.costUsd, 0.4, "이번에 늘어난 usage 행만(기존 $9 는 제외)");
  assert.match(done.summary, /판정 FAIL · 필수 1건 · 권장 1건 · 5,012자 · 재작성 0\/0 · \$0\.40/);
  assert.match(done.logTail, /한글 확인/, "UTF-8 출력");
  assert.match(done.chapter, /^# 001화 시험 제목/);
  assert.match(done.review, /VERDICT: FAIL/);
  assert.deepEqual(done.appliedNoteIds, ["n1", "n2"]);
  // 실행 인자·메모 파일(실행 전에 이어 붙음)
  assert.equal(fs.readFileSync(path.join(dir, "args.txt"), "utf8").trim(), "001 --skip-write --max-rewrites 0");
  const memo = fs.readFileSync(path.join(dir, "reviews", "001-memo.md"), "utf8");
  assert.match(memo, /- \(필수\) \[L3\] 첫 문단을 고친다\n- \(권장\) 전체 톤\n$/);
  assert.ok(fs.existsSync(path.join(dir, "memo-seen.txt")), "cycle.sh 가 도는 시점에 메모 파일이 이미 있었다");
  assert.ok(fake.calls.some((c) => c.path === "/api/novel/jobs/progress" && /검수 시작/.test(c.body.logTail)) || done.logTail.length > 0);
  assert.ok(fake.calls.find((c) => c.path === "/api/novel/jobs/recover"), "시작 때 재시작 정리를 한 번 호출");
  assert.equal(fake.calls.filter((c) => c.path === "/api/novel/jobs/recover").length, 1);
  fake.server.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("실패: 종료 코드≠0 → failed + 마지막 로그, 메모는 applied 로 보내지 않음", { skip: !hasBash && "git bash 없음" }, async () => {
  const base = tmp();
  makeNovel(base, "my-novel", '#!/usr/bin/env bash\necho "재작성 실패. 로그 참조"\nexit 3\n');
  const fake = await fakeServer({
    "POST /api/novel/jobs/recover": () => ({ data: { ok: true, failed: 0 } }),
    "GET /api/novel/jobs/next": (_b, calls) => ({ data: { job: calls.some((c) => c.path === "/api/novel/jobs/complete") ? null : nextJob() } }),
    "POST /api/novel/jobs/progress": () => ({ data: { ok: true, cancel: false } }),
    "POST /api/novel/jobs/complete": () => ({ data: { ok: true, status: "failed" } }),
  });
  const runner = createNovelRunner({ api: apiTo(fake.url), log: () => {}, cfg: () => ({ workDir: base, bashCmd: BASH }), killTree: killBash, beatMs: 200 });
  await runner.tick({ canStart: true });
  assert.ok(await waitFor(() => fake.calls.some((c) => c.path === "/api/novel/jobs/complete")));
  const done = fake.calls.find((c) => c.path === "/api/novel/jobs/complete").body;
  assert.equal(done.ok, false);
  assert.match(done.summary, /종료 코드 3/);
  assert.match(done.summary, /재작성 실패/);
  assert.equal(done.appliedNoteIds, undefined);
  assert.ok(await waitFor(() => !runner.busy()));
  fake.server.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("작품 폴더·cycle.sh 가 없으면 바로 failed 로 보고", async () => {
  const base = tmp();
  const fake = await fakeServer({
    "POST /api/novel/jobs/recover": () => ({ data: { ok: true } }),
    "GET /api/novel/jobs/next": (_b, calls) => ({ data: { job: calls.some((c) => c.path === "/api/novel/jobs/complete") ? null : nextJob({ workSlug: "no-such-novel" }) } }),
    "POST /api/novel/jobs/complete": () => ({ data: { ok: true } }),
  });
  const runner = createNovelRunner({ api: apiTo(fake.url), log: () => {}, cfg: () => ({ workDir: base, bashCmd: BASH }), killTree: killBash, beatMs: 200 });
  await runner.tick({ canStart: true });
  assert.ok(await waitFor(() => fake.calls.some((c) => c.path === "/api/novel/jobs/complete")));
  const done = fake.calls.find((c) => c.path === "/api/novel/jobs/complete").body;
  assert.equal(done.ok, false);
  assert.match(done.summary, /cycle\.sh 가 없어요/);
  fake.server.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("취소: 진행 보고 응답 cancel=true 면 cycle.sh 를 멈추고 취소로 보고", { skip: !hasBash && "git bash 없음" }, async () => {
  const base = tmp();
  const dir = makeNovel(base, "my-novel", '#!/usr/bin/env bash\ncd "$(dirname "$0")"\necho started > started.txt\nsleep 25\necho done > finished.txt\n');
  let cancel = false;
  const fake = await fakeServer({
    "POST /api/novel/jobs/recover": () => ({ data: { ok: true } }),
    "GET /api/novel/jobs/next": (_b, calls) => ({ data: { job: calls.some((c) => c.path === "/api/novel/jobs/complete") ? null : nextJob({ notes: [] }) } }),
    "POST /api/novel/jobs/progress": () => ({ data: { ok: true, cancel } }),
    "POST /api/novel/jobs/complete": () => ({ data: { ok: true, status: "cancelled" } }),
  });
  const runner = createNovelRunner({ api: apiTo(fake.url), log: () => {}, cfg: () => ({ workDir: base, bashCmd: BASH }), killTree: killBash, beatMs: 200 });
  await runner.tick({ canStart: true });
  assert.ok(await waitFor(() => fs.existsSync(path.join(dir, "started.txt"))));
  cancel = true;
  assert.ok(await waitFor(() => fake.calls.some((c) => c.path === "/api/novel/jobs/complete"), 15000), "취소 뒤 보고");
  const done = fake.calls.find((c) => c.path === "/api/novel/jobs/complete").body;
  assert.equal(done.ok, false);
  assert.match(done.summary, /취소/);
  assert.ok(await waitFor(() => !runner.busy()));
  assert.equal(fs.existsSync(path.join(dir, "finished.txt")), false, "멈췄으니 끝까지 돌지 않았다");
  fake.server.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("시간 초과: timeoutMin 을 넘으면 멈추고 failed", { skip: !hasBash && "git bash 없음" }, async () => {
  const base = tmp();
  makeNovel(base, "my-novel", '#!/usr/bin/env bash\nsleep 25\n');
  let t = 1_000_000;
  const fake = await fakeServer({
    "POST /api/novel/jobs/recover": () => ({ data: { ok: true } }),
    "GET /api/novel/jobs/next": (_b, calls) => ({ data: { job: calls.some((c) => c.path === "/api/novel/jobs/complete") ? null : nextJob({ notes: [], timeoutMin: 1 }) } }),
    "POST /api/novel/jobs/progress": () => ({ data: { ok: true, cancel: false } }),
    "POST /api/novel/jobs/complete": () => ({ data: { ok: true } }),
  });
  const runner = createNovelRunner({ api: apiTo(fake.url), log: () => {}, cfg: () => ({ workDir: base, bashCmd: BASH }), killTree: killBash, beatMs: 200, now: () => t });
  await runner.tick({ canStart: true });
  t += 61_000; // 1분 지남(가짜 시계)
  assert.ok(await waitFor(() => fake.calls.some((c) => c.path === "/api/novel/jobs/complete"), 15000));
  const done = fake.calls.find((c) => c.path === "/api/novel/jobs/complete").body;
  assert.equal(done.ok, false);
  assert.match(done.summary, /시간 초과/);
  fake.server.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("canStart=false(앱 일감·일시 정지·업데이트 중)면 가져오지 않는다. 재시작 정리는 한 번만", async () => {
  const base = tmp();
  const fake = await fakeServer({
    "POST /api/novel/jobs/recover": () => ({ data: { ok: true, failed: 0 } }),
    "GET /api/novel/jobs/next": () => ({ data: { job: null } }),
  });
  const runner = createNovelRunner({ api: apiTo(fake.url), log: () => {}, cfg: () => ({ workDir: base }), killTree: killBash });
  await runner.tick({ canStart: false, idle: false });
  await runner.tick({ canStart: false, idle: false });
  assert.equal(fake.calls.filter((c) => c.path === "/api/novel/jobs/next").length, 0);
  assert.equal(fake.calls.filter((c) => c.path === "/api/novel/jobs/recover").length, 1);
  await runner.tick({ canStart: true, idle: false });
  assert.equal(fake.calls.filter((c) => c.path === "/api/novel/jobs/next").length, 1);
  fake.server.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("서버가 아직 구버전(404)이면 조용히 물러났다가 나중에 다시 본다(던지지 않음)", async () => {
  const base = tmp();
  let t = 5_000_000;
  const fake = await fakeServer({});
  const logs = [];
  const runner = createNovelRunner({ api: apiTo(fake.url), log: (m) => logs.push(m), cfg: () => ({ workDir: base }), killTree: killBash, now: () => t });
  assert.equal(await runner.tick({ canStart: true }), false);
  assert.equal(await runner.tick({ canStart: true }), false);
  assert.equal(fake.calls.length, 1, "10분 동안은 다시 묻지 않는다");
  assert.equal(logs.filter((m) => /소설 실행 기능이 없는 버전/.test(m)).length, 1, "안내는 한 번만");
  t += 11 * 60_000;
  await runner.tick({ canStart: true });
  assert.equal(fake.calls.length, 2);
  fake.server.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("연결 오류도 던지지 않는다", async () => {
  const runner = createNovelRunner({ api: async () => { throw new Error("연결 실패"); }, log: () => {}, cfg: () => ({ workDir: tmp() }), killTree: killBash });
  assert.equal(await runner.tick({ canStart: true }), false);
});

test("원고·검수 사본 올리기: 바뀐 것만, 작업이 없을 때", async () => {
  const base = tmp();
  const dir = makeNovel(base, "my-novel", "#!/bin/bash\n");
  fs.writeFileSync(path.join(dir, "reviews", "001.md"), "| 필수 | q | L3 | x | y |\n\nVERDICT: FAIL\n", "utf8");
  const fake = await fakeServer({ "POST /api/novel/jobs/content": () => ({ data: { ok: true, created: true, changed: true } }) });
  const runner = createNovelRunner({ api: apiTo(fake.url), log: () => {}, cfg: () => ({ workDir: base }), killTree: killBash });
  assert.equal(await runner.syncContent(), 1);
  const body = fake.calls[0].body;
  assert.equal(body.slug, "my-novel");
  assert.equal(body.episode, 1);
  assert.equal(body.title, "시험 제목");
  assert.match(body.chapter, /첫 문단이다/);
  assert.equal(body.verdict, "FAIL");
  assert.equal(body.mustCount, 1);
  assert.equal(await runner.syncContent(), 0, "그대로면 다시 올리지 않는다");
  fs.appendFileSync(path.join(dir, "chapters", "001.md"), "한 줄 더\n");
  assert.equal(await runner.syncContent(), 1, "바뀌면 다시");
  fake.server.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("supervisor.mjs 연결: 소설 실행기가 앱 일감·업데이트·재시작·정비와 얽혀 있다", () => {
  const src = fs.readFileSync(new URL("../supervisor.mjs", import.meta.url), "utf8");
  assert.match(src, /import \{ createNovelRunner \} from "\.\/novelrun\.mjs"/);
  assert.match(src, /const take = novel\.busy\(\) \? 0 : planTake\(/, "소설이 도는 동안 앱 일감을 새로 받지 않는다");
  assert.match(src, /novel\.busy\(\) \? 1 : 0\) \+ \(novel\.busy\(\)|maintenanceBusy\(\) \? 1 : 0\) \+ \(novel\.busy\(\) \? 1 : 0\), autoUpdate/, "업데이트 판단에 소설 포함");
  assert.match(src, /maintenanceBusy\(\) \|\| novel\.busy\(\)\) break|maintenanceBusy\(\) \|\| novel\.busy\(\), shutdown/, "재시작 판단에 소설 포함");
  assert.match(src, /await novel\.tick\(\{ canStart: quiet, idle: quiet \}\)/);
  assert.match(src, /!drain && !paused && !restartPending\(\) && offered\.length === 0 && running\.size === 0/, "일시 정지·업데이트·재시작·앱 일감 중에는 시작하지 않는다");
  assert.match(src, /novel\.stop\(\)/, "종료 때 cycle.sh 도 멈춘다");
  // novel.tick 은 /next 응답 처리 안(try 안)에 있지만 던지지 않는 함수라 폴링 성공 여부(notePoll)에는 영향이 없다
  const loopSrc = src.slice(src.indexOf("async function loop()"));
  assert.ok(loopSrc.indexOf("notePoll(r.status === 200)") < loopSrc.indexOf("novel.tick"), "건강 확인(notePoll)은 소설보다 먼저");
});
