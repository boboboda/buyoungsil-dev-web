// 앱 공장 감독 프로그램: 이 PC 의 PATH 새로 읽기와 ffmpeg·ffprobe 찾기
// - 실행기(run-supervisor.sh)·작업 스케줄러는 로그온 때의 PATH 를 쥐고 있어서, 그 뒤에 설치한 프로그램(winget 등)은 못 찾는다.
//   그래서 감독 프로그램이 시작할 때 윈도우 레지스트리(시스템 HKLM·사용자 HKCU)의 Path 를 다시 읽어 빠진 폴더를 PATH 뒤에 붙인다.
//   (자식 프로세스 — Claude, ffmpeg 등 — 는 이 PATH 를 물려받는다)
// - ffmpeg·ffprobe 찾는 순서: ① 프로세스 PATH ② 레지스트리 사용자/시스템 Path ③ winget Links(%LOCALAPPDATA%\Microsoft\WinGet\Links)
//   ④ winget 패키지(%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg-*\bin) ⑤ %USERPROFILE%\tools\ffmpeg\bin
//   찾으면 그 경로를 이후 호출에 쓰고, PATH 에 없던 폴더면 PATH 에도 붙인다.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const IS_WIN = process.platform === "win32";
const SYS32 = path.join(process.env.SystemRoot || "C:\\Windows", "System32");
const REG_KEYS = ["HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", "HKCU\\Environment"];
const norm = (d) => path.normalize(d).replace(/[\\/]+$/, "").toLowerCase();

// %VAR% 를 이 프로세스 환경값으로 바꾼다(REG_EXPAND_SZ). 모르는 변수는 그대로 둔다
const expandVars = (s) => s.replace(/%([^%]+)%/g, (m, k) => process.env[k] ?? m);

function regPath(key) {
  const r = spawnSync(path.join(SYS32, "reg.exe"), ["query", key, "/v", "Path"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (r.status !== 0) return [];
  const m = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(r.stdout);
  return m ? m[1].trim().split(";").map((d) => expandVars(d.trim())).filter(Boolean) : [];
}

/** 레지스트리의 시스템 + 사용자 Path 폴더(윈도우가 새 프로그램에 주는 순서). 윈도우가 아니면 빈 목록 */
export function registryPathDirs() {
  return IS_WIN ? REG_KEYS.flatMap(regPath) : [];
}

function addToPath(dirs) {
  const cur = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const have = new Set(cur.map(norm));
  const added = dirs.filter((d) => {
    const n = norm(d);
    if (have.has(n)) return false;
    have.add(n);
    return true;
  });
  if (added.length) process.env.PATH = [...cur, ...added].join(path.delimiter);
  return added;
}

/** 시작할 때 부른다. 레지스트리 Path 에 있는데 지금 PATH 에 없는 폴더를 뒤에 붙이고, 붙인 폴더 목록을 돌려준다. 던지지 않는다 */
export function refreshPathFromRegistry() {
  try {
    return addToPath(registryPathDirs());
  } catch {
    return [];
  }
}

function where(cmd) {
  const r = spawnSync(IS_WIN ? path.join(SYS32, "where.exe") : "which", [cmd], { encoding: "utf8", shell: false, timeout: 10_000, windowsHide: true });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null;
}

const listDirs = (dir, prefix) => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .map((e) => path.join(dir, e.name))
      .sort()
      .reverse(); // 이름이 큰(대개 새) 버전 먼저
  } catch {
    return [];
  }
};

// ②~⑤ 후보 폴더(순서대로)
function candidateDirs() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const winget = path.join(local, "Microsoft", "WinGet");
  return [
    ...registryPathDirs(),
    path.join(winget, "Links"),
    ...listDirs(path.join(winget, "Packages"), "Gyan.FFmpeg").flatMap((p) => listDirs(p, "ffmpeg-").map((d) => path.join(d, "bin"))),
    path.join(process.env.USERPROFILE || os.homedir(), "tools", "ffmpeg", "bin"),
  ];
}

const found = new Map(); // name → { file, at } (file 이 null 이면 못 찾음)
const MISS_RECHECK_MS = 60_000; // 못 찾았으면 1분 뒤 다시 찾는다(그 사이 설치했을 수 있음)

/** ffmpeg·ffprobe 등 실행 파일 경로. 못 찾으면 null */
export function findTool(name) {
  const c = found.get(name);
  if (c?.file && fs.existsSync(c.file)) return c.file;
  if (c && !c.file && Date.now() - c.at < MISS_RECHECK_MS) return null;
  let file = where(name);
  if (!file) {
    const exe = IS_WIN ? `${name}.exe` : name;
    file = candidateDirs().map((d) => path.join(d, exe)).find((f) => fs.existsSync(f)) ?? null;
    if (file) addToPath([path.dirname(file)]); // 자식 프로세스(Claude·hyperframes 등)도 찾게
  }
  found.set(name, { file, at: Date.now() });
  return file;
}

const versions = new Map(); // file → 버전
/** "7.1-full_build-www.gyan.dev | C:/.../ffmpeg.exe" 또는 "없음" */
export function toolLabel(name) {
  const file = findTool(name);
  if (!file) return "없음";
  if (!versions.has(file)) {
    const r = spawnSync(file, ["-version"], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
    const m = /version\s+(\S+)/.exec(r.stdout ?? "");
    versions.set(file, m ? m[1] : "버전 모름");
  }
  return `${versions.get(file)} | ${file.replace(/\\/g, "/")}`;
}
