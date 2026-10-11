// 앱 공장 감독 프로그램 자동 업데이트
// - 일감이 하나도 돌지 않을 때만 10분마다 origin/main 을 확인해서, 이 폴더(tools/factory-supervisor/) 파일이 바뀌었으면
//   git pull --ff-only → node --check → 정상 종료(exit 0)한다. 실행기(~/dev/factory/run-supervisor.sh)가 30초 뒤 새 코드로 다시 띄운다.
// - 새 버전이 시작 후 30초 안에 꺼지면, 다음 시작 때 이전 커밋으로 되돌리고 그 커밋은 다시 받지 않는다(건너뛸 목록).
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
const TRIAL_SEC = 30;
const UNDER_LAUNCHER = process.env.FACTORY_LAUNCHER === "1";

const stamp = () => new Date().toLocaleTimeString("ko-KR", { hour12: false });
const log = (...a) => console.log(`[${stamp()}]`, ...a);
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
    // 지난번 시작이 30초를 못 버텼다 → 이전 커밋으로 되돌리고 이 커밋은 건너뛴다
    log(`자동 업데이트 실패: 새 버전(${short(st.trial.to)})이 시작 후 ${TRIAL_SEC}초 안에 꺼졌어요. 이전 커밋(${short(st.trial.from)})으로 되돌려요.`);
    const r = git(["reset", "--hard", st.trial.from]);
    if (r.status !== 0) log(`되돌리기 실패(git reset): ${errText(r)}`);
    st.skip = [...new Set([...(st.skip ?? []), st.trial.to])].slice(-20);
    delete st.trial;
    writeState(st);
    process.exit(0); // 실행기가 되돌린 코드로 다시 띄운다
  }
  st.trial.starts = 1;
  writeState(st);
  setTimeout(() => {
    const s = readState();
    if (s.trial?.to !== h) return;
    delete s.trial;
    writeState(s);
    log(`자동 업데이트 확인: 새 버전(${short(h)})이 ${TRIAL_SEC}초 넘게 정상 동작해요.`);
  }, TRIAL_SEC * 1000).unref();
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

// 같은 건너뜀 사유는 바뀔 때만 한 번 남긴다(10분마다 같은 줄이 쌓이지 않게)
function note(m) {
  if (m === lastNote) return;
  lastNote = m;
  log(m);
}

// 대기열 확인 루프에서 매번 부른다. 업데이트를 받으면 프로세스를 끝낸다(exit 0).
export function maybeUpdate({ running, autoUpdate }) {
  if (running > 0 || autoUpdate === false) return;
  if (Date.now() - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = Date.now();
  if (!UNDER_LAUNCHER) {
    if (!warnedNoLauncher) log("자동 업데이트 건너뜀: 실행기(run-supervisor.sh) 밖에서 돌고 있어서 다시 띄워 줄 장치가 없어요.");
    warnedNoLauncher = true;
    return;
  }

  const cur = head();
  if (!cur) return note("자동 업데이트 건너뜀: git 저장소 안에서 실행 중이 아니에요.");
  if (out(git(["rev-parse", "--abbrev-ref", "HEAD"])) !== "main") return note("자동 업데이트 건너뜀: main 브랜치가 아니에요.");
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]);
  if (dirty.status !== 0 || dirty.stdout.trim()) return note("자동 업데이트 건너뜀: 작업 트리에 커밋 안 된 변경이 있어요.");

  const f = git(["fetch", "-q", "origin", "main"], 120_000);
  if (f.status !== 0) return note(`자동 업데이트 확인 실패(git fetch): ${errText(f)}`);
  const remote = out(git(["rev-parse", "origin/main"]));
  if (!remote || remote === cur) return;
  if (git(["merge-base", "--is-ancestor", cur, remote]).status !== 0) {
    return note(`자동 업데이트 건너뜀: 이 PC의 main(${short(cur)})이 origin/main(${short(remote)})과 갈라져 있어요.`);
  }
  if ((readState().skip ?? []).includes(remote)) return note(`자동 업데이트 건너뜀: ${short(remote)} 는 전에 실패한 커밋이에요.`);
  const changed = out(git(["diff", "--name-only", cur, remote, "--", "."]));
  if (!changed) return note(`자동 업데이트 건너뜀: 새 커밋(${short(remote)})에 감독 프로그램 변경이 없어요.`);

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
