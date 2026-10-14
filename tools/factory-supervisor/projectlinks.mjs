#!/usr/bin/env node
// 앱별 배포·저장소 연결 정보를 읽어 통제실로 보고한다(읽기 전용). 감독 프로그램이 시작할 때 startProjectLinksReport() 로 붙인다.
//   - 앱 폴더(작업 폴더 바로 아래)마다 git 원격 목록·현재 브랜치·종류(stack)를 읽는다: git remote -v, git symbolic-ref 만 쓴다.
//   - 서버1(serverpc)·서버2(serverpc2)의 도커 컨테이너 이름을 읽는다: ssh <서버> "docker ps --format ..." 한 줄만(이름만, 읽기 전용).
//   - 하루 1번(시작 직후 포함)과 통제실 [새로 읽기] 때 POST /api/factory/project-links 로 보낸다. 실패해도 폴링·일감에 영향 없음.
// 하지 않는 것: git 원격 추가·삭제·이름 변경, 서버 설정 변경, 컨테이너 조작, nginx 설정 읽기. 원격 주소의 자격 증명(user:pass@)은 보내기 전에 지운다.
//
//   node projectlinks.mjs once [작업폴더]   읽어서 화면에 보여 준다(서버로 보내지 않음, ssh 도 하지 않음)
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_LINKS_EVERY_MS = 24 * 60 * 60_000;
const GIT_TIMEOUT_MS = 8000;
const SSH_TIMEOUT_MS = 20_000;
const POST_TIMEOUT_MS = 15_000;
export const DOCKER_PS_COMMAND = "docker ps --format '{{.Names}}'";
export const SERVERS = ["serverpc", "serverpc2"];
// 앱이 아닌 폴더: 실험 폴더, 감독 프로그램 실행 사본, 정비 체크아웃, 오래된 사본
export const SKIP_DIRS = new Set(["lab", "supervisor-src", "selfdev", "buyoungsil-dev-web", "node_modules"]);
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/;

/** 원격 주소에서 자격 증명(user:pass@)을 지운다. scp 꼴(git@host:path)의 사용자 이름은 비밀이 아니라 그대로 둔다 */
export function stripCredentials(url) {
  return String(url ?? "").replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/\s]*@/i, "$1").slice(0, 300);
}

/** `git remote -v` 출력 → [{ name, url }] (fetch 줄만, 이름 중복 없이) */
export function parseRemotes(text) {
  const out = [];
  const seen = new Set();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ name: m[1], url: stripCredentials(m[2]) });
  }
  return out;
}

/** 폴더 안의 파일로 앱 종류를 짐작한다(읽기만). 모르면 null */
export function detectStack(dir, { exists = fs.existsSync, readdir = (d) => fs.readdirSync(d) } = {}) {
  const has = (f) => exists(path.join(dir, f));
  if (has("pubspec.yaml")) return "flutter";
  if (has("nest-cli.json")) return "nestjs";
  try {
    const names = readdir(dir);
    if (names.some((n) => /^next\.config\.(js|mjs|ts)$/.test(n))) return "nextjs";
    if (names.some((n) => /\.xcodeproj$/.test(n))) return "swift-swiftui";
    if (names.some((n) => /^(settings|build)\.gradle(\.kts)?$/.test(n))) return "kotlin-compose";
  } catch { /* 못 읽으면 모름 */ }
  return null;
}

const run = (file, args, opts) =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, ...opts }, (err, stdout) => resolve(err ? null : String(stdout)));
  });

/** 작업 폴더 바로 아래 폴더들의 git 정보. exec 는 시험에서 바꿔 끼운다 */
export async function collectApps(workDir, { exec = run, listDirs } = {}) {
  let names;
  try {
    names = listDirs ? listDirs(workDir) : fs.readdirSync(workDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return []; }
  const apps = [];
  for (const name of names.sort()) {
    if (name.startsWith(".") || SKIP_DIRS.has(name) || !NAME_RE.test(name)) continue;
    const dir = path.join(workDir, name);
    const isGit = fs.existsSync(path.join(dir, ".git"));
    const app = { folder: name, isGit, branch: null, stack: detectStack(dir), remotes: [] };
    if (isGit) {
      const remotes = await exec("git", ["-C", dir, "remote", "-v"], { timeout: GIT_TIMEOUT_MS });
      const branch = await exec("git", ["-C", dir, "symbolic-ref", "--short", "-q", "HEAD"], { timeout: GIT_TIMEOUT_MS });
      app.remotes = parseRemotes(remotes);
      app.branch = branch ? branch.trim() || null : null;
    }
    apps.push(app);
  }
  return apps;
}

/** 서버 컨테이너 이름. 못 읽으면 { state: "unknown" } */
export async function readContainers({ exec = run } = {}) {
  const servers = {};
  for (const s of SERVERS) {
    const out = await exec("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", s, DOCKER_PS_COMMAND], { timeout: SSH_TIMEOUT_MS });
    servers[s] = out === null ? { state: "unknown" } : { state: "ok", names: out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(l)).slice(0, 60) };
  }
  return servers;
}

export async function collectReport(workDir, { exec = run, withServers = true } = {}) {
  return { apps: await collectApps(workDir, { exec }), servers: withServers ? await readContainers({ exec }) : {} };
}

/** 하루 1번과 request() 때 보고한다. 홈페이지가 받지 못하면 다음 기회(request 또는 다음 날)에 다시 한다 */
export function startProjectLinksReport({ api, log = () => {}, workDir, everyMs = PROJECT_LINKS_EVERY_MS, exec = run } = {}) {
  let busy = false;
  let fails = 0;
  const tick = async () => {
    if (busy) return false;
    busy = true;
    try {
      const dir = typeof workDir === "function" ? workDir() : workDir;
      const report = await collectReport(dir, { exec });
      const r = await api("POST", "/api/factory/project-links", report, { timeoutMs: POST_TIMEOUT_MS });
      if (r?.status === 200) {
        fails = 0;
        return true;
      }
      if (fails++ % 5 === 0) log(`프로젝트 연결 정보 보내기 실패: ${r?.status ?? "응답 없음"} ${r?.data?.message ?? ""}`.trim());
    } catch (e) {
      if (fails++ % 5 === 0) log(`프로젝트 연결 정보 보내기 실패: ${e?.name === "TimeoutError" ? "시간 초과" : "연결 안 됨"}`);
    } finally {
      busy = false;
    }
    return false;
  };
  const first = setTimeout(tick, 20_000);
  const id = setInterval(tick, everyMs);
  first.unref?.();
  id.unref?.();
  return { stop: () => (clearTimeout(first), clearInterval(id)), tick, request: () => void tick() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "once") {
    console.error("사용법: node projectlinks.mjs once [작업폴더]   (감독 프로그램이 알아서 보내요)");
    process.exitCode = 2;
  } else {
    const dir = path.resolve(process.argv[3] ?? path.join(process.cwd(), ".."));
    console.log(JSON.stringify(await collectReport(dir, { withServers: false }), null, 2));
  }
}
