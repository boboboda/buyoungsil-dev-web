// 4-2 감독 코드 일반화: 설정을 비워 두면 예전 값(블로그 developWeb / www)과 똑같고, 설정하면 그 값을 따른다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEPLOY_DEFAULTS, deploySuccessRe, healthPassed, healthRedirect, isSupervisorOnlyDir, maintDirOf, maintRemoteOf, protectedMaintDirs, resolveDeploy } from "../deploycfg.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(HERE, "..", f), "utf8");

test("기본값 = 예전에 박혀 있던 값", () => {
  const d = resolveDeploy({});
  assert.deepEqual(d.problems, []);
  assert.equal(d.workName, "developWeb");
  assert.equal(d.containerName, "developWeb");
  assert.equal(d.healthUrl, "https://www.buyoungsilcoding.com/");
  assert.deepEqual(d.healthExpect, [200]);
  assert.equal(d.nginxDomain, "buyoungsilcoding.com");
  assert.match(d.repoDescription, /buyoungsil-dev-web.*tools\/factory-supervisor/);
  assert.deepEqual(resolveDeploy(undefined).problems, []);
  assert.deepEqual(resolveDeploy({ deploy: {} }).healthExpect, [200]);
  assert.ok(Object.isFrozen(DEPLOY_DEFAULTS), "기본값 객체를 바꿀 수 없다");
  // 기본 판정 문구는 예전 정규식과 같은 문장에 반응한다
  const re = deploySuccessRe(d.containerName);
  for (const t of ["Recreating developWeb ... done", "developWeb is up-to-date", "Creating developWeb ... done"]) assert.ok(re.test(t), t);
  assert.ok(!re.test("Recreating factoryWeb ... done"));
  assert.ok(healthPassed(200, d.healthExpect) && !healthPassed(401, d.healthExpect));
  assert.equal(healthRedirect(d.healthExpect), "follow", "기본은 예전처럼 리다이렉트를 따라간다");
});

test("factory 값: 컨테이너·헬스 주소·합격 코드", () => {
  const d = resolveDeploy({ deploy: { workName: "factoryWeb", containerName: "factoryWeb", healthUrl: "https://factory.example.com/api/factory/next", healthExpect: [401], nginxDomain: "factory.example.com", repoDescription: "공장 홈페이지 factory-web" } });
  assert.deepEqual(d.problems, []);
  assert.equal(d.workName, "factoryWeb");
  assert.ok(deploySuccessRe(d.containerName).test("Recreating factoryWeb ... done"));
  assert.ok(!deploySuccessRe(d.containerName).test("Recreating developWeb ... done"));
  assert.ok(healthPassed(401, d.healthExpect) && !healthPassed(200, d.healthExpect));
  assert.equal(d.repoDescription, "공장 홈페이지 factory-web");
  assert.equal(healthRedirect([307]), "manual", "3xx 가 합격이면 따라가지 않는다");
  assert.equal(healthRedirect([200, 401]), "follow");
  // 컨테이너 이름의 정규식 특수문자는 글자 그대로
  assert.ok(deploySuccessRe("a.b").test("Recreating a.b ... done") && !deploySuccessRe("a.b").test("Recreating aXb ... done"));
});

test("잘못된 값은 problems 에 모으고 그 항목은 기본값으로 둔다", () => {
  const bad = [
    { workName: "a b" }, { containerName: "x;rm" }, { healthUrl: "http://www.example.com/" }, { healthUrl: "https://u:p@x.example.com/" }, { healthUrl: "ftp://x" },
    { healthExpect: [] }, { healthExpect: [99] }, { healthExpect: ["200"] }, { healthExpect: 200 }, { nginxDomain: "a b" }, { repoDescription: "줄\n바꿈" }, { repoDescription: "`백틱`" },
  ];
  for (const d of bad) {
    const r = resolveDeploy({ deploy: d });
    assert.equal(r.problems.length, 1, JSON.stringify(d));
    assert.equal(r.workName, "developWeb");
    assert.equal(r.healthUrl, DEPLOY_DEFAULTS.healthUrl);
  }
  // 시험 모드(local): 이 PC 주소만
  assert.deepEqual(resolveDeploy({ deploy: { healthUrl: "http://127.0.0.1:9/x" } }, { local: true }).problems, []);
  assert.equal(resolveDeploy({ deploy: { healthUrl: "https://www.example.com/" } }, { local: true }).problems.length, 1);
});

test("maintDir·maintPushRemote: 기본 = selfdevDir·origin, 보호 폴더는 두 값을 모두 본다", () => {
  const work = path.join(os.tmpdir(), "wk");
  const self = path.join(os.tmpdir(), "selfdev-x");
  const maint = path.join(os.tmpdir(), "maint-y");
  assert.equal(maintDirOf({ selfdevDir: self }), path.resolve(self));
  assert.equal(maintDirOf({}), path.resolve(path.join(os.homedir(), "dev/factory/selfdev")));
  assert.equal(maintDirOf({ selfdevDir: self, maintDir: maint }), path.resolve(maint));
  assert.equal(maintDirOf({ selfdevDir: self, maintDir: "" }), path.resolve(self));
  assert.equal(maintRemoteOf({}), "origin");
  assert.equal(maintRemoteOf({ maintPushRemote: "factory" }), "factory");
  assert.equal(maintRemoteOf({ maintPushRemote: "a b; x" }), "origin", "이상한 이름은 기본값");
  // 기본이면 예전 목록과 똑같다(정비 폴더 + supervisor-src)
  assert.deepEqual(protectedMaintDirs({ selfdevDir: self }, work), [self, path.join(work, "supervisor-src")]);
  assert.deepEqual(protectedMaintDirs({ selfdevDir: self, maintDir: self }, work), [self, path.join(work, "supervisor-src")]);
  assert.deepEqual(protectedMaintDirs({ selfdevDir: self, maintDir: maint }, work), [self, path.resolve(maint), path.join(work, "supervisor-src")]);
});

test("연결: 감독이 새 설정 키를 받고(기본값 포함), 정비 코드는 고정 문자열 없이 설정을 쓴다", () => {
  const sup = read("supervisor.mjs");
  assert.match(sup, /maintDir: "",/);
  assert.match(sup, /maintPushRemote: "origin",/);
  assert.match(sup, /deploy: \{\},/);
  assert.doesNotMatch(sup, /expand\(cfg\.selfdevDir \|\| "~\/dev\/factory\/selfdev"\), path\.join\(cfg\.workDir, "supervisor-src"\)/, "보호 폴더는 protectedMaintDirs 로");
  const maint = read("maintenance.mjs");
  assert.doesNotMatch(maint, /Recreating developWeb/);
  assert.doesNotMatch(maint, /fetch\("https:\/\/www\.buyoungsilcoding\.com/);
  assert.doesNotMatch(maint, /"origin"/, "정비 git 원격 이름은 maintPushRemote 로");
  assert.match(maint, /\{\{REPO\}\}/);
  const sc = read("serverctl.mjs");
  assert.doesNotMatch(sc, /fetch\(SITE_URL/);
  assert.match(sc, /service-token[\s\S]{0,40}/);
  assert.match(sc, /보관함 주소는 deploy 설정이 아니라 감독 설정의 serverUrl 을 따른다/);
});

test("정비 폴더에 tsconfig.json 이 없으면 감독 전용 저장소로 본다(검사는 node --check 만)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "supdir-"));
  try {
    assert.equal(isSupervisorOnlyDir(d), true);
    fs.writeFileSync(path.join(d, "tsconfig.json"), "{}");
    assert.equal(isSupervisorOnlyDir(d), false);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
