// 앱 공장 감독 프로그램: 통제실에서 입력한 외부 서비스 키(환경변수)를 secrets.env 에 반영한다. (서버: lib/factory/secretEntries.ts)
// - /next 응답에 secretsPending: true 가 있을 때만 /api/factory/secrets 에서 할 일을 가져온다.
// - secrets.env 의 해당 이름 줄만 추가·교체·삭제한다(다른 줄·주석·빈 줄은 그대로). 쓰기 전에 secrets.env.bak 하나를 남기고,
//   임시 파일에 쓴 뒤 이름 바꾸기로 한 번에 바꾼다. 다 쓴 뒤에만 확인(ack)을 보낸다.
// - 값은 로그·이벤트·오류 메시지에 쓰지 않는다(이름과 이유만). 서버에는 secrets.env 의 "이름만" 알린다.
// - 서명 키 비밀번호(RELEASE_...)는 release.mjs 의 syncKeyPasswords 가 따로 한다. 여기서는 예약 이름을 건드리지 않는다.
// - AI 도구 상태(읽기 전용): Claude Code·Codex 의 --version 과 공식 로그인 상태 명령의 결과만 본다(자격 파일은 읽지 않는다).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const IS_WIN = process.platform === "win32";
export const ENTRY_NAME_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
const LINE_NAME_RE = /^\s*([A-Z][A-Z0-9_]{1,63})\s*=/; // supervisor.mjs readSecrets 와 같은 이름 규칙

// lib/factory/secretEntries.ts 와 같은 목록(같이 고친다)
const RESERVED_PREFIXES = ["RELEASE_", "FACTORY_", "SERVERCTL_", "NEXTAUTH_", "AUTH_", "DATABASE_", "NODE_", "NPM_", "GIT_", "SSH_", "CLAUDE_", "CODEX_", "ANTHROPIC_"];
const RESERVED_NAMES = new Set([
  "PATH", "PATHEXT", "HOME", "USERPROFILE", "USERNAME", "USER", "SHELL", "COMSPEC", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR",
  "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "HOMEDRIVE", "HOMEPATH", "PWD", "LANG", "TZ",
  "OPENAI_API_KEY", "OPENAI_BASE_URL",
]);
export const isReservedName = (name) => RESERVED_NAMES.has(name) || RESERVED_PREFIXES.some((p) => name.startsWith(p));

// 서버 checkSecretValue 와 같은 원칙: 한 줄에 그대로 들어갈 값만
export const validValue = (v) => typeof v === "string" && v.length >= 8 && v.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(v) && v === v.trim() && !/^(['"]).*\1$/.test(v);

const restrict = (file) => {
  try {
    fs.chmodSync(file, 0o600); // Windows 에서는 읽기 전용 표시 정도만 바뀐다(가능한 범위)
  } catch {
    /* 무시 */
  }
};

/**
 * secrets.env 의 이름 줄만 바꾼다. set: { NAME: 값 }(있으면 교체, 없으면 끝에 추가), remove: [NAME](그 이름 줄 모두 삭제).
 * 같은 이름 줄이 여러 개면 첫 줄만 남겨 교체한다(readSecrets 는 마지막 줄을 쓰므로 옛 값이 이기지 않게).
 * 바꾸기 전 secrets.env.bak 을 하나 남기고, 임시 파일 → 이름 바꾸기로 쓴다. 던지는 오류에는 값이 없다.
 */
export function editSecretsFile(file, { set = {}, remove = [] } = {}) {
  for (const [name, value] of Object.entries(set)) {
    if (!ENTRY_NAME_RE.test(name) || isReservedName(name)) throw new Error(`쓸 수 없는 이름(${name})`);
    if (!validValue(value)) throw new Error(`저장할 수 없는 값(${name})`);
  }
  for (const name of remove) if (!ENTRY_NAME_RE.test(name) || isReservedName(name)) throw new Error(`지울 수 없는 이름(${name})`);

  const exists = fs.existsSync(file);
  const text = exists ? fs.readFileSync(file, "utf8") : "";
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const lines = text ? text.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const nameOf = (l) => LINE_NAME_RE.exec(l)?.[1] ?? null;
  const drop = new Set(remove);
  const done = new Set();
  const out = [];
  for (const l of lines) {
    const n = nameOf(l);
    if (n && drop.has(n)) continue;
    if (n && Object.hasOwn(set, n)) {
      if (done.has(n)) continue; // 같은 이름의 뒷줄은 지운다
      out.push(`${n}=${set[n]}`);
      done.add(n);
      continue;
    }
    out.push(l);
  }
  for (const [n, v] of Object.entries(set)) if (!done.has(n)) out.push(`${n}=${v}`);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (exists) {
    const bak = `${file}.bak`;
    fs.copyFileSync(file, bak);
    restrict(bak);
  }
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, out.join(eol) + eol, { mode: 0o600 });
    restrict(tmp);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`secrets.env 를 쓰지 못했어요(${e.code || "오류"})`); // 원래 메시지는 쓰지 않는다(경로·내용이 섞일 수 있음)
  }
}

/** secrets.env 의 이름만(값은 읽어 오지 않는다). 예약 이름은 뺀다. */
export function secretNamesIn(file) {
  if (!fs.existsSync(file)) return [];
  const names = new Set();
  for (const l of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const n = LINE_NAME_RE.exec(l)?.[1];
    if (n && !isReservedName(n)) names.add(n);
  }
  return [...names].sort();
}

/** PC 에 있는 이름 목록을 서버에 알린다(값 없음). 예전 서버(404)면 조용히 넘어간다. 던지지 않는다. */
export async function reportSecretNames({ api, log, secretsFile }) {
  try {
    const r = await api("POST", "/api/factory/secrets", { names: secretNamesIn(secretsFile) });
    if (r.status !== 200 && r.status !== 404) log(`키 이름 보고 거절(${r.status})`);
  } catch (e) {
    log(`키 이름 보고 오류: ${e.code || e.name || "연결 실패"}`);
  }
}

let syncing = false;

/** /next 응답에 secretsPending 이 있으면 부른다. 값은 로그에 남기지 않는다. 던지지 않는다. */
export async function syncSecretEntries({ api, log, secretsFile }) {
  if (syncing) return;
  syncing = true;
  const values = [];
  const scrub = (s) => values.reduce((acc, v) => acc.split(v).join("***"), String(s ?? ""));
  try {
    const r = await api("GET", "/api/factory/secrets");
    if (r.status !== 200 || !Array.isArray(r.data?.items)) return log(`외부 서비스 키 가져오기 거절(${r.status})`);
    const set = {};
    const remove = [];
    const ack = [];
    const skipped = [];
    for (const it of r.data.items.slice(0, 50)) {
      const name = typeof it?.name === "string" ? it.name : "";
      if (!ENTRY_NAME_RE.test(name) || isReservedName(name) || !Number.isInteger(it.version)) {
        if (name) skipped.push(`${name.slice(0, 64)}: 쓸 수 없는 이름`);
        continue;
      }
      if (it.delete === true) {
        delete set[name];
        if (!remove.includes(name)) remove.push(name);
        ack.push({ name, version: it.version, action: "delete" });
      } else if (validValue(it.value)) {
        values.push(it.value);
        set[name] = it.value;
        const i = remove.indexOf(name);
        if (i >= 0) remove.splice(i, 1);
        ack.push({ name, version: it.version, action: "store" });
      } else {
        skipped.push(`${name}: 값 형식이 맞지 않음`);
      }
    }
    for (const s of skipped) log(`외부 서비스 키를 건너뛰었어요 — ${s}`);
    if (!ack.length) return;
    try {
      editSecretsFile(secretsFile, { set, remove });
    } catch (e) {
      // 쓰기에 실패하면 확인하지 않는다(서버 값은 남아 다음에 다시 시도)
      return log(`외부 서비스 키를 secrets.env 에 반영하지 못했어요(${ack.map((a) => a.name).join(", ")}): ${scrub(e.message)}`);
    }
    const a = await api("POST", "/api/factory/secrets", { ack });
    const stored = ack.filter((x) => x.action === "store").map((x) => x.name);
    const removed = ack.filter((x) => x.action === "delete").map((x) => x.name);
    const what = [stored.length ? `저장 ${stored.join(", ")}` : "", removed.length ? `삭제 ${removed.join(", ")}` : ""].filter(Boolean).join(" · ");
    log(a.status === 200 ? `외부 서비스 키를 secrets.env 에 반영했어요(${what}). 서버 값은 지움.` : `외부 서비스 키 반영 확인 거절(${a.status}): ${what}`);
    await reportSecretNames({ api, log, secretsFile });
  } catch (e) {
    log(`외부 서비스 키 가져오기 오류: ${scrub(e.code || e.name || "연결 실패")}`);
  } finally {
    values.length = 0;
    syncing = false;
  }
}

// ───────── AI 도구 상태(읽기 전용) ─────────

// 고정 인자만. 명령 이름은 설정값(claudeCmd·codexCmd). Windows 의 .cmd 는 셸이 있어야 실행된다. 감독 루프를 막지 않게 비동기로, 20초 제한
function run(cmd, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, shell: IS_WIN, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      return resolve(null);
    }
    let stdout = "";
    let stderr = "";
    const cap = (s, d) => (s.length < 64 * 1024 ? s + d : s);
    child.stdout.on("data", (d) => (stdout = cap(stdout, d)));
    child.stderr.on("data", (d) => (stderr = cap(stderr, d)));
    const timer = setTimeout(() => child.kill(), 20_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}
const firstLine = (s) => String(s ?? "").trim().split(/\r?\n/)[0].replace(/[^\w .()+\-]/g, "").slice(0, 60);

/**
 * 버전과 로그인 상태 한 줄씩. 로그인은 각 CLI 의 공식 명령만 쓴다(출력은 로그인 여부만 보고 버린다. 이메일 등은 저장하지 않음):
 * - Claude Code: `claude auth status --json` 의 loggedIn(true/false)
 * - Codex: `codex login status` 의 종료 코드(0 = 로그인됨, "Not logged in" 이면 안 됨)
 * 판단할 수 없으면 "로그인 확인 안 함".
 */
export async function aiToolStatus(cfg, runner = run) {
  const label = (version, login) => `${version} · ${login}`;
  const claude = await (async () => {
    const v = await runner(cfg.claudeCmd || "claude", ["--version"]);
    if (!v || v.status !== 0) return "없음";
    const s = await runner(cfg.claudeCmd || "claude", ["auth", "status", "--json"]);
    let login = "로그인 확인 안 함";
    try {
      const j = JSON.parse(s?.stdout ?? "");
      if (j && typeof j.loggedIn === "boolean") login = j.loggedIn ? "로그인됨" : "로그인 안 됨";
    } catch {
      /* 확인 안 함 */
    }
    return label(firstLine(v.stdout) || "버전 모름", login);
  })();
  const codex = await (async () => {
    const cmd = cfg.codexCmd || (IS_WIN ? "codex.cmd" : "codex");
    const v = await runner(cmd, ["--version"]);
    if (!v || v.status !== 0) return "없음";
    const s = await runner(cmd, ["login", "status"]);
    const out = `${s?.stdout ?? ""} ${s?.stderr ?? ""}`;
    const login = !s ? "로그인 확인 안 함" : /not logged in/i.test(out) ? "로그인 안 됨" : s.status === 0 ? "로그인됨" : "로그인 확인 안 함";
    return label(firstLine(v.stdout) || "버전 모름", cfg.codexEnabled === false ? `${login} · 공장에서 꺼짐` : login);
  })();
  return { claudeTool: claude, codexTool: codex, aiToolsAt: new Date().toISOString() };
}
