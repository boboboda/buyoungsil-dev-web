#!/usr/bin/env node
// 앱 공장 감독 프로그램 (내 PC에서 실행)
// 홈페이지 대기열에서 승인된 지시를 가져와 앱 폴더를 만들고, Claude Code(claude -p)를 돌려 앱을 만든다.
// 진행 단계·로그·스크린샷·결과를 홈페이지로 보고한다. 홈페이지로 나가는 요청만 있고, 홈페이지가 이 PC로 들어오는 일은 없다.
//
//   node supervisor.mjs init    처음 한 번: 홈페이지 주소와 토큰을 물어보고 설정 파일을 만든다
//   node supervisor.mjs check   홈페이지 연결과 토큰이 맞는지 확인한다 (일감은 가져가지 않는다)
//   node supervisor.mjs         실행 (끄려면 Ctrl+C)
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { createInterface } from "node:readline/promises";

const IS_WIN = process.platform === "win32";
const expand = (p) => (typeof p === "string" && (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) ? path.join(os.homedir(), p.slice(1)) : p);
const CONFIG_PATH = expand(process.env.FACTORY_CONFIG || "~/dev/factory/supervisor.config.json");

const WORKER_RE = /^[A-Za-z0-9._-]{1,60}$/;
const DEFAULTS = {
  serverUrl: "https://www.buyoungsilcoding.com",
  token: "",
  worker: "mainpc",
  workDir: "~/dev/factory",
  secretsFile: "~/dev/factory/secrets.env",
  slots: 2,
  pollSec: 15,
  heartbeatSec: 20,
  jobTimeoutMin: 120,
  claudeCmd: "claude",
  permissionMode: "acceptEdits",
  allowedTools: "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch",
  model: "",
};

const stamp = () => new Date().toLocaleTimeString("ko-KR", { hour12: false });
const log = (...a) => console.log(`[${stamp()}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`설정 파일이 없어요: ${CONFIG_PATH}\n먼저 'node supervisor.mjs init' 을 실행하세요.`);
    process.exit(1);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    console.error(`설정 파일을 읽지 못했어요(JSON 형식 오류): ${CONFIG_PATH}\n${e.message}`);
    process.exit(1);
  }
  const c = { ...DEFAULTS, ...raw };
  c.serverUrl = String(c.serverUrl).replace(/\/+$/, "");
  c.workDir = path.resolve(expand(c.workDir));
  c.secretsFile = path.resolve(expand(c.secretsFile));
  c.slots = Math.min(4, Math.max(1, Math.floor(Number(c.slots) || 2)));
  c.pollSec = Math.max(5, Number(c.pollSec) || 15);
  c.heartbeatSec = Math.min(120, Math.max(5, Number(c.heartbeatSec) || 20));
  c.jobTimeoutMin = Math.max(5, Number(c.jobTimeoutMin) || 120);
  if (!c.token || String(c.token).length < 16) {
    console.error("설정 파일에 token 이 없어요. 통제실의 '작업 PC 연결'에서 발급한 토큰을 넣으세요.");
    process.exit(1);
  }
  if (!WORKER_RE.test(c.worker)) {
    console.error("worker 이름은 영문, 숫자, . _ - 로 1~60자여야 해요.");
    process.exit(1);
  }
  return c;
}

// ───────────── init ─────────────
async function init() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, d) => ((await rl.question(d ? `${q} [${d}]: ` : `${q}: `)).trim() || d || "");
  const existing = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) : {};
  const base = { ...DEFAULTS, ...existing };
  const serverUrl = await ask("홈페이지 주소", base.serverUrl);
  const token = await ask("작업 PC 토큰 (통제실 '작업 PC 연결'에서 발급)", base.token);
  const worker = await ask("이 PC 이름(통제실 토큰 이름과 같게)", base.worker);
  const workDir = await ask("앱 폴더를 만들 위치", base.workDir);
  rl.close();

  const cfg = { ...base, serverUrl, token, worker, workDir };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });

  const secrets = path.resolve(expand(cfg.secretsFile));
  if (!fs.existsSync(secrets)) {
    fs.mkdirSync(path.dirname(secrets), { recursive: true });
    fs.writeFileSync(
      secrets,
      "# 앱 제작에 쓰는 외부 서비스 키. 한 줄에 KEY=값. 이 파일은 이 PC에만 있고 홈페이지로 보내지 않아요.\n# 예) PIXELLAB_TOKEN=여기에값\n",
      { mode: 0o600 },
    );
  }
  console.log(`\n설정을 저장했어요: ${CONFIG_PATH}\n키 파일: ${secrets}\n다음: node supervisor.mjs check`);
}

// ───────────── 홈페이지 호출 ─────────────
let cfg;

async function api(method, pathname, body) {
  const headers = { Authorization: `Bearer ${cfg.token}` };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(cfg.serverUrl + pathname, { method, headers, body: payload, signal: AbortSignal.timeout(60_000) });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 본문 없음 */
  }
  return { status: res.status, data };
}

async function check() {
  // 없는 지시에 빈 보고를 보내 본다: 토큰이 맞으면 404, 틀리면 401. 일감은 건드리지 않는다.
  try {
    const r = await api("POST", "/api/factory/report", { jobId: "connection-check" });
    if (r.status === 404) console.log(`연결 OK: 토큰이 맞아요. 통제실에 '연결됨'으로 표시돼요. (${cfg.serverUrl})`);
    else if (r.status === 401) console.log("토큰이 거부됐어요(401). 통제실에서 발급한 토큰을 다시 확인하세요.");
    else if (r.status === 429) console.log("요청이 너무 많다고 해요(429). 잠시 뒤 다시 해 보세요.");
    else console.log(`예상 밖 응답: ${r.status} ${JSON.stringify(r.data)}`);
  } catch (e) {
    console.log(`홈페이지에 연결하지 못했어요: ${e.message}`);
  }
  const probe = spawnSync(cfg.claudeCmd, ["--version"], { shell: IS_WIN, encoding: "utf8" });
  console.log(probe.status === 0 ? `Claude Code: ${probe.stdout.trim()}` : `Claude Code 를 실행하지 못했어요(${cfg.claudeCmd}). 설치와 로그인을 확인하세요.`);
  console.log(`앱 폴더 위치: ${cfg.workDir}`);
  console.log(`동시에 만들 앱: ${cfg.slots}개`);
}

// ───────────── 키 파일 ─────────────
function readSecrets() {
  const out = {};
  if (!fs.existsSync(cfg.secretsFile)) return out;
  for (const line of fs.readFileSync(cfg.secretsFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]{1,63})\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

// ───────────── 앱 폴더 ─────────────
const RULES_BEGIN = "<!-- factory:begin -->";
const RULES_END = "<!-- factory:end -->";

// 이 PC의 Android SDK 위치 (Kotlin 앱의 local.properties 에 쓴다)
function androidSdkDir() {
  const cands = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, IS_WIN && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk")];
  return cands.find((d) => d && fs.existsSync(d)) || "";
}

// 앱 종류(stack)별 만들기·검사 규칙. 서버 lib/factory/jobs.ts 의 STACKS 와 맞춘다.
function stackRules(job) {
  const pkg = job.appSlug.replace(/-/g, "_");
  switch (job.stack) {
    case "flutter":
      return `- Flutter 앱입니다. 프로젝트가 없을 때만 \`flutter create . --project-name ${pkg}\` 로 만드세요.
- 끝내기 전에 \`flutter analyze\` 를 통과시키세요. 가능하면 \`flutter build apk --debug\` 도 시도하고, 환경 때문에 못 하면 그 이유를 결과에 적으세요.
- 스크린샷은 위젯 테스트(골든 등)로 화면을 그려 만들 수 있습니다.`;
    case "kotlin-compose": {
      const sdk = androidSdkDir();
      return `- Android 네이티브 앱(Kotlin + Jetpack Compose, Material 3, 단일 Activity)입니다. 패키지 이름은 \`com.factory.${pkg}\` 로 하세요.
- 프로젝트가 없을 때만 Gradle Kotlin DSL(settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml) 구조로 직접 만드세요.
- 이 PC에는 \`gradle\` 명령이 없습니다. gradlew 가 없으면 Gradle 배포판을 내려받아 \`gradle wrapper\` 로 gradlew 를 만드세요(배포판은 앱 폴더 밖 임시 폴더에).
- Android SDK: ${sdk ? `\`${sdk.replace(/\\/g, "/")}\` (local.properties 의 sdk.dir 에 쓰고, local.properties 는 커밋하지 마세요)` : "찾지 못했어요. 빌드를 못 하면 그 이유를 결과에 적으세요."}
- 끝내기 전에 \`./gradlew assembleDebug\` 를 통과시키세요. 단위 테스트가 있으면 \`./gradlew testDebugUnitTest\` 도 돌리세요.
- 스크린샷은 가능하면 Compose 프리뷰 렌더링(예: Paparazzi/Roborazzi)으로 만들고, 어려우면 건너뛰세요.`;
    }
    case "swift-swiftui":
      return `- iOS 네이티브 앱(SwiftUI)입니다. **이 작업 PC는 Windows라 Swift·Xcode 가 없어서 빌드와 실행을 할 수 없습니다.**
- 소스는 \`Sources/\`(App, Views, Models)에 두고, Mac에서 바로 열 수 있게 XcodeGen 용 \`project.yml\` 을 만드세요(번들 ID \`com.factory.${job.appSlug}\`, iOS 17 이상).
- 컴파일 확인을 못 하니 표준 SwiftUI/Foundation API 만 쓰고, 외부 패키지는 꼭 필요할 때만 Swift Package 로 적으세요.
- README.md 에 Mac에서 여는 방법(\`brew install xcodegen && xcodegen\` → Xcode 실행)을 적으세요. 결과 요약에 "빌드 확인 안 됨"을 분명히 적으세요.
- 스크린샷은 만들 수 없으니 건너뛰세요.`;
    case "nextjs":
      return `- 웹 앱(Next.js App Router, TypeScript)입니다. 프로젝트가 없을 때만 \`npx create-next-app@latest . --ts --eslint --app --src-dir --use-npm --yes\` 로 만드세요.
- 끝내기 전에 \`npm run lint\` 와 \`npm run build\` 를 통과시키세요.
- 스크린샷은 가능하면 \`next start\` 로 띄운 뒤 Playwright 로 주요 화면을 찍으세요. 띄운 서버는 끝내기 전에 반드시 종료하세요.`;
    case "nestjs":
      return `- 백엔드 API 서버(NestJS, TypeScript)입니다. 프로젝트가 없을 때만 \`npx @nestjs/cli@latest new . --package-manager npm --skip-git\` 로 만드세요.
- 끝내기 전에 \`npm run build\` 와 \`npm test\` 를 통과시키세요. 주요 API 는 e2e 테스트(\`npm run test:e2e\`)로 확인하세요.
- README.md 에 API 목록(메서드, 경로, 요청·응답 예)을 적으세요. DB 가 필요하면 기획서에 정해진 게 없을 때 SQLite 로 하세요.
- 화면이 없으니 스크린샷은 건너뛰세요. 띄운 서버는 끝내기 전에 반드시 종료하세요.`;
    default:
      return `- 앱 종류 '${job.stack}' 에 맞는 표준 도구로 프로젝트를 만들고, 끝내기 전에 그 도구의 분석·빌드·테스트를 통과시키세요.`;
  }
}

function rulesFor(job) {
  return `${RULES_BEGIN}
# 앱 공장 작업 규칙 (자동 생성, 이 블록은 수정하지 마세요)

- 앱 이름(폴더 이름): ${job.appSlug} / 표시 이름: ${job.title} / 종류: ${job.stack}
- 사람에게 질문하지 마세요. 정보가 모자라면 합리적으로 가정하고 ASSUMPTIONS.md 에 한 줄씩 적으세요.
- 새 앱이면 PLAN.md 가 기획서입니다. 수정 지시면 CHANGE_REQUEST.md 에 적힌 내용만 반영하고 나머지는 건드리지 마세요.
- 폴더에 이미 작업물이 있으면 처음부터 다시 만들지 말고 이어서 진행하세요. 기획서의 MVP 범위만 구현하고 범위 밖 기능은 추가하지 마세요.
${stackRules(job)}
- 외부 서비스 키는 환경변수로만 읽을 수 있습니다(이 지시에 허용된 이름만). 키 값을 파일, 로그, 커밋에 쓰거나 출력하지 마세요.
- 진행 단계가 바뀔 때마다 .factory/phase.txt 에 한 단어(scaffold, code, build, screenshots, done 중 하나)를 덮어써 주세요.
- 화면 스크린샷을 만들 수 있으면 .factory/screenshots/ 에 png 로 저장하세요(예: home.png, result.png). 못 만들면 건너뛰세요.
- 마지막 응답은 한국어 3~6줄 결과 요약으로 하세요: 만든 화면, 분석/빌드 결과, 사람이 해야 할 일.
${RULES_END}
`;
}

function git(dir, args) {
  return spawnSync("git", args, { cwd: dir, encoding: "utf8", shell: false });
}

function ensureGitignore(dir) {
  const p = path.join(dir, ".gitignore");
  const have = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  const need = [".factory/", ".env", "*.keystore", "key.properties", "local.properties"].filter((l) => !have.split(/\r?\n/).includes(l));
  if (need.length) fs.appendFileSync(p, (have && !have.endsWith("\n") ? "\n" : "") + need.join("\n") + "\n");
}

function prepareDir(job) {
  const dir = path.resolve(cfg.workDir, job.appSlug);
  if (!dir.startsWith(cfg.workDir + path.sep)) throw new Error("앱 폴더 경로가 올바르지 않아요.");

  const existed = fs.existsSync(dir);
  if (job.kind === "revision" && !existed) {
    throw new Error(`이 PC에 앱 폴더가 없어요: ${dir}. 원본을 만든 PC에서 실행하거나 폴더를 옮겨 주세요.`);
  }

  fs.mkdirSync(path.join(dir, ".factory", "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".factory", "history"), { recursive: true });

  if (job.kind === "revision") {
    fs.writeFileSync(path.join(dir, "CHANGE_REQUEST.md"), `# 수정 요청 (${new Date().toISOString()})\n\n${job.planMarkdown}\n`);
  } else {
    fs.writeFileSync(path.join(dir, "PLAN.md"), job.planMarkdown + "\n");
  }
  fs.writeFileSync(path.join(dir, ".factory", "history", `${job.id}.md`), job.planMarkdown + "\n");
  fs.writeFileSync(path.join(dir, ".factory", "phase.txt"), "scaffold\n");

  // CLAUDE.md: 우리 블록만 갈아 끼우고 나머지는 그대로 둔다
  const claudeMd = path.join(dir, "CLAUDE.md");
  const block = rulesFor(job);
  let text = fs.existsSync(claudeMd) ? fs.readFileSync(claudeMd, "utf8") : "";
  const b = text.indexOf(RULES_BEGIN);
  const e = text.indexOf(RULES_END);
  text = b >= 0 && e > b ? text.slice(0, b) + block + text.slice(e + RULES_END.length).replace(/^\n/, "") : (text ? text.trimEnd() + "\n\n" : "") + block;
  fs.writeFileSync(claudeMd, text);

  ensureGitignore(dir);
  if (!fs.existsSync(path.join(dir, ".git"))) git(dir, ["init", "-q"]);
  if (job.kind === "revision") {
    git(dir, ["add", "-A"]);
    git(dir, ["-c", "user.name=app-factory", "-c", "user.email=factory@localhost", "commit", "-q", "-m", `수정 전 저장: ${job.title}`]);
  }
  return dir;
}

function commitResult(dir, job) {
  git(dir, ["add", "-A"]);
  const r = git(dir, ["-c", "user.name=app-factory", "-c", "user.email=factory@localhost", "commit", "-q", "-m", `${job.kind === "new" ? "앱 공장" : "수정"}: ${job.title}`]);
  return r.status === 0;
}

function promptFor(job) {
  if (job.kind === "revision") {
    return "CHANGE_REQUEST.md 에 적힌 수정 내용만 이 앱에 반영하세요. 기존 기획은 PLAN.md 를 참고하되 요청 밖의 부분은 바꾸지 마세요. CLAUDE.md 의 작업 규칙을 따르세요.";
  }
  return "PLAN.md 의 기획서대로 앱의 MVP 를 만드세요. CLAUDE.md 의 작업 규칙을 따르세요. 폴더에 이미 작업물이 있으면 이어서 진행하세요.";
}

// ───────────── 작업 하나 실행 ─────────────
const running = new Map(); // jobId -> state
let shuttingDown = false;

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (IS_WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGTERM"); // 프로세스 그룹 전체(Claude 가 띄운 하위 프로세스 포함)
  } catch {
    /* 이미 끝남 */
  }
}

const brief = (v, n = 140) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

function redactor(secretValues) {
  const vals = secretValues.filter((v) => v && v.length >= 8);
  return (s) => vals.reduce((acc, v) => acc.split(v).join("***"), s);
}

function addLog(st, level, message) {
  const m = st.redact(brief(message, 1500));
  if (!m) return;
  st.logs.push({ level, message: m });
  if (st.logs.length > 300) st.logs.splice(0, st.logs.length - 300);
}

function stop(st, why) {
  if (st.stopped) return;
  st.stopped = why;
  log(`[${st.job.appSlug}] 중지: ${why}`);
  killTree(st.child);
}

function readPhase(st) {
  try {
    const v = fs.readFileSync(path.join(st.dir, ".factory", "phase.txt"), "utf8").trim().toLowerCase();
    if (/^[a-z_-]{1,40}$/.test(v) && v !== st.phase) {
      st.phase = v;
      st.phaseDirty = true;
    }
  } catch {
    /* 아직 없음 */
  }
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

const shotKey = (name, buf) => `${name}:${createHash("sha1").update(buf).digest("hex")}`;

// 작업 시작 때 폴더에 이미 있던 스크린샷(이전 지시의 것)은 올리지 않는다. 내용이 바뀌면 그때 올린다.
function seedShots(st) {
  const dir = path.join(st.dir, ".factory", "screenshots");
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!MIME[path.extname(name).toLowerCase()]) continue;
    try {
      st.shotHashes.add(shotKey(name, fs.readFileSync(path.join(dir, name))));
    } catch {
      /* 읽을 수 없으면 건너뜀 */
    }
  }
}

// 반환값: 아직 다시 시도할 수 있는 실패 개수
async function uploadShots(st) {
  let failed = 0;
  if (st.shotsFull) return 0;
  const dir = path.join(st.dir, ".factory", "screenshots");
  let names = [];
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return 0;
  }
  for (const name of names) {
    const ext = path.extname(name).toLowerCase();
    if (!MIME[ext]) continue;
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    const key = `${name}:${stat.mtimeMs}:${stat.size}`;
    if (st.shots.has(key) || Date.now() - stat.mtimeMs < 3000 || stat.size === 0) continue;
    if (stat.size > 10 * 1024 * 1024) {
      st.shots.add(key);
      addLog(st, "warn", `스크린샷이 10MB 를 넘어서 건너뜀: ${name}`);
      continue;
    }
    // 같은 이름에 같은 내용이면 다시 저장됐어도(수정 시각만 바뀜) 올리지 않는다
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch {
      continue;
    }
    const contentKey = shotKey(name, buf);
    if (st.shotHashes.has(contentKey) || (st.shotTries.get(contentKey) ?? 0) >= 3) {
      st.shots.add(key);
      continue;
    }
    const tries = (st.shotTries.get(contentKey) ?? 0) + 1;
    st.shotTries.set(contentKey, tries);
    if (tries >= 3) st.shots.add(key); // 3번째 시도 뒤에는 더 시도하지 않는다
    const label = path.basename(name, ext).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "shot";
    const form = new FormData();
    form.append("jobId", st.job.id);
    form.append("label", label);
    form.append("file", new Blob([buf], { type: MIME[ext] }), name);
    try {
      const r = await api("POST", "/api/factory/screenshot", form);
      if (r.status === 200) {
        st.shots.add(key);
        st.shotHashes.add(contentKey);
        addLog(st, "info", `스크린샷 올림: ${label}`);
      } else if (r.status === 409) return handleConflict(st, r);
      else if (r.status >= 500 || r.status === 429) {
        failed++;
        addLog(st, "warn", `스크린샷 올리기 실패(${r.status}), 다시 시도해요: ${label}`);
      }
      else if (r.status === 400 && (r.data?.limit || /지시당 \d+장까지/.test(r.data?.message ?? ""))) {
        // 지시당 장수 한도: 남은 파일도 다 같은 400 이므로 이 작업의 업로드를 멈춘다
        st.shotsFull = true;
        addLog(st, "warn", `스크린샷 한도(지시당 ${r.data?.limit ?? "?"}장)에 걸려 이 작업의 업로드를 멈춰요. 나머지는 앱 폴더 .factory/screenshots/ 에 있어요.`);
        return failed;
      }
      else {
        st.shots.add(key); // 400·413 같은 건 다시 해도 같으므로 포기
        st.shotHashes.add(contentKey);
        addLog(st, "warn", `스크린샷 올리기 실패(${r.status}): ${label}`);
      }
    } catch (e) {
      failed++;
      addLog(st, "warn", `스크린샷 올리기 오류, 다시 시도해요: ${e.message}`);
    }
  }
  return failed;
}

function handleConflict(st, r) {
  if (r.data?.cancelled) stop(st, "통제실에서 취소됨");
  else stop(st, `서버가 이 지시를 더 이상 실행 중으로 보지 않음(${r.data?.status ?? "?"})`);
  st.reportable = false;
}

// 로그·단계를 보내고 임대를 연장한다. 동시에 두 번 돌지 않는다.
async function flush(st, extra = {}) {
  if (st.flushing) return st.flushing;
  st.flushing = (async () => {
    try {
      readPhase(st);
      await uploadShots(st);
      if (!st.reportable) return false;
      const batch = st.logs.splice(0, 50);
      const body = { jobId: st.job.id, logs: batch, ...(st.phaseDirty ? { phase: st.phase } : {}), ...extra };
      let r;
      try {
        r = await api("POST", "/api/factory/report", body);
      } catch (e) {
        st.logs.unshift(...batch);
        log(`[${st.job.appSlug}] 보고 실패(네트워크): ${e.message}`);
        return false;
      }
      if (r.status === 200) {
        st.phaseDirty = false;
        return true;
      }
      if (r.status === 409) {
        handleConflict(st, r);
        return false;
      }
      st.logs.unshift(...batch);
      log(`[${st.job.appSlug}] 보고 거부: ${r.status} ${r.data?.message ?? ""}`);
      return false;
    } finally {
      st.flushing = null;
    }
  })();
  return st.flushing;
}

async function finish(st, status, fields) {
  // 마지막 스크린샷이 아직 안 올라갔으면 완료를 보고하기 전에 몇 번 더 시도한다
  for (let i = 0; i < 3 && st.reportable; i++) {
    if ((await uploadShots(st)) === 0) break;
    await sleep(2000);
  }
  for (let i = 0; i < 10 && st.logs.length > 0 && st.reportable; i++) await flush(st);
  if (!st.reportable) return;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      readPhase(st);
      const r = await api("POST", "/api/factory/report", { jobId: st.job.id, logs: st.logs.splice(0, 50), phase: status === "done" ? "done" : st.phase, status, ...fields });
      if (r.status === 200) return log(`[${st.job.appSlug}] 보고 완료: ${status}`);
      if (r.status === 409) return log(`[${st.job.appSlug}] 최종 보고가 거부됨(이미 ${r.data?.status ?? "다른 상태"})`);
      log(`[${st.job.appSlug}] 최종 보고 거부: ${r.status}`);
    } catch (e) {
      log(`[${st.job.appSlug}] 최종 보고 재시도 ${attempt}/4: ${e.message}`);
    }
    await sleep(5000 * attempt);
  }
  log(`[${st.job.appSlug}] 최종 보고를 못 했어요. 임대가 끝나면 서버가 알아서 정리해요.`);
}

async function failEarly(job, reason) {
  log(`[${job.appSlug}] 시작하지 못함: ${reason}`);
  const st = { job, logs: [], phase: null, phaseDirty: false, shots: new Set(), shotHashes: new Set(), shotTries: new Map(), reportable: true, redact: (s) => s, dir: cfg.workDir };
  await finish(st, "failed", { failReason: reason });
}

async function runJob(job) {
  log(`[${job.appSlug}] 시작 (${job.kind === "new" ? "새 앱" : "수정"}, 시도 ${job.attempts}): ${job.title}`);

  const secrets = readSecrets();
  const missing = (job.requiredSecrets ?? []).filter((n) => !secrets[n]);
  if (missing.length) {
    return failEarly(job, `이 PC의 키 파일에 없는 키: ${missing.join(", ")} (${cfg.secretsFile}). 값을 넣고 통제실에서 '다시 시도'를 누르세요.`);
  }

  let dir;
  try {
    dir = prepareDir(job);
  } catch (e) {
    return failEarly(job, e.message);
  }

  const allowed = Object.fromEntries((job.requiredSecrets ?? []).map((n) => [n, secrets[n]]));
  const st = {
    job, dir, child: null, logs: [], phase: "scaffold", phaseDirty: true, shots: new Set(), shotHashes: new Set(), shotTries: new Map(),
    reportable: true, stopped: null, result: null, stderrTail: "", lastText: "", started: Date.now(),
    redact: redactor(Object.values(allowed)),
  };
  running.set(job.id, st);
  seedShots(st);
  addLog(st, "info", `앱 폴더 준비 완료: ${dir}`);

  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", cfg.permissionMode, "--allowedTools", cfg.allowedTools];
  if (cfg.model) args.push("--model", cfg.model);

  const child = spawn(cfg.claudeCmd, args, {
    cwd: dir,
    env: { ...process.env, ...allowed, FACTORY_APP_SLUG: job.appSlug, FACTORY_JOB_ID: job.id },
    shell: IS_WIN,
    detached: !IS_WIN,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  st.child = child;
  child.stdin.on("error", () => {});
  child.stdin.end(promptFor(job));

  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return addLog(st, "info", line);
    }
    if (ev.type === "system" && ev.subtype === "init") addLog(st, "info", `Claude 세션 시작${ev.model ? ` (${ev.model})` : ""}`);
    else if (ev.type === "assistant") {
      for (const b of ev.message?.content ?? []) {
        if (b.type === "text" && b.text?.trim()) {
          st.lastText = b.text;
          addLog(st, "info", b.text);
        } else if (b.type === "tool_use") {
          if (b.name === "Bash") addLog(st, "info", `$ ${brief(b.input?.command)}`);
          else if (b.name === "Write" || b.name === "Edit") addLog(st, "info", `${b.name}: ${brief(b.input?.file_path, 100)}`);
        }
      }
    } else if (ev.type === "result") st.result = ev;
  });
  child.stderr.on("data", (d) => {
    st.stderrTail = (st.stderrTail + d.toString()).slice(-2000);
  });

  const beat = setInterval(() => flush(st), cfg.heartbeatSec * 1000);
  const timer = setTimeout(() => stop(st, `시간 초과(${cfg.jobTimeoutMin}분)`), cfg.jobTimeoutMin * 60 * 1000);

  const code = await new Promise((resolve) => {
    child.on("error", (e) => {
      st.stderrTail += `\n실행 오류: ${e.message}`;
      resolve(-1);
    });
    child.on("close", (c) => resolve(c ?? -1));
  });
  clearInterval(beat);
  clearTimeout(timer);

  try {
    if (st.stopped) {
      if (/^시간 초과/.test(st.stopped)) await finish(st, "failed", { failReason: st.stopped });
      // 취소·종료·서버 쪽 상태 변경이면 서버가 이미 정리했거나(또는 곧 정리) 하므로 보고하지 않는다
    } else if (st.result && !st.result.is_error && code === 0) {
      const committed = commitResult(dir, job);
      const text = st.redact(String(st.result.result ?? st.lastText ?? "").trim());
      const footer = `\n(소요 ${Math.round((Date.now() - st.started) / 60000)}분${st.result.num_turns ? `, ${st.result.num_turns}턴` : ""}${committed ? ", 앱 폴더에 커밋함" : ""})`;
      await finish(st, "done", { summary: (text || "완료(요약 없음)").slice(0, 3800) + footer });
    } else {
      const why = st.redact(String(st.result?.is_error ? st.result.result : "") || st.stderrTail.trim() || `claude 가 비정상 종료(코드 ${code})`);
      await finish(st, "failed", { failReason: why.slice(-1800) });
    }
  } finally {
    running.delete(job.id);
  }
}

// ───────────── 대기열 확인 ─────────────
let paused = false;

async function loop() {
  let delay = cfg.pollSec * 1000;
  while (!shuttingDown) {
    try {
      const free = cfg.slots - running.size;
      if (free > 0) {
        const r = await api("GET", `/api/factory/next?worker=${encodeURIComponent(cfg.worker)}&slots=${free}`);
        if (r.status === 200) {
          delay = cfg.pollSec * 1000;
          // 통제실 일시 정지: 새 일감만 받지 않고 폴링은 계속한다(연결됨 표시 유지). 돌던 작업은 그대로 끝까지 간다.
          const nowPaused = r.data?.paused === true;
          if (nowPaused !== paused) {
            paused = nowPaused;
            log(paused ? "일시 정지됨 (홈페이지)" : "다시 시작됨");
          }
          for (const job of paused ? [] : r.data.jobs ?? []) {
            if ([...running.values()].some((s) => s.job.appSlug === job.appSlug)) {
              failEarly(job, "이 PC에서 같은 앱 이름의 작업이 이미 돌고 있어요.");
              continue;
            }
            runJob(job).catch((e) => log(`[${job.appSlug}] 예기치 못한 오류: ${e.stack || e.message}`));
          }
        } else if (r.status === 401) {
          log("토큰이 거부됐어요(401). 통제실에서 토큰이 지워졌는지 확인하세요. 1분 뒤 다시 시도해요.");
          delay = 60_000;
        } else {
          log(`대기열 응답 이상: ${r.status} ${r.data?.message ?? ""}`);
          delay = Math.min(delay * 2, 120_000);
        }
      }
    } catch (e) {
      log(`홈페이지에 연결하지 못했어요: ${e.message}`);
      delay = Math.min(delay * 2, 120_000);
    }
    await sleep(delay);
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("종료합니다. 돌던 작업은 멈추고, 서버가 10분 안에 대기열로 되돌려요.");
  for (const st of running.values()) {
    st.stopped = "감독 프로그램 종료";
    killTree(st.child);
  }
  setTimeout(() => process.exit(0), 1500);
}

// ───────────── 시작 ─────────────
const command = process.argv[2];
if (command === "init") {
  await init();
} else {
  cfg = loadConfig();
  if (command === "check") await check();
  else {
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    fs.mkdirSync(cfg.workDir, { recursive: true });
    log(`감독 프로그램 시작: ${cfg.worker} → ${cfg.serverUrl} (동시 ${cfg.slots}개, ${cfg.pollSec}초마다 확인)`);
    log(`앱 폴더: ${cfg.workDir}`);
    await loop();
  }
}
