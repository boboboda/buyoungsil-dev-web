// components/admin/factory/BlockUsagePanel.tsx
// [사용량] 탭 아래 "블록별" 표(4-4): 에이전트 종류·앱·결과물 카드·도구·방법 단위로 일감 수·결과·토큰·시간·다시 맞추기·외부 비용을 모으고,
// 토큰 막대와 기간별 흐름 막대를 붙인다. 보기 전용(/api/admin/factory/usage-blocks GET 만). 값(키·토큰)은 오지 않는다.
"use client";

import { useCallback, useEffect, useState } from "react";

import { compactTokens, durationText, GROUP_BYS, GROUP_LABEL, PERIOD_LABEL, PERIODS, type GroupBy, type Period, type UsageByBlock } from "@/lib/factory/runStats";

/** 막대 길이(%). 가장 큰 값을 100% 로. 값이 있는데 너무 짧으면 보이도록 최소 2% */
export function barPct(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;

  return Math.max(2, Math.min(100, Math.round((value / max) * 100)));
}

export function UsageBars({ data }: { data: UsageByBlock }) {
  const maxTokens = Math.max(0, ...data.rows.map((r) => r.tokens));
  const maxTrend = Math.max(0, ...data.trend.map((t) => t.tokens));

  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2" data-usage-bars>
      <div className="min-w-0 space-y-1" data-bars="rows">
        <h3 className="fx-label">토큰 (많은 순)</h3>
        {data.rows.length ? (
          data.rows.slice(0, 10).map((r) => (
            <div key={r.key || "none"} className="flex min-w-0 items-center gap-2 text-xs">
              <span className="w-28 shrink-0 truncate" title={r.label}>
                {r.label}
              </span>
              <span className="h-3 min-w-0 flex-1 rounded bg-default-100">
                <span className="block h-3 rounded" data-bar={r.key} style={{ width: `${barPct(r.tokens, maxTokens)}%`, background: "var(--fx-accent)" }} />
              </span>
              <span className="w-14 shrink-0 text-right font-mono">{compactTokens(r.tokens)}</span>
            </div>
          ))
        ) : (
          <p className="text-xs fx-muted">이 기간에 기록이 없어요.</p>
        )}
      </div>
      <div className="min-w-0 space-y-1" data-bars="trend">
        <h3 className="fx-label">{data.period === "day" ? "일별" : data.period === "week" ? "주별" : "30일 단위"} 흐름 (토큰)</h3>
        {data.trend.map((t) => (
          <div key={t.label} className="flex min-w-0 items-center gap-2 text-xs">
            <span className="w-16 shrink-0 font-mono">{t.label}</span>
            <span className="h-3 min-w-0 flex-1 rounded bg-default-100">
              <span className="block h-3 rounded" data-trend={t.label} style={{ width: `${barPct(t.tokens, maxTrend)}%`, background: "var(--fx-ok)" }} />
            </span>
            <span className="w-24 shrink-0 text-right font-mono">
              {compactTokens(t.tokens)} · {t.runs}회
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function UsageTable({ data }: { data: UsageByBlock }) {
  const rows = [...data.rows, ...(data.rows.length ? [data.total] : [])];

  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-xs" data-usage-table>
        <thead>
          <tr className="fx-muted">
            <th className="py-1 pr-2 font-semibold">{GROUP_LABEL[data.by]}</th>
            <th className="px-2 font-semibold">횟수</th>
            <th className="px-2 font-semibold">결과 (성공/실패/막힘)</th>
            <th className="px-2 font-semibold">토큰</th>
            <th className="px-2 font-semibold">대기</th>
            <th className="px-2 font-semibold">실행</th>
            <th className="px-2 font-semibold">중지</th>
            <th className="px-2 font-semibold">다시 맞추기</th>
            <th className="px-2 font-semibold">외부 비용</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r) => (
              <tr key={r.key || "none"} className={r === data.total ? "border-t font-semibold" : ""} data-usage-row={r.key || "none"}>
                <td className="max-w-[16rem] truncate py-1 pr-2" title={r.label}>
                  {r.label}
                </td>
                <td className="px-2">{r.runs}</td>
                <td className="px-2">
                  <span className="fx-ok">{r.success}</span> / <span className="fx-bad">{r.failed}</span> / <span className="fx-warn">{r.blocked}</span>
                </td>
                <td className="px-2 font-mono">{compactTokens(r.tokens)}</td>
                <td className="px-2">{durationText(r.waitMs)}</td>
                <td className="px-2">{durationText(r.runMs)}</td>
                <td className="px-2">{durationText(r.pausedMs)}</td>
                <td className="px-2">{r.redo}회</td>
                <td className="px-2">{r.externalCost > 0 ? `${r.externalLabel ?? "외부"} ${Math.round(r.externalCost)}` : "-"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="py-2 fx-muted" colSpan={9}>
                이 기간에 끝난 일이 없어요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function BlockUsagePanel() {
  const [by, setBy] = useState<GroupBy>("agent");
  const [period, setPeriod] = useState<Period>("week");
  const [data, setData] = useState<UsageByBlock | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/factory/usage-blocks?by=${by}&period=${period}`, { cache: "no-store" });

      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as UsageByBlock);
      setError("");
    } catch {
      setError("블록별 통계를 받지 못했어요.");
    }
  }, [by, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const choice = <T extends string>(items: readonly T[], value: T, set: (v: T) => void, label: (v: T) => string, name: string) => (
    <div aria-label={name} className="flex flex-wrap gap-1" role="group">
      {items.map((i) => (
        <button key={i} aria-pressed={value === i} className={`rounded border px-2 py-0.5 text-xs ${value === i ? "border-default-700 font-semibold" : "border-default-300"}`} data-choice={i} type="button" onClick={() => set(i)}>
          {label(i)}
        </button>
      ))}
    </div>
  );

  return (
    <section aria-label="블록별 사용량" className="fx-panel min-w-0 space-y-3 p-3" data-block-usage>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-base font-semibold">블록별</h2>
        {choice<GroupBy>(GROUP_BYS, by, setBy, (g) => GROUP_LABEL[g], "묶는 기준")}
        {choice<Period>(PERIODS, period, setPeriod, (p) => PERIOD_LABEL[p], "기간")}
      </div>
      {error ? (
        <p className="text-sm fx-warn" role="status">
          {error}
        </p>
      ) : null}
      {data ? (
        <>
          <UsageTable data={data} />
          <UsageBars data={data} />
        </>
      ) : (
        <p className="text-sm fx-muted">불러오는 중…</p>
      )}
      <p className="text-xs fx-muted">토큰 = 입력+출력+캐시 생성(Claude 기준, Codex 일감은 0). 중지 = 서버 배포·업데이트로 보고가 멈춘 시간. 일감·정비·지휘자·도구 일감이 끝날 때 한 줄씩 쌓여요.</p>
    </section>
  );
}
