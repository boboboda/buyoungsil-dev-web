// 배포 되돌리기 (5-2, 감독 프로그램 쪽)
// 통제실 배포 기록의 [이전 버전으로]를 누르면 서버가 /next 의 maintenanceDeploy 에 revertTo(되돌릴 커밋)를 붙여 준다.
// 이 파일은 정비 폴더(main)에서 "되돌리기 커밋"을 만든다:
//   · 부모 = 지금 GitHub main, 내용 = revertTo 커밋의 내용. 그래서 GitHub main 에는 보통 push 만 있고(force push 없음) 기록은 지워지지 않는다.
//   · 감독 프로그램 코드(tools/factory-supervisor)는 지금 것을 그대로 둔다(홈페이지 배포와 따로 업데이트되는 코드라서).
//   · DB 마이그레이션(prisma/migrations)이 대상과 지금 사이에 바뀌었으면 만들지 않고 이유를 돌려준다. 마이그레이션은 되돌리지 않는다.
//   · 정비 폴더가 깨끗하지 않거나(커밋 안 된 변경), 로컬 main 이 GitHub main 과 갈라졌으면 만들지 않는다.
//   · 이미 같은 내용이면(지난번에 만들고 보고만 못 한 경우) 새로 만들지 않고 지금 main 을 그대로 쓴다(다시 눌러도 같은 결과).
// 만든 커밋은 평소 배포와 똑같이 서버 배포 저장소로 push 된다(maintenance.mjs 의 deploy()).
// git 만 쓴다(AI·네트워크 호출 없음). 시험: tests/revert.test.mjs (임시 저장소)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const KEEP_PATH = "tools/factory-supervisor"; // 되돌리지 않는 경로(감독 프로그램 코드)
export const MIGRATIONS_PATH = "prisma/migrations"; // 바뀌었으면 되돌리지 않는다
export const COMMIT_RE = /^[0-9a-f]{7,40}$/;

const tail = (s, n = 400) => String(s ?? "").trim().slice(-n);

/** dir 에서 git 을 돌리는 함수: (args, { env, timeout }) → spawnSync 결과 */
export function gitRunner(dir) {
  return (args, { env = {}, timeout = 120_000 } = {}) =>
    spawnSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      timeout,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes", ...env },
    });
}

const out = (r) => (r.status === 0 ? r.stdout.trim() : null);
const errText = (r) => tail(r.error?.message || r.stderr || r.stdout || `코드 ${r.status}`);

/** from..to 사이에 prisma/migrations 가 바뀌었나. true | false | null(비교 못 함) */
export function migrationsChanged(git, from, to) {
  if (!COMMIT_RE.test(String(from ?? "")) || !COMMIT_RE.test(String(to ?? ""))) return null;
  const r = git(["diff", "--name-only", from, to, "--", MIGRATIONS_PATH]);

  return r.status === 0 ? r.stdout.trim().length > 0 : null;
}

/**
 * 되돌리기 커밋을 만들어 GitHub main 에 올린다.
 *   → { ok: true, commit, reused } 또는 { ok: false, reason, blocked? }  (blocked: 마이그레이션 때문에 막음)
 */
export function buildRevertCommit({ dir, target, git = gitRunner(dir), log = () => {}, remoteName = "origin" }) {
  if (!COMMIT_RE.test(String(target ?? ""))) return { ok: false, reason: "되돌릴 커밋 형식이 올바르지 않아요." };
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

  if (!fs.existsSync(path.join(dir, ".git"))) return fail(`정비 폴더가 없어요: ${dir}`);
  if (out(git(["rev-parse", "--abbrev-ref", "HEAD"])) !== "main") return fail("정비 폴더가 main 브랜치가 아니에요.");
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]);

  if (dirty.status !== 0 || dirty.stdout.trim()) return fail(`정비 폴더에 커밋 안 된 변경이 있어요. 먼저 정리해 주세요:\n${tail(dirty.stdout, 300)}`);
  const f = git(["fetch", "-q", remoteName, "main"]);

  if (f.status !== 0) return fail(`git fetch 실패: ${errText(f)}`);
  let head = out(git(["rev-parse", "HEAD"]));
  const remote = out(git(["rev-parse", `${remoteName}/main`]));

  if (!head || !remote) return fail("커밋을 읽지 못했어요.");
  if (head !== remote) {
    // 로컬이 뒤처진 것뿐이면 따라가고, 갈라졌거나 로컬에만 커밋이 있으면 멈춘다(그 위에 만들면 올리지 못한 커밋이 섞인다)
    if (git(["merge-base", "--is-ancestor", head, remote]).status !== 0) return fail("정비 폴더의 main 이 GitHub main 과 달라요(올리지 못한 로컬 커밋이 있어요). 정리한 뒤 다시 눌러 주세요.");
    const ff = git(["merge", "--ff-only", "-q", `${remoteName}/main`]);

    if (ff.status !== 0) return fail(`정비 폴더를 GitHub main 으로 맞추지 못했어요: ${errText(ff)}`);
    head = remote;
  }
  if (git(["merge-base", "--is-ancestor", target, `${remoteName}/main`]).status !== 0) return fail(`${target.slice(0, 7)} 는 GitHub main 에 없는 커밋이에요.`);

  // 마이그레이션 검사(권위 있는 검사): 대상과 지금 main 사이에 하나라도 바뀌었으면 되돌리지 않는다
  const mig = git(["diff", "--name-only", target, head, "--", MIGRATIONS_PATH]);

  if (mig.status !== 0) return fail(`마이그레이션 변경을 확인하지 못했어요: ${errText(mig)}`);
  const migFiles = mig.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  if (migFiles.length) {
    const names = [...new Set(migFiles.map((f) => f.split("/")[2] || f))].slice(0, 5).join(", ");

    return fail(`${target.slice(0, 7)} 이후 DB 마이그레이션이 바뀌었어요(${names}${migFiles.length > 5 ? " …" : ""}). 마이그레이션은 되돌리지 않아서 이 버전으로는 되돌릴 수 없어요.`, { blocked: "migrations" });
  }

  // 새 트리 = 대상 커밋의 내용 + 감독 프로그램 코드는 지금 것. 작업 폴더·진짜 index 는 건드리지 않고 임시 index 로 만든다
  const gitDir = out(git(["rev-parse", "--git-dir"]));

  if (!gitDir) return fail("git 폴더를 찾지 못했어요.");
  const tmpIndex = path.resolve(dir, gitDir, `factory-revert-index-${process.pid}`);
  const env = { GIT_INDEX_FILE: tmpIndex };

  try {
    const steps = [
      [["read-tree", target], "대상 커밋 읽기"],
      [["rm", "-r", "-q", "-f", "--cached", "--ignore-unmatch", KEEP_PATH], "감독 프로그램 코드 빼기"],
    ];

    for (const [args, what] of steps) {
      const r = git(args, { env });

      if (r.status !== 0) return fail(`${what} 실패: ${errText(r)}`);
    }
    if (git(["cat-file", "-e", `${head}:${KEEP_PATH}`]).status === 0) {
      const r = git(["read-tree", `--prefix=${KEEP_PATH}/`, `${head}:${KEEP_PATH}`], { env });

      if (r.status !== 0) return fail(`감독 프로그램 코드 유지 실패: ${errText(r)}`);
    }
    const tree = out(git(["write-tree"], { env }));

    if (!tree) return fail("새 트리를 만들지 못했어요.");
    if (tree === out(git(["rev-parse", `${head}^{tree}`]))) {
      log(`[정비 되돌리기] 이미 ${target.slice(0, 7)} 버전과 같은 내용이에요. 새 커밋 없이 지금 main(${head.slice(0, 7)})을 배포해요.`);

      return { ok: true, commit: head, reused: true };
    }
    const msg = `되돌리기: ${target.slice(0, 7)} 버전 상태로 (배포 되돌리기)\n\n통제실 배포 기록의 [이전 버전으로]. 이 커밋은 ${target.slice(0, 12)} 의 내용으로 되돌리고, 감독 프로그램 코드(${KEEP_PATH})와 DB 마이그레이션은 되돌리지 않았다.`;
    const c = git(["-c", "user.name=factory-supervisor", "-c", "user.email=factory@localhost", "commit-tree", tree, "-p", head, "-m", msg]);
    const commit = out(c);

    if (!commit) return fail(`되돌리기 커밋을 만들지 못했어요: ${errText(c)}`);
    // 검사: 감독 프로그램 코드를 뺀 나머지가 대상 커밋과 같아야 한다
    const diff = git(["diff", "--name-only", target, commit, "--", ".", `:(exclude)${KEEP_PATH}`]);

    if (diff.status !== 0 || diff.stdout.trim()) return fail(`만든 커밋이 ${target.slice(0, 7)} 와 다릅니다. 올리지 않았어요:\n${tail(diff.stdout || diff.stderr, 300)}`);
    // 일반 push(부모가 지금 main 이라 빨리감기). force push 가 아니다. 거절되면 그대로 멈춘다
    const p = git(["push", remoteName, `${commit}:refs/heads/main`], { timeout: 300_000 });

    if (p.status !== 0) return fail(`GitHub main 에 올리지 못했어요(거절됨 — force push 는 하지 않아요): ${errText(p)}`);
    log(`[정비 되돌리기] 되돌리기 커밋 ${commit.slice(0, 7)} 을 GitHub main 에 올렸어요(대상 ${target.slice(0, 7)}).`);
    // 로컬 main 도 따라간다(안 돼도 배포는 그 커밋으로 하므로 계속)
    if (git(["fetch", "-q", remoteName, "main"]).status === 0) git(["merge", "--ff-only", "-q", `${remoteName}/main`]);

    return { ok: true, commit, reused: false };
  } finally {
    try {
      fs.rmSync(tmpIndex, { force: true });
    } catch {
      /* 임시 파일이라 못 지워도 계속 */
    }
  }
}
