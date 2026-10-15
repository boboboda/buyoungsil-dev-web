// lib/factory/planLabels.ts
// 계획 먼저 승인(5-1)의 단계 이름과 글자. DB 를 읽지 않는 순수 값이라 화면(클라이언트)에서도 불러 쓴다. 판단·저장은 lib/factory/planFirst.ts.
export const PLAN_STATUSES = ["requested", "running", "ready", "failed", "approved"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const PLAN_LABELS: Record<PlanStatus, string> = {
  requested: "계획 만드는 중(대기)",
  running: "계획 만드는 중",
  ready: "계획 승인 대기",
  failed: "계획을 못 만듦",
  approved: "계획 승인됨",
};
