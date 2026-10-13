// components/admin/factory/ReviewBox.tsx
// 출시 패키지 카드의 '검수 페이지': 주소(https) 저장, [🔍 검수 페이지 열기](새 탭), '검수 대기 N장'.
// 개수는 홈페이지 서버가 대신 확인한다(GET /api/admin/factory/review-status). 토큰 값은 브라우저로 오지 않고 키 이름만 안내한다.
"use client";

import { useEffect, useState } from "react";
import { Button, Chip } from "@heroui/react";

import Field from "./Field";
import type { ReleaseApp, ReviewStatusRow } from "./releaseTypes";

const input = "w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm";
const EXAMPLE = "https://hancut.buyoungsilcoding.com/admin";

/** 카드 위쪽 강조: 검수 대기가 1장 이상일 때만 */
export function ReviewBadge({ row }: { row?: ReviewStatusRow }) {
  if (row?.status.state !== "ok" || row.status.review < 1) return null;

  return (
    <Chip color="warning" size="sm" variant="solid">
      🔍 검수 대기 {row.status.review}장
    </Chip>
  );
}

function StatusText({ row, loading, tokenName }: { row?: ReviewStatusRow; loading: boolean; tokenName: string }) {
  if (!row) return <span className="text-default-500">{loading ? "검수 대기 확인 중…" : "확인 못 함"}</span>;
  const s = row.status;

  if (s.state === "no_token") {
    return (
      <span className="text-default-500">
        토큰 미등록
        <span className="block text-xs">
          설정 → 외부 서비스 키에 <code>{tokenName}</code> 으로 넣으면 개수가 보여요.
        </span>
      </span>
    );
  }
  if (s.state === "blocked") return <span className="text-default-500">확인 못 함(사설망 주소)</span>;
  if (s.state === "error") return <span className="text-default-500">확인 못 함 <span className="text-xs">({s.reason})</span></span>;

  return (
    <span className={s.review > 0 ? "font-semibold text-warning-700" : "text-default-600"}>
      검수 대기 {s.review}장
      <span className="block text-xs font-normal text-default-500">
        보류 {s.held} · 대기 {s.pending}
        {s.updatedAt ? ` · ${new Date(s.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 기준` : ""}
      </span>
    </span>
  );
}

export default function ReviewBox({
  app,
  busy,
  call,
  row,
  loading,
}: {
  app: ReleaseApp;
  busy: boolean;
  call: (body: Record<string, unknown>) => void;
  row?: ReviewStatusRow;
  loading: boolean;
}) {
  const [url, setUrl] = useState(app.reviewUrl ?? "");

  useEffect(() => setUrl(app.reviewUrl ?? ""), [app.reviewUrl]);
  const trimmed = url.trim();
  const httpsOk = !trimmed || /^https:\/\/[^\s/]+/i.test(trimmed);

  return (
    <div className="space-y-2 rounded-lg border border-default-200 p-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field
          className="sm:flex-1"
          help={`https 주소만. 비우면 표시 안 함. 예: 하찮은 한 컷(one-tiny-frame)은 ${EXAMPLE}`}
          label="검수 페이지 주소"
        >
          <input className={input} inputMode="url" maxLength={300} placeholder="https://…" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Button
          className="min-h-11 sm:min-h-0"
          isDisabled={busy || !httpsOk || trimmed === (app.reviewUrl ?? "")}
          size="sm"
          variant="flat"
          onPress={() => call({ action: "updateApp", appSlug: app.appSlug, reviewUrl: trimmed })}
        >
          주소 저장
        </Button>
      </div>
      {!httpsOk && <p className="text-xs text-danger">https:// 로 시작하는 주소만 넣을 수 있어요.</p>}
      {app.reviewUrl && (
        <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-start sm:gap-4">
          <a className="shrink-0 text-primary underline" href={app.reviewUrl} rel="noopener noreferrer" target="_blank">
            🔍 검수 페이지 열기
          </a>
          <StatusText loading={loading} row={row} tokenName={app.reviewTokenName} />
        </div>
      )}
    </div>
  );
}
