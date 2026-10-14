// AI 에게 넘길 환경변수 거르기 + Codex 용 ssh 막기(PATH 감싸기). 정비·지휘자·앱 일감·실험이 같은 함수를 쓴다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 키·토큰 모양 이름(인터넷이 열려 있는 무인 실행이라 AI 의 명령에 비밀이 새지 않게)
export const SECRET_ENV_RE = /(TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY)/i;
// 위 모양이어도 이름이 같으면 넘기지 않는 것(모양에 안 걸리지만 비밀인 변수)
const ALWAYS_DROP = /^(SERVERCTL_VALUE)$/i;
// 감독 프로그램이 정해서 넘기는 변수(허용 목록). 이 이름들은 걸러내기에서 빼 둔다
const ALLOW = /^FACTORY_(MAINTENANCE|MAINTENANCE_TURN|JOB_ID|APP_SLUG|LOCK_DIR|WAIT_FILE|LAUNCHER|ROLE|LAB_[A-Z_]+)$/;

/** base(기본 process.env)에서 키·토큰 모양 변수를 뺀 새 객체. extra(감독이 정한 값, 예: 앱 일감의 requiredSecrets)는 거르지 않고 그대로 더한다 */
export function safeEnv(base = process.env, extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (ALLOW.test(k) || (!SECRET_ENV_RE.test(k) && !ALWAYS_DROP.test(k))) env[k] = v;
  }
  return { ...env, ...extra };
}

// ───────── Codex: ssh·scp·rsync·sftp 막기 ─────────
// Codex 에는 ssh-guard 같은 훅이 없다. 샌드박스(network_access=false)가 기본이지만 실험은 네트워크를 켜므로,
// 이 명령들이 PATH 앞쪽의 안내용 스크립트로 먼저 잡히게 한다(서버 작업은 "Claude 로 다시 보내라"며 실패).
export const NOSSH_COMMANDS = ["ssh", "scp", "rsync", "sftp", "ssh-add", "ssh-agent", "ssh-keygen", "ssh-keyscan"];
export const NOSSH_MESSAGE = "Codex 일감에서는 서버 접속(ssh·scp·rsync·sftp)을 쓸 수 없어요. 서버 작업이 필요하면 이 일감을 Claude Code 로 다시 보내세요.";

export function nosshDir() {
  return path.join(os.tmpdir(), "factory-nossh");
}

/** 안내용 스크립트 폴더를 만들고(이미 같은 내용이면 그대로) 경로를 돌려준다. 못 만들면 던진다 */
export function ensureNosshDir(dir = nosshDir()) {
  fs.mkdirSync(dir, { recursive: true });
  const sh = `#!/bin/sh\necho "${NOSSH_MESSAGE}" >&2\nexit 126\n`;
  const cmd = `@echo off\r\nchcp 65001 >nul\r\necho ${NOSSH_MESSAGE} 1>&2\r\nexit /b 126\r\n`;
  const put = (file, text, mode) => {
    try {
      if (fs.readFileSync(file, "utf8") === text) return;
    } catch {}
    fs.writeFileSync(file, text, { mode });
  };
  for (const c of NOSSH_COMMANDS) {
    put(path.join(dir, c), sh, 0o755); // Git Bash·리눅스
    put(path.join(dir, `${c}.cmd`), cmd); // 윈도우 cmd(PATH 앞 폴더가 먼저 찾힌다)
  }
  return dir;
}

/** Codex 에 넘길 환경: PATH 맨 앞에 안내 폴더, git 의 ssh 도 같은 안내로 실패시킨다. 폴더를 못 만들면 던져 일감이 시작되지 않게 한다 */
export function withNossh(env, dir = ensureNosshDir()) {
  const out = { ...env };
  const key = Object.keys(out).find((k) => k.toUpperCase() === "PATH") || "PATH";
  out[key] = dir + path.delimiter + (out[key] || "");
  out.GIT_SSH_COMMAND = `echo "${NOSSH_MESSAGE}" >&2; false`;
  delete out.GIT_SSH;
  return out;
}
