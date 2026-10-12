// lib/factory/toolBroker.ts
// 도구 요청 중계(감독 프로그램이 AI 대신 허용된 도구를 실행) 설정과 보고 정리. 감독 프로그램 쪽은 tools/factory-supervisor/toolbroker.mjs.
// 기본은 꺼짐. 값은 factory_settings.toolBroker 에 JSON 으로 저장하고 /api/factory/next 응답의 toolBroker 로 감독 프로그램이 받아 간다.
import { maskSecrets } from "@/lib/factory/mask";

export const TOOL_BROKER_MODES = ["off", "report", "allow"] as const;
export type ToolBrokerMode = (typeof TOOL_BROKER_MODES)[number];
export const TOOL_BROKER_MODE_LABELS: Record<ToolBrokerMode, string> = { off: "꺼짐", report: "보고만", allow: "허용" };

export interface ToolBrokerSettings {
  mode: ToolBrokerMode;
  maxRequests: number; // 일감당 도구 요청 수 상한
  toolTimeoutSec: number; // 도구 한 번 실행 제한 시간
}

// 감독 프로그램(toolbroker.mjs BROKER_DEFAULTS)과 같은 기본값
export const TOOL_BROKER_DEFAULTS: ToolBrokerSettings = { mode: "off", maxRequests: 30, toolTimeoutSec: 180 };
export const TOOL_BROKER_LIMITS = { maxRequests: [1, 200], toolTimeoutSec: [5, 900] } as const;

export function isToolBrokerMode(v: unknown): v is ToolBrokerMode {
  return typeof v === "string" && (TOOL_BROKER_MODES as readonly string[]).includes(v);
}

const clampInt = (v: unknown, d: number, [lo, hi]: readonly [number, number]) =>
  typeof v === "number" && Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** 저장값·입력값 → 정리된 설정(모르는 값은 기본값) */
export function normalizeToolBroker(v: unknown): ToolBrokerSettings {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

  return {
    mode: isToolBrokerMode(o.mode) ? o.mode : TOOL_BROKER_DEFAULTS.mode,
    maxRequests: clampInt(o.maxRequests, TOOL_BROKER_DEFAULTS.maxRequests, TOOL_BROKER_LIMITS.maxRequests),
    toolTimeoutSec: clampInt(o.toolTimeoutSec, TOOL_BROKER_DEFAULTS.toolTimeoutSec, TOOL_BROKER_LIMITS.toolTimeoutSec),
  };
}

export interface ToolRequestRecord {
  id: string;
  tool: string;
  status: "ok" | "denied" | "failed" | "timeout";
  at: string;
  ms: number | null;
  message: string | null;
}

const MAX_TOOL_RECORDS = 100;

/** 감독 프로그램이 보고한 도구 요청 목록(도구 이름·상태·시간·짧은 메시지만). 형식이 틀린 항목은 버린다. 배열이 아니면 null(바꾸지 않음) */
export function cleanToolRequests(v: unknown): ToolRequestRecord[] | null {
  if (!Array.isArray(v)) return null;
  const out: ToolRequestRecord[] = [];

  for (const item of v.slice(-MAX_TOOL_RECORDS)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(r.id) ? r.id : null;
    const tool = typeof r.tool === "string" && /^(?:\?|[a-z][a-z0-9_.-]{0,39})$/.test(r.tool) ? r.tool : null;
    const status = r.status === "ok" || r.status === "denied" || r.status === "failed" || r.status === "timeout" ? r.status : null;
    const at = typeof r.at === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(r.at) ? r.at : null;

    if (!id || !tool || !status || !at) continue;
    const ms = typeof r.ms === "number" && Number.isFinite(r.ms) && r.ms >= 0 ? Math.round(r.ms) : null;
    const message = typeof r.message === "string" ? maskSecrets(r.message.replace(/[\u0000-\u001f]/g, " ").slice(0, 200)) : null;

    out.push({ id, tool, status, at, ms, message });
  }

  return out;
}
