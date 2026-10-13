// lib/factory/handoff.ts
// Claude Code ↔ Codex 인계 기록(감독 프로그램의 tools/factory-supervisor/handoff.mjs 가 만든 항목 하나)을 통제실에 보여 주려고 저장하기 전 정리한다.
// 읽기 전용 표시용: 정해진 칸만 받고, 글은 짧게 자르고, 비밀값 모양은 가린다. 기획서·프롬프트 전문·원시 diff 는 오지도 저장되지도 않는다.
import { maskSecrets } from "@/lib/factory/mask";

export interface HandoffCheck {
  name: string;
  result: "통과" | "실패" | "건너뜀";
  detail?: string;
}

export interface HandoffFiles {
  list: string[];
  more: number;
}

/** 작업 메모리(.factory/memory/) 상태: current.md 본문(6KB 상한)과 크기·시각·서버2 푸시 결과만. project.md 본문은 오지 않는다 */
export interface HandoffMemory {
  current: string;
  updatedAt: string;
  projectBytes: number;
  push: "ok" | "failed" | "none" | "blocked";
  needsCompact: boolean;
  error?: string;
}

export interface HandoffEntry {
  v: 1;
  kind: "maintenance" | "job" | "terminal";
  taskId: string;
  threadId?: string;
  appSlug?: string;
  title: string;
  engine: "claude" | "codex";
  model: string;
  at: string;
  status: "done" | "failed" | "interrupted";
  request: string;
  hasAiBlock: boolean;
  doneWhen: string;
  done: string;
  remaining: string;
  caution: string;
  failReason?: string;
  files: { committed: HandoffFiles | null; uncommitted: HandoffFiles | null };
  checks: HandoffCheck[];
  git: { head: string | null; branch: string | null; dirty: boolean };
  memory?: HandoffMemory;
}

const MAX_BYTES = 12000; // 인계 항목(4KB 안팎) + 현재 일감 요약(6KB 상한)
const MEMORY_CURRENT_MAX = 6000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

function memory(v: unknown): HandoffMemory | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const updatedAt = typeof r.updatedAt === "string" && ISO_RE.test(r.updatedAt) ? r.updatedAt : null;
  const push = r.push === "ok" || r.push === "failed" || r.push === "none" || r.push === "blocked" ? r.push : null;

  if (!updatedAt || !push) return undefined;
  const bytes = typeof r.projectBytes === "number" && Number.isFinite(r.projectBytes) ? Math.min(10_000_000, Math.max(0, Math.floor(r.projectBytes))) : 0;
  const error = text(r.error, 160);

  const lines = (typeof r.current === "string" ? r.current : "").split(/\r?\n/).slice(0, 60);
  const current = lines.map((l) => text(l, 400)).join("\n").trim().slice(0, MEMORY_CURRENT_MAX);

  return { current, updatedAt, projectBytes: bytes, push, needsCompact: r.needsCompact === true, ...(error ? { error } : {}) };
}

// 줄바꿈·제어 문자를 공백으로, PC 사용자 경로는 ~ 로, 비밀값 모양은 가린다
const text = (v: unknown, max: number): string =>
  maskSecrets(
    (typeof v === "string" ? v : "")
      .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+/gi, "~")
      .replace(/\/(?:Users|home)\/[^/\s"'`]+/g, "~")
      .replace(/[\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max),
  );

function files(v: unknown): HandoffFiles | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const list = Array.isArray(r.list) ? r.list.slice(0, 12).map((f) => text(f, 120)).filter(Boolean) : [];
  const more = typeof r.more === "number" && Number.isFinite(r.more) && r.more > 0 ? Math.min(100000, Math.floor(r.more)) : 0;

  return { list, more };
}

/** 감독 프로그램이 보낸 인계 항목 → 저장할 JSON. 형식이 맞지 않거나 너무 크면 null(저장 안 함) */
export function cleanHandoff(v: unknown): HandoffEntry | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const kind = r.kind === "maintenance" || r.kind === "job" || r.kind === "terminal" ? r.kind : null;
  const status = r.status === "done" || r.status === "failed" || r.status === "interrupted" ? r.status : null;
  const at = typeof r.at === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(r.at) ? r.at : null;

  if (!kind || !status || !at) return null;
  const git = r.git && typeof r.git === "object" && !Array.isArray(r.git) ? (r.git as Record<string, unknown>) : {};
  const hex = (x: unknown) => (typeof x === "string" && /^[0-9a-f]{7,40}$/i.test(x) ? x : null);
  const checks = Array.isArray(r.checks)
    ? r.checks.slice(0, 6).flatMap((c): HandoffCheck[] => {
        if (!c || typeof c !== "object") return [];
        const o = c as Record<string, unknown>;
        const result = o.result === "통과" || o.result === "실패" || o.result === "건너뜀" ? o.result : "건너뜀";
        const detail = text(o.detail, 160);

        return [{ name: text(o.name, 40) || "검사", result, ...(detail ? { detail } : {}) }];
      })
    : [];
  const files2 = r.files && typeof r.files === "object" && !Array.isArray(r.files) ? (r.files as Record<string, unknown>) : {};
  const out: HandoffEntry = {
    v: 1,
    kind,
    taskId: text(r.taskId, 60),
    ...(typeof r.threadId === "string" && text(r.threadId, 60) ? { threadId: text(r.threadId, 60) } : {}),
    ...(typeof r.appSlug === "string" && text(r.appSlug, 40) ? { appSlug: text(r.appSlug, 40) } : {}),
    title: text(r.title, 120),
    engine: r.engine === "codex" ? "codex" : "claude",
    model: text(r.model, 40) || "기본",
    at,
    status,
    request: text(r.request, 400),
    hasAiBlock: r.hasAiBlock === true,
    doneWhen: text(r.doneWhen, 300),
    done: text(r.done, 500),
    remaining: text(r.remaining, 500),
    caution: text(r.caution, 400),
    ...(text(r.failReason, 400) ? { failReason: text(r.failReason, 400) } : {}),
    files: { committed: files(files2.committed), uncommitted: files(files2.uncommitted) },
    checks,
    git: { head: hex(git.head), branch: text(git.branch, 60) || null, dirty: git.dirty === true },
    ...(memory(r.memory) ? { memory: memory(r.memory) } : {}),
  };

  return Buffer.byteLength(JSON.stringify(out)) <= MAX_BYTES ? out : null;
}
