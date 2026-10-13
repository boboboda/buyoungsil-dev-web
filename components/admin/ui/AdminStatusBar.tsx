// components/admin/ui/AdminStatusBar.tsx
// 관리자 콘솔 하단 상태줄(모든 /admin 화면, 아래에 붙어 따라옴, 터미널 상태줄 느낌):
// 감독 프로그램 연결 · 진행/대기 일감 · 마지막 응답 · 서버 빌드 커밋 · AI 한도 요약 · 장비별 CPU/RAM. 값이 없으면 '-'.
// /api/admin/status-bar 를 15초마다 읽는다(화면이 보일 때만). 좁은 화면은 한 줄 가로 스크롤.
"use client";

import type { UsageLimitsView } from "@/lib/claude-status/limits";
import type { DeviceBrief } from "@/lib/factory/devices";
import type { StatusBarData } from "@/lib/factory/statusBar";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  agoText,
  hhmmKst,
  type MeterTone,
  TONE_SYMBOL,
} from "@/components/admin/ui/meters";

const REFRESH_MS = 15_000;

export interface StatusPart {
  key: string;
  label: string; // 화면 읽기 프로그램용 이름
  tone: MeterTone | null;
  text: string;
}

const pct = (w: UsageLimitsView["fiveHour"] | undefined) =>
  w && !w.reset ? `${Math.round(w.usedPct)}%` : "-";

/** AI 한도 한 줄: "Claude 5h 23% · 7d 41% | Codex 5h 0% · 주 17%" */
export function aiSummary(
  claude: UsageLimitsView | null | undefined,
  codex: UsageLimitsView | null | undefined,
) {
  return `Claude 5h ${pct(claude?.fiveHour)} · 7d ${pct(claude?.sevenDay)} | Codex 5h ${pct(codex?.fiveHour)} · 주 ${pct(codex?.sevenDay)}`;
}

const pctText = (v: number | null) => (v === null ? "-" : `${Math.round(v)}%`);

/** 장비 한 줄: "서버1 CPU 12% RAM 40% · 서버2 끊김 · 메인PC CPU 17% RAM 76%". 값이 없으면 null(칸을 안 보임) */
export function deviceSummary(devices: DeviceBrief[] | null | undefined) {
  if (!devices || devices.length === 0) return null;
  if (devices.every((d) => d.state === "never")) return null;

  return devices
    .map((d) =>
      d.state === "offline" || d.state === "never"
        ? `${d.short} 끊김`
        : `${d.short} CPU ${pctText(d.cpuPct)} RAM ${pctText(d.ramPct)}${d.state === "stale" ? " (오래됨)" : ""}`,
    )
    .join(" · ");
}

/** 장비 칸 색: 끊김이 있으면 위험, 오래된 값·90%↑ 위험값이 있으면 주의/위험, 그 밖에는 색 없음 */
function deviceTone(devices: DeviceBrief[]): MeterTone | null {
  if (devices.some((d) => d.state === "offline")) return "bad";

  const top = Math.max(
    0,
    ...devices
      .filter((d) => d.state === "ok" || d.state === "stale")
      .flatMap((d) => [d.cpuPct ?? 0, d.ramPct ?? 0]),
  );

  if (top >= 90) return "bad";
  if (top >= 70 || devices.some((d) => d.state === "stale")) return "warn";

  return null;
}

/** 상태줄 칸들(순수 함수, 시험용) */
export function statusBarParts(
  data: StatusBarData | null,
  now: number,
  error: string | null = null,
): StatusPart[] {
  const s = data?.supervisor ?? null;
  const parts: StatusPart[] = [
    s
      ? s.online
        ? { key: "conn", label: "감독 프로그램", tone: "ok", text: "감독 연결됨" }
        : { key: "conn", label: "감독 프로그램", tone: "bad", text: "감독 끊김" }
      : { key: "conn", label: "감독 프로그램", tone: "idle", text: "감독 -" },
    {
      key: "jobs",
      label: "일감",
      tone: s && s.running > 0 ? "run" : null,
      text: s ? `진행 ${s.running} · 대기 ${s.waiting}` : "진행 - · 대기 -",
    },
    {
      key: "seen",
      label: "마지막 응답",
      tone: null,
      text: s?.lastSeenAt
        ? `응답 ${hhmmKst(s.lastSeenAt)} (${agoText(s.lastSeenAt, now)})`
        : "응답 -",
    },
    {
      key: "build",
      label: "서버 빌드 커밋",
      tone: null,
      text: data?.build ? `빌드 ${data.build.commit.slice(0, 7)}` : "빌드 -",
    },
    {
      key: "ai",
      label: "AI 한도",
      tone: null,
      text: aiSummary(data?.claude, data?.codex),
    },
  ];
  const devices = deviceSummary(data?.devices);

  if (devices && data?.devices)
    parts.push({
      key: "devices",
      label: "장비 CPU·RAM",
      tone: deviceTone(data.devices),
      text: devices,
    });

  if (error)
    parts.push({ key: "error", label: "상태줄", tone: "bad", text: error });

  return parts;
}

export function AdminStatusBarView({
  data,
  now,
  error = null,
}: {
  data: StatusBarData | null;
  now: number;
  error?: string | null;
}) {
  return (
    <footer aria-label="관리자 상태줄" className="fx-statusbar">
      {statusBarParts(data, now, error).map((p) => (
        <span
          key={p.key}
          className={`fx-statusbar-item${p.tone ? ` fx-${p.tone}` : ""}`}
          title={p.label}
        >
          {p.tone ? <span aria-hidden>{TONE_SYMBOL[p.tone]} </span> : null}
          {p.text}
        </span>
      ))}
    </footer>
  );
}

export default function AdminStatusBar() {
  const [data, setData] = useState<StatusBarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;

    try {
      const res = await fetch("/api/admin/status-bar", { cache: "no-store" });

      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as StatusBarData);
      setError(null);
    } catch {
      setError("상태 갱신 실패");
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

  return <AdminStatusBarView data={data} error={error} now={now} />;
}
