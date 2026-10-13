// components/admin/factory/MemoryStatus.tsx
// 작업 메모리(.factory/memory/) 상태 한 줄씩(폴더별, 읽기 전용): 마지막 갱신 시각 · project.md 크기 · 서버2 푸시 결과.
// 감독 프로그램이 /next 로 알려 준 크기·시각·상태만 보여 준다(요약 본문은 오지 않는다).
import { MEMORY_PUSH_LABEL, parseMemoryReport } from "@/lib/factory/memory-report";

const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

export default function MemoryStatus({ report }: { report: string | null | undefined }) {
  const rows = parseMemoryReport(report);

  return (
    <div className="pt-1" data-memory-status>
      <div className="font-medium">🧠 작업 메모리(폴더별, 읽기 전용)</div>
      {rows.length ? (
        rows.map((m) => (
          <div key={m.folder} className="break-words text-xs">
            <span className="font-mono">{m.folder}</span> · 갱신 {when(m.updatedAt)} · project.md {m.kb}KB · {MEMORY_PUSH_LABEL[m.push]}
            {m.needsCompact && <span className="text-warning-600"> · ⚠ 요약 정리 필요(20KB 초과) — 정비 지시로 보내세요</span>}
          </div>
        ))
      ) : (
        <div className="text-xs text-default-500">아직 기록 없음 — 일감이 끝나면 생겨요.</div>
      )}
    </div>
  );
}
