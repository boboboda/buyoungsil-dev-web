// 실패 단계부터 다시 (5-2, 감독 프로그램 쪽)
// 일감이 실패하면 그 일감의 AI 세션을 작업 폴더(.factory/sessions/<일감id>.json)에 기억해 둔다.
// 사람이 [실패 단계부터 다시]를 누르면 서버가 /next 에 stageResume: { from, note, label } 을 붙여 준다.
//   · 같은 세션 id·작업 폴더가 이 PC 에 남아 있으면 → 같은 세션에 "검사에서 실패했다, 이 오류를 고쳐라" 같은 짧은 지시만 넣어 이어서 한다(--resume / exec resume)
//   · 없거나 AI 가 다르거나 너무 오래됐거나 이어서 하기가 바로 실패하면 → 기존 재실행(처음부터 지시문)으로 대신한다
// 이 파일은 파일 읽기·쓰기와 판단만 한다(프로세스를 띄우지 않는다). 시험: tests/stageresume.test.mjs
import fs from "node:fs";
import path from "node:path";

export const SESSION_RE = /^[0-9a-f-]{8,64}$/i;
export const SESSION_MAX_AGE_MS = 3 * 24 * 3600_000; // 이보다 오래된 세션은 이어 주지 않는다(AI 쪽 세션 보관 기간 밖일 수 있다)
export const STAGE_KINDS = ["new", "revision"];

const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export const sessionDir = (dir) => path.join(dir, ".factory", "sessions");
export const sessionFile = (dir, jobId) => path.join(sessionDir(dir), `${String(jobId).replace(/[^A-Za-z0-9_-]/g, "")}.json`);

/** 실패한 일감의 세션을 작업 폴더에 기억해 둔다. 쓸 수 없으면 조용히 건너뛴다(일감 결과에는 영향 없음). 비밀값은 넣지 않는다 */
export function saveSession(dir, { jobId, engine, sessionId, stage, now = Date.now() }) {
  try {
    if (!dir || !jobId || !sessionId || !SESSION_RE.test(String(sessionId))) return false;
    fs.mkdirSync(sessionDir(dir), { recursive: true });
    fs.writeFileSync(sessionFile(dir, jobId), JSON.stringify({ jobId, engine, sessionId, stage: clean(stage, 40) || null, at: now }), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export function readSession(dir, jobId) {
  try {
    const v = JSON.parse(fs.readFileSync(sessionFile(dir, jobId), "utf8"));

    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** 같은 세션에 넣을 짧은 지시 */
export function stageMessage(label, note) {
  const why = clean(note, 500);

  return `이전 시도가 '${label || "알 수 없는"}' 단계에서 실패했다.${why ? ` 오류: ${why}.` : ""} 작업 폴더의 파일은 그대로다. 이 오류만 고치고 그 단계부터 이어서 마무리해. 이미 끝낸 작업을 다시 하지 마. 앞으로의 지시는 CLAUDE.md 작업 규칙을 따른다.`;
}

/**
 * 단계부터 다시 할 수 있는지 판단한다.
 *   { mode: "resume", sessionId, message, label }  또는  { mode: "fresh", reason }  (stageResume 이 없으면 null)
 */
export function decideStageResume({ job, dir, now = Date.now(), read = readSession, exists = (p) => fs.existsSync(p) }) {
  const sr = job?.stageResume;

  if (!sr || typeof sr !== "object" || !sr.from) return null;
  const label = clean(sr.label || sr.from, 40);
  const fresh = (reason) => ({ mode: "fresh", reason, label });

  if (!STAGE_KINDS.includes(job.kind)) return fresh("새 앱·수정 일감이 아니라서 처음부터 해요.");
  if (job.worktree) return fresh("병행 실행(작업 사본)은 사본이 일감마다 새로 만들어져 처음부터 해요.");
  if (!dir || !exists(dir)) return fresh("작업 폴더가 이 PC 에 없어서 처음부터 해요.");
  const saved = read(dir, job.id);

  if (!saved) return fresh("이전 세션 기록이 없어서 처음부터 해요(다른 PC 에서 했거나 기록 전의 실패).");
  if (saved.jobId !== job.id) return fresh("세션 기록이 다른 일감 것이라 처음부터 해요.");
  if (saved.engine && saved.engine !== job.aiEngine) return fresh(`이전 세션은 ${saved.engine} 것인데 지금은 ${job.aiEngine} 로 돌아서 처음부터 해요.`);
  if (!SESSION_RE.test(String(saved.sessionId ?? ""))) return fresh("세션 기록 형식이 올바르지 않아서 처음부터 해요.");
  if (!(Number(saved.at) > 0) || now - Number(saved.at) > SESSION_MAX_AGE_MS) return fresh("이전 세션이 3일보다 오래돼서 처음부터 해요.");

  return { mode: "resume", sessionId: String(saved.sessionId), message: stageMessage(label, sr.note), label };
}
