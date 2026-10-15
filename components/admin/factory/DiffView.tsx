// components/admin/factory/DiffView.tsx
// 일감 상세의 '변경 내용' (5-1). 파일 트리(폴더별로 묶고 추가·삭제 줄 수)와 색칠된 diff 를 보여 준다. 읽기 전용.
//   - 키·비밀 파일은 내용 없이 "내용 숨김"만, 큰 파일·바이너리는 줄 수만("요약만").
//   - 서버가 저장할 때 이미 정리했지만(lib/factory/diffReport.ts) 화면에서도 한 번 더 cleanDiffReport 로 비밀 파일을 가린다.
"use client";

import { useMemo, useState } from "react";

import { cleanDiffReport, type DiffFile, type DiffReport } from "@/lib/factory/diffReport";

export type TreeNode = { name: string; path: string; dir: boolean; children: TreeNode[]; file?: DiffFile; add: number; del: number };

/** 파일 목록을 폴더 트리로. 폴더가 먼저, 이름순. 폴더에는 아래 파일의 추가·삭제 줄 수 합계 */
export function buildTree(files: readonly DiffFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", dir: true, children: [], add: 0, del: 0 };

  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let cur = root;

    parts.forEach((name, i) => {
      const last = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      let next = cur.children.find((c) => c.name === name && c.dir === !last);

      if (!next) {
        next = { name, path, dir: !last, children: [], add: 0, del: 0, ...(last ? { file: f } : {}) };
        cur.children.push(next);
      }
      next.add += f.add;
      next.del += f.del;
      cur = next;
    });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    n.children.forEach(sort);
  };

  sort(root);

  return root.children;
}

export type LineKind = "add" | "del" | "hunk" | "ctx";

export const diffLineKind = (line: string): LineKind => (line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx");

const LINE_CLASS: Record<LineKind, string> = {
  add: "bg-success-50 text-success-800 dark:bg-success-50/10 dark:text-success-500",
  del: "bg-danger-50 text-danger-800 dark:bg-danger-50/10 dark:text-danger-400",
  hunk: "bg-primary-50 text-primary-700 dark:bg-primary-50/10",
  ctx: "",
};
const STATUS_MARK: Record<string, string> = { A: "추가", M: "수정", D: "삭제" };
const SKIP_TEXT: Record<string, string> = { secret: "내용 숨김(키·비밀 파일)", binary: "바이너리 — 줄 수만", large: "큰 파일 — 요약만", budget: "전체 크기 한도 — 요약만" };

function Tree({ nodes, depth, selected, onSelect }: { nodes: TreeNode[]; depth: number; selected: string | null; onSelect: (path: string) => void }) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((n) => (
        <li key={n.path}>
          {n.dir ? (
            <>
              <div className="flex items-center gap-2 text-xs text-default-600" style={{ paddingLeft: depth * 12 }}>
                <span>📁 {n.name}/</span>
                <span className="font-mono text-success-700">+{n.add}</span>
                <span className="font-mono text-danger-700">-{n.del}</span>
              </div>
              <Tree depth={depth + 1} nodes={n.children} selected={selected} onSelect={onSelect} />
            </>
          ) : (
            <button
              className={`flex min-h-9 w-full items-center gap-2 rounded px-1 text-left text-xs hover:bg-default-100 ${selected === n.path ? "bg-default-100 font-medium" : ""}`}
              data-diff-file={n.path}
              style={{ paddingLeft: depth * 12 }}
              type="button"
              onClick={() => onSelect(n.path)}
            >
              <span className="break-all">
                {n.file?.skipped === "secret" ? "🔒" : "📄"} {n.name}
              </span>
              <span className="text-default-500">{STATUS_MARK[n.file?.status ?? "M"]}</span>
              <span className="ml-auto font-mono text-success-700">+{n.add}</span>
              <span className="font-mono text-danger-700">-{n.del}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function DiffBody({ file }: { file: DiffFile }) {
  if (file.skipped || !file.diff) {
    return (
      <p className="rounded bg-default-100 p-2 text-xs text-default-600" data-diff-note="">
        {file.skipped ? SKIP_TEXT[file.skipped] : "표시할 변경 내용이 없어요"} · +{file.add} −{file.del}
      </p>
    );
  }

  return (
    <div>
      <pre className="max-h-96 overflow-auto rounded border border-default-200 text-xs leading-snug" data-diff-body="">
        {file.diff.split("\n").map((line, i) => (
          <div key={i} className={`whitespace-pre px-2 ${LINE_CLASS[diffLineKind(line)]}`} data-diff-line={diffLineKind(line)}>
            {line || " "}
          </div>
        ))}
      </pre>
      {file.truncated && (
        <p className="mt-1 text-xs text-warning-700">
          파일이 커서 앞부분만 보여요. 전체 줄 수는 +{file.add} −{file.del}
        </p>
      )}
    </div>
  );
}

export default function DiffView({ value, initial = null }: { value: unknown; initial?: string | null }) {
  const report: DiffReport | null = useMemo(() => cleanDiffReport(value), [value]);
  const [selected, setSelected] = useState<string | null>(initial);

  if (!report || report.totalFiles === 0) return null;
  const tree = buildTree(report.files);
  const file = report.files.find((f) => f.path === selected) ?? null;

  return (
    <details className="rounded-lg border border-default-200 p-3 text-sm" data-diff-view="">
      <summary className="cursor-pointer font-semibold">
        🧾 변경 내용{" "}
        <span className="ml-1 font-mono text-xs font-normal">
          파일 {report.totalFiles}개 · <span className="text-success-700">+{report.totalAdd}</span> <span className="text-danger-700">-{report.totalDel}</span>
        </span>
        <span className="ml-2 text-xs font-normal text-default-500">(읽기 전용)</span>
      </summary>
      <div className="mt-3 space-y-3">
        <Tree depth={0} nodes={tree} selected={selected} onSelect={(p) => setSelected((cur) => (cur === p ? null : p))} />
        {report.moreFiles > 0 && <p className="text-xs text-default-500">파일이 많아 {report.moreFiles}개는 목록에서 뺐어요.</p>}
        {file ? <DiffBody file={file} /> : <p className="text-xs text-default-500">파일을 누르면 바뀐 내용을 볼 수 있어요.</p>}
      </div>
    </details>
  );
}
