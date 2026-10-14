// 1-1 D-1 시험(감독 프로그램 쪽): 서버 배포 중 홈페이지가 응답하지 않는 동안 보고가 유실·중복 없이 순서대로 다시 가는지,
// 큰 업로드 추적이 되는지. 진짜 감독·진짜 서버는 건드리지 않고 127.0.0.1 의 가짜 홈페이지(HTTP 서버)만 쓴다. 실행: node tools/factory-supervisor/tests/outbox.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createOutbox, isTransient, trackUpload, uploadBusy, uploadLabels } from "../outbox.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 가짜 홈페이지: mode = up | down(502) | drop(연결 끊음) | lose(처리하고 응답은 끊음 = 처리됐는데 응답이 사라진 경우)
async function fakeHomepage() {
  const state = { mode: "up", processed: [], seen: new Set(), hits: 0 };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      state.hits++;
      if (state.mode === "down") {
        res.writeHead(502, { "Content-Type": "text/html" });
        return res.end("<html>502 Bad Gateway</html>");
      }
      if (state.mode === "drop") return req.socket.destroy();
      const id = req.headers["x-request-id"];
      const body = JSON.parse(raw || "{}");
      let dup = false;
      if (id && state.seen.has(id)) dup = true; // 서버의 requestSeen 과 같은 동작
      else {
        state.processed.push({ id, ...body });
        if (id) state.seen.add(id);
      }
      if (state.mode === "lose") return req.socket.destroy();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...(dup ? { duplicate: true } : {}), ...(body.status === "done" ? { finalCheck: { appSlug: "a", group: "g" } } : {}) }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const sendOnce = async (method, path, body, { requestId, timeoutMs = 3000 } = {}) => {
    const res = await fetch(url + path, { method, headers: { "Content-Type": "application/json", ...(requestId ? { "X-Request-Id": requestId } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    let data = null;
    try { data = await res.json(); } catch { /* 본문 없음 */ }
    return { status: res.status, data, text: "" };
  };
  return { state, sendOnce, close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(r))) };
}
const fastBox = (sendOnce, logs = []) => createOutbox({ sendOnce, log: (m) => logs.push(m), retryMs: 20, maxRetryMs: 40 });

test("isTransient: 연결 실패·502/503/504 만 '홈페이지가 응답하지 않음'", () => {
  for (const s of [0, 408, 502, 503, 504, 522]) assert.equal(isTransient({ status: s }), true, String(s));
  for (const s of [200, 400, 401, 404, 409, 413, 429, 500]) assert.equal(isTransient({ status: s }), false, String(s));
});

test("배포 중 보고·로그·하트비트·완료 보고가 유실 없이 순서대로 다시 간다", async () => {
  const hp = await fakeHomepage();
  const box = fastBox(hp.sendOnce);
  const delivered = [];
  try {
    hp.state.mode = "down"; // 배포 시작: 홈페이지가 502 를 준다
    const r1 = await box.send({ kind: "report", path: "/r", body: { jobId: "j1", n: 1, logs: ["a"] }, jobId: "j1", onResult: (r) => delivered.push(["n1", r.status]) });
    const r2 = await box.send({ kind: "heartbeat", path: "/r", body: { jobId: "j1", n: 2, logs: [] }, jobId: "j1" });
    const r3 = await box.send({ kind: "heartbeat", path: "/r", body: { jobId: "j1", n: 99, logs: [] }, jobId: "j1" }); // 하트비트는 일감마다 하나만
    const r4 = await box.send({ kind: "report", path: "/r", body: { jobId: "j1", n: 3, logs: ["b"] }, jobId: "j1" });
    const r5 = await box.send({ kind: "screenshot", path: "/r", body: { jobId: "j1", n: 4 }, jobId: "j1", bytes: 10 });
    // 다른 일감의 보고도 쌓인다
    const r6 = await box.send({ kind: "report", path: "/r", body: { jobId: "j2", n: 5 }, jobId: "j2" });
    for (const r of [r1, r2, r3, r4, r5, r6]) assert.equal(r.status, 200, "보냈다고 보고 계속 간다");
    assert.equal(r1.queued, true);
    assert.equal(box.size(), 5, "하트비트 중복 하나는 쌓지 않음");
    assert.equal(hp.state.processed.length, 0, "배포 중에는 아무것도 처리되지 않음");
    // 완료 보고: 홈페이지가 돌아와 받을 때까지 기다리는 호출
    const finalP = box.send({ kind: "final", path: "/r", body: { jobId: "j1", n: 6, status: "done" }, jobId: "j1", wait: true, maxWaitMs: 5000 });
    await sleep(60);
    assert.equal(hp.state.processed.length, 0);
    hp.state.mode = "up"; // 배포 끝
    const fin = await finalP;
    assert.equal(fin.status, 200);
    assert.equal(fin.queued, undefined, "실제 응답을 받음");
    assert.deepEqual(fin.data.finalCheck, { appSlug: "a", group: "g" }, "완료 보고의 응답(finalCheck)도 그대로 받는다");
    await box.idle();
    assert.equal(box.size(), 0);
    // 같은 일감 j1 의 순서가 지켜졌고 하나도 빠지지 않았다
    assert.deepEqual(hp.state.processed.filter((p) => p.jobId === "j1").map((p) => p.n), [1, 2, 3, 4, 6]);
    assert.deepEqual(hp.state.processed.filter((p) => p.jobId === "j2").map((p) => p.n), [5]);
    assert.deepEqual(delivered, [["n1", 200]], "나중에 전달된 결과가 onResult 로 온다");
  } finally {
    await hp.close();
  }
});

test("처리는 됐는데 응답이 사라진 경우: 같은 요청 번호로 다시 보내도 한 번만 처리된다", async () => {
  const hp = await fakeHomepage();
  const box = fastBox(hp.sendOnce);
  try {
    hp.state.mode = "lose"; // 서버가 처리했지만 응답이 끊김(컨테이너 교체 순간)
    const r = await box.send({ kind: "report", path: "/r", body: { jobId: "j1", n: 1 }, jobId: "j1" });
    assert.equal(r.queued, true, "응답을 못 받았으니 대기열에 둠");
    await sleep(80); // 재시도가 몇 번 돌아도 계속 끊김
    hp.state.mode = "up";
    await sleep(120);
    await box.idle();
    assert.equal(box.size(), 0);
    assert.equal(hp.state.processed.filter((p) => p.jobId === "j1").length, 1, "중복 처리 없음");
    assert.ok(hp.state.hits >= 3, "여러 번 다시 보냈지만");
  } finally {
    await hp.close();
  }
});

test("대기 중인 일감이 있으면 새 보고가 앞지르지 않는다(같은 일감), 멀쩡할 때는 바로 간다", async () => {
  const hp = await fakeHomepage();
  const box = fastBox(hp.sendOnce);
  try {
    const ok = await box.send({ kind: "report", path: "/r", body: { jobId: "j1", n: 0 }, jobId: "j1" });
    assert.equal(ok.queued, undefined, "정상일 때는 대기열을 거치지 않음");
    assert.equal(hp.state.processed.length, 1);
    hp.state.mode = "down";
    await box.send({ kind: "report", path: "/r", body: { jobId: "j1", n: 1 }, jobId: "j1" });
    hp.state.mode = "up"; // 돌아온 직후에도 대기열이 안 비었으면 새 보고는 뒤에 선다
    const late = await box.send({ kind: "report", path: "/r", body: { jobId: "j1", n: 2 }, jobId: "j1", wait: true, maxWaitMs: 3000 });
    assert.equal(late.status, 200);
    await box.idle();
    assert.deepEqual(hp.state.processed.map((p) => p.n), [0, 1, 2]);
  } finally {
    await hp.close();
  }
});

test("홈페이지가 답한 거절(400·409)은 다시 보내지 않고 그대로 돌려준다", async () => {
  const calls = [];
  const box = fastBox(async (m, p, b) => (calls.push(b.n), { status: 409, data: { cancelled: true }, text: "" }));
  const r = await box.send({ kind: "report", path: "/r", body: { n: 1 }, jobId: "j1" });
  assert.equal(r.status, 409);
  assert.equal(box.size(), 0);
  assert.deepEqual(calls, [1]);
});

test("대기열 크기 한도를 넘으면 쌓지 않고 실패로 돌려준다(메모리 보호)", async () => {
  const box = createOutbox({ sendOnce: async () => ({ status: 502 }), log: () => {}, retryMs: 1000, maxRetryMs: 1000, maxBytes: 100 });
  const a = await box.send({ kind: "screenshot", path: "/s", body: {}, jobId: "j1", bytes: 80 });
  const b = await box.send({ kind: "screenshot", path: "/s", body: {}, jobId: "j1", bytes: 80 });
  assert.equal(a.queued, true);
  assert.equal(b.status, 0, "가득 참");
  assert.equal(box.size(), 1);
});

test("큰 업로드 추적: 진행 중일 때만 uploadBusy, 끝나면(실패해도) 0", async () => {
  assert.equal(uploadBusy(), 0);
  let release;
  const p = trackUpload("POST /api/x", () => new Promise((r) => (release = r)));
  assert.equal(uploadBusy(), 1);
  assert.deepEqual(uploadLabels(), ["POST /api/x"]);
  release();
  await p;
  assert.equal(uploadBusy(), 0);
  await assert.rejects(trackUpload("fail", async () => { throw new Error("x"); }));
  assert.equal(uploadBusy(), 0, "실패해도 정리됨");
});
