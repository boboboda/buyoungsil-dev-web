#!/usr/bin/env node
// tools/factory-supervisor/ssh-guard.mjs
// Claude Code PreToolUse 훅(Bash): 공장 AI 세션의 서버 접근 규칙(serveraccess.mjs)을 적용한다.
// 감독 프로그램이 일감마다 만드는 --settings 파일이 이 파일(실행 전용 체크아웃의 사본)을 부른다.
// 막을 때만 deny 를 내고, 상관없는 명령은 아무것도 출력하지 않는다(평소 권한 규칙대로).
// 검사 중 오류가 나면 서버 접속 명령은 막는다(fail closed).
import { checkCommand } from "./serveraccess.mjs";

const deny = (reason) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `[서버 접근 규칙] ${reason}` } }));
};

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let command = "";
  try {
    const input = JSON.parse(raw || "{}");
    if (input.tool_name && input.tool_name !== "Bash") return;
    command = String(input.tool_input?.command ?? "");
    const r = checkCommand(command);
    if (r.decision === "deny") deny(r.reason);
  } catch (e) {
    if (/\b(ssh|scp|sftp|rsync|git)\b/i.test(command || raw)) deny(`명령을 검사하지 못해서 막았어요(${String(e?.message ?? e).slice(0, 200)}).`);
  }
});
