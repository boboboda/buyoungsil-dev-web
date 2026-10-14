// components/admin/factory/SupervisorControl.tsx
// 감독 프로그램 상태(연결/꺼짐)와 일시 정지·재개, 자동 업데이트 켜고 끄기, 지금 업데이트, 재시작, 정비 대기열 끝나면 자동 배포 켜고 끄기.
// [감독] 탭의 상세 카드. 기본 AI·도구 중계 설정은 [설정] 탭, 공장 정비는 [정비] 탭에 있다. [현황]에는 SupervisorSummary 한 줄만 둔다.
"use client";

import { useState } from "react";
import { Button, Card, CardBody } from "@heroui/react";

import { StatusDot, type Tone } from "./fx";
import { useFactoryControl } from "./useFactoryControl";

interface State {
  enabled: boolean;
  autoUpdate: boolean;
  autoDeploy?: boolean; // 예전 서버에는 없다
  compactAfterJob?: boolean; // 예전 서버에는 없다
  appSlots?: number; // 동시에 만들 앱 수(통제실 [설정]). 예전 서버에는 없다
  commit: string | null;
  commitSubject: string | null;
  updateNote: string | null;
  updateNoteAt: string | null;
  updateNowRequestedAt: string | null;
  // 예전 서버에는 없다
  startedAt?: string | null;
  restartedBoot?: boolean;
  ffmpeg?: string | null;
  ffprobe?: string | null;
  restartRequestedAt?: string | null;
  restartState?: "requested" | "waiting" | "restarting" | "failed" | null;
  restartNote?: string | null;
  drainState?: "update" | "deploy" | null; // 업데이트·배포를 진행 중 일감이 끝나길 기다리는 중(새 일감은 받지 않음). 예전 서버에는 없다
  drainNote?: string | null;
  online: boolean;
  lastSeenAt: string | null;
  workerName: string | null;
  running: number;
  approved: number;
  pending: number;
}

export default function SupervisorControl() {
  const { data: s, publish } = useFactoryControl<State>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

      if (res.ok) publish(data);
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

      if (res.ok) publish(data);
      setNotice(
        data.message ?? (res.ok ? "요청했어요." : "요청하지 못했어요."),
      );
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
  };

  // 1회성 신호: 감독 프로그램이 다음 확인 때 받아 가서, 진행 중인 작업이 끝나면 껐다가 실행기가 다시 켠다
  const restart = async () => {
    if (
      !window.confirm(
        "감독 프로그램을 재시작할까요?\n진행 중인 작업이 있으면 끝난 뒤 재시작해요. (그동안 새 일감은 받지 않아요)",
      )
    )
      return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/factory/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restart: true }),
      });
      const data = (await res.json().catch(() => ({}))) as State & {
        message?: string;
      };

      if (res.ok) publish(data);
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

      if (res.ok) publish(data);
      setNotice(
        data.message ?? (res.ok ? "처리했어요." : "처리하지 못했어요."),
      );
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
  };

  let badge = "읽는 중…";
  let tone: Tone = "idle";
  let hint = "";

  if (s) {
    if (!s.online) {
      badge = "PC 꺼짐";
      tone = "bad";
      hint =
        "감독 프로그램이 응답하지 않아요. PC가 켜져 있는지 확인하세요. (홈페이지에서 PC 프로그램을 켤 수는 없어요)";
    } else if (!s.enabled) {
      badge = "일시 정지";
      tone = "warn";
      hint = "연결은 되어 있고, 새 일감은 가져가지 않아요.";
    } else {
      badge = "작동 중";
      tone = "ok";
      hint = "승인된 일감을 가져가서 만들어요.";
    }
  }

  return (
    <Card className="mb-6" data-title="supervisor · 감독 프로그램">
      <CardBody className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <StatusDot tone={tone} />
              감독 프로그램: <span className={`fx-${tone}`}>{badge}</span>
            </div>
            {s && (
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-default-500">
                <Count label="진행 중" max={s.appSlots} tone="run" value={s.running} />
                <Count label="승인된 대기" tone="warn" value={s.approved} />
                <Count label="승인 기다림" tone="warn" value={s.pending} />
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
            {s?.enabled ? "일시 정지" : "다시 시작"}
          </Button>
        </div>
        {hint && <p className="text-sm text-default-600">{hint}</p>}
        {s && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-default-200 bg-background p-2 text-xs sm:grid-cols-4">
            <Item label="연결" value={s.online ? "연결됨" : "응답 없음"} />
            <Item mono label="작업 PC" value={s.workerName ?? "-"} />
            <Item
              mono
              label="마지막 응답"
              value={
                s.lastSeenAt
                  ? new Date(s.lastSeenAt).toLocaleString("ko-KR")
                  : "-"
              }
            />
            <Item
              label="일감 받기"
              value={s.enabled ? "작동 중" : "일시 정지"}
            />
            <Item mono label="현재 버전" value={s.commit ?? "알 수 없음"} />
            <Item
              label="자동 업데이트"
              value={s.autoUpdate ? "켜짐" : "꺼짐"}
            />
            <Item
              mono
              label="진행 중 / 승인된 대기"
              value={`${s.running} / ${s.approved}`}
            />
            <Item mono label="승인 기다림" value={`${s.pending}`} />
            {s.startedAt !== undefined && (
              <Item
                mono
                label="시작 시각"
                value={
                  s.startedAt
                    ? `${new Date(s.startedAt).toLocaleString("ko-KR")}${s.restartedBoot ? " · 재시작됨" : ""}`
                    : "알 수 없음"
                }
              />
            )}
            {s.ffmpeg !== undefined && (
              <div className="col-span-2 min-w-0 sm:col-span-3">
                <dt className="text-default-500">ffmpeg</dt>
                <dd className="break-all font-mono font-medium">
                  {s.ffmpeg ?? "알 수 없음(예전 감독 프로그램)"}
                </dd>
              </div>
            )}
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
              자동 업데이트: {s.autoUpdate ? "켜짐" : "꺼짐"}
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
                지금 업데이트
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
        {s?.drainNote && <p className="text-xs text-warning-600">⏳ {s.drainNote}</p>}
        {s && s.restartState !== undefined && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              감독 재시작
              <span className="ml-1 text-xs text-default-500">
                (진행 중인 작업이 끝난 뒤 껐다 켜요. 윈도우 PATH 를 새로 읽어 새로 설치한 ffmpeg 등을 찾아요)
              </span>
              {s.restartNote && (
                <span
                  className={`mt-1 block text-xs ${s.restartState === "failed" ? "text-danger" : "text-default-500"}`}
                >
                  {s.restartNote}
                </span>
              )}
            </span>
            <Button
              className="min-h-11 w-full sm:min-h-0 sm:w-auto"
              isDisabled={
                busy ||
                !!s.restartRequestedAt ||
                s.restartState === "waiting" ||
                s.restartState === "restarting"
              }
              size="sm"
              variant="flat"
              onPress={restart}
            >
              감독 재시작
            </Button>
          </div>
        )}
        {s && s.autoDeploy !== undefined && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              정비 대기열이 모두 끝나면 자동 배포: {s.autoDeploy ? "켜짐" : "꺼짐"}
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
        {s && s.compactAfterJob !== undefined && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              작업 후 컨텍스트 정리: {s.compactAfterJob ? "켜짐" : "꺼짐"}
              <span className="ml-1 text-xs text-default-500">
                (기본 켜짐. 성공한 정비·이어받은 일감의 Claude 세션을 /compact 로 요약해 다음 작업의 토큰을 줄여요. Codex·실패한 작업은 건드리지 않아요)
              </span>
            </span>
            <Button
              className="min-h-11 w-full sm:min-h-0 sm:w-auto"
              isDisabled={busy}
              size="sm"
              variant="flat"
              onPress={() => toggleAuto({ compactAfterJob: !s.compactAfterJob })}
            >
              {s.compactAfterJob ? "컨텍스트 정리 끄기" : "컨텍스트 정리 켜기"}
            </Button>
          </div>
        )}
        {notice && <p className="text-sm text-default-600">{notice}</p>}
      </CardBody>
    </Card>
  );
}

function Item({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-default-500">{label}</dt>
      <dd className={`truncate font-medium${mono ? " font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

// 일감 수: 상태 점 + 큰 monospace 숫자
function Count({
  label,
  value,
  tone,
  max,
}: {
  label: string;
  value: number;
  tone: Tone;
  max?: number; // 있으면 '3 / 최대 3' 처럼 같이 보여 준다
}) {
  return (
    <span className="flex items-center gap-1.5">
      <StatusDot tone={value > 0 ? tone : "idle"} />
      {label}
      <span className="font-mono text-base font-semibold text-foreground">
        {value}
      </span>
      {max !== undefined && <span data-count-max>/ 최대 {max}</span>}
    </span>
  );
}
