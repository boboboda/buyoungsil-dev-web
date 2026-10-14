// 감독 프로그램 업데이트 때 "잠깐 멈췄다가 이어서"(1-2 D-2)
// 예전: 새 버전이 있으면 진행 중인 일감이 모두 끝날 때까지 공장 전체가 기다렸다(일감 하나 때문에 1시간 넘게 멈춤).
// 지금: 진행 중인 AI 일감·정비 턴을 "안전한 지점"에서 멈추고(세션 id·작업 폴더·단계·남은 시간 한도를 파일에 저장) → 새 버전으로 재시작 →
//       새 감독이 저장된 일감을 같은 세션으로 이어 준다(Claude 는 --resume, Codex 는 exec resume).
//
// 안전한 지점 = 지금 실행 중인 도구 호출(명령)이 끝난 직후. 남은 명령이 5분을 넘을 것 같으면(또는 멈추라고 한 지 5분이 지나도 안 끝나면)
//   그 명령을 끊고(프로세스를 끈다), 이어 줄 때 "다시 실행하고 이어서 진행해"라고 말한다.
// 이 파일은 순수한 부분(도구 호출 추적·멈출 때 판단·상태 파일·이어서 하기 실패 판정)과 멈춤 조정자(createPauser)만 담는다.
// 일감 흐름(supervisor.mjs, maintenance.mjs)은 단위(unit)를 등록해 두고, AI 를 띄우기 전에 gate() 를 거치며, 프로세스가 멈춤 때문에 끝났는지 unit.paused 로 본다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RESUME_MESSAGE = "공장 업데이트로 잠시 멈췄다. 파일은 그대로다. 멈추기 직전 명령이 끊겼다면 다시 실행하고 이어서 진행해.";
export const LONG_COMMAND_MS = 5 * 60_000; // 남은 명령이 이보다 길면 끊는다 / 멈추라고 한 지 이만큼 지나면 끊는다
export const BASH_DEFAULT_TIMEOUT_MS = 2 * 60_000; // Claude Code Bash 도구의 기본 제한(timeout 을 안 적었을 때)
export const MAX_SAVED_AGE_MS = 30 * 60_000; // 저장한 지 이만큼 지나면 서버가 임대를 거둬 대기열로 되돌렸을 수 있어 이어 주지 않는다
export const RESUME_FAIL_WINDOW_MS = 90_000; // 이어 준 뒤 이 안에 아무 일도 못 하고 끝나면 "이어서 하기 실패"로 본다

const expand = (p) => (p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? path.join(os.homedir(), p.slice(1)) : p);
export const pauseStatePath = () => expand(process.env.FACTORY_PAUSE_STATE || "~/dev/factory/supervisor-paused.json");

// ───────── 도구 호출 추적 ─────────
// AI 가 출력하는 원본 이벤트(디코드 전)를 먹여서 "지금 끝나지 않은 도구 호출"을 센다.
//   Claude: assistant 의 tool_use(id) ↔ user 의 tool_result(tool_use_id). Codex: item.started ↔ item.completed (command_execution·mcp_tool_call·file_change 등)
const CODEX_TOOL_ITEMS = new Set(["command_execution", "mcp_tool_call", "file_change", "web_search", "collab_tool_call"]);
export function createToolTracker(engine = "claude", now = Date.now) {
  const open = new Map(); // id -> { name, input, startedAt }
  let events = 0; // 어시스턴트가 한 일(텍스트·도구) 이벤트 수. 이어서 하기 실패 판정에 쓴다
  const api = {
    feed(ev) {
      if (!ev || typeof ev !== "object") return;
      if (engine === "codex") {
        const item = ev.item;
        if (ev.type === "item.started" && item && CODEX_TOOL_ITEMS.has(item.type)) {
          open.set(String(item.id ?? `i${open.size}`), { name: item.type === "command_execution" ? "Bash" : item.type, input: { command: item.command }, startedAt: now() });
          events++;
        } else if (ev.type === "item.completed" && item) {
          open.delete(String(item.id));
          if (item.type === "agent_message" || CODEX_TOOL_ITEMS.has(item.type)) events++;
        } else if (ev.type === "turn.completed" || ev.type === "turn.failed") open.clear();
        return;
      }
      if (ev.type === "assistant") {
        for (const b of ev.message?.content ?? []) {
          if (b?.type === "tool_use") {
            open.set(String(b.id ?? `t${open.size}`), { name: b.name, input: b.input ?? {}, startedAt: now() });
            events++;
          } else if (b?.type === "text" && String(b.text ?? "").trim()) events++;
        }
      } else if (ev.type === "user") {
        for (const b of Array.isArray(ev.message?.content) ? ev.message.content : []) if (b?.type === "tool_result") open.delete(String(b.tool_use_id));
      } else if (ev.type === "result") open.clear();
    },
    openCount: () => open.size,
    events: () => events,
    /** 지금 도는 호출들의 "남은 시간 추정(ms)". 알 수 없으면 null */
    remaining() {
      const t = now();
      return [...open.values()].map((c) => {
        if (c.name === "Bash") {
          if (c.input?.run_in_background === true) return 0;
          const limit = Number.isFinite(c.input?.timeout) ? Math.min(Number(c.input.timeout), 10 * 60_000) : BASH_DEFAULT_TIMEOUT_MS;
          return Math.max(0, limit - (t - c.startedAt));
        }
        return null; // 하위 에이전트·웹 요청·Codex 명령 등: 얼마나 걸릴지 모른다
      });
    },
    describe: () => [...open.values()].map((c) => `${c.name}${c.input?.command ? `: ${String(c.input.command).replace(/\s+/g, " ").slice(0, 80)}` : ""}`),
  };
  return api;
}

/** 멈추라고 한 뒤(waitedMs 지남) 지금 프로세스를 끊어도 되는지. 호출이 없으면 바로 안전, 남은 명령이 길면 바로 끊고, 모르면 5분까지 기다린 뒤 끊는다 */
export function pauseDecision(tracker, waitedMs) {
  if (tracker.openCount() === 0) return { action: "pause", reason: "safe" };
  const rem = tracker.remaining();
  if (rem.some((r) => r !== null && r > LONG_COMMAND_MS)) return { action: "pause", reason: "long-command", cut: tracker.describe() };
  if (waitedMs >= LONG_COMMAND_MS) return { action: "pause", reason: "waited-too-long", cut: tracker.describe() };
  return { action: "wait" };
}

/** 이어서 하기가 실패했는지(세션을 못 찾음 등): 이어 준 프로세스가 짧게 살다가 아무 일도 못 하고 오류로 끝났을 때 */
export function resumeFailed({ resumed, events = 0, result = null, code = 0, ms = 0, stopped = false }) {
  if (!resumed || stopped) return false;
  if (events > 0) return false;
  if (result && !result.is_error) return false;
  if (code === 0 && !result) return false; // 정상 종료인데 결과가 없는 이상한 경우는 일반 실패 경로로
  return ms <= RESUME_FAIL_WINDOW_MS;
}

// ───────── 상태 파일 ─────────
export function writeSavedState(file, entries, now = Date.now) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, savedAt: new Date(now()).toISOString(), entries }, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** 저장된 멈춤 상태 읽기. { entries, stale[] }: 너무 오래된 것(서버가 이미 되돌렸을 수 있음)은 stale 로 따로 */
export function readSavedState(file, now = Date.now, maxAgeMs = MAX_SAVED_AGE_MS) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { entries: [], stale: [] };
  }
  if (data?.version !== 1 || !Array.isArray(data.entries)) return { entries: [], stale: [] };
  const savedAt = Date.parse(data.savedAt);
  const old = !Number.isFinite(savedAt) || now() - savedAt > maxAgeMs;
  return old ? { entries: [], stale: data.entries } : { entries: data.entries, stale: [] };
}
export function clearSavedState(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* 무시 */
  }
}

// ───────── 업데이트 묶기 ─────────
export const BUNDLE_DEFAULT_MIN = 60;
export const BUNDLE_MAX_MIN = 180;
export const bundleMinutes = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.min(BUNDLE_MAX_MIN, Math.max(0, Math.floor(Number(v)))) : BUNDLE_DEFAULT_MIN);

/**
 * 새 버전을 언제 받을지. 순수 함수.
 *  - idle(돌고 있는 일감·정비 없음)이거나 지금 업데이트(forced)이거나 묶기 0분이면 바로("now").
 *  - 그 밖에는 새 커밋을 처음 본 때(firstSeenAt)부터 bundleMin 분 동안 모았다가 한 번에 받는다("wait", 남은 분 포함).
 */
export function bundleDecision({ firstSeenAt, now, bundleMin, idle, forced }) {
  if (forced) return { action: "now", reason: "forced" };
  if (idle) return { action: "now", reason: "idle" };
  const min = bundleMinutes(bundleMin);
  if (min === 0) return { action: "now", reason: "no-bundle" };
  const due = firstSeenAt + min * 60_000;
  if (now >= due) return { action: "now", reason: "bundle-elapsed" };
  return { action: "wait", leftMin: Math.max(1, Math.ceil((due - now) / 60_000)), dueAt: due };
}

// ───────── 멈춤 조정자 ─────────
// 단위(unit) = 멈출 수 있는 AI 실행 하나(앱 일감, 실험, 정비 턴). 일감 흐름이 만들어 등록한다.
//   unit.attach(child, killFn) : AI 프로세스를 띄운 직후
//   unit.feed(rawEvent)        : 프로세스가 내는 원본 이벤트 한 줄(파싱한 JSON)
//   unit.detach()              : 프로세스가 끝난 뒤
//   await pauser.gate(unit)    : AI 를 (다시) 띄우기 전에. 멈추는 중이면 풀릴 때까지 기다린다
//   unit.paused                : 직전 프로세스가 멈춤 때문에 끝났는지(true 면 일감 흐름은 gate 로 돌아가 이어 줄 준비를 한다)
export function createPauser({ now = Date.now, log = () => {}, stateFile = pauseStatePath() } = {}) {
  const units = new Map(); // key -> unit
  let mode = "running"; // running | pausing
  let requestedAt = 0;
  let timer = null;
  const lastCut = [];

  const softCount = () => [...units.values()].filter((u) => u.state === "running" && u.child && !u.hold?.()).length; // 지금 안전한 지점에서 멈출 수 있는 AI 실행
  const pausedCount = () => [...units.values()].filter((u) => u.state === "paused" || u.state === "parked").length;

  function pauseUnit(u, decision) {
    u.paused = true;
    u.state = "paused";
    u.pausedAt = now();
    if (decision.cut?.length) {
      const msg = `${u.label}: 끝나지 않은 명령을 끊고 멈췄어요(${decision.reason === "long-command" ? "남은 시간이 5분을 넘을 것 같음" : "5분 안에 끝나지 않음"}): ${decision.cut.join(" | ")}`;
      lastCut.push(msg);
      log(msg);
      u.onCut?.(decision.cut);
    }
    u.onPause?.();
    try {
      u.kill?.();
    } catch {
      /* 이미 끝남 */
    }
  }

  function tick() {
    if (mode !== "pausing") return;
    for (const u of units.values()) {
      if (u.state !== "running" || !u.child) continue; // 프로세스가 없으면(검증·합치기 같은 AI 아닌 단계) 멈출 것이 없다. 끝나고 gate 에서 멈춘다
      if (u.hold?.()) continue; // 합치기 잠금 중 등: 풀린 뒤에 멈춘다
      const d = pauseDecision(u.tracker, now() - requestedAt);
      if (d.action === "pause") pauseUnit(u, d);
    }
  }

  const pauser = {
    mode: () => mode,
    tick, // 시험용: 안전한 지점을 지금 한 번 확인
    units: () => [...units.values()],
    pausedCount,
    softCount,
    lastCut: () => [...lastCut],
    createUnit(opts) {
      const u = {
        key: opts.key,
        kind: opts.kind, // app | lab | maint
        engine: opts.engine || "claude",
        label: opts.label || opts.key,
        state: "running", // running | paused(프로세스를 끊고 기다림) | parked(AI 를 띄우기 전에 기다림)
        paused: false,
        child: null,
        kill: null,
        tracker: createToolTracker(opts.engine || "claude", now),
        hold: opts.hold || null, // () => true 면 지금은 멈추지 않는다(합치기 잠금 중)
        snapshot: opts.snapshot || (() => ({})),
        onPause: opts.onPause || null,
        onCut: opts.onCut || null,
        waiter: null,
        attach(child, kill) {
          u.child = child;
          u.kill = kill;
          u.paused = false;
          u.tracker = createToolTracker(u.engine, now);
        },
        feed: (ev) => u.tracker.feed(ev),
        detach() {
          u.child = null;
          u.kill = null;
        },
        /** 멈추라고 했지만 그 순간 이미 끝난 턴이었다: 멈춘 것이 아니니 상태를 되돌린다(일감은 계속 돌며, 끝날 때까지 업데이트는 기다린다) */
        resetPaused() {
          u.paused = false;
          u.state = "running";
        },
        /** 멈춤에서 풀려 AI 를 다시 띄울 때(gate 가 풀릴 때) 부른다 */
        cancel() {
          const w = u.waiter;
          u.waiter = null;
          u.state = "running";
          w?.();
        },
      };
      units.set(u.key, u);
      return u;
    },
    remove(key) {
      units.delete(key);
    },
    /** 멈추기 시작. 이미 멈추는 중이면 아무것도 안 한다 */
    requestPause() {
      if (mode === "pausing") return;
      mode = "pausing";
      requestedAt = now();
      lastCut.length = 0;
      tick();
      timer = setInterval(tick, 1000);
      timer.unref?.();
    },
    /** 멈추는 중에 AI 를 (다시) 띄우려는 단위는 여기서 기다린다. 멈춤이 아니면 바로 지나간다 */
    async gate(u) {
      if (mode !== "pausing") {
        u.state = "running";
        return;
      }
      u.state = "parked";
      u.paused = false;
      await new Promise((resolve) => {
        u.waiter = resolve;
      });
    },
    /** 멈춘 단위들의 저장용 기록 */
    snapshot() {
      return [...units.values()].filter((u) => u.state === "paused" || u.state === "parked").map((u) => ({ key: u.key, kind: u.kind, engine: u.engine, ...u.snapshot() }));
    },
    persist() {
      const entries = pauser.snapshot();
      writeSavedState(stateFile, entries, now);
      return entries;
    },
    /** 업데이트를 못 했거나 취소됐을 때: 이 프로세스 안에서 그대로 이어 준다 */
    resumeAll() {
      if (mode !== "pausing") return 0;
      mode = "running";
      if (timer) clearInterval(timer);
      timer = null;
      let n = 0;
      for (const u of units.values()) {
        if (u.state === "paused" || u.state === "parked") {
          n++;
          u.cancel();
        }
      }
      clearSavedState(stateFile);
      return n;
    },
    stateFile: () => stateFile,
  };
  return pauser;
}
