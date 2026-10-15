// tools/factory-supervisor/planturn.mjs
// 계획 먼저 승인(5-1): 작업자가 일을 시작하기 전에 계획(3~6줄)을 내는 읽기 전용 AI 턴 하나.
//   - 지휘자와 같은 방식이다: 앱 폴더에서 Claude Code 를 읽기 도구(Read·Glob·Grep)만 열어 한 번 돌린다(agents/conductor.json 의 읽기 전용 정의와 가벼운 모델을 그대로 쓴다).
//     파일 수정·git 명령·네트워크는 도구 자체를 막고, 끝난 뒤 git status·HEAD 가 시작 때와 같은지 확인한다(달라졌으면 읽기 전용 위반 → 계획을 쓰지 않는다).
//   - 새 앱처럼 앱 폴더가 아직 없으면 빈 임시 폴더에서 지시문만 보고 계획을 낸다(확인할 저장소가 없다).
//   - 이 턴은 공장 전체 동시 실행 수(running)에 세지 않는다. 이 파일의 busy 표시로 동시에 1개만 돈다.
//   - 결과는 글(계획 줄)이다. 서버가 다시 정리한다(lib/factory/planFirst.ts cleanPlanText).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { conductorArgs, conductorModelOf, CONDUCTOR_TIMEOUT_MS, listRepoFiles, repoSnapshot, snapshotChange } from "./conductor.mjs";
import { safeEnv } from "./envfilter.mjs";
import { agentSpec, envOf } from "./agentrun.mjs";

const IS_WIN = process.platform === "win32";
export const MAX_PLAN_CHARS = 2000;
export const MAX_PLAN_LINES = 8;

let busy = false;

/** 지금 계획 턴이 돌고 있나(/next 에 plan=busy 로 알림) */
export const planBusy = () => busy;

/** 계획 요청문. task: 서버가 준 { appSlug, title, kind, stack, instruction, previousPlan, note, round }, files: 저장소 파일 목록(없으면 빈 배열) */
export function planPrompt(task, files, truncated = false, hasRepo = true) {
  const list = hasRepo ? files.join("\n") + (truncated ? "\n... (목록이 길어 일부만 보여요. 필요한 곳은 Glob·Grep 으로 찾으세요)" : "") : "(아직 앱 폴더가 없어요. 새로 만드는 앱이에요)";
  const redo = task.previousPlan
    ? `\n## 이전 계획 (사람이 고치라고 했어요)\n${task.previousPlan}\n\n## 사람의 수정 지시\n${task.note || "(말 없이 다시 만들기를 눌렀어요)"}\n위 수정 지시를 반영해 계획을 새로 쓰세요.\n`
    : task.note
    ? `\n## 사람의 참고 말\n${task.note}\n`
    : "";

  return `당신은 앱 공장의 '계획 담당'이에요. 아래 ${task.kind === "new" ? "새 앱 만들기" : "수정"} 지시를 작업자가 실제로 시작하기 전에, 사람이 읽고 승인할 계획을 쓰세요.

## 규칙
- 읽기만 하세요. 파일을 고치거나 git 명령·네트워크를 쓰지 마세요(도구가 막혀 있어요). 코드를 짜지 말고 계획만 쓰세요.
- 아래 파일 목록과 필요한 파일의 일부를 읽어 근거를 찾으세요. 새로 만들 파일도 적으세요.
- 3~6줄, 줄마다 '- ' 로 시작하는 짧은 문장으로 쓰세요. 다음을 모두 담으세요: 고칠 파일(경로), 순서, 위험(깨질 수 있는 곳·되돌리기 어려운 것), 예상 시간(분).
- 머리말·인사·코드 블록 없이 계획 줄만 답하세요. 비밀번호·키 값은 쓰지 마세요.

## 앱: ${task.appSlug} · ${task.title} (${task.stack})
${redo}
## 지시문
${task.instruction || "(지시문 없음)"}

## 저장소 파일 목록 (git ls-files)
${list}`;
}

/** AI 의 마지막 답에서 계획 줄만 꺼낸다: 코드 블록 표시·빈 줄 제거, 최대 줄 수·글자 수. 비면 null */
export function parsePlan(text) {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !/^\s*```/.test(l));
  const plan = lines.slice(0, MAX_PLAN_LINES).join("\n").slice(0, MAX_PLAN_CHARS).trim();

  return plan.length >= 10 ? plan : null;
}

function usageOf(ev, ms) {
  const u = ev?.usage ?? {};

  return {
    ms,
    costUsd: typeof ev?.total_cost_usd === "number" ? ev.total_cost_usd : null,
    tokens: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheCreate: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 },
  };
}

/**
 * 계획 턴 한 번. 던지지 않는다. 반환: { ok:true, plan, usage, model } | { ok:false, reason, usage? }
 * cwd: 앱 폴더(git 저장소). 없거나 저장소가 아니면 빈 임시 폴더에서 돌린다.
 * opts: { claudeCmd, env, timeoutMs, spawnImpl(시험용), spec }
 */
export async function runPlanTurn(task, cwd, opts = {}) {
  if (busy) return { ok: false, reason: "계획 턴이 이미 돌고 있어요" };
  busy = true;
  const started = Date.now();
  let tmp = null;

  try {
    let model;

    try {
      model = conductorModelOf(task.model);
    } catch (e) {
      return { ok: false, reason: e.message };
    }
    const before = cwd && fs.existsSync(path.join(cwd, ".git")) ? repoSnapshot(cwd) : null;
    const hasRepo = !!before;
    let runDir = cwd;

    if (!hasRepo) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "factory-plan-"));
      runDir = tmp;
    }
    const { files, truncated } = hasRepo ? listRepoFiles(cwd) : { files: [], truncated: false };
    const prompt = planPrompt(task, files, truncated, hasRepo);
    const command = opts.claudeCmd || "claude";
    const spec = opts.spec === undefined ? agentSpec("C1") : opts.spec;
    const args = conductorArgs(model, spec);

    if (IS_WIN && (/[&|<>^%\r\n]/.test(command) || args.some((a) => /[&|<>^%\r\n]/.test(a)))) return { ok: false, reason: "AI 실행 명령에 허용하지 않는 셸 문자가 있어요" };
    const timeoutMs = opts.timeoutMs ?? spec?.limits.timeoutMs ?? CONDUCTOR_TIMEOUT_MS;
    const run = await new Promise((resolve) => {
      const child = (opts.spawnImpl ?? spawn)(command, args, { cwd: runDir, env: spec ? envOf(spec, process.env, {}, opts.env ?? {}) : safeEnv(process.env, { ...(opts.env ?? {}), FACTORY_LAUNCHER: "1", FACTORY_ROLE: "conductor" }), shell: IS_WIN, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      let done = false;
      let timedOut = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (IS_WIN && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
          else child.kill("SIGKILL");
        } catch {
          /* 이미 끝남 */
        }
        finish({ timeout: true, out, err });
      }, timeoutMs);

      child.stdout.on("data", (d) => (out = (out + d.toString()).slice(-400_000)));
      child.stderr.on("data", (d) => (err = (err + d.toString()).slice(-2000)));
      child.on("error", (e) => finish({ error: e.message, out, err }));
      child.on("close", (code) => finish(timedOut ? { timeout: true, out, err } : { code, out, err }));
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
    });
    const ms = Date.now() - started;

    // 읽기 전용 확인은 결과보다 먼저 본다
    if (hasRepo) {
      const changed = snapshotChange(before, repoSnapshot(cwd));

      if (changed) return { ok: false, reason: `읽기 전용 위반: ${changed}. 계획을 쓰지 않아요`, usage: usageOf(null, ms) };
    }
    if (run.timeout) return { ok: false, reason: `시간 초과(${Math.round(timeoutMs / 60000)}분)`, usage: usageOf(null, ms) };
    if (run.error) return { ok: false, reason: `AI 를 실행하지 못했어요: ${run.error}`.slice(0, 300) };
    let ev = null;

    try {
      ev = JSON.parse(run.out.trim());
    } catch {
      /* 아래에서 실패 처리 */
    }
    const usage = usageOf(ev, ms);

    if (!ev || ev.is_error || run.code !== 0) return { ok: false, reason: `AI 가 비정상 종료했어요(코드 ${run.code}): ${String(ev?.result ?? run.err ?? "").trim().slice(-200)}`, usage };
    const plan = parsePlan(ev.result);

    if (!plan) return { ok: false, reason: "AI 가 계획을 쓰지 않았어요", usage };

    return { ok: true, plan, usage, model };
  } catch (e) {
    return { ok: false, reason: `계획 턴 실행 중 오류: ${e.message}`.slice(0, 300) };
  } finally {
    busy = false;
    if (tmp) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* 임시 폴더 정리 실패는 무시 */
      }
    }
  }
}
