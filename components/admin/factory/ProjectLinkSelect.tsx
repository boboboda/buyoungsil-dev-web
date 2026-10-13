// components/admin/factory/ProjectLinkSelect.tsx
// 공장 앱 ↔ 홈페이지 프로젝트 연결 고르기(공용). [설정] 탭의 프로젝트 연결과 [출시] 카드가 함께 쓴다.
// 저장은 부르는 쪽이 하던 API 그대로(onLink/onUnlink). 다른 앱에 연결된 프로젝트는 고를 수 없게 흐리게 보인다.
"use client";

import { useEffect, useState } from "react";
import { Button } from "@heroui/react";

import type { ProjectOption } from "./releaseTypes";

export default function ProjectLinkSelect({
  appSlug,
  appName,
  projects,
  currentId,
  busy,
  saving,
  onLink,
  onUnlink,
}: {
  appSlug: string;
  appName: string;
  projects: ProjectOption[];
  currentId: string | null;
  busy: boolean;
  saving?: boolean;
  onLink: (projectId: string) => void;
  onUnlink?: () => void;
}) {
  const [pick, setPick] = useState(currentId ?? "");

  useEffect(() => setPick(currentId ?? ""), [currentId]);

  return (
    <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
      <select
        aria-label={`${appName} 에 연결할 홈페이지 프로젝트`}
        className="w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:flex-1 sm:text-sm"
        value={pick}
        onChange={(e) => setPick(e.target.value)}
      >
        <option value="">프로젝트 고르기…</option>
        {projects.map((p) => {
          const elsewhere = !!p.linkedApp && p.linkedApp !== appSlug;

          return (
            <option key={p.id} disabled={elsewhere} value={p.id}>
              {p.title} ({p.platform}, {p.status})
              {p.id === currentId ? " — 지금 연결됨" : elsewhere ? ` — ${p.linkedApp} 에 연결됨` : ""}
            </option>
          );
        })}
      </select>
      <Button
        className="min-h-11 sm:min-h-0"
        color="primary"
        isDisabled={busy || !pick || pick === currentId}
        size="sm"
        onPress={() => onLink(pick)}
      >
        {saving ? "저장 중…" : "연결"}
      </Button>
      {currentId && onUnlink && (
        <Button
          className="min-h-11 sm:min-h-0"
          isDisabled={busy}
          size="sm"
          variant="light"
          onPress={() => {
            if (window.confirm(`${appName}: 홈페이지 프로젝트 연결을 풀까요?\n(프로젝트는 지워지지 않아요)`)) onUnlink();
          }}
        >
          연결 풀기
        </Button>
      )}
    </div>
  );
}
