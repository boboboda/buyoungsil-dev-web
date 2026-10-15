// 서버 배포·정비 대상(블로그 developWeb / www)을 설정값으로 빼 둔 곳. 기본값 = 예전에 박혀 있던 값(동작 변화 없음).
// 감독 설정(supervisor.config.json)의 "deploy" 객체와 maintDir·maintPushRemote 를 읽는다. maintenance.mjs·serverctl.mjs·supervisor.mjs 가 같이 쓴다.
//   deploy.workName       서버 작업 폴더 이름(~/git-server/work/<이름>, env 백업 폴더 이름도 같다)   기본 developWeb
//   deploy.containerName  docker 컨테이너 이름([배포] 성공 문구 'Recreating <이름> ... done', rebuild 이미지 조회)   기본 developWeb
//   deploy.healthUrl      배포·재빌드 뒤 헬스체크 주소                                          기본 https://www.buyoungsilcoding.com/
//   deploy.healthExpect   헬스체크 합격 응답 코드 배열(예: factory 는 [401])                     기본 [200]
//   deploy.nginxDomain    nginx-apply 로 올리는 설정에 들어 있어야 하는 도메인                     기본 buyoungsilcoding.com
//   deploy.repoDescription 정비 규칙(CLAUDE.local.md)에 쓰는 저장소 설명                          기본 부영실 홈페이지 설명
//   maintDir              정비 작업 폴더                                                       기본 selfdevDir
//   maintPushRemote       정비 결과를 올리는 git 원격 이름                                      기본 origin
import os from "node:os";
import path from "node:path";

export const DEPLOY_DEFAULTS = Object.freeze({
  workName: "developWeb",
  containerName: "developWeb",
  healthUrl: "https://www.buyoungsilcoding.com/",
  healthExpect: Object.freeze([200]),
  nginxDomain: "buyoungsilcoding.com",
  repoDescription: "부영실 홈페이지 buyoungsil-dev-web: Next.js 서버 + tools/factory-supervisor 감독 프로그램",
});
export const DEFAULT_SELFDEV_DIR = "~/dev/factory/selfdev";
export const DEFAULT_MAINT_REMOTE = "origin";

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;
const REMOTE_RE = /^[a-z][a-z0-9_-]{0,30}$/;

export const expandHome = (p) => (typeof p === "string" && (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) ? path.join(os.homedir(), p.slice(1)) : p);

// cfg.deploy 를 검사해 기본값과 합친다. 잘못된 값은 problems 에 모으고 그 항목은 기본값으로 둔다(쓰는 쪽이 problems 가 있으면 멈춘다).
// opts.local: 시험 모드(헬스체크 주소가 이 PC 안이어야 함)
export function resolveDeploy(cfg, { local = false } = {}) {
  const d = cfg && typeof cfg.deploy === "object" && cfg.deploy && !Array.isArray(cfg.deploy) ? cfg.deploy : {};
  const out = { ...DEPLOY_DEFAULTS, healthExpect: [...DEPLOY_DEFAULTS.healthExpect] };
  const problems = [];
  const text = (k, re, what) => {
    if (d[k] === undefined || d[k] === "") return;
    if (typeof d[k] !== "string" || !re.test(d[k])) problems.push(`deploy.${k} 형식이 올바르지 않아요(${what})`);
    else out[k] = d[k];
  };
  text("workName", NAME_RE, "영문으로 시작하는 이름");
  text("containerName", NAME_RE, "영문으로 시작하는 이름");
  text("nginxDomain", DOMAIN_RE, "도메인");
  if (d.repoDescription !== undefined && d.repoDescription !== "") {
    if (typeof d.repoDescription !== "string" || d.repoDescription.length > 300 || /[\r\n`$\\]/.test(d.repoDescription)) problems.push("deploy.repoDescription 은 한 줄 300자 이하(` $ \\ 금지)");
    else out.repoDescription = d.repoDescription;
  }
  if (d.healthUrl !== undefined && d.healthUrl !== "") {
    let ok = false;
    try {
      const u = new URL(String(d.healthUrl));
      ok = local ? u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname) : u.protocol === "https:" && !u.username && !u.password;
    } catch {
      /* 아래 problems */
    }
    if (ok) out.healthUrl = String(d.healthUrl);
    else problems.push(`deploy.healthUrl 이 올바르지 않아요(${local ? "시험 모드는 127.0.0.1 만" : "https 주소"})`);
  }
  if (d.healthExpect !== undefined) {
    const a = d.healthExpect;
    if (Array.isArray(a) && a.length > 0 && a.length <= 10 && a.every((c) => Number.isInteger(c) && c >= 100 && c <= 599)) out.healthExpect = [...a];
    else problems.push("deploy.healthExpect 는 응답 코드(100~599) 배열이에요");
  }
  return { ...out, problems };
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// [배포] 성공 판정: docker-compose 가 컨테이너를 교체했다는 문구(또는 바꿀 게 없음)
export function deploySuccessRe(containerName) {
  const n = escapeRe(containerName);
  return new RegExp(`Recreating ${n} \\.\\.\\. done|${n} is up-to-date|Creating ${n} \\.\\.\\. done`);
}

// 헬스체크 응답이 합격인지. 3xx 가 합격 목록에 있으면 따라가지 않고 그 코드를 본다(factory 는 미로그인 / 가 307)
export const healthRedirect = (expect) => (expect.some((c) => c >= 300 && c < 400) ? "manual" : "follow");
export const healthPassed = (status, expect) => expect.includes(status);

export function maintDirOf(cfg) {
  return path.resolve(expandHome(cfg?.maintDir || cfg?.selfdevDir || DEFAULT_SELFDEV_DIR));
}

// 정비 폴더·선택적 maintDir·감독 실행 폴더: 앱·실험 AI 가 고치지 못하게 막는 폴더 목록(중복 없음)
export function protectedMaintDirs(cfg, workDir) {
  const self = expandHome(cfg?.selfdevDir || DEFAULT_SELFDEV_DIR); // 기본일 때는 예전 값 그대로
  const list = [self];
  if (path.resolve(maintDirOf(cfg)) !== path.resolve(self)) list.push(maintDirOf(cfg));
  return list.concat(path.join(workDir, "supervisor-src"));
}

export function maintRemoteOf(cfg) {
  const r = cfg?.maintPushRemote;
  return typeof r === "string" && REMOTE_RE.test(r) ? r : DEFAULT_MAINT_REMOTE;
}
