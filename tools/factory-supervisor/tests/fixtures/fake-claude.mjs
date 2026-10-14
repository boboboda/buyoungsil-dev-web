// 시험용 가짜 Claude Code: 진짜 AI 없이 감독 프로그램의 병행 일감 흐름(작업 사본·잠금·합치기)을 돌려 보려고 쓴다.
// FAKE_SCENARIO(JSON 파일)에 일감 id 별로 { work: [...단계], fix1: [...], fix2: [...] } 를 적어 두면 그대로 따라 한다.
// 단계: { wait: ms } | { write: { file, text } } | { git: [인자…] } | { lock: { name, ms } }(applock.mjs 로 감싼 명령)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);

if (args[0] === "--version") {
  console.log("fake-claude 0.0.1");
  process.exit(0);
}
if (args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
const scenario = JSON.parse(fs.readFileSync(process.env.FAKE_SCENARIO, "utf8"));
const id = process.env.FACTORY_JOB_ID ?? "";
let prompt = "";

process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) prompt += chunk;
const fix = prompt.match(/\[다시 맞추기 (\d+)\/(\d+)\]/);
const turn = fix ? Number(fix[1]) : 0;
const steps = (scenario[id] ?? {})[turn === 0 ? "work" : `fix${turn}`] ?? [];
const cwd = process.cwd();

fs.appendFileSync(process.env.FAKE_CALLS, JSON.stringify({ id, turn, cwd, slug: process.env.FACTORY_APP_SLUG, lockDir: process.env.FACTORY_LOCK_DIR ?? null, hasWaitFile: !!process.env.FACTORY_WAIT_FILE, promptHasLockRules: prompt.length > 0 }) + "\n");
const emit = (ev) => console.log(JSON.stringify(ev));

emit({ type: "system", subtype: "init", session_id: "11111111-2222-3333-4444-555555555555", model: "fake" });
for (const step of steps) {
  if (step.wait) await new Promise((r) => setTimeout(r, step.wait));
  if (step.write) fs.writeFileSync(path.join(cwd, step.write.file), step.write.text);
  if (step.git) execFileSync("git", ["-c", "user.name=fake", "-c", "user.email=fake@localhost", ...step.git], { cwd, stdio: "ignore" });
  if (step.lock) execFileSync(process.execPath, [process.env.FAKE_APPLOCK, step.lock.name, "--", process.execPath, "-e", `setTimeout(() => {}, ${step.lock.ms})`], { cwd, env: process.env, stdio: "ignore" });
}
emit({ type: "assistant", message: { content: [{ type: "text", text: `${id} 턴 ${turn} 처리` }] } });
emit({ type: "result", is_error: false, result: `${id} 완료(턴 ${turn})`, num_turns: 1 });
