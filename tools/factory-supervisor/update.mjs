// 앱 공장 감독 프로그램 자동 업데이트
// - 10분마다 origin/main 을 확인해서(일감이 돌고 있어도 확인은 한다), 이 폴더(tools/factory-supervisor/) 파일이 바뀌었으면
//   일감·정비가 하나도 돌지 않을 때 git pull --ff-only → node --check → 정상 종료(exit 0)한다.
//   일감이 돌고 있으면 "업데이트 대기"(드레인)가 된다: updateWaiting() 이 true 인 동안 감독 프로그램은 새 일감을 받지 않고,
//   진행 중인 것이 모두 끝나면 받는다(돌던 일감을 끊지 않는다). 실행기(~/dev/factory/run-supervisor.sh)가 30초 뒤 새 코드로 다시 띄운다.
// - 새 버전은 홈페이지 대기열 확인(/next 200)에 성공해야 확인된다. 그 전에 꺼지면 다음 시작 때, 3분 동안 오류 응답만 받으면 그 자리에서
//   이전 커밋으로 되돌리고 그 커밋은 다시 받지 않는다(건너뛸 목록).
// - 실행기 밖(FACTORY_LAUNCHER=1 이 없음)에서 돌 때는 다시 띄워 줄 장치가 없으므로 업데이트하지 않는다.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
let waiting = null; // 새 버전이 있어서 진행 중 일감이 끝나길 기다리는 중: { to, manual }. 이 동안 새 일감을 받지 않는다(드레인)
export const updateWaiting = () => !!waiting;
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

// 대기열 확인 루프에서 매번 부른다. 업데이트를 받으면 프로세스를 끝낸다(exit 0).
export function maybeUpdate({ running, autoUpdate }) {
  if (waiting && !waiting.manual && autoUpdate === false) {
    log("자동 업데이트 대기 취소: 자동 업데이트가 꺼졌어요. 새 일감을 다시 받아요.");
    waiting = null;
  }
  if (running > 0 && waiting) return; // 드레인 중: 진행 중인 것이 끝나길 기다린다
  const now0 = Date.now();
  if (!forced && !waiting && (autoUpdate === false || now0 - lastCheck < CHECK_EVERY_MS)) return;
  const manual = forced || !!waiting?.manual;
  forced = false;
  waiting = null; // 아래에서 다시 확인해 필요하면 다시 건다(그 사이 origin/main 이 또 바뀌었을 수 있다)
  lastCheck = now0;
  // 직접 요청한 확인은 결과를 매번 남긴다(상태 조회에서 보이게). 주기 확인은 같은 사유를 한 번만.
  const say = manual ? (m) => { lastNote = m; log(m); } : note;
  if (!UNDER_LAUNCHER) {
    if (!warnedNoLauncher) log("자동 업데이트 건너뜀: 실행기(run-supervisor.sh) 밖에서 돌고 있어서 다시 띄워 줄 장치가 없어요.");
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
  if (!remote || remote === cur) return manual ? say(`자동 업데이트 확인: 이미 최신 버전(${short(cur)})이에요.`) : undefined;
  if (git(["merge-base", "--is-ancestor", cur, remote]).status !== 0) {
    return say(`자동 업데이트 건너뜀: 이 PC의 main(${short(cur)})이 origin/main(${short(remote)})과 갈라져 있어요.`);
  }
  if ((readState().skip ?? []).includes(remote)) return say(`자동 업데이트 건너뜀: ${short(remote)} 는 전에 실패한 커밋이에요.`);
  const changed = out(git(["diff", "--name-only", cur, remote, "--", "."]));
  if (!changed) return say(`자동 업데이트 건너뜀: 새 커밋(${short(remote)})에 감독 프로그램 변경이 없어요.`);

  if (running > 0) {
    // 일감·정비가 돌고 있다: 지금은 받지 않고 대기(새 일감 받기를 멈춰 진행 중인 것만 끝나게 한다)
    waiting = { to: remote, manual };
    say(`자동 업데이트 대기: 새 버전(${short(remote)})이 있어요. 진행 중 일감 ${running}개가 모두 끝나면 받고 다시 시작해요(그동안 새 일감은 받지 않아요).`);
    return;
  }
  log(`자동 업데이트 시작: ${short(cur)} → ${short(remote)} (${changed.split("\n").join(", ")})`);
  const p = git(["pull", "--ff-only", "-q", "origin", "main"], 120_000);
  if (p.status !== 0) {
    log(`자동 업데이트 실패(git pull): ${errText(p)}`);
    git(["reset", "--hard", cur]);
    return;
  }
  const now = head();
  for (const file of filesToCheck()) {
    const c = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", windowsHide: true });
    if (c.status !== 0) {
      log(`자동 업데이트 실패: 문법 검사 통과 못 함(${path.basename(file)}). 이전 커밋(${short(cur)})으로 되돌려요.\n${errText(c)}`);
      const r = git(["reset", "--hard", cur]);
      if (r.status !== 0) log(`되돌리기 실패(git reset): ${errText(r)}`);
      const s = readState();
      s.skip = [...new Set([...(s.skip ?? []), now])].slice(-20);
      writeState(s);
      return;
    }
  }
  writeState({ ...readState(), trial: { from: cur, to: now, starts: 0, at: new Date().toISOString() } });
  log(`자동 업데이트 완료: ${short(now)} 를 받았어요. 다시 시작합니다(실행기가 30초 뒤 새 코드로 띄움).`);
  process.exit(0);
}
