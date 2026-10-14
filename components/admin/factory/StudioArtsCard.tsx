"use client";

// 통제실 [스튜디오] 프로젝트 상세의 "그림" 카드: pixel-art 가 만든 그림(후보)을 대상 이름별로 모아 보고 [승인]·[반려]·[메모] 한다.
// 승인된 그림만 이후 일감에 자동 참고 그림으로 내려간다(후보·반려는 절대 아님). 승인 그림에서 '참고로 고르기'를 체크하면 다음 [일감 보내기]에 실려 간다.
// 불러오기·상태 전환·메모는 /api/admin/factory/arts. 도트 그림은 흐려지지 않게 가까운 이웃 확대(image-rendering: pixelated)로 보여 준다.
import { useCallback, useEffect, useState } from "react";

import { ART_STATUS_LABELS, ART_STATUSES, groupBySubject, MAX_REFS, RESULT_KIND_LABELS, type ArtStatus, type ArtView } from "@/lib/factory/arts";

type Filter = "all" | ArtStatus;

const FILTERS: { id: Filter; label: string }[] = [{ id: "all", label: "전체" }, ...ART_STATUSES.map((s) => ({ id: s as Filter, label: ART_STATUS_LABELS[s] }))];
const BTN = "rounded border border-default-300 px-2 py-1 text-sm";
const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")}(UTC)`;
const PIXELATED = { imageRendering: "pixelated" } as const;

export default function StudioArtsCard({ appSlug, picked, onPickedChange, initialArts, initialAliases }: { appSlug: string; picked: string[]; onPickedChange: (ids: string[]) => void; initialArts?: ArtView[]; initialAliases?: unknown }) {
  const [arts, setArts] = useState<ArtView[] | null>(initialArts ?? null);
  const [aliases, setAliases] = useState<unknown>(initialAliases ?? {});
  const [filter, setFilter] = useState<Filter>("all");
  const [big, setBig] = useState<string | null>(null);
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
            <ul className="mt-1 grid min-w-0 gap-3">
              {g.arts.map((a) => (
                <li key={a.id} className="fx-panel min-w-0 p-2" data-art={a.id} data-art-status={a.status}>
                  <div className="flex min-w-0 flex-wrap items-start gap-3">
                    <button aria-label={`${a.subject} 크게 보기`} className="shrink-0" data-art-zoom type="button" onClick={() => setBig(big === a.id ? null : a.id)}>
                      {/* 도트는 가까운 이웃 확대로 또렷하게 */}
                      <img alt={`${a.subject} (${ART_STATUS_LABELS[a.status]})`} className={`${big === a.id ? "h-80 w-80" : "h-32 w-32"} max-w-full rounded border border-default-300 bg-default-100 object-contain`} loading="lazy" src={a.url} style={PIXELATED} />
                    </button>
                    <div className="min-w-0 flex-1 text-sm">
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
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
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
