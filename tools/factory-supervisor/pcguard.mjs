// 정비 Claude 의 "이 PC 보호" 규칙: 실제로 돌고 있는 감독 프로그램을 건드리는 명령을 막는다. (정비 전용 — 앱·실험 일감 권한은 그대로)
// 10-14 정비 중 시험용 감독·taskkill 로 진짜 감독이 6번 꺼져 일감이 끊긴 일의 재발 방지.
//   1) 실행기(run-supervisor.sh/.cmd/.ps1)·작업 스케줄러 실행, 시험이 아닌 감독 직접 실행
//   2) 진짜 감독의 잠금·상태·설정 파일 쓰기/삭제 (supervisor-src, run-supervisor.pid, supervisor-update.json, serverctl-state.json …)
//   3) 프로세스 종료 (kill, pkill, killall, taskkill, Stop-Process …)
// 한계: 명령줄에 드러난 것만 본다. 파이썬·노드 스크립트 파일/히어독 본문 안에서 하는 일은 못 본다(그래서 권한 deny 규칙·규칙 문서·시험 모드 거부와 겹쳐서 막는다).
import { base, splitCommands, unwrap } from "./serveraccess.mjs";
import { SUBCOMMANDS } from "./serverctl.mjs";

const TRUSTED_SERVERCTL = /(^|\/)supervisor-src\/tools\/factory-supervisor\/serverctl\.mjs$/i;

/**
 * 신뢰된 serverctl 호출인지: 감독 실행 폴더(supervisor-src)의 serverctl.mjs 를 node 로 부르는 단순 명령 하나뿐이고,
 * 정해진 서브커맨드이며, 다른 명령·치환($( )·``)·파이프·리다이렉트가 섞이지 않았을 때만 true.
 * 서버 작업(배포 저장소·.env.local·nginx·인증서·배포 push)은 이 경로로만 연다. 직접 ssh·scp 로 같은 일을 하면 계속 막는다.
 */
export function isTrustedServerctlCall(command) {
  const { cmds, subs } = splitCommands(command);
  if (subs.length || cmds.length !== 1 || cmds[0].stdin) return false;
  const raw = cmds[0].argv;
  if (raw.some((w) => /^[0-9]*[<>]+&?$|^&>{1,2}$/.test(w))) return false;
  const argv = unwrap(raw);
  if (!["node", "nodejs"].includes(base(argv[0] ?? ""))) return false;
  return TRUSTED_SERVERCTL.test(String(argv[1] ?? "").replace(/\\/g, "/")) && SUBCOMMANDS.includes(argv[2]);
}

export const PC_GUARD_NOTE = "실행기·작업 스케줄러 변경이나 진짜 감독 조작이 꼭 필요하면 바꿀 내용만 결과에 적고 멈추세요(사람이 로컬에서 적용해요).";

const READ_ONLY = new Set(["cat", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "rg", "ls", "dir", "wc", "file", "stat", "diff", "cmp", "sha256sum", "md5sum", "git", "bat", "type", "get-content", "select-string", "test", "[", "[[", "echo", "printf", "cut", "sort", "uniq", "nl", "od", "xxd", "realpath", "basename", "dirname"]);
const WRITERS = new Set(["rm", "mv", "cp", "ln", "install", "truncate", "dd", "touch", "chmod", "chown", "tee", "unlink", "rmdir", "del", "erase", "rd", "ren", "rename", "remove-item", "ri", "move-item", "mi", "copy-item", "ci", "set-content", "add-content", "clear-content", "out-file", "new-item", "ni", "rename-item", "set-itemproperty", "patch", "shred", "xcopy", "robocopy", "attrib", "icacls"]);
const INTERPRETERS = new Set(["node", "nodejs", "python", "python3", "py", "powershell", "pwsh", "perl", "ruby", "deno", "bun"]);
const KILLERS = new Set(["kill", "pkill", "killall", "taskkill", "tskill", "stop-process", "spps"]);
const SCHEDULER = new Set(["schtasks", "start-scheduledtask", "stop-scheduledtask", "enable-scheduledtask", "disable-scheduledtask", "register-scheduledtask", "unregister-scheduledtask", "set-scheduledtask"]);

const LAUNCHER_RE = /(^|[\\/])run-supervisor\.(sh|cmd|ps1|bat)$/i;
const norm = (w) => String(w).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

// 진짜 감독의 파일. 이름만으로 확실한 것은 어디에 있든, 흔한 이름은 공장 폴더(dev/factory/, ../) 아래일 때만 본다.
const UNIQUE_NAMES = "run-supervisor\\.(pid|sh|cmd|ps1|bat)|supervisor-update\\.json|supervisor-paused\\.json|serverctl-state\\.json|supervisor-restart\\.json";
const ROOT_CHILDREN = "supervisor-src|\\.locks|\\.ai-locks|lock|supervisor\\.config\\.json|supervisor(\\.prev)?\\.log|secrets\\.env(\\.bak)?|app-claude-settings\\.json|maintenance-claude-settings\\.json|\\.deploy-push\\.log";
const PROTECTED = [
  new RegExp(`(^|/)(${UNIQUE_NAMES})(/|$)`),
  new RegExp(`(^|/)dev/factory/(${ROOT_CHILDREN})(/|$)`),
  new RegExp(`^\\.\\./(${ROOT_CHILDREN})(/|$)`), // 정비 폴더(~/dev/factory/selfdev)에서 본 공장 폴더
  /(^|\/)supervisor-src\//,
];
export const isProtectedPath = (w) => {
  const s = norm(w).replace(/^["']|["']$/g, "");
  return PROTECTED.some((re) => re.test(s));
};

const INLINE_CODE_FLAG = /^(-e|-p|--eval|--print|-c|-command|-encodedcommand|-ec)$/i;
const KILL_TEXT = /(process\.kill\s*\(|\.kill\s*\(|os\.kill\s*\(|\bstop-process\b|\btaskkill\b|\bpkill\b|\bkillall\b|\.terminate\s*\(|call\s+terminate|\bwmic\b[^|;]*\bdelete\b)/i;
const WRITE_TEXT = /(writeFile|appendFile|rmSync|unlink|rename|truncate|copyFile|open\s*\(|shutil|os\.remove|remove-item|set-content|add-content|out-file|clear-content|new-item|>>?\s*\S)/i;

const hasRedirectOut = (raw) => raw.some((w) => /^[0-9]*>{1,2}&?$|^&>{1,2}$/.test(w));

/** 막을 이유(문자열) 또는 null */
function reasonFor(command, depth) {
  const text = String(command ?? "");
  if (!text.trim()) return null;
  if (depth > 4) return "명령이 너무 깊게 감싸져 있어 검사할 수 없어요";
  const { cmds, subs } = splitCommands(text);
  for (const sub of subs) {
    const r = reasonFor(sub, depth + 1);
    if (r) return r;
  }
  for (const { argv: raw } of cmds) {
    const argv = unwrap(raw);
    if (!argv.length) continue;
    const b = base(argv[0]);
    const args = argv.slice(1);

    // 셸·파워셸이 감싼 명령은 안쪽을 다시 본다
    if (["bash", "sh", "zsh", "dash"].includes(b)) {
      const ci = argv.findIndex((a, i) => i > 0 && /^-[a-zA-Z]*c$/.test(a));
      if (ci > 0) {
        const r = reasonFor(argv[ci + 1] ?? "", depth + 1);
        if (r) return r;
      }
    } else if (b === "powershell" || b === "pwsh" || b === "cmd") {
      const r = reasonFor(args.join(" "), depth + 1);
      if (r) return r;
    }

    // 3) 프로세스 종료
    if (KILLERS.has(b)) {
      if (b === "kill" && /^-(0|l|L)$/.test(args[0] ?? "")) continue; // 살아 있는지 보기·신호 목록은 괜찮다
      return `${argv[0]} 로 프로세스를 끌 수 없어요(node·claude·codex 가 진짜 감독일 수 있어요)`;
    }
    if (b === "wmic" && args.some((a) => /^(delete|call|terminate)$/i.test(a))) return "wmic 으로 프로세스를 끌 수 없어요";
    if (INTERPRETERS.has(b)) {
      const i = args.findIndex((a) => INLINE_CODE_FLAG.test(a));
      if (i >= 0) {
        const code = args.slice(i + 1).join(" ");
        if (KILL_TEXT.test(code)) return `${argv[0]} ${args[i]} 안에서 프로세스를 끌 수 없어요`;
        if (WRITE_TEXT.test(code) && code.split(/[\s'"`;,()=]+/).some(isProtectedPath)) return `${argv[0]} ${args[i]} 로 진짜 감독의 잠금·상태·설정 파일을 고칠 수 없어요`;
      }
    }

    // 1) 실행기·작업 스케줄러
    if (SCHEDULER.has(b)) return `작업 스케줄러(${argv[0]})는 정비에서 건드리지 않아요`;
    const mentionsLauncher = argv.some((a) => LAUNCHER_RE.test(norm(a)) || /appfactorysupervisor/i.test(a));
    if (mentionsLauncher && !READ_ONLY.has(b) && !(["sed", "awk"].includes(b) && !args.some((a) => /^-[a-z]*i|^--in-place/.test(a)))) {
      return "실행기(run-supervisor)는 정비에서 실행하거나 바꾸지 않아요";
    }
    // 시험이 아닌 감독 직접 실행: 임시 설정(FACTORY_CONFIG)과 FACTORY_TEST_MODE=1 이 둘 다 있어야 한다
    if ((b === "node" || b === "nodejs") && args.some((a) => /(^|[\\/])supervisor\.mjs$/i.test(a)) && !args.some((a) => /^(--check|-c|--test)$/.test(a))) {
      const ok = /\bFACTORY_TEST_MODE=1\b/.test(text) && /\bFACTORY_CONFIG=\S+/.test(text);
      if (!ok) return "감독 프로그램(supervisor.mjs)을 직접 띄우려면 FACTORY_TEST_MODE=1 과 임시 폴더의 FACTORY_CONFIG 가 있어야 해요(진짜 감독 보호)";
    }

    // 2) 진짜 감독의 잠금·상태·설정 파일 쓰기/삭제
    const touchesProtected = raw.some(isProtectedPath);
    if (touchesProtected) {
      const sedInPlace = (b === "sed" || b === "perl") && args.some((a) => /^-[a-z]*i|^--in-place/.test(a));
      if (WRITERS.has(b) || sedInPlace || hasRedirectOut(raw) || (b === "find" && args.some((a) => /^-(delete|exec|execdir)$/.test(a)))) {
        return "진짜 감독의 잠금·상태·설정 파일(supervisor-src, run-supervisor.pid, supervisor-update.json, serverctl-state.json 등)은 고치거나 지울 수 없어요";
      }
    }
  }
  return null;
}

/** Bash 명령 문자열 검사: { decision: "allow" } | { decision: "deny", reason } */
export function checkLocalCommand(command) {
  const r = reasonFor(command, 0);
  return r ? { decision: "deny", reason: `${r}. ${PC_GUARD_NOTE}` } : { decision: "allow" };
}
