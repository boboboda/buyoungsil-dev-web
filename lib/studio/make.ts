// lib/studio/make.ts
// 공용 스튜디오 [제작] 탭의 순수 계산: 일감 상태 이름·진행 한 줄, 대상 이름 자동완성, 정수배 확대, 일감별 결과 묶기.
// DB·화면 없음(읽기는 lib/studio/makeData.ts, 그리기는 components/studio/MakeTab.tsx). 키 값은 다루지 않는다.
import { maskSecrets } from "@/lib/factory/mask";

/** 화면에 보여 줄 도구 일감 상태. 서버 상태 → 한국어 이름과 큰 묶음 */
export const MAKE_STATUS: Record<string, { label: string; group: "wait" | "run" | "done" | "failed" | "confirm" | "other" }> = {
  pending: { label: "승인 대기", group: "wait" },
  approved: { label: "대기", group: "wait" },
  running: { label: "진행", group: "run" },
  done: { label: "완료", group: "done" },
  failed: { label: "실패", group: "failed" },
  needs_confirmation: { label: "확인 필요", group: "confirm" },
  cancelled: { label: "취소", group: "other" },
};

export const makeStatusLabel = (status: string): string => MAKE_STATUS[status]?.label ?? status;
/** 새로 고침을 계속할 상태(끝나지 않은 일감) */
export const isActiveStatus = (status: string): boolean => status === "pending" || status === "approved" || status === "running" || status === "needs_confirmation";
export const MAKE_REFRESH_MS = 5000;

/** 진행 중이면 단계 한 줄(감독이 남긴 마지막 로그 → 없으면 phase → 상태 이름). 비밀번호 모양은 가린다 */
export function progressLine(status: string, phase: string | null | undefined, lastLog: string | null | undefined): string {
  const clean = (v: string) => maskSecrets(v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()).slice(0, 160);
  const log = lastLog ? clean(lastLog) : "";

  if (status === "running") return log || (phase ? clean(phase) : "만드는 중…");
  if (status === "approved") return "대기열에서 작업 PC가 가져가기를 기다려요.";
  if (status === "pending") return "승인을 기다려요. 통제실이나 텔레그램에서 승인하면 시작해요.";
  if (status === "needs_confirmation") return "비용 한도 확인이 필요해요. 통제실 할 일에서 [그대로 진행] 또는 [취소]를 누르세요.";

  return "";
}

// ───────── 대상 이름 ─────────

/** 쉼표·줄바꿈으로 나눈 대상 목록(빈 칸 제거, 중복 제거) */
export const parseSubjects = (text: string): string[] => [...new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];

/** 별칭 묶음({ 대표: [별칭…] }) + 이미 쓴 대상 이름 → 자동완성 후보(대표 이름 먼저, 중복 제거) */
export function subjectNames(aliases: unknown, known: readonly string[] = []): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";

    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  };

  if (aliases && typeof aliases === "object" && !Array.isArray(aliases)) {
    for (const [main, names] of Object.entries(aliases as Record<string, unknown>)) {
      add(main);
      if (Array.isArray(names)) names.forEach(add);
    }
  }
  known.forEach(add);

  return out;
}

/** 입력칸의 마지막 쉼표 뒤 글자로 후보를 거른다(이미 쓴 대상은 뺀다). 글자가 없으면 빈 목록 */
export function subjectSuggestions(text: string, names: readonly string[], limit = 6): string[] {
  const token = (text.split(/[,\n]/).pop() ?? "").trim().toLowerCase();

  if (!token) return [];
  const used = new Set(parseSubjects(text).slice(0, -1).map((s) => s.toLowerCase()));

  return names.filter((n) => n.toLowerCase().includes(token) && n.toLowerCase() !== token && !used.has(n.toLowerCase())).slice(0, limit);
}

/** 후보를 눌렀을 때: 마지막 조각을 그 이름으로 바꾸고 쉼표를 붙여 다음 대상을 이어 쓰게 한다 */
export function applySuggestion(text: string, name: string): string {
  const head = text.includes(",") || text.includes("\n") ? text.slice(0, Math.max(text.lastIndexOf(","), text.lastIndexOf("\n")) + 1) : "";

  return `${head}${head && !/\s$/.test(head) ? " " : ""}${name}, `.replace(/^\s+/, "");
}

// ───────── 그림 크기 ─────────

/**
 * 픽셀 그림을 정수배로 키운다(뭉개지지 않게). 상자(maxW×maxH) 안에서 가장 큰 정수 배율, 최소 1배.
 * 그림이 상자보다 커도 1배 이하로 줄이지 않는다(줄이면 픽셀이 섞이므로 상자 쪽을 넘게 둔다)
 */
export function pixelScale(naturalW: number, naturalH: number, maxW: number, maxH: number): number {
  if (!(naturalW > 0) || !(naturalH > 0)) return 1;
  const s = Math.floor(Math.min(maxW / naturalW, maxH / naturalH));

  return Number.isFinite(s) && s >= 1 ? Math.min(s, 32) : 1;
}

// ───────── 일감 보기 ─────────

export interface MakeArt {
  id: string;
  url: string;
  subject: string;
  status: string; // candidate | approved | rejected
  cardId: string | null;
  cardName: string;
  cardVersion: number | null;
  refs: string[]; // 참고 그림을 고른 이유(요약)
  refsFallback: string;
  cost: number;
}

export interface MakeJob {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  group: string;
  cardId: string | null;
  cardName: string;
  createdAt: string;
  finishedAt: string | null;
  progress: string;
  failReason: string | null;
  subjects: string[];
  count: number;
  estimatedCost: number;
  cost: number | null; // 실제 비용(끝난 뒤)
  pickedRefs: { id: string; url: string; subject: string }[]; // 사람이 직접 고른 참고 그림
  arts: MakeArt[];
}

export interface MakeJobRowIn {
  id: string;
  title: string;
  status: string;
  phase: string | null;
  cardId: string | null;
  createdAt: Date | string;
  finishedAt: Date | string | null;
  failReason: string | null;
  input: { subjects: string[]; count: number; estimatedCost: number } | null;
  result: { cost: number } | null;
}

const iso = (d: Date | string | null): string | null => (d === null ? null : d instanceof Date ? d.toISOString() : d);

/** 일감 줄 + 마지막 로그 + 결과 그림 + 고른 참고 그림 → 화면용 일감 */
export function buildMakeJob(args: {
  row: MakeJobRowIn;
  cardName: string;
  lastLog?: string | null;
  arts?: readonly MakeArt[];
  picked?: readonly { id: string; url: string; subject: string }[];
}): MakeJob {
  const { row } = args;
  const st = MAKE_STATUS[row.status] ?? { label: row.status, group: "other" };

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    statusLabel: st.label,
    group: st.group,
    cardId: row.cardId,
    cardName: args.cardName,
    createdAt: iso(row.createdAt) ?? "",
    finishedAt: iso(row.finishedAt),
    progress: progressLine(row.status, row.phase, args.lastLog),
    failReason: row.status === "failed" || row.status === "needs_confirmation" ? maskSecrets(row.failReason ?? "").slice(0, 300) || null : null,
    subjects: row.input?.subjects ?? [],
    count: row.input?.count ?? 1,
    estimatedCost: row.input?.estimatedCost ?? 0,
    cost: row.result ? row.result.cost : null,
    pickedRefs: [...(args.picked ?? [])],
    arts: [...(args.arts ?? [])],
  };
}

/** 위쪽에 진행·확인 필요, 그다음 대기, 끝난 것은 새 것부터 */
export function sortMakeJobs(jobs: readonly MakeJob[]): MakeJob[] {
  const rank = (j: MakeJob) => (j.group === "run" ? 0 : j.group === "confirm" ? 1 : j.group === "wait" ? 2 : 3);

  return [...jobs].sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

/** 상태 묶음별 개수(대기·진행·완료·실패·확인 필요) */
export function countByGroup(jobs: readonly MakeJob[]): Record<"wait" | "run" | "done" | "failed" | "confirm", number> {
  const n = { wait: 0, run: 0, done: 0, failed: 0, confirm: 0 };

  for (const j of jobs) if (j.group in n) n[j.group as keyof typeof n]++;

  return n;
}

// ───────── 입력 확인 ─────────

export const MAKE_LIMITS = { count: 8, subjects: 8, total: 16, extra: 500, refs: 4 } as const;

/** 화면에서 먼저 거르는 입력 오류(서버가 다시 검사한다). 문제가 없으면 null */
export function makeInputError(args: { cardId: string; subjects: readonly string[]; count: number; extra: string; refs: number }): string | null {
  if (!args.cardId) return "카드를 골라 주세요.";
  if (!args.subjects.length) return "대상 이름을 적어 주세요.";
  if (args.subjects.length > MAKE_LIMITS.subjects) return `대상은 한 번에 ${MAKE_LIMITS.subjects}개까지예요.`;
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > MAKE_LIMITS.count) return `장 수는 1~${MAKE_LIMITS.count} 정수예요.`;
  if (args.count * args.subjects.length > MAKE_LIMITS.total) return `한 번에 전체 ${MAKE_LIMITS.total}장까지예요(대상 ${args.subjects.length}개 × ${args.count}장).`;
  if (args.extra.length > MAKE_LIMITS.extra) return `추가 지시는 ${MAKE_LIMITS.extra}자까지예요.`;
  if (args.refs > MAKE_LIMITS.refs) return `참고 그림은 ${MAKE_LIMITS.refs}장까지예요.`;

  return null;
}

/** 화면에서 보여 줄 예상 비용(호출당 비용 × 전체 장 수). 서버 계산과 같다 */
export const estimateCost = (perCall: number, count: number, subjects: number): number => (perCall > 0 ? perCall * count * subjects : 0);
