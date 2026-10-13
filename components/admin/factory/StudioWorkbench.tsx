"use client";

// 통제실 [스튜디오] 탭 본체(클라이언트): 서브탭 [게임 스튜디오][앱 스튜디오] → 프로젝트 고르기 → 카드(정보·종류·연결 도구·스튜디오 주소).
// 저장은 /api/admin/factory/control 의 { studioProject } 액션. 종류가 없는 프로젝트는 '미분류'에 보이고 [게임]/[앱]을 누르면 옮겨진다.
import { useState } from "react";

import { PURPOSE_LABELS, type Purpose } from "@/lib/factory/toolkit";
import { cleanStudioUrl, FIRST_PURPOSES, isManualTool, orderToolsFor, STUDIO_KIND_LABELS, type StudioAppInfo, type StudioKind, type StudioProjects } from "@/lib/factory/studioProjects";

export interface StudioToolRow {
  id: string;
  desc: string;
  purpose: Purpose;
  purposeSource: "saved" | "guess";
  enabled: boolean;
}

const STATUS_LABELS: Record<string, string> = { pending: "승인 대기", approved: "승인됨", running: "제작 중", review: "검토 대기", done: "완료", failed: "실패", cancelled: "취소" };
const STUDIOS: { kind: StudioKind; label: string }[] = [
  { kind: "game", label: "게임 스튜디오" },
  { kind: "app", label: "앱 스튜디오" },
];

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export default function StudioWorkbench({
  apps,
  initial,
  tools,
  toolsReported,
  initialStudio = "game",
  initialPicked = null,
}: {
  apps: StudioAppInfo[];
  initial: StudioProjects;
  tools: StudioToolRow[];
  toolsReported: boolean;
  initialStudio?: StudioKind; // 시험·미리보기용 처음 상태
  initialPicked?: string | null;
}) {
  const [saved, setSaved] = useState<StudioProjects>(initial);
  const [studio, setStudio] = useState<StudioKind>(initialStudio);
  const [picked, setPicked] = useState<string | null>(initialPicked);
  // 편집 중인 값(저장 전). 프로젝트를 바꾸면 저장된 값으로 다시 시작한다
  const [draftTools, setDraftTools] = useState<string[]>(initialPicked ? (initial[initialPicked]?.tools ?? []) : []);
  const [draftUrl, setDraftUrl] = useState(initialPicked ? (initial[initialPicked]?.studioUrl ?? "") : "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  // 앱 목록에 없어도 저장된 프로젝트는 보인다
  const all: StudioAppInfo[] = [
    ...apps,
    ...Object.keys(saved)
      .filter((s) => !apps.some((a) => a.appSlug === s))
      .map((appSlug) => ({ appSlug, title: appSlug, stack: "", status: "", finishedAt: null, done: false })),
  ];
  const inStudio = all.filter((a) => saved[a.appSlug]?.kind === studio);
  const unclassified = all.filter((a) => !saved[a.appSlug]);
  const app = all.find((a) => a.appSlug === picked) ?? null;
  const cfg = app ? saved[app.appSlug] : undefined;

  const pick = (slug: string) => {
    setPicked(slug);
    setDraftTools(saved[slug]?.tools ?? []);
    setDraftUrl(saved[slug]?.studioUrl ?? "");
    setNotice("");
  };

  const post = async (studioProject: Record<string, unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/factory/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studioProject }) });
      const data = (await res.json().catch(() => ({}))) as { message?: string; studioProjects?: StudioProjects };

      setNotice(data.message || (res.ok ? "저장했어요." : "저장하지 못했어요."));
      if (res.ok && data.studioProjects) {
        const slug = String(studioProject.appSlug);

        setSaved(data.studioProjects);
        setDraftTools(data.studioProjects[slug]?.tools ?? []);
        setDraftUrl(data.studioProjects[slug]?.studioUrl ?? "");

        return data.studioProjects;
      }
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }

    return null;
  };

  const classify = async (kind: StudioKind) => {
    if (!app) return;
    const next = await post({ appSlug: app.appSlug, kind });

    if (next) setStudio(kind); // 옮겨진 스튜디오로 같이 이동
  };

  const kind = cfg?.kind;
  const ordered = kind ? orderToolsFor(kind, tools) : tools;
  const dirty = !!cfg && (!sameSet(draftTools, cfg.tools) || draftUrl.trim() !== (cfg.studioUrl ?? ""));
  const urlBad = draftUrl.trim() !== "" && !cleanStudioUrl(draftUrl);
  const firstCount = kind ? tools.filter((t) => FIRST_PURPOSES[kind].includes(t.purpose)).length : 0;

  const listButton = (a: StudioAppInfo) => (
    <li key={a.appSlug}>
      <button
        aria-pressed={picked === a.appSlug}
        className={`fx-panel w-full min-w-0 break-all p-2 text-left text-sm ${picked === a.appSlug ? "font-bold" : ""}`}
        data-studio-project={a.appSlug}
        type="button"
        onClick={() => pick(a.appSlug)}
      >
        <span className="font-mono">{a.appSlug}</span>
        <span className="fx-muted"> · {a.status ? (STATUS_LABELS[a.status] ?? a.status) : "일감 없음"}</span>
      </button>
    </li>
  );

  return (
    <section aria-label="스튜디오" className="fx-hud" id="studio">
      <header className="fx-hud-head">
        <h2 className="fx-hud-title">studio · 프로젝트와 도구 연결</h2>
      </header>
      <p className="mb-3 text-sm fx-muted">종류는 관리자가 지정해요 · 일감 보내기는 다음 단계예요.</p>

      <nav aria-label="스튜디오 종류" className="fx-tabs mb-4">
        {STUDIOS.map((s) => (
          <button key={s.kind} aria-current={s.kind === studio ? "page" : undefined} className="fx-tab" data-studio-tab={s.kind} type="button" onClick={() => setStudio(s.kind)}>
            {s.label} ({all.filter((a) => saved[a.appSlug]?.kind === s.kind).length})
          </button>
        ))}
      </nav>

      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0 space-y-3">
          <div>
            <h3 className="fx-label mb-1">{STUDIO_KIND_LABELS[studio]} 프로젝트</h3>
            {inStudio.length ? (
              <ul className="grid gap-2">{inStudio.map(listButton)}</ul>
            ) : (
              <p className="text-sm fx-muted">아직 없어요. 아래 &apos;미분류&apos;에서 프로젝트를 골라 [{STUDIO_KIND_LABELS[studio]}]로 지정하세요.</p>
            )}
          </div>
          <div>
            <h3 className="fx-label mb-1">미분류 ({unclassified.length})</h3>
            {unclassified.length ? <ul className="grid gap-2">{unclassified.map(listButton)}</ul> : <p className="text-sm fx-muted">모든 프로젝트의 종류가 정해졌어요.</p>}
          </div>
        </div>

        <div className="min-w-0">
          {!app ? (
            <p className="text-sm fx-muted" role="status">
              왼쪽에서 프로젝트를 고르세요.
            </p>
          ) : (
            <article className="fx-panel min-w-0 space-y-3 p-3" data-studio-card={app.appSlug}>
              <div className="min-w-0">
                <h3 className="break-words font-semibold">{app.title}</h3>
                <dl className="mt-1 grid gap-1 break-words text-sm">
                  <div>
                    <dt className="fx-label">appSlug</dt>
                    <dd className="break-all font-mono">{app.appSlug}</dd>
                  </div>
                  <div>
                    <dt className="fx-label">최근 일감</dt>
                    <dd>
                      {app.status ? (STATUS_LABELS[app.status] ?? app.status) : "일감 없음"}
                      <span className="fx-muted"> · 완료 시각 {app.finishedAt ? `${app.finishedAt.slice(0, 16).replace("T", " ")}(UTC)` : "없음"}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="fx-label">종류</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      <b>{kind ? STUDIO_KIND_LABELS[kind] : "미분류"}</b>
                      {STUDIOS.map((s) => (
                        <button key={s.kind} className="rounded border border-default-300 px-2 py-1" data-classify={s.kind} disabled={busy || kind === s.kind} type="button" onClick={() => void classify(s.kind)}>
                          [{STUDIO_KIND_LABELS[s.kind]}]
                        </button>
                      ))}
                    </dd>
                  </div>
                </dl>
              </div>

              {!cfg ? (
                <p className="text-sm fx-muted">종류를 정하면 도구를 연결할 수 있어요.</p>
              ) : (
                <>
                  <div data-studio-url>
                    <label className="fx-label" htmlFor={`studio-url-${app.appSlug}`}>
                      스튜디오 주소 (https 만, 비워 두면 없음)
                    </label>
                    <input
                      className="mt-1 w-full min-w-0 rounded border border-default-300 bg-transparent px-2 py-1 font-mono text-sm"
                      id={`studio-url-${app.appSlug}`}
                      inputMode="url"
                      maxLength={200}
                      placeholder="https://"
                      value={draftUrl}
                      onChange={(e) => setDraftUrl(e.target.value)}
                    />
                    {urlBad ? <p className="mt-1 text-sm fx-bad">https:// 로 시작하는 200자 이하 주소만 쓸 수 있어요.</p> : null}
                    {cfg.studioUrl ? (
                      <p className="mt-1 break-all text-sm">
                        <a className="underline" data-studio-open href={cfg.studioUrl} rel="noopener noreferrer" target="_blank">
                          스튜디오 열기 ↗
                        </a>
                      </p>
                    ) : null}
                  </div>

                  <fieldset className="min-w-0" data-studio-tools>
                    <legend className="fx-label">연결된 도구 ({draftTools.length}개 선택)</legend>
                    {!toolsReported ? (
                      <p className="text-sm fx-muted">○ 보고된 도구 목록이 아직 없어요. 감독 프로그램이 tools.json 을 보고하면 여기에 나와요.</p>
                    ) : (
                      <>
                        <p className="mb-1 text-sm fx-muted">
                          {STUDIO_KIND_LABELS[cfg.kind]} 스튜디오에 맞는 도구 {firstCount}개를 먼저 보여 줘요(나머지도 선택할 수 있어요).
                        </p>
                        <ul className="grid gap-1">
                          {ordered.map((t) => {
                            const manual = isManualTool(t.id);

                            return (
                              <li key={t.id} className="min-w-0 text-sm" data-studio-tool={t.id}>
                                <label className="flex min-w-0 items-start gap-2">
                                  <input
                                    checked={draftTools.includes(t.id)}
                                    className="mt-1"
                                    disabled={manual || busy}
                                    type="checkbox"
                                    onChange={(e) => setDraftTools((cur) => (e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id)))}
                                  />
                                  <span className="min-w-0 break-words">
                                    <span className="font-mono font-semibold">{t.id}</span>
                                    <span className="fx-muted">
                                      {" "}
                                      · {PURPOSE_LABELS[t.purpose]}
                                      {t.purposeSource === "guess" ? "(추정)" : ""}
                                      {manual ? " · 직접 해야 하는 도구라 연결 불가" : ""}
                                      {t.enabled ? "" : " · 꺼짐"}
                                    </span>
                                    {t.desc ? <span className="block fx-muted">{t.desc}</span> : null}
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </fieldset>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="rounded border border-default-300 px-3 py-1 font-semibold"
                      data-studio-save
                      disabled={busy || !dirty || urlBad}
                      type="button"
                      onClick={() => void post({ appSlug: app.appSlug, tools: draftTools, studioUrl: draftUrl.trim() || null })}
                    >
                      [저장]
                    </button>
                    {dirty ? <span className="text-sm fx-muted">저장하지 않은 변경이 있어요.</span> : null}
                  </div>
                </>
              )}
              {notice ? (
                <p className="text-sm fx-muted" role="status">
                  {notice}
                </p>
              ) : null}
            </article>
          )}
        </div>
      </div>
    </section>
  );
}
