// 앱 공장 감독 프로그램: 일감·정비가 성공으로 끝난 뒤 같은 Claude 세션에 /compact 를 걸어 맥락을 요약해 둔다.
// - Claude 세션만(Codex 는 건드리지 않음), 다시 이어 쓸 세션만(정비 대화, 이전 세션을 이어받은 일감).
// - 실패·시간 초과여도 일감 결과는 그대로다. 기록은 한 줄만 남기고, 세션 내용은 로그에 쓰지 않는다.
// - 끄기: 통제실 설정 '작업 후 컨텍스트 정리'(FactorySetting compactAfterJob) 또는 PC 환경변수 FACTORY_COMPACT_AFTER_JOB=0
import readline from "node:readline";
import { startAi, stopAi } from "./ai-runner.mjs";

export const COMPACT_TIMEOUT_MS = 2 * 60_000;
const SESSION_RE = /^[0-9a-f-]{8,64}$/i;

/** PC 환경변수. 값이 없으면 켜짐, 0·false·off·no 면 꺼짐 */
export function compactEnvEnabled(env = process.env) {
  const v = String(env.FACTORY_COMPACT_AFTER_JOB ?? "").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(v);
}

/** 컨텍스트 정리를 할지. 하지 않으면 사유를 준다. */
export function compactDecision({ engine, sessionId, reusable, enabled = true, env = process.env }) {
  if (engine !== "claude") return { run: false, reason: "Codex 세션은 정리하지 않아요" };
  if (!enabled) return { run: false, reason: "통제실 설정에서 꺼져 있어요" };
  if (!compactEnvEnabled(env)) return { run: false, reason: "PC 설정(FACTORY_COMPACT_AFTER_JOB)으로 꺼져 있어요" };
  if (!reusable) return { run: false, reason: "새 세션으로 한 번 쓰고 끝나는 일감이에요" };
  if (!sessionId || !SESSION_RE.test(sessionId)) return { run: false, reason: "세션 ID 가 없어요" };
  return { run: true };
}

/** 세션에 /compact 를 실행한다. 던지지 않는다. { status: done|skipped|failed|timeout, line } */
export async function compactSession({ engine, sessionId, reusable, enabled = true, env = process.env, cwd, cfg = {}, settings, childEnv, timeoutMs = COMPACT_TIMEOUT_MS, start = startAi, stop = stopAi }) {
  const d = compactDecision({ engine, sessionId, reusable, enabled, env });
  if (!d.run) return { status: "skipped", line: `컨텍스트 정리 건너뜀: ${d.reason}` };
  let child;
  try {
    child = start("claude", cfg, { cwd, sessionId, settings, env: childEnv || env });
  } catch (e) {
    return { status: "failed", line: `컨텍스트 정리 건너뜀: 실행 실패(${String(e.message).slice(0, 200)})` };
  }
  return new Promise((resolve) => {
    let compacted = false;
    let compactFailed = false;
    let result = null;
    let timedOut = false;
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { timedOut = true; stop(child); done({ status: "timeout", line: `컨텍스트 정리 건너뜀: 시간 초과(${Math.round(timeoutMs / 1000)}초)` }); }, timeoutMs);
    child.stdin?.on("error", () => {});
    child.stdin?.end("/compact");
    child.stderr?.on("data", () => {}); // 내용은 기록하지 않는다
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev?.type === "system" && ev.subtype === "compact_boundary") compacted = true;
      if (ev?.type === "system" && ev.subtype === "status" && typeof ev.compact_result === "string") {
        if (ev.compact_result === "success") compacted = true;
        else compactFailed = true;
      }
      if (ev?.type === "result") result = ev;
    });
    child.on("error", () => done({ status: "failed", line: "컨텍스트 정리 건너뜀: 실행 오류" }));
    child.on("close", (code) => {
      if (timedOut) return;
      if (compacted && !compactFailed && code === 0 && result && !result.is_error) return done({ status: "done", line: "컨텍스트 정리(/compact) 완료" });
      done({ status: "failed", line: `컨텍스트 정리 건너뜀: 실패(${result?.is_error ? "Claude 오류" : compacted ? `종료 코드 ${code}` : "정리 결과 없음"})` });
    });
  });
}
