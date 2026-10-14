// components/studio/MakeTab.tsx
// /studio/<앱> 의 [제작] 탭: 카드 골라 생성 · 진행 상태(5초마다 새로 고침) · 결과 미리보기(정수배 확대, 라이트박스) · [배치] 하위 탭(공용 배치 편집기, 3-4).
// 자료는 서버가 props 로 준다(lib/studio/makeData.ts). [생성]은 /api/studio/make(관리자만)로 도구 일감을 등록한다. 관리자가 아니면(접근 키) 읽기 전용: 입력칸이 없다.
// 비용 한도를 넘으면 서버가 409 로 확인을 요구하고, 확인하면 같은 요청을 confirmed 로 다시 보낸다. 키 값은 이 화면에 오지 않는다.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { applySuggestion, countByGroup, estimateCost, isActiveStatus, MAKE_LIMITS, MAKE_REFRESH_MS, makeInputError, parseSubjects, pixelScale, subjectSuggestions, type MakeArt, type MakeJob } from "@/lib/studio/make";
import type { MakeData } from "@/lib/studio/makeData";
import type { LayoutData } from "@/lib/studio/layoutData";
import LayoutEditor from "@/components/studio/LayoutEditor";

const FIELD = "mt-1 w-full min-w-0 rounded border border-default-300 bg-transparent px-2 py-1 text-sm";
const PIXELATED = { imageRendering: "pixelated" } as const;
const ART_BOX = 192; // 결과 그림 칸(정수배로 키울 상자)

interface Confirm {
  reason: string;
  estimatedCost: number;
}

/** 도트 그림을 정수배로 키워서 보여 준다(뭉개지지 않게). 크기를 알기 전에는 칸 안에 맞춰 둔다 */
export function PixelImg({ src, alt, box, className, dataAttr }: { src: string; alt: string; box: number; className?: string; dataAttr?: string }) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const ref = useRef<HTMLImageElement>(null);
  const scale = nat ? pixelScale(nat.w, nat.h, box, box) : 1;

  // 그림이 화면이 붙기 전에 이미 받아졌으면 onLoad 가 오지 않으므로 한 번 직접 읽는다
  useEffect(() => {
    const img = ref.current;

    if (img?.complete && img.naturalWidth > 0) setNat({ w: img.naturalWidth, h: img.naturalHeight });
  }, [src]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      alt={alt}
      className={className}
      data-pixel-img={dataAttr ?? ""}
      data-pixel-scale={nat ? scale : undefined}
      loading="lazy"
      src={src}
      style={{ ...PIXELATED, ...(nat ? { width: nat.w * scale, height: nat.h * scale } : { maxWidth: box, maxHeight: box }) }}
      onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
    />
  );
}

function Lightbox({ art, onClose }: { art: MakeArt; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div aria-label={`${art.subject} 크게 보기`} aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" data-make-lightbox role="dialog">
      <button aria-label="닫기" className="absolute inset-0 cursor-default" data-make-lightbox-backdrop tabIndex={-1} type="button" onClick={onClose} />
      <div className="relative flex max-h-full max-w-full flex-col items-center gap-2 overflow-auto">
        <PixelImg alt={art.subject} box={Math.max(256, Math.min(typeof window === "undefined" ? 640 : window.innerWidth - 48, typeof window === "undefined" ? 640 : window.innerHeight - 140))} className="rounded border border-white/40 bg-neutral-700" dataAttr="lightbox" src={art.url} />
        <p className="text-sm text-white">
          {art.subject} · {art.cardName || "카드 없음"}
          {art.cardVersion ? ` (판 ${art.cardVersion})` : ""}
        </p>
        <button className="rounded bg-white px-3 py-1 text-sm text-black" data-make-lightbox-close type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

function JobItem({ job, appSlug, onOpen }: { job: MakeJob; appSlug: string; onOpen: (a: MakeArt) => void }) {
  const showArts = job.arts.length > 0;

  return (
    <li className="space-y-2 rounded border border-default-200 p-2" data-make-job={job.id} data-make-job-status={job.status}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-medium">{job.title}</span>
        <span className={`fx-st ${job.group === "failed" ? "fx-st-bad" : job.group === "done" ? "fx-st-ok" : job.group === "confirm" ? "fx-st-warn" : "fx-st-info"}`} data-make-status>
          {job.statusLabel}
        </span>
        {job.cost !== null && job.group === "done" ? <span className="text-xs fx-muted">비용 {job.cost}회</span> : job.estimatedCost > 0 ? <span className="text-xs fx-muted">예상 비용 {job.estimatedCost}회</span> : null}
      </div>
      {job.progress ? (
        <p className="text-xs fx-muted" data-make-progress>
          {job.group === "run" ? "▶ " : ""}
          {job.progress}
        </p>
      ) : null}
      {job.failReason ? <p className="text-xs fx-muted">{job.failReason}</p> : null}
      {job.pickedRefs.length ? (
        <p className="flex flex-wrap items-center gap-1 text-xs fx-muted" data-make-picked>
          직접 고른 참고 그림
          {job.pickedRefs.map((r) => (
            <PixelImg key={r.id} alt={`참고 ${r.subject}`} box={32} className="rounded border border-default-300" src={r.url} />
          ))}
        </p>
      ) : null}
      {showArts ? (
        <ul className="flex flex-wrap gap-3" data-make-arts>
          {job.arts.map((a) => (
            <li key={a.id} className="w-fit max-w-full space-y-1" data-make-art={a.id}>
              <button aria-label={`${a.subject} 크게 보기`} className="block rounded border border-default-300 bg-default-100 p-1" data-make-art-open type="button" onClick={() => onOpen(a)}>
                <PixelImg alt={a.subject} box={ART_BOX} dataAttr="thumb" src={a.url} />
              </button>
              <p className="text-xs" data-make-art-meta>
                <span className="font-medium">{a.subject}</span> · {a.cardName || "카드 없음"}
                {a.cardVersion ? ` · 판 ${a.cardVersion}` : ""}
              </p>
              {a.refs.length || a.refsFallback ? (
                <p className="max-w-[16rem] break-words text-xs fx-muted" data-make-art-refs>
                  참고: {a.refs.length ? a.refs.slice(0, 3).join(" · ") : a.refsFallback}
                </p>
              ) : (
                <p className="text-xs fx-muted">참고 그림 없음</p>
              )}
              <Link className="text-xs underline" data-make-review-link href={`/studio/${appSlug}?tab=ops&sub=review&art=${encodeURIComponent(a.id)}`}>
                운영에서 검수
              </Link>
            </li>
          ))}
        </ul>
      ) : job.status === "done" ? (
        <p className="text-xs fx-muted">만든 그림이 없어요{job.progress ? "" : "."}</p>
      ) : null}
    </li>
  );
}

export default function MakeTab({ data, canEdit, showBatch, sub, layout }: { data: MakeData; canEdit: boolean; showBatch: boolean; sub?: string; layout?: LayoutData | null }) {
  const router = useRouter();
  const [cardId, setCardId] = useState(data.cards[0]?.id ?? "");
  const [subjectText, setSubjectText] = useState("");
  const [count, setCount] = useState("1");
  const [extra, setExtra] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  const [showRefs, setShowRefs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [lightbox, setLightbox] = useState<MakeArt | null>(null);

  const batchOn = showBatch && sub === "batch";
  const card = data.cards.find((c) => c.id === cardId) ?? null;
  const subjects = useMemo(() => parseSubjects(subjectText), [subjectText]);
  const countNum = Number(count);
  const suggestions = useMemo(() => subjectSuggestions(subjectText, data.names), [subjectText, data.names]);
  const inputError = makeInputError({ cardId, subjects, count: countNum, extra, refs: refs.length });
  const estimate = card ? estimateCost(card.perCall, Number.isInteger(countNum) ? countNum : 0, subjects.length) : 0;
  const counts = countByGroup(data.jobs);
  const active = data.jobs.some((j) => isActiveStatus(j.status));

  // 5초마다 서버 자료를 다시 받는다(탭이 보일 때만). 입력 중인 칸은 그대로 둔다
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, MAKE_REFRESH_MS);

    return () => clearInterval(t);
  }, [router]);

  const submit = async (confirmed: boolean) => {
    if (inputError) return;
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch("/api/studio/make", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appSlug: data.appSlug, card: cardId, subjects, count: countNum, extra, refArtIds: refs, confirmed }),
      });
      const d = (await r.json().catch(() => ({}))) as { message?: string; needsConfirm?: { reason: string; estimatedCost: number } };

      if (r.status === 409 && d.needsConfirm) {
        setConfirm({ reason: d.needsConfirm.reason, estimatedCost: d.needsConfirm.estimatedCost });
        setNotice("");
      } else {
        setConfirm(null);
        setNotice(d.message ?? (r.ok ? "일감을 등록했어요." : "등록하지 못했어요."));
        if (r.ok) {
          setSubjectText("");
          setExtra("");
          setRefs([]);
          router.refresh();
        }
      }
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
  };

  const toggleRef = (id: string) => setRefs((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAKE_LIMITS.refs ? cur : [...cur, id]));

  return (
    <div className="min-w-0 space-y-3" data-make-tab>
      {showBatch ? (
        <ul aria-label="제작 하위 탭" className="flex gap-2" data-make-subtabs>
          {[
            { key: "generate", label: "생성" },
            { key: "batch", label: "배치" },
          ].map((s) => (
            <li key={s.key}>
              <Link
                aria-current={(s.key === "batch") === batchOn ? "page" : undefined}
                className={`rounded border px-3 py-1 text-sm ${(s.key === "batch") === batchOn ? "border-default-700 font-bold" : "border-default-300"}`}
                data-make-subtab={s.key}
                href={`/studio/${data.appSlug}?tab=make${s.key === "batch" ? "&sub=batch" : ""}`}
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {batchOn ? (
        layout ? (
          <LayoutEditor canEdit={canEdit} data={layout} />
        ) : (
          <section className="fx-panel space-y-1 p-4" data-make-batch-slot>
            <h2 className="fx-label">배치</h2>
            <p className="text-sm fx-muted" data-layout-failed>○ 확인 못 함 — 배치 자료를 읽지 못했어요. 잠시 뒤 다시 열어 주세요.</p>
          </section>
        )
      ) : (
        <>
          <section className="fx-panel min-w-0 space-y-3 p-3 sm:p-4" data-make-form>
            <h2 className="fx-label">카드 골라 생성</h2>
            {!data.cards.length ? (
              <p className="text-sm fx-muted" data-make-no-cards>
                쓸 수 있는 카드가 없어요. [구성] 탭에서 카드를 만들거나 켜 주세요.
              </p>
            ) : (
              <>
                <div aria-label="카드" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup">
                  {data.cards.map((c) => (
                    <button
                      key={c.id}
                      aria-checked={c.id === cardId}
                      className={`min-w-0 rounded border p-2 text-left text-sm ${c.id === cardId ? "border-default-700 bg-default-100" : "border-default-300"}`}
                      data-make-card={c.id}
                      disabled={!canEdit}
                      role="radio"
                      type="button"
                      onClick={() => setCardId(c.id)}
                    >
                      <span className="block break-words font-semibold">{c.name}</span>
                      <span className="block text-xs fx-muted">
                        판 {c.version} · {c.tool}
                        {c.method ? ` · ${c.method}` : ""} · {c.perCall > 0 ? `장당 ${c.perCall}회` : "비용 없음"}
                      </span>
                      {c.warnings.length ? <span className="block text-xs fx-muted">⚠ {c.warnings[0]}</span> : null}
                    </button>
                  ))}
                </div>

                {canEdit ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-4">
                      <label className="relative text-sm sm:col-span-3">
                        대상 이름 (쉼표로 여러 개, 별칭은 대표 이름으로 묶여요)
                        <input autoComplete="off" className={FIELD} data-make-field="subject" placeholder="예: 싹이" type="text" value={subjectText} onChange={(e) => setSubjectText(e.target.value)} />
                        {suggestions.length ? (
                          <span className="mt-1 flex flex-wrap gap-1" data-make-suggestions>
                            {suggestions.map((n) => (
                              <button key={n} className="rounded border border-default-300 px-2 py-0.5 text-xs" data-make-suggestion={n} type="button" onClick={() => setSubjectText(applySuggestion(subjectText, n))}>
                                {n}
                              </button>
                            ))}
                          </span>
                        ) : null}
                      </label>
                      <label className="text-sm">
                        장 수 (대상마다)
                        <input className={FIELD} data-make-field="count" max={MAKE_LIMITS.count} min={1} type="number" value={count} onChange={(e) => setCount(e.target.value)} />
                      </label>
                    </div>
                    <label className="block text-sm">
                      추가 지시 (선택)
                      <input className={FIELD} data-make-field="extra" maxLength={MAKE_LIMITS.extra} type="text" value={extra} onChange={(e) => setExtra(e.target.value)} />
                    </label>
                    <div className="space-y-1">
                      <button aria-expanded={showRefs} className="rounded border border-default-300 px-2 py-1 text-sm" data-make-refs-toggle type="button" onClick={() => setShowRefs((v) => !v)}>
                        참고 그림 직접 고르기 (선택{refs.length ? `, ${refs.length}장` : ""})
                      </button>
                      {showRefs ? (
                        data.approved.length ? (
                          <ul className="flex flex-wrap gap-2" data-make-refs>
                            {data.approved.slice(0, 60).map((a) => (
                              <li key={a.id}>
                                <button
                                  aria-pressed={refs.includes(a.id)}
                                  className={`rounded border p-1 ${refs.includes(a.id) ? "border-default-700 bg-default-100" : "border-default-300"}`}
                                  data-make-ref={a.id}
                                  title={a.subject}
                                  type="button"
                                  onClick={() => toggleRef(a.id)}
                                >
                                  <PixelImg alt={a.subject} box={48} src={a.url} />
                                  <span className="block max-w-[3.5rem] truncate text-[10px]">{a.subject}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs fx-muted">승인된 그림이 아직 없어요. 비워 두면 카드의 참고 규칙대로 골라요.</p>
                        )
                      ) : null}
                      <p className="text-xs fx-muted">안 고르면 카드의 참고 규칙이 알아서 골라요. 최대 {MAKE_LIMITS.refs}장.</p>
                    </div>

                    <p className="text-sm" data-make-estimate>
                      {card ? `예상 비용 ${estimate}회 (${subjects.length}개 × ${Number.isInteger(countNum) ? countNum : 0}장)` : ""} · 오늘 {data.usage.day}회
                      {data.limits.dailyLimit ? `/${data.limits.dailyLimit}` : ""} · 이번 달 {data.usage.month}회{data.limits.monthlyLimit ? `/${data.limits.monthlyLimit}` : ""}
                      <span className="block text-xs fx-muted">{data.limits.autoApprove ? `예상 비용 ${data.limits.autoApproveMaxCost}회 이하이고 한도 안이면 자동 승인돼요.` : "등록하면 승인 대기예요(통제실·텔레그램에서 승인)."}</span>
                    </p>

                    {confirm ? (
                      <div className="space-y-2 rounded border border-default-700 p-2" data-make-confirm role="alertdialog">
                        <p className="text-sm font-semibold">비용 한도를 넘어요</p>
                        <p className="text-sm">{confirm.reason}</p>
                        <p className="text-xs fx-muted">그대로 진행하면 이 일감은 한도 검사를 건너뛰어요. 승인 규칙은 그대로라 승인은 따로 필요해요.</p>
                        <div className="flex gap-2">
                          <button className="rounded bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-50" data-make-confirm-yes disabled={busy} type="button" onClick={() => void submit(true)}>
                            그대로 진행
                          </button>
                          <button className="rounded border border-default-300 px-3 py-1.5 text-sm" data-make-confirm-no type="button" onClick={() => setConfirm(null)}>
                            취소
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <button className="rounded bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-50" data-make-create disabled={busy || !!inputError} type="button" onClick={() => void submit(false)}>
                          생성
                        </button>
                        {inputError && (subjects.length || cardId) ? <span className="text-xs fx-muted" data-make-input-error>{inputError}</span> : null}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs fx-muted" data-make-readonly>
                    접근 키로는 읽기 전용이에요. 생성은 관리자 로그인에서 할 수 있어요.
                  </p>
                )}
                {notice ? (
                  <p className="text-sm fx-muted" data-make-notice role="status">
                    {notice}
                  </p>
                ) : null}
              </>
            )}
          </section>

          <section className="fx-panel min-w-0 space-y-2 p-3 sm:p-4" data-make-jobs>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="fx-label">진행 상태</h2>
              <span className="text-xs fx-muted" data-make-counts>
                대기 {counts.wait} · 진행 {counts.run} · 완료 {counts.done} · 실패 {counts.failed} · 확인 필요 {counts.confirm}
              </span>
              <span className="text-xs fx-muted">{active ? `${MAKE_REFRESH_MS / 1000}초마다 새로 고쳐요` : "끝난 일감만 있어요"}</span>
            </div>
            {data.jobs.length ? (
              <ul className="space-y-2" data-make-job-list>
                {data.jobs.map((j) => (
                  <JobItem key={j.id} appSlug={data.appSlug} job={j} onOpen={setLightbox} />
                ))}
              </ul>
            ) : (
              <p className="text-sm fx-muted">아직 이 프로젝트의 도구 일감이 없어요.</p>
            )}
          </section>
        </>
      )}
      {lightbox ? <Lightbox art={lightbox} onClose={() => setLightbox(null)} /> : null}
    </div>
  );
}
