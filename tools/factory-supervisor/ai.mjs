#!/usr/bin/env node
// Single local terminal interface. It never commits, pushes, deploys, or changes provider auth.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { acquireWorkspace, engineOf, ENGINE_LABELS, eventDecoder, excludeHarnessState, gitSnapshot, handoffPrompt, harnessFile, lockPath, recordLifecycle, recoverWorkspace, redactAiText, saveHandoff, startAi, stopAi, verifyWorkspace } from "./ai-runner.mjs";
import { keyFilesToCommit } from "./keyguard.mjs";
import { checksFromVerification, headOf } from "./handoff.mjs";

const usage = `사용법:
  node tools/factory-supervisor/ai.mjs run claude|codex --project <폴더> [--prompt <지시>] [--stack <종류>]
  node tools/factory-supervisor/ai.mjs switch claude|codex --project <폴더> [--prompt <지시>]
  node tools/factory-supervisor/ai.mjs status|verify|recover --project <폴더>
대화형 입력: /switch claude|codex, /verify, /exit
프로젝트별 잠금은 홈페이지 감독 프로그램과 공유합니다.`;

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("--help")) return console.log(usage);
  const action = argv.shift();
  if (!["run", "switch", "status", "verify", "recover"].includes(action)) throw new Error(usage);
  let engine = ["run", "switch"].includes(action) ? engineOf(argv.shift()) : "claude";
  const options = {};
  while (argv.length) {
    const flag = argv.shift();
    if (!["--project", "--prompt", "--stack"].includes(flag) || !argv.length) throw new Error(usage);
    options[flag.slice(2)] = argv.shift();
  }
  const dir = path.resolve(options.project || process.cwd());
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error("프로젝트 폴더가 없습니다.");
  if (action === "status") {
    const lockFile = lockPath(dir);
    const stateFile = harnessFile(dir, "ai-state.json", false);
    console.log(redactAiText(JSON.stringify({ lock: fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, "utf8")) : null, handoff: fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : null, current: gitSnapshot(dir) }, null, 2)));
    return;
  }
  if (action === "recover") return console.log(recoverWorkspace(dir));
  const lock = acquireWorkspace(dir, { engine, taskId: "terminal" });
  let currentChild = null;
  let interrupted = false;
  const interrupt = () => { interrupted = true; stopAi(currentChild); input?.close(); };
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  let input;
  try {
    excludeHarnessState(dir);
    const verify = async () => {
      recordLifecycle(dir, engine, "verification-start", "terminal");
      const result = await verifyWorkspace(dir, options.stack, console.log, 15 * 60_000, (child) => { currentChild = child; lock.setChild(child.pid || null); });
      const blocked = keyFilesToCommit(dir);
      if (blocked.length) return { ok: false, reason: `키 파일 커밋 차단: ${blocked.join(", ")}` };
      recordLifecycle(dir, engine, result.ok ? "verification-passed" : "verification-failed", "terminal");
      return result;
    };
    if (action === "verify") {
      const result = await verify();
      console.log(redactAiText(JSON.stringify(result)));
      if (!result.ok) process.exitCode = 1;
      return;
    }
    const sessionsFile = harnessFile(dir, "ai-sessions.json");
    let sessions = {};
    try { sessions = JSON.parse(fs.readFileSync(sessionsFile, "utf8")); } catch { /* first invocation */ }
    const turn = async (prompt) => {
      recordLifecycle(dir, engine, "session-start", "terminal");
      const startHead = headOf(dir) || undefined; // 인계 기록: 이번 실행에서 커밋된 파일을 가려내는 기준
      const decode = eventDecoder(engine);
      const child = startAi(engine, {}, { cwd: dir, sessionId: sessions[engine], env: process.env });
      currentChild = child;
      lock.setChild(child.pid || null);
      let result = null;
      let stderr = "";
      let sessionId = sessions[engine] || null;
      let timedOut = false;
      let killedAfterResult = false;
      let graceTimer = null;
      const timer = setTimeout(() => { timedOut = true; stopAi(child); }, 120 * 60_000);
      const lines = readline.createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        let ev;
        try { ev = decode(JSON.parse(line)); } catch { console.log(redactAiText(line)); return; }
        if (!ev) return;
        if (ev.session_id) sessionId = ev.session_id;
        if (ev.type === "assistant") for (const block of ev.message?.content || []) if (block.type === "text") console.log(redactAiText(block.text));
        if (ev.type === "result") {
          result = ev;
          if (!ev.is_error && !graceTimer) graceTimer = setTimeout(() => { if (child.exitCode === null) { killedAfterResult = true; stopAi(child); } }, 90_000);
        }
      });
      child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-2000); });
      child.stdin.on("error", () => {});
      child.stdin.end(handoffPrompt(dir, prompt));
      const code = await new Promise((resolve) => { child.on("error", (e) => { stderr = e.message; resolve(-1); }); child.on("close", (c) => resolve(c)); });
      clearTimeout(timer); clearTimeout(graceTimer); lines.close();
      if (sessionId) { sessions[engine] = sessionId; fs.writeFileSync(sessionsFile, JSON.stringify(sessions), { mode: 0o600 }); }
      const aiFinished = !interrupted && !timedOut && (code === 0 || killedAfterResult) && result && !result.is_error;
      const verification = aiFinished ? await verify() : { ok: false, reason: timedOut ? "작업 시간 초과" : interrupted ? "사용자 중단" : result?.result || stderr || `AI 종료 코드 ${code}` };
      // 인계 기록(.factory/handoff.json): 실패해도 남긴다. 검사는 AI 가 끝난 뒤에만 돌아서, 아니면 '건너뜀'
      const checks = aiFinished ? checksFromVerification(verification) : [{ name: "프로젝트 검사", result: "건너뜀", detail: "AI 실행이 끝나지 않아 돌리지 않음" }];
      saveHandoff(dir, { engine, sessionId, taskId: "terminal", status: verification.ok ? "done" : "failed", summary: result?.result || "", verification, handoff: { kind: "terminal", title: "터미널 작업", request: prompt, startHead, checks } });
      recordLifecycle(dir, engine, verification.ok ? "session-completed" : "session-failed", "terminal");
      console.log(`${ENGINE_LABELS[engine]}: ${verification.ok ? "검증 통과" : `완료하지 못함: ${redactAiText(verification.reason)}`}`);
      process.exitCode = verification.ok ? 0 : 1;
    };
    if (options.prompt) return await turn(options.prompt);
    if (!process.stdin.isTTY) {
      let prompt = "";
      for await (const chunk of process.stdin) prompt += chunk;
      if (!prompt.trim()) throw new Error("작업 지시를 입력하세요.");
      return await turn(prompt);
    }
    input = createInterface({ input: process.stdin, output: process.stdout });
    while (!interrupted) {
      const prompt = (await input.question(`${ENGINE_LABELS[engine]}> `)).trim();
      if (prompt === "/exit") break;
      if (prompt.startsWith("/switch ")) { engine = engineOf(prompt.slice(8).trim()); lock.setEngine(engine); console.log(`${ENGINE_LABELS[engine]} 선택 — 다음 지시에 현재 상태를 전달합니다.`); continue; }
      if (prompt === "/verify") { console.log(redactAiText(JSON.stringify(await verify()))); continue; }
      if (prompt) await turn(prompt);
    }
  } finally {
    input?.close();
    process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
    lock.release();
  }
}
main().catch((error) => { console.error(redactAiText(error.message)); process.exitCode = 1; });
