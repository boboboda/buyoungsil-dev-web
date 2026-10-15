// 정비 대상 전환 안전장치 (통합-분리 4-5b): 정비 폴더를 감독 전용 저장소(bare·clone)로 바꾸고 자동 업데이트 원본도 bare 로 옮긴다.
// 설정과 실행 폴더(supervisor-src)는 정비가 직접 고치지 못하므로(pcguard.mjs), 신뢰된 serverctl 명령 하나로 한다. server-switch(serverswitch.mjs)와 같은 모양:
//  1) serverctl.mjs maint-switch [--dry-run | --status | --revert]
//     - 바뀔 값 점검: 정비 clone(깨끗함·origin=bare·HEAD=bare main), 실행 폴더(깨끗함·main), bare main 을 실행 폴더로 fetch 해서
//       tools/factory-supervisor/ 내용(줄바꿈 CRLF 제외)이 bare main 과 같을 때만 진행. 다르면 아무것도 바꾸지 않는다. --dry-run 은 여기까지만.
//     - 통과하면 supervisor.config.json 과 실행 폴더 origin·HEAD 를 백업하고, maintDir·maintPushRemote 를 바꾸고, 실행 폴더 origin 을 bare 로 바꾼 뒤
//       bare main 커밋으로 로컬만 맞춘다(reset --hard, push 없음). update.mjs 가 "새 버전 없음"으로 보는지 fetch 로 확인하고 상태(armed)를 남긴다.
//       돌고 있는 감독이 상태를 보고 일감이 끝나는 대로 스스로 재시작한다(restart.mjs).
//  2) 감독 쪽 자동 되돌림(startMaintSwitchGuard): 새 설정으로 다시 켜진 뒤 5분 안에 대기열 확인이 200 을 한 번도 받지 못하면
//     이 PC 안에서(서버 연결 없이) 설정·origin·HEAD 를 이전 값으로 되돌리고 재시작한다. 되돌린 사실은 다음 대기열 확인(note)에 실려 간다.
//     확인에 성공하면 상태는 done 으로 남아 `--revert` 로 언제든 되돌릴 수 있다.
// 상태 파일: ~/dev/factory/supervisor-maint-switch.json, 백업: ~/dev/factory/switch-backups/maint-<시각>/ (둘 다 pcguard.mjs 가 정비의 수정을 막는다)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { maintDirOf } from "./deploycfg.mjs";

export const MAINT_TRIAL_SEC = 300; // 새 설정으로 켠 뒤 대기열 확인 성공을 기다리는 시간
const SUBDIR = "tools/factory-supervisor"; // 감독 전용 저장소와 실행 폴더가 같이 가진 폴더
const MSG_USAGE = "maint-switch [--dry-run | --status | --revert]";

// ───────── 경로 ─────────
/** 시험 모드(FACTORY_TEST_MODE=1)에서만 환경변수로 상태 파일을 바꿀 수 있다 */
export function maintSwitchPaths({ env = process.env, home = os.homedir() } = {}) {
  const test = env.FACTORY_TEST_MODE === "1";
  const root = path.join(home, "dev", "factory");
  return {
    state: (test && env.FACTORY_MAINT_SWITCH_STATE) || path.join(root, "supervisor-maint-switch.json"),
    backups: path.join(root, "switch-backups"),
    bare: path.join(home, "dev", "git", "factory-supervisor.git"),
    maintDir: path.join(root, "factory-supervisor"),
  };
}

const slash = (p) => String(p).replace(/\\/g, "/");
/** git 주소를 비교용으로 다듬는다(역슬래시·/c/ 꼴·대소문자·끝 슬래시) */
export function sameRemote(a, b) {
  const n = (s) => slash(path.resolve(slash(s).replace(/^\/([A-Za-z])\//, "$1:/"))).replace(/\/+$/, "").toLowerCase();
  try {
    return n(a) === n(b);
  } catch {
    return false;
  }
}

function git(cwd, args, { gitDir, timeout = 120_000 } = {}) {
  const a = gitDir ? ["--git-dir", gitDir, ...args] : args;
  const r = spawnSync("git", a, {
    cwd,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes" },
  });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.error?.message || r.stderr || "").trim().slice(0, 400) };
}

const readFile = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
function writeAtomic(file, text, mode) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}
const short = (h) => String(h ?? "").slice(0, 7);

// ───────── 상태 파일 ─────────
export function readMaintSwitchState(paths = maintSwitchPaths()) {
  try {
    const s = JSON.parse(fs.readFileSync(paths.state, "utf8"));
    return s && typeof s === "object" ? s : null;
  } catch {
    return null;
  }
}
function writeState(paths, s) {
  fs.mkdirSync(path.dirname(paths.state), { recursive: true });
  writeAtomic(paths.state, JSON.stringify(s, null, 2) + "\n", 0o600);
}

// ───────── 내용 비교 ─────────
/**
 * 실행 폴더의 HEAD 와 방금 fetch 한 커밋의 tools/factory-supervisor/ 내용을 줄바꿈(CRLF) 빼고 비교한다.
 * 반환: 다른 파일 이름 목록(같으면 빈 배열). 읽지 못하면 던진다
 */
export function diffSubdir(srcDir, a, b) {
  const list = (rev) => {
    const r = git(srcDir, ["ls-tree", "-r", rev, "--", SUBDIR]);
    if (!r.ok) throw new Error(`${short(rev)} 의 파일 목록을 읽지 못했어요: ${r.err}`);
    const m = new Map();
    for (const line of r.out.split("\n").filter(Boolean)) {
      const t = line.indexOf("\t");
      const [mode, , sha] = line.slice(0, t).split(" ");
      m.set(line.slice(t + 1), { sha, mode });
    }
    return m;
  };
  const A = list(a);
  const B = list(b);
  const diff = [];
  const blob = (sha) => {
    const r = spawnSync("git", ["cat-file", "blob", sha], { cwd: srcDir, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`파일 내용을 읽지 못했어요(${short(sha)})`);
    return r.stdout.toString("latin1").replace(/\r/g, "");
  };
  for (const [name, x] of A) {
    const y = B.get(name);
    if (!y) diff.push(`${name} (bare 에 없음)`);
    else if (x.sha !== y.sha && blob(x.sha) !== blob(y.sha)) diff.push(name);
  }
  for (const name of B.keys()) if (!A.has(name)) diff.push(`${name} (실행 폴더에 없음)`);
  return diff;
}

// ───────── 되돌리기(명령과 감독이 같이 쓴다) ─────────
/**
 * 설정(maintDir·maintPushRemote)·실행 폴더 origin·HEAD 를 이전 값으로. 지금 값이 전환한 값일 때만 설정을 건드린다.
 * 반환: 되돌린 항목 이름 목록. log 는 실패 이유를 남긴다
 */
export function restoreMaintSwitch(st, { configPath, srcDir, log = () => {} }) {
  const done = [];
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    let changed = false;
    for (const k of ["maintDir", "maintPushRemote"]) {
      if (cfg[k] !== st.to[k]) continue;
      if (st.from[k] === undefined) delete cfg[k];
      else cfg[k] = st.from[k];
      changed = true;
      done.push(k);
    }
    if (changed) writeAtomic(configPath, JSON.stringify(cfg, null, 2) + "\n", 0o600);
  } catch (e) {
    log(`정비 전환 되돌리기: 설정 파일을 고치지 못했어요(${e.message}). 백업: ${st.backupDir}`);
  }
  const cur = git(srcDir, ["remote", "get-url", "origin"]);
  if (cur.ok && sameRemote(cur.out, st.to.origin)) {
    const r = git(srcDir, ["remote", "set-url", "origin", st.from.origin]);
    if (r.ok) done.push("origin");
    else log(`정비 전환 되돌리기: origin 을 되돌리지 못했어요(${r.err}). 백업: ${st.backupDir}`);
  }
  if (st.from.head && git(srcDir, ["cat-file", "-e", `${st.from.head}^{commit}`]).ok) {
    const head = git(srcDir, ["rev-parse", "HEAD"]);
    if (head.ok && head.out !== st.from.head) {
      const r = git(srcDir, ["reset", "--hard", "-q", st.from.head]);
      if (r.ok) done.push("HEAD");
      else log(`정비 전환 되돌리기: 실행 폴더를 ${short(st.from.head)} 로 되돌리지 못했어요(${r.err}). 백업: ${st.backupDir}`);
    }
  }
  return done;
}

const timestamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
const keyText = (v) => (v === undefined ? "(없음)" : JSON.stringify(v));

// ───────── maint-switch 명령 ─────────
/**
 * serverctl.mjs 의 maint-switch 서브커맨드. deps: { args, configPath, srcDir, say, die, report, env, home, paths? }
 *   maint-switch [--dry-run]  |  maint-switch --status  |  maint-switch --revert
 */
export async function runMaintSwitch({ args, configPath, srcDir, say, die, report, env = process.env, home = os.homedir(), paths = maintSwitchPaths({ env, home }) }) {
  const flags = args.filter((a) => a.startsWith("--"));
  const bad = flags.filter((f) => !["--dry-run", "--status", "--revert"].includes(f));
  if (bad.length || flags.length > 1 || args.length !== flags.length) die(MSG_USAGE);
  const mode = flags[0] ?? "";
  const st = readMaintSwitchState(paths);

  if (mode === "--status") {
    if (!st) return say("정비 전환 기록이 없어요.");
    return say(
      `정비 전환 상태: ${st.status} (정비 폴더 ${st.from?.maintDir ?? "기본"} → ${st.to?.maintDir}, 실행 폴더 ${short(st.from?.head)} → ${short(st.to?.head)})${st.deadlineAt ? `, 연결 확인 마감 ${st.deadlineAt}` : ""}${st.reason ? `, 이유: ${st.reason}` : ""}${st.status === "rolledBack" ? (st.reported ? ", 보고함" : ", 보고 전") : ""}`,
    );
  }

  if (mode === "--revert") {
    if (!st || !["armed", "trial", "done"].includes(st.status)) return die(`되돌릴 전환이 없어요${st ? `(상태: ${st.status})` : ""}.`);
    const dirty = git(srcDir, ["status", "--porcelain", "--untracked-files=no"]);
    if (!dirty.ok || dirty.out) die("실행 폴더에 커밋하지 않은 변경이 있어요. 건드리지 않았어요.");
    const restored = restoreMaintSwitch(st, { configPath, srcDir, log: (m) => console.error(m) });
    writeState(paths, { ...st, status: "reverting", revertedAt: new Date().toISOString(), restored });
    const body = `정비 전환 되돌림(--revert): 되돌린 곳 ${restored.join(", ") || "없음(이미 이전 값)"}\n정비 폴더 → ${st.from.maintDir ?? "기본(selfdev)"}, 실행 폴더 origin → ${st.from.origin}, ${short(st.from.head)}\n다음: 감독이 일감이 끝나면 스스로 재시작`;
    await report(body);
    return say(`${body}\n실행기(run-supervisor) 밖에서 돌면 재시작하지 않으니 직접 껐다 켜세요.`);
  }

  // ───── 점검 ─────
  if (st && (st.status === "armed" || st.status === "trial" || st.status === "reverting")) die(`이전 정비 전환이 아직 진행 중이에요(${st.status}). 끝나거나 되돌려진 뒤에 다시 하세요.`);
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    die("감독 설정(supervisor.config.json)을 읽지 못했어요.");
  }
  const bare = paths.bare;
  const toMaintAbs = path.resolve(paths.maintDir);
  const toMaintCfg = home === os.homedir() ? "~/dev/factory/factory-supervisor" : toMaintAbs; // 실제 실행은 ~ 꼴로 설정에 적는다
  const toRemote = "origin";

  const bareMain = git(srcDir, ["rev-parse", "refs/heads/main"], { gitDir: bare });
  if (!bareMain.ok) die(`감독 전용 저장소(bare)를 읽지 못했어요: ${bare}${bareMain.err ? ` — ${bareMain.err}` : ""}`);
  const target = bareMain.out;

  // 정비 clone
  const clone = toMaintAbs;
  if (!git(clone, ["rev-parse", "--is-inside-work-tree"]).ok) die(`정비 폴더가 git 작업 폴더가 아니에요: ${clone}`);
  const cloneOrigin = git(clone, ["remote", "get-url", "origin"]);
  if (!cloneOrigin.ok || !sameRemote(cloneOrigin.out, bare)) die(`정비 폴더의 origin 이 bare 가 아니에요(${cloneOrigin.out || "없음"}).`);
  const cloneDirty = git(clone, ["status", "--porcelain"]);
  if (!cloneDirty.ok || cloneDirty.out) die("정비 폴더에 커밋하지 않은 변경이 있어요. 깨끗해진 뒤에 다시 하세요.");
  const cloneHead = git(clone, ["rev-parse", "HEAD"]);
  if (!cloneHead.ok || cloneHead.out !== target) die(`정비 폴더(${short(cloneHead.out)})가 bare main(${short(target)})과 달라요. 정비 폴더를 bare main 으로 맞춘 뒤에 다시 하세요.`);

  // 실행 폴더
  const branch = git(srcDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch.ok || branch.out !== "main") die(`실행 폴더가 main 브랜치가 아니에요(${branch.out || "?"}).`);
  const srcDirty = git(srcDir, ["status", "--porcelain", "--untracked-files=no"]);
  if (!srcDirty.ok || srcDirty.out) die("실행 폴더에 커밋하지 않은 변경이 있어요. 건드리지 않았어요.");
  const srcOrigin = git(srcDir, ["remote", "get-url", "origin"]);
  if (!srcOrigin.ok) die("실행 폴더의 origin 을 읽지 못했어요.");
  const srcHead = git(srcDir, ["rev-parse", "HEAD"]).out;
  if (sameRemote(srcOrigin.out, bare) && String(maintDirOf(cfg)) === toMaintAbs) die("이미 전환돼 있어요(실행 폴더 origin 이 bare 이고 정비 폴더가 감독 작업 폴더).");

  // bare main 을 실행 폴더로 받아서(주소를 바꾸기 전에) 내용 비교
  const fetched = git(srcDir, ["fetch", "-q", "--no-tags", bare, "main"], { timeout: 180_000 });
  if (!fetched.ok) die(`bare main 을 받지 못했어요: ${fetched.err}`);
  const fh = git(srcDir, ["rev-parse", "FETCH_HEAD"]).out;
  if (fh !== target) die(`받은 커밋(${short(fh)})이 bare main(${short(target)})과 달라요.`);
  let diff;
  try {
    diff = diffSubdir(srcDir, srcHead, target);
  } catch (e) {
    die(`내용 비교 실패: ${e.message}`);
  }
  if (diff.length) {
    await report(`정비 전환 안 함: 실행 폴더(${short(srcHead)})와 bare main(${short(target)})의 감독 파일이 달라요(${diff.length}개: ${diff.slice(0, 5).join(", ")}). 아무것도 바꾸지 않음`);
    die(`실행 폴더 ${SUBDIR}/ 와 bare main 의 내용이 달라요(${diff.length}개: ${diff.slice(0, 5).join(", ")}). bare 를 먼저 맞춘 뒤에 하세요. 아무것도 바꾸지 않았어요.`, 5);
  }
  const outside = git(srcDir, ["diff", "--name-only", srcHead, target]).out.split("\n").filter((f) => f && !f.startsWith(`${SUBDIR}/`));

  const from = { maintDir: cfg.maintDir, maintPushRemote: cfg.maintPushRemote, origin: srcOrigin.out, head: srcHead };
  const to = { maintDir: toMaintCfg, maintPushRemote: toRemote, origin: slash(bare), head: target };
  const plan = [
    `maintDir: ${keyText(from.maintDir)} → ${keyText(to.maintDir)}`,
    `maintPushRemote: ${keyText(from.maintPushRemote)} → ${keyText(to.maintPushRemote)}`,
    `실행 폴더 origin: ${from.origin} → ${to.origin}`,
    `실행 폴더 커밋: ${short(srcHead)} → ${short(target)} (로컬만 맞춤, push 없음, 감독 파일 내용은 줄바꿈 빼고 같음, 실행 폴더에서 빠지는 감독 밖 파일 ${outside.length}개)`,
  ].join("\n");
  if (mode === "--dry-run") {
    await report(`정비 전환 점검(--dry-run): 통과, 아무것도 바꾸지 않음\n${plan}`);
    return say(`maint-switch --dry-run: 점검 통과. 아무것도 바꾸지 않았어요.\n${plan}`);
  }

  // ───── 실행: 백업 → 상태(armed) → 설정 → origin → 커밋 맞춤 → update 확인 ─────
  const backupDir = path.join(paths.backups, `maint-${timestamp()}`);
  const record = { v: 1, status: "armed", from, to, toMaintAbs, backupDir, armedAt: new Date().toISOString() };
  try {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    fs.copyFileSync(configPath, path.join(backupDir, "supervisor.config.json"));
    fs.chmodSync(path.join(backupDir, "supervisor.config.json"), 0o600);
    fs.writeFileSync(path.join(backupDir, "src-git.txt"), `origin ${from.origin}\nHEAD ${from.head}\n`);
    writeState(paths, record); // 상태가 먼저라야 중간에 끊겨도 --revert 가 된다
    writeAtomic(configPath, JSON.stringify({ ...cfg, maintDir: to.maintDir, maintPushRemote: to.maintPushRemote }, null, 2) + "\n", 0o600);
    const o = git(srcDir, ["remote", "set-url", "origin", to.origin]);
    if (!o.ok) throw new Error(`origin 바꾸기 실패: ${o.err}`);
    const r = git(srcDir, ["reset", "--hard", "-q", target]);
    if (!r.ok) throw new Error(`커밋 맞추기 실패: ${r.err}`);
    // update.mjs 가 보는 것과 같은 방식: origin main 을 받아서 현재 커밋과 같으면 "새 버전 없음"
    const f = git(srcDir, ["fetch", "-q", "origin", "main"], { timeout: 180_000 });
    const remote = git(srcDir, ["rev-parse", "origin/main"]).out;
    const cur = git(srcDir, ["rev-parse", "HEAD"]).out;
    if (!f.ok || remote !== cur || cur !== target) throw new Error(`새 버전 없음 확인 실패(내 ${short(cur)}, origin/main ${short(remote)}${f.ok ? "" : `, fetch: ${f.err}`})`);
    if (JSON.stringify(JSON.parse(fs.readFileSync(configPath, "utf8")).maintDir) !== JSON.stringify(to.maintDir)) throw new Error("설정 확인 실패");
  } catch (e) {
    // 쓰다 실패: 되돌리고 상태를 지운다(백업은 남긴다)
    const done = restoreMaintSwitch(record, { configPath, srcDir, log: (m) => console.error(m) });
    fs.rmSync(paths.state, { force: true });
    await report(`정비 전환 중 실패해서 되돌림: ${e.message}\n되돌린 곳: ${done.join(", ") || "없음"}\n백업: ${backupDir}`);
    die(`정비 전환 중 실패해서 되돌렸어요: ${e.message}`, 5);
  }
  const body = `정비 전환 준비: 정비 폴더·자동 업데이트 원본을 감독 전용 저장소(bare ${short(target)})로\n${plan}\n백업: ${backupDir}\n다음: 감독이 일감이 끝나면 스스로 재시작 → ${MAINT_TRIAL_SEC / 60}분 안에 대기열 확인이 성공하지 않으면 자동으로 이전 값으로 되돌림`;
  await report(body);
  say(`${body}\n실행기(run-supervisor) 밖에서 돌면 재시작하지 않으니 직접 껐다 켜세요. 상태 확인: maint-switch --status, 되돌리기: maint-switch --revert`);
}

// ───────── 감독 쪽: 재시작 요청 · 건강 확인 · 자동 되돌림 ─────────
let trialTimer = null;
let activePaths = null;
let trialLog = () => {};

/** 돌고 있는 감독이 아직 이전 설정인데 전환이 준비됐으면(또는 --revert 했으면) true → 감독이 일감이 끝나길 기다렸다 재시작한다 */
export function maintSwitchRestartWanted(cfg, paths = maintSwitchPaths()) {
  const st = readMaintSwitchState(paths);
  if (!st) return false;
  if (st.status === "armed") return maintDirKey(cfg) !== st.toMaintAbs;
  if (st.status === "reverting") return maintDirKey(cfg) === st.toMaintAbs;
  return false;
}
const maintDirKey = (cfg) => {
  try {
    return path.resolve(maintDirOf(cfg));
  } catch {
    return "";
  }
};

/** 대기열 확인 응답이 200 일 때 → 시험 중이면 확인된 것(done 으로 남긴다). 시험 중이 아니면 아무 일도 안 한다 */
export function noteMaintSwitchOk(paths = activePaths) {
  if (!trialTimer || !paths) return false;
  clearTimeout(trialTimer);
  trialTimer = null;
  const st = readMaintSwitchState(paths);
  if (st?.status === "trial") {
    writeState(paths, { ...st, status: "done", confirmedAt: new Date().toISOString() });
    trialLog(`정비 전환 확인: 새 설정(정비 폴더·자동 업데이트 원본 bare)으로 홈페이지 연결에 성공했어요. 되돌리려면 maint-switch --revert.`);
  }
  return true;
}

/** 되돌렸는데 아직 홈페이지에 알리지 못했으면 대기열 확인 note(150자 안)에 실을 문구, 없으면 "" */
export function maintSwitchReportNote(paths = maintSwitchPaths()) {
  const st = readMaintSwitchState(paths);
  if (st?.status !== "rolledBack" || st.reported) return "";
  return `정비 전환 되돌림: 연결 확인 실패 → 이전 설정 (${String(st.rolledBackAt ?? "").slice(0, 16)})`.slice(0, 150);
}
export function markMaintSwitchReported(paths = maintSwitchPaths()) {
  const st = readMaintSwitchState(paths);
  if (st?.status !== "rolledBack" || st.reported) return false;
  writeState(paths, { ...st, reported: true, reportedAt: new Date().toISOString() });
  return true;
}

/**
 * 감독을 실행 모드로 시작하고 설정을 읽은 직후 부른다(serverswitch 의 startSwitchGuard 와 같은 방식).
 *  - 전환이 준비(armed)된 채 새 설정(정비 폴더 = 전환 대상)으로 켜졌으면 시험(trial) 시작: 마감 = 지금 + 5분(상태 파일에 남아 재시작해도 이어짐)
 *  - 마감까지 noteMaintSwitchOk() 가 없으면 설정·origin·HEAD 를 되돌리고 rolledBack 으로 남긴다. 실행기 밑(FACTORY_LAUNCHER=1)이면 shutdown() 으로 재시작
 *  - --revert 뒤(reverting) 이전 설정으로 켜졌으면 reverted 로 남긴다
 * 서버 연결이 필요 없다. 반환: 지금 상태 문자열(시험·테스트용)
 */
export function startMaintSwitchGuard({ cfg, configPath, srcDir, log, shutdown, env = process.env, paths = maintSwitchPaths({ env }), now = () => Date.now() }) {
  trialLog = log;
  activePaths = paths;
  const st = readMaintSwitchState(paths);
  if (!st || !st.from || !st.to) return "none";
  const key = maintDirKey(cfg);
  if (st.status === "reverting") {
    if (key === st.toMaintAbs) return "reverting"; // 아직 재시작 전(maintSwitchRestartWanted 가 재시작을 부탁한다)
    writeState(paths, { ...st, status: "reverted", revertedDoneAt: new Date(now()).toISOString() });
    log("정비 전환 되돌림 완료: 이전 설정으로 켜졌어요.");
    return "reverted";
  }
  if (st.status !== "armed" && st.status !== "trial") return st.status === "rolledBack" ? "rolledBack" : "none";
  if (key !== st.toMaintAbs && st.status === "armed") return "armed"; // 아직 재시작 전
  if (key !== st.toMaintAbs) {
    log("정비 전환 기록이 지금 설정과 맞지 않아 닫았어요.");
    writeState(paths, { ...st, status: "reverted", note: "설정이 달라 닫음" });
    return "none";
  }
  const trialMs = (env.FACTORY_TEST_MODE === "1" && Number(env.FACTORY_MAINT_TRIAL_SEC) > 0 ? Number(env.FACTORY_MAINT_TRIAL_SEC) : MAINT_TRIAL_SEC) * 1000;
  let deadline = Number(new Date(st.deadlineAt));
  if (st.status === "armed" || !Number.isFinite(deadline)) {
    deadline = now() + trialMs;
    writeState(paths, { ...st, status: "trial", trialStartedAt: new Date(now()).toISOString(), deadlineAt: new Date(deadline).toISOString() });
    log(`정비 전환 시험 시작: 새 설정으로 ${Math.round(trialMs / 1000)}초 안에 대기열 확인이 성공하지 않으면 이전 설정으로 되돌려요.`);
  } else {
    log(`정비 전환 시험 이어서: 마감 ${st.deadlineAt}`);
  }

  const rollback = () => {
    trialTimer = null;
    const reason = `새 설정으로 ${Math.round(trialMs / 1000)}초 안에 대기열 확인에 성공하지 못함`;
    const done = restoreMaintSwitch(st, { configPath, srcDir, log });
    writeState(paths, { ...st, status: "rolledBack", rolledBackAt: new Date(now()).toISOString(), reason, restored: done, reported: false });
    log(`정비 전환 되돌림: ${reason} → 이전 설정으로 되돌렸어요(${done.join(", ") || "바꿀 것 없음"}).`);
    if (env.FACTORY_LAUNCHER === "1") {
      log("실행기가 30초 뒤 이전 설정으로 다시 띄워요.");
      shutdown();
    }
  };
  const left = deadline - now();
  if (left <= 0) {
    rollback();
    return "rolledBack";
  }
  trialTimer = setTimeout(rollback, left);
  trialTimer.unref?.();
  return "trial";
}
