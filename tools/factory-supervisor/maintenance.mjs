// 앱 공장 감독 프로그램: 공장 정비(공장 자체 = 홈페이지·감독 프로그램 코드를 고치는 대화형 스레드)
// - /next 의 maintenance 를 받으면 정비 전용 체크아웃(~/dev/factory/selfdev)에서 Claude 를 돌린다. 앱·실험 일감이 돌고 있어도 같이 돈다
//   (정비는 앱 폴더를 건드리지 않는다. 겹치면 안 되는 건 감독 프로그램 업데이트·재시작·서버 배포 순간뿐이라 아래처럼 드레인으로 비킨다).
//   같은 정비의 이어지는 지시는 같은 Claude 세션에 이어서(--resume).
// - Claude 는 커밋만 하고, 올리기는 감독 프로그램이 검사(node --check, tsc 0 오류)를 통과했을 때만 한다(GitHub main).
// - /next 의 maintenanceDeploy 는 사람이 [배포]를 누른 것. 정해진 명령 하나(서버 배포 저장소로 그 커밋 push)만 실행한다.
//   서버가 보낸 것은 커밋 해시뿐이고, 그 커밋이 GitHub main 에 있는지 확인한 뒤에만 올린다.
//   배포는 진행 중인 앱·실험 일감이 있어도 시작하고, 새 일감 가져가기도 막지 않는다(1-1 D-1).
//   배포 중 홈페이지가 3~5분 응답하지 않는 동안의 보고·로그·하트비트·완료 보고·스크린샷 등록은 감독 프로그램의 재전송 대기열(outbox.mjs)이
//   쌓았다가 순서대로 다시 보낸다(요청 번호로 중복 처리 방지). 기다리는 건 두 가지뿐이다:
//   - 정비 지시가 도는 중이면 그게 끝난 뒤(보통 대기열이 끝난 뒤에야 배포 요청이 오므로 거의 없다)
//   - 큰 파일 업로드(영상·스크린샷 묶음·실험 결과)가 진행 중이면 그 업로드가 끝날 때까지, 최대 10분. 넘으면 배포하고 업로드는 다시 시도한다.
// - 정비 대기열(서버가 maintenance.deployBundling 을 보낼 때): 서버가 보낸 순서대로 하나씩 준다. 앞 지시가 검사 실패 등으로
//   로컬에만 남긴 커밋은 같은 정비 대화가 이어갈 때만 그 위에서 하고, 다른 대화의 지시면 백업 브랜치로 옮긴 뒤 origin/main 에서 시작한다.
//   배포 안내도 서버가 대기열 끝에 묶어서 하므로 결과 문구를 그에 맞춘다. 이 필드가 없으면(예전 서버) 예전 방식 그대로.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { acquireWorkspace, engineOf, ENGINE_LABELS, eventDecoder, excludeHarnessState, handoffPrompt, pendingChangesPolicy, recordLifecycle, redactAiText, saveHandoff, startAi } from "./ai-runner.mjs";
import { safeEnv } from "./envfilter.mjs";
import { keyFilesToCommit } from "./keyguard.mjs";
import { compactSession } from "./compact.mjs";
import { noteRateLimitEvent, refreshAfterTask } from "./ai-limits.mjs";
import { commandForLog, guardHookSettings, SERVER_ACCESS_RULES } from "./serveraccess.mjs";
import { BACKGROUND_FAIL_REASON, RESUME_MESSAGE, backgroundFailure, resumeFailed } from "./pause.mjs";
import { buildRevertCommit, migrationsChanged } from "./revert.mjs";

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
- 서버 설정(nginx, 서버 .env.local, 재빌드)은 오직 \`node "{{SERVERCTL}}" <서브커맨드>\` 로만 한다. 이 PC 에서 docker·sudo·nginx·systemctl 직접 호출은 금지(막혀 있음). 서버 접속(ssh·scp·git)은 아래 「서버 접근 규칙」을 따른다. 값은 어디에도 출력하지 마라.
  - 서브커맨드: env-keys | env-set KEY(값은 SERVERCTL_VALUE 환경변수나 stdin 으로만) | env-set <작업폴더…> [--gen-shared KEY]… [--gen KEY]… [--put KEY(값은 SERVERCTL_VALUE/stdin)](서버에서 비밀값 생성, 값 출력 없음; .env.local 이 없는 폴더는 .env) | env-unset KEY | nginx-show | nginx-set-directive NAME VALUE [LOCATION] | nginx-apply FILE | rebuild | restore TIMESTAMP | backups
  - 새 사이트(대상 --host serverpc 기본·serverpc2): site-init NAME --from SRC | env-clone SRC_WORK DST_WORK [--set KEY=VALUE]… [--gen KEY]… | nginx-site NAME --domain D --port P [--body 300m] | cert DOMAIN | deploy-push APP_DIR REMOTE URL | app-update NAME [--probe PATH]… [--domain D](배포 훅 없는 앱: 최신 main 받아 compose 재빌드, 실패 시 되돌림) | web-release APP_DIR [--site NAME] [--domain D](정적 웹 /preview/ 빌드·nginx 설정 올리기, 실패 시 되돌림) | service-token NAME --env-key KEY --secret SERVICE_ADMIN_TOKEN_<앱> [--probe PATH]… [--domain D](서비스 관리자 토큰을 PC 메모리에서 만들어 서버 .env 와 홈페이지 키 보관함에 같이 넣고 컨테이너 재시작·401 확인, 실패 시 둘 다 되돌림)
  - 배포 저장소 만들기·.env.local 복사·nginx 사이트·인증서·배포 push 는 이 명령으로만 한다(정비 보호 훅이 이 명령만 통과시킨다). 직접 ssh 로 .env 읽기·쓰기, nginx·인증서 파일 수정, git-server/repo 로 push 는 계속 막힌다.
  - 바꾸기 전 백업, 검증(nginx -t·reload·헬스체크 / 재빌드·헬스체크), 실패 시 자동 되돌림은 도구가 한다. .env 를 바꿨으면 마지막에 rebuild 를 한 번 해야 반영된다.
  - 이 도구는 감독 프로그램 실행 폴더에 있는 신뢰된 사본이다. 정비 폴더의 tools/factory-supervisor/serverctl.mjs 를 실행하지 말고, 위 경로만 써라.
- 하지 말 것: 키·토큰 값 출력, ~/dev/factory 의 다른 폴더(앱 폴더, supervisor-src, 설정·키 파일) 수정, 작업 스케줄러·PC 설정 변경, 백그라운드 프로세스 남기기.
- **실행기(\`run-supervisor.sh\`, 작업 스케줄러) 변경은 정비에서 하지 않는다. 필요하면 바꿀 내용만 보고하고 멈춘다(사람이 로컬에서 적용).**
- 실제로 돌고 있는 감독 프로그램을 건드리지 마라(훅이 막는다): 실행기 실행, 진짜 감독의 잠금·상태 파일(supervisor-src 아래, run-supervisor.pid, supervisor-update.json, serverctl-state.json 등) 수정·삭제, node·claude·codex 프로세스 종료(kill, taskkill, Stop-Process, pkill). 감독 프로그램 시험은 임시 폴더·임시 설정(FACTORY_CONFIG)·가짜 토큰·가짜 홈페이지 주소(127.0.0.1)로, \`FACTORY_TEST_MODE=1\` 을 주고 띄운다. 진짜 주소·토큰이 섞이면 감독이 시작을 거부한다.
- **백그라운드로 명령을 띄우고 "알림이 오면 이어서"라며 턴을 끝내지 마라.** 이 환경에는 알림이 오지 않는다. 오래 걸리는 시험·빌드도 이 턴 안에서 끝까지 기다린다(foreground 대기 반복). 커밋하지 않은 변경을 남긴 채 끝내면 정비는 '미완료(이어서 필요)'로 처리되고 대기열이 멈춘다.
- 마지막 응답은 한국어로 짧게: 바꾼 것, 커밋, 검사 결과, 서버 배포가 필요한지(서버 코드가 바뀌었는지), 사람이 할 일.

${SERVER_ACCESS_RULES}
`;

// 서버 설정 도구는 감독 프로그램이 돌고 있는 이 폴더(실행 전용 체크아웃)의 사본만 쓴다. 정비 폴더 사본은 Claude 가 고칠 수 있어서 쓰지 않는다.
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SERVERCTL = path.join(HERE, "serverctl.mjs").replace(/\\/g, "/");

const MAINTENANCE_GUARD_PATH = path.join(HERE, "maintenance-guard.mjs").replace(/\\/g, "/"); // 서버 접근 규칙 + 이 PC 보호 규칙(앱·실험은 ssh-guard.mjs 만 쓴다)

// 정비 Claude 권한: 서버 설정은 serverctl 로만. 이 PC 의 docker·sudo·nginx·systemctl 직접 호출, sftp·rsync, ~/.ssh 읽기, 감독 프로그램 실행 폴더 수정은 막는다.
// ssh·scp 는 우리 서버 두 대로만: 권한 규칙(prefix)으로는 호스트를 가릴 수 없어서 PreToolUse 훅(ssh-guard.mjs)이 판정한다.
export function maintenanceSettings(serverctl = SERVERCTL, guard) {
  const deny = ["sftp", "rsync", "docker", "docker-compose", "sudo", "nginx", "systemctl"].map((c) => `Bash(${c}:*)`);
  deny.push("Read(~/.ssh/**)", "Edit(~/dev/factory/supervisor-src/**)", "Write(~/dev/factory/supervisor-src/**)", "Edit(~/dev/factory/*.json)", "Write(~/dev/factory/*.json)");
  // 실제 감독 보호: 실행기 실행, 진짜 감독의 잠금·상태 파일 수정, node·claude·codex 프로세스 종료. 훅(maintenance-guard.mjs)이 명령 인자까지 보고, 이 목록은 그 앞의 방어선이다.
  for (const c of ["kill", "pkill", "killall", "taskkill", "Stop-Process", "schtasks", "bash run-supervisor.sh", "sh run-supervisor.sh", "./run-supervisor.sh", "run-supervisor.sh", "run-supervisor.cmd", "run-supervisor.ps1", "bash -l run-supervisor.sh"]) deny.push(`Bash(${c}:*)`);
  for (const f of ["run-supervisor*", "*.pid", "LOCK*", "*.log", ".locks/**", ".ai-locks/**"]) deny.push(`Edit(~/dev/factory/${f})`, `Write(~/dev/factory/${f})`);
  return { permissions: { allow: [`Bash(node ${serverctl}:*)`, `Bash(node "${serverctl}":*)`], deny }, hooks: guardHookSettings(guard ?? MAINTENANCE_GUARD_PATH) };
}

function permissionSettings() {
  const file = path.join(os.homedir(), "dev", "factory", "maintenance-claude-settings.json");
  fs.writeFileSync(file, JSON.stringify(maintenanceSettings(), null, 2));
  return file.replace(/\\/g, "/");
}

let current = null; // 진행 중인 정비 지시
let deploying = false;

let deployWait = false; // [배포]를 받았지만 정비 지시나 큰 업로드가 끝나길 기다리는 중
let uploadWaitSince = 0; // 큰 업로드를 기다리기 시작한 시각(0 = 기다리지 않음)
export const UPLOAD_WAIT_MAX_MS = 10 * 60_000; // 큰 업로드를 기다리는 최대 시간

export const maintenanceBusy = () => !!current || deploying; // 정비 지시나 배포가 도는 중(자동 업데이트·재시작 보류)
export const deployWaiting = () => deployWait && !deploying; // 배포 대기(정비 지시·큰 업로드가 끝나길 기다리는 중). 새 앱·실험 일감은 막지 않는다
export const deployHold = () => deployWait || deploying; // 배포를 기다리거나 하는 중: 새 정비 지시만 시작하지 않는다(앱·실험 일감은 계속 받는다)
export const deployRunning = () => deploying; // 서버 배포(git push·빌드·교체) 진행 중. 통제실 "배포 중" 표시용

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
    // 진행 중인 앱·실험 일감이 있어도 배포한다(보고는 재전송 대기열이 지켜 준다). 기다리는 건 정비 지시, 큰 업로드뿐(서버 응답은 배포를 시작하기 전까지 계속 같은 요청을 준다)
    const uploads = ctx.uploadBusy?.() ?? 0;
    if (uploads > 0 && !uploadWaitSince) uploadWaitSince = Date.now();
    if (uploads === 0) uploadWaitSince = 0;
    const uploadTimedOut = uploads > 0 && Date.now() - uploadWaitSince >= UPLOAD_WAIT_MAX_MS;
    if (current || (uploads > 0 && !uploadTimedOut)) {
      if (!deployWait) ctx.log(current ? "[정비 배포] 대기: 진행 중인 정비 지시가 끝나면 배포해요." : `[정비 배포] 대기: 큰 파일 업로드 ${uploads}개가 끝나면 배포해요(최대 10분).`);
      deployWait = true;
    } else {
      if (uploadTimedOut) ctx.log(`[정비 배포] 큰 파일 업로드가 10분 넘게 끝나지 않아 그대로 배포해요(업로드 ${uploads}개는 끊기면 다시 시도해요).`);
      deployWait = false;
      uploadWaitSince = 0;
      deploying = true;
      deploy(data.maintenanceDeploy, ctx).finally(() => (deploying = false));
    }
  } else if (!data?.maintenanceDeploy && deployWait) {
    ctx.log("[정비 배포] 대기 취소: 서버에 배포 요청이 더 없어요.");
    deployWait = false;
    uploadWaitSince = 0;
  }
  // 새 정비 지시는 배포 대기·배포 중, 감독 프로그램 업데이트·재시작 대기 중에는 시작하지 않는다(앱 일감은 상관없이 같이 돈다)
  if (data?.maintenance && !current && !deployHold() && !(ctx.updateDraining?.())) {
    current = data.maintenance;
    runTurn(data.maintenance, ctx)
      .catch((e) => ctx.log(`[정비] 예기치 못한 오류: ${e.stack || e.message}`))
      .finally(() => (current = null));
  }
}

/** 감독 프로그램 업데이트로 멈췄던 정비 턴을 같은 세션으로 이어 준다(supervisor.mjs 가 첫 대기열 확인이 성공한 뒤 부른다). 기다리지 않는다 */
export function resumeMaintenance(entry, ctx) {
  const m = entry.turn;
  if (!m?.turnId || current) return ctx.log("[정비] 업데이트 뒤 이어서 하기: 이어 줄 정비 지시를 시작하지 못했어요(이미 다른 정비가 돌고 있어요).");
  current = m;
  runTurn(m, ctx, entry)
    .catch((e) => ctx.log(`[정비] 예기치 못한 오류: ${e.stack || e.message}`))
    .finally(() => (current = null));
}

async function post(ctx, body) {
  try {
    // 정비 지시의 진행·결과 보고는 홈페이지가 응답하지 않을 때(서버 배포 중) 재전송 대기열에 쌓아 순서대로 다시 보낸다.
    // 시작(start)과 배포 시작·결과는 여기 오지 않고 직접 보낸다(배포 결과는 deploy() 가 받아들여질 때까지 다시 보낸다)
    if (ctx.outbox && body.action === "report") {
      const final = !!body.done;

      return await ctx.outbox.send({ kind: final ? "final" : body.logs?.length ? "report" : "heartbeat", path: "/api/factory/maintenance", body, jobId: `maint:${body.turnId}`, wait: final });
    }
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
  const pending = pendingChangesPolicy(m?.aiEngine, readUnpushed(dir)?.threadId, m?.threadId);
  // Failed Codex turns can leave only new files. They must not leak into another thread.
  const dirty = git(["status", "--porcelain", ...(pending.includeUntracked ? [] : ["--untracked-files=no"])]);
  const resumeDirty = !!dirty.stdout.trim() && pending.resumeOwnChanges;
  if (dirty.stdout.trim() && !resumeDirty) return `정비 폴더에 커밋 안 된 변경이 있어요:\n${tail(dirty.stdout, 500)}`;
  if (resumeDirty) notes.push("이 정비의 검증 실패 변경 파일을 보존한 상태로 이어갑니다. 원격 동기화는 변경 검사 후에 처리합니다.");
  const f = resumeDirty ? { status: 0 } : git(["fetch", "-q", "origin", "main"]);
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
  if (!resumeDirty && Number(behind) > 0) {
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
  if (!have.split(/\r?\n/).includes(".factory/ai-state.json")) fs.appendFileSync(ex, "\n.factory/ai-state.json\n.factory/ai-state.json.*.tmp\n");
  excludeHarnessState(dir);
  return null;
}

// 올리기 전 검사. 실패하면 이유 문자열.
function gate(dir, git, fromRef, workingTree = false) {
  const changed = (out(git(["diff", "--name-only", `${fromRef}..HEAD`])) || "").split("\n").filter(Boolean);
  if (workingTree) changed.push(...(out(git(["diff", "--name-only", "HEAD"])) || "").split("\n"), ...(out(git(["ls-files", "--others", "--exclude-standard"])) || "").split("\n"));
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

async function runTurn(m, ctx, resume = null) {
  let lock;
  m.aiStarted = !!resume; // 이어 주는 정비는 서버에 이미 시작을 알렸다
  const dir = path.resolve(expand(ctx.cfg.selfdevDir || "~/dev/factory/selfdev"));
  try {
    m.aiEngine = engineOf(m.aiEngine);
    lock = acquireWorkspace(dir, { engine: m.aiEngine, taskId: m.turnId });
    await runTurnUnlocked(m, ctx, lock, resume);
  } catch (e) {
    // Also turns lock/launch failures into visible queue failures, never silent fallback.
    if (!m.aiStarted) {
      const started = await post(ctx, { action: "start", turnId: m.turnId, aiEngine: m.aiEngine });
      if (started.status !== 200) return;
    }
    const message = ctx.redact ? ctx.redact(e.message) : redactAiText(e.message);
    await post(ctx, { action: "report", turnId: m.turnId, done: { ok: false, text: resume ? `다시 시작 필요: 업데이트로 멈춘 정비를 이어 주다 오류가 났어요. ${message}` : message } });
    ctx.log(`[정비] 실행 실패: ${message}`);
  } finally {
    lock?.release();
    ctx.pauser?.remove(`maint:${m.turnId}`);
    // 정비가 끝나면(성공·실패 모두) AI 한도를 한 번 새로 읽는다. 던지지 않고 15초 넘으면 기다리지 않음
    void refreshAfterTask({ log: (line) => ctx.log(`[정비] ${line}`) });
  }
}

async function runTurnUnlocked(m, ctx, lock, resume = null) {
  const { log, cfg } = ctx;
  const redact = ctx.redact || redactAiText;
  const dir = path.resolve(expand(cfg.selfdevDir || "~/dev/factory/selfdev"));
  const git = makeGit(dir);
  if (!resume) {
    const s = await post(ctx, { action: "start", turnId: m.turnId, aiEngine: m.aiEngine });
    if (s.status !== 200) return log(`[정비] 시작 거절(${s.status}): ${s.data?.message ?? ""}`);
  }
  m.aiStarted = true;
  // 승인 때 고른 모델(Claude Code 만, 허용 목록). 목록 밖이면 startAi 가 던져 실패로 보고된다
  const model = m.aiEngine === "claude" ? m.aiModel || null : null;
  log(`[정비] 시작: ${m.title} · ${ENGINE_LABELS[m.aiEngine]}${model ? ` · 모델 ${model}` : ""}${resume ? " (업데이트 뒤 이어서)" : m.sessionId ? " (이어서)" : ""}`);

  // 인계 기록에 남길 사실: 시작 때 HEAD 와 감독 프로그램이 직접 돌린 검사 결과(AI 의 말은 증거로 쓰지 않음)
  let startHead = null;
  const checks = [];
  const noteCheck = (name, result, detail) => checks.push({ name, result, ...(detail ? { detail } : {}) });
  let logs = [];
  const addLog = (t) => {
    const line = redact(t).replace(/\s+/g, " ").trim().slice(0, 1500);
    if (line) logs.push(line);
  };
  const flush = async () => {
    const batch = logs.splice(0, 50);
    const r = await post(ctx, { action: "report", turnId: m.turnId, logs: batch });
    if (r.status === 0) logs.unshift(...batch);
  };
  const finish = async (done) => {
    done.text = redact(done.text);
    recordLifecycle(dir, m.aiEngine, done.ok ? "done" : "failed", m.turnId);
    // 인계 기록(.factory/handoff.json): 사실은 여기서 채우고, 요청·남은 작업·주의는 AI 답변의 '## 인계' 블록에서. 실패한 지시도 남긴다
    try {
      const handoff = { kind: "maintenance", title: m.title, request: m.text, model, startHead: startHead || undefined, checks, failReason: done.ok ? undefined : done.text };
      done.handoff = saveHandoff(dir, { engine: m.aiEngine, taskId: m.turnId, threadId: m.threadId, sessionId: done.sessionId, status: done.ok ? "done" : "failed", summary: done.text, verification: done.pushedCommit ? "passed-before-push" : "see-result", handoff }, redact) ?? undefined;
    }
    catch (e) { addLog(`상태 인계 기록 실패: ${e.message}`); }
    // 성공한 지시만: 이 정비 대화가 이어 쓸 Claude 세션을 /compact 로 정리한다(완료 보고 전이라 다음 지시보다 먼저 끝난다). 실패해도 결과는 그대로
    if (done.ok) {
      const c = await compactSession({ engine: m.aiEngine, sessionId: done.sessionId, reusable: true, enabled: ctx.compactEnabled ? ctx.compactEnabled() : true, cwd: dir, cfg, settings: m.aiEngine === "claude" ? permissionSettings() : undefined, childEnv: safeEnv(process.env, { FACTORY_MAINTENANCE: m.threadId, FACTORY_MAINTENANCE_TURN: m.turnId }) });
      log(`[정비] ${c.line}`);
      done.text = `${done.text}\n— ${c.line}`;
    }
    await flush();
    for (let i = 1; i <= 4; i++) {
      const r = await post(ctx, { action: "report", turnId: m.turnId, done });
      if (r.status === 200 || r.status === 409 || r.status === 404) return log(`[정비] 끝: ${done.ok ? "완료" : "실패"}${done.pushedCommit ? ` (올림 ${short(done.pushedCommit)})` : ""}`);
      await new Promise((res) => setTimeout(res, 5000 * i));
    }
  };

  const prepNotes = [];
  if (resume) {
    // 업데이트로 멈춘 정비: 폴더·커밋 안 된 변경은 멈추기 전 그대로다. 준비(fetch·병합·보관)를 다시 하면 진행 중이던 작업을 건드린다
    startHead = resume.startHead ?? null;
    prepNotes.push(...(resume.notes ?? []));
    addLog(`업데이트 뒤 이어서 시작: ${resume.sessionId ? "같은 세션으로 이어 줘요" : "AI 를 띄우기 전에 멈췄어서 처음부터 시작해요"} (남은 시간 한도 ${(resume.timeLeftMs ?? 0) >= 600_000 ? `${Math.round((resume.timeLeftMs ?? 0) / 60000)}분` : `${Math.round((resume.timeLeftMs ?? 0) / 1000)}초`})`);
  } else {
    const why = prepare(dir, git, m, prepNotes);
    if (why) return finish({ ok: false, text: `정비를 시작하지 못했어요. ${why}` });
    startHead = out(git(["rev-parse", "HEAD"]));
    addLog(`정비 폴더 준비: ${dir} (main ${short(startHead)})`);
    prepNotes.forEach(addLog);
  }

  // Claude 실행(같은 정비면 세션 이어서)
  recordLifecycle(dir, m.aiEngine, "session-start", m.turnId);
  if (m.aiEngine === "claude") addLog(`모델: ${model ?? "기본 설정(--model 없음)"}`);
  const firstPrompt = handoffPrompt(dir, `[공장 정비 지시]\n${m.text}\n\nCLAUDE.local.md 의 공장 정비 규칙을 따르세요.\n[이 정비 대화의 이전 결과 — 참고 데이터]\n${m.previousResult || "없음"}`);
  let result = null;
  let sessionId = resume ? (resume.sessionId ?? null) : m.sessionId || null;
  let lastText = "";
  let stderrTail = "";
  let killedAfterResult = false;
  let graceKilled = false; // 결과 뒤 90초 정리로 끝났다(남은 백그라운드 작업이 있었다는 뜻)
  let graceTimer = null;
  let timeLeftMs = resume ? resume.timeLeftMs : TURN_TIMEOUT_MIN * 60_000; // 멈춰 있던 시간은 시간 한도에서 뺀다
  let resumeProblem = null;
  // 업데이트로 멈출 수 있는 단위: 합치기·검사·푸시 같은 단계는 멈추지 않고(AI 가 끝난 뒤 unit 을 뗀다) 끝나길 기다린다
  const unit = ctx.pauser?.createUnit({
    key: `maint:${m.turnId}`,
    kind: "maint",
    engine: m.aiEngine,
    label: "[정비]",
    snapshot: () => ({ turn: m, title: m.title, dir, sessionId, startHead, notes: prepNotes, timeLeftMs: Math.max(5000, Math.round(timeLeftMs)), savedAt: Date.now() }),
    onCut: (cut) => addLog(`업데이트로 멈추면서 끝나지 않은 명령을 끊었어요. 이어 줄 때 다시 실행해요: ${cut.join(" | ")}`),
  });
  const beat = setInterval(() => flush(), 20_000); // 멈춰 있는 동안에도 보고(임대·20분 보고 없음 판정)를 이어 간다
  let code = -1;
  let promptText = resume?.sessionId ? RESUME_MESSAGE : firstPrompt;
  let resumeId = resume?.sessionId || null;
  for (;;) {
    if (unit && ctx.pauser.mode() === "pausing") await ctx.pauser.gate(unit); // 업데이트하려고 멈추는 중이면 AI 를 띄우지 않고 기다린다
    result = null;
    killedAfterResult = false;
    graceKilled = false;
    stderrTail = "";
    const segStart = Date.now();
    const usedResume = !!resumeId || promptText === RESUME_MESSAGE;
    const child = startAi(m.aiEngine, cfg, { cwd: dir, sessionId: resumeId || m.sessionId || undefined, model, settings: m.aiEngine === "claude" ? permissionSettings() : undefined, env: safeEnv(process.env, { FACTORY_MAINTENANCE: m.threadId, FACTORY_MAINTENANCE_TURN: m.turnId }) });
    lock.setChild(child.pid || null);
    const decode = eventDecoder(m.aiEngine);
    const kill = () => {
      try {
        if (IS_WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        else process.kill(-child.pid, "SIGTERM");
      } catch {
        /* 이미 끝남 */
      }
    };
    unit?.attach(child, kill);
    child.stdin.on("error", () => {});
    child.stdin.end(promptText);
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      let ev;
      try {
        const raw = JSON.parse(line);
        unit?.feed(raw); // 끝나지 않은 도구 호출 추적(업데이트로 멈출 안전한 지점)
        ev = decode(raw);
      } catch {
        return addLog(line);
      }
      if (!ev) return;
      noteRateLimitEvent(ev);
      if (ev.session_id && typeof ev.session_id === "string") sessionId = ev.session_id;
      if (ev.type === "assistant") {
        for (const b of ev.message?.content ?? []) {
          if (b.type === "text" && b.text?.trim()) {
            lastText = b.text;
            addLog(b.text);
          } else if (b.type === "tool_use") {
            if (b.name === "Bash") addLog(`$ ${commandForLog(b.input?.command, 200)}`); // 서버 접속 명령은 줄이지 않고 남긴다
            else if (b.name === "Write" || b.name === "Edit") addLog(`${b.name}: ${String(b.input?.file_path ?? "").slice(0, 120)}`);
          }
        }
      } else if (ev.type === "result") {
        if (!result || result.is_error) result = ev;
        if (!ev.is_error && !graceTimer) {
          graceTimer = setTimeout(() => {
            if (child.exitCode === null) {
              killedAfterResult = true;
              graceKilled = true;
              addLog(`결과 뒤 ${RESULT_GRACE_SEC}초가 지나도 끝나지 않아 정리해요(남은 백그라운드 작업 종료).`);
              kill();
            }
          }, RESULT_GRACE_SEC * 1000);
        }
      }
    });
    child.stderr.on("data", (d) => (stderrTail = (stderrTail + d).slice(-2000)));
    const timer = setTimeout(() => {
      addLog(`시간 초과(${TURN_TIMEOUT_MIN}분)`);
      kill();
    }, Math.max(1000, timeLeftMs));
    code = await new Promise((res) => {
      child.on("error", (e) => {
        stderrTail += `\n실행 오류: ${e.message}`;
        res(-1);
      });
      child.on("close", (c) => res(c ?? -1));
    });
    clearTimeout(timer);
    clearTimeout(graceTimer);
    graceTimer = null;
    timeLeftMs = Math.max(0, timeLeftMs - (Date.now() - segStart));
    unit?.detach();
    if (unit?.paused && result && !result.is_error) {
      // 멈추라고 한 순간 이미 결과를 낸 턴: 멈춘 게 아니라 끝난 것으로 본다
      killedAfterResult = true;
      unit.resetPaused();
    }
    if (!unit?.paused && resumeFailed({ resumed: usedResume, events: unit?.tracker.events() ?? 0, result, code, ms: Date.now() - segStart, stopped: false })) {
      resumeProblem = (String(result?.result ?? "") || stderrTail.trim() || `코드 ${code}`).replace(/\s+/g, " ").slice(-300);
    }
    if (!unit?.paused || resumeProblem) break;
    // 업데이트 때문에 멈춘 것: 풀리면(업데이트를 못 했거나 새 버전이 켜지면) 같은 세션으로 이어 간다
    resumeId = sessionId;
    promptText = sessionId ? RESUME_MESSAGE : firstPrompt;
  }
  clearInterval(beat);
  ctx.pauser?.remove(`maint:${m.turnId}`);
  if (resumeProblem) {
    noteCheck("감독 문법·타입 검사", "건너뜀", "이어서 하기 실패");
    return finish({ ok: false, text: `다시 시작 필요: 업데이트로 멈춘 정비를 같은 세션으로 이어 주지 못했어요(${redact(resumeProblem)}). 정비 폴더의 파일은 그대로예요. 같은 정비 대화에 다시 지시해 주세요.`, sessionId });
  }

  const okRun = result && !result.is_error && (code === 0 || killedAfterResult);
  const claudeText = String(result?.result ?? lastText ?? "").trim();
  if (!okRun) {
    noteCheck("감독 문법·타입 검사", "건너뜀", "AI 실행이 정상 종료되지 않음");
    return finish({ ok: false, text: `${ENGINE_LABELS[m.aiEngine]}가 정상적으로 끝나지 않았어요(코드 ${code}${model ? `, 모델 ${model}` : ""}).\n${claudeText || tail(stderrTail, 1500)}`, sessionId });
  }

  // 백그라운드 명령을 기다리다 끝난 턴은 완료가 아니다(커밋·보고 없이 done 이 되던 문제): 실패로 남겨 통제실 할 일에 띄운다
  const bgFail = backgroundFailure({ text: claudeText, graceKilled });
  if (bgFail) {
    noteCheck("감독 문법·타입 검사", "건너뜀", bgFail);
    return finish({ ok: false, text: `${BACKGROUND_FAIL_REASON}
${claudeText}

— 정비 폴더 파일은 그대로예요. 같은 정비 대화에 "끊긴 명령을 전경에서 다시 실행하고 끝까지 기다린 뒤 커밋까지 마무리해 줘"라고 지시해 주세요.`, sessionId });
  }

  // 커밋 안 된 변경은 올리지 않고 따로 보관(다음 지시가 깨끗한 폴더에서 시작하게)
  const notes = [...prepNotes];
  let precheckedHead = null;
  // 로컬에만 남는 커밋이 있으면 어느 대화 것인지 적어 둔다(올리면 지운다)
  const keepLocal = () => writeUnpushed(dir, m, out(git(["rev-parse", "HEAD"])));
  if (m.aiEngine === "codex" && git(["status", "--porcelain"]).stdout.trim()) {
    // The trusted supervisor owns the local commit; Codex needs no broader Git permissions.
    const keys = keyFilesToCommit(dir);
    if (keys.length) { keepLocal(); return finish({ ok: false, text: `키 파일 커밋 차단: ${keys.join(", ")}`, sessionId }); }
    addLog("Codex 변경 검사: 통과하면 감독 프로그램이 로컬 커밋합니다.");
    await flush();
    const failure = gate(dir, git, out(git(["rev-parse", "origin/main"])) || startHead, true);
    noteCheck("감독 문법·타입 검사", failure ? "실패" : "통과", failure || undefined);
    if (failure) { keepLocal(); return finish({ ok: false, text: [claudeText, `검증 실패 — 변경 파일을 정비 폴더에 보존했어요.\n${failure}`].join("\n"), sessionId }); }
    const added = git(["add", "-A"]);
    const committed = added.status === 0 ? git(["commit", "-m", `공장 정비: ${m.title.slice(0, 80)}`]) : added;
    if (committed.status !== 0) { keepLocal(); return finish({ ok: false, text: `검사는 통과했지만 로컬 커밋에 실패했어요. 변경 파일은 보존돼요.\n${err(committed)}`, sessionId }); }
    precheckedHead = out(git(["rev-parse", "HEAD"]));
  }
  // 커밋 없이 끝났는데 폴더에 변경(새 파일 포함)이 남아 있으면 '완료'로 두지 않는다: 숨기지(stash) 않고 그대로 두고 미완료로 보고한다.
  // 실패 처리라 대기열이 멈추고 통제실 할 일·텔레그램에 '막힘'으로 알려진다. 같은 정비 대화에 '이어서' 지시하면 그 파일 위에서 계속한다
  const dirty = git(["status", "--porcelain"]).stdout.trim();
  if (dirty) {
    keepLocal();
    return finish({ ok: false, text: [claudeText, "", `— 미완료(이어서 필요): 정비 폴더에 커밋하지 않은 변경이 남아 있어요. 올리지 않았고 파일은 그대로 보존했어요. 같은 정비 대화에 "이어서 마무리하고 커밋해 줘"라고 지시해 주세요.\n${tail(dirty, 500)}`].join("\n"), sessionId });
  }

  git(["fetch", "-q", "origin", "main"]);
  const remoteBefore = out(git(["rev-parse", "origin/main"]));
  const newCommits = Number(out(git(["rev-list", "--count", "origin/main..HEAD"])) || 0);
  if (newCommits === 0) {
    writeUnpushed(dir, m, null);
    notes.push("코드 변경(새 커밋)이 없어서 GitHub 에 올릴 것이 없어요.");
    if (!checks.length) noteCheck("감독 문법·타입 검사", "건너뜀", "코드 변경(새 커밋) 없음");
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

  const blockedKeys = keyFilesToCommit(dir);
  if (blockedKeys.length) { keepLocal(); return finish({ ok: false, text: `키 파일 커밋 차단: ${blockedKeys.join(", ")}`, sessionId }); }
  addLog("검사: 감독 프로그램 문법, 타입 검사(tsc)…");
  await flush();
  const g = precheckedHead && precheckedHead === out(git(["rev-parse", "HEAD"])) ? null : gate(dir, git, remoteBefore);
  if (precheckedHead && !g && checks.length) { /* 위에서 이미 같은 검사를 통과 */ } else noteCheck("감독 문법·타입 검사", g ? "실패" : "통과", g || undefined);
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
  let commit = typeof d?.commit === "string" ? d.commit : "";
  const threadId = typeof d?.threadId === "string" ? d.threadId : "";
  if (!COMMIT_RE.test(commit) || !threadId) return;
  const revertTo = typeof d?.revertTo === "string" && COMMIT_RE.test(d.revertTo) ? d.revertTo : ""; // 배포 되돌리기(5-2): 이 커밋의 내용으로 되돌리는 커밋을 만들어 배포한다
  const dir = path.resolve(expand(cfg.selfdevDir || "~/dev/factory/selfdev"));
  const git = makeGit(dir);
  git(["fetch", "-q", "origin", "main"]);
  if (revertTo) {
    const s0 = await post(ctx, { action: "deploy_start", threadId, commit });
    if (s0.status !== 200) return log(`[정비 되돌리기] 시작 거절(${s0.status}): ${s0.data?.message ?? ""}`);
    log(`[정비 되돌리기] ${short(revertTo)} 버전 상태로 되돌리는 커밋을 만들어요.`);
    const made = buildRevertCommit({ dir, target: revertTo, log });
    if (!made.ok) {
      log(`[정비 되돌리기] 하지 않았어요: ${made.reason}`);
      await sendDeployDone(ctx, threadId, false, `되돌리기를 하지 않았어요. 서버는 그대로예요.\n${made.reason}`);
      return;
    }
    const rc = await post(ctx, { action: "deploy_revert_commit", threadId, from: revertTo, commit: made.commit });
    if (rc.status !== 200) {
      await sendDeployDone(ctx, threadId, false, `되돌리기 커밋(${short(made.commit)})은 만들었지만 홈페이지에 알리지 못해 배포하지 않았어요(${rc.status}). 서버는 그대로예요. [이전 버전으로]를 다시 누르면 이어서 해요.`);
      return;
    }
    commit = made.commit;
  } else {
    if (git(["merge-base", "--is-ancestor", commit, "origin/main"]).status !== 0) {
      log(`[정비 배포] ${short(commit)} 는 GitHub main 에 없는 커밋이라 배포하지 않아요.`);
      const s = await post(ctx, { action: "deploy_start", threadId, commit });
      if (s.status === 200) await post(ctx, { action: "deploy_done", threadId, ok: false, output: "GitHub main 에 없는 커밋이라 배포하지 않았어요." });
      return;
    }
    // 앞선 배포 대비 DB 마이그레이션이 바뀌었는지(배포 되돌리기를 막는 판단에 쓴다). 모르면 보내지 않는다
    const migrations = typeof d?.prevCommit === "string" ? migrationsChanged(git, d.prevCommit, commit) : null;
    const s = await post(ctx, { action: "deploy_start", threadId, commit, ...(typeof migrations === "boolean" ? { migrations } : {}) });
    if (s.status !== 200) return log(`[정비 배포] 시작 거절(${s.status}): ${s.data?.message ?? ""}`);
  }
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
  const sent = await sendDeployDone(ctx, threadId, ok, report);
  log(`[정비 배포] ${ok ? "완료" : "실패"} (${short(commit)}) ${summary}${sent ? "" : " — 결과를 홈페이지에 보고하지 못했어요"}`);
}

// 배포 결과 보고: 받아들여질 때까지 다시 보낸다(최대 5분). 받아들여졌으면 true
async function sendDeployDone(ctx, threadId, ok, output) {
  let sent = false;
  for (let i = 0; i < 20 && !sent; i++) {
    const r = await post(ctx, { action: "deploy_done", threadId, ok, output });
    sent = r.status === 200 || r.status === 404 || r.status === 409;
    if (!sent) await new Promise((res) => setTimeout(res, 15_000));
  }
  return sent;
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
