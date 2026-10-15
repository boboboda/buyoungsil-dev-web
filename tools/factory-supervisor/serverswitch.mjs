// 감독 프로그램 홈페이지 주소 전환 안전장치 (통합-분리 4-3)
// 감독 serverUrl 을 잘못 바꾸면 감독이 통제실과 끊겨 원격으로 되돌릴 수 없다. 그래서 두 쪽으로 나눈다.
//  1) serverctl.mjs server-switch <새 주소> [--dry-run]  (정비가 신뢰된 사본으로 부른다)
//     - 새 주소로 먼저 시험 호출: 워커 토큰으로 일감 확인(/api/factory/next, hold=1 이라 일감·신호를 가져가지 않음) 200,
//       상태 토큰으로 /api/claude-status 200. 하나라도 틀리면 아무것도 바꾸지 않는다. --dry-run 은 여기까지만.
//     - 통과하면 supervisor.config.json 과 CLAUDE_STATUS_URL 줄(~/.bashrc 등)을 백업하고 새 주소로 쓴 뒤 state(armed)를 남긴다.
//       돌고 있는 감독이 state 를 보고 일감이 끝나는 대로 스스로 재시작한다(restart.mjs).
//  2) 감독 쪽 자동 되돌림(startSwitchGuard): 새 주소로 다시 켜진 뒤 5분 안에 새 주소로 일감 확인·하트비트가 한 번도 200 을 받지 못하면
//     이 PC 안에서(서버 연결 없이) 설정·CLAUDE_STATUS_URL 줄을 이전 값으로 되돌리고 재시작한다. 되돌린 사실은 다음 대기열 확인(note)에 실려 간다.
// 상태 파일: ~/dev/factory/supervisor-switch.json, 백업: ~/dev/factory/switch-backups/<시각>/ (둘 다 pcguard.mjs 가 정비의 수정을 막는다)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TRIAL_SEC = 300; // 새 주소로 켠 뒤 연결 성공을 기다리는 시간
const STATUS_PATH = "/api/claude-status";
const PROFILE_NAMES = [".bashrc", ".bash_profile", ".profile"];
const TOKEN_MIN = 8;

// ───────── 경로 ─────────
/** 시험 모드(FACTORY_TEST_MODE=1)에서만 환경변수로 상태 파일을 바꿀 수 있다 */
export function switchPaths({ env = process.env, home = os.homedir() } = {}) {
  const test = env.FACTORY_TEST_MODE === "1";
  const root = path.join(home, "dev", "factory");
  return {
    state: (test && env.FACTORY_SWITCH_STATE) || path.join(root, "supervisor-switch.json"),
    backups: path.join(root, "switch-backups"),
    profiles: PROFILE_NAMES.map((n) => path.join(home, n)),
  };
}

// ───────── 주소 ─────────
/** 새 홈페이지 주소를 `https://호스트[:포트]` 로 다듬는다. 시험 모드는 이 PC 안(http://127.0.0.1·localhost)만. 잘못되면 던진다 */
export function normalizeServerUrl(raw, { test = false } = {}) {
  const s = String(raw ?? "").trim();
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error(`주소 형식이 올바르지 않아요: ${s || "(없음)"}`);
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) throw new Error("주소는 https://호스트 꼴만이에요(경로·쿼리·계정 없이)");
  if (test) {
    if (u.protocol !== "http:" || !/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) throw new Error("시험 모드는 이 PC 안(http://127.0.0.1·localhost)의 주소만 써요");
  } else if (u.protocol !== "https:" || !/^[a-z0-9.-]+$/i.test(u.hostname) || !/\.[a-z]{2,}$/i.test(u.hostname)) {
    throw new Error("주소는 https:// 로 시작하는 도메인이어야 해요");
  }
  return `${u.protocol}//${u.host.toLowerCase()}`;
}
export const statusUrlOf = (serverUrl) => `${serverUrl}${STATUS_PATH}`;
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
};

// ───────── 셸 설정 파일(~/.bashrc 등)의 CLAUDE_STATUS_* 줄 ─────────
const URL_LINE = /^(\s*(?:export\s+)?CLAUDE_STATUS_URL=)(['"]?)([^'"\s#$`\\]*)\2([\s\S]*)$/;
const TOKEN_LINE = /^\s*(?:export\s+)?CLAUDE_STATUS_TOKEN=(['"]?)([^'"\s#]+)\1/;

/** 텍스트 안의 CLAUDE_STATUS_URL 값(없으면 null). 줄이 있는데 읽을 수 없는 꼴이면 던진다 */
export function readStatusUrl(text) {
  for (const line of String(text).split("\n")) {
    if (!/^\s*(?:export\s+)?CLAUDE_STATUS_URL=/.test(line)) continue;
    const m = URL_LINE.exec(line);
    if (!m || !m[3]) throw new Error("CLAUDE_STATUS_URL 줄의 꼴을 읽을 수 없어요(따옴표 안에 공백·변수가 있나요?)");
    return m[3];
  }
  return null;
}
/** CLAUDE_STATUS_URL 줄의 값만 바꾼다(따옴표·export·줄 끝 설명·줄바꿈 유지). { text, changed } */
export function replaceStatusUrl(text, newUrl) {
  let changed = 0;
  const out = String(text)
    .split("\n")
    .map((line) => {
      const m = URL_LINE.exec(line);
      if (!m) return line;
      changed++;
      return `${m[1]}${m[2]}${newUrl}${m[2]}${m[4]}`;
    })
    .join("\n");
  return { text: out, changed };
}
export function readStatusToken(text) {
  for (const line of String(text).split("\n")) {
    const m = TOKEN_LINE.exec(line);
    if (m) return m[2];
  }
  return null;
}

const readFile = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
// 임시 파일에 쓴 뒤 바꿔치기: 쓰다 끊겨도 반쪽 파일이 남지 않는다
function writeAtomic(file, text, mode) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

// ───────── 상태 파일 ─────────
export function readSwitchState(paths = switchPaths()) {
  try {
    const s = JSON.parse(fs.readFileSync(paths.state, "utf8"));
    return s && typeof s === "object" ? s : null;
  } catch {
    return null;
  }
}
function writeSwitchState(paths, s) {
  fs.mkdirSync(path.dirname(paths.state), { recursive: true });
  writeAtomic(paths.state, JSON.stringify(s, null, 2) + "\n", 0o600);
}
function clearSwitchState(paths) {
  fs.rmSync(paths.state, { force: true });
}

// ───────── 새 주소 시험 호출 ─────────
/**
 * 새 주소에 두 번 호출해 본다. 값은 어디에도 남기지 않고 응답 코드만 돌려준다.
 *  next:   GET /api/factory/next?slots=0&hold=1&toolSlots=0 (워커 토큰). hold=1 이라 홈페이지가 일감·정비·1회성 신호를 하나도 넘기지 않는다
 *  status: POST /api/claude-status (상태 토큰, 상태 훅과 같은 형식의 PostToolUse 한 건)
 * 반환: { ok, next, status } — 각 항목은 { code, ok } 또는 연결 실패 { code: 0, ok: false, error }
 */
export async function probeServer({ url, workerToken, worker, statusToken, device, fetchFn = fetch, timeoutMs = 15_000 }) {
  const call = async (p, init) => {
    try {
      const r = await fetchFn(`${url}${p}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      await r.arrayBuffer().catch(() => {});
      return { code: r.status, ok: r.status === 200 };
    } catch (e) {
      return { code: 0, ok: false, error: e?.cause?.code || e?.code || e?.name || "연결 실패" };
    }
  };
  const next = await call(`/api/factory/next?worker=${encodeURIComponent(worker)}&slots=0&hold=1&toolSlots=0`, { headers: { Authorization: `Bearer ${workerToken}` } });
  const status = await call(STATUS_PATH, {
    method: "POST",
    headers: { Authorization: `Bearer ${statusToken}`, "Content-Type": "application/json", "User-Agent": "claude-status-hook/1" },
    body: JSON.stringify({ event: "PostToolUse", sessionId: "server-switch-probe", project: "server-switch", device: device || worker, tool: "probe", ts: Date.now() }),
  });
  return { ok: next.ok && status.ok, next, status };
}
const probeText = (p) => `일감 확인 ${p.next.code || p.next.error}, 상태 보내기 ${p.status.code || p.status.error}`;

// ───────── server-switch 명령 ─────────
const timestamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");

/**
 * serverctl.mjs 의 server-switch 서브커맨드. deps: { args, configPath, test, say, die, report, env, home, fetchFn }
 *   server-switch <새 주소> [--dry-run]   |   server-switch --status
 */
export async function runServerSwitch({ args, configPath, test, say, die, report, env = process.env, home = os.homedir(), fetchFn = fetch }) {
  const flags = args.filter((a) => a.startsWith("--"));
  const pos = args.filter((a) => !a.startsWith("--"));
  const dryRun = flags.includes("--dry-run");
  const statusOnly = flags.includes("--status");
  const bad = flags.filter((f) => f !== "--dry-run" && f !== "--status");
  if (bad.length || (statusOnly && (dryRun || pos.length)) || (!statusOnly && pos.length !== 1)) die("server-switch <새 주소> [--dry-run]  |  server-switch --status");
  const paths = switchPaths({ env, home });

  if (statusOnly) {
    const st = readSwitchState(paths);
    if (!st) return say("주소 전환 기록이 없어요.");
    return say(`주소 전환 상태: ${st.status} (${hostOf(st.from?.serverUrl)} → ${hostOf(st.to?.serverUrl)})${st.deadlineAt ? `, 연결 확인 마감 ${st.deadlineAt}` : ""}${st.reason ? `, 이유: ${st.reason}` : ""}${st.status === "rolledBack" ? (st.reported ? ", 보고함" : ", 보고 전") : ""}`);
  }

  let to;
  try {
    to = normalizeServerUrl(pos[0], { test });
  } catch (e) {
    die(e.message);
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    die("감독 설정(supervisor.config.json)을 읽지 못했어요.");
  }
  const from = String(cfg?.serverUrl ?? "").replace(/\/+$/, "");
  if (!from) die("감독 설정에 serverUrl 이 없어요.");
  if (typeof cfg.token !== "string" || cfg.token.length < TOKEN_MIN) die("감독 설정에 감독 토큰이 없어요.");
  if (to === from) die(`이미 이 주소예요: ${hostOf(to)}`);
  const prev = readSwitchState(paths);
  if (prev && (prev.status === "armed" || prev.status === "trial")) die(`이전 주소 전환이 아직 진행 중이에요(${prev.status}: ${hostOf(prev.from?.serverUrl)} → ${hostOf(prev.to?.serverUrl)}). 끝나거나 되돌려진 뒤에 다시 하세요.`);

  // 셸 설정 파일에서 상태 토큰·CLAUDE_STATUS_URL 줄을 찾는다(값은 출력하지 않는다)
  const profiles = [];
  let statusToken = env.CLAUDE_STATUS_TOKEN || "";
  for (const p of paths.profiles) {
    const text = readFile(p);
    if (text === null) continue;
    try {
      const url = readStatusUrl(text);
      if (url !== null) profiles.push({ file: p, url });
    } catch (e) {
      die(`${path.basename(p)}: ${e.message}`);
    }
    statusToken ||= readStatusToken(text) || "";
  }
  if (!statusToken) die("상태 토큰(CLAUDE_STATUS_TOKEN)을 환경변수나 ~/.bashrc 에서 찾지 못해 상태 보내기를 시험할 수 없어요. 전환하지 않았어요.");

  const probe = await probeServer({ url: to, workerToken: cfg.token, worker: cfg.worker || "mainpc", statusToken, device: env.CLAUDE_DEVICE_NAME, fetchFn });
  if (!probe.ok) {
    await report(`주소 전환 시험 실패: ${hostOf(from)} → ${hostOf(to)}${dryRun ? " (--dry-run)" : ""}\n결과: ${probeText(probe)} — 아무것도 바꾸지 않음`);
    die(`새 주소 시험 호출이 통과하지 못했어요(${probeText(probe)}). 아무것도 바꾸지 않았어요.`, 5);
  }
  if (dryRun) {
    await report(`주소 전환 시험(--dry-run): ${hostOf(from)} → ${hostOf(to)}\n결과: 통과(${probeText(probe)}) — 아무것도 바꾸지 않음`);
    return say(`server-switch --dry-run: ${hostOf(to)} 시험 호출 통과(${probeText(probe)}). 아무것도 바꾸지 않았어요.`);
  }

  // 백업 → 상태(armed) → 설정 → 셸 설정 순서. 상태가 먼저라야 설정만 바뀌고 안전장치가 없는 순간이 생기지 않는다
  const backupDir = path.join(paths.backups, timestamp());
  const fromStatusUrl = profiles[0]?.url ?? statusUrlOf(from);
  const edited = [];
  try {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    fs.copyFileSync(configPath, path.join(backupDir, "supervisor.config.json"));
    fs.chmodSync(path.join(backupDir, "supervisor.config.json"), 0o600);
    for (const p of profiles) fs.copyFileSync(p.file, path.join(backupDir, path.basename(p.file)));
    writeSwitchState(paths, { v: 1, status: "armed", from: { serverUrl: from, statusUrl: fromStatusUrl }, to: { serverUrl: to, statusUrl: statusUrlOf(to) }, profiles: profiles.map((p) => p.file), backupDir, armedAt: new Date().toISOString() });
    writeAtomic(configPath, JSON.stringify({ ...cfg, serverUrl: to }, null, 2) + "\n", 0o600);
    for (const p of profiles) {
      const { text } = replaceStatusUrl(readFile(p.file) ?? "", statusUrlOf(to));
      writeAtomic(p.file, text);
      edited.push(p.file);
    }
  } catch (e) {
    // 쓰다 실패: 백업으로 되돌리고 상태를 지운다
    try {
      fs.copyFileSync(path.join(backupDir, "supervisor.config.json"), configPath);
      for (const f of edited) fs.copyFileSync(path.join(backupDir, path.basename(f)), f);
    } catch {
      /* 되돌릴 백업이 없으면(백업 전에 실패) 아직 아무것도 안 바꾼 것 */
    }
    clearSwitchState(paths);
    die(`주소 전환을 쓰는 중 실패해서 되돌렸어요: ${e.message}`, 5);
  }
  const body = `감독 주소 전환 준비: ${hostOf(from)} → ${hostOf(to)}\n시험 호출: ${probeText(probe)}\n바꾼 곳: supervisor.config.json serverUrl, CLAUDE_STATUS_URL 줄 ${profiles.length}곳\n백업: ${backupDir}\n다음: 감독이 일감이 끝나면 스스로 재시작 → 새 주소로 ${TRIAL_SEC / 60}분 안에 연결 성공이 없으면 자동으로 이전 주소로 되돌림`;
  await report(body);
  say(`${body}\n실행기(run-supervisor) 밖에서 돌면 재시작하지 않으니 직접 껐다 켜세요. 상태 확인: server-switch --status`);
}

// ───────── 감독 쪽: 재시작 요청 · 건강 확인 · 자동 되돌림 ─────────
let trialTimer = null;
let activePaths = null;
let trialLog = () => {};

/** 돌고 있는 감독이 아직 이전 주소인데 전환이 준비됐으면 true → 감독이 일감이 끝나길 기다렸다 재시작한다 */
export function switchRestartWanted(currentServerUrl, paths = switchPaths()) {
  const st = readSwitchState(paths);
  return st?.status === "armed" && st.from?.serverUrl === currentServerUrl && st.to?.serverUrl !== currentServerUrl;
}

/** 대기열 확인 응답이 200 일 때 → 시험 중이면 확인된 것(상태 파일을 지운다). 새 주소로 켠 감독이 아니면 아무 일도 안 한다 */
export function noteSwitchOk(paths = activePaths) {
  if (!trialTimer || !paths) return false;
  clearTimeout(trialTimer);
  trialTimer = null;
  const st = readSwitchState(paths);
  if (st?.status === "trial") {
    clearSwitchState(paths);
    trialLog(`주소 전환 확인: 새 주소(${hostOf(st.to?.serverUrl)})로 홈페이지 연결에 성공했어요. 안전장치를 풀었어요.`);
  }
  return true;
}

/** 되돌렸는데 아직 홈페이지에 알리지 못했으면 대기열 확인 note(150자 안)에 실을 문구, 없으면 "" */
export function switchReportNote(paths = switchPaths()) {
  const st = readSwitchState(paths);
  if (st?.status !== "rolledBack" || st.reported) return "";
  return `주소 전환 되돌림: ${hostOf(st.to?.serverUrl)} 연결 실패 → ${hostOf(st.from?.serverUrl)} (${String(st.rolledBackAt ?? "").slice(0, 16)})`.slice(0, 150);
}
export function markSwitchReported(paths = switchPaths()) {
  const st = readSwitchState(paths);
  if (st?.status !== "rolledBack" || st.reported) return false;
  writeSwitchState(paths, { ...st, reported: true, reportedAt: new Date().toISOString() });
  return true;
}

/** 설정 파일의 serverUrl 과 셸 설정의 CLAUDE_STATUS_URL 줄을 이전 값으로. 지금 값이 전환한 값일 때만 건드린다. 되돌린 항목 이름 목록을 돌려준다 */
function restoreFiles(st, configPath) {
  const done = [];
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (String(cfg.serverUrl).replace(/\/+$/, "") === st.to.serverUrl) {
      writeAtomic(configPath, JSON.stringify({ ...cfg, serverUrl: st.from.serverUrl }, null, 2) + "\n", 0o600);
      done.push("serverUrl");
    }
  } catch (e) {
    trialLog(`주소 전환 되돌리기: 설정 파일을 고치지 못했어요(${e.message}). 백업: ${st.backupDir}`);
  }
  for (const f of st.profiles ?? []) {
    const text = readFile(f);
    if (text === null) continue;
    try {
      if (readStatusUrl(text) !== st.to.statusUrl) continue;
      writeAtomic(f, replaceStatusUrl(text, st.from.statusUrl).text);
      done.push(path.basename(f));
    } catch (e) {
      trialLog(`주소 전환 되돌리기: ${path.basename(f)} 를 고치지 못했어요(${e.message}). 백업: ${st.backupDir}`);
    }
  }
  return done;
}

/**
 * 감독을 실행 모드로 시작하고 설정을 읽은 직후 부른다.
 *  - 전환이 준비(armed)된 채 새 주소로 켜졌으면 시험(trial)을 시작한다: 마감 = 지금 + 5분(상태 파일에 남아 재시작해도 이어짐)
 *  - 시험 중이던 상태로 다시 켜졌는데 마감이 지났으면 바로 되돌린다
 *  - 마감까지 noteSwitchOk() 가 없으면 설정·CLAUDE_STATUS_URL 줄을 되돌리고 상태를 rolledBack 으로 남긴다.
 *    실행기 밑(FACTORY_LAUNCHER=1)이면 shutdown() 으로 재시작, 아니면 이 프로세스의 주소만 이전 것으로 바꿔 계속 돈다
 * 서버 연결이 필요 없다. 반환: 지금 상태 문자열(시험·테스트용)
 */
export function startSwitchGuard({ cfg, configPath, log, shutdown, env = process.env, paths = switchPaths({ env }), now = () => Date.now() }) {
  trialLog = log;
  activePaths = paths;
  const st = readSwitchState(paths);
  if (!st || !st.from || !st.to) return "none";
  if (st.status === "rolledBack") return "rolledBack"; // 홈페이지에 알리는 중(switchReportNote)
  if (st.status !== "armed" && st.status !== "trial") return "none";

  const current = String(cfg.serverUrl).replace(/\/+$/, "");
  if (current === st.from.serverUrl && st.status === "armed") return "armed"; // 아직 재시작 전(switchRestartWanted 가 재시작을 부탁한다)
  if (current !== st.to.serverUrl) {
    log(`주소 전환 기록이 지금 설정(${hostOf(current)})과 맞지 않아 지웠어요.`);
    clearSwitchState(paths);
    return "none";
  }
  const trialMs = (env.FACTORY_TEST_MODE === "1" && Number(env.FACTORY_SWITCH_TRIAL_SEC) > 0 ? Number(env.FACTORY_SWITCH_TRIAL_SEC) : TRIAL_SEC) * 1000;
  let deadline = Number(new Date(st.deadlineAt));
  if (st.status === "armed" || !Number.isFinite(deadline)) {
    deadline = now() + trialMs;
    writeSwitchState(paths, { ...st, status: "trial", trialStartedAt: new Date(now()).toISOString(), deadlineAt: new Date(deadline).toISOString() });
    log(`주소 전환 시험 시작: 새 주소(${hostOf(st.to.serverUrl)})로 ${Math.round(trialMs / 1000)}초 안에 연결이 되지 않으면 이전 주소(${hostOf(st.from.serverUrl)})로 되돌려요.`);
  } else {
    log(`주소 전환 시험 이어서: 마감 ${st.deadlineAt}`);
  }

  const rollback = () => {
    trialTimer = null;
    const reason = `새 주소로 ${Math.round(trialMs / 1000)}초 안에 연결에 성공하지 못함`;
    const done = restoreFiles(st, configPath);
    writeSwitchState(paths, { ...st, status: "rolledBack", rolledBackAt: new Date(now()).toISOString(), reason, restored: done, reported: false });
    log(`주소 전환 되돌림: ${reason} → 이전 주소(${hostOf(st.from.serverUrl)})로 되돌렸어요(${done.join(", ") || "바꿀 것 없음"}).`);
    if (env.FACTORY_LAUNCHER === "1") {
      log("실행기가 30초 뒤 이전 주소로 다시 띄워요.");
      shutdown();
    } else {
      cfg.serverUrl = st.from.serverUrl; // 실행기 밖: 다시 띄워 줄 장치가 없으니 이 프로세스의 주소만 바꿔 계속 돈다
      if (env.CLAUDE_STATUS_URL) env.CLAUDE_STATUS_URL = st.from.statusUrl;
    }
  };
  const left = deadline - now();
  if (left <= 0) {
    rollback();
    return "rolledBack";
  }
  trialTimer = setTimeout(rollback, left);
  trialTimer.unref?.();
  return "trial";
}

/**
 * 실행기가 환경변수를 처음 한 번만 읽어서(bash -l) 재시작해도 옛 CLAUDE_STATUS_URL 을 쥐고 있을 수 있다.
 * 시작할 때 셸 설정 파일의 줄이 지금 환경변수와 다르면 그 줄 값으로 이 프로세스(와 자식)의 환경변수를 바꾼다. 환경변수가 없으면 건드리지 않는다.
 */
export function refreshStatusUrlEnv({ env = process.env, paths = switchPaths({ env }), log = () => {} } = {}) {
  if (!env.CLAUDE_STATUS_URL) return false;
  for (const p of paths.profiles) {
    const text = readFile(p);
    if (text === null) continue;
    let url = null;
    try {
      url = readStatusUrl(text);
    } catch {
      continue;
    }
    if (!url) continue;
    if (url !== env.CLAUDE_STATUS_URL) {
      log(`CLAUDE_STATUS_URL 을 ${path.basename(p)} 의 값(${hostOf(url)})으로 바꿨어요(실행기가 옛 값을 쥐고 있었어요).`);
      env.CLAUDE_STATUS_URL = url;
      return true;
    }
    return false;
  }
  return false;
}
