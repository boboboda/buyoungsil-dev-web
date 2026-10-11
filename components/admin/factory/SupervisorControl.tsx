// components/admin/factory/SupervisorControl.tsx
// 감독 프로그램 상태(연결/꺼짐)와 일시 정지·재개, 자동 업데이트 켜고 끄기, 지금 업데이트, 정비 대기열 끝나면 자동 배포 켜고 끄기.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody } from "@heroui/react";

import MaintenancePanel from "./MaintenancePanel";

interface State {
  enabled: boolean;
  autoUpdate: boolean;
  autoDeploy?: boolean; // 예전 서버에는 없다
  commit: string | null;
  commitSubject: string | null;
  updateNote: string | null;
  updateNoteAt: string | null;
  updateNowRequestedAt: string | null;
  online: boolean;
  lastSeenAt: string | null;
  workerName: string | null;
  running: number;
  approved: number;
  pending: number;
}

export default function SupervisorControl() {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/control", {
        cache: "no-store",
      });

      if (res.ok) setS((await res.json()) as State);
    } catch {
      /* 못 읽으면 그대로 둔다 */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);

    return () => clearInterval(t);
  }, [load]);

  const toggleAuto = async (body: Record<string, boolean> = { autoUpdate: !s?.autoUpdate }) => {
    if (!s) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/factory/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as State & {
        message?: string;
      };

      if (res.ok) setS(data);
      setNotice(
        data.message ?? (res.ok ? "처리했어요." : "처리하지 못했어요."),
      );
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
  };

  // 1회성 신호: 감독 프로그램이 다음 확인(15초 안) 때 받아 가서, 돌고 있는 일감이 없으면 바로 새 버전을 확인한다
  const updateNow = async () => {
    if (
      !window.confirm(
        "감독 프로그램을 지금 업데이트할까요?\n돌고 있는 일감이 없으면 새 버전을 받아 30초쯤 뒤 다시 켜져요.",
      )
    )
      return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/factory/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateNow: true }),
      });
      const data = (await res.json().catch(() => ({}))) as State & {
        message?: string;
      };

      if (res.ok) setS(data);
      setNotice(
        data.message ?? (res.ok ? "요청했어요." : "요청하지 못했어요."),
      );
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
  };

  const toggle = async () => {
    if (!s) return;
    if (
      s.enabled &&
      !window.confirm(
        "일시 정지할까요?\n진행 중인 작업은 끝까지 하고, 새 일감만 가져가지 않아요.",
      )
    )
      return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/factory/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      const data = (await res.json().catch(() => ({}))) as State & {
        message?: string;
      };

      if (res.ok) setS(data);
      setNotice(
        data.message ?? (res.ok ? "처리했어요." : "처리하지 못했어요."),
      );
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
  };

  let badge = "읽는 중…";
  let hint = "";

  if (s) {
    if (!s.online) {
      badge = "🔴 PC 꺼짐";
      hint =
        "감독 프로그램이 응답하지 않아요. PC가 켜져 있는지 확인하세요. (홈페이지에서 PC 프로그램을 켤 수는 없어요)";
    } else if (!s.enabled) {
      badge = "⏸️ 일시 정지";
      hint = "연결은 되어 있고, 새 일감은 가져가지 않아요.";
    } else {
      badge = "🟢 작동 중";
      hint = "승인된 일감을 가져가서 만들어요.";
    }
  }

  return (
    <Card className="mb-6">
      <CardBody className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">🤖 감독 프로그램: {badge}</div>
            {s && (
              <div className="text-xs text-default-500">
                진행 중 {s.running}개 · 승인된 대기 {s.approved}개 · 승인 기다림{" "}
                {s.pending}개
              </div>
            )}
          </div>
          <Button
            className="min-h-11 w-full sm:min-h-0 sm:w-auto"
            color={s?.enabled ? "warning" : "success"}
            isDisabled={busy || !s}
            size="sm"
            onPress={toggle}
          >
            {s?.enabled ? "⏸️ 일시 정지" : "▶️ 다시 시작"}
          </Button>
        </div>
        {hint && <p className="text-sm text-default-600">{hint}</p>}
        {s && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-default-50 p-2 text-xs sm:grid-cols-4">
            <Item
              label="연결"
              value={s.online ? "🟢 연결됨" : "🔴 응답 없음"}
            />
            <Item label="작업 PC" value={s.workerName ?? "-"} />
            <Item
              label="마지막 응답"
              value={
                s.lastSeenAt
                  ? new Date(s.lastSeenAt).toLocaleString("ko-KR")
                  : "-"
              }
            />
            <Item
              label="일감 받기"
              value={s.enabled ? "작동 중" : "⏸️ 일시 정지"}
            />
            <Item label="현재 버전" value={s.commit ?? "알 수 없음"} />
            <Item
              label="자동 업데이트"
              value={s.autoUpdate ? "켜짐" : "꺼짐"}
            />
            <Item
              label="진행 중 / 승인된 대기"
              value={`${s.running} / ${s.approved}`}
            />
            <Item label="승인 기다림" value={`${s.pending}`} />
            {s.commitSubject && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="inline text-default-500">현재 버전 내용: </dt>
                <dd className="inline break-words">{s.commitSubject}</dd>
              </div>
            )}
            {s.updateNote && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="inline text-default-500">
                  최근 업데이트 소식:{" "}
                </dt>
                <dd className="inline break-words">
                  {s.updateNote}
                  {s.updateNoteAt
                    ? ` (${new Date(s.updateNoteAt).toLocaleString("ko-KR")})`
                    : ""}
                </dd>
              </div>
            )}
          </dl>
        )}
        {s && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-default-200 pt-2 text-sm">
            <span>
              🔄 자동 업데이트: {s.autoUpdate ? "켜짐" : "꺼짐"}
              <span className="ml-1 text-xs text-default-500">
                (PC 프로그램이 새 코드를 스스로 받아요)
              </span>
              {s.updateNowRequestedAt && (
                <span className="mt-1 block text-xs text-default-500">
                  지금 업데이트 요청됨(PC가 받아 가는 중)
                </span>
              )}
            </span>
            <div className="flex w-full gap-2 sm:w-auto">
              <Button
                className="min-h-11 flex-1 sm:min-h-0 sm:flex-none"
                isDisabled={busy || !!s.updateNowRequestedAt}
                size="sm"
                variant="flat"
                onPress={updateNow}
              >
                ⬇️ 지금 업데이트
              </Button>
              <Button
                className="min-h-11 flex-1 sm:min-h-0 sm:flex-none"
                isDisabled={busy}
                size="sm"
                variant="flat"
                onPress={() => toggleAuto()}
              >
                {s.autoUpdate ? "자동 업데이트 끄기" : "자동 업데이트 켜기"}
              </Button>
            </div>
          </div>
        )}
        {s && s.autoDeploy !== undefined && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              🚀 정비 대기열이 모두 끝나면 자동 배포: {s.autoDeploy ? "켜짐" : "꺼짐"}
              <span className="ml-1 text-xs text-default-500">
                (기본 꺼짐. 켜면 대기열이 비고 마지막 지시의 검사가 통과했을 때 한 번 배포해요. 지난 배포 뒤 실패한 지시가 있으면 안 해요)
              </span>
            </span>
            <Button
              className="min-h-11 w-full sm:min-h-0 sm:w-auto"
              isDisabled={busy}
              size="sm"
              variant="flat"
              onPress={() => {
                if (!s.autoDeploy && !window.confirm("정비 대기열이 모두 끝나면 사람 확인 없이 홈페이지 서버에 자동 배포할까요?")) return;
                toggleAuto({ autoDeploy: !s.autoDeploy });
              }}
            >
              {s.autoDeploy ? "자동 배포 끄기" : "자동 배포 켜기"}
            </Button>
          </div>
        )}
        {notice && <p className="text-sm text-default-600">{notice}</p>}
        <MaintenancePanel />
      </CardBody>
    </Card>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-default-500">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
