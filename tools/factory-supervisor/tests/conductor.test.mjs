// 병렬화 단계 C-2(감독 프로그램 쪽) 시험: 지휘자 AI 턴은 읽기 전용(도구 제한·git status 확인), 출력 JSON 읽기, 실패 처리, 합친 뒤 실제 변경 파일, 감독 프로그램 연결.
// 실제 AI·네트워크 없이 가짜 프로세스와 임시 git 저장소로만 돈다. 실행: node tools/factory-supervisor/tests/conductor.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { BLOCKED_TOOLS, READ_TOOLS, conductorArgs, conductorBusy, conductorModelOf, conductorPrompt, listRepoFiles, parseVerdict, repoSnapshot, runConductor, snapshotChange } from "../conductor.mjs";
import { changedFiles } from "../merge.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8").replace(/\r\n/g, "\n");
const git = (cwd, ...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conductor-test-"));
  git(dir, "init", "-q", "-b", "main");
  fs.mkdirSync(path.join(dir, "lib"));
  fs.writeFileSync(path.join(dir, "lib", "a.dart"), "a\n");
  fs.writeFileSync(path.join(dir, "pubspec.yaml"), "name: x\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

const task = { appSlug: "app-a", key: "abc12345", model: "haiku", perApp: 2, sharedFiles: ["pubspec.yaml"], jobs: [{ id: "j1", title: "버튼 색", priority: 0, instruction: "홈 버튼 색을 바꾼다" }, { id: "j2", title: "설정 화면", priority: 0, instruction: "설정 화면에 항목 추가" }] };

/** 가짜 claude 프로세스: 표준입력을 받고, 정해 둔 출력을 내고 끝난다. onRun 에서 작업 폴더를 건드려 읽기 전용 위반을 흉내 낸다 */
function fakeSpawn({ out, code = 0, hang = false, onRun, seen = {} }) {
  return (command, args, opts) => {
    seen.command = command;
    seen.args = args;
    seen.opts = opts;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.pid = 0;
    child.kill = () => child.emit("close", null);
    let prompt = "";
    child.stdin.on("data", (d) => (prompt += d));
    child.stdin.on("end", () => {
      seen.prompt = prompt;
      if (hang) return;
      setTimeout(() => {
        onRun?.(opts.cwd);
        child.stdout.write(typeof out === "string" ? out : JSON.stringify(out));
        child.emit("close", code);
      }, 5);
    });
    return child;
  };
}

const goodVerdict = { jobs: [{ id: "j1", files: ["lib/a.dart"], areas: ["screen"], confidence: "high", note: "" }, { id: "j2", files: ["lib/b.dart"], areas: ["screen"], confidence: "high", note: "" }], groups: [{ jobIds: ["j1", "j2"], reason: "다른 화면" }], sequential: [] };
const okOut = (v = goodVerdict) => ({ type: "result", is_error: false, result: "판단 끝\n```json\n" + JSON.stringify(v) + "\n```", total_cost_usd: 0.0042, usage: { input_tokens: 100, output_tokens: 40, cache_creation_input_tokens: 5, cache_read_input_tokens: 7 } });

test("읽기 전용: 읽기 도구만 열고 파일 수정·git·네트워크 도구는 막는다. 모델은 허용 목록만", () => {
  assert.deepEqual(READ_TOOLS, ["Read", "Glob", "Grep"]);
  for (const t of ["Bash", "Edit", "Write", "WebFetch", "WebSearch", "NotebookEdit"]) assert.ok(BLOCKED_TOOLS.includes(t), t);
  const args = conductorArgs("haiku");
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Glob,Grep");
  assert.equal(args[args.indexOf("--allowedTools") + 1], "Read,Glob,Grep");
  assert.match(args[args.indexOf("--disallowedTools") + 1], /Bash.*Edit.*Write/);
  assert.ok(args.includes("--strict-mcp-config"), "외부 MCP 도구도 쓰지 않는다");
  assert.ok(args.includes("--no-session-persistence"));
  assert.ok(!args.includes("acceptEdits") && !args.includes("bypassPermissions"));
  assert.equal(args[args.indexOf("--model") + 1], "haiku");
  assert.equal(conductorModelOf("sonnet"), "sonnet");
  assert.throws(() => conductorModelOf("gpt-4"), /허용하지 않는/);
  assert.throws(() => conductorArgs("x; rm -rf /"));
});

test("프롬프트: 일감 지시문·파일 목록·공용 파일·출력 JSON 형식·읽기 전용 규칙이 들어 있다", () => {
  const p = conductorPrompt(task, ["lib/a.dart", "pubspec.yaml"], true);
  assert.match(p, /id=j1/);
  assert.match(p, /홈 버튼 색을 바꾼다/);
  assert.match(p, /lib\/a\.dart/);
  assert.match(p, /일부만 보여요/);
  assert.match(p, /pubspec\.yaml/);
  assert.match(p, /읽기만 하세요/);
  for (const k of ['"jobs"', '"groups"', '"sequential"', '"confidence"', '"files"', '"areas"']) assert.ok(p.includes(k), k);
  assert.match(p, /최대 2개/);
});

test("parseVerdict: ```json 블록·앞뒤 설명이 섞인 JSON 을 읽고, JSON 이 없거나 jobs 가 없으면 null", () => {
  assert.deepEqual(parseVerdict("```json\n" + JSON.stringify(goodVerdict) + "\n```").jobs.length, 2);
  assert.equal(parseVerdict("설명 " + JSON.stringify(goodVerdict) + " 끝").groups.length, 1);
  assert.equal(parseVerdict("```json\n{\"a\":1}\n```"), null);
  assert.equal(parseVerdict("그냥 글"), null);
  assert.equal(parseVerdict(""), null);
  assert.equal(parseVerdict("```json\n{깨진\n```"), null);
  const two = "```json\n{\"jobs\":[]}\n```\n마지막:\n```json\n" + JSON.stringify(goodVerdict) + "\n```";
  assert.equal(parseVerdict(two).jobs.length, 2, "마지막 블록이 우선");
});

test("git 확인: status·HEAD 가 같으면 통과, 파일이 바뀌거나 새로 생기거나 커밋이 생기면 읽기 전용 위반", () => {
  const dir = tmpRepo();
  const before = repoSnapshot(dir);
  assert.equal(snapshotChange(before, repoSnapshot(dir)), null);
  fs.writeFileSync(path.join(dir, "new.txt"), "x");
  assert.match(snapshotChange(before, repoSnapshot(dir)), /status/);
  fs.rmSync(path.join(dir, "new.txt"));
  assert.equal(snapshotChange(before, repoSnapshot(dir)), null);
  fs.writeFileSync(path.join(dir, "lib", "a.dart"), "changed\n");
  assert.match(snapshotChange(before, repoSnapshot(dir)), /status/);
  git(dir, "commit", "-qam", "x");
  assert.match(snapshotChange(before, repoSnapshot(dir)), /HEAD/);
  assert.match(snapshotChange(null, before), /확인하지 못/);
  assert.equal(repoSnapshot(os.tmpdir()), null, "git 저장소가 아니면 null");
  assert.deepEqual(listRepoFiles(dir).files.sort(), ["lib/a.dart", "pubspec.yaml"]);
});

test("runConductor: 정상 — 판단 JSON 과 사용량(토큰·비용)을 돌려주고, 작업 폴더는 그대로. 프롬프트는 표준입력, 환경에 지휘자 표시", async () => {
  const dir = tmpRepo();
  const seen = {};
  const res = await runConductor(task, dir, { spawnImpl: fakeSpawn({ out: okOut(), seen }), claudeCmd: "claude" });
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.verdict.groups[0].jobIds.length, 2);
  assert.equal(res.usage.costUsd, 0.0042);
  assert.deepEqual(res.usage.tokens, { input: 100, output: 40, cacheCreate: 5, cacheRead: 7 });
  assert.ok(res.usage.ms >= 0);
  assert.match(seen.prompt, /홈 버튼 색을 바꾼다/);
  assert.ok(!seen.args.some((a) => a.includes("홈 버튼")), "지시문은 인자가 아니라 표준입력으로만");
  assert.equal(seen.opts.cwd, dir, "앱 폴더에서 돈다");
  assert.equal(seen.opts.env.FACTORY_ROLE, "conductor");
  assert.equal(seen.opts.env.FACTORY_LAUNCHER, "1", "훅이 이 턴을 새 정비로 만들지 않는다");
  assert.equal(conductorBusy(), false, "끝나면 busy 해제");
});

test("runConductor: AI 가 작업 폴더를 건드리면(파일 수정·새 파일·커밋) 읽기 전용 위반으로 판단을 쓰지 않는다", async () => {
  for (const [name, onRun] of [["수정", (d) => fs.writeFileSync(path.join(d, "lib", "a.dart"), "hack\n")], ["새 파일", (d) => fs.writeFileSync(path.join(d, "x.txt"), "x")], ["커밋", (d) => { fs.writeFileSync(path.join(d, "y.txt"), "y"); git(d, "add", "-A"); git(d, "commit", "-qm", "y"); }]]) {
    const dir = tmpRepo();
    const res = await runConductor(task, dir, { spawnImpl: fakeSpawn({ out: okOut(), onRun }) });
    assert.equal(res.ok, false, name);
    assert.match(res.reason, /읽기 전용 위반/, name);
    assert.equal(res.verdict, undefined, name);
  }
});

test("runConductor: 실패는 던지지 않고 이유를 돌려준다 — 비정상 종료·JSON 없음·잘못된 출력·시간 초과·잘못된 모델·git 아님·동시에 2개", async () => {
  const dir = tmpRepo();
  const a = await runConductor(task, dir, { spawnImpl: fakeSpawn({ out: { is_error: true, result: "로그인 필요" }, code: 1 }) });
  assert.equal(a.ok, false);
  assert.match(a.reason, /비정상 종료/);
  const b = await runConductor(task, dir, { spawnImpl: fakeSpawn({ out: { is_error: false, result: "JSON 없는 답" } }) });
  assert.match(b.reason, /JSON/);
  const c = await runConductor(task, dir, { spawnImpl: fakeSpawn({ out: "not json at all" }) });
  assert.equal(c.ok, false);
  const d = await runConductor(task, dir, { spawnImpl: fakeSpawn({ hang: true }), timeoutMs: 50 });
  assert.match(d.reason, /시간 초과/);
  const e = await runConductor({ ...task, model: "nope" }, dir, { spawnImpl: fakeSpawn({ out: okOut() }) });
  assert.match(e.reason, /허용하지 않는/);
  const f = await runConductor(task, os.tmpdir(), { spawnImpl: fakeSpawn({ out: okOut() }) });
  assert.match(f.reason, /git 저장소가 아니에요/);
  // 동시에 1개만
  const slow = runConductor(task, dir, { spawnImpl: fakeSpawn({ out: okOut() }) });
  assert.equal(conductorBusy(), true);
  const second = await runConductor(task, dir, { spawnImpl: fakeSpawn({ out: okOut() }) });
  assert.match(second.reason, /이미 돌고 있어요/);
  assert.equal((await slow).ok, true);
  assert.equal(conductorBusy(), false);
});

test("합친 뒤 실제 변경 파일: base 와 임시 브랜치의 차이에서 공장 파일(.factory/·PLAN.md 등)을 뺀다", () => {
  const dir = tmpRepo();
  git(dir, "checkout", "-q", "-b", "factory/job-x");
  fs.writeFileSync(path.join(dir, "lib", "a.dart"), "changed\n");
  fs.writeFileSync(path.join(dir, "lib", "new.dart"), "n\n");
  fs.mkdirSync(path.join(dir, ".factory"));
  fs.writeFileSync(path.join(dir, ".factory", "x.json"), "{}");
  fs.writeFileSync(path.join(dir, "PLAN.md"), "p");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "work");
  assert.deepEqual(changedFiles(dir, "main", "factory/job-x").sort(), ["lib/a.dart", "lib/new.dart"]);
  assert.deepEqual(changedFiles(dir, "main", "no-such-branch"), []);
});

test("감독 프로그램 연결: /next 에 conductor 표시를 보내고, 판단은 공장 동시 실행 수에 세지 않으며, 마지막 일감 뒤 전체 점검 결과를 보낸다", () => {
  const sup = read("supervisor.mjs");
  assert.match(sup, /conductor: conductorBusy\(\)/, "/next 에 conductor=1|busy");
  assert.match(sup, /runConductorTask\(r\.data\.conductor\)/);
  assert.match(sup, /action: "verdict"/);
  assert.match(sup, /action: "fail"/);
  assert.match(sup, /action: "skip"/);
  assert.match(sup, /action: "final"/);
  assert.match(sup, /if \(st\.finalCheck\) await runFinalCheck\(st\)/);
  assert.match(sup, /r\.data\?\.finalCheck/);
  // 지휘자 턴은 running(공장 전체 동시 실행 수)에 넣지 않는다
  const body = sup.slice(sup.indexOf("async function runConductorTask"), sup.indexOf("// 일감 상태(st) 없이"));
  assert.doesNotMatch(body, /running\.set/);
  const merge = read("merge.mjs");
  assert.match(merge, /actualFiles/);
  assert.match(merge, /changedFiles\(repoDir, base, branch\)/);
});
