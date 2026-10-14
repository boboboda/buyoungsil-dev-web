// 감독 프로그램 시험 격리: FACTORY_TEST_MODE=1 로 띄운 감독은 진짜 홈페이지·진짜 토큰·진짜 상태/잠금 파일을 쓰면 시작을 거부한다.
// (10-14 정비 중 시험용 감독이 실제 감독의 파일·프로세스와 얽혀 일감이 끊긴 일의 재발 방지. supervisor.mjs 맨 앞에서 부른다)
// 시험은 임시 폴더(HOME·USERPROFILE 도 임시), 임시 설정 파일, 이 PC 안(127.0.0.1)의 가짜 홈페이지 주소, 가짜 토큰으로만 띄운다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const norm = (p) => path.resolve(String(p)).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const under = (p, root) => norm(p) === norm(root) || norm(p).startsWith(norm(root) + "/");
const expandWith = (home) => (p) => (typeof p === "string" && (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) ? path.join(home, p.slice(1)) : p);

/** 시험용 홈페이지 주소: 이 PC 안(loopback)이거나 예약된 가짜 도메인(.invalid .test .example .localhost)만 */
export function isFakeServerUrl(url) {
  let host = "";
  try {
    host = new URL(String(url)).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || /\.(invalid|test|example|localhost)$/.test(host);
}

/**
 * 시험 모드 위반 목록(없으면 []). 순수 함수: env·설정·진짜 홈 폴더를 받아서 판정한다.
 * - realHome: 진짜 사용자 홈(HOME 환경변수를 바꿔도 안 바뀌는 값). realConfig: 진짜 감독 설정 파일 내용(없으면 null)
 */
export function testModeProblems({ env, config, configPath, homedir, realHome, realConfig }) {
  const problems = [];
  const realRoot = path.join(realHome, "dev", "factory");
  const expand = expandWith(homedir);
  if (!config) return [`시험 모드: 설정 파일을 읽지 못했어요(${configPath}). 시험은 임시 폴더의 설정 파일(FACTORY_CONFIG)로 띄워야 해요`];

  if (!env.FACTORY_CONFIG) problems.push("FACTORY_CONFIG 가 없어요(진짜 설정 파일을 쓰게 돼요). 임시 폴더의 설정 파일을 지정하세요");
  if (!isFakeServerUrl(config.serverUrl)) problems.push(`serverUrl 이 가짜 홈페이지 주소가 아니에요(${config.serverUrl}). 127.0.0.1 이나 localhost 의 가짜 서버만 허용해요`);
  if (realConfig?.serverUrl && String(config.serverUrl).replace(/\/+$/, "") === String(realConfig.serverUrl).replace(/\/+$/, "")) problems.push("serverUrl 이 진짜 홈페이지 주소와 같아요");
  if (realConfig?.token && config.token && config.token === realConfig.token) problems.push("token 이 진짜 PC 토큰과 같아요. 가짜 토큰을 쓰세요");
  if (configPath && under(configPath, realRoot)) problems.push(`설정 파일이 진짜 공장 폴더 안이에요(${configPath})`);

  // 상태·잠금·작업 폴더가 진짜 공장 폴더(~/dev/factory)를 가리키면 안 된다. 지정하지 않으면 홈 폴더 기준 기본값이 쓰이니 그것도 같이 본다
  const paths = {
    workDir: config.workDir ?? "~/dev/factory",
    secretsFile: config.secretsFile ?? "~/dev/factory/secrets.env",
    selfdevDir: config.selfdevDir ?? "~/dev/factory/selfdev",
    appKitDir: config.appKitDir ?? "~/dev/factory/app-kit",
    FACTORY_UPDATE_STATE: env.FACTORY_UPDATE_STATE || "~/dev/factory/supervisor-update.json",
    FACTORY_RESTART_STATE: env.FACTORY_RESTART_STATE || "~/dev/factory/supervisor-restart.json",
    FACTORY_PAUSE_STATE: env.FACTORY_PAUSE_STATE || "~/dev/factory/supervisor-paused.json",
    FACTORY_LAUNCHER_LOCK: env.FACTORY_LAUNCHER_LOCK || "~/dev/factory/run-supervisor.pid",
  };
  for (const [name, p] of Object.entries(paths)) {
    if (under(expand(p), realRoot)) problems.push(`${name} 이 진짜 공장 폴더 안이에요(${expand(p)}). 임시 폴더로 바꾸세요`);
  }
  if (env.FACTORY_LOCK_DIR && under(expand(env.FACTORY_LOCK_DIR), realRoot)) problems.push("FACTORY_LOCK_DIR 이 진짜 공장 폴더 안이에요");
  if (env.FACTORY_LAUNCHER === "1" && env.FACTORY_LAUNCHER_LOCK && under(expand(env.FACTORY_LAUNCHER_LOCK), realRoot)) problems.push("실행기 잠금 파일이 진짜 것이에요");
  return problems;
}

/** supervisor.mjs 맨 앞에서 부른다. FACTORY_TEST_MODE 가 없으면 아무것도 하지 않는다. 위반이면 이유를 찍고 종료 코드 2 */
export function enforceTestMode(env = process.env, exit = (c) => process.exit(c), err = (m) => console.error(m)) {
  if (env.FACTORY_TEST_MODE !== "1") return [];
  const homedir = os.homedir();
  let realHome = homedir;
  try {
    realHome = os.userInfo().homedir || homedir; // HOME·USERPROFILE 을 바꿔도 OS 가 아는 진짜 사용자 폴더
  } catch {
    /* 못 읽으면 homedir 로 */
  }
  const read = (p) => {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  };
  const configPath = path.resolve(expandWith(homedir)(env.FACTORY_CONFIG || "~/dev/factory/supervisor.config.json"));
  const problems = testModeProblems({
    env,
    config: read(configPath),
    configPath,
    homedir,
    realHome,
    realConfig: read(path.join(realHome, "dev", "factory", "supervisor.config.json")),
  });
  if (problems.length) {
    err(`시험 모드(FACTORY_TEST_MODE=1)인데 진짜 환경이 섞여 있어 시작을 거부해요:\n- ${problems.join("\n- ")}`);
    exit(2);
  }
  return problems;
}
