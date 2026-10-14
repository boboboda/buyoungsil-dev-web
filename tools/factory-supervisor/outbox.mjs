// 앱 공장 감독 프로그램: 재전송 대기열(outbox)과 큰 업로드 추적
// - 서버 배포 중에는 홈페이지가 3~5분 응답하지 않는다. 그동안의 보고·로그·하트비트·완료 보고·스크린샷 등록을 잃지 않게
//   홈페이지가 응답하지 않을 때(연결 실패·시간 초과·502/503/504 …) 대기열에 쌓았다가 순서대로 다시 보낸다.
//   (6e620c1 이 배포 결과 보고에 했던 "받아들여질 때까지 다시 보내기"를 보고 전반으로 넓힌 것)
// - 순서: 한 일감(lane)의 보고는 보낸 순서대로 간다. 같은 일감에 대기 중인 게 있으면 새 보고도 그 뒤에 선다(앞질러 가지 않는다).
//   홈페이지가 아직 안 돌아왔으면 그 라운드는 멈추고 잠시 뒤 처음부터 다시 한다.
// - 중복 방지: 보고마다 요청 번호(X-Request-Id)를 만들고, 다시 보낼 때도 같은 번호를 쓴다. 홈페이지는 같은 번호를 두 번 처리하지 않는다.
//   하트비트(내용 없는 보고)는 일감마다 대기열에 하나만 둔다.
// - 큰 파일 업로드(영상·스크린샷 묶음·실험 결과)가 진행 중인지 세어 둔다. 서버 배포는 그동안만 최대 10분 기다린다(maintenance.mjs).
import crypto from "node:crypto";

export const MAX_QUEUE_BYTES = 100 * 1024 * 1024; // 대기열에 쌓아 둘 수 있는 크기(스크린샷 등). 넘으면 쌓지 않고 실패로 돌려준다
export const BIG_UPLOAD_BYTES = 256 * 1024; // 이보다 크면 "큰 업로드"로 센다
export const RETRY_MS = 5_000;
export const MAX_RETRY_MS = 30_000;

// 홈페이지가 응답하지 않는 경우(배포 중 컨테이너 교체 포함). 400·409 같은 건 홈페이지가 답한 것이라 여기에 넣지 않는다
export const isTransient = (r) => !r || r.status === 0 || r.status === 408 || r.status === 502 || r.status === 503 || r.status === 504 || (r.status >= 520 && r.status <= 524);

const sleepMs = (ms) => new Promise((res) => setTimeout(res, ms).unref?.());

/**
 * sendOnce(method, path, body, { requestId, timeoutMs }) → { status, data, text } (네트워크 오류는 throw)
 * send({ kind, method?, path, body, jobId?, bytes?, wait?, maxWaitMs?, onResult?, timeoutMs? }) → { status, data, text, queued? }
 *   kind: report | heartbeat | final | screenshot | art | maintenance …  (heartbeat 만 일감마다 하나로 합친다)
 *   - 홈페이지가 답하면 그 응답을 그대로 돌려준다.
 *   - 답이 없으면 대기열에 넣고 { status: 200, queued: true } 를 돌려준다(보냈다고 보고 계속 간다). wait 이면 전달될 때까지(maxWaitMs) 기다렸다가 실제 응답을 돌려준다.
 *   - 나중에 전달되면 onResult(응답)를 부른다(409 로 일감이 끝났음을 알게 되는 경우 등).
 */
export function createOutbox({ sendOnce, log = () => {}, sleep = sleepMs, retryMs = RETRY_MS, maxRetryMs = MAX_RETRY_MS, maxBytes = MAX_QUEUE_BYTES }) {
  const queue = []; // 보낼 순서대로. 항목: { id, kind, method, path, body, lane, bytes, timeoutMs, onResult, waiters[] }
  let draining = null;
  let bytesQueued = 0;
  const lanesBusy = new Map(); // lane → 대기 중인 개수

  const laneOf = (e) => e.lane ?? "_";
  const queuedResult = { status: 200, data: { ok: true, queued: true }, text: "", queued: true };

  async function attempt(e) {
    try {
      return await sendOnce(e.method, e.path, e.body, { requestId: e.id, ...(e.timeoutMs ? { timeoutMs: e.timeoutMs } : {}) });
    } catch (err) {
      return { status: 0, data: null, text: String(err?.message ?? err).slice(0, 300) };
    }
  }

  function remove(e) {
    const i = queue.indexOf(e);

    if (i >= 0) queue.splice(i, 1);
    bytesQueued -= e.bytes;
    const n = (lanesBusy.get(laneOf(e)) ?? 1) - 1;

    if (n > 0) lanesBusy.set(laneOf(e), n);
    else lanesBusy.delete(laneOf(e));
  }

  function settle(e, res) {
    for (const w of e.waiters) w(res);
    e.waiters = [];
    try {
      e.onResult?.(res);
    } catch (err) {
      log(`[재전송] 결과 처리 오류: ${err.message}`);
    }
  }

  function drain() {
    if (draining) return draining;
    draining = (async () => {
      let delay = retryMs;

      while (queue.length) {
        let progressed = false;
        let down = false;

        for (const e of [...queue]) {
          const res = await attempt(e);

          if (isTransient(res)) {
            down = true; // 홈페이지가 아직 안 돌아왔다. 순서를 지키려고 이 라운드를 멈춘다
            break;
          }
          remove(e);
          progressed = true;
          settle(e, res);
        }
        if (!queue.length) break;
        if (progressed) delay = retryMs;
        if (down) {
          await sleep(delay);
          delay = Math.min(maxRetryMs, delay * 2);
        }
      }
    })().finally(() => {
      draining = null;
    });

    return draining;
  }

  function enqueue(e) {
    queue.push(e);
    bytesQueued += e.bytes;
    lanesBusy.set(laneOf(e), (lanesBusy.get(laneOf(e)) ?? 0) + 1);
    void drain();
  }

  async function send({ kind = "report", method = "POST", path, body, jobId = null, bytes = 0, wait = false, maxWaitMs = 12 * 60_000, onResult = null, timeoutMs = 0 }) {
    const e = { id: crypto.randomUUID(), kind, method, path, body, lane: jobId, bytes: Math.max(0, bytes), timeoutMs, onResult, waiters: [] };
    const laneBusy = (lanesBusy.get(laneOf(e)) ?? 0) > 0;

    // 같은 일감에 앞서 대기 중인 게 있으면 앞지르지 않는다. 하트비트는 이미 하나 있으면 또 쌓지 않는다
    if (laneBusy) {
      if (kind === "heartbeat" && queue.some((q) => q.kind === "heartbeat" && laneOf(q) === laneOf(e))) return queuedResult;
    } else {
      const res = await attempt(e);

      if (!isTransient(res)) return res;
      if (kind === "heartbeat") {
        // 하트비트는 쌓을 가치가 적다: 다른 보고가 대기 중이 아니면 하나만 두고, 홈페이지가 돌아오면 임대를 이어 준다
        log(`[재전송] 홈페이지가 응답하지 않아요(${res.status || res.text}). 하트비트를 대기열에 둬요.`);
      } else {
        log(`[재전송] 홈페이지가 응답하지 않아요(${res.status || res.text}). ${kind} 보고를 대기열에 쌓아요(돌아오면 순서대로 다시 보내요).`);
      }
    }
    if (bytesQueued + e.bytes > maxBytes) {
      log(`[재전송] 대기열이 가득 찼어요(${Math.round(bytesQueued / 1024 / 1024)}MB). ${kind} 보고는 쌓지 않아요.`);

      return { status: 0, data: null, text: "재전송 대기열이 가득 참" };
    }
    const done = wait ? new Promise((res) => e.waiters.push(res)) : null;

    enqueue(e);
    if (!wait) return queuedResult;
    const timer = new Promise((res) => {
      const t = setTimeout(() => res(queuedResult), maxWaitMs);

      t.unref?.();
    });

    return Promise.race([done, timer]);
  }

  return {
    send,
    /** 대기열에 남은 개수(통제실 표시용) */
    size: () => queue.length,
    bytes: () => bytesQueued,
    /** 모두 비워질 때까지(시험·종료용) */
    idle: async () => {
      while (draining) await draining;
    },
  };
}

// ───────────── 큰 업로드 추적 ─────────────
const active = new Map(); // id → { label, since }
let seq = 0;

/** 큰 업로드 하나를 추적한다. fn 이 끝날 때까지 uploadBusy() 가 참이다. */
export async function trackUpload(label, fn) {
  const id = ++seq;

  active.set(id, { label, since: Date.now() });
  try {
    return await fn();
  } finally {
    active.delete(id);
  }
}

export const uploadBusy = () => active.size;
export const uploadSince = () => (active.size ? Math.min(...[...active.values()].map((a) => a.since)) : 0);
export const uploadLabels = () => [...active.values()].map((a) => a.label);
