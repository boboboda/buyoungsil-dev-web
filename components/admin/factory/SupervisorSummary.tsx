// components/admin/factory/SupervisorSummary.tsx
// [현황] 탭의 감독 프로그램 한 줄 요약. 상세(연결·버전·재시작·일시 정지·감독 로그)는 [감독] 탭.
"use client";

import { StatusDot, type Tone } from "./fx";
import { useFactoryControl } from "./useFactoryControl";

interface Snap {
  enabled: boolean;
  online: boolean;
  running: number;
  approved: number;
  pending: number;
}

export default function SupervisorSummary() {
  const { data: s } = useFactoryControl<Snap>();

  let badge = "읽는 중…";
  let tone: Tone = "idle";

  if (s) {
    if (!s.online) [badge, tone] = ["PC 꺼짐", "bad"];
    else if (!s.enabled) [badge, tone] = ["일시 정지", "warn"];
    else [badge, tone] = ["작동 중", "ok"];
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-summary="supervisor">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="flex items-center gap-2 font-semibold">
          <StatusDot tone={tone} />
          감독 프로그램: <span className={`fx-${tone}`}>{badge}</span>
        </span>
        {s && (
          <span className="font-mono text-xs text-default-500">
            진행 {s.running} · 대기 {s.approved} · 승인 기다림 {s.pending}
          </span>
        )}
      </div>
      <a className="inline-flex min-h-11 items-center text-sm underline sm:min-h-0" href="/admin/factory?tab=supervisor">
        상세 보기 →
      </a>
    </div>
  );
}
