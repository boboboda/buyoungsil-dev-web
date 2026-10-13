// components/admin/factory/RunningPanel.tsx
// 통제실 '실행 중인 모든 것'(읽기 전용): 장비별 카드(컨테이너·프로세스 요약, 의심 개수, 펼치면 메모리 큰 순 목록)와
// [현황] 맨 위 '자원 점검 필요' 한 줄. 데이터는 /api/admin/factory/devices 의 DeviceView.running.
// 색에만 의존하지 않고 기호·글자를 같이 쓴다. 좁은 화면(360px)은 표 대신 카드형 줄바꿈. 종료·삭제·정리 버튼은 없다.
"use client";

import type {
  DevicesSnapshot,
  DeviceView,
  RunFlag,
  RunningContainer,
  RunningProcess,
  TrendPoint,
} from "@/lib/factory/devices";

import { useEffect, useState } from "react";

import { Led, Sparkline, updatedText } from "@/components/admin/ui/meters";

export const FLAG_TEXT: Record<RunFlag, string> = {
  long_running: "오래 가동",
  restart_loop: "재시작 반복",
  stopped: "멈춘 지 오래됨",
  unlabeled: "소속 불명",
  heavy_orphan: "덩치 큰 고아 프로세스",
};

/** 가동 시간: 7일 3시간 / 5시간 20분 / 12분 */
export function uptimeText(sec: number | null) {
  if (sec === null || sec < 0) return "-";

  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);

  if (d > 0) return h > 0 ? `${d}일 ${h}시간` : `${d}일`;
  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;

  return `${m}분`;
}

const mb = (v: number | null) => (v === null ? "-" : `${Math.round(v)}MB`);

const bytesText = (b: number | null) => {
  if (b === null) return "";
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)}GB`;

  return `${Math.round(b / 1e6)}MB`;
};

/** 메모리 추이 글자: 처음→끝 변화. 점이 2개 미만이면 빈 문자열 */
export function trendText(t: TrendPoint[] | undefined) {
  if (!t || t.length < 2) return "";

  const diff = Math.round(t[t.length - 1].mb - t[0].mb);

  if (Math.abs(diff) < 5) return "▬ 변화 없음";

  return diff > 0 ? `▲ +${diff}MB` : `▼ ${diff}MB`;
}

function Flags({ flags }: { flags: RunFlag[] }) {
  if (flags.length === 0) return null;

  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span key={f} data-flag={f}>
          <Led tone="warn">{FLAG_TEXT[f]}</Led>
        </span>
      ))}
    </span>
  );
}

function Trend({ t, name }: { t: TrendPoint[] | undefined; name: string }) {
  const text = trendText(t);

  if (!t || !text) return <span className="fx-muted">추이 없음</span>;

  return (
    <span className="flex items-center gap-2">
      <span className="w-20 shrink-0">
        <Sparkline label={`${name} 메모리 추이 ${text}`} values={t.map((p) => p.mb)} />
      </span>
      <span>{text}</span>
    </span>
  );
}

const byMem = <T extends { memMb: number | null }>(a: T, b: T) =>
  (b.memMb ?? -1) - (a.memMb ?? -1);

function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 gap-1">
      <span className="fx-muted shrink-0">{k}</span>
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

function ContainerRow({ c }: { c: RunningContainer }) {
  const live = c.state === "running";

  return (
    <li
      className="fx-panel flex min-w-0 flex-col gap-1 p-2 text-sm"
      data-item="container"
      data-flagged={c.flags.length > 0 ? "1" : "0"}
    >
      <span className="flex flex-wrap items-center gap-2">
        <strong className="break-all font-mono">{c.name}</strong>
        <Led tone={live ? "ok" : "idle"}>{c.state === "running" ? "실행 중" : c.state}</Led>
        <Flags flags={c.flags} />
      </span>
      <span className="flex flex-wrap gap-x-4 gap-y-1">
        <Field k="프로젝트">{c.project ?? "-"}</Field>
        <Field k={live ? "가동" : "멈춘 지"}>{uptimeText(live ? c.uptimeSec : c.stoppedSec)}</Field>
        <Field k="재시작">{c.restarts === null ? "-" : `${c.restarts}회`}</Field>
        <Field k="CPU">{c.cpuPct === null ? "-" : `${c.cpuPct}%`}</Field>
        <Field k="메모리">{mb(c.memMb)}</Field>
        <Field k="추이">
          <Trend name={c.name} t={c.memTrend} />
        </Field>
      </span>
    </li>
  );
}

function ProcessRow({ p, now }: { p: RunningProcess; now: number }) {
  return (
    <li
      className="fx-panel flex min-w-0 flex-col gap-1 p-2 text-sm"
      data-item="process"
      data-flagged={p.flags.length > 0 ? "1" : "0"}
    >
      <span className="flex flex-wrap items-center gap-2">
        <strong className="break-all font-mono">{p.name}</strong>
        <span className="fx-muted">PID {p.pid}</span>
        <Led tone={p.child ? "ok" : "idle"}>{p.child ? "감독 자식" : "감독 밖"}</Led>
        <Flags flags={p.flags} />
      </span>
      <span className="flex flex-wrap gap-x-4 gap-y-1">
        <Field k="메모리">{mb(p.memMb)}</Field>
        <Field k="CPU 시간">{p.cpuSec === null ? "-" : `${Math.round(p.cpuSec)}초`}</Field>
        <Field k="가동">
          {p.startedAt === null ? "-" : uptimeText(Math.max(0, now / 1000 - p.startedAt))}
        </Field>
        <Field k="포트">{p.ports.length > 0 ? p.ports.join(", ") : "-"}</Field>
        {p.dir ? <Field k="폴더">{p.dir}</Field> : null}
        <Field k="추이">
          <Trend name={p.name} t={p.memTrend} />
        </Field>
      </span>
    </li>
  );
}

export interface ResourceAlert {
  device: string;
  name: string;
  reason: string;
}

/** 의심 항목 목록(장비 순서, 메모리 큰 순) */
export function resourceAlerts(devices: DeviceView[]): ResourceAlert[] {
  const out: ResourceAlert[] = [];

  for (const d of devices) {
    const r = d.running;

    if (!r) continue;

    const items = [
      ...(r.containers ?? []).map((c) => ({ name: c.name, flags: c.flags, memMb: c.memMb })),
      ...(r.processes ?? []).map((p) => ({ name: p.name, flags: p.flags, memMb: p.memMb })),
    ].sort(byMem);

    for (const it of items) {
      if (it.flags.length === 0) continue;
      out.push({
        device: d.short,
        name: it.name,
        reason: it.flags.map((f) => FLAG_TEXT[f]).join("·"),
      });
    }
  }

  return out;
}

/** '자원 점검 필요: 서버1 postgres 오래 가동 외 2건'. 의심이 없으면 null */
export function alertLine(alerts: ResourceAlert[]) {
  if (alerts.length === 0) return null;

  const a = alerts[0];
  const more = alerts.length > 1 ? ` 외 ${alerts.length - 1}건` : "";

  return `자원 점검 필요: ${a.device} ${a.name} ${a.reason}${more}`;
}

export function ResourceAlertView({ devices }: { devices: DeviceView[] }) {
  const line = alertLine(resourceAlerts(devices));

  if (!line) return null;

  return (
    <p className="fx-panel p-3 text-sm" data-resource-alert="" role="status">
      <Led tone="warn">{line}</Led>
    </p>
  );
}

function summaryText(d: DeviceView) {
  const r = d.running;

  if (!r) return "";

  const s = r.summary;
  const parts: string[] = [];

  if (r.containers) {
    const up = r.containers.filter((c) => c.state === "running").length;

    parts.push(`실행 중 컨테이너 ${up}`);
  }
  if (s) {
    if (s.stoppedContainers !== null) parts.push(`멈춘 ${s.stoppedContainers}`);
    if (s.danglingImages !== null) {
      const size = bytesText(s.imageBytes);

      parts.push(`안 쓰는 이미지 ${s.danglingImages}${size ? `(${size})` : ""}`);
    }
    if (s.volumes !== null) parts.push(`볼륨 ${s.volumes}`);
  }
  if (r.processes) parts.push(`프로세스 ${r.processes.length}`);

  return parts.join(" · ");
}

function DeviceRunning({ d, now }: { d: DeviceView; now: number }) {
  const r = d.running;
  const flagged = r
    ? [...(r.containers ?? []), ...(r.processes ?? [])].filter((i) => i.flags.length > 0).length
    : 0;
  const containers = [...(r?.containers ?? [])].sort(byMem);
  const processes = [...(r?.processes ?? [])].sort(byMem);
  const head = summaryText(d);

  return (
    <li className="fx-panel flex min-w-0 flex-col gap-2 p-3" data-running-device={d.device}>
      <div className="fx-dash-sec-head flex-wrap">
        <h4 className="fx-dash-sub">{d.name}</h4>
        <span className="flex flex-wrap items-center gap-2">
          {d.state === "stale" || d.state === "offline" ? (
            <Led tone={d.state === "stale" ? "warn" : "bad"}>
              {d.state === "stale" ? "오래된 값" : "끊김"} · {updatedText(d.receivedAt, now)}
            </Led>
          ) : null}
          {flagged > 0 ? <Led tone="warn">{`⚠ ${flagged}`}</Led> : null}
        </span>
      </div>

      {!r ? (
        <p className="fx-dash-wait" data-running-empty="">
          ○ 아직 못 받았어요
          {d.device === "main-pc"
            ? " (감독 프로그램 업데이트가 필요해요)"
            : " (서버에서 스크립트 갱신 필요)"}
        </p>
      ) : (
        <>
          <p className="break-words text-sm">{head || "요약 값 없음"}</p>
          {r.error ? <p className="fx-dash-note fx-warn">▲ {r.error}</p> : null}
          {r.truncated ? (
            <p className="fx-dash-note">메모리 큰 순으로 상위 일부만 보여요.</p>
          ) : null}
          {containers.length + processes.length > 0 ? (
            <details data-running-list="" open={flagged > 0}>
              <summary className="cursor-pointer text-sm underline underline-offset-2">
                목록 보기 ({containers.length + processes.length})
              </summary>
              <ul className="mt-2 flex min-w-0 flex-col gap-2">
                {containers.map((c) => (
                  <ContainerRow key={c.name} c={c} />
                ))}
                {processes.map((p) => (
                  <ProcessRow key={`${p.name}:${p.pid}`} now={now} p={p} />
                ))}
              </ul>
            </details>
          ) : (
            !r.error && <p className="fx-dash-note">실행 중인 항목이 없어요.</p>
          )}
        </>
      )}
    </li>
  );
}

export function RunningSection({ devices, now }: { devices: DeviceView[]; now: number }) {
  return (
    <div className="fx-dash-sec" data-running-all="">
      <div className="fx-dash-sec-head">
        <h3 className="fx-dash-sub">실행 중인 모든 것</h3>
      </div>
      <ResourceAlertView devices={devices} />
      <p className="fx-dash-note">
        도커 컨테이너와 메인PC 프로세스를 읽기만 해요(종료·정리 버튼 없음). ⚠ 는 의심 항목 수예요.
      </p>
      <ul className="grid min-w-0 gap-3 lg:grid-cols-3">
        {devices.map((d) => (
          <DeviceRunning key={d.device} d={d} now={now} />
        ))}
      </ul>
    </div>
  );
}

/** [현황] 맨 위 한 줄: 의심 항목이 있을 때만 보인다. 읽기에 실패하면 아무것도 안 보인다(다른 화면 영향 없음) */
export default function ResourceAlertStrip() {
  const [devices, setDevices] = useState<DeviceView[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/factory/devices", { cache: "no-store" });

        if (!res.ok) return;

        const j = (await res.json()) as DevicesSnapshot;

        if (alive) setDevices(j.devices);
      } catch {
        /* 조용히 넘김 */
      }
    };

    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return <ResourceAlertView devices={devices} />;
}
