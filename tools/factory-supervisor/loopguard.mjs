// 일감 시간 낭비 막기(1-3): 같은 시험·빌드 명령 반복 감지, 스크린샷 단계 시간 상한
// 10-14 소원 돌탑 수정 일감은 같은 e2e(스크린샷 30장)를 4번 반복해서 1시간 넘게 걸렸다. 감독 프로그램이 일감의 명령 로그를 보고
//   같은 시험·빌드 명령이 정해진 횟수(기본 3회)를 넘게 반복되는데 그 사이에 바뀐 파일이 적거나 결과가 같으면
//   ① 처음엔 AI 에게 "같은 시험을 반복 중이다. 지금 상태로 정리하고 막힌 점을 보고하라"를 한 번 보내고(warn),
//   ② 그래도 같은 시험을 또 돌리면 일감을 '막힘'으로 끝낸다(block).
// 이 파일은 순수한 부분(명령 분류·반복 판정·설정 정리)만 담는다. 일감 흐름(supervisor.mjs)이 AI 원본 이벤트를 먹이고 판정을 받아 처리한다.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const WARN_MESSAGE = "같은 시험을 반복 중이다. 지금 상태로 정리하고 막힌 점을 보고하라.";
export const STUCK_PREFIX = "막힘: ";

export const LOOP_JUDGES = ["any", "result", "count"];
export const LOOPGUARD_DEFAULTS = Object.freeze({
  enabled: true,
  repeatMax: 3, // 같은 명령이 이 횟수를 넘게(기본 4번째부터) 돌면 살핀다
  judge: "any", // any = 바뀐 파일이 적거나 결과가 같으면 / result = 결과가 같을 때만 / count = 횟수만 보고(바뀐 것·결과 무시)
  minChangedFiles: 2, // 직전 같은 명령 이후 바뀐 파일이 이 개수 이하면 "적다"
  screenshotMaxMin: 15, // 스크린샷 단계(phase=screenshots) 시간 상한(분). 넘으면 찍힌 것까지만 올리고 넘어간다
});
const LIMITS = { repeatMax: [2, 20], minChangedFiles: [0, 50], screenshotMaxMin: [1, 120] };

/** 설정 정리: 이상한 값은 기본값으로, 숫자는 범위 안으로. 들어온 값에 없는 항목은 기본값 */
export function cleanLoopGuard(v) {
  const o = v && typeof v === "object" ? v : {};
  const out = { ...LOOPGUARD_DEFAULTS };
  if (typeof o.enabled === "boolean") out.enabled = o.enabled;
  if (LOOP_JUDGES.includes(o.judge)) out.judge = o.judge;
  for (const k of Object.keys(LIMITS)) {
    const n = Number(o[k]);
    if (o[k] !== null && o[k] !== "" && o[k] !== undefined && Number.isFinite(n)) out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], Math.round(n)));
  }
  return out;
}

// ───────── 명령 분류 ─────────
// heavy = 오래 걸리고 되풀이할 값어치가 낮은 것(e2e·스크린샷·측정). light = 빌드·린트·단위 시험(고치면서 반복하는 게 정상이라 더 느슨하게 본다)
const HEAVY = [
  ["e2e", /\b(playwright|cypress|detox|maestro|e2e|integration_test)\b|test:e2e/i],
  ["screenshot", /screenshots?\b|snapshots?\b|\bgolden/i],
  ["measure", /\b(measure|simulat\w*|bench(?:mark)?|sweep|monte-?carlo|stress)\b|측정|시뮬/i],
];
const LIGHT = [
  ["build", /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|lint|test|typecheck)\b|\bnpx\s+(?:tsc|jest|vitest|eslint|next\s+build)\b|\bflutter\s+(?:build|test|analyze)\b|\bgradlew?(?:\.bat)?\s+\S*(?:assemble|test|build|lint)|\bcargo\s+(?:build|test)\b|\bdotnet\s+(?:build|test)\b|\bpytest\b|\bgo\s+(?:build|test)\b/i],
];

/** 한 줄 명령에서 "알맹이"만 뽑는다: cd·환경변수 앞부분, 파이프 뒤(tail·grep 등), 리다이렉션을 뺀다. 공백은 하나로 */
export function normalizeCommand(cmd) {
  let s = String(cmd ?? "").replace(/\s+/g, " ").trim();
  s = s.replace(/\s*2?>&1/g, "").replace(/\s+[12]?>\s*\S+/g, "");
  const segs = s.split(/\s*(?:&&|;|\|\||\|)\s*/).filter(Boolean);
  const keep = segs.filter((p) => !/^(cd|export|set|echo|mkdir|rm|ls|cat|head|tail|grep|sleep|timeout\s+\d+\s*$)\b/.test(p) && !/^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(p));
  return (keep.length ? keep[0] : segs[0] ?? "").replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, "").slice(0, 300);
}

/** 감시할 명령인지: { kind, heavy, key } 또는 null. 같은 key 면 "같은 명령" */
export function classifyCommand(cmd) {
  const text = String(cmd ?? "");
  // 한 줄에 여러 명령이 이어져 있으면 알맹이(분류 대상)만 따로 본다
  const segs = text.replace(/\s+/g, " ").split(/\s*(?:&&|;|\|\|)\s*/).filter(Boolean);
  for (const seg of segs.length ? segs : [text]) {
    const core = normalizeCommand(seg);
    if (!core) continue;
    for (const [kind, re] of HEAVY) if (re.test(core)) return { kind, heavy: true, key: core };
  }
  for (const seg of segs.length ? segs : [text]) {
    const core = normalizeCommand(seg);
    if (!core) continue;
    for (const [kind, re] of LIGHT) if (re.test(core)) return { kind, heavy: false, key: core };
  }
  return null;
}

const hash = (s) => createHash("sha1").update(String(s ?? "")).digest("hex");
/** 결과 글에서 시간·진행 숫자처럼 매번 달라지는 부분을 지워 "같은 결과"를 판단한다 */
export function resultSignature(text) {
  const t = String(text ?? "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|sec|seconds|초|분|m)\b/gi, "#")
    .replace(/\d{1,4}[-/:T]\d{1,2}[-/:T]\d{1,2}[\sT:\d.Z+-]*/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-4000);
  return hash(t);
}

/** 두 스냅샷(경로 → 서명) 사이에 바뀐 파일 수 */
export function changedCount(prev, next) {
  if (!prev || !next) return Infinity; // 비교할 수 없으면 "많이 바뀜"으로 본다(경고를 내지 않는 쪽)
  let n = 0;
  for (const [p, sig] of next) if (prev.get(p) !== sig) n++;
  for (const p of prev.keys()) if (!next.has(p)) n++;
  return n;
}

/**
 * 반복 감지기. 일감 하나에 하나씩 만든다.
 *  start(id, command, getSnapshot) — 명령이 시작될 때. 감시 대상일 때만 getSnapshot()(작업 폴더의 변경 스냅샷 Map 또는 null)을 부른다. 판정을 돌려준다.
 *  end(id, outputText)          — 그 명령 결과를 알게 됐을 때(결과가 같은지 보려고 서명을 저장)
 * 판정: { action: "ok" } | { action: "warn", why } | { action: "block", why }
 */
export function createLoopGuard(settings) {
  const cfg = cleanLoopGuard(settings);
  const keys = new Map(); // key -> { runs, snap, results: [서명...], warned }
  const open = new Map(); // id -> key
  let warned = false;
  const api = {
    cfg,
    warned: () => warned,
    start(id, command, getSnapshot = null) {
      if (!cfg.enabled) return { action: "ok" };
      const c = classifyCommand(command);
      if (!c) return { action: "ok" };
      let k = keys.get(c.key);
      if (!k) keys.set(c.key, (k = { runs: 0, snap: null, results: [], kind: c.kind, heavy: c.heavy }));
      let snapshot = null;
      try {
        snapshot = getSnapshot ? getSnapshot() : null;
      } catch {
        /* 못 구하면 비교하지 않는다 */
      }
      const prevSnap = k.snap;
      k.runs++;
      k.snap = snapshot;
      if (id !== undefined && id !== null) open.set(String(id), c.key);
      // 가벼운 명령(빌드·린트·단위 시험)은 고치면서 돌리는 게 정상이라 횟수 기준을 두 배로, 그리고 "결과가 같을 때"만 본다
      const limit = c.heavy ? cfg.repeatMax : cfg.repeatMax * 2;
      if (k.runs <= limit) return { action: "ok" };
      const sameResult = k.results.length >= 2 && k.results[k.results.length - 1] === k.results[k.results.length - 2];
      const changed = changedCount(prevSnap, snapshot);
      const fewChanged = changed <= cfg.minChangedFiles;
      let stagnant;
      if (cfg.judge === "count") stagnant = true;
      else if (cfg.judge === "result" || !c.heavy) stagnant = sameResult;
      else stagnant = sameResult || fewChanged;
      if (!stagnant) return { action: "ok" };
      const detail = `${KIND_LABEL[c.kind]} 명령이 ${k.runs}번째로 돌아요(기준 ${limit}회). ${sameResult ? "직전 결과가 같아요" : `그 사이 바뀐 파일 ${changed === Infinity ? "?" : changed}개`}: ${c.key.slice(0, 120)}`;
      if (!warned) {
        warned = true;
        return { action: "warn", why: detail };
      }
      return { action: "block", why: detail };
    },
    end(id, output) {
      const key = open.get(String(id));
      if (key === undefined) return;
      open.delete(String(id));
      const k = keys.get(key);
      if (k) {
        k.results.push(resultSignature(output));
        if (k.results.length > 4) k.results.shift();
      }
    },
  };
  return api;
}
const KIND_LABEL = { e2e: "e2e 시험", screenshot: "스크린샷", measure: "측정·시뮬레이션", build: "빌드·시험" };

// ───────── 원본 이벤트에서 명령 시작·끝 뽑기 ─────────
/** AI 가 출력한 원본 이벤트(디코드 전) 한 줄 → [{ type: "start", id, command } | { type: "end", id, output }] */
export function commandEvents(engine, ev) {
  const out = [];
  if (!ev || typeof ev !== "object") return out;
  if (engine === "codex") {
    const item = ev.item;
    if (item?.type === "command_execution") {
      if (ev.type === "item.started") out.push({ type: "start", id: String(item.id), command: String(item.command ?? "") });
      else if (ev.type === "item.completed") out.push({ type: "end", id: String(item.id), output: String(item.aggregated_output ?? item.output ?? "") });
    }
    return out;
  }
  if (ev.type === "assistant") {
    for (const b of ev.message?.content ?? []) if (b?.type === "tool_use" && b.name === "Bash") out.push({ type: "start", id: String(b.id), command: String(b.input?.command ?? "") });
  } else if (ev.type === "user") {
    for (const b of Array.isArray(ev.message?.content) ? ev.message.content : []) {
      if (b?.type !== "tool_result") continue;
      const c = b.content;
      out.push({ type: "end", id: String(b.tool_use_id), output: typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => x?.text ?? "").join("\n") : "" });
    }
  }
  return out;
}

// ───────── 스크린샷 단계 시간 상한 ─────────
/**
 * 스크린샷 단계(phase=screenshots)에 들어간 때부터 재서 상한을 넘었는지. 순수 함수.
 * 단계에 들어가기 전이면 enteredAt 은 null. 이미 한 번 넘겼으면(done) 다시 알리지 않는다.
 */
export function screenshotBudget({ phase, enteredAt, now, maxMin, done }) {
  if (done) return { state: "done" };
  if (phase !== "screenshots" || enteredAt == null) return { state: "idle" };
  const left = enteredAt + maxMin * 60_000 - now;
  return left <= 0 ? { state: "over" } : { state: "within", leftMs: left };
}

export const SCREENSHOT_CUT_MESSAGE = (maxMin) =>
  `스크린샷 단계가 ${maxMin}분을 넘어서 지금 찍힌 것까지만 올리고 넘어간다. 스크린샷을 더 만들지 말고(떠 있는 서버·프로세스는 끄고) 남은 마무리와 결과 요약만 하라. .factory/phase.txt 는 done 으로 써라.`;

/** 작업 폴더의 바뀐 파일 스냅샷(경로 → 크기:수정시각). git 이 아니거나 실패하면 null. .factory/ 와 .git 은 뺀다 */
export function snapshotWorkdir(dir, maxFiles = 3000) {
  let raw;
  try {
    raw = execFileSync("git", ["status", "--porcelain", "-z", "-uall"], { cwd: dir, encoding: "utf8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  } catch {
    return null;
  }
  const snap = new Map();
  const parts = raw.split(" ");
  for (let i = 0; i < parts.length && snap.size < maxFiles; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const file = e.slice(3);
    if (e[0] === "R" || e[0] === "C") i++; // 이름 바꾸기는 원래 이름이 다음 칸에 한 번 더 나온다
    if (file.startsWith(".factory/") || file.startsWith(".git/")) continue;
    try {
      const st = fs.statSync(path.join(dir, file));
      snap.set(file, `${st.size}:${Math.round(st.mtimeMs)}`);
    } catch {
      snap.set(file, "deleted");
    }
  }
  return snap;
}
