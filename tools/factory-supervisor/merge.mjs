// tools/factory-supervisor/merge.mjs
// 병행 일감 합치기(병렬화 단계 C-1). 끝난 일감을 하나씩 기본 브랜치(main 또는 master)에 합치고, 합칠 때마다 그 앱의 기존 검사(빌드·시험)를 돌린다.
//
// 한 번의 시도(앱 단위 'merge' 잠금 안에서, 다른 일감의 합치기와 겹치지 않음):
//   1) 앱 폴더가 기본 브랜치에 있고 깨끗한지 확인  2) 사본 브랜치에 최신 기본 브랜치를 합쳐 넣기(글자 충돌이면 충돌 표시를 남김)
//   3) 합친 상태에서 검사 실행  4) 통과하면 기본 브랜치를 사본 브랜치로 앞으로 감기(fast-forward only)
// 2) 에서 글자 충돌이 나거나 3) 에서 검사가 실패하면 그 일감의 AI 에게 '최신 기본 브랜치 기준으로 다시 맞추기'를 되돌려 보내고(askFix), 다시 시도한다.
// 다시 맞추기는 최대 maxRebases(기본 2)회. 그래도 안 되면 { ok:false } 를 돌려주고, 호출한 쪽이 그 일감만 '합치기 실패'로 멈추고 보고한다.
// 이미 합쳐진 다른 일감의 커밋은 건드리지 않는다. 이 파일은 push 를 하지 않는다.
import { FACTORY_FILES, commitAll, conflictFiles, currentBranch, dirtyCount, fastForwardBase, git, mergeBaseIntoBranch, mergeInProgress } from "./worktree.mjs";

export const MAX_REBASES = 2;
const AUTHOR = ["-c", "user.name=app-factory", "-c", "user.email=factory@localhost"];
const tail = (text, n = 1500) => String(text ?? "").trim().slice(-n);

/** AI 에게 되돌려 보낼 '다시 맞추기' 지시문 */
export function fixPrompt({ problem, base, request, attempt, max }) {
  const head = `[다시 맞추기 ${attempt}/${max}] 이 작업 사본(git worktree)의 일을 최신 기본 브랜치(${base}) 기준으로 다시 맞춰 주세요. 같은 앱의 다른 일감이 먼저 합쳐져서 생긴 문제예요. 새 기능을 더하지 말고, 이 일감의 원래 요청이 유지되면서 최신 ${base} 와 함께 동작하게만 하세요.`;
  const ask = request ? `\n\n## 이 일감의 원래 요청\n${String(request).slice(0, 2500)}` : "";

  if (problem.kind === "conflict") {
    return `${head}

## 문제: 글자 충돌
최신 ${base} 를 이 사본에 합치다가 아래 파일에서 충돌했어요. 파일 안의 <<<<<<< ======= >>>>>>> 표시를 지우고, 두 쪽의 변경이 모두 살아 있도록 고치세요.
${problem.files.map((f) => `- ${f}`).join("\n")}
해결한 파일은 git add 하고 \`git commit --no-edit\` 으로 합치기를 끝내세요. 브랜치를 바꾸거나 push 하지 마세요.${ask}`;
  }

  return `${head}

## 문제: 검사 실패
최신 ${base} 를 합친 상태에서 앱의 검사(빌드·시험)가 실패했어요. 원인을 찾아 고친 뒤, 같은 검사가 통과하는지 직접 확인하고 \`git add -A\` 와 \`git commit\` 으로 남기세요. 브랜치를 바꾸거나 push 하지 마세요.
\`\`\`
${tail(problem.reason)}
\`\`\`${ask}`;
}

/** 이 일감이 실제로 바꾼 파일 목록(공장이 폴더마다 쓰는 파일·.factory/ 는 뺀다). 못 구하면 빈 배열. 최대 200개 */
export function changedFiles(repoDir, base, branch) {
  const r = git(repoDir, ["diff", "--name-only", "--no-renames", base, branch]);

  if (!r.ok) return [];

  return r.stdout
    .split("\n")
    .map((f) => f.trim().split("\\").join("/"))
    .filter((f) => f && !f.startsWith(".factory/") && !FACTORY_FILES.includes(f))
    .slice(0, 200);
}

/**
 * 한 번의 합치기 시도. 잠금(ctx.withLock)을 얻은 뒤에 불러야 한다. 반환:
 *   { ok:true, checks } | { ok:false, problem:{ kind:'conflict'|'checks', ... } } | { ok:false, fatal:true, reason }
 */
async function attemptMerge(ctx) {
  const { repoDir, wtDir, base, branch, log } = ctx;

  const cur = currentBranch(repoDir);

  if (cur !== base) return { ok: false, fatal: true, reason: `앱 폴더가 기본 브랜치(${base})에 있지 않아요(지금: ${cur || "분리된 HEAD"}). 사람이 확인해야 해요.` };
  const dirty = dirtyCount(repoDir);

  if (dirty) return { ok: false, fatal: true, reason: `앱 폴더의 기본 브랜치(${base})에 커밋 안 된 변경 ${dirty}개가 있어 합칠 수 없어요. 사람이 정리해야 해요.` };

  // 앞선 다시 맞추기에서 충돌이 남아 있거나 합치기를 끝내지 않았으면 먼저 확인한다
  const left = conflictFiles(wtDir);

  if (left.length) return { ok: false, problem: { kind: "conflict", files: left } };
  if (mergeInProgress(wtDir)) git(wtDir, [...AUTHOR, "commit", "--no-edit"]);

  for (let tries = 0; tries < 3; tries++) {
    const m = mergeBaseIntoBranch(wtDir, base);

    if (!m.ok) {
      if (m.conflicts.length) return { ok: false, problem: { kind: "conflict", files: m.conflicts } };

      return { ok: false, fatal: true, reason: `최신 ${base} 를 사본에 합치지 못했어요: ${tail(m.output, 400)}` };
    }
    log("info", m.upToDate ? `기본 브랜치(${base})에 새로 합쳐진 게 없어요. 이 상태 그대로 검사해요.` : `최신 기본 브랜치(${base})를 이 일감 사본에 합쳤어요. 합친 상태로 검사해요.`);
    const v = await ctx.verify(wtDir);

    if (!v.ok) return { ok: false, problem: { kind: "checks", reason: v.reason } };
    const files = changedFiles(repoDir, base, branch); // 합치기 직전: 기본 브랜치를 이미 합쳐 넣은 상태라 base..branch 가 이 일감이 바꾼 파일이다
    const ff = fastForwardBase(repoDir, branch);

    if (ff.ok) return { ok: true, checks: `통과 (최신 기본 브랜치와 합친 상태에서 빌드·시험${Array.isArray(v.ran) && v.ran.length ? `: ${v.ran.join(" · ")}` : ""})`, files };
    log("warn", `기본 브랜치를 앞으로 감기(fast-forward)하지 못했어요(그 사이 기본 브랜치가 움직임). 다시 합쳐요: ${tail(ff.stderr || ff.stdout, 200)}`);
  }

  return { ok: false, fatal: true, reason: "기본 브랜치가 계속 움직여서 합치지 못했어요." };
}

/**
 * 합치기 전체 흐름(시도 → 실패하면 다시 맞추기 요청 → 다시 시도, 최대 maxRebases 회).
 * ctx: { job:{id,title}, repoDir, wtDir, branch, base, request, maxRebases,
 *        log(level,msg), report(patch)            — 병행 상태 보고(rebases·merging·mergedAt·checks)
 *        withLock(name, fn)                       — 앱 단위 잠금 안에서 fn 실행(기다리는 동안 '잠금 대기'를 알림)
 *        verify(dir) -> { ok, reason }            — 그 앱의 기존 검사(빌드 잠금은 verify 안에서)
 *        commit(message) -> boolean               — 키 파일 검사를 거치는 커밋(없으면 git add -A + commit)
 *        askFix(prompt, attempt) -> { ok, reason } — 그 일감 AI 에게 다시 맞추기를 되돌려 보냄 }
 * 반환: { ok:true, rebases, checks, mergedAt } | { ok:false, rebases, reason, problem }
 */
export async function mergeJob(ctx) {
  const max = ctx.maxRebases ?? MAX_REBASES;
  let rebases = 0;

  for (;;) {
    const unresolved = conflictFiles(ctx.wtDir).length > 0;

    if (!unresolved) commitAll(ctx.wtDir, `수정: ${ctx.job.title}`, ctx.commit); // 충돌이 남았으면 커밋하지 않는다(충돌 표시가 커밋되지 않게)

    const r = await ctx.withLock("merge", async () => {
      ctx.report({ merging: true });
      try {
        return await attemptMerge(ctx);
      } finally {
        ctx.report({ merging: false });
      }
    });

    if (r.ok) {
      const mergedAt = new Date().toISOString();

      ctx.report({ mergedAt, checks: r.checks, rebases, ...(r.files?.length ? { actualFiles: r.files } : {}) });

      return { ok: true, rebases, checks: r.checks, mergedAt, files: r.files ?? [] };
    }
    if (r.fatal) return { ok: false, rebases, reason: r.reason, problem: { kind: "fatal" } };

    const why = r.problem.kind === "conflict" ? `글자 충돌: ${r.problem.files.join(", ")}` : `검사 실패: ${tail(r.problem.reason, 400)}`;

    if (rebases >= max) return { ok: false, rebases, reason: `최신 ${ctx.base} 기준으로 ${rebases}번 다시 맞춰도 합치지 못했어요 — ${why}`, problem: r.problem };
    rebases++;
    ctx.report({ rebases });
    ctx.log("warn", `합치기 실패(${why}). 이 일감에게 최신 ${ctx.base} 기준으로 다시 맞추라고 되돌려 보내요 (${rebases}/${max}).`);

    const fix = await ctx.askFix(fixPrompt({ problem: r.problem, base: ctx.base, request: ctx.request, attempt: rebases, max }), rebases);

    if (!fix.ok) return { ok: false, rebases, reason: `다시 맞추기 중 작업이 끝나지 않았어요: ${fix.reason}`, problem: r.problem };
  }
}
