// components/admin/factory/JobSizeNotice.tsx
// 승인 화면의 '예상 큼' 표시와 안내(1-3). 안내만 하고 승인을 막지 않는다.
"use client";

import { BIG_JOB_ADVICE, estimateJobSize } from "@/lib/factory/jobSize";

export default function JobSizeNotice({ plan, kind }: { plan: string; kind: string }) {
  const size = estimateJobSize(plan, kind);

  if (!size.big) return null;

  return (
    <div className="w-full rounded-md border border-warning-300 bg-warning-50 p-2 text-sm text-warning-800" data-job-size-notice="big">
      <p className="font-semibold">
        ⏱ 예상 큼 <span className="font-normal">· {size.reasons.join(" · ")}</span>
      </p>
      <p className="mt-1">{BIG_JOB_ADVICE}</p>
    </div>
  );
}
