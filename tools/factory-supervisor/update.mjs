// 앱 공장 감독 프로그램 자동 업데이트
// - 10분마다 origin/main 을 확인해서(일감이 돌고 있어도 확인은 한다), 이 폴더(tools/factory-supervisor/) 파일이 바뀌었으면 받는다:
//   git pull --ff-only → node --check → 정상 종료(exit 0). 실행기가 30초 뒤 새 코드로 다시 띄운다.
// - 1-2 D-2: 일감이 끝나길 기다리지 않고 "잠깐 멈췄다가 이어서" 한다(pause.mjs).
//   · 공장이 비어 있으면 새 버전을 바로 받는다. 일감이 돌고 있으면 새 커밋을 최대 bundleMin 분(설정 0~180, 기본 60, 0 = 바로) 모았다가 한 번에 받는다.
//     모으는 동안은 아무것도 막지 않는다. 통제실 [지금 업데이트]는 기다리지 않고 바로 진행한다.
//   · 받기로 하면 updateWaiting() 이 true 가 되어 새 일감은 받지 않고, 합치기·검증처럼 멈출 수 없는 단계가 끝나길 기다린 뒤(지금 업데이트는 기다리지 않고 바로 멈추기 시작)
//     진행 중인 AI 일감·정비 턴을 안전한 지점에서 멈춘다. 모두 멈추면(세션·폴더·단계·남은 시간을 파일에 저장) 받고 다시 시작한다. 새 감독이 저장된 일감을 같은 세션으로 이어 준다.
//   · 받지 못하면(pull·문법 검사 실패, 자동 업데이트를 끔) 멈춘 일감을 이 프로세스에서 그대로 이어 준다.
// - 새 버전은 홈페이지 대기열 확인(/next 200)에 성공해야 확인된다. 그 전에 꺼지면 다음 시작 때, 3분 동안 오류 응답만 받으면 그 자리에서
//   이전 커밋으로 되돌리고 그 커밋은 다시 받지 않는다(건너뛸 목록).
// - 실행기 밖(FACTORY_LAUNCHER=1 이 없음)에서 돌 때는 다시 띄워 줄 장치가 없으므로 업데이트하지 않는다.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleDecision, bundleMinutes } from "./pause.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const expand = (p) => (p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? path.join(os.homedir(), p.slice(1)) : p);
const STATE_PATH = expand(process.env.FACTORY_UPDATE_STATE || "~/dev/factory/supervisor-update.json");
const CHECK_EVERY_MS = Math.max(10, Number(process.env.FACTORY_UPDATE_EVERY_SEC) || 600) * 1000;
const UNDER_LAUNCHER = process.env.FACTORY_LAUNCHER === "1";

const stamp = () => new Date().toLocaleTimeString("ko-KR", { hour12: false });
let lastStatus = ""; // 홈페이지에 알릴 최근 자동 업데이트 소식
const log = (...a) => {
  console.log(`[${stamp()}]`, ...a);
  if (typeof a[0] === "string" && a[0].startsWith("자동 업데이트")) lastStatus = a[0];
};
const short = (h) => (h ? h.slice(0, 7) : "?");

function git(args, timeout = 60_000) {
  return spawnSync("git", args, {
    cwd: HERE,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    // 무인 실행이므로 비밀번호·호스트 키 질문으로 멈추지 않게 한다
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes" },
  });
}
const out = (r) => (r.status === 0 ? r.stdout.trim() : null);
const errText = (r) => (r.error?.message || r.stderr || r.stdout || `코드 ${r.status}`).trim().slice(0, 500);
const head = () => out(git(["rev-parse", "HEAD"]));

// 대기열 확인 때 홈페이지에 함께 알리는 값: 현재 커밋(7자), 그 커밋 메시지 첫 줄, 최근 자동 업데이트 소식
let subjectCache = { head: "", subject: "" }; // 커밋이 바뀔 때만 git log 를 다시 읽는다
export function reportInfo() {
  const h = head();
  if (h && subjectCache.head !== h) subjectCache = { head: h, subject: (out(git(["log", "-1", "--format=%s", h])) ?? "").slice(0, 150) };
  return { commit: h ? h.slice(0, 7) : "", note: lastStatus.slice(0, 150), subject: h ? subjectCache.subject : "" };
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}
function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2) + "\n");
  } catch (e) {
    log(`자동 업데이트 상태 파일을 쓰지 못했어요: ${e.message}`);
  }
}

// 감독 프로그램을 실행 모드로 시작할 때 맨 먼저 부른다. 현재 커밋을 찍고, 방금 업데이트한 버전이면 시험 기간을 잰다.
export function startupGuard() {
  const h = head();
  log(`감독 프로그램 커밋(자동 업데이트 시험 반영): ${short(h)}${UNDER_LAUNCHER ? "" : " (실행기 밖: 자동 업데이트 꺼짐)"}`);
  const st = readState();
  if (!st.trial || !h) return;
  if (st.trial.to !== h) {
    delete st.trial; // 사람이 손으로 바꾼 경우 등: 시험 기록만 지운다
    writeState(st);
    return;
  }
  if (st.trial.starts >= 1) {
    // 지난번 시작이 홈페이지 확인에 성공하기 전에 꺼졌다 → 이전 커밋으로 되돌리고 이 커밋은 건너뛴다
    log(`자동 업데이트 실패: 새 버전(${short(st.trial.to)})이 홈페이지 확인에 성공하기 전에 꺼졌어요. 이전 커밋(${short(st.trial.from)})으로 되돌려요.`);
    const r = git(["reset", "--hard", st.trial.from]);
    if (r.status !== 0) log(`되돌리기 실패(git reset): ${errText(r)}`);
    st.skip = [...new Set([...(st.skip ?? []), st.trial.to])].slice(-20);
    delete st.trial;
    writeState(st);
    process.exit(0); // 실행기가 되돌린 코드로 다시 띄운다
  }
  st.trial.starts = 1;
  writeState(st);
  trialHead = h;
  armHealthTimer();
}

// ───────── 새 버전 건강 확인 ─────────
// 새 버전은 "살아 있음"이 아니라 홈페이지 대기열 확인(/next)이 200 으로 성공해야 확인된다.
// HEALTH_SEC 안에 200 없이 오류 응답만 받았으면 이전 커밋으로 되돌린다. 응답이 아예 없으면(홈페이지·네트워크 문제) 새 코드 탓이 아니니 더 기다린다.
const HEALTH_SEC = Math.max(10, Number(process.env.FACTORY_HEALTH_SEC) || 180);
let trialHead = null;
let sawBadResponse = false;

function armHealthTimer() {
  setTimeout(() => {
    const s = readState();
    if (!trialHead || s.trial?.to !== trialHead) return; // 이미 확인됨
    if (!sawBadResponse) {
      log(`자동 업데이트 확인 대기: 새 버전(${short(trialHead)})이 아직 홈페이지 응답을 못 받았어요(연결 문제일 수 있어 더 기다려요).`);
      return armHealthTimer();
    }
    log(`자동 업데이트 실패: 새 버전(${short(trialHead)})이 ${HEALTH_SEC}초 동안 홈페이지 대기열 확인에 성공하지 못했어요. 이전 커밋(${short(s.trial.from)})으로 되돌려요.`);
    const r = git(["reset", "--hard", s.trial.from]);
    if (r.status !== 0) log(`되돌리기 실패(git reset): ${errText(r)}`);
    s.skip = [...new Set([...(s.skip ?? []), s.trial.to])].slice(-20);
    delete s.trial;
    writeState(s);
    process.exit(0); // 실행기가 되돌린 코드로 다시 띄운다
  }, HEALTH_SEC * 1000).unref();
}

/** 대기열 확인(/next)을 할 때마다 부른다. ok=true(200), false(그 밖의 HTTP 응답), null(응답 없음: 네트워크 오류) */
export function notePoll(ok) {
  if (!trialHead) return;
  if (ok === false) sawBadResponse = true;
  if (ok !== true) return;
  const s = readState();
  const h = trialHead;
  trialHead = null;
  if (s.trial?.to !== h) return;
  delete s.trial;
  writeState(s);
  log(`자동 업데이트 확인: 새 버전(${short(h)})이 홈페이지 대기열 확인에 성공했어요.`);
}

// supervisor.mjs 와 그 파일이 import 하는 이 폴더의 파일들
function filesToCheck(entry = path.join(HERE, "supervisor.mjs"), seen = new Set()) {
  if (seen.has(entry) || !fs.existsSync(entry)) return seen;
  seen.add(entry);
  const src = fs.readFileSync(entry, "utf8");
  for (const m of src.matchAll(/(?:^|\n)\s*import\s+(?:[^"']*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g)) {
    filesToCheck(path.resolve(path.dirname(entry), m[1]), seen);
  }
  return seen;
}

let lastCheck = Date.now(); // 시작 직후에는 확인하지 않는다
let lastNote = "";
let warnedNoLauncher = false;
let waiting = null; // 새 버전을 받으려고 일감을 멈추는 중: { to, manual }. 이 동안 새 일감을 받지 않는다
let pending = null; // 새 버전이 있지만 일감이 돌고 있어 모으는 중(묶기): { to, firstSeenAt }. 이 동안은 아무것도 막지 않는다
const OUTBOX_WAIT_MAX_MS = 5 * 60_000; // 못 보낸 보고가 전달되길 기다리는 최대 시간(받고 다시 켜면 메모리 대기열이 사라진다)
let bundleMin = 60; // 묶는 시간(분). 서버 설정(updateBundleMin)이 오면 바뀐다
export const updateWaiting = () => !!waiting;
export function setUpdateBundle(v) {
  bundleMin = bundleMinutes(v);
}
/** 통제실 표시용: 묶는 중이면 남은 분, 멈추는 중이면 pausing */
export function bundleStatus(now = Date.now()) {
  if (waiting) return { state: "pausing", leftMin: 0 };
  if (!pending) return { state: "none", leftMin: 0 };
  const d = bundleDecision({ firstSeenAt: pending.firstSeenAt, now, bundleMin, idle: false, forced: false });
  return d.action === "wait" ? { state: "bundling", leftMin: d.leftMin } : { state: "none", leftMin: 0 };
}
let forced = false; // 통제실·커넥터의 "지금 업데이트" 요청(/next 의 updateNow). 일감이 끝나는 대로 한 번 확인한다

// /next 응답에 updateNow: true 가 오면 부른다. 다음 루프(15초 안)에서 주기·자동 업데이트 스위치와 상관없이 확인한다.
export function requestUpdateNow() {
  if (!forced) log("자동 업데이트 요청 받음(지금 업데이트): 돌고 있는 일감이 없으면 바로 확인해요.");
  forced = true;
}

// 같은 건너뜀 사유는 바뀔 때만 한 번 남긴다(10분마다 같은 줄이 쌓이지 않게)
function note(m) {
  if (m === lastNote) return;
  lastNote = m;
  log(m);
}

// 테스트용: process.exit 를 바꿀 수 있게 한다(운영은 그대로 process.exit)
let exitFn = (code) => process.exit(code);
export const _setExitForTest = (fn) => { exitFn = fn; };

function cancelWaiting(pauser, why) {
  if (!waiting) return;
  log(`자동 업데이트 대기 취소: ${why}`);
  waiting = null;
  const n = pauser?.resumeAll?.() ?? 0;
  if (n) log(`자동 업데이트: 멈췄던 일감 ${n}개를 이 프로세스에서 그대로 이어 줘요.`);
}

/**
 * 대기열 확인 루프에서 매번 부른다. 새 버전을 받으면 프로세스를 끝낸다(exit 0).
 *  running: 지금 돌고 있는 일감·정비의 수(멈춘 것 포함). pauser: pause.mjs 의 멈춤 조정자(없으면 예전처럼 모두 끝나길 기다린다)
 *  now: 시험에서 시계를 바꿀 수 있다
 */
export function maybeUpdate({ running, autoUpdate, pauser = null, pendingReports = 0, now: now0 = Date.now() }) {
  if (waiting && !waiting.manual && autoUpdate === false) cancelWaiting(pauser, "자동 업데이트가 꺼졌어요. 새 일감을 다시 받아요.");
  if (autoUpdate === false && pending && !pending.manual) pending = null;

  // ───── 받기로 한 뒤: 멈출 수 없는 단계가 끝나길 기다리고 → 일감을 멈추고 → 받는다
  if (waiting) {
    if (forced) { waiting.manual = true; forced = false; log("자동 업데이트 요청 받음(지금 업데이트): 기다리지 않고 바로 멈추기 시작해요."); }
    const paused = pauser?.pausedCount() ?? 0;
    const soft = pauser?.softCount() ?? 0;
    const hard = Math.max(0, running - paused - soft); // 합치기·검증·정비 배포·멈출 수 없는 일감 등
    if (!pauser) {
      if (running > 0) return;
    } else {
      if (hard > 0 && !waiting.manual) {
        // 멈출 수 있는 일감은 계속 일하게 두고, 멈출 수 없는 단계가 끝나길 먼저 기다린다
        if (now0 - (waiting.noteAt ?? 0) > 60_000) {
          waiting.noteAt = now0;
          log(`자동 업데이트 대기: 합치기·검증처럼 멈출 수 없는 단계 ${hard}개가 끝나길 기다려요(AI 일감 ${soft}개는 계속 일해요).`);
        }
        return;
      }
      if (soft > 0 || paused > 0) pauser.requestPause();
      // 안전한 지점에 있던 AI 는 requestPause 에서 바로 프로세스를 끊었다. 명령이 도는 중인 것은 끝나길, 끊은 것은 마지막 정리(로그 보내기 등)를 마치고 멈춤 상태가 되길 기다린다
      const left = Math.max(0, running - pauser.pausedCount());
      if (left > 0) {
        const stillRunning = pauser.softCount();
        const stuck = Math.max(0, left - stillRunning);
        if (now0 - (waiting.noteAt ?? 0) > 60_000) {
          waiting.noteAt = now0;
          if (stillRunning > 0) log(`자동 업데이트: 진행 중인 AI ${stillRunning}개를 안전한 지점(명령이 끝난 직후)에서 멈추는 중이에요.`);
          else if (stuck > 0 && waiting.manual) log(`자동 업데이트 대기: 합치기·검증처럼 멈출 수 없는 단계 ${stuck}개가 끝나길 기다려요(멈출 수 있는 AI 는 멈췄어요).`);
        }
        return;
      }
    }
    // 아직 못 보낸 보고(재전송 대기열은 메모리뿐이라 다시 켜지면 사라진다)가 있으면 잠깐 기다린다. 홈페이지가 오래 안 돌아오면(최대 5분) 그대로 받는다
    if (pendingReports > 0) {
      waiting.outboxSince ??= now0;
      if (now0 - waiting.outboxSince < OUTBOX_WAIT_MAX_MS) {
        if (now0 - (waiting.noteAt ?? 0) > 60_000) {
          waiting.noteAt = now0;
          log(`자동 업데이트 대기: 아직 못 보낸 보고 ${pendingReports}개가 홈페이지에 전달되길 기다려요(최대 5분).`);
        }
        return;
      }
      log(`자동 업데이트: 못 보낸 보고 ${pendingReports}개가 5분 넘게 전달되지 않아 그대로 받아요(대기열은 다시 켜지면 사라져요).`);
    }
    // 모두 멈췄거나 돌던 것이 없다 → 받는다
    return applyUpdate({ pauser, manual: waiting.manual });
  }

  const sinceCheck = now0 - lastCheck;
  const bundleDue = pending && sinceCheck >= 30_000 && bundleDecision({ firstSeenAt: pending.firstSeenAt, now: now0, bundleMin, idle: running === 0, forced: false }).action === "now";
  if (!forced && (autoUpdate === false || (sinceCheck < CHECK_EVERY_MS && !bundleDue))) return;
  const manual = forced;
  forced = false;
  lastCheck = now0;
  // 직접 요청한 확인은 결과를 매번 남긴다(상태 조회에서 보이게). 주기 확인은 같은 사유를 한 번만.
  const say = manual ? (m) => { lastNote = m; log(m); } : note;
  if (!UNDER_LAUNCHER) {
    if (!warnedNoLauncher) log("자동 업데이트 건너뜀: 실행기 밖에서 돌고 있어서 다시 띄워 줄 장치가 없어요.");
    warnedNoLauncher = true;
    return;
  }

  const cur = head();
  if (!cur) return say("자동 업데이트 건너뜀: git 저장소 안에서 실행 중이 아니에요.");
  if (out(git(["rev-parse", "--abbrev-ref", "HEAD"])) !== "main") return say("자동 업데이트 건너뜀: main 브랜치가 아니에요.");
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]);
  if (dirty.status !== 0 || dirty.stdout.trim()) return say("자동 업데이트 건너뜀: 작업 트리에 커밋 안 된 변경이 있어요.");

  const f = git(["fetch", "-q", "origin", "main"], 120_000);
  if (f.status !== 0) return say(`자동 업데이트 확인 실패(git fetch): ${errText(f)}`);
  const remote = out(git(["rev-parse", "origin/main"]));
  if (!remote || remote === cur) {
    pending = null;
    return manual ? say(`자동 업데이트 확인: 이미 최신 버전(${short(cur)})이에요.`) : undefined;
  }
  if (git(["merge-base", "--is-ancestor", cur, remote]).status !== 0) {
    pending = null;
    return say(`자동 업데이트 건너뜀: 이 PC의 main(${short(cur)})이 origin/main(${short(remote)})과 갈라져 있어요.`);
  }
  if ((readState().skip ?? []).includes(remote)) {
    pending = null;
    return say(`자동 업데이트 건너뜀: ${short(remote)} 는 전에 실패한 커밋이에요.`);
  }
  const changed = out(git(["diff", "--name-only", cur, remote, "--", "."]));
  if (!changed) {
    pending = null;
    return say(`자동 업데이트 건너뜀: 새 커밋(${short(remote)})에 감독 프로그램 변경이 없어요.`);
  }

  // 받을 때를 정한다: 공장이 비었거나 지금 업데이트거나 묶기 0분이면 바로, 아니면 처음 본 때부터 bundleMin 분 모은다
  if (!pending) pending = { firstSeenAt: now0 };
  pending.to = remote;
  const d = bundleDecision({ firstSeenAt: pending.firstSeenAt, now: now0, bundleMin, idle: running === 0, forced: manual });
  if (d.action === "wait") {
    say(`자동 업데이트 묶는 중: 새 버전(${short(remote)})이 있어요. 일감이 돌고 있어서 최대 ${bundleMinutes(bundleMin)}분 모았다가 한 번에 받아요(남은 ${d.leftMin}분, 그동안 일감은 막지 않아요).`);
    return;
  }
  pending = null;
  waiting = { to: remote, manual, reason: d.reason, noteAt: 0 };
  say(`자동 업데이트 시작 준비: 새 버전(${short(remote)}) — ${{ idle: "공장이 비어 있어서 바로", "no-bundle": "묶기 0분이라 바로", "bundle-elapsed": "모으는 시간이 끝나서", forced: "지금 업데이트 요청이라 바로" }[d.reason]} 받아요. 진행 중인 AI 는 잠깐 멈췄다가 새 버전에서 이어 줘요(그동안 새 일감은 받지 않아요).`);
  return maybeUpdate({ running, autoUpdate, pauser, now: now0 }); // 바로 다음 단계(멈추기)로
}

// 모두 멈춘(또는 돌던 것이 없는) 상태에서 새 버전을 받는다. 실패하면 멈췄던 일감을 이 프로세스에서 그대로 이어 준다.
function applyUpdate({ pauser, manual }) {
  const cur = head();
  const remote = waiting?.to ?? out(git(["rev-parse", "origin/main"]));
  const fail = (why) => {
    log(why);
    waiting = null;
    const n = pauser?.resumeAll?.() ?? 0;
    if (n) log(`자동 업데이트: 멈췄던 일감 ${n}개를 이 프로세스에서 그대로 이어 줘요.`);
  };
  const changed = out(git(["diff", "--name-only", cur, remote, "--", "."])) ?? "";
  log(`자동 업데이트 시작: ${short(cur)} → ${short(remote)} (${changed.split("\n").join(", ")})`);
  const p = git(["pull", "--ff-only", "-q", "origin", "main"], 120_000);
  if (p.status !== 0) {
    git(["reset", "--hard", cur]);
    return fail(`자동 업데이트 실패(git pull): ${errText(p)}`);
  }
  const now = head();
  for (const file of filesToCheck()) {
    const c = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", windowsHide: true });
    if (c.status !== 0) {
      const r = git(["reset", "--hard", cur]);
      if (r.status !== 0) log(`되돌리기 실패(git reset): ${errText(r)}`);
      const s = readState();
      s.skip = [...new Set([...(s.skip ?? []), now])].slice(-20);
      writeState(s);
      return fail(`자동 업데이트 실패: 문법 검사 통과 못 함(${path.basename(file)}). 이전 커밋(${short(cur)})으로 되돌려요.\n${errText(c)}`);
    }
  }
  // 멈춘 일감을 저장한다(새 감독이 시작할 때 읽어 이어 준다). 저장하지 못하면 받지 않고 이 프로세스에서 이어 준다
  let saved = [];
  try {
    saved = pauser?.persist() ?? [];
  } catch (e) {
    git(["reset", "--hard", cur]);
    return fail(`자동 업데이트 실패: 멈춘 일감의 상태를 저장하지 못했어요(${e.message}). 이전 커밋(${short(cur)})으로 되돌려요.`);
  }
  writeState({ ...readState(), trial: { from: cur, to: now, starts: 0, at: new Date().toISOString() } });
  log(`자동 업데이트 완료: ${short(now)} 를 받았어요.${saved.length ? ` 멈춘 일감 ${saved.length}개는 새 버전이 켜지면 같은 세션으로 이어 줘요.` : ""} 다시 시작합니다(실행기가 30초 뒤 새 코드로 띄움).`);
  exitFn(0);
}
