// tools/factory-supervisor/worktree.mjs
// 병행 일감의 작업 사본(git worktree) 다루기(병렬화 단계 C-1).
//   병행 그룹 일감은 앱 저장소에서 `git worktree add -b factory/job-<id> <작업 폴더>/.worktrees/<앱>-<id>` 로 사본을 만들어 그 안에서 실행한다.
//   임시 브랜치는 로컬에만 있고 절대 push 하지 않는다(이 파일에는 push 가 없다).
//   끝나거나 실패하면 `git worktree remove` 와 `git branch -D`(로컬)로 정리한다. rm -rf 는 쓰지 않는다.
//   감독 프로그램이 다시 켜질 때 남은 사본은 이어받지 않고 정리한다(cleanupLeftovers). 서버가 임대 만료로 그 일감을 대기열로 되돌려 처음부터 다시 실행한다.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const WT_DIR = ".worktrees";
export const BRANCH_PREFIX = "factory/job-";
export const JOB_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
// 공장이 폴더마다 쓰는 파일. 사본마다 내용이 달라 합칠 때 충돌하므로 결과 커밋에서 뺀다(서버 쪽 일감 기록에 이미 있음)
export const FACTORY_FILES = ["PLAN.md", "CHANGE_REQUEST.md", "RELEASE_REQUEST.md", "CLAUDE.md", "CLAUDE.local.md"];
// 사본에 따로 만들어 줘야 하는 git 에 없는 파일: 의존성 폴더는 연결(junction), 로컬 설정은 복사
export const LINK_DIRS = ["node_modules"];
export const COPY_FILES = ["local.properties", path.join("android", "local.properties")];

export const branchName = (jobId) => {
  if (!JOB_ID_RE.test(jobId)) throw new Error("일감 id 형식이 올바르지 않아요.");

  return `${BRANCH_PREFIX}${jobId}`;
};

export function worktreePath(workDir, slug, jobId) {
  if (!SLUG_RE.test(slug)) throw new Error("앱 폴더 이름이 올바르지 않아요.");
  branchName(jobId);
  const root = path.resolve(workDir, WT_DIR);
  const dir = path.resolve(root, `${slug}-${jobId}`);

  if (!dir.startsWith(root + path.sep)) throw new Error("작업 사본 경로가 올바르지 않아요.");

  return dir;
}

/** git 한 번 실행. 던지지 않고 { ok, status, stdout, stderr } */
export function git(dir, args, env = {}) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", shell: false, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", ...env } });

  return { ok: r.status === 0, status: r.status, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim(), raw: r.stdout ?? "" };
}

// 병합·커밋에 쓰는 작성자(앱 폴더 커밋과 같은 이름)
const AUTHOR = ["-c", "user.name=app-factory", "-c", "user.email=factory@localhost"];

/** 기본 브랜치 이름: 저장소에 main 이 있으면 main, 없고 master 가 있으면 master. 둘 다 없으면 null */
export function defaultBranch(repoDir) {
  for (const b of ["main", "master"]) if (git(repoDir, ["rev-parse", "--verify", "--quiet", `refs/heads/${b}`]).ok) return b;

  return null;
}

export const currentBranch = (dir) => git(dir, ["branch", "--show-current"]).stdout;
export const headOf = (dir) => git(dir, ["rev-parse", "HEAD"]).stdout;
/** 커밋 안 된 변경(추적 안 하는 새 파일 포함, .gitignore 된 것은 제외)이 있는 파일 수 */
export const dirtyCount = (dir) => git(dir, ["status", "--porcelain"]).stdout.split(/\r?\n/).filter(Boolean).length;

// ───────── 만들기 ─────────

/** 의존성 폴더 연결·로컬 설정 복사(git 에 없어서 사본에는 없는 것들). 있는 것만, 실패는 로그만 */
export function prepareExtras(repoDir, wtDir, log = () => {}) {
  for (const name of LINK_DIRS) {
    const from = path.join(repoDir, name);
    const to = path.join(wtDir, name);

    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    try {
      fs.symlinkSync(from, to, "junction");
      log(`${name} 을(를) 앱 폴더와 연결했어요(사본에서 설치하지 않음).`);
    } catch (e) {
      log(`${name} 연결 실패(사본에서 직접 설치해야 할 수 있어요): ${e.message}`);
    }
  }
  for (const rel of COPY_FILES) {
    const from = path.join(repoDir, rel);
    const to = path.join(wtDir, rel);

    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    } catch (e) {
      log(`${rel} 복사 실패: ${e.message}`);
    }
  }
}

/** 의존성 연결을 풀어 둔다(폴더 안 내용은 건드리지 않고 연결만). 못 풀면 false → 사본을 지우지 않는다 */
export function unlinkExtras(wtDir) {
  let ok = true;

  for (const name of LINK_DIRS) {
    const p = path.join(wtDir, name);

    try {
      if (fs.lstatSync(p).isSymbolicLink()) fs.rmdirSync(p); // 연결만 지운다(재귀 삭제 아님)
    } catch (e) {
      if (e.code !== "ENOENT") ok = false;
    }
  }

  return ok;
}

/**
 * 작업 사본을 만든다. 같은 이름의 낡은 사본·브랜치가 있으면 먼저 정리한다.
 * 기본 브랜치의 현재 커밋에서 임시 브랜치를 딴다. 앱 폴더(repoDir)는 기본 브랜치에 있어야 한다.
 */
export function createWorktree({ repoDir, wtDir, branch, base, log = () => {} }) {
  removeWorktree({ repoDir, wtDir, branch, log: () => {} }); // 낡은 것 정리(없으면 아무 일 없음)
  fs.mkdirSync(path.dirname(wtDir), { recursive: true });
  const r = git(repoDir, ["worktree", "add", "-b", branch, wtDir, base]);

  if (!r.ok) throw new Error(`작업 사본을 만들지 못했어요: ${r.stderr || r.stdout}`);
  prepareExtras(repoDir, wtDir, log);

  return { wtDir, branch, base, startCommit: headOf(wtDir) };
}

// ───────── 정리 ─────────

/**
 * 작업 사본과 임시 브랜치를 정리한다: `git worktree remove --force` → `git worktree prune` → `git branch -D`(로컬 브랜치만).
 * 사본 안의 의존성 연결을 못 풀면 사본은 지우지 않는다(연결된 원본 폴더 내용을 지우지 않으려고). 던지지 않는다.
 */
export function removeWorktree({ repoDir, wtDir, branch, log = () => {} }) {
  const out = { dirRemoved: false, branchRemoved: false, notes: [] };

  if (fs.existsSync(wtDir)) {
    if (!unlinkExtras(wtDir)) {
      out.notes.push("사본 안의 연결을 풀지 못해 사본을 지우지 않았어요");
    } else {
      const r = git(repoDir, ["worktree", "remove", "--force", wtDir]);

      if (!r.ok) out.notes.push(`worktree remove 실패: ${r.stderr || r.stdout}`);
    }
  }
  git(repoDir, ["worktree", "prune"]);
  out.dirRemoved = !fs.existsSync(wtDir);
  if (git(repoDir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok) {
    const b = git(repoDir, ["branch", "-D", branch]);

    out.branchRemoved = b.ok;
    if (!b.ok) out.notes.push(`branch -D 실패: ${b.stderr || b.stdout}`);
  } else {
    out.branchRemoved = true;
  }
  if (out.notes.length) log(`작업 사본 정리: ${out.notes.join(" · ")}`);

  return out;
}

/** 앱 저장소가 아는 공장 작업 사본: [{ wtDir, branch }] (git worktree list 에서 factory/job-* 브랜치만) */
export function listFactoryWorktrees(repoDir) {
  const r = git(repoDir, ["worktree", "list", "--porcelain"]);

  if (!r.ok) return [];
  const out = [];
  let cur = null;

  for (const line of r.stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) cur = { wtDir: line.slice(9).trim(), branch: "" };
    else if (line.startsWith("branch ") && cur) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
    else if (line === "" && cur) {
      if (cur.branch.startsWith(BRANCH_PREFIX)) out.push(cur);
      cur = null;
    }
  }
  if (cur?.branch.startsWith(BRANCH_PREFIX)) out.push(cur);

  return out;
}

/**
 * 감독 프로그램이 켜질 때: 이전 실행이 남긴 작업 사본과 factory/job-* 브랜치를 정리한다(이어받지 않음).
 * 작업 폴더의 앱 폴더들을 돌며 git worktree list 로 찾는다. 반환: 정리한 사본·브랜치 수. 던지지 않는다.
 */
export function cleanupLeftovers({ workDir, log = () => {}, skip = () => false }) {
  const result = { worktrees: 0, branches: 0, kept: 0 };
  let apps = [];

  try {
    apps = fs.readdirSync(workDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && fs.existsSync(path.join(workDir, e.name, ".git")));
  } catch {
    return result;
  }
  for (const app of apps) {
    const repoDir = path.join(workDir, app.name);

    for (const wt of listFactoryWorktrees(repoDir)) {
      if (skip(wt.branch)) continue;
      const r = removeWorktree({ repoDir, wtDir: wt.wtDir, branch: wt.branch, log: (m) => log(`[${app.name}] ${m}`) });

      if (r.dirRemoved) result.worktrees++;
      else result.kept++;
      if (r.branchRemoved) result.branches++;
    }
    // 사본은 이미 없는데 브랜치만 남은 것
    const left = git(repoDir, ["for-each-ref", "--format=%(refname:short)", `refs/heads/${BRANCH_PREFIX}*`]);

    for (const branch of left.stdout.split(/\r?\n/).filter(Boolean)) {
      if (skip(branch) || listFactoryWorktrees(repoDir).some((w) => w.branch === branch)) continue;
      if (git(repoDir, ["branch", "-D", branch]).ok) result.branches++;
    }
    git(repoDir, ["worktree", "prune"]);
  }
  if (result.worktrees || result.branches || result.kept) log(`지난 실행이 남긴 작업 사본 정리: 사본 ${result.worktrees}개, 임시 브랜치 ${result.branches}개${result.kept ? `, 못 지운 사본 ${result.kept}개(다음 시작 때 다시)` : ""}`);

  return result;
}

// ───────── 커밋·합치기 재료 ─────────

/** 공장 파일(PLAN.md 등)을 결과에서 뺀다: 추적 중인 것은 기본 상태로 되돌리고, 새로 생긴 것은 파일만 지운다(사본 안의 파일 하나씩) */
export function stripFactoryFiles(wtDir) {
  for (const f of FACTORY_FILES) {
    if (git(wtDir, ["ls-files", "--error-unmatch", "--", f]).ok) git(wtDir, ["restore", "--source=HEAD", "--staged", "--worktree", "--", f]);
    else {
      try {
        fs.unlinkSync(path.join(wtDir, f));
      } catch {
        /* 없으면 그대로 */
      }
    }
  }
}

/** 사본의 변경을 커밋한다. 바뀐 게 없으면 false. commit 은 감독 프로그램의 키 파일 검사 커밋(safeCommit)을 넘겨 쓴다 */
export function commitAll(wtDir, message, commit) {
  stripFactoryFiles(wtDir);
  if (!dirtyCount(wtDir)) return false;
  if (commit) return commit(message) === true;
  git(wtDir, ["add", "-A"]);

  return git(wtDir, [...AUTHOR, "commit", "-q", "-m", message]).ok;
}

/** 충돌 중인 파일 목록 */
export const conflictFiles = (dir) => git(dir, ["diff", "--name-only", "--diff-filter=U"]).stdout.split(/\r?\n/).filter(Boolean);

/** 사본 브랜치에 기본 브랜치를 합쳐 넣는다(글자 충돌이면 충돌 표시를 남긴 채 { ok:false, conflicts }). 이미 최신이면 { ok:true, upToDate:true } */
export function mergeBaseIntoBranch(wtDir, base) {
  const before = headOf(wtDir);
  const r = git(wtDir, [...AUTHOR, "merge", "--no-edit", base], { GIT_MERGE_AUTOEDIT: "no" });

  if (r.ok) return { ok: true, upToDate: headOf(wtDir) === before };
  const conflicts = conflictFiles(wtDir);

  if (conflicts.length) return { ok: false, conflicts, output: r.stdout || r.stderr };
  git(wtDir, ["merge", "--abort"]);

  return { ok: false, conflicts: [], output: r.stderr || r.stdout };
}

/** 충돌 표시가 남았는지·합치기가 끝나지 않았는지 */
export const mergeInProgress = (dir) => git(dir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok;

/** 앱 폴더의 기본 브랜치를 임시 브랜치로 앞으로 감기(fast-forward only). 로컬 작업만 하고 원격으로는 아무것도 보내지 않는다 */
export function fastForwardBase(repoDir, branch) {
  return git(repoDir, [...AUTHOR, "merge", "--ff-only", branch]);
}

/** 합치기 실패로 사본을 지우기 전에 작업 내용을 파일 하나로 남긴다(.factory/history 아래, git 에 안 들어감). 경로를 돌려준다 */
export function savePatch({ repoDir, base, branch, jobId }) {
  const r = git(repoDir, ["diff", "--binary", `${base}...${branch}`]);

  if (!r.ok || !r.raw) return null;
  const dir = path.join(repoDir, ".factory", "history");
  const file = path.join(dir, `${jobId}.merge-failed.patch`);

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, r.raw);

    return file;
  } catch {
    return null;
  }
}
