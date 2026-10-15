// components/admin/factory/FactoryMap.tsx
// 통제실 [지도] 탭(4-3): 메인 PC·서버1·서버2와 그 안의 에이전트·도구·카드·앱 폴더·git 원격·도메인·컨테이너를 선으로 보여 준다. 보기 전용.
// 블록 그림은 스튜디오 [구성]의 BlockDiagram 을 그대로 다시 쓴다(선은 SVG, 블록은 HTML 버튼). 블록을 누르면 오른쪽(좁은 화면은 아래)에 상세가 나온다.
// 자료는 /api/admin/factory/map 을 5초마다 새로 받는다(진행 중 일감 한 줄이 실시간으로 바뀐다). 키는 이름만, 값은 오지 않는다.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import BlockDiagram from "@/components/studio/BlockDiagram";
import { MAP_KIND_LABEL, STATUS_INFO, STATUS_ORDER, type MapGraph } from "@/lib/factory/factoryMap";
import type { BlockGraph } from "@/lib/studio/dashboard";

const REFRESH_MS = 5000;

interface MapResponse {
  graph: MapGraph;
  asOf: number;
  reportAt: string | null;
  reportStale: boolean;
}

export default function FactoryMap({ initial = null }: { initial?: MapResponse | null }) {
  const [data, setData] = useState<MapResponse | null>(initial);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>("machine:main-pc");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/map", { cache: "no-store" });

      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as MapResponse);
      setError("");
    } catch {
      setError("지도를 새로 받지 못했어요. 마지막으로 받은 모습을 보여 드려요.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);

    return () => clearInterval(timer);
  }, [load]);

  const graph = data?.graph ?? null;
  const diagram: BlockGraph | null = useMemo(() => (graph ? { nodes: graph.nodes, edges: graph.edges, frames: graph.frames, width: graph.width, height: graph.height } : null), [graph]);
  const node = graph?.nodes.find((n) => n.id === selected) ?? null;
  const liveNodes = graph?.nodes.filter((n) => n.live) ?? [];

  return (
    <div className="min-w-0 space-y-3" data-factory-map>
      <section aria-label="상태 범례" className="fx-panel flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm" data-map-legend>
        {STATUS_ORDER.map((s) => (
          <span key={s} className={STATUS_INFO[s].cls} data-legend={s}>
            {STATUS_INFO[s].mark} {STATUS_INFO[s].label}
            {graph ? ` ${graph.counts[s]}` : ""}
          </span>
        ))}
        <span className="fx-muted">실선 = 기록된 연결 · 점선 = 연결 표의 이름으로 이은 선</span>
        {data ? <span className="fx-muted">· {new Date(data.asOf).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })} 기준</span> : null}
      </section>
      {error ? (
        <p className="text-sm fx-warn" role="status">
          {error}
        </p>
      ) : null}
      {data?.reportStale ? <p className="text-sm fx-warn">연결 표 보고가 오래됐어요(하루 1회). 설정의 연결 표에서 [새로 읽기]를 누르면 컨테이너·원격을 다시 읽어요.</p> : null}
      {liveNodes.length ? (
        <section aria-label="진행 중" className="fx-panel min-w-0 space-y-1 p-3" data-map-live>
          <h2 className="fx-label">지금 진행 중</h2>
          <ul className="space-y-0.5 text-sm">
            {liveNodes.map((n) => (
              <li key={n.id} className="min-w-0 break-words">
                <button className="underline-offset-2 hover:underline" type="button" onClick={() => setSelected(n.id)}>
                  <span className="font-semibold">{n.title}</span>
                </button>{" "}
                <span className="fx-run">{n.live}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="fx-panel min-w-0 p-2">
          {diagram ? <BlockDiagram graph={diagram} selected={selected} onSelect={setSelected} /> : <p className="p-2 text-sm fx-muted">지도를 불러오는 중이에요…</p>}
        </div>
        <aside aria-label="블록 상세" className="fx-panel min-w-0 space-y-2 p-3 lg:max-h-[80vh] lg:overflow-y-auto" data-map-detail>
          {node ? (
            <>
              <div>
                <p className="text-xs fx-muted">{MAP_KIND_LABEL[node.kind]}</p>
                <h2 className="break-words text-base font-semibold">{node.detail.title}</h2>
                {node.status ? (
                  <p className={`text-sm ${STATUS_INFO[node.status].cls}`} data-detail-status={node.status}>
                    {STATUS_INFO[node.status].mark} {node.statusText}
                  </p>
                ) : null}
                {node.live ? <p className="text-sm fx-run">{node.live}</p> : null}
              </div>
              <dl className="space-y-1">
                {node.detail.rows.map((r) => (
                  <div key={r.label} className="flex min-w-0 flex-wrap gap-x-2 text-sm">
                    <dt className="fx-muted">{r.label}</dt>
                    <dd className="min-w-0 break-words">{r.value}</dd>
                  </div>
                ))}
              </dl>
              {node.detail.lists.map((l) => (
                <div key={l.heading} data-detail-list={l.heading}>
                  <h3 className={`fx-label ${l.tone === "warn" ? "fx-warn" : l.tone === "bad" ? "fx-bad" : ""}`}>{l.heading}</h3>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm">
                    {l.items.map((it, i) => (
                      <li key={`${i}-${it}`} className="min-w-0 break-words">
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="text-xs fx-muted">보기 전용이에요. 고치는 곳: 에이전트 정의는 코드(agents/*.json), 연결 표·카드·도구는 설정과 스튜디오.</p>
            </>
          ) : (
            <p className="text-sm fx-muted">블록을 누르면 상세가 나와요.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
