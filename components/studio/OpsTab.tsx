// components/studio/OpsTab.tsx
// /studio/<앱> 의 [운영] 탭: 검수함 · 보관함 · 내보내기 · 생성 일정 · 서비스 운영(프로젝트 연결 설정에서 켜진 프로젝트만).
// 자료는 서버가 props 로 준다(lib/studio/opsData.ts). 행동은 /api/studio/ops(관리자만)로 보낸다. 관리자가 아니면(접근 키) 읽기 전용: 단추·입력칸이 없다.
// 앱 폴더는 직접 고치지 않는다(내보내기는 앱 수정 일감으로만). 서비스 키 값은 이 화면에 오지 않는다(이름과 등록 여부만).
"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ART_STATUS_LABELS, type ArtView } from "@/lib/factory/arts";
import { PixelImg } from "@/components/studio/MakeTab";
import { EXPORT_LIMIT, EXPORT_STATUS_LABELS, filterArts, OPS_BULK_LIMIT, SCHEDULE_LIMITS, scheduleError, type ExportRecord, type ReviewFilter } from "@/lib/studio/ops";
import type { OpsData, OpsScheduleView } from "@/lib/studio/opsData";
import { RESULT_KIND_LABELS } from "@/lib/factory/projectToolSettings";

const FIELD = "mt-1 w-full min-w-0 rounded border border-default-300 bg-transparent px-2 py-1 text-sm";
const BTN = "fx-btn fx-btn-sm";
const STATUS_CLASS: Record<string, string> = { candidate: "fx-st fx-st-info", approved: "fx-st fx-st-ok", rejected: "fx-st fx-st-warn" };

type Reply = { ok: boolean; status: number; message: string; needsConfirm?: { reason: string; estimatedCost: number } };

async function post(body: Record<string, unknown>): Promise<Reply> {
  try {
    const r = await fetch("/api/studio/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = (await r.json().catch(() => ({}))) as { message?: string; needsConfirm?: { reason: string; estimatedCost: number } };

    return { ok: r.ok, status: r.status, message: d.message ?? (r.ok ? "처리했어요." : "처리하지 못했어요."), needsConfirm: d.needsConfirm };
  } catch {
    return { ok: false, status: 0, message: "서버에 연결하지 못했어요." };
  }
}

const kindLabel = (k: string) => RESULT_KIND_LABELS[k as keyof typeof RESULT_KIND_LABELS] ?? k;
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

function ExportChips({ list }: { list: readonly ExportRecord[] }) {
  if (!list.length) return null;

  return (
    <ul className="flex flex-wrap gap-1 text-xs" data-export-records>
      {list.map((e) => (
        <li key={e.id} className={`fx-st ${e.status === "done" ? "fx-st-ok" : e.status === "failed" || e.status === "unsupported" ? "fx-st-warn" : "fx-st-info"}`} title={`${e.dest}${e.note ? ` · ${e.note}` : ""}`}>
          {e.kind === "folder" ? "앱 폴더" : "서비스"} · {EXPORT_STATUS_LABELS[e.status] ?? e.status}
        </li>
      ))}
    </ul>
  );
}

function History({ data, art }: { data: OpsData; art: ArtView }) {
  const events = data.history[art.id] ?? [];

  return (
    <ol className="space-y-0.5 text-xs fx-muted" data-art-history={art.id}>
      {events.map((e, i) => (
        <li key={i}>
          <span className="font-mono">{when(e.at)}</span> {e.text}
        </li>
      ))}
    </ol>
  );
}

// ───────── 검수함 ─────────

function ReviewPane({ data, canEdit, focusArt }: { data: OpsData; canEdit: boolean; focusArt?: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState<ReviewFilter>({ status: focusArt ? "" : "candidate" });
  const [sel, setSel] = useState<string[]>(focusArt ? [focusArt] : []);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<{ reason: string; estimatedCost: number } | null>(null);
  const list = useMemo(() => filterArts(data.arts, filter, data.aliases), [data.arts, data.aliases, filter]);
  const set = (patch: Partial<ReviewFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setSel([]);
  };
  const toggle = (id: string) => setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= OPS_BULK_LIMIT ? cur : [...cur, id]));
  const run = async (action: "approve" | "reject" | "reset" | "redo" | "default", confirmed = false) => {
    if (!sel.length) return;
    setBusy(true);
    setNotice("");
    const r = await post({ appSlug: data.appSlug, action, ...(action === "default" ? { artId: sel[0] } : { ids: sel }), ...(confirmed ? { confirmed: true } : {}) });

    if (r.status === 409 && r.needsConfirm) setConfirm(r.needsConfirm);
    else {
      setConfirm(null);
      setNotice(r.message);
      if (r.ok) {
        setSel([]);
        router.refresh();
      }
    }
    setBusy(false);
  };
  const c = data.choices;

  return (
    <div className="space-y-3" data-ops-pane="review">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-review-filters>
        <label className="text-xs fx-muted">
          상태
          <select className={FIELD} value={filter.status ?? ""} onChange={(e) => set({ status: e.target.value })}>
            <option value="">모두</option>
            <option value="candidate">후보</option>
            <option value="approved">승인</option>
            <option value="rejected">반려</option>
          </select>
        </label>
        <label className="text-xs fx-muted">
          카드
          <select className={FIELD} value={filter.cardId ?? ""} onChange={(e) => set({ cardId: e.target.value })}>
            <option value="">모두</option>
            {c.cards.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({x.count})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs fx-muted">
          대상
          <select className={FIELD} value={filter.subject ?? ""} onChange={(e) => set({ subject: e.target.value })}>
            <option value="">모두</option>
            {c.subjects.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name} ({x.count})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs fx-muted">
          종류
          <select className={FIELD} value={filter.kind ?? ""} onChange={(e) => set({ kind: e.target.value })}>
            <option value="">모두</option>
            {c.kinds.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label} ({x.count})
              </option>
            ))}
          </select>
        </label>
      </div>
      {canEdit ? (
        <div className="fx-panel flex flex-wrap items-center gap-2 p-2" data-review-bulk>
          <button className="text-xs underline" type="button" onClick={() => setSel(list.slice(0, OPS_BULK_LIMIT).map((a) => a.id))}>
            보이는 {Math.min(list.length, OPS_BULK_LIMIT)}장 모두 고르기
          </button>
          <button className="text-xs underline" disabled={!sel.length} type="button" onClick={() => setSel([])}>
            선택 풀기
          </button>
          <span className="text-xs fx-muted" data-review-selected>
            {sel.length}장 선택
          </span>
          <span className="flex flex-wrap gap-1">
            <button className={BTN} data-review-action="approve" disabled={busy || !sel.length} type="button" onClick={() => run("approve")}>
              승인
            </button>
            <button className={BTN} data-review-action="reject" disabled={busy || !sel.length} type="button" onClick={() => run("reject")}>
              반려
            </button>
            <button className={BTN} data-review-action="reset" disabled={busy || !sel.length} type="button" onClick={() => run("reset")}>
              후보로
            </button>
            <button className={BTN} data-review-action="redo" disabled={busy || !sel.length} type="button" onClick={() => run("redo")}>
              다시 요청
            </button>
            <button className={BTN} data-review-action="default" disabled={busy || sel.length !== 1} title="승인된 그림 한 장을 골라요" type="button" onClick={() => run("default")}>
              기본 그림으로
            </button>
          </span>
        </div>
      ) : null}
      {confirm ? (
        <div className="fx-panel space-y-2 p-3 text-sm" data-review-confirm role="alert">
          <p>
            {confirm.reason}. 예상 비용 {confirm.estimatedCost}회. 그래도 다시 요청할까요?
          </p>
          <div className="flex gap-2">
            <button className={BTN} disabled={busy} type="button" onClick={() => run("redo", true)}>
              그대로 진행
            </button>
            <button className={BTN} type="button" onClick={() => setConfirm(null)}>
              취소
            </button>
          </div>
        </div>
      ) : null}
      {notice ? (
        <p className="text-sm" data-ops-notice role="status">
          {notice}
        </p>
      ) : null}
      {!list.length ? <p className="fx-panel p-3 text-sm fx-muted">조건에 맞는 그림이 없어요.</p> : null}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-review-list>
        {list.map((a) => (
          <li key={a.id} className={`fx-panel min-w-0 space-y-1 p-2 ${sel.includes(a.id) ? "outline outline-2 outline-default-700" : ""}`} data-review-art={a.id}>
            <label className="flex items-center gap-1 text-xs">
              {canEdit ? <input checked={sel.includes(a.id)} type="checkbox" onChange={() => toggle(a.id)} /> : null}
              <span className={STATUS_CLASS[a.status]}>{ART_STATUS_LABELS[a.status]}</span>
              <span className="min-w-0 truncate font-bold">{a.subject}</span>
            </label>
            <div className="flex min-h-[96px] items-center justify-center overflow-hidden rounded bg-default-100 p-1">
              <PixelImg alt={`${a.subject} ${ART_STATUS_LABELS[a.status]}`} box={128} src={a.url} />
            </div>
            <p className="truncate text-xs fx-muted">
              {kindLabel(a.kind)} · {a.cardId ? (data.cards.find((x) => x.id === a.cardId)?.name ?? "(지운 카드)") : "카드 없음"}
              {a.cardVersion ? ` 판 ${a.cardVersion}` : ""}
            </p>
            {data.cards.some((x) => x.defaultArtId === a.id) ? <p className="text-xs">★ 기본 그림</p> : null}
            <ExportChips list={data.exportsByArt[a.id] ?? []} />
            <details className="text-xs">
              <summary className="cursor-pointer fx-muted">사용 이력</summary>
              <History art={a} data={data} />
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────── 보관함 ─────────

function ArchivePane({ data }: { data: OpsData }) {
  const [open, setOpen] = useState<string | null>(null);
  const openArt = data.arts.find((a) => a.id === open) ?? null;

  if (!data.archive.length) return <p className="fx-panel p-3 text-sm fx-muted">승인된 그림이 아직 없어요. 검수함에서 승인하면 여기 대상별로 모여요.</p>;

  return (
    <div className="space-y-3" data-ops-pane="archive">
      {data.archive.map((g) => (
        <section key={g.subject} className="fx-panel space-y-2 p-3" data-archive-subject={g.subject}>
          <h3 className="text-sm font-bold">
            {g.subject} <span className="fx-muted font-normal">({g.arts.length}장)</span>
          </h3>
          <ul className="flex flex-wrap gap-2">
            {g.arts.map((a) => (
              <li key={a.id}>
                <button aria-pressed={open === a.id} className={`rounded border p-1 ${open === a.id ? "border-default-700" : "border-default-300"}`} data-archive-art={a.id} type="button" onClick={() => setOpen(open === a.id ? null : a.id)}>
                  <PixelImg alt={`${a.subject} ${a.id.slice(-4)}`} box={96} src={a.url} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {openArt ? (
        <section className="fx-panel space-y-2 p-3" data-archive-detail={openArt.id}>
          <h3 className="text-sm font-bold">
            사용 이력 — {openArt.subject} <span className="fx-muted font-normal">{kindLabel(openArt.kind)}</span>
          </h3>
          <History art={openArt} data={data} />
          <ExportChips list={data.exportsByArt[openArt.id] ?? []} />
        </section>
      ) : (
        <p className="text-xs fx-muted">그림을 누르면 어떤 카드로 만들었고 어디로 내보냈는지 이력이 나와요.</p>
      )}
    </div>
  );
}

// ───────── 내보내기 ─────────

function ExportPane({ data, canEdit }: { data: OpsData; canEdit: boolean }) {
  const router = useRouter();
  const approved = data.arts.filter((a) => a.status === "approved");
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const kind = data.link.exportKind;
  const target = kind === "folder" ? `앱 폴더 경로 — ${data.link.exportPath ?? "(경로 없음)"}` : kind === "upload" ? "서비스 업로드" : "정해지지 않음";
  const toggle = (id: string) => setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= EXPORT_LIMIT ? cur : [...cur, id]));
  const run = async () => {
    setBusy(true);
    const r = await post({ appSlug: data.appSlug, action: "export", ids: sel });

    setNotice(r.message);
    if (r.ok || r.status === 501) router.refresh();
    if (r.ok) setSel([]);
    setBusy(false);
  };

  return (
    <div className="space-y-3" data-ops-pane="export">
      <p className="fx-panel p-3 text-sm" data-export-target>
        보낼 곳: <b>{target}</b> <span className="text-xs fx-muted">(통제실의 프로젝트 연결 설정에서 바꿔요)</span>
      </p>
      {!kind ? <p className="fx-st fx-st-warn text-sm">내보낼 곳이 정해져 있지 않아요. 프로젝트 연결 설정에서 정해 주세요.</p> : null}
      {kind === "upload" && !data.uploadSupported ? (
        <p className="fx-st fx-st-warn text-sm" data-export-unsupported>
          서비스 업로드 미지원 — 이 서비스에는 그림을 받는 API가 없어요. 필요한 API 모양은 docs/studio-service-api.md 에 있어요. 누르면 &apos;미지원&apos;으로 기록만 남겨요.
        </p>
      ) : null}
      {kind === "folder" ? <p className="text-xs fx-muted">[내보내기]는 앱 수정 일감 한 건을 등록해요(그림 n장 → 경로·이름 목록, 검사는 빌드만, e2e 스크린샷 없음). 승인하면 작업 PC가 앱 폴더에 넣어요. 앱 폴더를 이 화면이 직접 고치지는 않아요.</p> : null}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs fx-muted" data-export-selected>
            {sel.length}장 선택 (최대 {EXPORT_LIMIT}장)
          </span>
          <button className={BTN} data-export-run disabled={busy || !sel.length || !kind} type="button" onClick={run}>
            내보내기
          </button>
          <button className="text-xs underline" type="button" onClick={() => setSel(approved.slice(0, EXPORT_LIMIT).map((a) => a.id))}>
            모두 고르기
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="text-sm" data-ops-notice role="status">
          {notice}
        </p>
      ) : null}
      {!approved.length ? <p className="fx-panel p-3 text-sm fx-muted">승인된 그림이 없어요.</p> : null}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-export-list>
        {approved.map((a) => (
          <li key={a.id} className={`fx-panel min-w-0 space-y-1 p-2 ${sel.includes(a.id) ? "outline outline-2 outline-default-700" : ""}`} data-export-art={a.id}>
            <label className="flex items-center gap-1 text-xs">
              {canEdit ? <input checked={sel.includes(a.id)} type="checkbox" onChange={() => toggle(a.id)} /> : null}
              <span className="min-w-0 truncate font-bold">{a.subject}</span>
            </label>
            <div className="flex min-h-[80px] items-center justify-center overflow-hidden rounded bg-default-100 p-1">
              <PixelImg alt={a.subject} box={96} src={a.url} />
            </div>
            <ExportChips list={data.exportsByArt[a.id] ?? []} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────── 생성 일정 ─────────

function ScheduleRow({ appSlug, row, canEdit }: { appSlug: string; row: OpsScheduleView; canEdit: boolean }) {
  const router = useRouter();
  const [s, setS] = useState({ enabled: row.enabled, hour: String(row.hour), count: String(row.count), subjects: row.subjects, extra: row.extra });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const input = { enabled: s.enabled, hour: Number(s.hour), count: Number(s.count), subjects: s.subjects, extra: s.extra };
  const error = scheduleError(input);
  const save = async () => {
    setBusy(true);
    const r = await post({ appSlug, action: "schedule", cardId: row.cardId, schedule: input });

    setNotice(r.message);
    if (r.ok) router.refresh();
    setBusy(false);
  };

  return (
    <li className="fx-panel space-y-2 p-3" data-schedule-card={row.cardId}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-sm font-bold">
          {canEdit ? <input checked={s.enabled} disabled={!row.cardEnabled} type="checkbox" onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> : null}
          {row.cardName}
        </label>
        <span className={s.enabled ? "fx-st fx-st-ok" : "fx-st fx-st-info"}>{row.enabled ? "켜짐" : "꺼짐"}</span>
        <span className="text-xs fx-muted">다음: {row.next}</span>
        {!row.cardEnabled ? <span className="text-xs fx-muted">카드가 꺼져 있어요</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs fx-muted">
          시각(한국 시간)
          <select className={FIELD} disabled={!canEdit} value={s.hour} onChange={(e) => setS({ ...s, hour: e.target.value })}>
            {Array.from({ length: SCHEDULE_LIMITS.hour + 1 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}시
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs fx-muted">
          대상마다 장 수
          <input className={FIELD} disabled={!canEdit} inputMode="numeric" value={s.count} onChange={(e) => setS({ ...s, count: e.target.value })} />
        </label>
        <label className="col-span-2 text-xs fx-muted">
          대상 이름(쉼표로 여러 개)
          <input className={FIELD} disabled={!canEdit} value={s.subjects} onChange={(e) => setS({ ...s, subjects: e.target.value })} />
        </label>
        <label className="col-span-2 text-xs fx-muted sm:col-span-4">
          추가 지시(선택)
          <input className={FIELD} disabled={!canEdit} maxLength={SCHEDULE_LIMITS.extra} value={s.extra} onChange={(e) => setS({ ...s, extra: e.target.value })} />
        </label>
      </div>
      {row.lastMessage ? (
        <p className="text-xs fx-muted" data-schedule-last>
          마지막 실행 {row.lastRunAt ? when(row.lastRunAt) : ""}: {row.lastMessage}
        </p>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <button className={BTN} data-schedule-save disabled={busy || (s.enabled && !!error)} type="button" onClick={save}>
            저장
          </button>
          {s.enabled && error ? <span className="text-xs fx-st fx-st-warn">{error}</span> : null}
          {notice ? (
            <span className="text-xs" data-ops-notice role="status">
              {notice}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function SchedulePane({ data, canEdit }: { data: OpsData; canEdit: boolean }) {
  return (
    <div className="space-y-3" data-ops-pane="schedule">
      <p className="text-xs fx-muted">카드마다 매일 정한 시각에 도구 일감을 만들어요. 기본은 꺼짐이에요. 비용 한도를 넘는 날은 만들지 않고 이유를 남겨요. 승인 규칙은 [제작] 탭과 같이 2-3 설정을 따라요.</p>
      {data.overlap ? (
        <p className="fx-st fx-st-warn text-sm" data-schedule-overlap role="alert">
          ⚠ {data.overlap}
        </p>
      ) : null}
      {!data.schedules.length ? <p className="fx-panel p-3 text-sm fx-muted">카드가 없어요. [구성] 탭에서 카드를 먼저 만들어 주세요.</p> : null}
      <ul className="space-y-2">
        {data.schedules.map((r) => (
          <ScheduleRow key={`${r.cardId}:${r.saved}:${r.enabled}:${r.hour}:${r.count}:${r.subjects}`} appSlug={data.appSlug} canEdit={canEdit} row={r} />
        ))}
      </ul>
    </div>
  );
}

// ───────── 서비스 운영 ─────────

function ServicePane({ data }: { data: OpsData }) {
  const router = useRouter();
  const v = data.service;

  if (!v) return <p className="fx-panel p-3 text-sm fx-muted">연결된 서비스 정보가 없어요(이 프로젝트는 서비스 API 확인표가 아직 없어요).</p>;
  const missing = v.capabilities.filter((c) => !c.present);

  return (
    <div className="space-y-3" data-ops-pane="service">
      <p className="fx-panel p-3 text-sm">
        <b>{v.name}</b> · {v.server} · 컨테이너 {v.container} · 서비스 주소 {v.baseLabel || "(없음)"}
        {v.baseProblem ? <span className="fx-st fx-st-warn ml-2 text-xs">{v.baseProblem}</span> : null}
        <span className="block text-xs fx-muted">서비스 코드·문서를 읽어 확인한 날: {v.checkedAt}. 서비스 DB는 건드리지 않고 API로만 다뤄요.</span>
      </p>
      <p className="text-sm" data-service-key>
        관리자 키 <span className="font-mono text-xs">{v.adminKey.name}</span>: {v.adminKey.ready ? <span className="fx-st fx-st-ok">등록됨</span> : <span className="fx-st fx-st-warn">키 등록 필요</span>}
        <span className="ml-1 text-xs fx-muted">(값은 화면에 나오지 않아요. 통제실 키 등록에서 서버 보관 키로 등록해요)</span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm" data-service-table>
          <thead>
            <tr className="border-b border-default-300 text-xs fx-muted">
              <th className="p-1">기능</th>
              <th className="p-1">상태</th>
              <th className="p-1">확인한 내용</th>
            </tr>
          </thead>
          <tbody>
            {v.capabilities.map((c) => (
              <tr key={c.key} className="border-b border-default-200 align-top" data-service-cap={c.key}>
                <td className="p-1 font-bold">{c.label}</td>
                <td className="p-1">
                  {c.present ? (
                    <span className="fx-st fx-st-ok">API 있음</span>
                  ) : (
                    <span className="fx-st fx-st-warn">서비스에 API 없음</span>
                  )}
                  {c.api ? <span className="block font-mono text-xs fx-muted">{c.api}</span> : null}
                  {c.keyName ? <span className="block text-xs fx-muted">{c.keyReady ? "키 등록됨" : `키 등록 필요: ${c.keyName}`}</span> : null}
                </td>
                <td className="p-1 text-xs fx-muted">{c.evidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {v.capabilities.some((c) => c.key === "review-count" && c.present) ? (
        <section className="fx-panel space-y-2 p-3" data-service-review>
          <h3 className="text-sm font-bold">검수 대기 (서비스 API에서 읽음)</h3>
          {v.reviewCount?.state === "ok" ? (
            <p className="text-sm">
              검수 {v.reviewCount.review}장 · 보류 {v.reviewCount.held}장 · 그림 대기 {v.reviewCount.pending}장
            </p>
          ) : (
            <p className="text-sm fx-muted">{v.reviewCount?.text ?? "확인하지 않았어요."}</p>
          )}
          <button className={BTN} type="button" onClick={() => router.refresh()}>
            새로 확인
          </button>
        </section>
      ) : null}
      <section className="fx-panel space-y-1 p-3" data-service-missing>
        <h3 className="text-sm font-bold">연결하지 못한 기능 ({missing.length})</h3>
        <p className="text-xs fx-muted">
          {missing.map((c) => c.label).join(" · ") || "없음"} — 단추를 만들지 않았어요. 한 컷 앱에 추가할 API 제안은 {v.proposal} 에 있어요. 실제 추가는 나중에 앱 일감으로 따로 해요.
        </p>
        {v.ownSchedule ? <p className="text-xs fx-muted">서비스 자체 일정: {v.ownSchedule}</p> : null}
      </section>
    </div>
  );
}

// ───────── 탭 ─────────

export default function OpsTab({ data, canEdit, sub, focusArt }: { data: OpsData; canEdit: boolean; sub: string; focusArt?: string }) {
  if (sub === "archive") return <ArchivePane data={data} />;
  if (sub === "export") return <ExportPane canEdit={canEdit} data={data} />;
  if (sub === "schedule") return <SchedulePane canEdit={canEdit} data={data} />;
  if (sub === "service") return <ServicePane data={data} />;

  return <ReviewPane key={focusArt ?? "all"} canEdit={canEdit} data={data} focusArt={focusArt} />;
}
