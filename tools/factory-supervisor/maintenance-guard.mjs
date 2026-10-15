#!/usr/bin/env node
// tools/factory-supervisor/maintenance-guard.mjs
// 정비 Claude 전용 PreToolUse 훅(Bash): 서버 접근 규칙(serveraccess.mjs)에 더해 "이 PC 보호" 규칙(pcguard.mjs)을 적용한다.
// 앱·실험 일감은 계속 ssh-guard.mjs 만 쓴다. 감독 프로그램이 정비마다 만드는 --settings 파일이 이 파일(실행 전용 체크아웃의 사본)을 부른다.
// 막을 때만 deny 를 내고, 상관없는 명령은 아무것도 출력하지 않는다. 검사 중 오류가 나면 위험 단어가 있는 명령은 막는다(fail closed).
import { checkCommand } from "./serveraccess.mjs";
import { checkLocalCommand, isTrustedServerctlCall } from "./pcguard.mjs";

const deny = (reason, tag) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `[${tag}] ${reason}` } }));
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
    // 서버 작업(배포 저장소·.env.local·nginx·인증서·배포 push)은 신뢰된 serverctl 명령 하나일 때만 통과. 백업·검증·되돌림은 도구가 한다
    if (isTrustedServerctlCall(command)) return;
    const local = checkLocalCommand(command);
    if (local.decision === "deny") return deny(local.reason, "정비 보호 규칙");
    const server = checkCommand(command);
    if (server.decision === "deny") deny(server.reason, "서버 접근 규칙");
  } catch (e) {
    if (/\b(ssh|scp|sftp|rsync|git|kill|pkill|killall|taskkill|Stop-Process|run-supervisor|schtasks)\b/i.test(command || raw)) deny(`명령을 검사하지 못해서 막았어요(${String(e?.message ?? e).slice(0, 200)}).`, "정비 보호 규칙");
  }
});
