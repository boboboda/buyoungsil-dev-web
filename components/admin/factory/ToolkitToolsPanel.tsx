// components/admin/factory/ToolkitToolsPanel.tsx
// 통제실 [설정] 도구함 맨 위 '도구 목록'(도구별 한 줄 + 최근 30일 사용 횟수). 작업 PC 의 game-toolkit/tools.json 을 감독 프로그램이 읽어 보낸 값(도구는 실행하지 않음).
// 도구마다 한 줄 요약 + 펼치면 실행 명령·설명·입출력·스크립트 위치·파이썬 맨 위 설명·옵션·수정일, 용도 칸(추정 표시, 관리자가 바꿔 저장).
// 서버에서 그린다(펼침은 <details>, 용도 고르기만 클라이언트 조각). 못 읽어도 통제실은 뜬다.
import prisma from "@/lib/prisma";
import { readToolkitView, PURPOSE_LABELS, guessPurpose, type ToolkitRow, type ToolkitView } from "@/lib/factory/toolkit";
import { readCommandUsage, TOOLBOX_USAGE_DAYS, type ToolUsage } from "@/lib/factory/toolbox";
import ToolkitPurposeSelect from "./ToolkitPurposeSelect";

// 최근 N일 사용 칸. usage: undefined = 보고 없음(칸 숨김), null = 기록을 못 읽음
function usageLine(usage: Record<string, ToolUsage> | null | undefined, id: string): string | null {
  if (usage === undefined) return null;
  if (usage === null) return `최근 ${TOOLBOX_USAGE_DAYS}일: 확인 못 함`;
  const u = usage[id];

  return u && u.total > 0 ? `최근 ${TOOLBOX_USAGE_DAYS}일 ${u.total}회 (성공 ${u.ok} · 거절 ${u.denied} · 실패 ${u.failed})` : "기록 없음";
}

function Row({ row, usage }: { row: ToolkitRow; usage?: Record<string, ToolUsage> | null }) {
  const used = usageLine(usage, row.id);

  return (
    <li className="fx-panel min-w-0 p-3" data-toolkit-tool={row.id}>
      <details>
        <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="min-w-0 break-all font-mono font-semibold">{row.id}</span>
          <span className="min-w-0 break-words text-sm" data-purpose-label={row.purpose}>
            {PURPOSE_LABELS[row.purpose]}
            <span className="fx-muted">{row.purposeSource === "guess" ? " (추정)" : ""}</span>
            {row.enabled ? null : <span className="fx-bad"> · 꺼짐</span>}
          </span>
          <span className="w-full min-w-0 break-words text-sm">{row.desc || "설명 없음"}</span>
          <span className="w-full min-w-0 break-words text-sm fx-muted">
            입력 → 출력: {row.input} → {row.output}
          </span>
          {used ? (
            <span className="w-full font-mono text-sm fx-muted" data-tool-usage={row.id}>
              {used}
            </span>
          ) : null}
        </summary>
        <dl className="mt-2 grid gap-1 break-words text-sm">
          <div>
            <dt className="fx-label">설명</dt>
            <dd>{row.desc || "설명 없음"}</dd>
          </div>
          <div>
            <dt className="fx-label">실행 명령</dt>
            <dd className="break-all font-mono">{row.command}</dd>
            <dd className="fx-muted">
              toolkit.run 의 command 는 {row.id} · {row.net ? "인터넷 사용" : "인터넷 안 씀"} · 제한 {row.timeoutSec || "?"}초{row.secrets.length ? ` · 필요한 키 이름: ${row.secrets.join(", ")}` : ""}
            </dd>
          </div>
          <div>
            <dt className="fx-label">입력 / 출력</dt>
            <dd className="break-all">입력: {row.input}</dd>
            <dd className="break-words">출력: {row.output}</dd>
            {row.argsMore ? <dd className="fx-muted">(인자 {row.argsMore}개는 크기 때문에 줄였어요)</dd> : null}
          </div>
          <div>
            <dt className="fx-label">스크립트</dt>
            <dd className="break-all font-mono">
              {row.script || "?"} <span className="fx-muted">· 폴더 {row.dir || "?"} · 진입 {row.entry || "?"} · 수정 {row.modified || "?"}</span>
            </dd>
            {row.doc ? <dd className="fx-muted">맨 위 설명: {row.doc}</dd> : null}
            {row.opts.length ? <dd className="break-all font-mono fx-muted">옵션: {row.opts.map((o) => `--${o}`).join(" ")}</dd> : null}
          </div>
        </dl>
        <div className="mt-2">
          <ToolkitPurposeSelect guess={guessPurpose(row)} id={row.id} purpose={row.purpose} source={row.purposeSource} />
        </div>
      </details>
    </li>
  );
}

export function ToolkitToolsView({ view, usage }: { view: ToolkitView; usage?: Record<string, ToolUsage> | null }) {
  const info = view.info;
  const counts = view.rows.reduce<Record<string, number>>((n, r) => ({ ...n, [r.purpose]: (n[r.purpose] ?? 0) + 1 }), {});

  return (
    <section aria-label="도구 목록" className="fx-hud scroll-mt-24" id="toolkit-tools">
      <header className="fx-hud-head">
        <h2 className="fx-hud-title">toolkit · 도구 목록</h2>
        <span className="text-sm fx-muted">목록은 읽기 전용 · 용도만 바꿔 저장</span>
      </header>

      {view.failed ? (
        <p className="text-sm fx-muted" role="status">
          ○ 확인 못 함 — 툴킷 도구 정보를 읽지 못했어요. 다른 설정 패널은 그대로 쓸 수 있어요.
        </p>
      ) : !info ? (
        <p className="text-sm fx-muted" role="status">
          ○ 아직 못 받았어요 — 감독 프로그램이 새 버전으로 켜지면 몇 분 안에 도구 목록을 보내요.
        </p>
      ) : info.state !== "ok" ? (
        <p className="text-sm fx-muted" role="status">
          ○ {info.state === "missing" ? "작업 PC 에 game-toolkit/tools.json 이 없어요." : `tools.json 을 읽지 못했어요${info.reason ? `: ${info.reason}` : ""}`}
        </p>
      ) : (
        <>
          <p className="mb-2 break-words text-sm" data-toolkit-count={info.count}>
            보고된 도구 <b>{info.count}개</b>
            {info.omitted ? <span className="fx-bad"> (크기 때문에 {info.omitted}개는 생략)</span> : null}
            <span className="fx-muted">
              {" "}
              · {(["game", "cut", "common", "unclassified"] as const).map((p) => `${PURPOSE_LABELS[p]} ${counts[p] ?? 0}`).join(" · ")} · tools.json 수정 {info.manifestModified || "?"} · 받은 시각 {info.receivedAt.slice(0, 16).replace("T", " ")}(UTC)
            </span>
          </p>
          <ul className="grid gap-2">
            {view.rows.map((r) => (
              <Row key={r.id} row={r} usage={usage} />
            ))}
          </ul>
          {usage && usage["?"] ? (
            <p className="mt-2 break-words text-sm fx-muted" data-tool-usage="?">
              미상(명령 이름이 기록되기 전의 toolkit.run): 최근 {TOOLBOX_USAGE_DAYS}일 {usage["?"].total}회 (성공 {usage["?"].ok} · 거절 {usage["?"].denied} · 실패 {usage["?"].failed})
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export default async function ToolkitToolsPanel() {
  const [view, usage] = await Promise.all([readToolkitView(prisma), readCommandUsage(prisma)]);

  return <ToolkitToolsView usage={usage} view={view} />;
}
