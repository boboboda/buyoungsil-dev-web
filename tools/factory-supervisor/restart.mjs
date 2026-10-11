// 앱 공장 감독 프로그램: 통제실·커넥터의 [감독 재시작](/next 의 restart: true)
// - 받으면 새 일감 받기를 멈추고(/next 에 hold=1: 홈페이지가 일감·정비·1회성 신호를 넘기지 않아 유실되지 않음),
//   진행 중인 앱 일감·정비가 끝나면 표시 파일을 남기고 정상 종료(exit 0)한다. 실행기(run-supervisor.sh)가 30초 뒤 다시 띄운다.
// - 다시 켜진 감독 프로그램은 레지스트리 Path 를 새로 읽고(pcenv.mjs), 표시 파일을 보고 boot=restart 로 알린다(통제실 "재시작됨").
// - 실행기 밖에서 돌면 다시 띄워 줄 장치가 없으니 끄지 않고, 이유를 restartFail 로 홈페이지에 알린다(통제실·텔레그램).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const expand = (p) => (p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? path.join(os.homedir(), p.slice(1)) : p);
const STATE_PATH = expand(process.env.FACTORY_RESTART_STATE || "~/dev/factory/supervisor-restart.json");
const LAUNCHER_LOCK = expand(process.env.FACTORY_LAUNCHER_LOCK || "~/dev/factory/run-supervisor.pid");
const MARK_VALID_MS = 15 * 60_000; // 이보다 오래된 표시 파일은 이번 시작과 상관없다고 본다

export const STARTED_AT = new Date().toISOString();
let boot = "start";
let pending = false; // 재시작 요청을 받았고 일감이 끝나길 기다리는 중
let pendingSince = null;
let failReason = ""; // 재시작하지 못한 이유(다음 재시작 요청 때까지 홈페이지에 계속 알린다)

/** 실행 모드로 시작할 때 부른다. 재시작 표시 파일이 있으면 boot=restart 로 바꾸고 지운다 */
export function readRestartMark(log) {
  try {
    const mark = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    fs.rmSync(STATE_PATH, { force: true });
    if (Date.now() - new Date(mark.exitAt).getTime() < MARK_VALID_MS) {
      boot = "restart";
      log(`재시작됨: ${mark.requestedAt ?? "?"} 요청 → ${mark.exitAt} 종료 → 지금 다시 켜짐`);
    }
  } catch {
    /* 표시 파일 없음: 보통 시작 */
  }
}

// 끄면 다시 켜 줄 장치가 있는지 점검한다. 문제가 있으면 이유, 없으면 ""
function launcherProblem() {
  if (process.env.FACTORY_LAUNCHER !== "1")
    return "실행기(run-supervisor.sh) 밖에서 돌고 있어 끄면 다시 켜 줄 장치가 없어요. 재시작하지 않았어요(PC 에서 직접 껐다 켜세요).";
  if (!fs.existsSync(LAUNCHER_LOCK)) return `실행기 표시 파일(${LAUNCHER_LOCK})이 없어 실행기가 살아 있는지 확인하지 못했어요. 재시작하지 않았어요.`;
  try {
    process.kill(process.ppid, 0); // 이 프로세스를 띄운 실행기 쪽 프로세스가 살아 있는지
  } catch {
    return "감독 프로그램을 띄운 실행기 프로세스가 보이지 않아요. 재시작하지 않았어요(작업 스케줄러 AppFactorySupervisor 를 확인하세요).";
  }
  return "";
}

/** /next 응답에 restart: true 가 오면 부른다 */
export function onRestartSignal(log) {
  if (pending) return;
  failReason = launcherProblem();
  if (failReason) return log(`재시작 요청 받음, 하지 않음: ${failReason}`);
  pending = true;
  pendingSince = new Date().toISOString();
  log("재시작 요청 받음: 새 일감 받기를 멈추고, 진행 중인 작업이 끝나면 껐다 켜요(실행기가 30초 뒤 다시 띄움).");
}

export const restartPending = () => pending;

/** 대기열 확인 때 함께 보내는 값 */
export function restartQuery() {
  return { started: STARTED_AT, boot, ...(pending ? { hold: "1" } : {}), ...(failReason ? { restartFail: failReason } : {}) };
}

/** 대기열 확인 루프에서 매번 부른다. 기다리던 재시작을 할 때가 되면 표시 파일을 남기고 shutdown() 을 부른 뒤 true */
export function maybeRestart({ busy, shutdown, log }) {
  if (!pending || busy) return false;
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({ requestedAt: pendingSince, exitAt: new Date().toISOString() }) + "\n");
  } catch (e) {
    log(`재시작 표시 파일을 쓰지 못했어요(재시작은 계속): ${e.message}`);
  }
  log("재시작: 진행 중인 작업이 없어 지금 종료해요. 실행기가 30초 뒤 다시 띄워요.");
  shutdown();
  return true;
}
