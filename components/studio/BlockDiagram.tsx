// components/studio/BlockDiagram.tsx
// 블록 그림: 프로젝트 → 결과물 카드 → 도구 → 방법. 선은 SVG 로 직접 그리고(라이브러리 없음), 블록은 같은 좌표에 놓은 HTML 버튼이다
// (글자 줄바꿈·키보드 포커스·누름 표시를 브라우저에 맡기려고). 좌표는 lib/studio/dashboard.ts 의 buildBlockGraph 가 계산한다.
// 좁은 화면에서는 그림 영역이 가로로 스크롤된다.
"use client";

import type { BlockGraph, BlockNode, BlockType, Tone } from "@/lib/studio/dashboard";

const TYPE_LABEL: Record<BlockType, string> = { project: "프로젝트", card: "결과물 카드", tool: "도구", method: "방법" };
const TONE_CLASS: Record<Tone, string> = { ok: "fx-ok", warn: "fx-warn", muted: "fx-muted" };
const TONE_MARK: Record<Tone, string> = { ok: "●", warn: "▲", muted: "○" };

function edgePath(a: BlockNode, b: BlockNode) {
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
        <svg aria-hidden className="absolute inset-0" height={graph.height} width={graph.width}>
          {graph.edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);

            if (!a || !b) return null;

            return <path key={`${e.from}>${e.to}`} d={edgePath(a, b)} data-edge={`${e.from}>${e.to}`} fill="none" opacity={a.dim || b.dim ? 0.4 : 0.9} stroke="var(--fx-border)" strokeWidth={1.5} />;
          })}
        </svg>
        {graph.nodes.map((n) => (
          <button
            key={n.id}
            aria-label={`${TYPE_LABEL[n.type]} ${n.title}`}
            aria-pressed={selected === n.id}
            className={`fx-panel absolute flex min-w-0 flex-col justify-between overflow-hidden px-2 py-1 text-left ${selected === n.id ? "border-2 border-default-700" : ""}`}
            data-block={n.id}
            data-block-type={n.type}
            style={{ left: n.x, top: n.y, width: n.w, height: n.h, opacity: n.dim ? 0.6 : 1 }}
            type="button"
            onClick={() => onSelect(n.id)}
          >
            <span className="block min-w-0 truncate text-sm font-semibold">{n.title}</span>
            <span className="block min-w-0 truncate text-xs fx-muted font-mono">{n.sub}</span>
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
