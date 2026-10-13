// components/admin/factory/HandoffBox.tsx
// 일감 상세·정비 대화의 '인계 기록' 접이식 칸(읽기 전용). Claude Code ↔ Codex 가 이어받을 때 읽는 마지막 기록을 사람도 본다.
// 감독 프로그램이 보낸 항목을 서버가 정리해 저장한 것(lib/factory/handoff.ts)이라 비밀값·기획서·diff 가 없다.
import { Chip } from "@heroui/react";

import type { HandoffEntry, HandoffFiles } from "@/lib/factory/handoff";
import { MEMORY_PUSH_LABEL } from "@/lib/factory/memory-report";

const STATUS: Record<string, { label: string; color: "success" | "danger" | "warning" }> = {
  done: { label: "완료", color: "success" },
  failed: { label: "실패", color: "danger" },
  interrupted: { label: "중단", color: "warning" },
};
const KIND: Record<string, string> = { maintenance: "정비", job: "앱 일감", terminal: "터미널" };
const CHECK_COLOR = { 통과: "success", 실패: "danger", 건너뜀: "default" } as const;

const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
const fileLine = (f: HandoffFiles | null | undefined) => (f?.list?.length ? `${f.list.join(", ")}${f.more ? ` 외 ${f.more}개` : ""}` : "없음");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-0.5">
      <span className="text-default-500">{label}</span>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export default function HandoffBox({ entry }: { entry: HandoffEntry | null | undefined }) {
  if (!entry || typeof entry !== "object") return null;
  const st = STATUS[entry.status] ?? STATUS.failed;

  return (
    <details className="rounded-lg border border-default-200 p-3 text-sm" data-handoff>
      <summary className="cursor-pointer select-none font-semibold">
        📋 인계 기록 <span className="ml-1 text-xs font-normal text-default-500">(다음 AI가 읽어요 · 읽기 전용)</span>
      </summary>
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-default-500">
          <Chip color={st.color} size="sm" variant="flat">
            {st.label}
          </Chip>
          <span>{KIND[entry.kind] ?? entry.kind}</span>
          <span>{entry.engine === "codex" ? "Codex" : "Claude Code"}</span>
          <span className="font-mono">{entry.model}</span>
          <span className="font-mono">{when(entry.at)}</span>
        </div>
        {!entry.hasAiBlock && (
          <p className="rounded bg-warning-50 p-2 text-xs text-warning-700 dark:bg-warning-50/10" data-handoff-missing>
            인계 요약 없음 — AI가 &apos;## 인계&apos; 블록을 쓰지 않아 감독 프로그램이 기록한 사실만 남았어요.
          </p>
        )}
        {entry.memory?.current && (
          <div className="rounded bg-default-100 p-2 text-xs" data-memory-current>
            <div className="mb-1 font-semibold">🧠 현재 일감 요약 (다음 AI가 먼저 읽는 current.md)</div>
            <pre className="whitespace-pre-wrap break-words font-sans">{entry.memory.current}</pre>
            <div className="mt-1 text-default-500">
              project.md {Math.ceil(entry.memory.projectBytes / 1024)}KB · {MEMORY_PUSH_LABEL[entry.memory.push]}
              {entry.memory.error ? ` (${entry.memory.error})` : ""}
              {entry.memory.needsCompact ? " · ⚠ 요약 정리 필요(20KB 초과) — 정비 지시로 오래된 섹션을 줄이게 하세요" : ""}
            </div>
          </div>
        )}
        <Row label="요청">{entry.request || "-"}</Row>
        {entry.doneWhen && <Row label="완료 조건">{entry.doneWhen}</Row>}
        {entry.done && <Row label="한 일">{entry.done}</Row>}
        <Row label="커밋한 파일">{fileLine(entry.files?.committed)}</Row>
        <Row label="커밋 안 된 파일">{fileLine(entry.files?.uncommitted)}</Row>
        <Row label="검사">
          {entry.checks?.length ? (
            <ul className="space-y-0.5">
              {entry.checks.map((c, i) => (
                <li key={`${c.name}-${i}`} className="flex flex-wrap items-center gap-1">
                  <Chip color={CHECK_COLOR[c.result] ?? "default"} size="sm" variant="flat">
                    {c.result}
                  </Chip>
                  <span>{c.name}</span>
                  {c.detail && <span className="text-xs text-default-500">{c.detail}</span>}
                </li>
              ))}
            </ul>
          ) : (
            "기록된 검사 없음"
          )}
        </Row>
        {entry.failReason && <Row label="실패 사유">{entry.failReason}</Row>}
        {entry.remaining && <Row label="남은 작업">{entry.remaining}</Row>}
        {entry.caution && <Row label="주의">{entry.caution}</Row>}
        <Row label="Git">
          <span className="font-mono text-xs">
            {entry.git?.branch ?? "?"}@{(entry.git?.head ?? "").slice(0, 7) || "?"}
          </span>{" "}
          · 커밋 안 된 변경 {entry.git?.dirty ? "있음" : "없음"}
        </Row>
      </div>
    </details>
  );
}
