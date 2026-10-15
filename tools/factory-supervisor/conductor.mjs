// tools/factory-supervisor/conductor.mjs
// 지휘자(병렬화 단계 C-2): 같은 앱에 승인된 수정 일감이 서로 겹치는지 판단하는 읽기 전용 AI 턴 하나.
//   - 앱 폴더에서 Claude Code 를 읽기 도구(Read·Glob·Grep)만 열어 한 번 돌린다. 파일 수정·git 명령·네트워크는 도구 자체를 막는다(--tools, --disallowedTools).
//   - 끝난 뒤 git status·HEAD 가 시작 때와 같은지 확인한다. 달라졌으면 읽기 전용 위반으로 보고 판단을 쓰지 않는다.
//   - 이 턴은 공장 전체 동시 실행 수(running)에 세지 않는다. 대신 이 파일의 busy 표시로 동시에 1개만 돈다.
//   - 결과(JSON)는 서버가 다시 검사한다. 이 파일은 서버에 묶음을 정하라고 하지 않고 '판단'만 보낸다.
import { spawn, spawnSync } from "node:child_process";

import { CLAUDE_MODELS } from "./ai-runner.mjs";
import { safeEnv } from "./envfilter.mjs";
import { agentSpec, envOf, oneshotArgs } from "./agentrun.mjs";

export const CONDUCTOR_TIMEOUT_MS = 4 * 60_000;
export const MAX_FILE_LIST = 1500;
const IS_WIN = process.platform === "win32";

let busy = false;

/** 지금 지휘자 턴이 돌고 있나(/next 에 conductor=busy 로 알림) */
export const conductorBusy = () => busy;

/** 읽기 전용으로 여는 도구와 막는 도구. 시험이 이 목록을 확인한다 */
export const READ_TOOLS = ["Read", "Glob", "Grep"];
export const BLOCKED_TOOLS = ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Agent"];

/** 지휘자 모델: 허용 목록 안의 별칭만. 아니면 던진다(조용히 다른 모델로 바꾸지 않음) */
export function conductorModelOf(value) {
  if (typeof value !== "string" || !CLAUDE_MODELS.includes(value)) throw new Error(`허용하지 않는 지휘자 모델이에요: ${String(value).slice(0, 30)}`);

  return value;
}

/**
 * claude 실행 인자(셸 문자열로 잇지 않고 칸으로만 넘긴다). 프롬프트는 표준입력.
 * 에이전트 정의(agents/conductor.json, C1)가 있으면 거기서 만들고, 없거나 거절됐으면 아래 예전 값 그대로(둘이 같은지는 시험이 비교한다)
 */
export function conductorArgs(model, spec = agentSpec("C1")) {
  if (spec) return oneshotArgs(spec, conductorModelOf(model));

  return [
    "-p",
    "--output-format", "json",
    "--permission-mode", "default",
    "--tools", READ_TOOLS.join(","),
    "--allowedTools", READ_TOOLS.join(","),
    "--disallowedTools", BLOCKED_TOOLS.join(","),
    "--strict-mcp-config",
    "--no-session-persistence",
    "--model", conductorModelOf(model),
  ];
}

// ───────── 프롬프트 ─────────

/** 판단 요청문. task: 서버가 준 { appSlug, perApp, sharedFiles, jobs:[{id,title,priority,instruction}] }, files: 저장소 파일 목록 */
export function conductorPrompt(task, files, truncated = false) {
  const jobs = task.jobs
    .map((j, i) => `### 일감 ${i + 1}: id=${j.id} · 우선순위 ${j.priority} · ${j.title}\n${j.instruction || "(지시문 없음)"}`)
    .join("\n\n");
  const list = files.join("\n") + (truncated ? "\n... (목록이 길어 일부만 보여요. 필요한 곳은 Glob·Grep 으로 찾으세요)" : "");

  return `당신은 앱 공장의 '지휘자'예요. 이 앱(${task.appSlug})에 승인된 수정 일감이 ${task.jobs.length}개 쌓여 있어요. 이 일감들을 같은 앱에서 동시에(각자 git 작업 사본에서) 돌려도 서로 충돌하지 않을지만 판단하세요.

## 규칙
- 읽기만 하세요. 파일을 고치거나 git 명령·네트워크를 쓰지 마세요(도구가 막혀 있어요). 코드를 짜지 말고 판단만 하세요.
- 일감마다 실제로 수정하게 될 파일의 저장소 기준 상대 경로를 최대한 정확히 예상하세요. 아래 파일 목록과 필요한 파일의 일부를 읽어 근거를 찾으세요. 새로 만들 파일도 적으세요.
- 확신도: high = 파일을 구체적으로 짚을 수 있음 / medium = 대체로 알지만 더 있을 수 있음 / low = 잘 모르겠음. 애매하면 low 로 하세요(low·medium 은 묶지 않고 순서대로 돌려요).
- 영역(areas)은 screen(화면), data(데이터), config(설정), dependency(의존성), logic(로직), test(시험), docs(문서), assets(리소스), other 중에서 고르세요.
- 의존성·빌드 파일, 라우터·앱 전역 설정, 마이그레이션·스키마, 번역 파일처럼 모두가 건드리는 공용 파일을 고칠 것 같으면 그 파일을 files 에 꼭 적으세요. 서버가 공용 파일 목록으로 다시 검사해 묶지 않아요. 지금 공용 파일 패턴: ${task.sharedFiles.join(", ") || "(없음)"}
- 같은 묶음은 최대 ${task.perApp}개예요. 묶음은 우선순위 순서로 이어진 일감이어야 해요(중간 일감을 건너뛰고 묶지 마세요). 서로 겹치거나 확신이 없으면 묶지 말고 sequential 에 이유와 함께 적으세요.

## 일감
${jobs}

## 저장소 파일 목록 (git ls-files)
${list}

## 출력
마지막 답은 아래 모양의 JSON 하나만, 다른 글 없이 \`\`\`json 코드 블록 안에 쓰세요.
\`\`\`json
{
  "jobs": [{ "id": "<일감 id>", "files": ["lib/a.dart"], "areas": ["screen"], "confidence": "high", "note": "근거 한 줄" }],
  "groups": [{ "jobIds": ["<id>", "<id>"], "reason": "같이 돌려도 되는 이유" }],
  "sequential": [{ "jobIds": ["<id>"], "reason": "순서대로 둘 이유" }]
}
\`\`\`
모든 일감을 jobs 에 빠짐없이 넣고, 각 일감은 groups 또는 sequential 중 한 곳에만 넣으세요.`;
}

/** AI 의 마지막 답에서 JSON 을 꺼낸다: ```json 블록 → 가장 바깥 { } 순. 못 꺼내면 null */
export function parseVerdict(text) {
  const t = String(text ?? "");
  const fenced = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);

  for (const c of [...fenced.reverse(), t]) {
    const a = c.indexOf("{");
    const b = c.lastIndexOf("}");

    if (a < 0 || b <= a) continue;
    try {
      const v = JSON.parse(c.slice(a, b + 1));

      if (v && typeof v === "object" && !Array.isArray(v) && Array.isArray(v.jobs)) return v;
    } catch {
      /* 다음 후보 */
    }
  }

  return null;
}

// ───────── git 상태 확인 ─────────

function gitOut(dir, args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", shell: false, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } });

  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

/** 읽기 전용 확인용 스냅샷: git status 와 HEAD. git 저장소가 아니면 null */
export function repoSnapshot(dir) {
  const head = gitOut(dir, ["rev-parse", "HEAD"]);

  if (!head.ok) return null;

  return { head: head.out, status: gitOut(dir, ["status", "--porcelain"]).out };
}

/** 시작 때와 끝난 뒤가 같으면 null, 다르면 이유 */
export function snapshotChange(before, after) {
  if (!before || !after) return "git 상태를 확인하지 못했어요";
  if (before.head !== after.head) return "HEAD 가 바뀌었어요";
  if (before.status !== after.status) return "작업 폴더의 git status 가 바뀌었어요";

  return null;
}

/** 저장소 파일 목록(추적 중인 파일). 너무 길면 앞부분만 */
export function listRepoFiles(dir) {
  const r = gitOut(dir, ["ls-files"]);

  if (!r.ok) return { files: [], truncated: false };
  const all = r.out.split("\n").map((f) => f.trim()).filter(Boolean);

  return { files: all.slice(0, MAX_FILE_LIST), truncated: all.length > MAX_FILE_LIST };
}

// ───────── 실행 ─────────

function usageOf(ev, ms) {
  const u = ev?.usage ?? {};

  return {
    ms,
    costUsd: typeof ev?.total_cost_usd === "number" ? ev.total_cost_usd : null,
    tokens: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheCreate: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 },
  };
}

/**
 * 지휘자 턴 한 번. 던지지 않는다. 반환: { ok:true, verdict, usage } | { ok:false, reason, usage? }
 * opts: { claudeCmd, env, timeoutMs, spawnImpl(시험용) }
 */
export async function runConductor(task, cwd, opts = {}) {
  if (busy) return { ok: false, reason: "지휘자가 이미 돌고 있어요" };
  busy = true;
  const started = Date.now();

  try {
    let model;

    try {
      model = conductorModelOf(task.model);
    } catch (e) {
      return { ok: false, reason: e.message };
    }
    const before = repoSnapshot(cwd);

    if (!before) return { ok: false, reason: "앱 폴더가 git 저장소가 아니에요" };
    const { files, truncated } = listRepoFiles(cwd);
    const prompt = conductorPrompt(task, files, truncated);
    const command = opts.claudeCmd || "claude";
    const spec = opts.spec === undefined ? agentSpec("C1") : opts.spec;
    const args = conductorArgs(model, spec);

    if (IS_WIN && (/[&|<>^%\r\n]/.test(command) || args.some((a) => /[&|<>^%\r\n]/.test(a)))) return { ok: false, reason: "AI 실행 명령에 허용하지 않는 셸 문자가 있어요" };
    const run = await new Promise((resolve) => {
      const child = (opts.spawnImpl ?? spawn)(command, args, { cwd, env: spec ? envOf(spec, process.env, {}, opts.env ?? {}) : safeEnv(process.env, { ...(opts.env ?? {}), FACTORY_LAUNCHER: "1", FACTORY_ROLE: "conductor" }), shell: IS_WIN, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      };
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (IS_WIN && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
          else child.kill("SIGKILL");
        } catch {
          /* 이미 끝남 */
        }
        finish({ timeout: true, out, err });
      }, opts.timeoutMs ?? spec?.limits.timeoutMs ?? CONDUCTOR_TIMEOUT_MS);

      child.stdout.on("data", (d) => (out = (out + d.toString()).slice(-400_000)));
      child.stderr.on("data", (d) => (err = (err + d.toString()).slice(-2000)));
      child.on("error", (e) => finish({ error: e.message, out, err }));
      child.on("close", (code) => finish(timedOut ? { timeout: true, out, err } : { code, out, err }));
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
    });
    const ms = Date.now() - started;

    // 읽기 전용 확인은 결과보다 먼저 본다(어떤 경우에도 상태가 달라졌으면 판단을 쓰지 않는다)
    const changed = snapshotChange(before, repoSnapshot(cwd));

    if (changed) return { ok: false, reason: `읽기 전용 위반: ${changed}. 판단을 쓰지 않아요`, usage: usageOf(null, ms) };
    if (run.timeout) return { ok: false, reason: `시간 초과(${Math.round((opts.timeoutMs ?? spec?.limits.timeoutMs ?? CONDUCTOR_TIMEOUT_MS) / 60000)}분)`, usage: usageOf(null, ms) };
    if (run.error) return { ok: false, reason: `AI 를 실행하지 못했어요: ${run.error}`.slice(0, 300) };
    let ev = null;

    try {
      ev = JSON.parse(run.out.trim());
    } catch {
      /* 아래에서 실패 처리 */
    }
    const usage = usageOf(ev, ms);

    if (!ev || ev.is_error || run.code !== 0) return { ok: false, reason: `AI 가 비정상 종료했어요(코드 ${run.code}): ${String(ev?.result ?? run.err ?? "").trim().slice(-200)}`, usage };
    const verdict = parseVerdict(ev.result);

    if (!verdict) return { ok: false, reason: "AI 의 답에서 JSON 을 읽지 못했어요", usage };

    return { ok: true, verdict, usage, model };
  } catch (e) {
    return { ok: false, reason: `지휘자 실행 중 오류: ${e.message}`.slice(0, 300) };
  } finally {
    busy = false;
  }
}
