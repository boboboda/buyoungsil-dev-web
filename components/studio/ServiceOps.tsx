// components/studio/ServiceOps.tsx
// 스튜디오 [운영] → 서비스 운영: 연결 상태 · 서비스 생성 일정(켜기·끄기·지금 실행) · 후보를 그림으로 보고 [승인]·[반려]·[다시] · 생성 기록 · 동작 기록.
// 관리자 세션이면 모두 쓸 수 있다(홈페이지 서버가 서비스 관리자 키로 대신 부른다. 키는 브라우저에 오지 않는다). 접근 키 사용자는 읽기 전용(버튼 없음).
// 서비스에 API 가 없으면(404) '서비스 API 없음'으로 보여 주고 버튼을 끈다. 쓰기 동작은 확인 창을 거치고, 누가 언제 했는지 아래 기록에 남는다.
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import ServiceStatusCard, { kstStamp } from "@/components/studio/ServiceStatus";
import type { OpsData } from "@/lib/studio/opsData";
import type { ReadResult, ServiceCandidate, ServiceLogItem, ServicePipeline } from "@/lib/studio/serviceOps";

const BTN = "fx-btn fx-btn-sm";
const FIELD = "mt-1 min-w-0 rounded border border-default-300 bg-transparent px-2 py-1 text-sm";
const STATUS_LABELS: Record<string, string> = { review: "검수", held: "보류", pending: "그림 대기" };
const KIND_LABELS: Record<string, string> = { request: "후보 요청", draw: "그림 만들기", weekly: "주간 채우기" };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });

    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const readText = <T,>(r: ReadResult<T> | null): string | null =>
  !r ? "확인하지 못했어요." : r.state === "ok" ? null : r.state === "no-api" ? "서비스 API 없음" : r.state === "need-key" ? `키 등록 필요: ${r.keyName}` : `확인 못 함 — ${r.reason}`;

export default function ServicePane({ data, canEdit }: { data: OpsData; canEdit: boolean }) {
  const router = useRouter();
  const v = data.service;
  const [pipeline, setPipeline] = useState<ReadResult<ServicePipeline> | null>(null);
  const [status, setStatus] = useState("review");
  const [cands, setCands] = useState<ReadResult<ServiceCandidate[]> | null>(null);
  const [log, setLog] = useState<ReadResult<ServiceLogItem[]> | null>(null);
  const [kind, setKind] = useState("request");
  const [lines, setLines] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const slug = data.appSlug;
  const apiMissing = v?.health?.api.state === "no-api";
  const keyReady = !!v?.adminKey.ready;
  const canAct = canEdit && keyReady && !apiMissing;
  const q = (what: string, extra = "") => `/api/studio/service?appSlug=${encodeURIComponent(slug)}&what=${what}${extra}`;

  const loadPipeline = useCallback(async () => setPipeline(await getJson<ReadResult<ServicePipeline>>(`/api/studio/service?appSlug=${encodeURIComponent(slug)}&what=pipeline`)), [slug]);
  const loadCands = useCallback(async (s: string) => setCands(await getJson<ReadResult<ServiceCandidate[]>>(`/api/studio/service?appSlug=${encodeURIComponent(slug)}&what=candidates&status=${s}`)), [slug]);

  useEffect(() => {
    if (!canAct) return;
    void loadPipeline();
    void loadCands("review");
  }, [canAct, loadPipeline, loadCands]);

  if (!v) return <p className="fx-panel p-3 text-sm fx-muted">연결된 서비스 정보가 없어요(이 프로젝트는 서비스 확인표가 아직 없어요).</p>;

  const write = async (body: Record<string, unknown>, ask: string) => {
    if (!window.confirm(ask)) return;
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch("/api/studio/service", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appSlug: slug, confirmed: true, ...body }) });
      const d = (await r.json().catch(() => ({}))) as { message?: string };

      setNotice(d.message ?? (r.ok ? "처리했어요." : "처리하지 못했어요."));
      if (r.ok) {
        void loadPipeline();
        void loadCands(status);
        router.refresh();
      }
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };
  const pl = pipeline?.state === "ok" ? pipeline.value : null;
  const off = busy || !canAct;

  return (
    <div className="space-y-3" data-ops-pane="service">
      <p className="fx-panel p-3 text-sm">
        <b>{v.name}</b> · {v.server} · 컨테이너 {v.container} · 서비스 주소 {v.baseLabel || "(없음)"}
        {v.baseProblem ? <span className="fx-st fx-st-warn ml-2 text-xs">{v.baseProblem}</span> : null}
        <span className="block text-xs fx-muted">서비스 코드·문서를 읽어 확인한 날: {v.checkedAt}. 서비스 DB는 건드리지 않고 API로만 다뤄요. {canEdit ? "관리자 로그인으로 모두 쓸 수 있어요(키는 홈페이지 서버가 대신 써요)." : "접근 키로 열어서 읽기 전용이에요."}</span>
      </p>

      <ServiceStatusCard appSlug={slug} canCheck={canEdit} health={v.health} />

      {!keyReady ? (
        <p className="fx-st fx-st-warn text-sm" data-service-key>
          관리자 키 <span className="font-mono text-xs">{v.adminKey.name}</span>: 키 등록 필요 — 통제실 키 등록에서 서버 보관 키로 등록하면 버튼이 켜져요(값은 화면에 나오지 않아요).
        </p>
      ) : (
        <p className="text-sm" data-service-key>
          관리자 키 <span className="font-mono text-xs">{v.adminKey.name}</span>: <span className="fx-st fx-st-ok">등록됨</span>
        </p>
      )}
      {apiMissing ? (
        <p className="fx-panel space-y-1 p-3 text-sm" data-service-noapi role="status">
          <span className="fx-st fx-st-warn">서비스 API 없음</span> 이 서비스에 <span className="font-mono text-xs">/api/admin/*</span> 가 아직 없어서 아래 버튼을 껐어요. 한 컷 앱에 API가 추가되면 자동으로 켜져요(제안: {v.proposal}).
        </p>
      ) : null}
      {notice ? (
        <p className="text-sm" data-ops-notice role="status">
          {notice}
        </p>
      ) : null}

      <section className="fx-panel space-y-2 p-3" data-service-pipeline>
        <h3 className="text-sm font-bold">서비스 생성 일정</h3>
        {readText(pipeline) && canAct ? <p className="text-sm fx-muted">{readText(pipeline)}</p> : null}
        {pl ? (
          <p className="text-sm">
            자동 실행 {pl.auto === null ? "?" : pl.auto ? <span className="fx-st fx-st-ok">켜짐</span> : <span className="fx-st fx-st-info">꺼짐</span>}
            {pl.weekly ? ` · ${pl.weekly}` : ""}
            {pl.running ? ` · 지금 실행 중: ${KIND_LABELS[pl.running.kind] ?? pl.running.kind}(${pl.running.by || "?"})` : ""}
          </p>
        ) : null}
        {v.ownSchedule ? <p className="text-xs fx-muted">서비스 자체 일정: {v.ownSchedule}</p> : null}
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2">
            <button className={BTN} data-service-write="schedule-on" disabled={off} type="button" onClick={() => write({ action: "schedule-on" }, "서비스의 자동 생성 일정을 켤까요? 서비스가 정해진 때 스스로 재고를 채워요.")}>
              일정 켜기
            </button>
            <button className={BTN} data-service-write="schedule-off" disabled={off} type="button" onClick={() => write({ action: "schedule-off" }, "서비스의 자동 생성 일정을 끌까요?")}>
              일정 끄기
            </button>
            <label className="text-xs fx-muted">
              지금 실행
              <select className={`${FIELD} block`} disabled={off} value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(KIND_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs fx-muted">
              줄 수(선택)
              <input className={`${FIELD} block w-20`} disabled={off} inputMode="numeric" value={lines} onChange={(e) => setLines(e.target.value)} />
            </label>
            <button className={BTN} data-service-write="run" disabled={off} type="button" onClick={() => write({ action: "run", kind, ...(lines ? { lines: Number(lines) } : {}) }, `서비스에서 '${KIND_LABELS[kind]}'을(를) 지금 실행할까요? 서비스 서버의 비용·시간이 들어요.`)}>
              지금 실행
            </button>
          </div>
        ) : null}
      </section>

      <section className="fx-panel space-y-2 p-3" data-service-candidates>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold">서비스 후보 검수</h3>
          <select
            aria-label="후보 상태"
            className={FIELD}
            disabled={!canAct}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              void loadCands(e.target.value);
            }}
          >
            {Object.entries(STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <button className={BTN} disabled={!canAct} type="button" onClick={() => void loadCands(status)}>
            새로 불러오기
          </button>
        </div>
        {v.reviewCount?.state === "ok" ? (
          <p className="text-xs fx-muted">
            서비스 집계: 검수 {v.reviewCount.review}장 · 보류 {v.reviewCount.held}장 · 그림 대기 {v.reviewCount.pending}장
          </p>
        ) : null}
        {!canAct ? <p className="text-sm fx-muted">{!canEdit ? "접근 키로는 후보를 볼 수 없어요(관리자 로그인 필요)." : apiMissing ? "서비스 API 없음" : "키 등록 필요"}</p> : null}
        {canAct && readText(cands) ? <p className="text-sm fx-muted">{readText(cands)}</p> : null}
        {cands?.state === "ok" && !cands.value.length ? <p className="text-sm fx-muted">{STATUS_LABELS[status]} 상태의 후보가 없어요.</p> : null}
        {cands?.state === "ok" && cands.value.length ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-service-cand-list>
            {cands.value.map((c) => (
              <li key={c.id} className="fx-panel min-w-0 space-y-1 p-2" data-service-cand={c.id}>
                <div className="flex min-h-[96px] items-center justify-center overflow-hidden rounded bg-default-100 p-1">
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt={c.line || c.id} className="max-h-40 max-w-full" loading="lazy" referrerPolicy="no-referrer" src={c.imageUrl} />
                  ) : (
                    <span className="text-xs fx-muted">그림 없음</span>
                  )}
                </div>
                <p className="break-words text-sm">{c.line || "(문장 없음)"}</p>
                <p className="text-xs fx-muted">
                  {STATUS_LABELS[c.status] ?? c.status}
                  {c.days !== null ? ` · ${c.days}일째` : ""}
                </p>
                <span className="flex flex-wrap gap-1">
                  <button className={BTN} data-service-write="approve" disabled={off} type="button" onClick={() => write({ action: "approve", id: c.id }, `이 후보를 승인할까요?\n${c.line}`)}>
                    승인
                  </button>
                  <button className={BTN} data-service-write="reject" disabled={off} type="button" onClick={() => write({ action: "reject", id: c.id }, `이 후보를 반려할까요?\n${c.line}`)}>
                    반려
                  </button>
                  <button className={BTN} data-service-write="retry" disabled={off} type="button" onClick={() => write({ action: "retry", id: c.id }, `이 후보를 다시 만들까요? 서비스 서버의 비용·시간이 들어요.\n${c.line}`)}>
                    다시
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="fx-panel space-y-2 p-3" data-service-genlog>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold">서비스 생성 기록</h3>
          <button className={BTN} disabled={!canAct} type="button" onClick={async () => setLog(await getJson<ReadResult<ServiceLogItem[]>>(q("gen-log")))}>
            불러오기
          </button>
        </div>
        {canAct && readText(log) ? <p className="text-sm fx-muted">{readText(log)}</p> : null}
        {log?.state === "ok" ? (
          <ul className="max-h-64 space-y-0.5 overflow-y-auto text-xs" data-service-genlog-list>
            {log.value.map((l, i) => (
              <li key={`${l.id}:${i}`}>
                <span className="font-mono">{l.at.slice(0, 16).replace("T", " ")}</span> <span className={l.ok ? "fx-ok" : "fx-bad"}>{l.ok ? "성공" : "실패"}</span> {l.step} {l.cutId ? `· ${l.cutId}` : ""} {l.detail ? `— ${l.detail}` : ""}
              </li>
            ))}
            {!log.value.length ? <li className="fx-muted">기록이 없어요.</li> : null}
          </ul>
        ) : null}
      </section>

      <section className="fx-panel space-y-1 p-3" data-service-upload>
        <h3 className="text-sm font-bold">서비스 업로드(그림 받기)</h3>
        <p className="text-xs fx-muted">승인 그림을 서비스로 보내는 일은 [내보내기] 탭에서 해요(보낼 곳이 &apos;서비스 업로드&apos;일 때). 서비스에 /api/admin/art-upload 가 없으면 &apos;서비스 업로드 미지원&apos;으로 기록만 남아요.</p>
      </section>

      <section className="fx-panel space-y-1 p-3" data-service-actions>
        <h3 className="text-sm font-bold">동작 기록 (누가 언제)</h3>
        {data.serviceActions.length ? (
          <ul className="space-y-0.5 text-xs">
            {data.serviceActions.map((a) => (
              <li key={a.id} data-service-action={a.action}>
                <span className="font-mono">{kstStamp(a.at)}</span> <b>{a.who}</b> · {a.label}
                {a.target ? ` (${a.target})` : ""} · <span className={a.ok ? "fx-ok" : "fx-bad"}>{a.ok ? "성공" : "실패"}</span>
                <span className="block fx-muted">{a.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs fx-muted">아직 기록이 없어요.</p>
        )}
      </section>
    </div>
  );
}
