// components/admin/factory/PlanReviewRow.tsx
// 통제실 [현황] 할 일의 '계획 승인 대기' 줄(5-1). 읽기 전용 AI 가 낸 계획(3~6줄)을 보여 주고 [이대로 진행] · [수정 지시] · [취소] 중에서 고른다.
// 계획을 못 만든 경우(failed)는 [계획 없이 진행] · [다시 계획] · [취소].
"use client";

import { useState } from "react";
import { Button } from "@heroui/react";

export interface PlanReview {
  id: string;
  appSlug: string;
  title: string;
  kind: string;
  status: "ready" | "failed";
  plan: string | null;
  reason: string | null;
  round: number;
  at: string | null;
}

export default function PlanReviewRow({
  review,
  busy,
  order,
  onGo,
  onRevise,
  onCancel,
}: {
  review: PlanReview;
  busy: boolean;
  order: number;
  onGo: (id: string) => void;
  onRevise: (id: string, note: string) => Promise<boolean> | boolean | void;
  onCancel: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const failed = review.status === "failed";

  return (
    <div className="fx-row flex flex-col gap-2 rounded-lg border border-primary-300 p-2" data-plan-review={review.id} data-st="approval" style={{ order }}>
      <div className="min-w-0 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-primary-100 px-1.5 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-50/10">{failed ? "계획을 못 만듦" : "계획 승인 대기"}</span>
          <span className="font-medium">{review.title}</span>
          <span className="font-mono text-xs text-default-500">
            {review.appSlug}
            {review.round > 1 ? ` · ${review.round}번째 계획` : ""}
          </span>
        </div>
        {failed ? (
          <p className="mt-1 text-xs text-danger-600" data-plan-reason="">
            {review.reason ?? "계획을 만들지 못했어요."} 계획 없이 진행하거나 다시 계획할 수 있어요.
          </p>
        ) : (
          <pre className="mt-2 whitespace-pre-wrap rounded bg-default-100 p-2 text-xs leading-relaxed" data-plan-text="">
            {review.plan}
          </pre>
        )}
      </div>
      {editing && (
        <div className="space-y-2" data-plan-revise-box="">
          <textarea
            aria-label="계획 수정 지시"
            className="min-h-20 w-full rounded border border-default-300 p-2 text-sm"
            maxLength={1000}
            placeholder={failed ? "(선택) 다시 계획할 때 참고할 말" : "계획에서 바꿀 점을 적어 주세요. 예: 서버 쪽은 건드리지 말고 화면만"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              className="min-h-11 sm:min-h-0"
              color="primary"
              data-plan-revise-send=""
              isDisabled={busy || (!failed && note.trim() === "")}
              size="sm"
              onPress={async () => {
                const ok = await onRevise(review.id, note.trim());

                if (ok !== false) {
                  setEditing(false);
                  setNote("");
                }
              }}
            >
              수정 지시 보내기
            </Button>
            <Button className="min-h-11 sm:min-h-0" isDisabled={busy} size="sm" variant="flat" onPress={() => setEditing(false)}>
              닫기
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button className="min-h-11 sm:min-h-0" color="primary" data-plan-go="" isDisabled={busy} size="sm" onPress={() => onGo(review.id)}>
          {failed ? "계획 없이 진행" : "이대로 진행"}
        </Button>
        <Button className="min-h-11 sm:min-h-0" data-plan-revise="" isDisabled={busy} size="sm" variant="flat" onPress={() => setEditing((v) => !v)}>
          {failed ? "다시 계획" : "수정 지시"}
        </Button>
        <Button className="min-h-11 sm:min-h-0" data-plan-cancel="" isDisabled={busy} size="sm" variant="flat" onPress={() => onCancel(review.id)}>
          취소
        </Button>
      </div>
    </div>
  );
}
