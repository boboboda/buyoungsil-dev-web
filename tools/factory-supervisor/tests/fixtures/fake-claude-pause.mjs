// 시험용 가짜 Claude Code(업데이트 멈춤/이어서 하기 시험용): 진짜 AI 없이 도구 호출(tool_use ↔ tool_result)을 시간에 맞춰 내보낸다.
// FAKE_SCENARIO(JSON 파일): { "<일감 id>": { calls: [ [단계…], [단계…] ], rejectResume?: true } }  — calls[n] 은 n 번째 실행(0 = 처음, 1 = 이어서 …)의 단계 목록
// 단계: { say } | { tool: { name, input, ms, out? } }(도구 호출을 내고 ms 뒤 결과) | { hang: { name, input } }(결과 없이 영원히) | { wait: ms } | { write: { file, text } }
// 실행 기록은 FAKE_CALLS 에 줄마다 JSON 으로 남긴다: { id, n, resume, prompt, cwd }
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

if (args[0] === "--version") {
  console.log("fake-claude-pause 0.0.1");
  process.exit(0);
}
if (args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
const scenario = JSON.parse(fs.readFileSync(process.env.FAKE_SCENARIO, "utf8"));
const id = process.env.FACTORY_JOB_ID ?? process.env.FACTORY_MAINTENANCE_TURN ?? "";
const resumeAt = args.indexOf("--resume");
const resume = resumeAt >= 0 ? args[resumeAt + 1] : null;
let prompt = "";

process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) prompt += chunk;
const earlier = fs.existsSync(process.env.FAKE_CALLS) ? fs.readFileSync(process.env.FAKE_CALLS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((c) => c.id === id).length : 0;
fs.appendFileSync(process.env.FAKE_CALLS, JSON.stringify({ id, n: earlier, resume, prompt: prompt.slice(0, 400), cwd: process.cwd() }) + "\n");
const cfg = scenario[id] ?? { calls: [] };
const session = cfg.session ?? "11111111-2222-3333-4444-555555555555";
const emit = (ev) => console.log(JSON.stringify(ev));

if (resume && cfg.rejectResume) {
  // 진짜 Claude 가 없는 세션을 이어 달라고 받았을 때처럼: 아무 이벤트 없이 바로 오류로 끝난다
  console.error(`No conversation found with session ID: ${resume}`);
  process.exit(1);
}
emit({ type: "system", subtype: "init", session_id: resume ?? session, model: "fake" });
let toolSeq = 0;
for (const step of (cfg.calls ?? [])[earlier] ?? []) {
  if (step.say) emit({ type: "assistant", session_id: resume ?? session, message: { content: [{ type: "text", text: step.say }] } });
  if (step.wait) await new Promise((r) => setTimeout(r, step.wait));
  if (step.write) fs.writeFileSync(path.join(process.cwd(), step.write.file), step.write.binary ? Buffer.from(step.write.text, "latin1") : step.write.text);
  if (step.tool || step.hang) {
    const t = step.tool ?? step.hang;
    const tuId = `tu-${earlier}-${toolSeq++}`;
    emit({ type: "assistant", session_id: resume ?? session, message: { content: [{ type: "tool_use", id: tuId, name: t.name ?? "Bash", input: t.input ?? {} }] } });
    if (step.hang) {
      setInterval(() => {}, 1000); // 이벤트 루프를 살려 둔다(끊길 때까지 결과를 내지 않는 긴 명령)
      await new Promise(() => {});
    }
    await new Promise((r) => setTimeout(r, t.ms ?? 0));
    emit({ type: "user", session_id: resume ?? session, message: { content: [{ type: "tool_result", tool_use_id: tuId, content: t.out ?? "ok" }] } });
  }
}
emit({ type: "assistant", session_id: resume ?? session, message: { content: [{ type: "text", text: `${id} 호출 ${earlier} 처리` }] } });
emit({ type: "result", is_error: false, result: `${id} 완료(호출 ${earlier})`, num_turns: 1, session_id: resume ?? session });
