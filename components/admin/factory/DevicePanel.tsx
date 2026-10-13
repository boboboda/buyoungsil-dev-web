// components/admin/factory/DevicePanel.tsx
// 통제실 [사용량] 맨 위 '장비 상태': 서버1·서버2·메인PC 를 카드로 나란히(좁은 화면은 세로).
// 카드마다 연결 상태(정상/오래된 값/끊김)·마지막 갱신, CPU·RAM·GPU·디스크(24칸 막대 + 큰 숫자, 70%↑ 주의·90%↑ 위험, 글자 병행),
// 최근 24시간 CPU 최고값 막대. 아래에 '배포된 프로젝트 수'(서버1 Docker 컨테이너 / 홈페이지 출시 프로젝트 / 스토어 출시 앱).
// /api/admin/factory/devices 를 30초마다 읽는다(화면이 보일 때만). 읽기에 실패해도 이 패널만 '갱신 실패'를 보이고 다른 화면은 그대로.
"use client";

import type {
  DeployCounts,
  DevicesSnapshot,
  DeviceState,
  DeviceView,
  GpuItem,
} from "@/lib/factory/devices";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Led,
  type MeterTone,
  meterTone,
  SegmentBar,
  Sparkline,
  updatedText,
} from "@/components/admin/ui/meters";

import { RunningSection } from "./RunningPanel";

const REFRESH_MS = 30_000;

const STATE_LED: Record<DeviceState, { tone: MeterTone; text: string }> = {
  ok: { tone: "ok", text: "정상" },
  stale: { tone: "warn", text: "오래된 값" },
  offline: { tone: "bad", text: "끊김" },
  never: { tone: "idle", text: "받은 적 없음" },
};

const gb = (v: number | null) =>
  v === null ? "-" : v >= 1000 ? `${Math.round(v)}` : v.toFixed(1);

/** 사용률 한 칸의 표시 값. 값이 없거나 장비가 끊겼으면 회색('--'), 아니면 70%↑ 주의·90%↑ 위험 */
export function metricReading(pct: number | null, live: boolean) {
  if (pct === null)
    return { pct: null, tone: "idle" as MeterTone, state: "값 없음" };

  const p = Math.round(pct);
  const { tone, text } = meterTone(p);

  return live
    ? { pct: p, tone, state: text }
    : { pct: p, tone: "idle" as MeterTone, state: `${text} · 지난 값` };
}

/** GPU 칸 문구: 없음 / 확인 못 함 / VRAM·온도 */
export function gpuLine(g: GpuItem) {
  const parts = [];

  if (g.memTotalGb !== null)
    parts.push(`VRAM ${gb(g.memUsedGb)} / ${gb(g.memTotalGb)} GB`);
  if (g.tempC !== null) parts.push(`${Math.round(g.tempC)}°C`);

  return parts.join(" · ") || "VRAM 값 없음";
}

export const GPU_STATE_TEXT = { none: "GPU 없음", unknown: "GPU 확인 못 함" };

function Metric({
  device,
  label,
  pct,
  live,
  sub,
}: {
  device: string;
  label: string;
  pct: number | null;
  live: boolean;
  sub: string;
}) {
  const r = metricReading(pct, live);

  return (
    <div className="fx-limit" data-metric={label}>
      <div className="fx-limit-top">
        <span className="fx-limit-label">{label}</span>
        <Led tone={r.tone}>{r.state}</Led>
        <span className={`fx-limit-pct fx-${r.tone}`}>
          {r.pct === null ? "--" : r.pct}
          <span className="fx-limit-unit">%</span>
        </span>
      </div>
      <SegmentBar
        label={`${device} ${label} 사용률`}
        pct={r.pct ?? 0}
        tone={r.pct === null ? "idle" : r.tone}
        valueText={r.pct === null ? r.state : `${r.pct}% 사용 (${r.state})`}
      />
      <div className="fx-limit-sub">
        <span>{sub}</span>
      </div>
    </div>
  );
}

function DeviceCard({ d, now }: { d: DeviceView; now: number }) {
  const led = STATE_LED[d.state];
  const live = d.state === "ok" || d.state === "stale";
  const has = d.receivedAt !== null;
  const cpuHist = d.history.cpu.map((v) => v ?? 0);
  const cpuTop = Math.max(0, ...cpuHist);

  return (
    <li
      className="fx-panel flex min-w-0 flex-col gap-3 p-3"
      data-device={d.device}
      data-state={d.state}
    >
      <div className="fx-dash-sec-head flex-wrap">
        <h3 className="fx-dash-sub">{d.name}</h3>
        <Led tone={led.tone}>{led.text}</Led>
      </div>
      <p className="-mt-2 break-words text-sm fx-muted">
        {d.role}
        <br />
        <span className={d.state === "ok" ? "" : "fx-warn"}>
          {d.state === "ok" ? "" : "▲ "}
          {updatedText(d.receivedAt, now)}
        </span>
      </p>

      {!has ? (
        <p className="fx-dash-wait">
          — 아직 받은 값이 없어요. 이 장비에 수집 스크립트를 설치하면 1분 안에
          나타나요.
        </p>
      ) : (
        <>
          <Metric
            device={d.short}
            label="CPU"
            live={live}
            pct={d.cpuPct}
            sub={d.cpuPct === null ? "다음 값부터 보여요" : "1분 평균 사용률"}
          />
          <Metric
            device={d.short}
            label="RAM"
            live={live}
            pct={d.ram?.pct ?? null}
            sub={d.ram ? `${gb(d.ram.usedGb)} / ${gb(d.ram.totalGb)} GB` : "값 없음"}
          />
          {d.gpu.state === "ok" ? (
            d.gpu.list.map((g, i) => (
              <Metric
                key={i}
                device={d.short}
                label={d.gpu.state === "ok" && d.gpu.list.length > 1 ? `GPU${i}` : "GPU"}
                live={live}
                pct={g.utilPct}
                sub={gpuLine(g)}
              />
            ))
          ) : (
            <div className="fx-limit" data-gpu={d.gpu.state}>
              <div className="fx-limit-top">
                <span className="fx-limit-label">GPU</span>
                <Led tone="idle">
                  {d.gpu.state === "none" ? "없음" : "확인 못 함"}
                </Led>
              </div>
              <div className="fx-limit-sub">
                <span>{GPU_STATE_TEXT[d.gpu.state]}</span>
              </div>
            </div>
          )}
          {d.disks.length === 0 ? (
            <p className="fx-dash-note">디스크: 값 없음</p>
          ) : (
            d.disks.map((k) => (
              <Metric
                key={k.mount}
                device={d.short}
                label={`디스크 ${k.mount}`}
                live={live}
                pct={k.pct}
                sub={`${gb(k.usedGb)} / ${gb(k.totalGb)} GB 사용`}
              />
            ))
          )}
          {cpuTop > 0 ? (
            <div>
              <p className="fx-dash-note">
                최근 24시간 CPU (1시간 최고값) · 최고 {Math.round(cpuTop)}%
              </p>
              <Sparkline
                label={`${d.short} 최근 24시간 CPU 최고 ${Math.round(cpuTop)}%`}
                values={cpuHist}
              />
            </div>
          ) : null}
        </>
      )}
    </li>
  );
}

const ago = (asOf: number | null, now: number) =>
  asOf === null ? "" : ` · ${updatedText(asOf, now)}`;

/** 컨테이너 칸 문구(시험용) */
export function containersText(c: DeployCounts["containers"]) {
  if (c.state === "ok") return `${c.count}개`;
  if (c.state === "never") return "서버1 값 없음";
  if (c.state === "offline") return "서버1 끊김";

  return "확인 못 함";
}

function Deploys({ v, now }: { v: DeployCounts; now: number }) {
  const c = v.containers;

  return (
    <div className="fx-dash-sec" data-deploys="">
      <div className="fx-dash-sec-head">
        <h3 className="fx-dash-sub">배포된 프로젝트 수</h3>
      </div>
      <ul className="grid min-w-0 gap-3 sm:grid-cols-3">
        <li className="fx-panel min-w-0 p-3" data-count="containers">
          <p className="text-sm fx-muted">서버1에서 실행 중인 Docker 컨테이너</p>
          <p className="fx-limit-pct mt-1">{containersText(c)}</p>
          <p className="mt-1 text-sm fx-muted">
            docker ps 로 센 실행 중 컨테이너(서비스) 수{ago(c.asOf, now)}
          </p>
          {c.state === "ok" && c.names.length > 0 ? (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer underline underline-offset-2">
                컨테이너 이름 보기 ({c.names.length})
              </summary>
              <ul className="mt-1 break-all font-mono">
                {c.names.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </li>
        <li className="fx-panel min-w-0 p-3" data-count="homepage">
          <p className="text-sm fx-muted">홈페이지 &apos;출시&apos; 프로젝트</p>
          <p className="fx-limit-pct mt-1">
            {v.homepage ? `${v.homepage.released}개` : "확인 못 함"}
          </p>
          <p className="mt-1 text-sm fx-muted">
            홈페이지 DB 프로젝트 중 상태가 &apos;출시&apos;인 것
            {v.homepage ? ` (전체 ${v.homepage.total}개 중)` : ""}
          </p>
        </li>
        <li className="fx-panel min-w-0 p-3" data-count="store">
          <p className="text-sm fx-muted">스토어 출시 앱</p>
          <p className="fx-limit-pct mt-1">
            {v.storeReleased === null ? "확인 못 함" : `${v.storeReleased}개`}
          </p>
          <p className="mt-1 text-sm fx-muted">
            앱 공장 출시 단계가 &apos;출시&apos;인 앱
          </p>
        </li>
      </ul>
    </div>
  );
}

export function DevicePanelView({
  data,
  now,
  error = null,
}: {
  data: DevicesSnapshot | null;
  now: number;
  error?: string | null;
}) {
  return (
    <section
      aria-labelledby="device-panel-title"
      className="fx-hud"
      data-panel="devices"
    >
      <header className="fx-hud-head">
        <h2 className="fx-hud-title" id="device-panel-title">
          DEVICES<span className="sr-only"> (장비 상태)</span> · 장비 상태
        </h2>
        {error ? (
          <Led tone="bad">{error}</Led>
        ) : (
          <Led tone="run">30초 갱신</Led>
        )}
      </header>
      {!data ? (
        <p className="fx-dash-wait" role="status">
          {error ? "○ 장비 상태를 읽지 못했어요. 잠시 뒤 다시 읽어요." : "읽는 중…"}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="grid min-w-0 gap-3 lg:grid-cols-3">
            {data.devices.map((d) => (
              <DeviceCard key={d.device} d={d} now={now} />
            ))}
          </ul>
          <p className="fx-dash-note">
            색과 함께 글자로도 표시해요: 70% 이상 ▲ 주의, 90% 이상 ✕ 위험. 10분 넘게
            값이 안 오면 &apos;오래된 값&apos;, 30분 넘으면 &apos;끊김&apos;.
          </p>
          <RunningSection devices={data.devices} now={now} />
          <Deploys now={now} v={data.deploys} />
        </div>
      )}
    </section>
  );
}

export default function DevicePanel() {
  const [data, setData] = useState<DevicesSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;

    try {
      const res = await fetch("/api/admin/factory/devices", {
        cache: "no-store",
      });

      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as DevicesSnapshot);
      setError(null);
    } catch {
      setError("갱신 실패");
    } finally {
      busy.current = false;
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);

    return () => clearInterval(id);
  }, [load]);

  return <DevicePanelView data={data} error={error} now={now} />;
}
