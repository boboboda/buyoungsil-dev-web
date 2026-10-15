// components/admin/factory/AgentDefsPanel.tsx
// 통제실 [설정] 에이전트 정의 목록(읽기 전용). 에이전트 종류마다 엔진·작업 공간·허용 도구·훅·키 결정·끝난 뒤 처리를 한 줄 요약으로 보여 주고,
// 일감 종류별 흐름(블록 순서와 조건)도 같이 보여 준다. 서버에서 그린다. 못 읽어도 통제실은 뜬다.
import { readAgentsView, type AgentSummary, type AgentsView, type FlowSummary } from "@/lib/factory/agents";

const KEY_LABELS: Record<string, string> = {
  none: "키 없음",
  "job-required": "일감이 요청한 키만",
  "job-required+release-key": "일감 키 + 출시 키",
  "tool-method": "도구 방법이 정한 키(도구 호출 순간에만)",
};
const GATE_LABELS: Record<string, string> = { approval: "승인", "merge-check": "합치기 검사", verify: "필수 검증", deploy: "배포", report: "결과 보고" };
const COND_LABELS: Record<string, string> = {
  "same-app-pending>=2": "같은 앱에 승인된 수정이 2개 이상일 때",
  grouped: "같이 돌리기로 묶였을 때",
  "rebase-conflict": "합칠 때 다시 맞춰야 할 때",
  "cost-over-limit": "비용 한도를 넘을 때",
  "release-review-required": "출시 검토가 필요할 때",
};

function AgentRow({ a }: { a: AgentSummary }) {
  return (
    <li className="fx-panel min-w-0 p-3" data-agent-id={a.id} data-agent-migrated={a.migrated ? "yes" : "no"}>
      <details>
        <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="min-w-0 break-words font-semibold">
            <span className="font-mono">{a.id}</span> · {a.label}
          </span>
          <span className="min-w-0 break-words text-sm">
            {a.engines.join("·")} · {a.workspace}
            {a.readOnly ? <b> · 읽기 전용</b> : null}
            <span className="fx-muted">{a.migrated ? " · 정의로 실행" : " · 정의는 기록용(코드가 실행)"}</span>
          </span>
          <span className="w-full min-w-0 break-words text-sm fx-muted">{a.summary}</span>
        </summary>
        <dl className="mt-2 grid gap-1 text-sm">
          <div><dt className="fx-label inline">허용 도구</dt> <dd className="inline break-words font-mono">{a.tools.join(", ") || "없음"}</dd></div>
          {a.blockedTools.length ? <div><dt className="fx-label inline">막은 도구</dt> <dd className="inline break-words font-mono">{a.blockedTools.join(", ")}</dd></div> : null}
          <div><dt className="fx-label inline">네트워크</dt> <dd className="inline">{a.network}</dd></div>
          <div><dt className="fx-label inline">훅</dt> <dd className="inline font-mono">{a.hooks.join(", ") || "없음"}</dd></div>
          <div><dt className="fx-label inline">키</dt> <dd className="inline">{KEY_LABELS[a.keys] ?? a.keys}</dd></div>
          <div><dt className="fx-label inline">지시 틀</dt> <dd className="inline font-mono">{a.prompt}</dd></div>
          <div><dt className="fx-label inline">끝난 뒤</dt> <dd className="inline font-mono">{a.after.join(" → ") || "없음"}</dd></div>
          <div><dt className="fx-label inline">다음</dt> <dd className="inline font-mono">{a.next.join(", ") || "없음"}</dd></div>
        </dl>
      </details>
    </li>
  );
}

function FlowRow({ f }: { f: FlowSummary }) {
  return (
    <li className="min-w-0 break-words text-sm" data-flow-id={f.id}>
      <span className="font-semibold">{f.label}</span> <span className="font-mono fx-muted">({f.jobKind})</span>
      <span> : </span>
      {f.steps.map((s, i) => (
        <span key={s.id}>
          {i ? " → " : ""}
          <span data-flow-step={s.id}>
            {s.agent ? <span className="font-mono">{s.agent}</span> : null}
            {s.agent ? " " : ""}
            {s.label}
            {s.gate ? <span className="fx-muted"> [{GATE_LABELS[s.gate] ?? s.gate}]</span> : null}
            {s.optional ? <span className="fx-muted"> (선택{s.when ? `: ${COND_LABELS[s.when] ?? s.when}` : ""})</span> : s.when ? <span className="fx-muted"> ({COND_LABELS[s.when] ?? s.when})</span> : null}
            {s.variants.length ? <span className="fx-muted"> {s.variants.map((v) => `${COND_LABELS[v.when] ?? v.when} → ${v.agent}`).join(", ")}</span> : null}
          </span>
        </span>
      ))}
    </li>
  );
}

export function AgentDefsView({ view, failed = false }: { view: AgentsView; failed?: boolean }) {
  return (
    <section aria-label="에이전트 정의" className="fx-hud scroll-mt-24" id="agent-defs">
      <header className="fx-hud-head">
        <h2 className="fx-hud-title">agents · 에이전트 정의</h2>
        <span className="text-sm fx-muted">읽기 전용 · 정의 파일은 코드와 같이 커밋해서 바꿔요</span>
      </header>
      {failed || !view.agents.length ? (
        <p className="text-sm fx-muted" role="status">○ 확인 못 함 — 에이전트 정의를 읽지 못했어요. 다른 설정 패널은 그대로 쓸 수 있어요.</p>
      ) : (
        <>
          <p className="mb-2 break-words text-sm" data-agent-count={view.agents.length}>
            종류 <b>{view.agents.length}개</b> · 정의로 실행 {view.agents.filter((a) => a.migrated).length}개 · 기록용 {view.agents.filter((a) => !a.migrated).length}개
            <span className="fx-muted"> · 정의는 감독 훅·금지 규칙의 상한을 넓힐 수 없어요</span>
          </p>
          {view.errors.length ? (
            <div className="mb-2 text-sm" data-agent-errors={view.errors.length} role="alert">
              <b className="fx-bad">거절된 정의 {view.errors.length}건</b>
              <span className="fx-muted"> — 그 종류는 예전 코드 그대로 돌아요.</span>
              <ul className="mt-1 grid gap-0.5">
                {view.errors.map((e, i) => (
                  <li className="break-words" key={`${e.file}-${i}`}><span className="font-mono">{e.file}</span> · {e.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <ul className="grid gap-2">
            {view.agents.map((a) => (
              <AgentRow a={a} key={a.id} />
            ))}
          </ul>
          {view.flows.length ? (
            <div className="mt-3">
              <p className="fx-label">일감 종류별 흐름 (블록 순서와 조건)</p>
              <ul className="grid gap-1">
                {view.flows.map((f) => (
                  <FlowRow f={f} key={f.id} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export default function AgentDefsPanel() {
  try {
    return <AgentDefsView view={readAgentsView()} />;
  } catch {
    return <AgentDefsView failed view={{ agents: [], flows: [], errors: [] }} />;
  }
}
