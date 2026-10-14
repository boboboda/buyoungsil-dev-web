// tools/factory-supervisor/applock.mjs
// 앱 단위 잠금(병렬화 단계 C-1). 같은 앱 안에서 한 번에 하나만 되는 단계를 줄 세운다:
//   build(Flutter/Gradle 빌드) · emulator(에뮬레이터 실행) · port(고정 포트 사용) · merge(기본 브랜치에 합치기)
// 잠금은 <작업 폴더>/.locks/<앱>.<이름>.lock 파일이고(만든 프로세스의 pid 가 죽으면 낡은 잠금으로 보고 치운다), 앱마다 따로라서 다른 앱끼리는 기다리지 않는다.
// 감독 프로그램은 합치기·검사에 직접 쓰고, AI 일감은 같은 파일을 쓰는 이 파일의 명령줄로 감싸 쓴다:
//   node applock.mjs <build|emulator|port> -- <실행할 명령 …>
// 잠금을 기다리는 동안은 FACTORY_WAIT_FILE(.factory/lock-wait.json)에 이름·시각을 적어 둔다. 감독 프로그램이 그걸 읽어 일감 로그와 통제실에 '잠금 대기'로 보여 준다.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LOCK_NAMES = ["build", "emulator", "port", "merge"];
export const LOCK_LABELS = { build: "빌드", emulator: "에뮬레이터", port: "고정 포트", merge: "합치기" };
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

export function lockFile(dir, app, name) {
  if (!SLUG_RE.test(app)) throw new Error("앱 이름이 올바르지 않아요.");
  if (!LOCK_NAMES.includes(name)) throw new Error(`알 수 없는 잠금 이름: ${name}`);
  return path.join(dir, `${app}.${name}.lock`);
}

const readHolder = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/** 지금 이 잠금을 쥔 쪽(없거나 이미 죽었으면 null) */
export function lockHolder(dir, app, name, alive = pidAlive) {
  const h = readHolder(lockFile(dir, app, name));

  return h && alive(h.pid) ? h : null;
}

/**
 * 잠금을 얻을 때까지 기다린다. onWait(holder) 는 처음 막혔을 때 한 번, onAcquired(waitedMs) 는 기다렸다가 얻었을 때 한 번 불린다.
 * signal 이 중단되면 기다리지 않고 던진다. 돌려주는 release() 는 여러 번 불러도 되고, 내 잠금일 때만 지운다.
 */
export async function acquireLock({ dir, app, name, owner = "", pid = process.pid, pollMs = 500, onWait, onAcquired, signal, alive = pidAlive } = {}) {
  const file = lockFile(dir, app, name);
  const token = randomUUID();
  const since = new Date().toISOString();
  let waitedFrom = 0;

  fs.mkdirSync(dir, { recursive: true });
  for (;;) {
    if (signal?.aborted) throw new Error("잠금 대기가 중단됐어요.");
    try {
      const fd = fs.openSync(file, "wx");

      fs.writeFileSync(fd, JSON.stringify({ token, pid, owner, name, app, since }));
      fs.closeSync(fd);
      if (waitedFrom) await onAcquired?.(Date.now() - waitedFrom);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const holder = readHolder(file);

    if (!holder || !alive(holder.pid)) {
      // 낡은 잠금: 읽은 내용과 같을 때만 치운다(그 사이 새 주인이 생겼으면 건드리지 않음)
      const again = readHolder(file);

      if (!again || (again.token === holder?.token && !alive(again.pid))) {
        try {
          fs.unlinkSync(file);
        } catch {
          /* 이미 치워짐 */
        }
      }
      continue;
    }
    if (!waitedFrom) {
      waitedFrom = Date.now();
      await onWait?.(holder);
    }
    await sleep(pollMs);
  }

  let released = false;

  return {
    file,
    token,
    release() {
      if (released) return;
      released = true;
      if (readHolder(file)?.token === token) {
        try {
          fs.unlinkSync(file);
        } catch {
          /* 이미 없음 */
        }
      }
    },
  };
}

/** 잠금을 잡고 fn 을 실행한 뒤 반드시 푼다 */
export async function withLock(opts, fn) {
  const lock = await acquireLock(opts);

  try {
    return await fn(lock);
  } finally {
    lock.release();
  }
}

/** 감독 프로그램이 켜질 때: 지난 실행이 남긴 잠금 파일(.lock)을 하나씩 치운다. 지운 개수 */
export function clearLocks(dir) {
  let n = 0;

  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".lock")) continue;
      try {
        fs.unlinkSync(path.join(dir, name));
        n++;
      } catch {
        /* 이미 없음 */
      }
    }
  } catch {
    /* 폴더가 아직 없음 */
  }

  return n;
}

// ───────── 잠금 대기 표시 파일 ─────────
export function writeWait(file, info) {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(info));
  } catch {
    /* 표시용이라 실패해도 일감은 그대로 */
  }
}

export function clearWait(file) {
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    /* 없으면 그대로 */
  }
}

/** 잠금 대기 중이면 { name, since, holder }, 아니면 null */
export function readWait(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));

    if (!LOCK_NAMES.includes(v?.name) || typeof v.since !== "string") return null;
    if (v.pid !== undefined && !pidAlive(v.pid)) return null; // 기다리던 명령이 이미 죽었으면 낡은 표시

    return v;
  } catch {
    return null;
  }
}

/** AI 일감 작업 규칙에 붙일 안내문(병행 일감 전용). applockPath 는 이 파일의 전체 경로 */
export function lockRules(applockPath) {
  const cmd = (name) => `node "${applockPath}" ${name} -- <명령>`;

  return `
## 같은 앱의 다른 일감과 같이 돌고 있어요 (병행 실행)
- 이 폴더는 같은 앱을 고치는 다른 일감들과 나란히 도는 작업 사본(git worktree)이에요. 이 폴더 밖(앱 원본 폴더·다른 작업 사본)은 건드리지 마세요. 브랜치(factory/job-…)를 바꾸거나 push 하지 마세요.
- 같은 앱 안에서 한 번에 하나만 되는 일은 반드시 아래 명령으로 감싸서 실행하세요. 다른 일감이 쓰는 중이면 끝날 때까지 기다렸다가 실행해요.
  - Flutter/Gradle 빌드: \`${cmd("build")}\` (예: flutter build apk, ./gradlew assembleDebug)
  - 에뮬레이터·실기기 실행: \`${cmd("emulator")}\`
  - 고정 포트를 쓰는 서버·개발 서버: \`${cmd("port")}\`
- flutter analyze·단위 시험처럼 포트나 빌드 산출물을 쓰지 않는 검사는 감싸지 않아도 돼요.
- 일이 끝나면 평소처럼 마치세요. 기본 브랜치에 합치는 건 감독 프로그램이 해요(합칠 때 글자 충돌이나 검사 실패가 나면 다시 맞춰 달라고 요청이 올 수 있어요).
`;
}

// ───────── 명령줄: node applock.mjs <이름> -- <명령 …> ─────────
/** Windows 명령줄 한 개의 인자 감싸기(공백·따옴표·특수문자가 있을 때만) */
export function quoteArg(arg) {
  const a = String(arg);

  if (a !== "" && /^[\w@%+=:,./\\-]+$/.test(a)) return a;

  return `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

async function cli(argv) {
  const sep = argv.indexOf("--");
  const name = argv[0];
  const command = sep >= 0 ? argv.slice(sep + 1) : [];

  if (!LOCK_NAMES.includes(name) || name === "merge" || !command.length) {
    console.error(`사용법: node applock.mjs <${LOCK_NAMES.filter((n) => n !== "merge").join("|")}> -- <명령 …>`);

    return 2;
  }
  const app = process.env.FACTORY_APP_SLUG ?? "";
  const dir = process.env.FACTORY_LOCK_DIR ?? "";
  const waitFile = process.env.FACTORY_WAIT_FILE ?? "";
  let lock = null;

  if (app && dir) {
    lock = await acquireLock({
      dir,
      app,
      name,
      owner: process.env.FACTORY_JOB_ID ?? "",
      onWait: (holder) => {
        writeWait(waitFile, { name, since: new Date().toISOString(), holder: holder?.owner ?? "", pid: process.pid });
        console.error(`[잠금 대기] 같은 앱의 다른 일감이 ${LOCK_LABELS[name]} 을(를) 쓰는 중이라 끝날 때까지 기다려요.`);
      },
      onAcquired: (ms) => console.error(`[잠금 얻음] ${Math.round(ms / 1000)}초 기다렸어요.`),
    });
    clearWait(waitFile);
  }
  try {
    return await new Promise((resolve) => {
      // Windows 는 flutter.bat 같은 배치 파일도 실행해야 해서 셸을 쓴다. 공백·따옴표가 든 인자는 감싸서 그대로 넘긴다
      const win = process.platform === "win32";
      const child = win ? spawn(command.map(quoteArg).join(" "), { stdio: "inherit", shell: true, windowsHide: true }) : spawn(command[0], command.slice(1), { stdio: "inherit", windowsHide: true });

      child.on("error", (e) => {
        console.error(`실행 실패: ${e.message}`);
        resolve(127);
      });
      child.on("close", (code) => resolve(code ?? 1));
    });
  } finally {
    lock?.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await cli(process.argv.slice(2));

  process.exit(code);
}
