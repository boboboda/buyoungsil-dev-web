// lib/studio/serviceOps.ts
// 스튜디오 [운영] → 서비스 운영: 관리자 세션이면 서비스 관리자 API(/api/admin/*)를 홈페이지 서버가 대신 부른다.
// - 키(SERVICE_ADMIN_TOKEN_<앱>)는 서버 보관 키에서 서버 안에서만 읽는다. 브라우저·응답·로그·기록에는 값이 없다.
// - 읽기: 생성 일정 상태 · 생성 기록 · 후보 목록. 쓰기: 일정 켜기·끄기 · 지금 실행 · 후보 승인·반려·다시. 쓰기는 confirmed:true 가 있어야 하고(확인 창), 누가 언제 했는지 factory_service_actions 에 남긴다.
// - 서비스에 API 가 없으면(404) 던지지 않고 no-api 로 돌려준다. 화면은 '서비스 API 없음'으로 보여 주고 버튼을 끈다.
import { callService, callServiceApi, serviceProfileOf, type ServiceCallDeps, type ServiceResult } from "@/lib/studio/service";

export const SERVICE_LIST_MAX_BODY = 262_144; // 후보·기록 목록은 16KB 보다 크다
export const CANDIDATE_STATUSES = ["review", "held", "pending"] as const;
export const PIPELINE_KINDS = ["request", "draw", "weekly"] as const;
export const SERVICE_RUN_MAX_LINES = 50;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type ServiceWriteAction = "schedule-on" | "schedule-off" | "run" | "approve" | "reject" | "retry";
export const SERVICE_WRITE_LABELS: Record<ServiceWriteAction, string> = {
  "schedule-on": "서비스 생성 일정 켜기",
  "schedule-off": "서비스 생성 일정 끄기",
  run: "서비스 지금 실행",
  approve: "후보 승인",
  reject: "후보 반려",
  retry: "후보 다시 만들기",
};

export interface ServiceCandidate {
  id: string;
  line: string;
  status: string;
  days: number | null;
  imageUrl: string | null; // https 그림 주소만(서비스 주소 기준으로 풀어서)
}

export interface ServiceLogItem {
  id: string;
  at: string;
  step: string;
  cutId: string;
  ok: boolean;
  detail: string;
}

export interface ServicePipeline {
  auto: boolean | null;
  running: { kind: string; startedAt: string; by: string } | null;
  weekly: string; // 사람이 읽는 글자
}

export type ReadResult<T> = { state: "ok"; value: T } | { state: "no-api" } | { state: "need-key"; keyName: string } | { state: "error"; reason: string };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : "");

/** 서비스가 준 그림 주소 → https 절대 주소(서비스 주소 기준). 이상하면 null */
export function safeImageUrl(raw: unknown, origin: string | null): string | null {
  if (typeof raw !== "string" || !raw || raw.length > 500) return null;
  try {
    const u = new URL(raw, origin ?? undefined);

    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseCandidates(data: unknown, origin: string | null): ServiceCandidate[] {
  const items = (data as { items?: unknown })?.items;

  if (!Array.isArray(items)) return [];

  return items
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && ID_RE.test(String((x as Record<string, unknown>).id ?? "")))
    .slice(0, 100)
    .map((x) => ({ id: String(x.id), line: str(x.line, 120), status: str(x.status, 20), days: typeof x.days === "number" && Number.isFinite(x.days) ? x.days : null, imageUrl: safeImageUrl(x.imageUrl, origin) }));
}

export function parseGenLog(data: unknown): ServiceLogItem[] {
  const items = (data as { items?: unknown })?.items;

  if (!Array.isArray(items)) return [];

  return items
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .slice(0, 100)
    .map((x) => ({ id: str(x.id, 40), at: str(x.at, 40), step: str(x.step, 40), cutId: str(x.cutId, 64), ok: x.ok === true, detail: str(x.detail, 200) }));
}

export function parsePipeline(data: unknown): ServicePipeline {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const r = d.running && typeof d.running === "object" ? (d.running as Record<string, unknown>) : null;
  const w = d.weekly && typeof d.weekly === "object" ? (d.weekly as Record<string, unknown>) : null;
  const days = ["일", "월", "화", "수", "목", "금", "토"];

  return {
    auto: typeof d.auto === "boolean" ? d.auto : null,
    running: r ? { kind: str(r.kind, 20), startedAt: str(r.startedAt, 40), by: str(r.by, 40) } : null,
    weekly: w && Number.isInteger(w.weekday) && Number.isInteger(w.hour) ? `매주 ${days[(w.weekday as number) % 7] ?? "?"}요일 ${String(w.hour).padStart(2, "0")}시` : "",
  };
}

function toRead<T>(r: ServiceResult, map: (data: unknown) => T): ReadResult<T> {
  if (r.state === "ok") return { state: "ok", value: map(r.data) };
  if (r.state === "no-api") return { state: "no-api" };
  if (r.state === "need-key") return { state: "need-key", keyName: r.keyName };

  return { state: "error", reason: r.reason };
}

export interface OpsServiceContext {
  appSlug: string;
  base: string | null | undefined;
  deps?: ServiceCallDeps;
}

export async function readPipeline(c: OpsServiceContext): Promise<ReadResult<ServicePipeline>> {
  const p = serviceProfileOf(c.appSlug);

  return p ? toRead(await callService(p, "pipeline-state", c.base, c.deps), parsePipeline) : { state: "no-api" };
}

export async function readGenLog(c: OpsServiceContext, limit = 50): Promise<ReadResult<ServiceLogItem[]>> {
  const p = serviceProfileOf(c.appSlug);
  const path = `/api/admin/gen-log?limit=${Math.max(1, Math.min(100, Math.floor(limit)))}`;

  return p ? toRead(await callServiceApi({ appSlug: c.appSlug, auth: "admin", method: "GET", path }, c.base, c.deps, undefined, SERVICE_LIST_MAX_BODY), parseGenLog) : { state: "no-api" };
}

export async function readCandidates(c: OpsServiceContext, status: string): Promise<ReadResult<ServiceCandidate[]>> {
  const p = serviceProfileOf(c.appSlug);

  if (!p) return { state: "no-api" };
  if (!(CANDIDATE_STATUSES as readonly string[]).includes(status)) return { state: "error", reason: "상태는 review·held·pending 중 하나예요." };
  let origin: string | null = null;

  try {
    origin = c.base ? new URL(c.base.includes("://") ? c.base : `https://${c.base}`).origin : null;
  } catch {
    origin = null;
  }

  return toRead(await callServiceApi({ appSlug: c.appSlug, auth: "admin", method: "GET", path: `/api/admin/candidates?status=${status}` }, c.base, c.deps, undefined, SERVICE_LIST_MAX_BODY), (d) => parseCandidates(d, origin));
}

// ───────── 쓰기 ─────────

export type WriteResult = { ok: true; message: string; data?: unknown } | { ok: false; status: number; message: string; noApi?: boolean };

/** 쓰기 입력 검사 → 부를 경로·본문. 틀리면 메시지 */
export function planWrite(action: unknown, params: { id?: unknown; kind?: unknown; lines?: unknown }): { ok: true; action: ServiceWriteAction; method: "POST"; path: string; body: unknown; target: string } | { ok: false; message: string } {
  if (action === "schedule-on" || action === "schedule-off") return { ok: true, action, method: "POST", path: "/api/admin/pipeline/auto", body: { on: action === "schedule-on" }, target: "" };
  if (action === "run") {
    const kind = params.kind;

    if (typeof kind !== "string" || !(PIPELINE_KINDS as readonly string[]).includes(kind)) return { ok: false, message: "실행 종류는 request·draw·weekly 중 하나예요." };
    const body: Record<string, unknown> = { kind };

    if (params.lines !== undefined && params.lines !== null && params.lines !== "") {
      const n = Number(params.lines);

      if (!Number.isInteger(n) || n < 1 || n > SERVICE_RUN_MAX_LINES) return { ok: false, message: `줄 수는 1~${SERVICE_RUN_MAX_LINES} 사이 정수예요.` };
      body.lines = n;
    }

    return { ok: true, action, method: "POST", path: "/api/admin/pipeline/run", body, target: kind };
  }
  if (action === "approve" || action === "reject" || action === "retry") {
    const id = typeof params.id === "string" ? params.id : "";

    if (!ID_RE.test(id)) return { ok: false, message: "후보 id 가 올바르지 않아요." };

    return { ok: true, action, method: "POST", path: `/api/admin/cuts/${encodeURIComponent(id)}/${action}`, body: {}, target: id };
  }

  return { ok: false, message: "알 수 없는 서비스 동작이에요." };
}

export interface AuditSink {
  record(row: { appSlug: string; action: string; target: string; who: string; ok: boolean; message: string }): Promise<void>;
}

/** 서비스 쓰기 동작 한 번: 확인(confirmed) → 호출 → 기록. 서비스에 API 가 없으면 noApi. 던지지 않는다 */
export async function runServiceWrite(c: OpsServiceContext, input: { action: unknown; confirmed: unknown; who: string; id?: unknown; kind?: unknown; lines?: unknown }, audit: AuditSink): Promise<WriteResult> {
  const plan = planWrite(input.action, input);

  if (plan.ok === false) return { ok: false, status: 400, message: plan.message };
  if (!serviceProfileOf(c.appSlug)) return { ok: false, status: 404, message: "이 프로젝트는 서비스 확인표가 없어요." };
  if (input.confirmed !== true) return { ok: false, status: 400, message: "쓰기 동작은 확인이 필요해요(확인 창에서 [확인]을 눌러 주세요)." };
  const r = await callServiceApi({ appSlug: c.appSlug, auth: "admin", method: plan.method, path: plan.path }, c.base, c.deps, plan.body);
  const label = SERVICE_WRITE_LABELS[plan.action];
  let result: WriteResult;

  if (r.state === "ok") result = { ok: true, message: `${label}: 서비스가 처리했어요.`, data: r.data };
  else if (r.state === "no-api") result = { ok: false, status: 404, noApi: true, message: `${label}: 서비스 API 없음 — 서비스(한 컷)에 이 API가 아직 없거나 대상이 없어요.` };
  else if (r.state === "need-key") result = { ok: false, status: 409, message: `${label}: 키 등록 필요: ${r.keyName} (통제실 키 등록에서 서버 보관 키로 등록해요)` };
  else result = { ok: false, status: 502, message: `${label} 실패 — ${r.reason}` };
  try {
    await audit.record({ appSlug: c.appSlug, action: plan.action, target: plan.target, who: input.who.slice(0, 80), ok: result.ok, message: result.message.slice(0, 300) });
  } catch {
    /* 기록이 안 돼도 결과는 돌려준다 */
  }

  return result;
}

export async function prismaAudit(): Promise<AuditSink> {
  const { default: prisma } = await import("@/lib/prisma");

  return { record: async (row) => void (await prisma.factoryServiceAction.create({ data: row })) };
}

export interface ServiceActionView {
  id: string;
  action: string;
  label: string;
  target: string;
  who: string;
  ok: boolean;
  message: string;
  at: string;
}

export async function readServiceActions(appSlug: string, take = 20): Promise<ServiceActionView[]> {
  const { default: prisma } = await import("@/lib/prisma");
  const rows = await prisma.factoryServiceAction.findMany({ where: { appSlug }, orderBy: { createdAt: "desc" }, take });

  return rows.map((r) => ({ id: r.id, action: r.action, label: SERVICE_WRITE_LABELS[r.action as ServiceWriteAction] ?? r.action, target: r.target, who: r.who, ok: r.ok, message: r.message, at: r.createdAt.toISOString() }));
}
