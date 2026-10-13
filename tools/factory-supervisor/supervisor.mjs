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
import { Readable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { maybeUpdate, notePoll, reportInfo, requestUpdateNow, startupGuard } from "./update.mjs";
import {
  maskText,
  prepareReleaseKey,
  readFailFile,
  realAab,
  releaseRules,
  reportPcPaths,
  resumeSection,
  runKeyScan,
  mergePrivacyDraft,
  sendOutbox,
  sentRelease,
  syncKeyPasswords,
} from "./release.mjs";
import { maintenanceBusy, onNext as onMaintenance } from "./maintenance.mjs";
import { expectedSigner, gitCommitOf, judgeSignature, readApkInfo, sha256File, uploadTestApk, verifyApk } from "./apk.mjs";
import { compactSession } from "./compact.mjs";
import { runKeyTasks } from "./keyvault.mjs";
import { runUploadTest } from "./uploadtest.mjs";
import { refreshPathFromRegistry, toolLabel } from "./pcenv.mjs";
import { maybeRestart, onRestartSignal, readRestartMark, restartPending, restartQuery } from "./restart.mjs";
import { KEY_IGNORE, addIgnoreLines, keyFilesToCommit } from "./keyguard.mjs";
import { checkStoreAssets, envSummary, playUploadAab, playUploadStore, sendStoreImages, storeEnv, storeEnvSection, storeReport, uploadReviewVideo } from "./store.mjs";
import { acquireWorkspace, advertisedEngines, engineOf, ENGINE_LABELS, eventDecoder, handoffPrompt, makeHandoffEntry, recordLifecycle, redactAiText, saveHandoff, startAi, verifyWorkspace } from "./ai-runner.mjs";
import { checksFromVerification, headOf } from "./handoff.mjs";
import { brokerRules, brokerSettings, createBroker, TOOL_MODE_LABELS, toolkitSecretNames } from "./toolbroker.mjs";
import { findBash, reportProvisionNames, syncProvisions } from "./keyprovision.mjs";
import { aiToolStatus, reportSecretNames, syncSecretEntries } from "./secrets.mjs";
import { createAssetUploader } from "./assetupload.mjs";
import { noteRateLimitEvent, refreshAfterTask } from "./ai-limits.mjs";
import { startDeviceStats } from "./devicestats.mjs";
import { startToolkitReport } from "./toolkitinfo.mjs";
import { DEFAULT_APP_SLOTS, effectiveSlots, pcSlots, planTake } from "./slots.mjs";
import { DEFAULT_MEMORY_REMOTE, memoryReport, setMemoryConfig } from "./memory.mjs";

// 실행 모드면 맨 먼저: 현재 커밋을 찍고, 방금 자동 업데이트한 버전이면 시험 기간(30초)을 잰다. (아래 코드가 시작 중에 죽어도 다음 시작 때 되돌릴 수 있게)
if (!process.argv[2]) startupGuard();

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
  slots: DEFAULT_APP_SLOTS, // PC 기본값. 통제실 [설정]의 '동시에 만들 앱 수'(/next 의 appSlots)가 있으면 그 값이 우선
  pollSec: 15,
  heartbeatSec: 20,
  jobTimeoutMin: 120,
  claudeCmd: "claude",
  codexCmd: IS_WIN ? "codex.cmd" : "codex",
  codexModel: "",
  codexEnabled: true,
  permissionMode: "acceptEdits",
  allowedTools: "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch",
  model: "",
  selfdevDir: "~/dev/factory/selfdev", // 공장 정비 전용 체크아웃
  memoryRemote: DEFAULT_MEMORY_REMOTE, // 작업 메모리(.factory/memory/) 푸시 주소. 서버2 전용(github.com 은 거부). {folder} 를 쓰면 폴더마다 저장소, 없으면 저장소 하나에 폴더 이름 브랜치. ""이면 로컬에만
  deployRemote: "serverpc:git-server/repo/developWeb.git", // 정비 [배포] 때 push 할 서버 배포 저장소(고정)
  toolkitDir: "", // 게임 툴킷(파이썬 도구) 폴더. 비우면 <workDir>/game-toolkit (도구 요청 중계의 toolkit.run)
  pythonCmd: IS_WIN ? "python" : "python3",
  appKitDir: "~/dev/factory/app-kit", // 통제실 키를 서버2 .env 에 반영하는 scripts/provision-key.sh 가 있는 폴더(호출만 한다)
  bashCmd: "", // provision-key.sh 를 돌릴 bash. 비우면 Windows 는 Git Bash 를 찾고, 그 밖에는 PATH 의 bash
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
  c.appKitDir = path.resolve(expand(c.appKitDir));
  c.toolkitDir = c.toolkitDir ? path.resolve(expand(c.toolkitDir)) : path.join(c.workDir, "game-toolkit");
  c.pcSlots = pcSlots(raw); // { value, custom }: 서버 값이 없을 때 쓰는 PC 값, 사람이 따로 정했는지
  c.slots = c.pcSlots.value;
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

async function api(method, pathname, body, { timeoutMs = 60_000 } = {}) {
  const headers = { Authorization: `Bearer ${cfg.token}` };
  const extra = {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body && typeof body === "object" && typeof body.streamFile === "string") {
    // 큰 파일(검토 영상): 메모리에 통째로 올리지 않고 파일에서 흘려 보낸다
    headers["Content-Type"] = body.type || "application/octet-stream";
    headers["Content-Length"] = String(body.size);
    payload = Readable.toWeb(fs.createReadStream(body.streamFile));
    extra.duplex = "half";
  }
  else if (body instanceof Uint8Array) {
    headers["Content-Type"] = "application/octet-stream"; // 검토 영상 조각
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(cfg.serverUrl + pathname, { method, headers, body: payload, ...extra, signal: AbortSignal.timeout(timeoutMs) });
  let data = null;
  // JSON 이 아닌 응답(nginx 413 HTML 등)도 실패 사유에 남길 수 있게 본문 앞부분을 text 로 같이 돌려준다
  let text = "";
  try {
    text = await res.text();
    data = JSON.parse(text);
  } catch {
    /* 본문 없음·JSON 아님 */
  }
  return { status: res.status, data, text: data ? "" : text.slice(0, 2000) };
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
  console.log(`동시에 만들 앱: ${cfg.slots}개 (PC 설정값. 통제실 [설정]에서 정한 값이 있으면 그 값이 우선)`);
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

// 규칙의 Android SDK 줄(PC 마다 다르다). 홈페이지가 보낸 규칙의 {{ANDROID_SDK}} 도 이걸로 채운다.
function sdkLine() {
  const sdk = androidSdkDir();
  return sdk ? `\`${sdk.replace(/\\/g, "/")}\` (local.properties 의 sdk.dir 에 쓰고, local.properties 는 커밋하지 마세요)` : "찾지 못했어요. 빌드를 못 하면 그 이유를 결과에 적으세요.";
}

// 홈페이지가 일감과 같이 보낸 작업 규칙(job.rules). 없거나 이상하면 null → 코드 안 기본값(rulesFor)을 쓴다.
function serverRules(job) {
  const t = job.rules;
  if (typeof t !== "string" || !t.trim() || t.length > 60_000 || t.includes("<!-- factory:")) return null;
  return `${RULES_BEGIN}\n${t.trim().replace(/\{\{ANDROID_SDK\}\}/g, sdkLine())}\n${RULES_END}\n`;
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
      return `- Android 네이티브 앱(Kotlin + Jetpack Compose, Material 3, 단일 Activity)입니다. 패키지 이름은 \`com.factory.${pkg}\` 로 하세요.
- 프로젝트가 없을 때만 Gradle Kotlin DSL(settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml) 구조로 직접 만드세요.
- 이 PC에는 \`gradle\` 명령이 없습니다. gradlew 가 없으면 Gradle 배포판을 내려받아 \`gradle wrapper\` 로 gradlew 를 만드세요(배포판은 앱 폴더 밖 임시 폴더에).
- Android SDK: ${sdkLine()}
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
- 키 파일(.jks/.keystore/.p12/.pfx, key.properties, secrets.env 와 확장자 없는 키스토어)은 절대 git add 하지 마세요. 감독 프로그램이 발견하면 앱 폴더 커밋을 멈춰요.
- 에뮬레이터, 개발 서버, 감시 프로세스처럼 백그라운드로 띄운 것은 마지막 응답 전에 반드시 직접 끄세요. 남아 있으면 작업이 끝나지 않아 감독 프로그램이 강제로 정리해요.
- 진행 단계가 바뀔 때마다 .factory/phase.txt 에 한 단어(scaffold, code, build, screenshots, done 중 하나)를 덮어써 주세요.
- 화면 스크린샷을 만들 수 있으면 .factory/screenshots/ 에 png 로 저장하세요(예: home.png, result.png). 못 만들면 건너뛰세요.
- 마지막 응답은 한국어 3~6줄 결과 요약으로 하세요: 만든 화면, 분석/빌드 결과, 사람이 해야 할 일.
${releaseRules(job)}${RULES_END}
`;
}

// 앱 일감 Claude 가 정비 쪽 폴더(정비 체크아웃·감독 프로그램 실행 체크아웃)와 공장 설정·비밀 파일을 건드리지 않게 막는 설정.
// 정비는 앱 폴더를, 앱 일감은 정비 폴더를 고치지 않는다(작업과 커밋이 서로 섞이지 않게). 못 만들면 null(설정 없이 실행)
function appPermissionSettings() {
  try {
    const file = path.join(cfg.workDir, "app-claude-settings.json");
    // 권한 규칙의 절대 경로는 //경로. 윈도우 경로는 POSIX 꼴로(C:\Users\x → //c/Users/x)
    const abs = (p) => path.resolve(p).replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase()).replace(/^\/+/, "");
    const deny = [];
    for (const d of [expand(cfg.selfdevDir || "~/dev/factory/selfdev"), path.join(cfg.workDir, "supervisor-src")]) {
      deny.push(`Edit(//${abs(d)}/**)`); // Edit 규칙이 Write 등 모든 파일 수정 도구를 막는다
    }
    const root = abs(cfg.workDir);
    deny.push(`Edit(//${root}/*.json)`, `Edit(//${root}/*.sh)`, `Edit(//${root}/secrets.env)`);
    deny.push(`Read(//${root}/supervisor.config.json)`, `Read(//${root}/secrets.env)`);
    fs.writeFileSync(file, JSON.stringify({ permissions: { deny } }, null, 2));
    return file.replace(/\\/g, "/");
  } catch {
    return null;
  }
}

function git(dir, args) {
  return spawnSync("git", args, { cwd: dir, encoding: "utf8", shell: false });
}

// 일감마다(새 폴더 포함) .gitignore 에 공장 파일·키 파일 패턴이 없으면 덧붙인다(기존 내용 유지)
function ensureGitignore(dir) {
  if (isExternalRepo(dir)) return ensureExclude(dir);
  addIgnoreLines(dir, [".factory/", ".env", "local.properties", ...KEY_IGNORE]);
}

// ───────── 외부 저장소(가져와서 고치는 기존 저장소) ─────────
// 앱 폴더에 .factory/external 이 있거나 'prod' 원격이 있으면 외부 저장소로 본다(예: 서버에 바로 배포되는 image-upload-server).
// 외부 저장소에서는 감독 프로그램이 커밋하지 않고(수정 전 저장·결과 커밋 없음), 공장 파일은 추적되지 않는
// .git/info/exclude 로만 뺀다(.gitignore 도 건드리지 않음). 코드 커밋은 일감 Claude 가 직접 하고, 배포 브랜치에 공장 문서가 섞이지 않는다.
const FACTORY_FILES = [".factory/", "PLAN.md", "CHANGE_REQUEST.md", "RELEASE_REQUEST.md", "CLAUDE.local.md"];

function isExternalRepo(dir) {
  if (fs.existsSync(path.join(dir, ".factory", "external"))) return true;
  if (!fs.existsSync(path.join(dir, ".git"))) return false;
  return git(dir, ["remote"]).stdout?.split(/\r?\n/).some((r) => r.trim() === "prod") ?? false;
}

const isTracked = (dir, file) => git(dir, ["ls-files", "--error-unmatch", "--", file]).status === 0;

// 외부 저장소의 공장 규칙 파일: 저장소가 CLAUDE.md 를 가지고 있으면 CLAUDE.local.md(추적 안 함)에, 아니면 CLAUDE.md(추적 안 함)에 쓴다
const rulesFileFor = (dir) => (isExternalRepo(dir) && isTracked(dir, "CLAUDE.md") ? "CLAUDE.local.md" : "CLAUDE.md");

function ensureExclude(dir) {
  const p = path.join(dir, ".git", "info", "exclude");
  if (!fs.existsSync(path.dirname(p))) return;
  const lines = [...FACTORY_FILES, ".env", "local.properties", ...KEY_IGNORE];
  if (!isTracked(dir, "CLAUDE.md")) lines.push("CLAUDE.md");
  const have = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  const cur = new Set(have.split(/\r?\n/).map((l) => l.trim()));
  const need = [...new Set(lines)].filter((l) => !cur.has(l));
  if (need.length) fs.appendFileSync(p, (have && !have.endsWith("\n") ? "\n" : "") + "# 앱 공장 파일(감독 프로그램)\n" + need.join("\n") + "\n");
}

const EXTERNAL_NOTE = `
## 외부 저장소 (이 폴더 전용)
- 이 폴더는 원래 있던 저장소예요. 감독 프로그램은 이 폴더에 커밋하지 않아요. 코드 변경은 직접 의미 있는 커밋으로 남기세요(브랜치는 지시가 없으면 지금 브랜치).
- 공장 파일(PLAN.md, CHANGE_REQUEST.md, RELEASE_REQUEST.md, 이 규칙 파일, .factory/)은 .git/info/exclude 로 git 에서 빠져 있어요. 커밋하거나 .gitignore 에 넣지 마세요.
- push 는 지시문이 허락할 때만 하세요.
`;

// 앱 폴더 커밋(git add -A). 키 파일이 들어가려 하면 add·커밋을 하지 않고 job.keyBlocked 에 남긴다(완료 보고 때 통제실에 표시)
function safeCommit(dir, job, message) {
  const blocked = keyFilesToCommit(dir);
  if (blocked.length) {
    job.keyBlocked = blocked;
    log(`[${job.appSlug}] 키 파일이 커밋에 들어가려 해서 커밋을 멈췄어요: ${blocked.join(", ")}`);
    return false;
  }
  git(dir, ["add", "-A"]);
  return git(dir, ["-c", "user.name=app-factory", "-c", "user.email=factory@localhost", "commit", "-q", "-m", message]).status === 0;
}

function prepareDir(job) {
  const dir = path.resolve(cfg.workDir, job.appSlug);
  if (!dir.startsWith(cfg.workDir + path.sep)) throw new Error("앱 폴더 경로가 올바르지 않아요.");

  const existed = fs.existsSync(dir);
  const onExisting = job.kind === "revision" || job.kind === "release"; // 수정·출시 준비는 기존 폴더에서
  if (onExisting && !existed) {
    throw new Error(`이 PC에 앱 폴더가 없어요: ${dir}. 원본을 만든 PC에서 실행하거나 폴더를 옮겨 주세요.`);
  }

  fs.mkdirSync(path.join(dir, ".factory", "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".factory", "history"), { recursive: true });

  if (job.kind === "revision") {
    fs.writeFileSync(path.join(dir, "CHANGE_REQUEST.md"), `# 수정 요청 (${new Date().toISOString()})\n\n${job.planMarkdown}\n`);
  } else if (job.kind === "release") {
    // 스토어 수정·(검토 단계가 있는) 첫 출시: 이 PC 의 에뮬레이터·HyperFrames 환경을 지시문 끝에 붙이고, .factory/store/ 를 준비한다
    let env = "";
    const redoNote = job.release?.review?.redoNote || null;
    if (job.release?.kind === "store" || (job.release?.kind === "first" && job.release?.review?.required)) {
      fs.mkdirSync(path.join(dir, ".factory", "store", "screenshots"), { recursive: true });
      // 새로 시작하면 지난 건너뜀 표시는 지운다(재시도·다시 만들기는 그대로: 다시 만들지 않는 항목의 표시를 남긴다)
      if (!job.release.resumeFrom && !redoNote) fs.rmSync(path.join(dir, ".factory", "store", "status.json"), { force: true });
      try {
        job.storeEnv = storeEnv();
        env = storeEnvSection(job.storeEnv);
      } catch (e) {
        env = `\n\n## 이 PC 환경\n- 확인하지 못했어요: ${e.message}\n`;
      }
    }
    // [다시 만들기]: 검토에서 사람이 남긴 메모. 그 항목만 다시 만든다
    const redo = redoNote
      ? `\n\n## 다시 만들기 요청 (검토에서 사람이 남긴 메모)\n${maskText(String(redoNote)).slice(0, 2000)}\n- 메모에 적힌 항목만 다시 만드세요. 나머지 파일(.factory/store/ 의 이미지·문구, AAB, outbox)은 그대로 두세요. 키·빌드는 메모가 요구할 때만 다시 하세요.\n- 끝나면 다시 검토 대기로 가요.\n`
      : "";
    fs.writeFileSync(path.join(dir, "RELEASE_REQUEST.md"), `# 출시 준비 요청 (${new Date().toISOString()})\n\n${job.planMarkdown}\n${resumeSection(job)}${redo}${env}`);
    fs.mkdirSync(path.join(dir, ".factory", "outbox"), { recursive: true });
    fs.rmSync(path.join(dir, ".factory", "fail.json"), { force: true }); // 지난 시도의 실패 표시는 지운다
    // 시험용 APK: 새로 시작하면 지난 APK 정보는 지운다(재시도는 그대로 써서 이어 간다)
    if (job.release?.kind === "apk" && !job.release.resumeFrom) fs.rmSync(path.join(dir, ".factory", "apk.json"), { force: true });
  } else {
    fs.writeFileSync(path.join(dir, "PLAN.md"), job.planMarkdown + "\n");
  }
  fs.writeFileSync(path.join(dir, ".factory", "history", `${job.id}.md`), job.planMarkdown + "\n");
  // 출시 일감은 그 종류의 첫 단계(재시도면 그 단계)로 시작한다
  const firstPhase = job.kind === "release" && job.release ? job.release.resumeFrom || job.release.stages?.[0] || "scaffold" : "scaffold";
  fs.writeFileSync(path.join(dir, ".factory", "phase.txt"), `${firstPhase}\n`);

  // CLAUDE.md: 우리 블록만 갈아 끼우고 나머지는 그대로 둔다
  const external = isExternalRepo(dir);
  const claudeMd = path.join(dir, rulesFileFor(dir));
  const fromServer = serverRules(job);
  let block = fromServer ?? rulesFor(job);
  if (external) block = block.replace(RULES_END, `${EXTERNAL_NOTE}${RULES_END}`);
  // 도구 요청 중계가 켜져 있을 때만 사용법을 붙인다(꺼짐이면 예전 규칙 그대로)
  const toolNote = brokerRules(toolBroker.mode, cfg.toolkitDir);
  if (toolNote) block = block.replace(RULES_END, `${toolNote}${RULES_END}`);
  job.rulesSource = fromServer ? "홈페이지" : "기본값(감독 프로그램 코드)";
  let text = fs.existsSync(claudeMd) ? fs.readFileSync(claudeMd, "utf8") : "";
  const b = text.indexOf(RULES_BEGIN);
  const e = text.indexOf(RULES_END);
  text = b >= 0 && e > b ? text.slice(0, b) + block + text.slice(e + RULES_END.length).replace(/^\n/, "") : (text ? text.trimEnd() + "\n\n" : "") + block;
  fs.writeFileSync(claudeMd, text);

  ensureGitignore(dir);
  if (!fs.existsSync(path.join(dir, ".git"))) git(dir, ["init", "-q"]);
  if (onExisting && !external) safeCommit(dir, job, `${job.kind === "release" ? "출시 준비 전 저장" : "수정 전 저장"}: ${job.title}`);
  return dir;
}

function commitResult(dir, job) {
  // 외부 저장소: 커밋하지 않는다(이번 일감에서 저장소를 가져왔으면 여기서 처음 알게 되므로 공장 파일을 이제 뺀다)
  if (isExternalRepo(dir)) {
    ensureExclude(dir);
    const left = git(dir, ["status", "--porcelain"]).stdout?.trim();
    log(`[${job.appSlug}] 외부 저장소라 커밋하지 않았어요${left ? ` (커밋 안 된 변경 ${left.split(/\r?\n/).length}개)` : ""}.`);
    return false;
  }
  return safeCommit(dir, job, `${job.kind === "new" ? "앱 공장" : job.kind === "release" ? "출시 준비" : "수정"}: ${job.title}`);
}

function promptFor(job) {
  // 홈페이지가 보낸 첫 지시문이 있으면 그걸 쓴다
  if (typeof job.prompt === "string" && job.prompt.trim() && job.prompt.length <= 4000) return job.prompt.trim();
  if (job.kind === "release") {
    return "RELEASE_REQUEST.md 에 적힌 출시 일감을 하세요. '앱 업데이트'가 아니면 앱 기능은 바꾸지 말고, CLAUDE.md 작업 규칙의 '출시 준비' 형식대로 .factory/outbox/ 에 결과를 저장하세요.";
  }
  if (job.kind === "revision") {
    return "CHANGE_REQUEST.md 에 적힌 수정 내용만 이 앱에 반영하세요. 기존 기획은 PLAN.md 를 참고하되 요청 밖의 부분은 바꾸지 마세요. CLAUDE.md 의 작업 규칙을 따르세요.";
  }
  return "PLAN.md 의 기획서대로 앱의 MVP 를 만드세요. CLAUDE.md 의 작업 규칙을 따르세요. 폴더에 이미 작업물이 있으면 이어서 진행하세요.";
}

// ───────────── 작업 하나 실행 ─────────────
const RESULT_GRACE_SEC = 90; // 결과(result)를 낸 뒤 Claude 가 스스로 끝나기를 기다리는 시간
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

// 키 비밀번호(keyValues)는 짧을 수 있어 4자 이상이면 가린다. 마지막에 비밀번호 모양(storePassword=… 등)도 가린다.
function redactor(secretValues, keyValues = []) {
  const vals = [...secretValues.filter((v) => v && v.length >= 4), ...keyValues.filter((v) => v && v.length >= 4)];
  return (s) => maskText(vals.reduce((acc, v) => acc.split(v).join("***"), s));
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
      const toolDirty = st.toolDirty;
      const body = { jobId: st.job.id, logs: batch, ...(st.phaseDirty ? { phase: st.phase } : {}), ...(toolDirty && st.broker ? { toolRequests: st.broker.list() } : {}), ...extra };
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
        if (toolDirty) st.toolDirty = false;
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
  st.job.aiOutcome = { ...st.job.aiOutcome, status, summary: fields?.summary, failReason: fields?.failReason, sessionId: st.sessionId };
  if (st.dir !== cfg.workDir) recordLifecycle(st.dir, st.job.aiEngine, status, st.job.id);
  // 인계 기록 항목: Git·변경 파일·검사 같은 사실은 여기서 직접 채우고, 요청·남은 작업·주의는 AI 최종 답변의 '## 인계' 블록에서 읽는다.
  // 실패한 일감도 남긴다. 같은 항목을 통제실에 보고하고(일감 상세 '인계 기록'), 폴더의 .factory/handoff.json 에도 쓴다
  if (st.dir !== cfg.workDir) {
    try {
      const o = st.job.aiOutcome;
      const failed = status === "failed";
      const reason = String(fields?.failReason ?? "");
      const verification = o.verification ?? (failed && /^필수 검증 실패/.test(reason) ? { ok: false, reason: reason.replace(/^필수 검증 실패:\s*/, "") } : null);
      const checks = verification ? checksFromVerification(verification, "필수 검증") : [{ name: "필수 검증", result: "건너뜀", detail: failed ? "검증 전에 실패" : "해당 없음" }];
      o.handoffEntry = makeHandoffEntry(st.dir, { ...o.handoff, engine: st.job.aiEngine, taskId: st.job.id, status: failed ? "failed" : "done", summary: st.handoffText ?? fields?.summary, failReason: failed ? reason : undefined, checks }, st.redact);
      fields = { ...fields, handoff: o.handoffEntry };
    } catch (e) { addLog(st, "warn", `인계 기록 만들기 실패: ${maskText(e.message)}`); }
  }
  // 키 파일 때문에 앱 폴더 커밋을 멈췄으면 통제실에 보이게(파일 이름만)
  if (st.job.keyBlocked?.length && !st.keyBlockedShown) {
    st.keyBlockedShown = true;
    const msg = `⚠️ 키 파일이 커밋에 들어가려 해요: ${st.job.keyBlocked.join(", ")}. 앱 폴더 커밋을 멈췄어요(파일은 그대로). 통제실 설정 → 키 보관함의 [커밋에서 빼기]로 정리하세요.`;
    addLog(st, "warn", msg);
    if (typeof fields?.summary === "string") fields = { ...fields, summary: `${msg}\n${fields.summary}`.slice(0, 3990) };
  }
  // 마지막 스크린샷이 아직 안 올라갔으면 완료를 보고하기 전에 몇 번 더 시도한다
  for (let i = 0; i < 3 && st.reportable; i++) {
    if ((await uploadShots(st)) === 0) break;
    await sleep(2000);
  }
  // 도구 중계가 만든 이미지(.factory/assets/)도 마지막으로 한 번 더 올린다. 실패해도 일감 결과는 그대로
  if (st.assets && st.reportable) await st.assets.upload();
  for (let i = 0; i < 10 && st.logs.length > 0 && st.reportable; i++) await flush(st);
  if (!st.reportable) return;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      readPhase(st);
      const tools = st.broker?.list() ?? [];
      const r = await api("POST", "/api/factory/report", { jobId: st.job.id, logs: st.logs.splice(0, 50), phase: status === "done" ? "done" : st.phase, status, ...(tools.length ? { toolRequests: tools } : {}), ...fields });
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
  const st = { job, logs: [], phase: null, phaseDirty: false, shots: new Set(), shotHashes: new Set(), shotTries: new Map(), reportable: true, redact: maskText, dir: cfg.workDir };
  await finish(st, "failed", { failReason: reason });
}

async function runJob(job) {
  let lock;
  let dir;
  try {
    job.aiEngine = engineOf(job.aiEngine);
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(job.appSlug)) throw new Error("앱 폴더 이름이 올바르지 않습니다.");
    dir = path.join(cfg.workDir, job.appSlug);
    lock = acquireWorkspace(dir, { engine: job.aiEngine, taskId: job.id });
    // 인계 기록에 쓸 일감 정보(요청은 앞부분만, 기획서 전문은 넣지 않음)
    job.aiOutcome = { handoff: { kind: "job", appSlug: job.appSlug, title: job.title, request: `${job.kind === "new" ? "새 앱" : job.kind === "release" ? "출시 준비" : "수정"}: ${String(job.planMarkdown ?? job.prompt ?? "").replace(/^#.*$/gm, " ").slice(0, 600)}`, model: job.aiEngine === "claude" ? job.aiModel || "기본" : cfg.codexModel || "기본" } };
    await runJobUnlocked(job, lock);
  } catch (e) {
    await failEarly(job, e.message);
  } finally {
    running.delete(job.id);
    if (lock) {
      try { if (fs.existsSync(dir)) saveHandoff(dir, { engine: job.aiEngine, taskId: job.id, status: "interrupted", ...job.aiOutcome }, (s) => redactAiText(redactor([cfg.token, ...Object.values(readSecrets())])(s))); }
      catch (e) { log(`[${job.appSlug}] 상태 인계 기록 실패: ${maskText(e.message)}`); }
      lock.release();
    }
  }
}

async function runJobUnlocked(job, lock) {
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
  if (job.aiOutcome?.handoff) job.aiOutcome.handoff.startHead = headOf(dir) || undefined;

  const allowed = Object.fromEntries((job.requiredSecrets ?? []).map((n) => [n, secrets[n]]));
  const rel = job.kind === "release" ? (job.release ?? null) : null; // 서버가 준 출시 정보(종류·단계·outbox·키). 예전 서버면 없음
  const st = {
    job, dir, child: null, logs: [], phase: "scaffold", phaseDirty: true, shots: new Set(), shotHashes: new Set(), shotTries: new Map(),
    reportable: true, stopped: null, result: null, stderrTail: "", lastText: "", started: Date.now(),
    redact: (s) => redactAiText(redactor([cfg.token, ...Object.values(secrets)])(s)),
  };
  running.set(job.id, st);
  readPhase(st);
  seedShots(st);
  // 도구 중계 결과 이미지: 시작 때 이미 있던 파일(이전 일감 것)은 올리지 않는다
  st.assets = createAssetUploader({ appDir: dir, jobId: job.id, post: (form) => api("POST", "/api/factory/screenshot", form), log: (level, m) => addLog(st, level, m) });
  st.assets.seed();
  addLog(st, "info", `앱 폴더 준비 완료: ${dir} (작업 규칙: ${job.rulesSource})`);

  if (rel) {
    addLog(st, "info", `출시 일감 종류: ${rel.kindLabel ?? rel.kind}${rel.resumeFrom ? ` · 재시도: '${rel.resumeFrom}' 단계부터` : ""}`);
    // 검토 승인 뒤 반영·업로드·홈페이지 반영 단계만 다시, 검토 자료만 다시 올리기: Claude 없이 감독 프로그램이 한다(남아 있던 outbox·스토어 자료로).
    // 검토가 필요한데 승인 전이면 finishRelease 가 검토 대기로만 보낸다(업로드하지 않음)
    if (["homepage", "upload", "review", "videolink"].includes(rel.resumeFrom)) {
      try {
        const what =
          rel.resumeFrom === "videolink"
            ? "YouTube 링크를 Play 등록정보 영상에 넣었어요"
            : rel.review?.required && rel.review.approved && rel.resumeFrom !== "review"
            ? `검토 승인 뒤 ${rel.resumeFrom === "upload" ? "Play 업로드·홈페이지 반영" : "홈페이지 반영"}을 했어요`
            : rel.resumeFrom === "review"
              ? "검토 자료를 다시 올렸어요"
              : rel.resumeFrom === "upload"
                ? "Play 업로드부터 다시 했어요"
                : "홈페이지 반영 단계만 다시 했어요";
        return await finishRelease(st, { summary: `${what}(Claude 없이 남아 있던 결과로).`, from: rel.resumeFrom });
      } finally {
        running.delete(job.id);
      }
    }
    // 첫 출시: 업로드 키 준비(앱 자체 key.properties 가 있으면 그대로)
    let key;
    try {
      key = prepareReleaseKey({ job, dir, secrets, log: (m) => log(`[${job.appSlug}] ${m}`) });
    } catch (e) {
      key = { ok: false, reason: `키 준비 중 오류: ${e.message}` };
    }
    if (!key.ok) {
      try {
        return await finish(st, "failed", { failReason: st.redact(key.reason), failStage: "key" });
      } finally {
        running.delete(job.id);
      }
    }
    Object.assign(allowed, key.env);
    st.keyEnv = key.env; // 시험용 APK: 서명 인증서 비교에 쓴다(값은 보고하지 않음)
    st.redact = (s) => redactAiText(redactor([cfg.token, ...Object.values(secrets).filter((v) => !key.secrets.includes(v))], key.secrets)(s));
    if (key.note) addLog(st, "info", key.note);
  }

  const appSettings = appPermissionSettings();
  // 도구 요청 중계가 켜져 있으면 툴킷 도구에 선언된 키는 AI 환경에서 빼고 도구 프로세스에만 준다(꺼짐이면 예전 그대로)
  const toolOnly = toolBroker.mode === "off" ? [] : toolkitSecretNames(cfg.toolkitDir);
  const aiSecrets = Object.fromEntries(Object.entries(allowed).filter(([k]) => !toolOnly.includes(k)));
  if (toolOnly.some((k) => k in allowed)) addLog(st, "info", `도구 전용 키는 AI 환경에 넣지 않았어요: ${toolOnly.filter((k) => k in allowed).join(", ")}`);
  recordLifecycle(dir, job.aiEngine, "session-start", job.id);
  // 승인 때 고른 모델(Claude Code 만). 허용 목록 밖이면 startAi 가 던져 일감이 실패로 보인다(다른 모델로 바꿔 돌리지 않음)
  const model = job.aiEngine === "claude" ? job.aiModel || null : null;
  if (job.aiEngine === "claude") addLog(st, "info", `모델: ${model ?? "기본 설정(--model 없음)"}`);
  const child = startAi(job.aiEngine, cfg, {
    model,
    settings: job.aiEngine === "claude" ? appSettings : undefined,
    cwd: dir,
    env: { ...process.env, ...aiSecrets, FACTORY_APP_SLUG: job.appSlug, FACTORY_JOB_ID: job.id },
  });
  lock.setChild(child.pid || null);
  const decode = eventDecoder(job.aiEngine);
  st.child = child;
  child.stdin.on("error", () => {});
  child.stdin.end(handoffPrompt(dir, promptFor(job), { appScope: true }));
  // 도구 요청 중계: AI 가 도는 동안만 몇 초마다 .factory/requests/ 를 본다(꺼짐 모드면 아무것도 하지 않음)
  const reqSecrets = job.requiredSecrets ?? [];
  st.broker = createBroker({
    appDir: dir,
    jobId: job.id,
    engine: job.aiEngine,
    getSettings: () => toolBroker,
    toolkitDir: cfg.toolkitDir,
    pythonCmd: cfg.pythonCmd,
    requiredSecrets: reqSecrets,
    secrets: Object.fromEntries(reqSecrets.filter((n) => secrets[n]).map((n) => [n, secrets[n]])),
    redact: st.redact,
    log: (m) => addLog(st, "info", m),
    onChange: () => {
      st.toolDirty = true;
    },
    // 요청이 ok 로 끝나면 새로 생긴 결과 이미지를 일감 이미지로 올린다(기다리지 않음, 실패해도 일감은 그대로)
    onResult: (rec) => {
      if (rec.status === "ok" && st.reportable) void st.assets.upload();
    },
  }).start();

  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let ev;
    try {
      ev = decode(JSON.parse(line));
    } catch {
      return addLog(st, "info", line);
    }
    if (!ev) return;
    noteRateLimitEvent(ev); // 일감 출력의 한도 값(보조). 자동 수집이 실패할 때 대신 보낸다
    if (ev.session_id) st.sessionId = ev.session_id;
    if (ev.type === "system" && ev.subtype === "init") addLog(st, "info", `${ENGINE_LABELS[job.aiEngine]} 세션 시작${ev.model ? ` (${ev.model})` : ""}`);
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
    } else if (ev.type === "result") {
      // 첫 정상 결과를 요약으로 쓴다. Claude 가 띄운 백그라운드 작업(에뮬레이터·개발 서버 등)이 남아 있으면
      // claude -p 가 끝나지 않고, 그 작업이 끝날 때 새 턴을 열어 요약을 덮어쓴다. 그래서 잠시 기다렸다가 끊는다.
      if (!st.result || st.result.is_error) st.result = ev;
      if (!ev.is_error && !st.resultTimer) {
        st.resultTimer = setTimeout(() => {
          if (child.exitCode !== null || st.stopped) return;
          st.killedAfterResult = true;
          addLog(st, "warn", `결과를 낸 뒤 ${RESULT_GRACE_SEC}초가 지나도 Claude 가 끝나지 않아 정리해요(남은 백그라운드 작업 종료).`);
          log(`[${st.job.appSlug}] 결과 뒤 종료되지 않아 프로세스 정리`);
          killTree(child);
        }, RESULT_GRACE_SEC * 1000);
      }
    }
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
  st.broker.stop();
  clearInterval(beat);
  clearTimeout(timer);
  clearTimeout(st.resultTimer);

  try {
    if (st.stopped) {
      if (/^시간 초과/.test(st.stopped)) await finish(st, "failed", { failReason: st.stopped, ...(rel ? { failStage: st.phase } : {}) });
      // 취소·종료·서버 쪽 상태 변경이면 서버가 이미 정리했거나(또는 곧 정리) 하므로 보고하지 않는다
    } else if (rel && st.result && !st.result.is_error && (code === 0 || st.killedAfterResult)) {
      // 출시 일감: Claude 가 남긴 실패 표시(fail.json) → 그 단계 실패. 아니면 outbox 를 보내고, 거절되면 홈페이지 반영 실패
      const text = st.redact(String(st.result.result ?? st.lastText ?? "").trim());
      const footer = `\n(소요 ${Math.round((Date.now() - st.started) / 60000)}분${st.result.num_turns ? `, ${st.result.num_turns}턴` : ""})`;
      st.handoffText = text;
      await finishRelease(st, { summary: (text || "완료(요약 없음)").slice(0, 3700) + footer, checkFail: true });
    } else if (st.result && !st.result.is_error && (code === 0 || st.killedAfterResult)) {
      const checkBeat = setInterval(() => flush(st), cfg.heartbeatSec * 1000);
      recordLifecycle(dir, job.aiEngine, "verification-start", job.id);
      let verification;
      try {
        verification = await verifyWorkspace(dir, job.stack, (m) => addLog(st, "info", m), 15 * 60_000, (child) => { st.child = child; lock.setChild(child.pid || null); });
      } finally { clearInterval(checkBeat); }
      if (!verification.ok) return finish(st, "failed", { failReason: st.redact(`필수 검증 실패: ${verification.reason}`).slice(-1800) });
      if (st.stopped) return;
      addLog(st, "info", "필수 검증 통과");
      if (verification.scope === "source-only") addLog(st, "warn", "Swift 소스·구성 확인만 완료했습니다. 컴파일과 앱 실행은 Mac에서 별도 검증해야 합니다.");
      recordLifecycle(dir, job.aiEngine, "verification-passed", job.id);
      job.aiOutcome = { ...job.aiOutcome, status: "verified", verification };
      const blocked = keyFilesToCommit(dir);
      if (blocked.length) {
        job.keyBlocked = blocked;
        return finish(st, "failed", { failReason: `키 파일 커밋 차단: ${blocked.join(", ")}` });
      }
      // outbox(출시 자료 등)는 일감이 아직 실행 중일 때 보내야 서버가 받는다
      await sendOutbox({ dir, job, api, addLog: (level, m) => addLog(st, level, m) });
      const committed = commitResult(dir, job);
      // 작업 후 컨텍스트 정리: 앱 일감은 지금 새 세션으로 시작하므로(--resume 없음) 이어 쓸 세션이 없어 건너뛴다. 기록만 남긴다
      const compacted = await compactSession({ engine: job.aiEngine, sessionId: st.sessionId, reusable: false, enabled: compactAfterJob, cwd: dir, cfg, settings: job.aiEngine === "claude" ? appSettings : undefined });
      addLog(st, "info", compacted.line);
      const text = st.redact(String(st.result.result ?? st.lastText ?? "").trim());
      const footer = `\n(소요 ${Math.round((Date.now() - st.started) / 60000)}분${st.result.num_turns ? `, ${st.result.num_turns}턴` : ""}${committed ? ", 앱 폴더에 커밋함" : ""})`;
      st.handoffText = text; // 길어서 요약이 잘려도 '## 인계' 블록은 전체 답변에서 읽는다
      await finish(st, "done", { summary: (text || "완료(요약 없음)").slice(0, 3800) + footer });
    } else {
      const why = st.redact(String(st.result?.is_error ? st.result.result : "") || st.stderrTail.trim() || `claude 가 비정상 종료(코드 ${code})`);
      if (rel) readPhase(st);
      // 고른 모델을 계정에서 못 쓰는 경우 등을 알아볼 수 있게 실패 사유 끝에 모델을 붙인다
      const modelNote = model ? `\n(모델: ${model} — 이 모델을 쓸 수 없으면 다른 모델로 다시 승인하세요)` : "";
      await finish(st, "failed", { failReason: why.slice(-(1800 - modelNote.length)) + modelNote, ...(rel ? { failStage: st.phase } : {}) });
    }
  } finally {
    running.delete(job.id);
    // 일감이 끝나면(성공·실패 모두) AI 한도를 한 번 새로 읽는다. 던지지 않고 15초 넘으면 기다리지 않음, 로그 한 줄
    void refreshAfterTask({ log });
  }
}

const MARK = { ok: "✅", skipped: "⏭", failed: "❌" };
const STAGE_NAME = { icon: "아이콘·대표 이미지", screenshots: "스크린샷", video: "영상", listing: "문구", upload: "업로드", homepage: "홈페이지 반영" };

function setPhase(st, phase) {
  fs.writeFileSync(path.join(st.dir, ".factory", "phase.txt"), `${phase}\n`);
  readPhase(st);
}

// Play 업로드 전에 모자란 것(서버가 본 것 + 서비스 계정 키 파일이 지금 이 PC 에 있는지)
function playMissing(play) {
  if (!play) return ["서버가 Play 업로드 정보를 주지 않았어요(홈페이지 배포 전일 수 있어요)"];
  const missing = Array.isArray(play.missing) ? play.missing.map(String) : [];
  if (play.serviceAccountKeyPath && !missing.some((m) => m.includes("서비스 계정 키"))) {
    if (!fs.existsSync(path.resolve(expand(play.serviceAccountKeyPath)))) missing.push(`서비스 계정 키 파일이 이 PC 에 없어요(${play.serviceAccountKeyPath})`);
  }
  return missing;
}

async function postStoreAssets(st, body) {
  try {
    const r = await api("POST", "/api/factory/store-assets", { jobId: st.job.id, ...body });
    if (r.status !== 200) addLog(st, "warn", `스토어 자료 결과 보내기 거절(${r.status}): ${r.data?.message ?? ""}`);
  } catch (e) {
    addLog(st, "warn", `스토어 자료 결과 보내기 오류: ${e.message}`);
  }
}

// outbox release.json(보냈으면 sent/ 사본)을 읽는다. 없으면 null
function readReleaseJson(dir, jobId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, ".factory", "outbox", "release.json"), "utf8"));
  } catch {
    return sentRelease(dir, jobId);
  }
}

const mb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`);

// 앱 업데이트(예전 첫 출시도): 최초 업로드를 마친 앱이면 release.json 의 AAB 를 비공개 테스트 트랙에 올린다(출시 노트 포함)
// 돌려주는 값: { note, fail?, uploaded, track, versionCode }
async function uploadReleaseAab(st) {
  const { job, dir } = st;
  const play = job.release?.play;
  const missing = playMissing(play);
  if (missing.length) {
    addLog(st, "info", `Play 업로드 안 함(최초 업로드는 사람이 직접): ${missing.join(" / ")}`);
    return { note: `업로드 ⏭ 안 함: ${missing.join(" / ")}`, uploaded: false };
  }
  const data = readReleaseJson(dir, job.id);
  const { aab, warn } = realAab(dir, data?.aab);
  if (warn) addLog(st, "warn", warn);
  if (!aab) return { note: "업로드 ⏭ 안 함: release.json 에 서명 AAB 가 없어요", uploaded: false };
  // 출시 노트: Claude 가 쓴 release.json 의 releaseNotes({언어: 글}) → 없으면 사람이 정한 글(한국어)
  const notes =
    data?.releaseNotes && typeof data.releaseNotes === "object" ? data.releaseNotes : typeof play.releaseNotes === "string" && play.releaseNotes ? { "ko-KR": play.releaseNotes } : null;
  setPhase(st, "upload");
  try {
    const r = await playUploadAab({ play, aabPath: aab.path, releaseNotes: notes, log: (m) => addLog(st, "info", m) });
    const note =
      `업데이트 AAB(버전 코드 ${r.versionCode})를 ${play.track} 트랙에 올렸어요` +
      (r.status === "draft" ? "(초안 앱이라 초안으로: Console 에서 출시 검토)" : "") +
      (r.changesNotSentForReview ? ". Console 에서 '검토를 위해 변경사항 보내기'를 직접 눌러야 해요" : "") +
      ".";
    await postStoreAssets(st, { aabUpload: { ok: true, note, track: play.track, versionCode: r.versionCode } });
    addLog(st, "info", note);
    return { note: `업로드 ✅ ${note}`, uploaded: true, track: play.track, versionCode: r.versionCode };
  } catch (e) {
    const reason = st.redact(e.message);
    await postStoreAssets(st, { aabUpload: { ok: false, note: reason, track: play.track, versionCode: aab.versionCode } });
    return { fail: `Play 업로드 실패: ${reason}`, uploaded: false };
  }
}

// 스토어 자료(.factory/store/) 검사와 결과 줄. stages 가 있으면 그 단계만
function checkStore(st, lines, stages) {
  const check = checkStoreAssets(st.dir, { only: stages });
  if (st.job.storeEnv) check.tools = [check.tools, `PC: ${envSummary(st.job.storeEnv)}`].filter(Boolean).join(" · ");
  for (const k of ["icon", "screenshots", "video", "listing"]) {
    if (stages && !stages.includes(k)) continue; // 고르지 않은 항목
    const s = check.stages[k];
    lines.push(`${STAGE_NAME[k]} ${MARK[s.status]} ${s.note ?? ""}`.trim());
    if (s.status === "skipped") addLog(st, "warn", s.note);
  }
  if (check.video) lines.push(`영상 파일(PC): ${check.video.path} · ${mb(check.video.size)}${check.video.durationSec ? ` · ${check.video.durationSec}초` : ""}`);
  return check;
}

/**
 * 검토 단계가 있는 출시 일감(첫 출시·스토어 수정)의 생성 끝: 자료를 검사하고, 검토에 필요한 것만 올린 뒤 '검토 대기'로 보고한다.
 * - 올리는 것: 스토어 이미지(검토 화면 표시용), 스토어 자료 결과, 검토용 영상(관리자만 재생), release.json(패키지·문구·AAB 정보·방침 초안)
 * - 하지 않는 것: Play 업로드, 홈페이지 프로젝트 반영(project.json 은 보내지 않고 PC 에 둔다), 완료 보고
 * 작업 PC 는 여기서 놓아준다(검토는 며칠이 걸려도 된다). 만든 파일은 승인 때까지 앱 폴더에 그대로 둔다.
 */
async function reviewHandoff(st, { summary, lines, items }) {
  const { job, dir } = st;
  const kind = job.release.kind;
  setPhase(st, "review");
  const stages = kind === "store" && items && Array.isArray(job.release.stages) ? job.release.stages : null;
  const check = checkStore(st, lines, stages);
  const failReview = async (reason, stage = "review") => {
    commitResult(dir, job);
    return finish(st, "failed", { failReason: st.redact(reason).slice(0, 1800), failStage: stage });
  };
  if (check.failure) {
    await postStoreAssets(st, storeReport(check));
    return failReview(`${STAGE_NAME[check.failure.stage]} 검사 실패: ${check.failure.reason}`, check.failure.stage);
  }
  // 검토 화면에 보일 이미지(고정 칸)와 결과. 홈페이지 프로젝트(대표 이미지 등)는 승인 뒤에만 바뀐다
  const sent = await sendStoreImages({ check, job, api, addLog: (level, m) => addLog(st, level, m) });
  await postStoreAssets(st, storeReport(check));
  if (sent.length) return failReview(`검토용 이미지를 올리지 못했어요: ${sent.join(" / ")}`);
  if (check.video) {
    const v = await uploadReviewVideo({ video: check.video, job, api, log: (m) => addLog(st, "info", m) });
    lines.push(`검토 영상 ${v.ok ? "✅" : "⚠️"} ${v.note}`);
  }
  // 패키지·문구·AAB 정보(+ 개인정보처리방침 초안). project.json 은 승인 뒤에 보낸다
  if (mergePrivacyDraft(dir)) addLog(st, "info", "개인정보처리방침 초안을 검토 화면에 보이도록 release.json 에 넣었어요");
  const outFails = await sendOutbox({ dir, job, api, addLog: (level, m) => addLog(st, level, m), only: ["release.json"] });
  if (outFails.length) return failReview(`검토 자료(release.json)를 보내지 못했어요: ${outFails.map((x) => x.message).join(" / ")}`);
  if (kind === "first") {
    const { aab } = realAab(dir, sentRelease(dir, job.id)?.aab);
    lines.push(aab ? `서명 AAB(PC): ${aab.path} · ${aab.versionName ?? "?"} (${aab.versionCode ?? "?"}) · ${mb(aab.size)}` : "⚠️ 서명 AAB 가 없어요(release.json 의 aab)");
  }
  const committed = commitResult(dir, job);
  lines.push("👀 검토 대기: 통제실 출시 패키지에서 확인하고 [이대로 진행]을 누르면 반영해요(Play 업로드·홈페이지는 그 뒤에).");
  const extra = `\n${lines.map((l) => `- ${l}`).join("\n")}`;
  await finish(st, "review", { summary: (summary + extra).slice(0, 3900) + (committed ? " (앱 폴더에 커밋함)" : "") });
}

// 시험용 APK 마무리: .factory/apk.json 의 APK → 서명 확인(apksigner, 디버그 키 거절, 등록된 키와 비교) → 앱 폴더 커밋 → 홈페이지로 조각 업로드.
// Play·outbox·홈페이지 프로젝트는 건드리지 않는다. 재시도가 upload 면 Claude 없이 여기부터(키 비교용 정보는 다시 준비)
async function finishApk(st, { summary }) {
  const { job, dir } = st;
  const fail = (stage, reason) => finish(st, "failed", { failReason: st.redact(reason).slice(0, 1800), failStage: stage });
  setPhase(st, "sign");
  const info = readApkInfo(dir, { maxBytes: Number(job.release?.apk?.maxBytes) || undefined, abi: job.release?.apk?.abi || null });
  if (!info.ok) return fail("build", info.reason);
  let keyEnv = st.keyEnv;
  if (!keyEnv) {
    try {
      const k = prepareReleaseKey({ job, dir, secrets: readSecrets(), log: () => {} });
      keyEnv = k.ok ? k.env : {};
    } catch {
      keyEnv = {};
    }
  }
  const verify = verifyApk(info.file);
  const expected = expectedSigner({ dir, env: keyEnv });
  const judged = judgeSignature(verify, expected);
  if (!judged.ok) return fail("sign", judged.reason);
  addLog(st, "info", `apksigner 확인 통과(${verify.schemes.join("·") || "서명"}), 서명 인증서 SHA-256 ${judged.signerSha256.slice(0, 12)}…${judged.note ? ` · ${judged.note}` : ""}`);
  commitResult(dir, job); // 서명 설정을 고쳤으면 그 상태로 커밋한 뒤 커밋을 적는다
  const meta = {
    jobId: job.id,
    size: info.size,
    sha256: sha256File(info.file),
    versionName: info.versionName,
    versionCode: info.versionCode,
    builtAt: info.builtAt,
    gitCommit: gitCommitOf(dir),
    signerSha256: judged.signerSha256,
    keyLabel: job.release?.apk?.keyLabel ?? expected.label ?? null,
    abi: info.abi,
  };
  setPhase(st, "upload");
  const up = await uploadTestApk({ file: info.file, meta, api, log: (m) => addLog(st, "info", m) });
  if (!up.ok) return fail("upload", up.message);
  const lines = [
    `시험용 APK: ${path.relative(dir, info.file).replace(/\\/g, "/")} · ${mb(info.size)} · ${info.abi === "arm64-v8a" ? "휴대폰용(arm64)" : (info.abi ?? "ABI ?")} · 버전 ${info.versionName ?? "?"}(${info.versionCode ?? "?"})`,
    `SHA-256 ${meta.sha256.slice(0, 12)}… · 커밋 ${meta.gitCommit ?? "-"} · 서명 ${judged.signerSha256.slice(0, 12)}…${judged.note ? `(${judged.note})` : ""}`,
    "통제실 출시 패키지 카드의 '시험용 APK' 에서 내려받을 수 있어요(관리자만, 앱당 최근 5개).",
  ];
  await finish(st, "done", { summary: `${summary}\n${lines.map((l) => `- ${l}`).join("\n")}`.slice(0, 3900) });
}

// 출시 일감 마무리: (checkFail 이면) fail.json 확인 → (검토 단계가 있고 승인 전이면) 검토 대기로 →
// (스토어 수정) 자료 검사 → Play 업로드 → 홈페이지(이미지·outbox) → 앱 폴더 커밋 → 완료/실패 보고
// from: 재시도·승인 뒤 시작 단계(review | upload | homepage). homepage 면 Play 업로드는 건너뛴다
async function finishRelease(st, { summary, checkFail = false, from = null }) {
  const { job, dir } = st;
  // 출시 2단계 서버만 job.release.play 를 준다. 예전 서버의 일감이면 예전처럼 outbox 만 보낸다(스토어 자료 검사·Play 업로드 없음)
  const v2 = !!job.release && "play" in job.release;
  const kind = v2 ? job.release.kind : null;
  // 고른 갱신 항목(store/project). null 이면 예전 일감(전부). 단계(stages)도 서버가 이 항목으로 걸러서 준다
  const items = v2 && Array.isArray(job.release.items) ? job.release.items : null;
  // 검토 단계(첫 출시·스토어 수정). 승인([이대로 진행]) 전에는 업로드·홈페이지 반영·완료를 하지 않는다
  const review = v2 && job.release.review?.required ? job.release.review : null;
  const lines = [];
  if (items) lines.push(`갱신 항목: ${job.release.itemsLabel || items.join(", ")} (이것만 처리)`);
  if (checkFail) {
    const f = readFailFile(dir);
    if (f) {
      readPhase(st);
      commitResult(dir, job);
      return finish(st, "failed", { failReason: st.redact(f.reason), failStage: f.stage || st.phase });
    }
  }
  if (review && review.approved !== true) return reviewHandoff(st, { summary, lines, items });
  if (kind === "apk") return finishApk(st, { summary });
  if (kind === "store" && from === "videolink") return finishVideoLink(st, { summary });
  if (review) lines.push("검토 승인됨([이대로 진행])");

  // 앱 업데이트: 서명 AAB 가 있어야 한다. 빌드 결과(시험 요약 포함)는 release.json 을 보내기 전에 읽어 둔다
  const relData = kind === "update" ? readReleaseJson(dir, job.id) : null;
  const build = kind === "update" ? { tests: typeof relData?.tests === "string" ? st.redact(relData.tests).slice(0, 600) : null } : null;
  if (kind === "update") {
    const { aab, warn } = realAab(dir, relData?.aab);
    if (warn) addLog(st, "warn", warn);
    if (!aab) {
      commitResult(dir, job);
      return finish(st, "failed", { failReason: "서명 AAB 가 없어요(release.json 의 aab). 빌드·서명 결과를 확인하세요.", failStage: "build" });
    }
    Object.assign(build, { versionName: aab.versionName, versionCode: aab.versionCode, aabPath: aab.path, aabSize: aab.size });
    lines.push(`새 버전: ${aab.versionName ?? "?"} (${aab.versionCode ?? "?"}) · AAB ${mb(aab.size)}${build.tests ? ` · 시험: ${build.tests}` : ""}`);
  }

  let check = null;
  if (kind === "store") {
    check = checkStore(st, lines, items && Array.isArray(job.release.stages) ? job.release.stages : null);
    if (check.failure) {
      await postStoreAssets(st, storeReport(check));
      commitResult(dir, job);
      const reason = `${STAGE_NAME[check.failure.stage]} 검사 실패: ${check.failure.reason}`;
      return finish(st, "failed", { failReason: st.redact(reason).slice(0, 1800), failStage: check.failure.stage });
    }
  }

  // 업로드(Play). 재시도가 '홈페이지 반영'부터면 건너뛴다. 검토가 있는 첫 출시는 올리지 않는다(최초 AAB 는 사람이 Console 에 직접)
  if (from !== "homepage") {
    if (kind === "store") {
      const missing = playMissing(job.release?.play);
      // Play 에 올릴 것: 이미지·문구, '홍보 영상 링크만 반영'(→ 영상 링크). '홍보 영상 만들기'는 링크가 아직 없어 여기서 Play 를 건드리지 않는다(영상 링크 대기)
      // (예전 서버는 videoLinkWait 를 주지 않는다: 그때 video 는 예전 뜻 '저장된 링크를 영상에')
      const oldVideo = job.release.videoLinkWait === undefined;
      const playItems = items
        ? items.filter((i) => ["images", "listing", "videoLink", ...(oldVideo ? ["video"] : [])].includes(i)).map((i) => (i === "videoLink" ? "video" : i))
        : null;
      if (playItems && playItems.length === 0) {
        check.stages.upload = { status: "skipped", note: "Play 에 올릴 항목(이미지·문구·홍보 영상 링크)을 고르지 않아서 Play 는 건드리지 않았어요" };
      } else if (missing.length) {
        check.stages.upload = { status: "skipped", note: `Play 업로드 안 함 - 부족한 것: ${missing.join(" / ")}` };
        addLog(st, "warn", check.stages.upload.note);
      } else {
        setPhase(st, "upload");
        try {
          const r = await playUploadStore({ play: job.release.play, check, items: playItems, log: (m) => addLog(st, "info", m) });
          const note =
            `Play 등록정보(${r.langs.join(", ") || "언어 없음"})${r.listing === false ? "" : " 문구"}${r.video ? "·영상 링크" : ""}` +
            (r.imageTypes.length ? `, 이미지 ${r.imageTypes.join("·")} 교체` : "") +
            " 커밋함" +
            (r.changesNotSentForReview ? ". 자동으로 검토에 보낼 수 없는 앱이라 Console 에서 '검토를 위해 변경사항 보내기'를 직접 눌러야 해요" : "");
          check.stages.upload = { status: "ok", note };
          await postStoreAssets(st, { ...storeReport(check), upload: { ok: true, note, editId: r.editId, changesNotSentForReview: r.changesNotSentForReview } });
        } catch (e) {
          const reason = st.redact(e.message);
          check.stages.upload = { status: "failed", note: reason };
          await postStoreAssets(st, { ...storeReport(check), upload: { ok: false, note: reason } });
          commitResult(dir, job);
          return finish(st, "failed", { failReason: `Play 업로드 실패: ${reason}`.slice(0, 1800), failStage: "upload" });
        }
      }
      lines.push(`업로드 ${MARK[check.stages.upload.status]} ${check.stages.upload.note}`);
    } else if ((kind === "first" && !review) || kind === "update") {
      const r = await uploadReleaseAab(st);
      if (r.fail) {
        commitResult(dir, job);
        return finish(st, "failed", { failReason: r.fail.slice(0, 1800), failStage: "upload" });
      }
      lines.push(r.note);
      if (build) Object.assign(build, { uploaded: r.uploaded === true, track: r.track ?? null, uploadNote: r.note });
    }
  }

  setPhase(st, "homepage");
  const failures = [];
  if (kind === "store") {
    // 고정 이미지 칸만 홈페이지로(영상은 보내지 않음), 결과 저장. 대표 이미지를 홈페이지 프로젝트에 넣도록 project.json 은 늘 보낸다
    const sent = await sendStoreImages({ check, job, api, addLog: (level, m) => addLog(st, level, m) });
    failures.push(...sent.map((m) => `스토어 이미지 ${m}`));
    const homepage = { status: failures.length ? "failed" : "ok", note: failures.join(" / ") || null };
    await postStoreAssets(st, { ...storeReport(check), stages: { ...check.stages, homepage } });
  }
  // 서버가 가진 값(대표 이미지·Play 주소)을 홈페이지 프로젝트에 넣도록 project.json 은 늘 보낸다(서버가 고른 항목의 칸만 받는다)
  if (kind === "store" || (kind === "project" && items) || (kind === "first" && review)) {
    const pj = path.join(dir, ".factory", "outbox", "project.json");
    fs.mkdirSync(path.dirname(pj), { recursive: true });
    if (!fs.existsSync(pj)) fs.writeFileSync(pj, "{}\n");
  }
  // 앱 업데이트는 '홈페이지 프로젝트도 반영'을 골랐을 때만 project.json 을 보낸다
  const only = kind === "update" && !job.release.overwriteProject ? ["release.json"] : null;
  failures.push(...(await sendOutbox({ dir, job, api, addLog: (level, m) => addLog(st, level, m), only })).map((x) => x.message));
  const committed = commitResult(dir, job);
  if (failures.length) {
    return finish(st, "failed", { failReason: st.redact(`홈페이지 반영 실패: ${failures.join(" / ")}`).slice(0, 1800), failStage: "homepage" });
  }
  if (job.release?.overwriteProject) lines.push(kind === "update" ? "홈페이지 프로젝트: 반영함" : "홈페이지 프로젝트: 고른 항목 덮어쓰기");
  if (items?.includes("privacy")) lines.push("개인정보처리방침: 홈페이지 방침 갱신(Play 의 방침 주소는 그대로라 Play 에서도 새 내용이 보여요)");
  if (kind === "first" && review) {
    const { aab } = realAab(dir, sentRelease(dir, job.id)?.aab);
    lines.push("홈페이지 프로젝트: 빈 칸 채움");
    lines.push(
      aab
        ? `최초 AAB(PC 에만): ${aab.path} · ${aab.versionName ?? "?"} (${aab.versionCode ?? "?"}) · ${mb(aab.size)} → Play Console 에 직접 올린 뒤 출시 카드에서 '최초 AAB 업로드 완료'를 체크하세요`
        : "⚠️ 서명 AAB 를 찾지 못했어요. 앱 폴더의 빌드 결과를 확인하세요",
    );
    lines.push("스토어 문구·이미지는 출시 카드에서 [복사]·[다운로드]해 Console 에 넣으세요. 이후 Play 반영은 '스토어 수정'으로 할 수 있어요.");
  }
  if (kind === "first" && review && sentRelease(dir, job.id) && fs.existsSync(path.join(dir, ".factory", "store", "promo.mp4"))) {
    lines.push("홍보 영상: 출시 카드에서 [영상 내려받기]로 받아 YouTube 에 올리세요. 링크는 Console 에 직접 넣거나, 첫 업로드 뒤 스토어 수정의 '홍보 영상 링크만 반영'으로 넣어요.");
  }
  // '홍보 영상 만들기'를 고른 스토어 수정: 이미지·문구는 반영했고, 영상은 사람이 YouTube 에 올린 링크를 기다린다(서버가 받는 경우만)
  const waitLink = kind === "store" && items?.includes("video") && job.release.videoLinkWait === true && !!check?.video;
  if (waitLink) {
    lines.push("🎬 영상 링크 대기: 출시 카드에서 [영상 내려받기] → YouTube 에 올린 뒤 링크를 붙여 넣으면 Play 등록정보 영상에 반영해요(링크 없이 마칠 수도 있어요).");
  } else if (kind === "store" && items?.includes("video") && !check?.video) {
    lines.push("홍보 영상: 만들지 못해 링크 대기 없이 마쳐요(영상 단계 결과 참고).");
  }
  const extra = lines.length ? `\n${lines.map((l) => `- ${l}`).join("\n")}` : "";
  await finish(st, waitLink ? "linkwait" : "done", { summary: (summary + extra).slice(0, 3900) + (committed ? " (앱 폴더에 커밋함)" : ""), ...(build ? { build } : {}) });
}

// 영상 링크 대기 뒤 [링크 반영]: Play 등록정보 영상 필드만 바꾼다(이미 올린 이미지·문구는 건드리지 않음). 홈페이지 Project 에는 영상 칸이 없다
async function finishVideoLink(st, { summary }) {
  const { job, dir } = st;
  const play = job.release?.play;
  const lines = [];
  const missing = playMissing(play);
  if (!play?.videoUrl) {
    return finish(st, "failed", { failReason: "저장된 YouTube 링크가 없어요. 카드에서 링크를 넣고 다시 [링크 반영]을 누르세요.", failStage: "videolink" });
  }
  if (missing.length) {
    commitResult(dir, job);
    return finish(st, "failed", { failReason: `Play 업로드를 할 수 없어요 - 부족한 것: ${missing.join(" / ")}`.slice(0, 1800), failStage: "videolink" });
  }
  setPhase(st, "upload");
  try {
    // 빈 검사 결과로 '영상만' 올린다(문구·이미지 없음)
    const empty = { images: {}, shots: [], stages: {}, listing: null };
    const r = await playUploadStore({ play, check: empty, items: ["video"], log: (m) => addLog(st, "info", m) });
    const note =
      `Play 등록정보(${r.langs.join(", ") || "언어 없음"}) 영상 링크만 바꿔 커밋함` +
      (r.changesNotSentForReview ? ". Console 에서 '검토를 위해 변경사항 보내기'를 직접 눌러야 해요" : "");
    await postStoreAssets(st, { upload: { ok: true, note, editId: r.editId, changesNotSentForReview: r.changesNotSentForReview } });
    lines.push(`영상 링크 반영 ✅ ${note}`);
  } catch (e) {
    const reason = st.redact(e.message);
    await postStoreAssets(st, { upload: { ok: false, note: `영상 링크: ${reason}` } });
    return finish(st, "failed", { failReason: `Play 영상 링크 반영 실패: ${reason}`.slice(0, 1800), failStage: "videolink" });
  }
  if (job.release?.overwriteProject) lines.push("홈페이지 프로젝트에는 영상 칸이 없어 Play 에만 반영했어요");
  await finish(st, "done", { summary: `${summary}\n${lines.map((l) => `- ${l}`).join("\n")}`.slice(0, 3900) });
}

// ───────────── 대기열 확인 ─────────────
let paused = false;
let autoUpdate = true; // 통제실 스위치. /next 응답에 autoUpdate: false 가 오면 끈다(필드가 없으면 켜짐)
let defaultAiEngine = null;
let compactAfterJob = true; // 통제실 '작업 후 컨텍스트 정리'. /next 에 compactAfterJob: false 가 오면 끈다(필드가 없으면 켜짐)
let slotLimit = null; // 통제실 '동시에 만들 앱 수'를 받은 값(null = 아직 못 받음 → PC 설정 slots)
const appLimit = () => slotLimit ?? cfg.slots;
let toolBroker = brokerSettings(null); // 통제실 '도구 요청 중계' 설정. 값이 없으면(예전 서버) 꺼짐
// secrets.env 를 고치는 일(키 비밀번호·외부 서비스 키·이름 보고)은 한 줄로 세워 차례로 한다(동시에 쓰지 않게). 던지지 않는다
let secretsChain = Promise.resolve();
const onSecrets = (fn) => (secretsChain = secretsChain.then(fn).catch(() => {}));
const HOUR_MS = 60 * 60_000;
let secretNamesReportedAt = 0; // PC 키 이름 보고(값 없음): 시작 때와 1시간마다, 반영 직후
let aiTools = null; // AI 도구 상태(읽기 전용): 1시간마다 확인해 홈페이지가 받을 때까지 /next 에 붙인다
let aiToolsCheckedAt = 0;
let memoryLine = ""; // 작업 메모리 상태(폴더별 시각·크기·푸시 결과, 본문 없음): 바뀌었거나 1시간이 지나면 /next 에 붙인다
let memorySentAt = 0;
function memoryQuery() {
  try {
    const dirs = new Set([path.resolve(expand(cfg.selfdevDir || "~/dev/factory/selfdev"))]);
    for (const e of fs.readdirSync(cfg.workDir, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith(".")) dirs.add(path.join(cfg.workDir, e.name));
    const line = memoryReport([...dirs]);
    return line && (line !== memoryLine || Date.now() - memorySentAt > HOUR_MS) ? { memory: line } : {};
  } catch { return {}; }
}

async function loop() {
  let delay = cfg.pollSec * 1000;
  while (!shuttingDown) {
    try {
      maybeUpdate({ running: running.size + (maintenanceBusy() ? 1 : 0), autoUpdate }); // 일감·정비가 없을 때만 10분마다. 받으면 여기서 exit(0)
    } catch (e) {
      log(`자동 업데이트 확인 중 오류: ${e.message}`);
    }
    // 통제실 [감독 재시작]: 일감·정비가 다 끝났으면 여기서 종료(실행기가 다시 띄움)
    if (maybeRestart({ busy: running.size > 0 || maintenanceBusy(), shutdown, log })) break;
    try {
      const free = appLimit() - running.size;
      { // 자리가 꽉 차도(또는 값을 줄여 넘쳐도) 확인은 계속한다: slots=0 으로 신호·설정(늘린 값)만 받는다
        const info = reportInfo(); // 현재 커밋·최근 업데이트 소식을 통제실에 보여 주려고 함께 보낸다
        // 실행 정보: 시작 시각·재시작으로 켜졌는지·재시작 대기(hold=1 이면 홈페이지가 아무것도 넘기지 않음)·실패 이유, ffmpeg·ffprobe 버전과 경로
        const extra = new URLSearchParams({ ...restartQuery(), aiEngines: advertisedEngines(cfg).join(","), ffmpeg: toolLabel("ffmpeg"), ffprobe: toolLabel("ffprobe"), ...(aiTools ?? {}), ...memoryQuery() });
        const sentTools = aiTools;
        const sentMemory = extra.get("memory");
        // 정비 지시나 정비 배포가 도는 동안에는 새 앱 일감을 받지 않는다(slots=0: 홈페이지가 일감을 넘기지 않고 신호만 줌)
        const take = planTake({ limit: appLimit(), running: running.size, maintenanceBusy: maintenanceBusy() });
        const r = await api(
          "GET",
          `/api/factory/next?worker=${encodeURIComponent(cfg.worker)}&slots=${take}&commit=${encodeURIComponent(info.commit)}&note=${encodeURIComponent(info.note)}&subject=${encodeURIComponent(info.subject ?? "")}&${extra}`,
        );
        notePoll(r.status === 200); // 새 버전 건강 확인(200 이면 확인됨)
        if (r.status === 200) {
          delay = cfg.pollSec * 1000;
          if (aiTools === sentTools) aiTools = null; // 받았으니 다음 확인(1시간 뒤)까지 보내지 않는다
          if (sentMemory) { memoryLine = sentMemory; memorySentAt = Date.now(); }
          if (Date.now() - aiToolsCheckedAt > HOUR_MS) {
            // 폴링이 된 뒤에만, 기다리지 않고 확인한다. 결과는 다음 /next 에 붙는다
            aiToolsCheckedAt = Date.now();
            aiToolStatus(cfg).then((v) => (aiTools = v), () => {});
          }
          autoUpdate = r.data?.autoUpdate !== false;
          compactAfterJob = r.data?.compactAfterJob !== false;
          // 동시에 만들 앱 수: 서버 값(1~4)이 우선, 없거나 범위 밖이면 PC 값. 줄이면 돌던 일감은 그대로 두고 끝나면서 줄어든다
          const nextLimit = effectiveSlots({ server: r.data?.appSlots, serverIsDefault: r.data?.appSlotsDefault === true, pc: cfg.pcSlots });
          if (nextLimit !== appLimit()) log(`동시에 만들 앱: ${appLimit()}개 → ${nextLimit}개${running.size > nextLimit ? ` (돌던 ${running.size}개는 그대로 두고 끝나면서 줄어요)` : ""}`);
          slotLimit = nextLimit;
          if (["claude", "codex"].includes(r.data?.defaultAiEngine) && defaultAiEngine !== r.data.defaultAiEngine) {
            defaultAiEngine = r.data.defaultAiEngine;
            log(`주사용 AI: ${ENGINE_LABELS[defaultAiEngine]} (새 지시 기본값, 개별 AI 선택 유지)`);
          }
          const nextBroker = brokerSettings(r.data?.toolBroker);
          if (nextBroker.mode !== toolBroker.mode) log(`도구 요청 중계: ${TOOL_MODE_LABELS[nextBroker.mode]}`);
          toolBroker = nextBroker;
          if (r.data?.restart === true) onRestartSignal(log); // 1회성 "감독 재시작"(실행기 밖이면 이유만 알리고 하지 않음)
          // 재시작 대기 중에는 아무것도 받지 않는다(홈페이지도 hold=1 이면 일감·신호를 넘기지 않음). 진행 중인 작업은 끝까지
          if (restartPending()) {
            await sleep(delay);
            continue;
          }
          if (r.data?.updateNow === true) requestUpdateNow(); // 1회성 "지금 업데이트": 다음 루프에서 바로 확인
          reportPcPaths(r.data?.pcPaths, api, log).catch(() => {}); // 배포 계정 키 파일이 있는지만 알린다
          // 통제실에서 등록한 키 비밀번호를 secrets.env 로(값은 로그에 남기지 않음), 키 점검 요청(한 번). 둘 다 던지지 않는다
          // 키 보관함 일(공용 키 만들기·키 파일 조회): 비밀번호를 먼저 받아 둔 뒤 처리한다
          const keyTasks = Array.isArray(r.data?.keyTasks) ? r.data.keyTasks : [];
          if (r.data?.keyPasswordsPending === true || keyTasks.length) {
            onSecrets(async () => {
              if (r.data?.keyPasswordsPending === true) await syncKeyPasswords({ api, log, secretsFile: cfg.secretsFile });
              if (keyTasks.length) await runKeyTasks({ tasks: keyTasks, api, log, workDir: cfg.workDir, readSecrets });
            });
          }
          // 통제실에서 입력·삭제한 외부 서비스 키: secrets.env 의 그 줄만 바꾸고 확인한 뒤 이름 목록을 알린다(값은 로그에 남기지 않음)
          if (r.data?.secretsPending === true) {
            secretNamesReportedAt = Date.now();
            onSecrets(async () => {
              await syncSecretEntries({ api, log, secretsFile: cfg.secretsFile });
              // 방금 받은 키 값이 secrets.env 에 들어간 뒤, app-kit 매핑에 있는 키는 서버2 .env 에 반영한다(값은 로그·보고에 남기지 않음)
              await reportProvisionNames({ api, log, appKitDir: cfg.appKitDir });
              await syncProvisions({ api, log, appKitDir: cfg.appKitDir, bashCmd: findBash(cfg.bashCmd), readSecrets });
            });
          } else if (Date.now() - secretNamesReportedAt > HOUR_MS) {
            secretNamesReportedAt = Date.now();
            onSecrets(async () => {
              await reportSecretNames({ api, log, secretsFile: cfg.secretsFile });
              await reportProvisionNames({ api, log, appKitDir: cfg.appKitDir });
            });
          }
          // keyScanApps 가 있으면 그 앱 폴더만(출시 카드 [키 조회])
          // 통제실 '업로드 시험'(한 번): 운영과 같은 함수로 시험 파일을 올리고 결과를 보낸다. 던지지 않는다
          if (r.data?.uploadTest) runUploadTest({ test: r.data.uploadTest, api, log }).catch(() => {});
          if (r.data?.keyScan === true) runKeyScan({ api, log, workDir: cfg.workDir, only: Array.isArray(r.data?.keyScanApps) ? r.data.keyScanApps : null }).catch(() => {});
          // 공장 정비 지시·[배포] 요청(앱 일감과 따로. 정비는 돌던 앱 일감이 없을 때만 시작)
          onMaintenance(r.data, { api, log, cfg, runningApps: () => running.size, requestUpdateNow, compactEnabled: () => compactAfterJob, redact: (s) => redactAiText(redactor([cfg.token, ...Object.values(readSecrets())])(s)) });
          // 통제실 일시 정지: 새 일감만 받지 않고 폴링은 계속한다(연결됨 표시 유지). 돌던 작업은 그대로 끝까지 간다.
          const nowPaused = r.data?.paused === true;
          if (nowPaused !== paused) {
            paused = nowPaused;
            log(paused ? "일시 정지됨 (홈페이지)" : "다시 시작됨");
          }
          const offered = paused ? [] : r.data.jobs ?? [];
          if (offered.length > Math.max(0, free)) log(`서버가 자리(${Math.max(0, free)}개)보다 많은 일감 ${offered.length}개를 줬어요. 넘친 ${offered.length - Math.max(0, free)}개는 시작하지 않아요(10분 안에 서버가 대기열로 되돌려요).`);
          for (const job of offered.slice(0, Math.max(0, free))) {
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
      notePoll(null); // 응답 없음: 새 코드 탓으로 보지 않는다
      log(`홈페이지에 연결하지 못했어요: ${e.message}`);
      delay = Math.min(delay * 2, 120_000);
    }
    await sleep(delay);
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log(running.size ? "종료합니다. 돌던 작업은 멈추고, 서버가 10분 안에 대기열로 되돌려요." : "종료합니다.");
  for (const st of running.values()) {
    st.stopped = "감독 프로그램 종료";
    killTree(st.child);
    st.broker?.stop(); // 돌던 도구 프로세스도 바로 끈다(AI 종료를 기다리지 않음)
  }
  setTimeout(() => process.exit(0), 1500);
}

// ───────────── 시작 ─────────────
const command = process.argv[2];
if (command === "init") {
  await init();
} else {
  cfg = loadConfig();
  setMemoryConfig({ remote: cfg.memoryRemote });
  if (command === "check") await check();
  else {
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    fs.mkdirSync(cfg.workDir, { recursive: true });
    readRestartMark(log); // [감독 재시작]으로 다시 켜진 것인지
    // 실행기·작업 스케줄러가 쥔 옛 PATH 대신 레지스트리 Path 를 다시 읽는다(그 뒤 설치한 ffmpeg 등). 자식 프로세스도 물려받는다
    const added = refreshPathFromRegistry();
    if (added.length) log(`PATH 에 레지스트리 폴더 ${added.length}개를 붙였어요: ${added.join("; ")}`);
    log(`ffmpeg: ${toolLabel("ffmpeg")} · ffprobe: ${toolLabel("ffprobe")}`);
    log(`감독 프로그램 시작: ${cfg.worker} → ${cfg.serverUrl} (동시 ${appLimit()}개, ${cfg.pollSec}초마다 확인)`);
    log(`앱 폴더: ${cfg.workDir}`);
    // 통제실 '장비 상태'(메인PC CPU·RAM·GPU·디스크, 숫자만): 폴링과 따로 1분마다. 실패해도 폴링·일감에 영향 없음
    try {
      startDeviceStats({ api, log });
    } catch (e) {
      log(`장비 상태 보내기를 시작하지 못했어요: ${e.message}`);
    }
    // 통제실 도구함의 '툴킷 도구 상세'(tools.json 읽기 전용, 도구는 실행 안 함): 바뀔 때만·가끔 같은 장비 상태 경로로
    try {
      startToolkitReport({ api, log, toolkitDir: () => cfg.toolkitDir });
    } catch (e) {
      log(`툴킷 도구 목록 보내기를 시작하지 못했어요: ${e.message}`);
    }
    await loop();
  }
}
