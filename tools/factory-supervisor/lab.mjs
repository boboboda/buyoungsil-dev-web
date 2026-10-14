// tools/factory-supervisor/lab.mjs
// 실험(lab) 일감: 도구·방식이 되는지 확인하는 테스트 전용 일감 종류 (supervisor.mjs 의 runLabJob 이 쓴다).
// - 작업 폴더는 앱 폴더가 아니라 <workDir>/lab/<일감id>/, 여러 실험이 다시 쓰는 공용 폴더는 <workDir>/lab/shared/.
// - 권한: 공장 안 다른 폴더는 읽기·복사만, 실험 폴더(lab/<id>, lab/shared)만 쓰기·실행. 명령은 승인 없이, 인터넷 허용.
// - 금지의 보장은 두 겹: (1) 실행 설정에서 쓰기 가능 경로를 실험 폴더로 제한(Claude: permission 설정, Codex: writable_roots)
//   (2) 실험이 끝난 뒤 공장 안 저장소들의 `git status --porcelain` 을 실험 전과 비교해 달라졌으면 일감을 실패로 표시(되돌리지는 않음).
// - 결과(outputs/ 의 png·webp·gif·mp4, report.md)는 8MB 조각으로 홈페이지에 올린다(파일 50MB·일감 200MB·40개 상한, 넘으면 목록만).
// 이 파일은 홈페이지로 나가는 요청만 한다(api 함수를 받아서 쓴다). 앱 일감·정비의 동작은 바꾸지 않는다.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const LAB_SLUG = "lab";
export const LAB_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const LAB_FILE_MAX = 50 * 1024 * 1024; // 파일당
export const LAB_JOB_MAX = 200 * 1024 * 1024; // 일감당
export const LAB_FILE_COUNT_MAX = 40; // 일감당 파일 수 (홈페이지 lib/factory/lab.ts 와 같게)
export const LAB_CHUNK = 8 * 1024 * 1024;

const OUTPUT_EXT = new Set([".png", ".webp", ".gif", ".mp4"]);
const MAX_SCAN = 400; // outputs 아래에서 훑는 항목 수 상한
const MAX_DEPTH = 4;
const NAME_RE = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9가-힣._ -]+(?:\/[A-Za-z0-9가-힣._ -]+){0,4}$/; // 홈페이지 LAB_NAME_RE 와 같게

// ───────────── 경로 ─────────────

export const labRootOf = (workDir) => path.join(workDir, "lab");
export const labSharedOf = (workDir) => path.join(labRootOf(workDir), "shared");

/** 실험 폴더 경로. 일감 id 형식이 이상하거나 shared 이거나 lab 폴더 밖이면 던진다 */
export function labDirOf(workDir, id) {
  if (typeof id !== "string" || !LAB_ID_RE.test(id) || id === "shared") throw new Error("실험 일감 id 가 올바르지 않아요.");
  const root = labRootOf(workDir);
  const dir = path.join(root, id);
  if (!path.resolve(dir).startsWith(path.resolve(root) + path.sep)) throw new Error("실험 폴더 경로가 올바르지 않아요.");
  return dir;
}

/** 실험 폴더·outputs·공용 폴더를 만들고 지시문(PLAN.md)을 적는다. 이미 있으면(재시도) 그대로 쓰고 outputs 의 지난 결과는 남겨 둔다 */
export function prepareLab(workDir, job) {
  const dir = labDirOf(workDir, job.id);
  const shared = labSharedOf(workDir);
  fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(dir, "PLAN.md"), `${job.planMarkdown}\n`);
  return { dir, shared, outputs: path.join(dir, "outputs") };
}

const slash = (p) => path.resolve(p).replace(/\\/g, "/");
// Claude 권한 규칙의 절대 경로는 //경로. 윈도우 경로는 POSIX 꼴로(C:\Users\x → //c/Users/x)
const ruleAbs = (p) => slash(p).replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase()).replace(/^\/+/, "");

// ───────────── 지시문 머리말 ─────────────

/** AI 에게 가는 첫 지시문: 실험 규칙 머리말 + 실험 내용 */
export function labPrompt({ job, dir, shared, workDir }) {
  return [
    "[실험 일감 — 무인 실행]",
    "이 일감은 앱 수정이 아니라, 도구·방식이 되는지 확인하는 실험이에요. 사람이 중간에 답할 수 없으니 질문하지 말고 합리적으로 가정해서 끝까지 하세요. 가정한 것은 report.md 에 적으세요.",
    "",
    "## 폴더와 권한",
    `- 작업 폴더(읽기·쓰기·실행 가능): ${dir}`,
    `- 공용 폴더(읽기·쓰기·실행 가능, 여러 실험이 다시 쓰는 것. 예: ComfyUI·모델): ${shared}`,
    `- 공장 폴더(${workDir}) 안의 다른 모든 폴더(앱들, game-toolkit, one-tiny-frame 등): 읽기와 작업 폴더로 복사만 해요. 그 폴더 안의 파일을 수정·삭제·이동하거나 새 파일을 만들면 안 돼요. 읽을 때는 절대 경로를 쓰고, 다른 폴더로 cd 하지 마세요.`,
    "- 설치·다운로드·캐시·임시 파일도 작업 폴더나 공용 폴더 안에만 두세요(전역 설치, 시스템 설정 변경 금지).",
    "- 명령은 승인 없이 실행돼요. 인터넷도 쓸 수 있어요.",
    "",
    "## 금지",
    "- 기존 폴더(공장 폴더의 다른 곳) 수정·삭제. 키·토큰·secrets 파일 읽기와 출력.",
    "- git commit / push / add / reset / checkout 같은 저장소를 바꾸는 명령 (git status·log·diff 같은 읽기는 괜찮아요).",
    "- 끝나면 감독 프로그램이 공장 안 저장소들의 변경 여부를 검사해요. 하나라도 바뀌었으면 이 실험은 실패로 표시돼요.",
    "",
    "## 결과물 (사람이 폰으로 봐요)",
    `- 보여줄 이미지(png·webp·gif)와 영상(mp4)은 ${path.join(dir, "outputs")} 에 저장하세요. 그 밖에 이 지시문에서 경로를 직접 지정한 이미지·영상도 올라가요.`,
    `- 요약은 ${path.join(dir, "report.md")} 에 쓰세요: 한 일, 결과(되는지 안 되는지), 막힌 점, 다음에 해 볼 것.`,
    "- 파일은 한 개 50MB, 한 실험 200MB, 40개까지만 올라가요. 넘는 파일은 올라가지 않고 목록만 보여요. 영상은 짧고 가볍게(예: 720p 이하) 만드세요.",
    "- 인터넷에서 받은 파일은 report.md 에 '받은 파일' 표로 적으세요(주소, 저장한 파일 이름, 크기). 모델·설치 파일처럼 큰 것은 크기를 꼭 적으세요.",
    "",
    "## 실험 내용",
    job.planMarkdown,
    "",
    "끝날 때 한 일과 결과를 한국어로 짧게 적으세요.",
  ].join("\n");
}

// ───────────── 쓰기 제한 (Claude permission 설정) ─────────────

/**
 * Claude Code 설정 파일(--settings)을 만든다: 읽기는 공장 폴더 전체, 쓰기(Edit/Write)는 실험 폴더(lab/<id>, lab/shared)만.
 * - allow: Read(공장 폴더), Edit(실험 폴더 둘), Bash(승인 없이). additionalDirectories: 공용 폴더(작업 폴더는 cwd).
 * - deny: 공장 폴더 안 실험 폴더 밖 모든 항목에 Edit 금지(deny 가 allow 보다 먼저), 감독 프로그램·정비 폴더, 설정·비밀 파일 읽기.
 * 설정 파일은 쓰기 허용 폴더 밖(lab/.settings/)에 둔다. 못 만들면 던진다(실험은 권한 없이 돌리지 않는다).
 */
export function writeLabClaudeSettings({ workDir, dir, shared, jobId, extraProtected = [] }) {
  const root = labRootOf(workDir);
  const folder = path.join(root, ".settings");
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${jobId}.json`);
  const factory = ruleAbs(workDir);
  const deny = [];
  // 공장 폴더 직속 항목(앱 폴더·정비 체크아웃·설정·비밀 파일…) 중 lab 이 아닌 것은 쓰기 금지
  let entries = [];
  try { entries = fs.readdirSync(workDir, { withFileTypes: true }); } catch { /* 읽을 수 없으면 아래 공통 규칙만 */ }
  for (const e of entries) {
    if (e.name === "lab") continue;
    deny.push(e.isDirectory() ? `Edit(//${factory}/${e.name}/**)` : `Edit(//${factory}/${e.name})`);
  }
  for (const d of extraProtected) deny.push(`Edit(//${ruleAbs(d)}/**)`);
  deny.push(`Edit(//${factory}/*.json)`, `Edit(//${factory}/*.sh)`, `Edit(//${factory}/secrets.env*)`);
  deny.push(`Read(//${factory}/supervisor.config.json)`, `Read(//${factory}/secrets.env*)`, "Read(~/.ssh/**)", "Read(~/.aws/**)");
  const settings = {
    permissions: {
      allow: [`Read(//${factory}/**)`, `Edit(//${ruleAbs(dir)}/**)`, `Edit(//${ruleAbs(shared)}/**)`, "Bash"],
      deny: [...new Set(deny)],
      additionalDirectories: [slash(shared)],
    },
  };
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return slash(file);
}

/** Codex 실행 옵션: 쓰기 가능 루트는 공용 폴더(작업 폴더는 cwd 라서 자동), 네트워크 허용 (ai-runner.mjs invocation 의 옵션) */
export const labCodexOptions = (shared) => ({ writableRoots: [slash(shared)], network: true });

// ───────────── 사후 검사: 공장 안 저장소 git status 비교 ─────────────

/** 공장 폴더 직속 폴더 중 .git 이 있는 것(lab 제외)과 따로 알려 준 저장소 폴더들. 경로는 절대 경로, 중복 없이 */
export function discoverRepos(workDir, extraDirs = []) {
  const found = new Map();
  const add = (d) => {
    const full = path.resolve(d);
    try { if (fs.existsSync(path.join(full, ".git"))) found.set(process.platform === "win32" ? full.toLowerCase() : full, full); } catch { /* 건너뜀 */ }
  };
  try {
    for (const e of fs.readdirSync(workDir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== "lab" && !e.name.startsWith(".")) add(path.join(workDir, e.name));
    }
  } catch { /* 폴더를 못 읽으면 따로 알려 준 것만 */ }
  for (const d of extraDirs) if (d) add(d);
  return [...found.values()];
}

function porcelain(dir) {
  const r = spawnSync("git", ["status", "--porcelain", "-uall"], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, // 상태 확인이 다른 작업의 인덱스 잠금을 건드리지 않게
  });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).filter(Boolean);
}

// porcelain 한 줄의 파일 경로 (이름 바꿈은 새 이름, 따옴표 제거)
function pathOf(line) {
  let p = line.slice(3);
  const arrow = p.indexOf(" -> ");
  if (arrow >= 0) p = p.slice(arrow + 4);
  return p.replace(/^"|"$/g, "");
}

/**
 * 저장소 하나의 상태 지문: 변경 목록의 각 줄에 파일 크기·수정 시각을 붙인다
 * (이미 바뀌어 있던 파일을 더 고쳐도 알아챈다). git 이 안 돌면 null
 */
export function snapshotRepo(dir) {
  const lines = porcelain(dir);
  if (lines === null) return null;
  const entries = new Map();
  for (const line of lines.slice(0, 5000)) {
    const rel = pathOf(line);
    let sig = "gone";
    try {
      const st = fs.lstatSync(path.join(dir, rel));
      sig = st.isDirectory() ? "dir" : `${st.size}:${Math.floor(st.mtimeMs)}`;
    } catch { /* 지워진 파일 */ }
    entries.set(`${line}|${sig}`, rel);
  }
  return { count: lines.length, entries };
}

export function snapshotRepos(repos) {
  const out = new Map();
  for (const d of repos) out.set(d, snapshotRepo(d));
  return out;
}

/**
 * 실험 전·후 스냅샷 비교. isBusy(dir): 실험 동안 다른 일감이 그 저장소를 만졌으면 true → 비교에서 빼고 notes 에 적는다
 * (앱 일감은 실험을 멈추지 않으므로 같이 돌면 정상적으로 바뀐다).
 * 반환: { ok, repos(비교한 개수), changes: [{repo, files(최대 20), more}], notes }
 */
export function compareSnapshots(before, after, { isBusy = () => false } = {}) {
  const changes = [];
  const notes = [];
  let compared = 0;
  for (const [dir, b] of before) {
    const name = path.basename(dir);
    if (isBusy(dir)) { notes.push(`${name}: 실험 동안 다른 일감이 같이 작업해서 비교에서 뺐어요.`); continue; }
    const a = after.get(dir);
    if (b === null || a === null || a === undefined) { notes.push(`${name}: git 상태를 읽지 못해 비교하지 못했어요.`); continue; }
    compared++;
    const files = new Set();
    for (const [key, rel] of a.entries) if (!b.entries.has(key)) files.add(rel);
    for (const [key, rel] of b.entries) if (!a.entries.has(key)) files.add(rel);
    if (a.count > 5000 || b.count > 5000) notes.push(`${name}: 변경 파일이 5000개를 넘어 앞부분만 비교했어요.`);
    if (files.size) {
      const list = [...files].sort();
      changes.push({ repo: name, files: list.slice(0, 20), more: Math.max(0, list.length - 20) });
    }
  }
  for (const [dir] of after) if (!before.has(dir)) notes.push(`${path.basename(dir)}: 실험 중에 생긴 저장소라 비교하지 않았어요.`);
  return { ok: changes.length === 0, repos: compared, changes, notes };
}

/** 다른 일감이 실험 동안 어느 저장소를 만졌는지 기억한다 (앱 일감 시작·끝에 touch 를 부른다) */
export function createLabGuard() {
  const touched = new Map(); // 폴더 → 마지막으로 시작하거나 끝난 시각
  const key = (d) => (process.platform === "win32" ? path.resolve(d).toLowerCase() : path.resolve(d));
  return {
    touch(dir) { if (dir) touched.set(key(dir), Date.now()); },
    /** 실험이 시작한 뒤(sinceMs 이후) 만져졌거나 지금 다른 일감이 돌고 있으면 true */
    isBusy(dir, sinceMs, runningDirs = []) {
      const k = key(dir);
      return (touched.get(k) ?? 0) >= sinceMs || runningDirs.some((d) => key(d) === k);
    },
  };
}

// ───────────── 결과 파일 모으기·올리기 ─────────────

const isInside = (parent, child) => {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** 지시문(plan)에 적힌 이미지·영상 상대 경로 (실험 폴더 안에서만 인정) */
export function pathsFromPlan(plan) {
  const out = new Set();
  for (const m of String(plan ?? "").matchAll(/(?:^|[\s`"'(\[])((?:[\w가-힣.-]+[\\/])*[\w가-힣.-]+\.(?:png|webp|gif|mp4))(?=$|[\s`"')\],.:;])/gim)) {
    const rel = m[1].replace(/\\/g, "/");
    if (!path.isAbsolute(rel) && !rel.split("/").includes("..")) out.add(rel);
  }
  return [...out];
}

/**
 * 올릴 후보: outputs/ 아래 이미지·mp4, 실험 폴더 또는 outputs 의 report.md, 지시문이 지정한 실험 폴더 안 파일.
 * 심볼릭 링크·실험 폴더 밖은 보지 않는다. 반환: [{ name(실험 폴더 기준 슬래시 경로), full, size, mtimeMs }]
 */
export function listLabOutputs(labDir, plan = "") {
  const found = new Map();
  const real = (() => { try { return fs.realpathSync(labDir); } catch { return path.resolve(labDir); } })();
  const consider = (full) => {
    let st;
    try {
      st = fs.lstatSync(full);
      if (!st.isFile()) return;
      const r = fs.realpathSync(full);
      if (!isInside(real, r)) return;
    } catch { return; }
    const name = path.relative(labDir, full).split(path.sep).join("/");
    const base = path.basename(full).toLowerCase();
    const ext = path.extname(base);
    if (base === "report.md" ? false : !OUTPUT_EXT.has(ext)) return;
    found.set(name, { name, full, size: st.size, mtimeMs: st.mtimeMs });
  };
  let scanned = 0;
  const walk = (d, depth) => {
    if (depth > MAX_DEPTH || scanned >= MAX_SCAN) return;
    let entries;
    try { if (fs.lstatSync(d).isSymbolicLink()) return; entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++scanned > MAX_SCAN) return;
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile()) consider(full);
    }
  };
  walk(path.join(labDir, "outputs"), 0);
  consider(path.join(labDir, "report.md"));
  for (const rel of pathsFromPlan(plan)) consider(path.join(labDir, ...rel.split("/")));
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 올릴 것과 건너뛸 것을 고른다: 이름 규칙에 안 맞거나 0바이트면 건너뛰고(목록에 넣지 않음),
 * 파일 50MB·일감 200MB·40개를 넘으면 건너뛰고 목록(skipped)에 이유를 남긴다. report.md 를 먼저 담는다
 */
export function pickUploads(files) {
  const pick = [];
  const skipped = [];
  let total = 0;
  const ordered = [...files].sort((a, b) => (a.name.endsWith("report.md") ? 0 : 1) - (b.name.endsWith("report.md") ? 0 : 1) || a.name.localeCompare(b.name));
  for (const f of ordered) {
    if (!NAME_RE.test(f.name) || f.name.length > 200) { skipped.push({ name: f.name.slice(0, 200), size: f.size, reason: "파일 이름에 쓸 수 없는 글자가 있어요" }); continue; }
    if (f.size === 0) continue;
    if (f.size > LAB_FILE_MAX) { skipped.push({ name: f.name, size: f.size, reason: "파일 50MB 초과" }); continue; }
    if (pick.length >= LAB_FILE_COUNT_MAX) { skipped.push({ name: f.name, size: f.size, reason: `파일 ${LAB_FILE_COUNT_MAX}개 초과` }); continue; }
    if (total + f.size > LAB_JOB_MAX) { skipped.push({ name: f.name, size: f.size, reason: "실험당 200MB 초과" }); continue; }
    total += f.size;
    pick.push(f);
  }
  return { pick, skipped, bytes: total };
}

/**
 * 결과 파일을 홈페이지에 올린다. put({ name, idx, count, size, bytes }) → { status, data }.
 * 파일 하나가 실패해도 나머지는 계속한다(실패한 것은 skipped 에 이유와 함께). 409(일감이 더 이상 실행 중이 아님)면 멈춘다.
 * 반환: { uploaded: [{name,size}], skipped, bytes, stopped }
 */
export async function uploadLabOutputs({ labDir, plan, put, log = () => {} }) {
  const { pick, skipped } = pickUploads(listLabOutputs(labDir, plan));
  const uploaded = [];
  let bytes = 0;
  let stopped = false;
  for (const f of pick) {
    if (stopped) { skipped.push({ name: f.name, size: f.size, reason: "일감이 더 이상 실행 중이 아니라 올리지 못했어요" }); continue; }
    const count = Math.ceil(f.size / LAB_CHUNK);
    let fd;
    try {
      fd = fs.openSync(f.full, "r");
      for (let idx = 0; idx < count; idx++) {
        const len = idx === count - 1 ? f.size - idx * LAB_CHUNK : LAB_CHUNK;
        const buf = new Uint8Array(len);
        let got = 0;
        while (got < len) {
          const n = fs.readSync(fd, buf, got, len - got, idx * LAB_CHUNK + got);
          if (n <= 0) throw new Error("파일이 올리는 도중에 바뀌었어요");
          got += n;
        }
        let r;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try { r = await put({ name: f.name, idx, count, size: f.size, bytes: buf }); } catch (e) { r = { status: 0, data: { message: e.message } }; }
          if (r.status === 200 || (r.status >= 400 && r.status < 500 && r.status !== 429)) break;
          await new Promise((res) => setTimeout(res, 1500 * attempt));
        }
        if (r.status === 409) { stopped = true; throw new Error("일감이 더 이상 실행 중이 아니에요"); }
        if (r.status !== 200) throw new Error(`서버가 받지 않았어요(${r.status}${r.data?.message ? `: ${String(r.data.message).slice(0, 120)}` : ""})`);
      }
      uploaded.push({ name: f.name, size: f.size });
      bytes += f.size;
      log("info", `결과 파일 올림: ${f.name} (${f.size}바이트)`);
    } catch (e) {
      skipped.push({ name: f.name, size: f.size, reason: `올리지 못했어요: ${e.message}`.slice(0, 120) });
      log("warn", `결과 파일 올리기 실패: ${f.name} — ${e.message}`);
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* 이미 닫힘 */ }
    }
  }
  return { uploaded, skipped, bytes, stopped };
}

// ───────────── 폴더 지우기 ─────────────

/**
 * 통제실 [폴더 지우기]: lab/<id> 만 지운다. shared·lab 자체·다른 폴더는 지우지 않는다.
 * 반환: "deleted" | "missing". 안전하지 않으면 던진다.
 */
export function deleteLabFolder(workDir, id) {
  const dir = labDirOf(workDir, id); // id 형식·shared·lab 밖 검사
  if (!fs.existsSync(dir)) return "missing";
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("실험 폴더가 일반 폴더가 아니라 지우지 않았어요.");
  const root = fs.realpathSync(labRootOf(workDir));
  if (!isInside(root, fs.realpathSync(dir))) throw new Error("실험 폴더가 lab 폴더 밖을 가리켜 지우지 않았어요.");
  fs.rmSync(dir, { recursive: true, force: true });
  try { fs.rmSync(path.join(labRootOf(workDir), ".settings", `${id}.json`), { force: true }); } catch { /* 설정 파일이 없어도 됨 */ }
  return "deleted";
}
