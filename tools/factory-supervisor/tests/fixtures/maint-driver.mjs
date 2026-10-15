// 시험용 운전기(pause-maint.test.mjs 가 자식 프로세스로 띄운다): 정비 턴(maintenance.mjs)을 가짜 Claude 와 가짜 홈페이지 응답으로 돌린다.
//   mode=first : 정비 턴을 시작 → 가짜 AI 가 도구 호출 중일 때 멈추라고 하고 → 멈추면 상태를 저장하고 프로세스를 끝낸다(감독 업데이트로 꺼지는 것 흉내)
//   mode=second: 저장된 상태를 읽어 resumeMaintenance 로 이어 준다 → 정비 턴이 끝나면 결과를 찍는다
//   mode=inproc: 멈춘 뒤 업데이트를 못 해서 같은 프로세스에서 resumeAll 로 이어 준다
// 환경: SELFDEV(정비 폴더), CLAUDE_CMD, PAUSE_STATE, TURN(JSON), MODE
import path from "node:path";
import { pathToFileURL } from "node:url";

const sup = path.resolve(process.env.SUP_DIR);
const mod = (n) => import(pathToFileURL(path.join(sup, n)).href);
const { onNext, resumeMaintenance, maintenanceBusy } = await mod("maintenance.mjs");
const { createPauser, readSavedState } = await mod("pause.mjs");
const { recoverWorkspace } = await mod("ai-runner.mjs");

const posts = [];
const logs = [];
const mode = process.env.MODE;
const turn = JSON.parse(process.env.TURN);
const cfg = { selfdevDir: process.env.SELFDEV, claudeCmd: process.env.CLAUDE_CMD, permissionMode: "acceptEdits", allowedTools: "Bash,Read", codexEnabled: false };
const pauser = createPauser({ log: (m) => logs.push(m), stateFile: process.env.PAUSE_STATE });
const ctx = {
  api: async (_method, _path, body) => {
    posts.push(body);
    return { status: 200, data: {} };
  },
  log: (m) => logs.push(m),
  cfg,
  pauser,
  uploadBusy: () => 0,
  runningApps: () => 0,
  updateDraining: () => false,
  compactEnabled: () => false,
  redact: (s) => s,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, what) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await sleep(100);
  }
  throw new Error(`시간 안에 안 됨: ${what}\n${logs.slice(-8).join("\n")}`);
};
const dump = (extra = {}) => console.log("RESULT " + JSON.stringify({ posts, logs, ...extra }));

if (mode === "second") {
  const saved = readSavedState(process.env.PAUSE_STATE);
  if (saved.entries.length !== 1) throw new Error("저장된 정비 턴이 없어요");
  const entry = saved.entries[0];
  try {
    recoverWorkspace(entry.dir); // 이전 감독이 남긴 잠금(소유 프로세스가 이미 없음)
  } catch (e) {
    logs.push(`잠금 확인: ${e.message}`);
  }
  resumeMaintenance(entry, ctx);
  await waitFor(() => !maintenanceBusy(), 60_000, "이어 준 정비 턴이 끝남");
  dump({ resumedEntry: entry });
  process.exit(0);
}

onNext({ maintenance: turn }, ctx);
if (mode === "plain") {
  // 멈추지 않고 그냥 끝까지 돈다
  await sleep(300);
  await waitFor(() => !maintenanceBusy(), 60_000, "정비 턴이 끝남");
  dump();
  process.exit(0);
}
// 가짜 AI 가 첫 도구 호출을 낸 뒤 멈추라고 한다
await sleep(Number(process.env.PAUSE_AFTER_MS || 1500));
pauser.requestPause();
await waitFor(() => pauser.pausedCount() === 1, 30_000, "정비 턴이 멈춤");
if (mode === "first") {
  const saved = pauser.persist();
  dump({ saved });
  process.exit(0); // 업데이트로 꺼진다(정비 턴의 나머지는 새 감독이 이어 준다)
}
// inproc: 업데이트를 못 해서 이 프로세스에서 이어 준다
const n = pauser.resumeAll();
await waitFor(() => !maintenanceBusy(), 60_000, "이어 준 정비 턴이 끝남");
dump({ resumedCount: n });
process.exit(0);
