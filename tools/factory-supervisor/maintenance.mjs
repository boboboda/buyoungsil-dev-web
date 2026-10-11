// 앱 공장 감독 프로그램: 공장 정비(공장 자체 = 홈페이지·감독 프로그램 코드를 고치는 대화형 스레드)
// - /next 의 maintenance 를 받으면(돌던 앱 일감이 없을 때) 정비 전용 체크아웃(~/dev/factory/selfdev)에서 Claude 를 돌린다.
//   같은 정비의 이어지는 지시는 같은 Claude 세션에 이어서(--resume).
// - Claude 는 커밋만 하고, 올리기는 감독 프로그램이 검사(node --check, tsc 0 오류)를 통과했을 때만 한다(GitHub main).
// - /next 의 maintenanceDeploy 는 사람이 [배포]를 누른 것. 정해진 명령 하나(서버 배포 저장소로 그 커밋 push)만 실행한다.
//   서버가 보낸 것은 커밋 해시뿐이고, 그 커밋이 GitHub main 에 있는지 확인한 뒤에만 올린다.
// - 정비 대기열(서버가 maintenance.deployBundling 을 보낼 때): 서버가 보낸 순서대로 하나씩 준다. 앞 지시가 검사 실패 등으로
//   로컬에만 남긴 커밋은 같은 정비 대화가 이어갈 때만 그 위에서 하고, 다른 대화의 지시면 백업 브랜치로 옮긴 뒤 origin/main 에서 시작한다.
//   배포 안내도 서버가 대기열 끝에 묶어서 하므로 결과 문구를 그에 맞춘다. 이 필드가 없으면(예전 서버) 예전 방식 그대로.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const IS_WIN = process.platform === "win32";
const expand = (p) => (p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? path.join(os.homedir(), p.slice(1)) : p);
const COMMIT_RE = /^[0-9a-f]{7,40}$/;
const TURN_TIMEOUT_MIN = 90;
const RESULT_GRACE_SEC = 90;
const SUPERVISOR_DIR = "tools/factory-supervisor/";

// 정비 Claude 에게 주는 규칙. 정비 폴더의 CLAUDE.local.md 에 쓰고 .git/info/exclude 로 커밋에서 뺀다.
const RULES = `# 공장 정비 규칙 (감독 프로그램이 자동으로 쓰는 파일, 커밋되지 않음)

너는 앱 공장(부영실 홈페이지 buyoungsil-dev-web: Next.js 서버 + tools/factory-supervisor 감독 프로그램)의 정비 담당이다.
이 폴더는 정비 전용 체크아웃(main)이다. 사람이 홈페이지 통제실·채팅에서 보낸 정비 지시를 처리한다.

- 지시한 것만 고친다. 범위를 넓히지 말고, 모르는 건 합리적으로 가정해서 결과에 적는다. 사람에게 질문하지 않는다.
- 작업 단위마다 main 에 커밋한다(한국어 메시지). **push 와 배포는 하지 마라**(claude-backup 포함). 감독 프로그램이 검사를 통과하면 GitHub 에 올리고, 서버 배포는 사람이 [배포] 버튼으로 한다.
- 끝내기 전에 검사: \`npx tsc --noEmit -p .\` 오류 0개, \`node --check tools/factory-supervisor/*.mjs\`, 바꾼 부분은 가능하면 시험(가짜 서버·사본 등). 통과 못 하면 고쳐서 다시.
- DB 를 바꾸면 prisma/migrations 에 마이그레이션을 추가한다(컨테이너 시작 때 자동 적용). 기존 데이터를 지우는 마이그레이션 금지.
- 감독 프로그램(tools/factory-supervisor)을 바꾸면, 이 PC 의 감독 프로그램이 GitHub 에서 자동 업데이트로 받는다. 업데이트가 홈페이지 대기열 확인에 실패하면 되돌려지니, 폴링·보고 경로를 깨지 않게 조심한다.
- 서버 설정(nginx, 서버 .env.local, 재빌드)은 오직 \`node "{{SERVERCTL}}" <서브커맨드>\` 로만 한다. ssh·docker·sudo·nginx 직접 호출과 .env 직접 접근은 금지(막혀 있음). 값은 어디에도 출력하지 마라.
  - 서브커맨드: env-keys | env-set KEY(값은 SERVERCTL_VALUE 환경변수나 stdin 으로만) | env-unset KEY | nginx-show | nginx-set-directive NAME VALUE [LOCATION] | nginx-apply FILE | rebuild | restore TIMESTAMP | backups
  - 바꾸기 전 백업, 검증(nginx -t·reload·헬스체크 / 재빌드·헬스체크), 실패 시 자동 되돌림은 도구가 한다. .env 를 바꿨으면 마지막에 rebuild 를 한 번 해야 반영된다.
  - 이 도구는 감독 프로그램 실행 폴더에 있는 신뢰된 사본이다. 정비 폴더의 tools/factory-supervisor/serverctl.mjs 를 실행하지 말고, 위 경로만 써라.
- 하지 말 것: 키·토큰 값 출력, ~/dev/factory 의 다른 폴더(앱 폴더, supervisor-src, 설정·키 파일) 수정, 작업 스케줄러·PC 설정 변경, 백그라운드 프로세스 남기기.
- 마지막 응답은 한국어로 짧게: 바꾼 것, 커밋, 검사 결과, 서버 배포가 필요한지(서버 코드가 바뀌었는지), 사람이 할 일.
`;

// 서버 설정 도구는 감독 프로그램이 돌고 있는 이 폴더(실행 전용 체크아웃)의 사본만 쓴다. 정비 폴더 사본은 Claude 가 고칠 수 있어서 쓰지 않는다.
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SERVERCTL = path.join(HERE, "serverctl.mjs").replace(/\\/g, "/");

// 정비 Claude 권한: 서버 설정은 serverctl 로만. ssh·docker·sudo·nginx 직접 호출, ~/.ssh 읽기, 감독 프로그램 실행 폴더 수정은 막는다.
function permissionSettings() {
  const file = path.join(os.homedir(), "dev", "factory", "maintenance-claude-settings.json");
  const deny = ["ssh", "scp", "sftp", "rsync", "docker", "docker-compose", "sudo", "nginx", "systemctl"].map((c) => `Bash(${c}:*)`);
  deny.push("Read(~/.ssh/**)", "Edit(~/dev/factory/supervisor-src/**)", "Write(~/dev/factory/supervisor-src/**)", "Edit(~/dev/factory/*.json)", "Write(~/dev/factory/*.json)");
  fs.writeFileSync(file, JSON.stringify({ permissions: { allow: [`Bash(node ${SERVERCTL}:*)`, `Bash(node "${SERVERCTL}":*)`], deny } }, null, 2));
  return file.replace(/\\/g, "/");
}

let current = null; // 진행 중인 정비 지시
let deploying = false;

export const maintenanceBusy = () => !!current || deploying; // 정비 지시나 배포가 도는 중(자동 업데이트·재시작 보류)

const tail = (s, n) => String(s ?? "").replace(/\x1b\[[0-9;]*m/g, "").trim().slice(-n);
const short = (h) => (h ? h.slice(0, 7) : "?");

function makeGit(dir) {
  return (args, timeout = 120_000) =>
    spawnSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      timeout,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes" },
    });
}
const out = (r) => (r.status === 0 ? r.stdout.trim() : null);
const err = (r) => tail(r.error?.message || r.stderr || r.stdout || `코드 ${r.status}`, 800);

function run(cmd, args, dir, timeout = 600_000) {
  return spawnSync(cmd, args, { cwd: dir, encoding: "utf8", timeout, shell: IS_WIN, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
}

/** /next 응답(200)마다 부른다. 기다리지 않는다. */
export function onNext(data, ctx) {
  if (data?.maintenanceDeploy && !deploying) {
    deploying = true;
    deploy(data.maintenanceDeploy, ctx).finally(() => (deploying = false));
  }
  if (data?.maintenance && !current && ctx.runningApps() === 0) {
    current = data.maintenance;
    runTurn(data.maintenance, ctx)
      .catch((e) => ctx.log(`[정비] 예기치 못한 오류: ${e.stack || e.message}`))
      .finally(() => (current = null));
  }
}

async function post(ctx, body) {
  try {
    return await ctx.api("POST", "/api/factory/maintenance", body);
  } catch (e) {
    return { status: 0, data: { message: e.message } };
  }
}

// 로컬에만 남은(못 올린) 커밋이 어느 정비 대화 것인지 적어 두는 파일(.git 안이라 커밋되지 않음)
const unpushedFile = (dir) => path.join(dir, ".git", "factory-unpushed.json");
function readUnpushed(dir) {
  try {
    return JSON.parse(fs.readFileSync(unpushedFile(dir), "utf8"));
  } catch {
    return null;
  }
}
function writeUnpushed(dir, m, head) {
  try {
    if (head) fs.writeFileSync(unpushedFile(dir), JSON.stringify({ threadId: m.threadId, turnId: m.turnId, head, at: new Date().toISOString() }));
    else fs.rmSync(unpushedFile(dir), { force: true });
  } catch {
    /* 기록 못 해도 정비는 계속 */
  }
}

// 정비 폴더를 origin/main 최신으로(깨끗해야 함). 실패하면 이유 문자열. notes 에는 사람에게 알릴 것을 넣는다.
function prepare(dir, git, m, notes = []) {
  if (!fs.existsSync(path.join(dir, ".git"))) return `정비 폴더가 없어요: ${dir} (git clone 이 필요해요)`;
  if (out(git(["rev-parse", "--abbrev-ref", "HEAD"])) !== "main") return "정비 폴더가 main 브랜치가 아니에요.";
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]);
  if (dirty.stdout.trim()) return `정비 폴더에 커밋 안 된 변경이 있어요:\n${tail(dirty.stdout, 500)}`;
  const f = git(["fetch", "-q", "origin", "main"]);
  if (f.status !== 0) return `git fetch 실패: ${err(f)}`;
  // 로컬에만 있는 커밋(검사 실패로 못 올린 것)이 있으면 그 위에서 이어서 한다.
  // 대기열 서버에서는 다른 정비 대화가 남긴 것이면 백업 브랜치로 옮기고 origin/main 에서 시작한다(건너뛴 실패 지시의 커밋이 섞이지 않게).
  let ahead = out(git(["rev-list", "--count", "origin/main..HEAD"]));
  const left = readUnpushed(dir);
  if (m?.deployBundling && Number(ahead) > 0 && left?.threadId && left.threadId !== m.threadId) {
    const head = out(git(["rev-parse", "HEAD"]));
    const branch = `factory-unpushed/${String(left.turnId || Date.now()).replace(/[^A-Za-z0-9_-]/g, "")}`;
    const b = git(["branch", "-f", branch, "HEAD"]);
    if (b.status !== 0) return `못 올린 로컬 커밋을 백업하지 못했어요: ${err(b)}`;
    const r = git(["reset", "-q", "--hard", "origin/main"]);
    if (r.status !== 0) return `origin/main 으로 되돌리지 못했어요: ${err(r)}`;
    writeUnpushed(dir, m, null);
    notes.push(`다른 정비 대화가 못 올리고 남긴 로컬 커밋 ${ahead}개(${short(head)})는 정비 폴더의 ${branch} 브랜치로 옮겨 두고, GitHub main 최신에서 시작했어요.`);
    ahead = "0";
  }
  const behind = out(git(["rev-list", "--count", "HEAD..origin/main"]));
  if (Number(behind) > 0) {
    const r = Number(ahead) > 0 ? git(["rebase", "-q", "origin/main"]) : git(["merge", "-q", "--ff-only", "origin/main"]);
    if (r.status !== 0) {
      git(["rebase", "--abort"]);
      return `origin/main 을 받지 못했어요(충돌): ${err(r)}`;
    }
  }
  // 정비 규칙 파일(커밋되지 않게 로컬 제외 목록에)
  fs.writeFileSync(path.join(dir, "CLAUDE.local.md"), RULES.replace(/\{\{SERVERCTL\}\}/g, SERVERCTL));
  const ex = path.join(dir, ".git", "info", "exclude");
  const have = fs.existsSync(ex) ? fs.readFileSync(ex, "utf8") : "";
  if (!have.split(/\r?\n/).includes("CLAUDE.local.md")) fs.appendFileSync(ex, (have && !have.endsWith("\n") ? "\n" : "") + "CLAUDE.local.md\n");
  return null;
}

// 올리기 전 검사. 실패하면 이유 문자열.
function gate(dir, git, fromRef) {
  const changed = (out(git(["diff", "--name-only", `${fromRef}..HEAD`])) || "").split("\n").filter(Boolean);
  for (const f of fs.readdirSync(path.join(dir, SUPERVISOR_DIR)).filter((n) => n.endsWith(".mjs"))) {
    const c = spawnSync(process.execPath, ["--check", path.join(dir, SUPERVISOR_DIR, f)], { encoding: "utf8", windowsHide: true });
    if (c.status !== 0) return `감독 프로그램 문법 검사 실패(${f}):\n${tail(c.stderr, 800)}`;
  }
  if (changed.includes("package-lock.json") || !fs.existsSync(path.join(dir, "node_modules"))) {
    const r = run("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], dir, 900_000);
    if (r.status !== 0) return `npm ci 실패:\n${tail(r.stderr || r.stdout, 800)}`;
  }
  if (changed.some((f) => f.startsWith("prisma/"))) {
    const r = run("npx", ["prisma", "generate"], dir);
    if (r.status !== 0) return `prisma generate 실패:\n${tail(r.stderr || r.stdout, 800)}`;
  }
  if (!fs.existsSync(path.join(dir, "next-env.d.ts"))) {
    fs.writeFileSync(path.join(dir, "next-env.d.ts"), '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n');
  }
  // npx tsc 는 typescript 가 없으면 엉뚱한 "tsc" 패키지를 받아 오므로, 설치된 typescript 를 직접 실행한다
  const tscJs = path.join(dir, "node_modules", "typescript", "bin", "tsc");
  if (!fs.existsSync(tscJs)) return "typescript 가 설치돼 있지 않아요(정비 폴더에서 npm ci 필요).";
  const t = spawnSync(process.execPath, [tscJs, "--noEmit", "-p", "."], { cwd: dir, encoding: "utf8", timeout: 900_000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  const errors = `${t.stdout}\n${t.stderr}`.split("\n").filter((l) => l.includes("error TS"));
  if (t.status !== 0 || errors.length) return `타입 검사 실패(${errors.length}개):\n${tail(errors.slice(0, 15).join("\n"), 1500)}`;
  return null;
}

async function runTurn(m, ctx) {
  const { log, cfg } = ctx;
  const dir = path.resolve(expand(cfg.selfdevDir || "~/dev/factory/selfdev"));
  const git = makeGit(dir);
  const s = await post(ctx, { action: "start", turnId: m.turnId });
  if (s.status !== 200) return log(`[정비] 시작 거절(${s.status}): ${s.data?.message ?? ""}`);
  log(`[정비] 시작: ${m.title}${m.sessionId ? " (이어서)" : ""}`);

  let logs = [];
  const addLog = (t) => {
    const line = String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 1500);
    if (line) logs.push(line);
  };
  const flush = async () => {
    const batch = logs.splice(0, 50);
    const r = await post(ctx, { action: "report", turnId: m.turnId, logs: batch });
    if (r.status === 0) logs.unshift(...batch);
  };
  const finish = async (done) => {
    await flush();
    for (let i = 1; i <= 4; i++) {
      const r = await post(ctx, { action: "report", turnId: m.turnId, done });
      if (r.status === 200 || r.status === 409 || r.status === 404) return log(`[정비] 끝: ${done.ok ? "완료" : "실패"}${done.pushedCommit ? ` (올림 ${short(done.pushedCommit)})` : ""}`);
      await new Promise((res) => setTimeout(res, 5000 * i));
    }
  };

  const prepNotes = [];
  const why = prepare(dir, git, m, prepNotes);
  if (why) return finish({ ok: false, text: `정비를 시작하지 못했어요. ${why}` });
  const startHead = out(git(["rev-parse", "HEAD"]));
  addLog(`정비 폴더 준비: ${dir} (main ${short(startHead)})`);
  prepNotes.forEach(addLog);

  // Claude 실행(같은 정비면 세션 이어서)
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", cfg.permissionMode, "--allowedTools", cfg.allowedTools, "--settings", permissionSettings()];
  if (m.sessionId && /^[0-9a-f-]{8,64}$/i.test(m.sessionId)) args.push("--resume", m.sessionId);
  if (cfg.model) args.push("--model", cfg.model);
  const child = spawn(cfg.claudeCmd, args, { cwd: dir, env: { ...process.env, FACTORY_MAINTENANCE: m.threadId, FACTORY_MAINTENANCE_TURN: m.turnId }, shell: IS_WIN, detached: !IS_WIN, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.on("error", () => {});
  child.stdin.end(`[공장 정비 지시]\n${m.text}\n\nCLAUDE.local.md 의 공장 정비 규칙을 따르세요.`);

  let result = null;
  let sessionId = m.sessionId || null;
  let lastText = "";
  let stderrTail = "";
  let killedAfterResult = false;
  let graceTimer = null;
  const kill = () => {
    try {
      if (IS_WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      /* 이미 끝남 */
    }
  };
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return addLog(line);
    }
    if (ev.session_id && typeof ev.session_id === "string") sessionId = ev.session_id;
    if (ev.type === "assistant") {
      for (const b of ev.message?.content ?? []) {
        if (b.type === "text" && b.text?.trim()) {
          lastText = b.text;
          addLog(b.text);
        } else if (b.type === "tool_use") {
          if (b.name === "Bash") addLog(`$ ${String(b.input?.command ?? "").slice(0, 200)}`);
          else if (b.name === "Write" || b.name === "Edit") addLog(`${b.name}: ${String(b.input?.file_path ?? "").slice(0, 120)}`);
        }
      }
    } else if (ev.type === "result") {
      if (!result || result.is_error) result = ev;
      if (!ev.is_error && !graceTimer) {
        graceTimer = setTimeout(() => {
          if (child.exitCode === null) {
            killedAfterResult = true;
            addLog(`결과 뒤 ${RESULT_GRACE_SEC}초가 지나도 끝나지 않아 정리해요(남은 백그라운드 작업 종료).`);
            kill();
          }
        }, RESULT_GRACE_SEC * 1000);
      }
    }
  });
  child.stderr.on("data", (d) => (stderrTail = (stderrTail + d).slice(-2000)));
  const beat = setInterval(() => flush(), 20_000);
  const timer = setTimeout(() => {
    addLog(`시간 초과(${TURN_TIMEOUT_MIN}분)`);
    kill();
  }, TURN_TIMEOUT_MIN * 60_000);
  const code = await new Promise((res) => {
    child.on("error", (e) => {
      stderrTail += `\n실행 오류: ${e.message}`;
      res(-1);
    });
    child.on("close", (c) => res(c ?? -1));
  });
  clearInterval(beat);
  clearTimeout(timer);
  clearTimeout(graceTimer);

  const okRun = result && !result.is_error && (code === 0 || killedAfterResult);
  const claudeText = String(result?.result ?? lastText ?? "").trim();
  if (!okRun) {
    return finish({ ok: false, text: `Claude 가 정상적으로 끝나지 않았어요(코드 ${code}).\n${claudeText || tail(stderrTail, 1500)}`, sessionId });
  }

  // 커밋 안 된 변경은 올리지 않고 따로 보관(다음 지시가 깨끗한 폴더에서 시작하게)
  const notes = [...prepNotes];
  // 로컬에만 남는 커밋이 있으면 어느 대화 것인지 적어 둔다(올리면 지운다)
  const keepLocal = () => writeUnpushed(dir, m, out(git(["rev-parse", "HEAD"])));
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]).stdout.trim();
  if (dirty) {
    git(["stash", "push", "-m", `정비 ${m.turnId} 커밋 안 된 변경`]);
    notes.push(`커밋 안 된 변경이 있어서 올리지 않고 stash 로 보관했어요(정비 폴더 git stash list).`);
  }

  git(["fetch", "-q", "origin", "main"]);
  const remoteBefore = out(git(["rev-parse", "origin/main"]));
  const newCommits = Number(out(git(["rev-list", "--count", "origin/main..HEAD"])) || 0);
  if (newCommits === 0) {
    writeUnpushed(dir, m, null);
    notes.push("코드 변경(새 커밋)이 없어서 GitHub 에 올릴 것이 없어요.");
    return finish({ ok: true, text: [claudeText, "", ...notes.map((n) => `— ${n}`)].join("\n"), sessionId });
  }

  // origin 이 그새 앞서 갔으면 그 위로 옮긴다
  if (git(["merge-base", "--is-ancestor", "origin/main", "HEAD"]).status !== 0) {
    const r = git(["rebase", "-q", "origin/main"]);
    if (r.status !== 0) {
      git(["rebase", "--abort"]);
      keepLocal();
      notes.push(`GitHub main 이 그사이 바뀌어 합치다 충돌이 났어요. 올리지 않았어요(로컬 커밋 ${newCommits}개는 정비 폴더에 남아 있음). 이어서 "충돌 해결" 지시를 보내 주세요.\n${err(r)}`);
      return finish({ ok: false, text: [claudeText, "", ...notes.map((n) => `— ${n}`)].join("\n"), sessionId });
    }
  }

  addLog("검사: 감독 프로그램 문법, 타입 검사(tsc)…");
  await flush();
  const g = gate(dir, git, remoteBefore);
  if (g) {
    keepLocal();
    notes.push(`검사를 통과하지 못해 GitHub 에 올리지 않았어요(커밋 ${newCommits}개는 정비 폴더에 남아 있음). 이어서 고쳐 달라고 지시하면 그 위에서 이어 해요.\n${g}`);
    return finish({ ok: false, text: [claudeText, "", ...notes.map((n) => `— ${n}`)].join("\n"), sessionId });
  }

  const p = git(["push", "-q", "origin", "HEAD:main"]);
  if (p.status !== 0) {
    keepLocal();
    notes.push(`GitHub 에 올리지 못했어요: ${err(p)}`);
    return finish({ ok: false, text: [claudeText, "", ...notes.map((n) => `— ${n}`)].join("\n"), sessionId });
  }
  const pushed = out(git(["rev-parse", "HEAD"]));
  writeUnpushed(dir, m, null);
  const files = (out(git(["diff", "--name-only", `${remoteBefore}..${pushed}`])) || "").split("\n").filter(Boolean);
  const needsDeploy = files.some((f) => !f.startsWith(SUPERVISOR_DIR));
  const supervisorChanged = files.some((f) => f.startsWith(SUPERVISOR_DIR));
  notes.push(`검사 통과, GitHub main 에 올렸어요(${short(pushed)}, 커밋 ${newCommits}개, 파일 ${files.length}개).`);
  if (m.deployBundling) {
    // 대기열 서버: 배포는 대기열이 다 끝난 뒤 한 번에 안내한다
    const leftN = Number(m.queueLeft) || 0;
    notes.push(
      needsDeploy
        ? leftN > 0
          ? `서버 코드가 바뀌었어요. 정비 대기열(남은 ${leftN}개)이 모두 끝나면 '배포 필요'를 한 번에 안내해요.`
          : "서버 코드가 바뀌었어요. 정비 대기열이 끝나면 '배포 필요'(또는 켜 둔 경우 자동 배포)를 안내해요."
        : "서버 코드는 그대로라 이 지시로는 배포가 필요 없어요.",
    );
  } else {
    notes.push(needsDeploy ? "서버 코드가 바뀌어 배포가 필요해요. 통제실이나 텔레그램에서 [배포]를 눌러 주세요." : "서버 코드는 그대로라 배포는 필요 없어요.");
  }
  if (supervisorChanged) {
    notes.push("감독 프로그램 코드가 바뀌어 곧 자동 업데이트로 받아요.");
    ctx.requestUpdateNow();
  }
  await finish({ ok: true, text: [claudeText, "", ...notes.map((n) => `— ${n}`)].join("\n"), sessionId, pushedCommit: pushed, needsDeploy });
}

// 사람이 [배포]를 누른 것: 그 커밋을 서버 배포 저장소로 push(서버 훅이 빌드·교체). 정해진 명령 하나뿐이다.
async function deploy(d, ctx) {
  const { log, cfg } = ctx;
  const commit = typeof d?.commit === "string" ? d.commit : "";
  const threadId = typeof d?.threadId === "string" ? d.threadId : "";
  if (!COMMIT_RE.test(commit) || !threadId) return;
  const dir = path.resolve(expand(cfg.selfdevDir || "~/dev/factory/selfdev"));
  const git = makeGit(dir);
  git(["fetch", "-q", "origin", "main"]);
  if (git(["merge-base", "--is-ancestor", commit, "origin/main"]).status !== 0) {
    log(`[정비 배포] ${short(commit)} 는 GitHub main 에 없는 커밋이라 배포하지 않아요.`);
    const s = await post(ctx, { action: "deploy_start", threadId, commit });
    if (s.status === 200) await post(ctx, { action: "deploy_done", threadId, ok: false, output: "GitHub main 에 없는 커밋이라 배포하지 않았어요." });
    return;
  }
  const s = await post(ctx, { action: "deploy_start", threadId, commit });
  if (s.status !== 200) return log(`[정비 배포] 시작 거절(${s.status}): ${s.data?.message ?? ""}`);
  const remote = cfg.deployRemote || "serverpc:git-server/repo/developWeb.git";
  log(`[정비 배포] ${short(commit)} → ${remote}`);
  const output = await new Promise((res) => {
    const c = spawn("git", ["push", remote, `${commit}:refs/heads/main`], {
      cwd: dir,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes" },
    });
    let buf = "";
    c.stdout.on("data", (x) => (buf = (buf + x).slice(-20_000)));
    c.stderr.on("data", (x) => (buf = (buf + x).slice(-20_000)));
    const t = setTimeout(() => c.kill(), 20 * 60_000);
    c.on("close", (code) => {
      clearTimeout(t);
      res({ code, buf });
    });
    c.on("error", (e) => res({ code: -1, buf: e.message }));
  });
  const full = String(output.buf ?? "").replace(/\x1b\[[0-9;]*m/g, "");
  const upToDate = /Everything up-to-date/.test(full);
  // 성공은 "컨테이너 교체 완료"(또는 바꿀 게 없음)가 보일 때. 실패 문구는 로그 전체에서 찾는다
  const replaced = /Recreating developWeb \.\.\. done|developWeb is up-to-date|Creating developWeb \.\.\. done/.test(full);
  const failed = /Failed to compile|Type error|\[rejected\]|error: failed to push|ERROR: /i.test(full);
  let ok = output.code === 0 && !failed && (replaced || upToDate);
  // 배포하면 홈페이지 컨테이너가 바뀌므로, 다시 응답할 때까지 기다린 뒤 결과를 보낸다(바뀌는 중에 보내면 결과가 사라졌다)
  const h = ok ? await waitHealthy() : { ok: false, sec: 0 };
  if (ok && !h.ok) ok = false;
  const summary = upToDate
    ? "서버가 이미 이 커밋이라 바꿀 것이 없어요(Everything up-to-date)."
    : ok
      ? `빌드 성공, 컨테이너 교체, 홈페이지 헬스체크 200(교체 후 ${h.sec}초).`
      : output.code !== 0
        ? `push 실패(종료 코드 ${output.code}).`
        : failed
          ? "서버 빌드 실패(기존 컨테이너가 그대로 돌고 있어요)."
          : replaced
            ? `빌드·교체는 됐지만 홈페이지가 ${Math.round(HEALTH_WAIT_MS / 1000)}초 안에 200 을 주지 않아요.`
            : "배포 결과를 확인하지 못했어요(컨테이너 교체 표시가 없음).";
  const report = `${summary}\n\n--- 배포 로그 끝부분 ---\n${tail(full, ok ? 600 : 2500)}`;
  // 결과 보고는 받아들여질 때까지 다시 보낸다(최대 5분)
  let sent = false;
  for (let i = 0; i < 20 && !sent; i++) {
    const r = await post(ctx, { action: "deploy_done", threadId, ok, output: report });
    sent = r.status === 200 || r.status === 404 || r.status === 409;
    if (!sent) await new Promise((res) => setTimeout(res, 15_000));
  }
  log(`[정비 배포] ${ok ? "완료" : "실패"} (${short(commit)}) ${summary}${sent ? "" : " — 결과를 홈페이지에 보고하지 못했어요"}`);
}

// 홈페이지가 다시 200 을 줄 때까지 기다린다(브라우저 UA). 배포 직후 컨테이너가 바뀌는 동안은 502 가 난다.
const HEALTH_WAIT_MS = 3 * 60_000;
async function waitHealthy() {
  const start = Date.now();
  while (Date.now() - start < HEALTH_WAIT_MS) {
    try {
      const r = await fetch("https://www.buyoungsilcoding.com/", {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" },
        signal: AbortSignal.timeout(15_000),
      });
      if (r.status === 200) return { ok: true, sec: Math.round((Date.now() - start) / 1000) };
    } catch {
      /* 아직 바뀌는 중 */
    }
    await new Promise((res) => setTimeout(res, 5_000));
  }
  return { ok: false, sec: Math.round((Date.now() - start) / 1000) };
}
