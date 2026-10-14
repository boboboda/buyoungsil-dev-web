"use client";

// 통제실 [스튜디오] 프로젝트 상세의 "결과물 카드" 카드(2-2): 이 프로젝트의 카드 목록, 카드 만들기·고치기, 카드별 변경 이력, 프로젝트 연결 설정(내보낼 곳·스튜디오 기능).
// 카드 = 이름 붙은 "이런 결과물을 이렇게 만든다": 도구·방법·옵션·참고 규칙. 도구와 방법을 고르면 옵션 입력칸이 도구 설명서에서 자동으로 생겨요.
// 키는 카드에 저장하지 않아요(방법에 맞는 키가 설명서에서 자동으로 정해지고, 여기엔 이름과 등록 여부만 보여요). 저장은 /api/admin/factory/cards, 연결 설정은 /api/admin/factory/project-links.
import { useCallback, useEffect, useMemo, useState } from "react";

import type { CardHistoryItem, CardView } from "@/lib/factory/cardsDb";
import type { CardField, CardOptions, RefRules } from "@/lib/factory/cards";
import type { LinkRow } from "@/lib/factory/projectLinks";
import ToolJobsPanel from "@/components/admin/factory/ToolJobsPanel";

interface ToolChoice {
  name: string;
  label: string;
  methods: { id: string; label: string; secrets: { name: string; ready: boolean }[] }[];
}
interface Snapshot {
  cards: CardView[];
  tools: ToolChoice[];
  fields: Record<string, Record<string, CardField[]>>;
  history?: CardHistoryItem[];
  message?: string;
  errors?: string[];
}
interface ArtLite {
  id: string;
  subject: string;
  kind: string;
  status: string;
}
interface Draft {
  id: string | null; // null = 새 카드
  name: string;
  description: string;
  tool: string;
  method: string;
  options: CardOptions;
  refRules: RefRules;
  settingsText: string;
  enabled: boolean;
}

const FIELD = "mt-1 w-full min-w-0 rounded border border-default-300 bg-transparent px-2 py-1 text-sm";
const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")}(UTC)`;
const EMPTY_RULES: RefRules = { pinDefault: false, defaultArtId: null, sameSubject: true, sameKind: true, maxRefs: null };

const newDraft = (tool: string): Draft => ({ id: null, name: "", description: "", tool, method: "", options: {}, refRules: { ...EMPTY_RULES }, settingsText: "", enabled: true });
const draftOf = (c: CardView): Draft => ({ id: c.id, name: c.name, description: c.description, tool: c.tool, method: c.method, options: { ...c.options }, refRules: { ...c.refRules }, settingsText: c.settings ? JSON.stringify(c.settings, null, 2) : "", enabled: c.enabled });

export default function CardsPanel({ appSlug }: { appSlug: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [arts, setArts] = useState<ArtLite[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [link, setLink] = useState<LinkRow | null>(null);

  const load = useCallback(
    async (cardId?: string) => {
      const r = await fetch(`/api/admin/factory/cards?appSlug=${encodeURIComponent(appSlug)}${cardId ? `&cardId=${encodeURIComponent(cardId)}` : ""}`);

      if (!r.ok) throw new Error("load");

      return (await r.json()) as Snapshot;
    },
    [appSlug],
  );

  useEffect(() => {
    let alive = true;

    setSnap(null);
    setDraft(null);
    setNotice("");
    setErrors([]);
    setLoadFailed(false);
    load()
      .then((s) => alive && setSnap(s))
      .catch(() => alive && setLoadFailed(true));
    fetch(`/api/admin/factory/arts?appSlug=${encodeURIComponent(appSlug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { arts?: ArtLite[] } | null) => alive && setArts((d?.arts ?? []).filter((a) => a.status === "approved")))
      .catch(() => {});
    fetch("/api/admin/factory/project-links")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { rows?: LinkRow[] } | null) => alive && setLink(d?.rows?.find((x) => x.appSlug === appSlug) ?? null))
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [appSlug, load]);

  const select = async (c: CardView | null) => {
    setNotice("");
    setErrors([]);
    if (!c) return setDraft(newDraft(snap?.tools[0]?.name ?? "pixel-art"));
    setDraft(draftOf(c));
    try {
      setSnap(await load(c.id));
    } catch {
      /* 이력만 못 불러옴 */
    }
  };

  const fields: CardField[] = useMemo(() => (draft && snap ? (snap.fields[draft.tool]?.[draft.method] ?? snap.fields[draft.tool]?.[""] ?? []) : []), [draft, snap]);
  const tool = snap?.tools.find((t) => t.name === draft?.tool);
  const method = tool?.methods.find((m) => m.id === draft?.method);
  const editing = draft?.id ? snap?.cards.find((c) => c.id === draft.id) : null;
  const isDefault = editing?.isDefault === true;

  const setOption = (name: string, value: string | number | undefined) =>
    setDraft((d) => {
      if (!d) return d;
      const options = { ...d.options };

      if (value === undefined || value === "") delete options[name];
      else options[name] = value;

      return { ...d, options };
    });

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setNotice("");
    setErrors([]);
    let settings: unknown;

    if (!isDefault && draft.settingsText.trim()) {
      try {
        settings = JSON.parse(draft.settingsText);
      } catch {
        setBusy(false);

        return setErrors(["설정 묶음(고급)이 올바른 JSON 이 아니에요."]);
      }
    } else if (!isDefault) settings = {};
    const card = { name: draft.name, description: draft.description, tool: draft.tool, method: draft.method, options: draft.options, refRules: draft.refRules, enabled: draft.enabled, ...(isDefault ? {} : { settings }) };

    try {
      const res = await fetch("/api/admin/factory/cards", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft.id ? { appSlug, card: draft.id, patch: card } : { appSlug, card }),
      });
      const data = (await res.json().catch(() => ({}))) as Snapshot;

      setNotice(data.message || (res.ok ? "저장했어요." : "저장하지 못했어요."));
      if (!res.ok) setErrors(data.errors ?? []);
      else {
        setSnap(data);
        const saved = data.cards.find((c) => c.id === draft.id) ?? data.cards.find((c) => c.name === draft.name);

        if (saved) setDraft(draftOf(saved));
      }
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const saveLink = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/factory/project-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appSlug, ...patch }) });
      const data = (await res.json().catch(() => ({}))) as { message?: string; rows?: LinkRow[] };

      setNotice(data.message || (res.ok ? "저장했어요." : "저장하지 못했어요."));
      if (res.ok) setLink(data.rows?.find((x) => x.appSlug === appSlug) ?? null);
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="fx-panel min-w-0 space-y-3 p-3" data-cards-panel={appSlug}>
      <h4 className="fx-label">결과물 카드</h4>
      <p className="text-sm fx-muted">카드 = 이름 붙은 &quot;이런 결과물을 이렇게 만든다&quot;예요. 도구·방법·옵션·참고 규칙을 저장해 두면 일감은 카드 이름만 부르면 돼요. 키는 카드에 저장하지 않고, 방법에 맞는 키가 도구 설명서에서 자동으로 정해져요. 새로 시작하는 일감부터 적용돼요.</p>
      {loadFailed ? <p className="text-sm fx-muted">카드를 불러오지 못했어요.</p> : null}
      {!snap && !loadFailed ? <p className="text-sm fx-muted">불러오는 중…</p> : null}
      {snap ? (
        <ul className="space-y-1" data-cards-list>
          {snap.cards.map((c) => (
            <li key={c.id}>
              <button
                className={`flex w-full min-w-0 flex-wrap items-center gap-x-2 rounded border px-2 py-1 text-left text-sm ${draft?.id === c.id ? "border-default-600" : "border-default-300"}`}
                data-card={c.id}
                type="button"
                onClick={() => void select(c)}
              >
                <span className="font-semibold">{c.name}</span>
                <span className="fx-muted">
                  {c.tool}
                  {c.method ? ` · ${c.method}` : ""} · 판 {c.version}
                </span>
                {c.isDefault ? <span className="fx-muted">(기본)</span> : null}
                {!c.enabled ? <span className="fx-muted">(사용 안 함)</span> : null}
                {c.warnings.length ? <span className="fx-muted">⚠ {c.warnings.length}</span> : null}
              </button>
            </li>
          ))}
          {!snap.cards.length ? <li className="text-sm fx-muted">아직 카드가 없어요.</li> : null}
        </ul>
      ) : null}
      {snap ? (
        <button className="rounded border border-default-300 px-3 py-1 text-sm font-semibold" data-card-new disabled={busy} type="button" onClick={() => void select(null)}>
          [+ 새 카드]
        </button>
      ) : null}

      {draft && snap ? (
        <div className="min-w-0 space-y-2 rounded border border-default-300 p-2" data-card-editor>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <label className="block min-w-0 text-sm">
              <span className="fx-label">카드 이름</span>
              <input className={FIELD} data-card-field="name" disabled={busy || isDefault} maxLength={40} placeholder="예: 싹이 단독 짤" type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="fx-label">설명</span>
              <input className={FIELD} data-card-field="description" disabled={busy} maxLength={300} type="text" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="fx-label">도구</span>
              <select className={FIELD} data-card-field="tool" disabled={busy} value={draft.tool} onChange={(e) => setDraft({ ...draft, tool: e.target.value, method: "", options: {} })}>
                {!snap.tools.some((t) => t.name === draft.tool) ? <option value={draft.tool}>{draft.tool}</option> : null}
                {snap.tools.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.label || t.name} ({t.name})
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0 text-sm">
              <span className="fx-label">방법</span>
              <select className={FIELD} data-card-field="method" disabled={busy} value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value, options: {} })}>
                <option value="">(설정의 기본 방식)</option>
                {(tool?.methods ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.id})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-sm fx-muted" data-card-secrets>
            필요한 키(설명서 기준):{" "}
            {method?.secrets.length ? method.secrets.map((s) => `${s.name}(${s.ready ? "등록됨" : "없음"})`).join(", ") : draft.method ? "없음" : "방법을 고르면 나와요"}
          </p>

          <fieldset className="min-w-0 space-y-2 rounded border border-default-300 p-2">
            <legend className="fx-label px-1">옵션 (도구 설명서의 입력 항목)</legend>
            {!fields.length ? <p className="text-sm fx-muted">이 도구·방법에는 카드에 둘 옵션이 없어요.</p> : null}
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              {fields.map((f) => (
                <label key={f.name} className="block min-w-0 text-sm" title={f.description}>
                  <span className="fx-label">{f.label}</span>
                  {f.choices ? (
                    <select className={FIELD} data-card-option={f.name} disabled={busy} value={String(draft.options[f.name] ?? "")} onChange={(e) => setOption(f.name, f.type === "int" && e.target.value ? Number(e.target.value) : e.target.value)}>
                      <option value="">(기본값)</option>
                      {f.choices.map((c) => (
                        <option key={String(c.value)} value={String(c.value)}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={FIELD}
                      data-card-option={f.name}
                      disabled={busy}
                      inputMode={f.type === "int" ? "numeric" : undefined}
                      placeholder={f.range ? `${f.range.min ?? ""}~${f.range.max ?? ""}` : "기본값"}
                      type="text"
                      value={String(draft.options[f.name] ?? "")}
                      onChange={(e) => setOption(f.name, f.type === "int" && /^\d+$/.test(e.target.value.trim()) ? Number(e.target.value.trim()) : e.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="min-w-0 space-y-2 rounded border border-default-300 p-2" data-card-rules>
            <legend className="fx-label px-1">참고 규칙</legend>
            <label className="flex items-center gap-2 text-sm">
              <input checked={draft.refRules.pinDefault} data-card-rule="pinDefault" disabled={busy} type="checkbox" onChange={(e) => setDraft({ ...draft, refRules: { ...draft.refRules, pinDefault: e.target.checked } })} />
              기본 그림을 1순위로 고정
            </label>
            {draft.refRules.pinDefault ? (
              <label className="block min-w-0 text-sm">
                <span className="fx-label">기본 그림 (승인된 그림 중에서)</span>
                <select className={FIELD} data-card-rule="defaultArtId" disabled={busy} value={draft.refRules.defaultArtId ?? ""} onChange={(e) => setDraft({ ...draft, refRules: { ...draft.refRules, defaultArtId: e.target.value || null } })}>
                  <option value="">(고르지 않음 — 고를 때까지 고정 안 됨)</option>
                  {arts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.subject} · {a.kind} · {a.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input checked={draft.refRules.sameSubject} data-card-rule="sameSubject" disabled={busy} type="checkbox" onChange={(e) => setDraft({ ...draft, refRules: { ...draft.refRules, sameSubject: e.target.checked } })} />
              같은 대상의 승인 그림 참고
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input checked={draft.refRules.sameKind} data-card-rule="sameKind" disabled={busy} type="checkbox" onChange={(e) => setDraft({ ...draft, refRules: { ...draft.refRules, sameKind: e.target.checked } })} />
              같은 종류의 승인 그림 참고
            </label>
            <label className="block min-w-0 text-sm">
              <span className="fx-label">최대 장 수 (고정 그림 포함)</span>
              <select className={FIELD} data-card-rule="maxRefs" disabled={busy} value={draft.refRules.maxRefs === null ? "" : String(draft.refRules.maxRefs)} onChange={(e) => setDraft({ ...draft, refRules: { ...draft.refRules, maxRefs: e.target.value === "" ? null : Number(e.target.value) } })}>
                <option value="">(설정을 따름)</option>
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}장
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          {isDefault ? (
            <p className="text-sm fx-muted">기본 카드의 설정 묶음(방식·규격·스타일·모션·비용·별칭)은 위의 &quot;프로젝트 도구 설정&quot;과 같이 움직여요. 거기서 고쳐 주세요.</p>
          ) : (
            <label className="block min-w-0 text-sm">
              <span className="fx-label">설정 묶음 (고급, JSON — 비우면 없음)</span>
              <textarea className={`${FIELD} font-mono`} data-card-field="settings" disabled={busy} rows={5} value={draft.settingsText} onChange={(e) => setDraft({ ...draft, settingsText: e.target.value })} />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input checked={draft.enabled} data-card-field="enabled" disabled={busy} type="checkbox" onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />이 카드를 사용해요
          </label>
          {editing?.warnings.length ? (
            <ul className="space-y-1 text-sm" data-card-warnings>
              {editing.warnings.map((w) => (
                <li key={w} className="fx-muted">
                  ⚠ {w}
                </li>
              ))}
            </ul>
          ) : null}
          {errors.length ? (
            <ul className="space-y-1 text-sm" data-card-errors role="alert">
              {errors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded border border-default-300 px-3 py-1 font-semibold" data-card-save disabled={busy || !draft.name.trim()} type="button" onClick={() => void save()}>
              [저장]
            </button>
            <button className="rounded border border-default-300 px-3 py-1" disabled={busy} type="button" onClick={() => setDraft(null)}>
              [닫기]
            </button>
            {editing ? <span className="text-sm fx-muted">판 {editing.version} · {when(editing.updatedAt)} · {editing.updatedBy}</span> : null}
          </div>
          {draft.id && snap.history ? (
            <details data-card-history>
              <summary className="cursor-pointer text-sm fx-muted">변경 이력 ({snap.history.length})</summary>
              <ul className="mt-1 space-y-1 text-sm">
                {snap.history.map((h) => (
                  <li key={h.version} className="min-w-0 break-words fx-muted">
                    판 {h.version} · {when(h.createdAt)} · <strong>{h.source}</strong>
                    {h.who ? ` (${h.who})` : ""} · {h.changed.length ? h.changed.join("·") : "처음"}
                    {h.note ? ` — ${h.note}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {link ? (
        <fieldset className="min-w-0 space-y-2 rounded border border-default-300 p-2" data-project-connect>
          <legend className="fx-label px-1">프로젝트 연결 설정</legend>
          <p className="text-xs fx-muted">승인한 그림을 내보낼 곳과 스튜디오 기능이에요. 이 프로젝트가 쓰는 카드는 위 목록(켜진 카드)이에요.</p>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <label className="block min-w-0 text-sm">
              <span className="fx-label">승인 그림을 내보낼 곳</span>
              <select className={FIELD} data-connect-field="exportKind" disabled={busy} value={link.exportKind ?? ""} onChange={(e) => void saveLink(e.target.value === "folder" ? { exportKind: "folder", exportPath: link.exportPath || "assets" } : { exportKind: e.target.value || null })}>
                <option value="">(정하지 않음)</option>
                <option value="folder">앱 폴더 경로</option>
                <option value="upload">서비스 업로드</option>
              </select>
            </label>
            {link.exportKind === "folder" ? (
              <label className="block min-w-0 text-sm">
                <span className="fx-label">앱 폴더 안 경로</span>
                <input
                  key={link.exportPath ?? ""}
                  className={FIELD}
                  data-connect-field="exportPath"
                  defaultValue={link.exportPath ?? ""}
                  disabled={busy}
                  placeholder="예: assets/sprites"
                  type="text"
                  onBlur={(e) => e.target.value.trim() !== (link.exportPath ?? "") && void saveLink({ exportKind: "folder", exportPath: e.target.value.trim() })}
                />
              </label>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <label className="flex items-center gap-2 text-sm">
              <input checked={link.studioBatch} data-connect-field="studioBatch" disabled={busy} type="checkbox" onChange={(e) => void saveLink({ studioBatch: e.target.checked })} />
              스튜디오 기능: 배치
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input checked={link.studioService} data-connect-field="studioService" disabled={busy} type="checkbox" onChange={(e) => void saveLink({ studioService: e.target.checked })} />
              스튜디오 기능: 서비스 운영
            </label>
          </div>
        </fieldset>
      ) : null}
      <ToolJobsPanel appSlug={appSlug} cards={snap?.cards ?? []} />
      {notice ? (
        <p className="text-sm fx-muted" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
