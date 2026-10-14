"use client";

// 통제실 [스튜디오] 탭 본체(클라이언트): 서브탭 [게임 스튜디오][앱 스튜디오] → 프로젝트 고르기 → 카드(정보·스튜디오 분류·바로가기·연결 도구).
// 저장은 /api/admin/factory/control 의 { studioProject } 액션. 분류가 없거나 '미분류'인 프로젝트는 '미분류' 묶음에 보이고 [게임]/[앱]/[미분류]를 누르면 옮겨진다.
// 바로가기: 상세 맨 위 [스튜디오 열기](studioUrl) + 이름·주소 목록(links). 주소가 없으면 맨 위에서 바로 입력·저장한다.
import { useState } from "react";

import ProjectToolSettingsCard from "./ProjectToolSettingsCard";
import AppQueue from "./AppQueue";
import StudioArtsCard from "./StudioArtsCard";

import { PURPOSE_LABELS, type Purpose, type StudioKind as ToolKind, type ToolLayer } from "@/lib/factory/toolkit";
import { cleanLinks, cleanStudioUrl, FIRST_PURPOSES, isManualTool, MAX_LINK_NAME, MAX_STUDIO_LINKS, orderToolsFor, STUDIO_KIND_LABELS, type ClassifiedKind, type StudioAppInfo, type StudioKind, type StudioLink, type StudioProjects } from "@/lib/factory/studioProjects";

export interface StudioToolRow {
  id: string;
  desc: string;
  purpose: Purpose;
  purposeSource: "saved" | "guess";
  enabled: boolean;
  layer?: ToolLayer; // studio = 스튜디오 도구, internal = 내부 단계, 없거나 "" = 옛 툴킷(구분 없음)
  kinds?: ToolKind[]; // 스튜디오 도구의 결과 종류·방식(읽기 전용 표시)
}

const STATUS_LABELS: Record<string, string> = { pending: "승인 대기", approved: "승인됨", running: "제작 중", review: "검토 대기", done: "완료", failed: "실패", cancelled: "취소" };
const STUDIOS: { kind: ClassifiedKind; label: string }[] = [
  { kind: "game", label: "게임 스튜디오" },
  { kind: "app", label: "앱 스튜디오" },
];

export interface StudioSentJob {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

const SEND_KINDS = [
  { kind: "regen", label: "이미지 다시 만들기" },
  { kind: "layout", label: "배치 적용" },
  { kind: "free", label: "자유 지시" },
] as const;
type SendKind = (typeof SEND_KINDS)[number]["kind"];

const MAX_NOTE = 500; // lib/studio/requests.ts 와 같은 값(서버가 다시 검사)
const MAX_LAYOUT_BYTES = 40 * 1024;
const jobHref = (id: string) => `/admin/factory?tab=jobs&job=${encodeURIComponent(id)}`;
const FIELD = "mt-1 w-full min-w-0 rounded border border-default-300 bg-transparent px-2 py-1 text-sm";

/** [일감 보내기] 카드: 연결된 도구 + 요청 종류 + 메모 → 서버가 Studio 요청과 같은 경로로 '승인 대기' 일감을 만든다. 아래에 이 프로젝트에서 보낸 최근 일감 */
function SendJobCard({ appSlug, connected, initialRecent, pickedArts = [], onSent = () => {} }: { appSlug: string; connected: string[]; initialRecent: StudioSentJob[]; pickedArts?: string[]; onSent?: () => void }) {
  const [tool, setTool] = useState(connected[0] ?? "");
  const [kind, setKind] = useState<SendKind>("regen");
  const [propName, setPropName] = useState("");
  const [placement, setPlacement] = useState("");
  const [instruction, setInstruction] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [recent, setRecent] = useState(initialRecent);
  const toolId = connected.includes(tool) ? tool : (connected[0] ?? "");
  const tooBig = new Blob([placement]).size > MAX_LAYOUT_BYTES;
  const ready = !!toolId && (kind === "regen" ? propName.trim() !== "" : kind === "layout" ? placement.trim() !== "" && !tooBig : instruction.trim() !== "");

  const send = async () => {
    setBusy(true);
    setNotice("");
    try {
      const body = { appSlug, kind, tool: toolId, note, ...(pickedArts.length ? { refArtIds: pickedArts } : {}), ...(kind === "regen" ? { propName: propName.trim() } : kind === "layout" ? { placement } : { instruction }) };
      const res = await fetch("/api/admin/factory/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studioJob: body }) });
      const data = (await res.json().catch(() => ({}))) as { message?: string; recent?: StudioSentJob[] };

      setNotice(data.message || (res.ok ? "일감을 만들었어요." : "일감을 만들지 못했어요."));
      if (res.ok && data.recent) setRecent(data.recent);
      if (res.ok) onSent(); // 참고로 고른 그림은 이번 일감에 실렸으니 비운다
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="일감 보내기" className="min-w-0 space-y-3 border-t border-default-300 pt-3" data-studio-send>
      <h4 className="fx-label">일감 보내기</h4>
      {!connected.length ? (
        <p className="text-sm fx-muted">연결된 도구가 없어요. 위에서 도구를 체크하고 [저장]하면 일감을 보낼 수 있어요.</p>
      ) : (
        <>
          <div>
            <label className="fx-label" htmlFor={`send-tool-${appSlug}`}>
              도구
            </label>
            <select className={FIELD} data-send-tool id={`send-tool-${appSlug}`} value={toolId} onChange={(e) => setTool(e.target.value)}>
              {connected.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="요청 종류">
            {SEND_KINDS.map((k) => (
              <button key={k.kind} aria-pressed={kind === k.kind} className={`rounded border border-default-300 px-2 py-1 text-sm ${kind === k.kind ? "font-bold" : ""}`} data-send-kind={k.kind} type="button" onClick={() => setKind(k.kind)}>
                [{k.label}]
              </button>
            ))}
          </div>
          {kind === "regen" ? (
            <div>
              <label className="fx-label" htmlFor={`send-prop-${appSlug}`}>
                대상 이름 (영문·숫자·_·- 80자 이하)
              </label>
              <input className={`${FIELD} font-mono`} id={`send-prop-${appSlug}`} maxLength={80} value={propName} onChange={(e) => setPropName(e.target.value)} />
            </div>
          ) : null}
          {kind === "layout" ? (
            <div>
              <label className="fx-label" htmlFor={`send-layout-${appSlug}`}>
                placement.json 붙여넣기 (40KB 이내)
              </label>
              <textarea className={`${FIELD} font-mono`} id={`send-layout-${appSlug}`} rows={6} value={placement} onChange={(e) => setPlacement(e.target.value)} />
              {tooBig ? <p className="mt-1 text-sm fx-bad">40KB 를 넘어서 보낼 수 없어요.</p> : null}
            </div>
          ) : null}
          {kind === "free" ? (
            <div>
              <label className="fx-label" htmlFor={`send-free-${appSlug}`}>
                고칠 내용 ({instruction.length}/{MAX_NOTE}자)
              </label>
              <textarea className={FIELD} id={`send-free-${appSlug}`} maxLength={MAX_NOTE} rows={4} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
            </div>
          ) : null}
          <div>
            <label className="fx-label" htmlFor={`send-note-${appSlug}`}>
              메모 (선택, {note.length}/{MAX_NOTE}자)
            </label>
            <textarea className={FIELD} id={`send-note-${appSlug}`} maxLength={MAX_NOTE} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button className="rounded border border-default-300 px-3 py-1 font-semibold" data-send-submit disabled={busy || !ready} type="button" onClick={() => void send()}>
            [일감 만들기]
          </button>
          {pickedArts.length ? (
            <p className="text-sm" data-send-picked>
              참고로 고른 승인 그림 {pickedArts.length}장이 이 일감에 실려 가요.
            </p>
          ) : null}
          <p className="text-sm fx-muted">승인 대기 일감으로 만들어져요. 승인은 통제실 [일감]이나 텔레그램에서 해요.</p>
        </>
      )}
      {notice ? (
        <p className="text-sm" role="status">
          {notice}
        </p>
      ) : null}
      <div data-studio-recent>
        <h4 className="fx-label">이 프로젝트에서 보낸 최근 일감</h4>
        {recent.length ? (
          <ul className="mt-1 grid gap-1 text-sm">
            {recent.map((j) => (
              <li key={j.id} className="min-w-0 break-words">
                <a className="underline" href={jobHref(j.id)}>
                  {j.title}
                </a>
                <span className="fx-muted">
                  {" "}
                  · {STATUS_LABELS[j.status] ?? j.status} · {j.createdAt.slice(0, 16).replace("T", " ")}(UTC)
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm fx-muted">아직 없어요.</p>
        )}
      </div>
    </section>
  );
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const KIND_BUTTONS: StudioKind[] = ["game", "app", "none"];
const BTN = "rounded border border-default-300 px-2 py-1";

/** 입력칸에 적힌 현재 값(저장 전 편집 중이어도) 기준 [열기]. https 가 아니면 눌리지 않는 버튼으로 보인다 */
function OpenButton({ url, label }: { url: string; label: string }) {
  const u = url.trim();
  if (!u.toLowerCase().startsWith("https://")) {
    return (
      <button aria-label={label} className={`${BTN} opacity-50`} data-open-link disabled type="button">
        [열기 ↗]
      </button>
    );
  }
  return (
    <a aria-label={label} className={BTN} data-open-link href={u} rel="noopener noreferrer" target="_blank">
      [열기 ↗]
    </a>
  );
}

/** 바로가기 편집 칸 → 저장할 목록. 둘 다 빈 줄은 버리고, 이름이나 주소가 틀렸거나 같은 주소가 겹치면 bad */
function readDraftLinks(rows: StudioLink[]): { links: StudioLink[]; bad: boolean } {
  const filled = rows.filter((r) => r.name.trim() !== "" || r.url.trim() !== "");
  const links = cleanLinks(filled);

  return { links, bad: links.length !== filled.length };
}

export default function StudioWorkbench({
  apps,
  toolApps = [],
  initial,
  tools,
  toolsReported,
  recent = {},
  initialStudio = "game",
  initialPicked = null,
}: {
  apps: StudioAppInfo[]; // 제품만
  toolApps?: StudioAppInfo[]; // 도구·플랫폼(이름만 접어서 보임)
  initial: StudioProjects;
  tools: StudioToolRow[];
  toolsReported: boolean;
  recent?: Record<string, StudioSentJob[]>; // 프로젝트별 Studio 요청 최근 일감(최신순 5개)
  initialStudio?: ClassifiedKind; // 시험·미리보기용 처음 상태
  initialPicked?: string | null;
}) {
  const [saved, setSaved] = useState<StudioProjects>(initial);
  const [studio, setStudio] = useState<ClassifiedKind>(initialStudio);
  const [picked, setPicked] = useState<string | null>(initialPicked);
  // 편집 중인 값(저장 전). 프로젝트를 바꾸면 저장된 값으로 다시 시작한다
  const [draftTools, setDraftTools] = useState<string[]>(initialPicked ? (initial[initialPicked]?.tools ?? []) : []);
  const [draftUrl, setDraftUrl] = useState(initialPicked ? (initial[initialPicked]?.studioUrl ?? "") : "");
  const [draftLinks, setDraftLinks] = useState<StudioLink[]>(initialPicked ? (initial[initialPicked]?.links ?? []) : []);
  const [quickUrl, setQuickUrl] = useState(""); // 상세 맨 위에서 바로 적는 스튜디오 주소(주소가 없을 때만 보임)
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pickedArts, setPickedArts] = useState<string[]>([]); // 그림 카드에서 '참고로 고르기' 한 승인 그림 id (프로젝트를 바꾸면 비움)

  // 앱 목록에 없어도 저장된 프로젝트는 보인다
  const all: StudioAppInfo[] = [
    ...apps,
    ...Object.keys(saved)
      .filter((s) => !apps.some((a) => a.appSlug === s) && !toolApps.some((a) => a.appSlug === s))
      .map((appSlug) => ({ appSlug, title: appSlug, stack: "", status: "", finishedAt: null, done: false })),
  ];
  const inStudio = all.filter((a) => saved[a.appSlug]?.kind === studio);
  const unclassified = all.filter((a) => !saved[a.appSlug] || saved[a.appSlug].kind === "none"); // 저장값이 없거나 '미분류'로 정한 것
  const app = all.find((a) => a.appSlug === picked) ?? null;
  const cfg = app ? saved[app.appSlug] : undefined;

  const pick = (slug: string) => {
    setPicked(slug);
    setDraftTools(saved[slug]?.tools ?? []);
    setDraftUrl(saved[slug]?.studioUrl ?? "");
    setDraftLinks(saved[slug]?.links ?? []);
    setQuickUrl("");
    setNotice("");
    setPickedArts([]);
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
        setDraftLinks(data.studioProjects[slug]?.links ?? []);
        setQuickUrl("");

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

    if (next && kind !== "none") setStudio(kind); // 옮겨진 스튜디오로 같이 이동
  };

  const kind = cfg?.kind;
  const classified = kind === "game" || kind === "app"; // 도구를 연결하고 일감을 보낼 수 있는 분류
  const layered = tools.some((t) => t.layer === "studio" || t.layer === "internal");
  const studioTools = layered ? tools.filter((t) => t.layer === "studio") : tools; // 새 툴킷이면 스튜디오 도구만 고른다
  // 예전에 연결해 둔 내부 도구 이름은 깨지지 않게 남겨 두고(해제만 가능), 새로 고를 수는 없다
  const legacyTools = layered ? tools.filter((t) => t.layer === "internal" && (cfg?.tools.includes(t.id) || draftTools.includes(t.id))) : [];
  const ordered = kind ? orderToolsFor(kind, studioTools) : studioTools;
  const draft = readDraftLinks(draftLinks);
  const dirty = !!app && (!sameSet(draftTools, cfg?.tools ?? []) || draftUrl.trim() !== (cfg?.studioUrl ?? "") || JSON.stringify(draft.links) !== JSON.stringify(cfg?.links ?? []));
  const urlBad = draftUrl.trim() !== "" && !cleanStudioUrl(draftUrl);
  const quickBad = quickUrl.trim() !== "" && !cleanStudioUrl(quickUrl);
  const setLink = (i: number, patch: Partial<StudioLink>) => setDraftLinks((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const firstCount = kind ? studioTools.filter((t) => FIRST_PURPOSES[kind].includes(t.purpose)).length : 0;

  const listButton = (a: StudioAppInfo) => {
    const url = saved[a.appSlug]?.studioUrl;

    return (
      <li key={a.appSlug} className="flex min-w-0 items-stretch gap-1">
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
        {url ? (
          <a aria-label={`${a.appSlug} 스튜디오 열기(새 탭)`} className="fx-panel flex shrink-0 items-center px-2 text-sm" data-studio-shortcut={a.appSlug} href={url} rel="noopener noreferrer" target="_blank" title="스튜디오 열기">
            ↗
          </a>
        ) : null}
      </li>
    );
  };

  return (
    <section aria-label="스튜디오" className="fx-hud" id="studio">
      <header className="fx-hud-head">
        <h2 className="fx-hud-title">studio · 프로젝트와 도구 연결</h2>
      </header>
      <p className="mb-3 text-sm fx-muted">스튜디오 분류(게임·앱·미분류)는 관리자가 지정해요 · 연결한 도구로 [일감 보내기]를 할 수 있어요. 분류는 &apos;제품 / 도구·플랫폼&apos; 역할과 별개예요.</p>

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
            <h3 className="fx-label mb-1" data-studio-unclassified>
              미분류 ({unclassified.length})
            </h3>
            {unclassified.length ? <ul className="grid gap-2">{unclassified.map(listButton)}</ul> : <p className="text-sm fx-muted">모든 프로젝트의 분류가 정해졌어요.</p>}
          </div>
          {toolApps.length ? (
            <details data-studio-tool-apps>
              <summary className="fx-label cursor-pointer">도구·플랫폼 ({toolApps.length})</summary>
              <ul className="mt-1 grid gap-1 text-sm">
                {toolApps.map((a) => (
                  <li key={a.appSlug} className="break-all font-mono">
                    {a.appSlug}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs fx-muted">일감은 [일감] 탭에서 보내요.</p>
            </details>
          ) : null}
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
                    <dt className="fx-label">스튜디오 분류</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      <b data-studio-kind={kind ?? "none"}>{STUDIO_KIND_LABELS[kind ?? "none"]}</b>
                      {KIND_BUTTONS.map((k) => (
                        <button key={k} className={BTN} data-classify={k} disabled={busy || (kind ?? "none") === k} type="button" onClick={() => void classify(k)}>
                          [{STUDIO_KIND_LABELS[k]}]
                        </button>
                      ))}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-2" data-studio-shortcuts>
                {cfg?.studioUrl ? (
                  <a className="rounded border border-default-300 px-3 py-1 font-semibold" data-studio-open href={cfg.studioUrl} rel="noopener noreferrer" target="_blank">
                    [스튜디오 열기] ↗
                  </a>
                ) : (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2" data-studio-quick-url>
                    <label className="fx-label" htmlFor={`quick-url-${app.appSlug}`}>
                      스튜디오 주소 없음
                    </label>
                    <input
                      className="min-w-0 flex-1 rounded border border-default-300 bg-transparent px-2 py-1 font-mono text-sm"
                      id={`quick-url-${app.appSlug}`}
                      inputMode="url"
                      maxLength={200}
                      placeholder="https://"
                      value={quickUrl}
                      onChange={(e) => setQuickUrl(e.target.value)}
                    />
                    <button className={BTN} data-quick-url-save disabled={busy || quickUrl.trim() === "" || quickBad} type="button" onClick={() => void post({ appSlug: app.appSlug, studioUrl: quickUrl.trim() })}>
                      [주소 저장]
                    </button>
                    {quickBad ? <span className="w-full text-sm fx-bad">https:// 로 시작하는 200자 이하 주소만 쓸 수 있어요.</span> : null}
                  </div>
                )}
                {cfg?.links?.map((l) => (
                  <a key={l.url} className="rounded border border-default-300 px-2 py-1 text-sm" data-studio-link href={l.url} rel="noopener noreferrer" target="_blank">
                    {l.name} ↗
                  </a>
                ))}
              </div>

              <div className="min-w-0 space-y-2" data-studio-url>
                <label className="fx-label" htmlFor={`studio-url-${app.appSlug}`}>
                  스튜디오 주소 (https 만, 비워 두면 없음)
                </label>
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <input
                    className="min-w-0 flex-1 rounded border border-default-300 bg-transparent px-2 py-1 font-mono text-sm"
                    id={`studio-url-${app.appSlug}`}
                    inputMode="url"
                    maxLength={200}
                    placeholder="https://"
                    value={draftUrl}
                    onChange={(e) => setDraftUrl(e.target.value)}
                  />
                  <OpenButton label="스튜디오 주소 열기" url={draftUrl} />
                </div>
                {urlBad ? <p className="mt-1 text-sm fx-bad">https:// 로 시작하는 200자 이하 주소만 쓸 수 있어요.</p> : null}
                <div className="fx-label">바로가기 (이름 + 주소, 최대 {MAX_STUDIO_LINKS}개)</div>
                <ul className="grid gap-2" data-studio-links-edit>
                  {draftLinks.map((l, i) => (
                    <li key={i} className="flex min-w-0 flex-wrap items-center gap-2">
                      <input aria-label={`바로가기 ${i + 1} 이름`} className="w-32 min-w-0 rounded border border-default-300 bg-transparent px-2 py-1 text-sm" maxLength={MAX_LINK_NAME} placeholder="이름" value={l.name} onChange={(e) => setLink(i, { name: e.target.value })} />
                      <input aria-label={`바로가기 ${i + 1} 주소`} className="min-w-0 flex-1 rounded border border-default-300 bg-transparent px-2 py-1 font-mono text-sm" inputMode="url" maxLength={200} placeholder="https://" value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} />
                      <button className={BTN} data-link-remove={i} type="button" onClick={() => setDraftLinks((cur) => cur.filter((_, j) => j !== i))}>
                        [삭제]
                      </button>
                      <OpenButton label={`바로가기 ${i + 1} 열기`} url={l.url} />
                    </li>
                  ))}
                </ul>
                <button className={BTN} data-link-add disabled={draftLinks.length >= MAX_STUDIO_LINKS} type="button" onClick={() => setDraftLinks((cur) => [...cur, { name: "", url: "" }])}>
                  [바로가기 추가]
                </button>
                {draft.bad ? <p className="text-sm fx-bad">바로가기는 이름({MAX_LINK_NAME}자 이하)과 https:// 주소가 모두 있어야 하고, 같은 주소는 한 번만 쓸 수 있어요.</p> : null}
              </div>

              {!classified ? (
                <p className="text-sm fx-muted">종류를 정하면 도구를 연결할 수 있어요. 위에서 [게임] 또는 [앱]으로 분류해 주세요.</p>
              ) : (
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
                                    {t.kinds?.length ? (
                                      <span className="block fx-muted" data-studio-tool-kinds={t.id}>
                                        {t.kinds.map((k) => `${k.label || k.id}: ${k.methods.map((m) => (m === k.defaultMethod ? `${m}(기본)` : m)).join("·")}`).join(" / ")}
                                      </span>
                                    ) : null}
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                        {legacyTools.length ? (
                          <div className="mt-2" data-studio-legacy-tools>
                            <p className="text-sm fx-muted">예전에 연결한 내부 단계 이름이에요(그대로 쓸 수 있고, 해제만 할 수 있어요).</p>
                            <ul className="grid gap-1">
                              {legacyTools.map((t) => (
                                <li key={t.id} className="min-w-0 text-sm" data-studio-tool={t.id}>
                                  <label className="flex min-w-0 items-start gap-2">
                                    <input
                                      checked={draftTools.includes(t.id)}
                                      className="mt-1"
                                      disabled={busy}
                                      type="checkbox"
                                      onChange={(e) => setDraftTools((cur) => (e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id)))}
                                    />
                                    <span className="min-w-0 break-words">
                                      <span className="font-mono font-semibold">{t.id}</span>
                                      <span className="fx-muted"> · 내부 단계</span>
                                    </span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </>
                    )}
                </fieldset>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="rounded border border-default-300 px-3 py-1 font-semibold"
                  data-studio-save
                  disabled={busy || !dirty || urlBad || draft.bad}
                  type="button"
                  onClick={() => void post({ appSlug: app.appSlug, ...(classified ? { tools: draftTools } : {}), studioUrl: draftUrl.trim() || null, links: draft.links })}
                >
                  [저장]
                </button>
                {dirty ? <span className="text-sm fx-muted">저장하지 않은 변경이 있어요.</span> : null}
              </div>
              <ProjectToolSettingsCard key={`settings-${app.appSlug}`} appSlug={app.appSlug} />
              <StudioArtsCard key={`arts-${app.appSlug}`} appSlug={app.appSlug} picked={pickedArts} onPickedChange={setPickedArts} />
              <AppQueue key={`queue-${app.appSlug}`} appSlug={app.appSlug} />
              {classified && cfg ? (
                <SendJobCard key={app.appSlug} appSlug={app.appSlug} pickedArts={pickedArts} onSent={() => setPickedArts([])} connected={cfg.tools.filter((id) => !isManualTool(id) && tools.some((t) => t.id === id)).sort((x, y) => Number(tools.find((t) => t.id === y)?.layer === "studio") - Number(tools.find((t) => t.id === x)?.layer === "studio"))} initialRecent={recent[app.appSlug] ?? []} />
              ) : null}
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
