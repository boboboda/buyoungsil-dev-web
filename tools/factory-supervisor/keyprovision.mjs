// 앱 공장 감독 프로그램: 통제실 키를 서버2 .env 에 자동 반영한다. (서버: lib/factory/keyProvision.ts)
// - app-kit 폴더의 docs/key-map.json 에 있는 키 이름만 대상이다. 이름 목록(값 없음)을 서버에 알리고, 서버가 할 일(pending)을 주면
//   `bash scripts/provision-key.sh <키 이름>` 을 app-kit 폴더에서 실행한다. 값은 환경변수(키 이름과 같은 이름)로만 넘긴다.
// - 값 출처: PC 키는 secrets.env, 서버 보관 키(REVIEW_STATUS_TOKEN_…)는 서버가 할 일에 실어 준 값.
// - 종료 코드(0 성공·2 이름 틀림·3 PC 에 값 없음·4 실패 후 되돌림·5 되돌림도 실패)와 출력 줄을 서버에 보고한다. 값은 로그·보고·오류 어디에도 쓰지 않는다.
// - app-kit 코드·서버 설정은 고치지 않고 호출만 한다.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const IS_WIN = process.platform === "win32";
const NAME_RE = /^[A-Z][A-Z0-9_]{2,80}$/;
const RUN_TIMEOUT_MS = 10 * 60_000;
const MAX_LINES = 30;
const MAX_LINE = 200;

/** docs/key-map.json 의 키 이름들(값은 원래 없다). 파일이 없거나 이상하면 빈 목록. */
export function mappedKeyNames(appKitDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(appKitDir, "docs", "key-map.json"), "utf8"));
    return Object.keys(m?.keys ?? {}).filter((n) => NAME_RE.test(n)).sort();
  } catch {
    return [];
  }
}

/** Windows 에서는 PATH 의 bash 가 WSL(System32\bash.exe)일 수 있어 Git Bash 를 먼저 찾는다. */
export function findBash(configured) {
  if (configured) return configured;
  if (IS_WIN) {
    for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs")]) {
      if (!base) continue;
      const p = path.join(base, "Git", "bin", "bash.exe");
      if (fs.existsSync(p)) return p;
    }
  }
  return "bash";
}

/** 반영 대상 이름을 서버에 알린다(값 없음). 던지지 않는다. */
export async function reportProvisionNames({ api, log, appKitDir }) {
  try {
    const r = await api("POST", "/api/factory/secrets", { provisionNames: mappedKeyNames(appKitDir) });
    if (r.status !== 200 && r.status !== 404) log(`키 반영 대상 보고 거절(${r.status})`);
  } catch (e) {
    log(`키 반영 대상 보고 오류: ${e.code || e.name || "연결 실패"}`);
  }
}

const tidy = (s, scrub) =>
  scrub(String(s ?? ""))
    .split(/\r?\n/)
    .map((l) => l.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_LINE))
    .filter(Boolean);

/** provision-key.sh 한 번 실행. { exitCode, lines, state }. 값은 어디에도 남기지 않는다. */
export function runProvisionScript({ appKitDir, bashCmd, name, value, timeoutMs = RUN_TIMEOUT_MS }) {
  const scrub = (s) => (value && value.length >= 4 ? String(s ?? "").split(value).join("***") : String(s ?? ""));
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bashCmd, ["scripts/provision-key.sh", name], {
        cwd: appKitDir,
        env: { ...process.env, [name]: value },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      return resolve({ exitCode: null, state: "failed", lines: ["bash 를 실행하지 못했어요"] });
    }
    let out = "";
    let err = "";
    let timedOut = false;
    const cap = (s, d) => (s.length < 64 * 1024 ? s + d : s);
    child.stdout.on("data", (d) => (out = cap(out, d)));
    child.stderr.on("data", (d) => (err = cap(err, d)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ exitCode: null, state: "failed", lines: [`bash 를 실행하지 못했어요(${e.code || "오류"})`] });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const outLines = tidy(out, scrub);
      const errLines = tidy(err, scrub).slice(-5).map((l) => `(오류 출력) ${l}`);
      const lines = [...outLines, ...errLines].slice(-MAX_LINES);
      if (timedOut) return resolve({ exitCode: null, state: "failed", lines: ["시간 초과(10분)로 멈췄어요", ...lines].slice(0, MAX_LINES) });
      const exitCode = Number.isInteger(code) ? code : null;
      if (exitCode !== 0) return resolve({ exitCode, state: "failed", lines });
      const changed = outLines.some((l) => /^CHANGED\b/.test(l));
      const unchanged = outLines.some((l) => /^UNCHANGED\b/.test(l));
      resolve({ exitCode, state: unchanged && !changed ? "unchanged" : "ok", lines });
    });
  });
}

let running = false;

/**
 * 서버가 준 반영 할 일을 차례로 실행하고 결과를 보고한다. /next 에 secretsPending 이 있을 때 secrets.env 반영(syncSecretEntries) 뒤에 부른다.
 * 던지지 않는다. run 은 시험에서 바꿔 끼운다.
 */
export async function syncProvisions({ api, log, appKitDir, bashCmd, readSecrets, run = runProvisionScript }) {
  if (running) return;
  running = true;
  try {
    const r = await api("GET", "/api/factory/secrets?provision=1");
    if (r.status === 404) return;
    if (r.status !== 200 || !Array.isArray(r.data?.provision)) return log(`키 서버 반영 할 일 가져오기 거절(${r.status})`);
    const known = new Set(mappedKeyNames(appKitDir));
    for (const it of r.data.provision.slice(0, 20)) {
      const name = typeof it?.name === "string" ? it.name : "";
      if (!NAME_RE.test(name) || !Number.isInteger(it.seq)) continue;
      const report = (body) => api("POST", "/api/factory/secrets", { provisionReport: { name, seq: it.seq, ...body } });
      if (!known.has(name)) {
        await report({ state: "failed", exitCode: 2, lines: ["이 PC 의 app-kit key-map.json 에 없는 이름이에요"] });
        continue;
      }
      const value = typeof it.value === "string" && it.value ? it.value : readSecrets()[name] || "";
      if (!value) {
        await report({ state: "failed", exitCode: 3, lines: ["작업 PC 에 그 키의 값이 없어요(아무것도 바꾸지 않음)"] });
        log(`키 서버 반영: ${name} → 이 PC 에 값 없음`);
        continue;
      }
      await report({ state: "running", exitCode: null, lines: [] });
      log(`키 서버 반영 시작: ${name}`);
      let res;
      try {
        res = await run({ appKitDir, bashCmd, name, value });
      } catch {
        res = { exitCode: null, state: "failed", lines: ["실행 중 오류"] };
      }
      const scrub = (s) => String(s).split(value).join("***");
      const lines = (res.lines ?? []).map(scrub);
      await report({ state: res.state, exitCode: res.exitCode, lines });
      log(`키 서버 반영 끝: ${name} → ${res.state} (종료 코드 ${res.exitCode ?? "없음"})`);
    }
  } catch (e) {
    log(`키 서버 반영 오류: ${e.code || e.name || "연결 실패"}`);
  } finally {
    running = false;
  }
}
