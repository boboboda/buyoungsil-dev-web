// tools/factory-supervisor/serveraccess.mjs
// 공장 AI 세션(정비·앱·출시·실험)의 서버 접근 규칙: 우리 서버 두 대(serverpc·serverpc2)로 가는 ssh·scp·git 만 허용하고,
// 서버에서 지우기·강제 덮어쓰기·서비스 중단·설정/비밀 파일 수정은 막는다.
// - checkCommand: Bash 명령 한 줄을 검사해 { decision: "allow" | "deny", reason } 을 돌려준다(순수 함수, 시험 대상).
// - guardHookSettings: Claude Code --settings 에 넣는 PreToolUse 훅(ssh-guard.mjs). 권한 규칙(prefix)으로는 "이 호스트만"을 못 걸어서 훅으로 건다.
// - 이 검사는 명령 문자열을 읽는 안전장치다. 스크립트 파일·다른 언어에서 ssh 를 띄우는 우회까지 막는 격리 장치는 아니다.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_HOSTS = ["serverpc", "serverpc2"]; // ~/.ssh/config 의 서버1·서버2 별칭

// 훅 스크립트: 이 모듈과 같은 폴더의 사본. 감독 프로그램은 실행 전용 체크아웃(supervisor-src)에서 돌아서 AI 세션이 고칠 수 없다
export const GUARD_PATH = fileURLToPath(new URL("./ssh-guard.mjs", import.meta.url)).replace(/\\/g, "/");

// 규칙 문서(정비 CLAUDE.local.md·앱 CLAUDE.md 블록·실험 지시문)에 넣는 절. 훅이 막는 목록과 같게 유지한다.
export const SERVER_ACCESS_RULES = `## 서버 접근 규칙
- 접속해도 되는 곳: \`~/.ssh/config\` 의 우리 서버 두 대만 — \`serverpc\`(서버1), \`serverpc2\`(서버2). 그 밖의 호스트로 가는 ssh·scp 는 막혀 있다.
- 쓸 수 있는 것: \`ssh -o BatchMode=yes <서버> "<명령>"\`, \`scp\`, git(ssh 원격 포함). sftp·rsync 는 쓰지 않는다. 원격 명령은 인자로 직접 적는다(표준입력으로 스크립트 보내기·eval·base64 디코드 실행 금지).
- 하지 말 것(감독 프로그램 훅이 막는다):
  - 서버에서 지우기: \`rm -rf\`(예외: \`~/studio-upload/<이름>\` 바로 아래 한 단계 폴더만),\`git-server\` 아래 저장소 삭제·이름 변경
  - 강제 덮어쓰기: \`git push --force\`/\`-f\`(\`--force-with-lease\`·\`+\`refspec 포함), 원격 브랜치 삭제, 서버 저장소에서 \`git reset --hard\`
  - 서비스 중단: \`docker compose down\`, \`docker rm\`, \`docker system prune\` 같은 prune, \`systemctl stop\`/\`disable\`, \`reboot\`, \`shutdown\`
  - 서버 설정·비밀: nginx 설정 수정, \`.env\` 읽기·수정, 인증서·키 파일, \`~/.ssh\` 아래 파일, crontab 수정
  - 배포 저장소(\`git-server/repo/\`)로 push — 서버 배포는 통제실 [배포]로만
- 위 일이 꼭 필요하면 직접 하지 말고, 실행할 명령과 이유를 결과에 적고 멈춘다(사람이 실행한다).
- 실행한 ssh·scp 명령은 일감 로그에 그대로 남는다. 키·토큰 값을 명령에 넣지 않는다.
- Codex 로 실행 중이면 샌드박스가 네트워크를 막아 ssh 가 안 될 수 있다. 그때는 필요한 명령을 결과에 적는다.`;

// 서버에서 `rm -rf` 를 허용하는 폴더 목록(사람이 늘리고 줄이는 곳). 항목 바로 아래 한 단계 폴더만 허용한다(그 폴더 자체·더 깊은 경로·글로브·변수·..은 계속 막는다).
// data/·git-server/·repo/·DB·릴리스·.env·백업 아래는 여기에 넣지 않는다.
export const RM_RF_ALLOWED_PARENTS = ["~/studio-upload"];

const RM_RF_CHILD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RM_RF_NOTE = "허용 경로는 " + RM_RF_ALLOWED_PARENTS.map((p) => p + "/<이름>").join(", ") + " 뿐이에요";

/** rm -rf 의 대상 인자가 허용 목록의 바로 아래 한 단계 폴더 하나뿐인지 */
function rmRfAllowed(args) {
  const targets = args.filter((a) => !a.startsWith("-"));
  if (targets.length !== 1 || args.includes("--")) return false;
  const t = targets[0];
  return RM_RF_ALLOWED_PARENTS.some((p) => {
    if (!t.startsWith(p + "/")) return false;
    const name = t.slice(p.length + 1);
    return name !== ".." && name !== "." && RM_RF_CHILD_NAME.test(name);
  });
}

const STOP_NOTE = "꼭 필요하면 실행할 명령과 이유를 결과에 적고 멈추세요(사람이 실행해요).";

// ───────── 셸 명령 읽기 (bash 문법의 근사) ─────────

/**
 * 명령 문자열을 단순 명령(argv 배열) 목록으로 나눈다. 따옴표·역슬래시를 풀고 ; && || | & 줄바꿈 ( ) 에서 끊는다.
 * $( … )·`…` 안의 명령은 subs 로 따로 모은다(따로 검사). redirects: 그 명령에 < 나 << 입력이 붙었는지.
 */
export function splitCommands(text) {
  const cmds = [];
  const subs = [];
  let words = [];
  let word = null;
  let stdin = false;
  const s = String(text ?? "");
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCmd = () => {
    endWord();
    if (words.length) cmds.push({ argv: words, stdin });
    words = [];
    stdin = false;
  };
  const grabSub = (i, open, close) => {
    // i 는 여는 문자 다음 위치. 짝이 맞는 닫는 문자까지(따옴표 안은 건너뜀) 잘라 subs 에 넣고 끝 위치를 돌려준다
    let depth = 1;
    let q = null;
    let j = i;
    for (; j < s.length; j++) {
      const c = s[j];
      if (q) {
        if (c === "\\" && q === '"') j++;
        else if (c === q) q = null;
        continue;
      }
      if (c === "'" || c === '"') q = c;
      else if (c === "\\") j++;
      else if (open && c === open) depth++;
      else if (c === close && --depth === 0) break;
    }
    subs.push(s.slice(i, j));
    return j;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      if (s[i + 1] === "\n") { i++; continue; }
      word = (word ?? "") + (s[i + 1] ?? "");
      i++;
    } else if (c === "'") {
      const j = s.indexOf("'", i + 1);
      word = (word ?? "") + s.slice(i + 1, j < 0 ? s.length : j);
      i = j < 0 ? s.length : j;
    } else if (c === '"') {
      let j = i + 1;
      let buf = "";
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === "\\" && j + 1 < s.length && '"\\$`\n'.includes(s[j + 1])) { buf += s[j + 1]; j++; }
        else if (s[j] === "$" && s[j + 1] === "(") { const e = grabSub(j + 2, "(", ")"); buf += s.slice(j, e + 1); j = e; }
        else if (s[j] === "`") { const e = grabSub(j + 1, null, "`"); buf += s.slice(j, e + 1); j = e; }
        else buf += s[j];
      }
      word = (word ?? "") + buf;
      i = j;
    } else if (c === "$" && s[i + 1] === "(") {
      const e = grabSub(i + 2, "(", ")");
      word = (word ?? "") + s.slice(i, e + 1);
      i = e;
    } else if (c === "`") {
      const e = grabSub(i + 1, null, "`");
      word = (word ?? "") + s.slice(i, e + 1);
      i = e;
    } else if (c === "#" && word === null) {
      while (i < s.length && s[i] !== "\n") i++;
      endCmd();
    } else if (/[ \t\r]/.test(c)) {
      endWord();
    } else if (c === "\n" || c === ";" || c === "&" || c === "|" || c === "(" || c === ")") {
      if (c === "|" && s[i + 1] !== "|") {
        endCmd();
        stdin = true; // 파이프 다음 명령은 표준입력을 받는다
        continue;
      }
      if ((c === "&" || c === "|") && s[i + 1] === c) i++;
      endCmd();
    } else if (c === "<" || c === ">") {
      endWord();
      if (c === "<") stdin = true;
      let op = c;
      while (s[i + 1] === "<" || s[i + 1] === ">" || s[i + 1] === "&") op += s[++i];
      words.push(op);
    } else {
      word = (word ?? "") + c;
    }
  }
  endCmd();
  return { cmds, subs };
}

export const base = (w) => path.basename(String(w)).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

// env·command·exec·nohup·timeout·time 같은 앞붙이를 벗긴 실제 명령 argv
export function unwrap(argv) {
  let a = argv;
  for (let guard = 0; guard < 8 && a.length; guard++) {
    while (a.length && ENV_ASSIGN.test(a[0])) a = a.slice(1);
    const b = a.length ? base(a[0]) : "";
    if (b === "env") { a = a.slice(1); while (a.length && (a[0].startsWith("-") || ENV_ASSIGN.test(a[0]))) a = a.slice(1); continue; }
    if (b === "command" || b === "exec" || b === "nohup" || b === "time" || b === "builtin") { a = a.slice(1); while (a.length && a[0].startsWith("-")) a = a.slice(1); continue; }
    if (b === "timeout") { a = a.slice(1); while (a.length && a[0].startsWith("-")) a = a.slice(1); a = a.slice(1); continue; }
    break;
  }
  // 리다이렉트 대상(> file)은 argv 에서 뺀다
  const out = [];
  for (let i = 0; i < a.length; i++) {
    if (/^[<>&]+$/.test(a[i])) { i++; continue; }
    out.push(a[i]);
  }
  return out;
}

// ───────── 원격 명령·경로 검사 ─────────

const WRITE_HINT = /(>|\btee\b|\bsed\s+(-[a-z]*i|--in-place)|\bperl\s+-[a-z]*i|\b(cp|mv|rm|ln|install|truncate|dd|patch|chmod|chown|vi|vim|nano|ed|unlink)\b)/i;
const ENV_FILE = /(^|[\s/'"=:])\.env(\.[\w.-]+)?($|[\s'";|&)/])/i;
const SECRET_PATH = /(\.ssh(\/|\b)|authorized_keys|id_(rsa|ed25519|ecdsa|dsa)\b|letsencrypt|\/etc\/ssl\/|\.pem\b|\.key\b|\.p12\b|\.pfx\b|\.jks\b|\.keystore\b|\bcertbot\b)/i;
const NGINX_CONF = /(\/etc\/nginx|nginx\.conf|sites-(available|enabled)|conf\.d\/)/i;

/** 서버 경로(원격 명령 문자열이나 scp 원격 경로)가 설정·비밀 파일을 건드리는지 */
function sensitiveReason(text, { write = WRITE_HINT.test(text) } = {}) {
  if (ENV_FILE.test(text)) return ".env 파일은 읽거나 고치지 않아요(키 값은 통제실에서 관리해요)";
  if (SECRET_PATH.test(text)) return "인증서·키·~/.ssh 아래 파일은 건드리지 않아요";
  if (NGINX_CONF.test(text) && write) return "nginx 설정은 고치지 않아요";
  if (/(^|[\s;|&])crontab\b/.test(text) && !/crontab\s+-l\b/.test(text)) return "crontab 은 고치지 않아요(crontab -l 로 보기만)";
  if (/\/etc\/cron/i.test(text) && write) return "cron 설정은 고치지 않아요";
  return null;
}

/** git 명령 argv(맨 앞 git 포함) 검사. 원격이 우리 서버가 아니어도(예: GitHub) 강제 push·원격 브랜치 삭제는 막는다 */
function gitReason(argv, { remote = false } = {}) {
  let i = 1;
  while (i < argv.length && argv[i].startsWith("-")) {
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(argv[i])) i += 2;
    else i += 1;
  }
  const sub = argv[i];
  const rest = argv.slice(i + 1);
  if (sub === "push") {
    if (rest.some((a) => /^(-f|--force|--force-with-lease(=.*)?|--force-if-includes|--mirror|--delete|-d|--prune)$/.test(a) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a)))
      return "강제 push·원격 브랜치 삭제는 하지 않아요";
    if (rest.some((a) => !a.startsWith("-") && (/^\+/.test(a) || /^:[^/]/.test(a) || /:\+/.test(a))))
      return "강제 push(+refspec)·원격 브랜치 삭제(:branch)는 하지 않아요";
    if (rest.some((a) => /git-server\/repo\//.test(a))) return "배포 저장소(git-server/repo/)로 push 하지 않아요 — 서버 배포는 통제실 [배포]로만 해요";
  }
  if (remote && sub === "reset" && rest.includes("--hard")) return "서버 저장소에서 git reset --hard 는 하지 않아요";
  if (remote && sub === "update-ref" && rest.includes("-d")) return "서버 저장소의 ref 를 지우지 않아요";
  if (remote && sub === "branch" && rest.some((a) => /^-[a-zA-Z]*D/.test(a) || a === "--delete")) return "서버 저장소의 브랜치를 지우지 않아요";
  return null;
}

/** 서버에서 실행할 명령 문자열 검사 */
export function remoteReason(text, depth = 0) {
  const t = String(text ?? "");
  if (depth > 4) return "명령이 너무 깊게 감싸져 있어 검사할 수 없어요";
  if (/\beval\b/.test(t) || /base64\s+(-[a-zA-Z]*d|--decode)/.test(t) || /\bxxd\s+-r/.test(t) || /\\x[0-9a-f]{2}/i.test(t))
    return "eval·인코딩된 원격 명령은 검사할 수 없어 허용하지 않아요";
  const sens = sensitiveReason(t);
  if (sens) return sens;
  const { cmds, subs } = splitCommands(t);
  for (const sub of subs) {
    const r = remoteReason(sub, depth + 1);
    if (r) return r;
  }
  for (const { argv: raw, stdin } of cmds) {
    const argv = unwrap(raw.filter((w) => !/^sudo$/i.test(w)));
    if (!argv.length) continue;
    const b = base(argv[0]);
    const args = argv.slice(1);
    if (b === "rm") {
      const flags = args.filter((a) => a.startsWith("-"));
      const rec = flags.some((f) => f === "--recursive" || (/^-[a-zA-Z]+$/.test(f) && /r/i.test(f)));
      const force = flags.some((f) => f === "--force" || (/^-[a-zA-Z]+$/.test(f) && f.includes("f")));
      if (rec && force && !rmRfAllowed(args)) return `서버에서 rm -rf 는 하지 않아요. ${RM_RF_NOTE}`;
      if (args.some((a) => /git-server/.test(a))) return "git-server 아래 저장소는 지우지 않아요";
    }
    if ((b === "mv" || b === "rmdir" || b === "unlink" || b === "shred") && args.some((a) => /git-server/.test(a))) return "git-server 아래 저장소는 지우거나 이름을 바꾸지 않아요";
    if (b === "find" && args.includes("-delete")) return "서버에서 find -delete 로 지우지 않아요";
    if (b === "git") {
      const r = gitReason(argv, { remote: true });
      if (r) return r;
    }
    if (b === "docker" || b === "docker-compose" || b === "podman") {
      const words = args.filter((a) => !a.startsWith("-"));
      const has = (...w) => w.every((x) => words.includes(x));
      if ((b === "docker-compose" || has("compose")) && words.some((w) => ["down", "rm", "kill", "stop"].includes(w))) return "docker compose down/stop/rm 같은 서비스 중단은 하지 않아요";
      if (words.includes("prune")) return "docker prune 은 하지 않아요";
      if (["rm", "rmi", "kill", "stop"].includes(words[0]) || (["container", "volume", "image", "network"].includes(words[0]) && ["rm", "remove", "kill", "stop"].includes(words[1])))
        return "docker 컨테이너·볼륨 삭제·중지는 하지 않아요";
    }
    if (b === "systemctl" && args.some((a) => ["stop", "disable", "mask", "kill", "poweroff", "reboot", "halt", "isolate"].includes(a))) return "systemctl stop/disable 같은 서비스 중단은 하지 않아요";
    if (b === "service" && args.some((a) => a === "stop")) return "서비스 중단은 하지 않아요";
    if (["reboot", "shutdown", "poweroff", "halt"].includes(b) || (b === "init" && ["0", "6"].includes(args[0]))) return "서버를 끄거나 다시 켜지 않아요";
    if (["bash", "sh", "zsh", "dash", "ksh"].includes(b)) {
      const ci = args.findIndex((a) => /^-[a-zA-Z]*c$/.test(a));
      if (ci >= 0) {
        const r = remoteReason(args[ci + 1] ?? "", depth + 1);
        if (r) return r;
      } else if (stdin || !args.length || args.some((a) => /^-[a-zA-Z]*s$/.test(a))) {
        return "표준입력으로 보낸 스크립트는 검사할 수 없어요 — 원격 명령을 ssh 인자로 직접 적으세요";
      }
    }
    if (/^(python[0-9.]*|perl|ruby|node|php)$/.test(b) && (stdin || !args.length || args[0] === "-")) return "표준입력으로 보낸 스크립트는 검사할 수 없어요 — 원격 명령을 ssh 인자로 직접 적으세요";
  }
  return null;
}

// ───────── ssh·scp 인자 읽기 ─────────

const SSH_ARG_OPTS = new Set(["-b", "-c", "-D", "-E", "-e", "-F", "-I", "-i", "-J", "-L", "-l", "-m", "-O", "-o", "-p", "-Q", "-R", "-S", "-W", "-w", "-B", "-P"]);
const BAD_OPTS = new Set(["-F", "-J", "-L", "-R", "-D", "-W", "-w"]); // 다른 설정 파일·경유 호스트·터널
const BAD_O_KEYS = /^(proxycommand|proxyjump|hostname|localcommand|permitlocalcommand|remotecommand|include|knownhostscommand)$/i;

function hostOf(dest) {
  let d = String(dest);
  const m = d.match(/^ssh:\/\/(?:[^@/]+@)?([^:/]+)/i);
  if (m) return m[1].toLowerCase();
  d = d.replace(/^[^@]*@/, "");
  return d.toLowerCase();
}

const allowedHost = (h) => SERVER_HOSTS.includes(String(h).toLowerCase());

/** -o 키=값 / -oKey=값 / -o Key 값 꼴의 옵션 키 */
const oKey = (v) => String(v).split(/[=\s]/)[0];

function optionReason(argv, scp = false) {
  const opts = [];
  const operands = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { operands.push(...argv.slice(i + 1)); break; }
    if (a.startsWith("-") && a.length > 1 && operands.length === 0) {
      // 붙은 플래그 묶음(-vT, -vJhost 등): 값을 받는 옵션이 나오면 나머지 글자(없으면 다음 인자)가 그 값
      for (let k = 1; k < a.length; k++) {
        const flag = `-${a[k]}`;
        const takesArg = SSH_ARG_OPTS.has(flag) && !(scp && flag === "-p"); // scp -p 는 값 없는 옵션(시각 유지)
        if (!takesArg) { opts.push({ flag, val: null }); continue; }
        opts.push({ flag, val: k + 1 < a.length ? a.slice(k + 1) : argv[++i] });
        break;
      }
      continue;
    }
    if (!scp && operands.length >= 1) { operands.push(...argv.slice(i)); break; } // ssh: 목적지 다음은 원격 명령
    operands.push(a);
  }
  for (const { flag, val } of opts) {
    if (BAD_OPTS.has(flag) || (scp && flag === "-S")) return { reason: `${scp ? "scp" : "ssh"} 옵션 ${flag}(다른 설정·경유 호스트·터널·실행 프로그램)는 쓰지 않아요` };
    if (flag === "-o" && BAD_O_KEYS.test(oKey(val ?? ""))) return { reason: `ssh 옵션 ${oKey(val)} 는 쓰지 않아요` };
  }
  return { operands };
}

function sshReason(argv, stdin) {
  const { reason, operands } = optionReason(argv);
  if (reason) return reason;
  const [dest, ...cmd] = operands;
  if (!dest) return "ssh 목적지가 없어요";
  const host = hostOf(dest);
  if (!allowedHost(host)) return `허용하지 않은 호스트예요: ${host} (쓸 수 있는 곳: ${SERVER_HOSTS.join(", ")})`;
  if (!cmd.length) return stdin ? "표준입력으로 보낸 스크립트는 검사할 수 없어요 — 원격 명령을 ssh 인자로 직접 적으세요" : "원격 명령 없이 ssh 셸을 열지 않아요 — 실행할 명령을 인자로 적으세요";
  const remote = cmd.join(" ");
  const r = remoteReason(stdin ? `${remote}` : remote);
  if (r) return r;
  if (stdin) {
    const first = base(splitCommands(remote).cmds[0]?.argv?.[0] ?? "");
    if (/^(bash|sh|zsh|dash|ksh|python[0-9.]*|perl|ruby|node|php|xargs|source)$/.test(first)) return "표준입력으로 보낸 스크립트는 검사할 수 없어요 — 원격 명령을 ssh 인자로 직접 적으세요";
  }
  return null;
}

// scp 피연산자의 원격 꼴: [user@]host:path (윈도우 드라이브 C:\ C:/ 는 로컬)
function scpRemote(op) {
  if (/^[A-Za-z]:[\\/]/.test(op)) return null;
  const m = String(op).match(/^scp:\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/(.*)$/i) || String(op).match(/^(?:[^@:/]+@)?([^:/]+):(.*)$/);
  return m ? { host: m[1].toLowerCase(), path: m[2] } : null;
}

function scpReason(argv) {
  const { reason, operands } = optionReason(argv, true);
  if (reason) return reason;
  for (const op of operands) {
    const r = scpRemote(op);
    if (!r) continue;
    if (!allowedHost(r.host)) return `허용하지 않은 호스트예요: ${r.host} (쓸 수 있는 곳: ${SERVER_HOSTS.join(", ")})`;
    const s = sensitiveReason(r.path, { write: true });
    if (s) return s;
    if (/git-server/.test(r.path)) return "git-server 아래 저장소 파일을 scp 로 덮어쓰지 않아요";
  }
  return null;
}

// ───────── 명령 한 줄 판정 ─────────

const MENTION = /\b(ssh|scp|sftp|rsync|git)\b/i;

/** Bash 명령 문자열을 검사한다. 상관없는 명령은 allow(판단 없음) */
export function checkCommand(command, depth = 0) {
  const text = String(command ?? "");
  if (!MENTION.test(text)) return { decision: "allow" };
  if (depth > 4) return { decision: "deny", reason: `명령이 너무 깊게 감싸져 있어 검사할 수 없어요. ${STOP_NOTE}` };
  const deny = (reason) => ({ decision: "deny", reason: `${reason}. ${STOP_NOTE}` });
  const { cmds, subs } = splitCommands(text);
  for (const sub of subs) {
    const r = checkCommand(sub, depth + 1);
    if (r.decision === "deny") return r;
  }
  for (const { argv: raw, stdin } of cmds) {
    const argv = unwrap(raw);
    if (!argv.length) continue;
    const b = base(argv[0]);
    if (b === "ssh") {
      const r = sshReason(argv, stdin);
      if (r) return deny(r);
    } else if (b === "scp") {
      const r = scpReason(argv);
      if (r) return deny(r);
    } else if (b === "sftp") {
      return deny("sftp 는 쓰지 않아요 — ssh·scp 를 쓰세요");
    } else if (b === "rsync") {
      if (argv.slice(1).some((a) => !a.startsWith("-") && scpRemote(a)) || argv.some((a) => /^(-e|--rsh)/.test(a))) return deny("rsync 로 서버에 접속하지 않아요 — scp 를 쓰세요");
    } else if (b === "git") {
      const r = gitReason(argv);
      if (r) return deny(r);
    } else if (["bash", "sh", "zsh", "dash"].includes(b)) {
      const ci = argv.findIndex((a, i) => i > 0 && /^-[a-zA-Z]*c$/.test(a));
      if (ci > 0) {
        const r = checkCommand(argv[ci + 1] ?? "", depth + 1);
        if (r.decision === "deny") return r;
      }
    } else if (b === "powershell" || b === "pwsh" || b === "cmd") {
      const r = checkCommand(argv.slice(1).join(" "), depth + 1);
      if (r.decision === "deny") return r;
    } else if (b === "xargs" && argv.slice(1).some((a) => /^(ssh|scp|sftp|rsync)$/.test(base(a)))) {
      return deny("xargs 로 ssh·scp 를 부르면 인자를 검사할 수 없어요 — 직접 적으세요");
    }
  }
  return { decision: "allow" };
}

/** 일감 로그에 남길 Bash 명령: 서버 접속(ssh·scp·sftp·rsync)이면 그대로(최대 2000자), 아니면 n 자로 줄인다 */
export function commandForLog(command, n = 140) {
  const one = String(command ?? "").replace(/\s+/g, " ").trim();
  return /\b(ssh|scp|sftp|rsync)\b/i.test(one) ? one.slice(0, 2000) : one.slice(0, n);
}

/** Claude Code --settings 에 넣는 훅: Bash 를 실행하기 전에 ssh-guard.mjs 가 판정한다 */
export function guardHookSettings(guardPath = GUARD_PATH) {
  const p = String(guardPath).replace(/\\/g, "/");
  return { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `node "${p}"`, timeout: 15 }] }] };
}
