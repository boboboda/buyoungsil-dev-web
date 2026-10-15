// components/studio/BlockDiagram.tsx
// 블록 그림: 프로젝트 → 결과물 카드 → 도구 → 방법. 선은 SVG 로 직접 그리고(라이브러리 없음), 블록은 같은 좌표에 놓은 HTML 버튼이다
// (글자 줄바꿈·키보드 포커스·누름 표시를 브라우저에 맡기려고). 좌표는 lib/studio/dashboard.ts 의 buildBlockGraph 가 계산한다.
// 좁은 화면에서는 그림 영역이 가로로 스크롤된다.
// 통제실 지도(4-3)도 같은 그림을 쓴다: 블록의 status(상태 색), live(진행 중 한 줄), graph.frames(기계 상자), edge.inferred(점선)는 지도에서만 채워진다.
"use client";

import type { BlockGraph, BlockNode, BlockStatus, BlockType, Tone } from "@/lib/studio/dashboard";

const TYPE_LABEL: Record<BlockType, string> = {
  project: "프로젝트",
  card: "결과물 카드",
  tool: "도구",
  method: "방법",
  machine: "기계",
  agent: "에이전트",
  app: "앱 폴더",
  remote: "git 원격",
  proxy: "프록시",
  domain: "도메인",
  container: "서비스",
};
// 상태는 색 + 모양 + 글자로 같이 보인다(색만으로 구분하지 않는다)
const STATUS_STYLE: Record<BlockStatus, { mark: string; cls: string; color: string }> = {
  ok: { mark: "●", cls: "fx-ok", color: "var(--fx-ok)" },
  busy: { mark: "◆", cls: "fx-run", color: "var(--fx-accent)" },
  pending: { mark: "◔", cls: "fx-warn", color: "var(--fx-warn)" },
  down: { mark: "✕", cls: "fx-bad", color: "var(--fx-bad)" },
  warn: { mark: "▲", cls: "fx-warn", color: "var(--fx-warn)" },
};
const TONE_CLASS: Record<Tone, string> = { ok: "fx-ok", warn: "fx-warn", muted: "fx-muted" };
const TONE_MARK: Record<Tone, string> = { ok: "●", warn: "▲", muted: "○" };

function edgePath(a: BlockNode, b: BlockNode) {
  if (b.x < a.x) [a, b] = [b, a]; // 거꾸로 이은 선도 왼쪽 블록 오른쪽 변에서 시작한다
  const x1 = a.x + a.w;
  const y1 = a.y + a.h / 2;
  const x2 = b.x;
  const y2 = b.y + b.h / 2;
  const mid = (x1 + x2) / 2;

  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

export default function BlockDiagram({ graph, selected, onSelect }: { graph: BlockGraph; selected: string | null; onSelect: (id: string) => void }) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  return (
    <div className="max-w-full overflow-x-auto" data-block-diagram>
      <div className="relative" style={{ width: graph.width, height: graph.height }}>
        {graph.frames?.map((f) => (
          <div key={f.id} className="absolute rounded border border-dashed border-default-300" data-frame={f.id} style={{ left: f.x, top: f.y, width: f.w, height: f.h }}>
            <span className="absolute left-2 top-0.5 text-xs font-semibold fx-muted">{f.label}</span>
          </div>
        ))}
        <svg aria-hidden className="absolute inset-0" height={graph.height} width={graph.width}>
          {graph.edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);

            if (!a || !b) return null;

            return (
              <path
                key={`${e.from}>${e.to}`}
                d={edgePath(a, b)}
                data-edge={`${e.from}>${e.to}`}
                data-edge-kind={e.kind}
                fill="none"
                opacity={a.dim || b.dim ? 0.4 : 0.9}
                stroke="var(--fx-border)"
                strokeDasharray={e.inferred ? "5 4" : undefined}
                strokeWidth={1.5}
              />
            );
          })}
        </svg>
        {graph.nodes.map((n) => (
          <button
            key={n.id}
            aria-label={`${TYPE_LABEL[n.type]} ${n.title}`}
            aria-pressed={selected === n.id}
            className={`fx-panel absolute flex min-w-0 flex-col justify-between overflow-hidden px-2 py-1 text-left ${selected === n.id ? "border-2 border-default-700" : ""}`}
            data-block={n.id}
            data-block-status={n.status}
            data-block-type={n.type}
            style={{ left: n.x, top: n.y, width: n.w, height: n.h, opacity: n.dim ? 0.6 : 1, ...(n.status ? { borderColor: STATUS_STYLE[n.status].color, borderLeftWidth: 4 } : {}) }}
            type="button"
            onClick={() => onSelect(n.id)}
          >
            <span className="block min-w-0 truncate text-sm font-semibold">{n.title}</span>
            <span className="block min-w-0 truncate text-xs fx-muted font-mono">{n.sub}</span>
            {n.status ? (
              <span className={`block min-w-0 truncate text-xs ${STATUS_STYLE[n.status].cls}`} data-block-state>
                {STATUS_STYLE[n.status].mark} {n.statusText}
              </span>
            ) : null}
            {n.live ? (
              <span className="block min-w-0 truncate text-xs fx-run" data-block-live>
                {n.live}
              </span>
            ) : null}
            {n.usage ? (
              <span className="block min-w-0 truncate text-xs fx-muted" data-block-usage-line title={n.usage}>
                {n.usage}
              </span>
            ) : null}
            <span className="flex min-w-0 flex-wrap gap-x-2 text-xs">
              {n.badges.map((b) => (
                <span key={b.text} className={TONE_CLASS[b.tone]} data-badge>
                  {TONE_MARK[b.tone]} {b.text}
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
