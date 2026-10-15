// 환경변수 거르기(정비·지휘자·앱 일감·실험 공통), 앱 일감 ~/.ssh 읽기 금지, Codex 서버 접속 막기 시험
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureNosshDir, NOSSH_COMMANDS, NOSSH_MESSAGE, safeEnv, withNossh } from "../envfilter.mjs";
import { invocation } from "../ai-runner.mjs";

const BASE = {
  PATH: "/usr/bin", HOME: "/home/x", GITHUB_TOKEN: "t", DB_PASSWORD: "p", NEXTAUTH_SECRET: "s", OPENAI_API_KEY: "k", MY_PRIVATE_KEY: "pk", SERVERCTL_VALUE: "v",
  FACTORY_WORKER_TOKEN: "w", FACTORY_SECRET_KEY: "fs", FACTORY_MAINTENANCE: "old", LANG: "ko",
};

test("safeEnv: 키·토큰 모양 변수는 빠지고 일반 변수는 남는다", () => {
  const e = safeEnv(BASE);
  for (const k of ["GITHUB_TOKEN", "DB_PASSWORD", "NEXTAUTH_SECRET", "OPENAI_API_KEY", "MY_PRIVATE_KEY", "SERVERCTL_VALUE", "FACTORY_WORKER_TOKEN", "FACTORY_SECRET_KEY"]) assert.equal(k in e, false, k);
  assert.equal(e.PATH, "/usr/bin");
  assert.equal(e.LANG, "ko");
  assert.equal(e.FACTORY_MAINTENANCE, "old", "감독이 정한 허용 변수는 남는다");
});

test("정비: FACTORY_MAINTENANCE* 는 더해지고 비밀은 없다", () => {
  const e = safeEnv(BASE, { FACTORY_MAINTENANCE: "th1", FACTORY_MAINTENANCE_TURN: "t1" });
  assert.equal(e.FACTORY_MAINTENANCE, "th1");
  assert.equal(e.FACTORY_MAINTENANCE_TURN, "t1");
  assert.equal(e.GITHUB_TOKEN, undefined);
});

test("지휘자: FACTORY_ROLE·LAUNCHER 가 붙고 비밀은 없다", () => {
  const e = safeEnv(BASE, { FACTORY_LAUNCHER: "1", FACTORY_ROLE: "conductor" });
  assert.equal(e.FACTORY_ROLE, "conductor");
  assert.equal(e.NEXTAUTH_SECRET, undefined);
});

test("앱 일감: requiredSecrets 키만 더해지고 나머지 비밀은 빠진다", () => {
  const e = safeEnv(BASE, { MY_SERVICE_API_KEY: "allowed", FACTORY_APP_SLUG: "a", FACTORY_JOB_ID: "j" });
  assert.equal(e.MY_SERVICE_API_KEY, "allowed");
  assert.equal(e.FACTORY_APP_SLUG, "a");
  assert.equal(e.OPENAI_API_KEY, undefined);
  assert.equal(e.GITHUB_TOKEN, undefined);
});

test("실험: FACTORY_LAB_* 가 남는다", () => {
  const e = safeEnv(BASE, { FACTORY_LAB_JOB_ID: "j", FACTORY_LAB_DIR: "/l", FACTORY_LAB_SHARED: "/s" });
  assert.equal(e.FACTORY_LAB_DIR, "/l");
  assert.equal(e.DB_PASSWORD, undefined);
});

test("호출 지점이 모두 safeEnv 를 쓴다(원본 process.env 를 통째로 펼치지 않는다)", () => {
  const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  assert.doesNotMatch(read("maintenance.mjs"), /env: \{ \.\.\.process\.env, FACTORY_MAINTENANCE/);
  assert.match(read("maintenance.mjs"), /childEnv: safeEnv\(/);
  assert.match(read("maintenance.mjs"), /env: safeEnv\(process\.env, \{ FACTORY_MAINTENANCE/);
  assert.match(read("conductor.mjs"), /: safeEnv\(process\.env/); // 정의가 없을 때의 예전 경로
  assert.match(read("agentrun.mjs"), /return safeEnv\(base, /); // 정의에서 만드는 환경도 같은 거르기를 거친다
  const sup = read("supervisor.mjs");
  assert.match(sup, /: safeEnv\(process\.env, \{ \.\.\.aiSecrets/);
  assert.match(sup, /return safeEnv\(process\.env, \{ FACTORY_JOB_ID/);
  assert.doesNotMatch(sup, /env: \{ \.\.\.process\.env, \.\.\.aiSecrets/);
});

test("앱 일감 권한 설정에 ~/.ssh·~/.aws 읽기 금지가 있고 서버 접속 명령 자체는 막지 않는다", () => {
  const sup = fs.readFileSync(new URL("../supervisor.mjs", import.meta.url), "utf8");
  const body = sup.slice(sup.indexOf("function appPermissionSettings"), sup.indexOf("function git("));
  assert.match(body, /"Read\(~\/\.ssh\/\*\*\)"/);
  assert.match(body, /"Read\(~\/\.aws\/\*\*\)"/);
  assert.doesNotMatch(body, /Bash\((ssh|scp)/);
  assert.match(body, /hooks: guardHookSettings\(\)/);
});

test("Codex: 서버 접속 명령이 안내 스크립트로 잡혀 실패한다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nossh-"));
  try {
    ensureNosshDir(dir);
    const env = withNossh({ ...process.env }, dir);
    const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
    assert.ok(env[key].startsWith(dir + path.delimiter));
    for (const c of NOSSH_COMMANDS.slice(0, 4)) {
      const r = spawnSync(`${c} serverpc2 hi`, { env, shell: true, encoding: "utf8", windowsHide: true });
      assert.notEqual(r.status, 0, c);
      assert.match(`${r.stdout}${r.stderr}`, /Claude Code 로 다시 보내세요/, c);
    }
    const g = spawnSync("sh", ["-c", `${env.GIT_SSH_COMMAND} serverpc2 x`], { env, encoding: "utf8" });
    assert.notEqual(g.status, 0);
    assert.match(g.stderr, /Claude Code 로 다시 보내세요/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("startAi: Codex 만 PATH 가 감싸지고 기본 샌드박스는 네트워크가 꺼져 있다", () => {
  const src = fs.readFileSync(new URL("../ai-runner.mjs", import.meta.url), "utf8");
  assert.match(src, /engine === "codex" \? withNossh\(/);
  assert.equal(invocation("codex", {}, {}).args.includes("sandbox_workspace_write.network_access=false"), true);
  assert.match(NOSSH_MESSAGE, /Claude Code 로 다시 보내세요/);
});
