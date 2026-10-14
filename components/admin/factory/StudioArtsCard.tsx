"use client";

// 통제실 [스튜디오] 프로젝트 상세의 "그림" 카드: pixel-art 가 만든 그림(후보)을 대상 이름별로 모아 보고 [승인]·[반려]·[메모] 한다.
// 승인된 그림만 이후 일감에 자동 참고 그림으로 내려간다(후보·반려는 절대 아님). 승인 그림에서 '참고로 고르기'를 체크하면 다음 [일감 보내기]에 실려 간다.
// 불러오기·상태 전환·메모는 /api/admin/factory/arts. 도트 그림은 흐려지지 않게 가까운 이웃 확대(image-rendering: pixelated)로 보여 준다.
// 크기: 칸 너비에 맞는 가장 큰 정수 배율(원본 128px 장면이 작게 박히지 않게). 장면(image-scene)은 큰 칸(모바일 1열·그 위 2열), 소품·캐릭터는 작은 칸(모바일에서도 2열 이상).
// 그림을 누르면 화면 가득 확대 + 이전/다음(버튼·키보드 ←→, Esc 닫기).
import { useCallback, useEffect, useRef, useState } from "react";

import { ART_STATUS_LABELS, ART_STATUSES, groupBySubject, MAX_REFS, RESULT_KIND_LABELS, type ArtStatus, type ArtView } from "@/lib/factory/arts";

type Filter = "all" | ArtStatus;

const FILTERS: { id: Filter; label: string }[] = [{ id: "all", label: "전체" }, ...ART_STATUSES.map((s) => ({ id: s as Filter, label: ART_STATUS_LABELS[s] }))];
const BTN = "rounded border border-default-300 px-2 py-1 text-sm";
const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")}(UTC)`;
const PIXELATED = { imageRendering: "pixelated" } as const;

/** 칸 너비(box) 안에 들어가는 가장 큰 정수 배율. 원본이 칸보다 커도 1배(넘치면 CSS max-width 가 줄인다) */
export function integerScale(box: number, natural: number): number {
  return natural > 0 && box > 0 ? Math.max(1, Math.floor(box / natural)) : 1;
}

/** 도트 그림 한 장: 칸 너비를 재서 정수 배율로 그린다(측정 전·원본 크기를 모를 때는 칸 너비에 맞춘 pixelated) */
function PixelImg({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [nat, setNat] = useState(0);

  useEffect(() => {
    const el = box.current;

    if (!el) return;
    const measure = () => setWidth(el.clientWidth);

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);

    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} className={`flex w-full min-w-0 justify-center ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={alt} className="max-w-full rounded border border-default-300 bg-default-100" data-art-img loading="lazy" src={src} style={{ ...PIXELATED, width: nat && width ? nat * integerScale(width, nat) : "100%", height: "auto" }} onLoad={(e) => setNat(e.currentTarget.naturalWidth)} />
    </div>
  );
}

/** 화면 가득 확대: 이전/다음·닫기. 창 크기에 맞는 가장 큰 정수 배율 */
function Lightbox({ arts, index, onIndex, onClose }: { arts: ArtView[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const a = arts[index];
  const [view, setView] = useState({ w: 800, h: 600 });
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const go = useCallback((d: number) => onIndex((index + d + arts.length) % arts.length), [index, arts.length, onIndex]);

  useEffect(() => {
    const measure = () => setView({ w: window.innerWidth, h: window.innerHeight });

    measure();
    window.addEventListener("resize", measure);

    return () => window.removeEventListener("resize", measure);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };

    window.addEventListener("keydown", key);

    return () => window.removeEventListener("keydown", key);
  }, [go, onClose]);
  useEffect(() => setNat({ w: 0, h: 0 }), [a?.id]);

  if (!a) return null;
  const maxW = Math.max(64, view.w - 32);
  const maxH = Math.max(64, view.h - 150);
  const scale = nat.w && nat.h ? Math.max(1, Math.floor(Math.min(maxW / nat.w, maxH / nat.h))) : 1;

  return (
    <div aria-label={`${a.subject} 크게 보기`} aria-modal="true" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-white" data-art-lightbox role="dialog">
      <button aria-label="닫기" className="absolute inset-0 h-full w-full cursor-default" tabIndex={-1} type="button" onClick={onClose} />
      <div className="pointer-events-none relative flex min-w-0 flex-col items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={`${a.subject} (${ART_STATUS_LABELS[a.status]})`} className="rounded border border-white/40 bg-neutral-700" data-art-lightbox-img src={a.url} style={{ ...PIXELATED, ...(nat.w ? { width: nat.w * scale, height: nat.h * scale } : { maxWidth: maxW, maxHeight: maxH }) }} onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        <p className="text-center text-sm">
          {a.subject} · {ART_STATUS_LABELS[a.status]} · {RESULT_KIND_LABELS[a.kind]} · {index + 1}/{arts.length}
          {nat.w ? ` · ${nat.w}×${nat.h}px ×${scale}` : ""}
        </p>
        <div className="pointer-events-auto flex gap-2">
          <button className="rounded border border-white/60 px-3 py-1" data-art-prev disabled={arts.length < 2} type="button" onClick={() => go(-1)}>
            [← 이전]
          </button>
          <button className="rounded border border-white/60 px-3 py-1" data-art-close type="button" onClick={onClose}>
            [닫기]
          </button>
          <button className="rounded border border-white/60 px-3 py-1" data-art-next disabled={arts.length < 2} type="button" onClick={() => go(1)}>
            [다음 →]
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StudioArtsCard({ appSlug, picked, onPickedChange, initialArts, initialAliases }: { appSlug: string; picked: string[]; onPickedChange: (ids: string[]) => void; initialArts?: ArtView[]; initialAliases?: unknown }) {
  const [arts, setArts] = useState<ArtView[] | null>(initialArts ?? null);
  const [aliases, setAliases] = useState<unknown>(initialAliases ?? {});
  const [filter, setFilter] = useState<Filter>("all");
  const [big, setBig] = useState<string | null>(null); // 화면 가득 확대 중인 그림 id
  const [editNote, setEditNote] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/factory/arts?appSlug=${encodeURIComponent(appSlug)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { arts?: ArtView[]; aliases?: unknown; message?: string };

      if (res.ok && data.arts) {
        setArts(data.arts);
        setAliases(data.aliases ?? {});
      } else setNotice(data.message || "그림 목록을 불러오지 못했어요.");
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
  }, [appSlug]);

  useEffect(() => {
    if (!initialArts) void load();
  }, [initialArts, load]);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/factory/arts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { message?: string; art?: ArtView };

      setNotice(data.message || (res.ok ? "저장했어요." : "저장하지 못했어요."));
      if (res.ok && data.art) {
        const art = data.art;

        setArts((cur) => (cur ?? []).map((a) => (a.id === art.id ? art : a)));
        if (art.status !== "approved") onPickedChange(picked.filter((x) => x !== art.id)); // 승인이 아니게 된 그림은 참고로 고른 것에서 뺀다
        setEditNote(null);
      }
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const togglePick = (id: string, on: boolean) => onPickedChange(on ? [...picked.filter((x) => x !== id), id].slice(0, MAX_REFS) : picked.filter((x) => x !== id));
  const shown = (arts ?? []).filter((a) => filter === "all" || a.status === filter);
  const groups = groupBySubject(shown, aliases);
  const flat = groups.flatMap((g) => g.arts); // 확대 화면에서 좌우로 넘기는 순서(화면에 보이는 순서)
  const bigIndex = big ? flat.findIndex((a) => a.id === big) : -1;
  const count = (s: ArtStatus) => (arts ?? []).filter((a) => a.status === s).length;

  return (
    <section aria-label="그림" className="min-w-0 space-y-3 border-t border-default-300 pt-3" data-studio-arts>
      <h4 className="fx-label">
        그림 (승인 {count("approved")} · 후보 {count("candidate")} · 반려 {count("rejected")})
      </h4>
      <p className="text-sm fx-muted">AI 가 만든 그림은 &apos;후보&apos;로 들어와요. 보고 [승인]하면 이후 일감에서 같은 대상·같은 종류의 참고 그림으로 자동으로 쓰여요. 후보와 반려 그림은 쓰이지 않아요.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="그림 보기">
        {FILTERS.map((f) => (
          <button key={f.id} aria-pressed={filter === f.id} className={`${BTN} ${filter === f.id ? "font-bold" : ""}`} data-arts-filter={f.id} type="button" onClick={() => setFilter(f.id)}>
            [{f.label}]
          </button>
        ))}
      </div>
      {arts === null ? (
        <p className="text-sm fx-muted" role="status">
          불러오는 중…
        </p>
      ) : !groups.length ? (
        <p className="text-sm fx-muted" data-arts-empty>
          {arts.length ? "이 보기에 맞는 그림이 없어요." : "아직 그림이 없어요. pixel-art 로 만든 결과가 올라오면 여기에 후보로 나와요."}
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.subject} className="min-w-0" data-arts-subject={g.subject}>
            <h5 className="break-words font-semibold">{g.subject}</h5>
            {[true, false].map((scene) => {
              const list = g.arts.filter((a) => (a.kind === "image-scene") === scene);

              return list.length ? (
                <ul key={scene ? "scene" : "prop"} className={`mt-1 grid min-w-0 gap-3 ${scene ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`} data-arts-grid={scene ? "scene" : "prop"}>
                  {list.map((a) => (
                    <li key={a.id} className="fx-panel min-w-0 space-y-2 p-2" data-art={a.id} data-art-status={a.status}>
                      <button aria-label={`${a.subject} 크게 보기`} className="block w-full" data-art-zoom type="button" onClick={() => setBig(a.id)}>
                        <PixelImg alt={`${a.subject} (${ART_STATUS_LABELS[a.status]})`} src={a.url} />
                      </button>
                      <div className="min-w-0 text-sm">
                      <p className="break-words">
                        <b data-art-badge>{ART_STATUS_LABELS[a.status]}</b>
                        <span className="fx-muted">
                          {" "}
                          · {RESULT_KIND_LABELS[a.kind]}
                          {a.method ? ` · ${a.method}` : ""} · {when(a.createdAt)}
                        </span>
                      </p>
                      {a.summary ? (
                        <p className="break-words fx-muted">
                          단계 {a.summary.steps.length}개{a.summary.refs.length ? ` · 참고 ${a.summary.refs.length}장(${[...new Set(a.summary.refs)].join("·")})` : a.summary.refsFallback ? ` · ${a.summary.refsFallback}` : ""} · 비용 {a.summary.cost}회
                        </p>
                      ) : null}
                      {a.jobId ? (
                        <p className="fx-muted">
                          일감{" "}
                          <a className="underline" href={`/admin/factory?tab=jobs&job=${encodeURIComponent(a.jobId)}`}>
                            {a.jobId.slice(0, 8)}
                          </a>
                        </p>
                      ) : null}
                      {a.decidedAt ? (
                        <p className="fx-muted">
                          {ART_STATUS_LABELS[a.status]} · {a.decidedBy || "?"} · {when(a.decidedAt)}
                        </p>
                      ) : null}
                      {a.note && editNote?.id !== a.id ? <p className="break-words">메모: {a.note}</p> : null}
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {a.status !== "approved" ? (
                          <button className={BTN} data-art-action="approve" disabled={busy} type="button" onClick={() => void send({ id: a.id, action: "approve" })}>
                            [승인]
                          </button>
                        ) : null}
                        {a.status !== "rejected" ? (
                          <button className={BTN} data-art-action="reject" disabled={busy} type="button" onClick={() => void send({ id: a.id, action: "reject" })}>
                            [반려]
                          </button>
                        ) : null}
                        {a.status !== "candidate" ? (
                          <button className={BTN} data-art-action="reset" disabled={busy} type="button" onClick={() => void send({ id: a.id, action: "reset" })}>
                            [후보로]
                          </button>
                        ) : null}
                        <button className={BTN} data-art-action="note" type="button" onClick={() => setEditNote(editNote?.id === a.id ? null : { id: a.id, text: a.note })}>
                          [메모]
                        </button>
                        {a.status === "approved" ? (
                          <label className="flex items-center gap-1" data-art-pick>
                            <input checked={picked.includes(a.id)} disabled={!picked.includes(a.id) && picked.length >= MAX_REFS} type="checkbox" onChange={(e) => togglePick(a.id, e.target.checked)} />
                            참고로 고르기
                          </label>
                        ) : null}
                      </div>
                      {editNote?.id === a.id ? (
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                          <input aria-label="메모" className="min-w-0 flex-1 rounded border border-default-300 bg-transparent px-2 py-1 text-sm" maxLength={200} value={editNote.text} onChange={(e) => setEditNote({ id: a.id, text: e.target.value })} />
                          <button className={BTN} data-art-note-save disabled={busy} type="button" onClick={() => void send({ id: a.id, note: editNote.text })}>
                            [메모 저장]
                          </button>
                        </div>
                      ) : null}
                    </div>
                    </li>
                  ))}
                </ul>
              ) : null;
            })}
          </div>
        ))
      )}
      {bigIndex >= 0 ? <Lightbox arts={flat} index={bigIndex} onClose={() => setBig(null)} onIndex={(i) => setBig(flat[i]?.id ?? null)} /> : null}
      {picked.length ? (
        <p className="text-sm" data-arts-picked>
          다음 [일감 보내기]에 참고로 {picked.length}장이 실려 가요(최대 {MAX_REFS}장).
        </p>
      ) : null}
      {notice ? (
        <p className="text-sm" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
