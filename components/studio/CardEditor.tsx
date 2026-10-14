// components/studio/CardEditor.tsx
// [구성] 카드 만들기·고치기(관리자만). 저장은 2-2 의 /api/admin/factory/cards 를 그대로 쓴다(설명서 한계 검사를 통과해야 저장, 판 번호·이력은 서버가 남김).
// 도구와 방법을 고르면 입력칸이 도구 설명서에서 자동으로 생긴다. 기본 그림은 그림 저장소의 승인 그림 중에서 고른다.
// 설정 묶음(고급 JSON)은 여기서 다루지 않는다: 고칠 때는 보내지 않아 그대로 유지되고, 고치려면 통제실의 카드 패널을 쓴다. 키는 저장하지 않는다(방법에 따라 자동).
"use client";

import { useEffect, useMemo, useState } from "react";

import type { CardView } from "@/lib/factory/cardsDb";
import type { CardField, CardOptions, RefRules } from "@/lib/factory/cards";
import type { ApprovedArtLite } from "@/lib/studio/data";

interface ToolChoice {
  name: string;
  label: string;
  methods: { id: string; label: string; secrets: { name: string; ready: boolean }[] }[];
}
interface Choices {
  tools: ToolChoice[];
  fields: Record<string, Record<string, CardField[]>>;
}

const FIELD = "mt-1 w-full min-w-0 rounded border border-default-300 bg-transparent px-2 py-1 text-sm";
const EMPTY_RULES: RefRules = { pinDefault: false, defaultArtId: null, sameSubject: true, sameKind: true, maxRefs: null };

export default function CardEditor({ appSlug, card, approvedArts, onSaved, onClose }: { appSlug: string; card: CardView | null; approvedArts: readonly ApprovedArtLite[]; onSaved: (message: string) => void; onClose: () => void }) {
  const [choices, setChoices] = useState<Choices | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState(card?.name ?? "");
  const [description, setDescription] = useState(card?.description ?? "");
  const [tool, setTool] = useState(card?.tool ?? "pixel-art");
  const [method, setMethod] = useState(card?.method ?? "");
  const [options, setOptions] = useState<CardOptions>({ ...(card?.options ?? {}) });
  const [rules, setRules] = useState<RefRules>({ ...(card?.refRules ?? EMPTY_RULES) });
  const [enabled, setEnabled] = useState(card?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;

    fetch(`/api/admin/factory/cards?appSlug=${encodeURIComponent(appSlug)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Choices>) : Promise.reject(new Error("load"))))
      .then((d) => alive && setChoices({ tools: d.tools, fields: d.fields }))
      .catch(() => alive && setLoadFailed(true));

    return () => {
      alive = false;
    };
  }, [appSlug]);

  const fields: CardField[] = useMemo(() => choices?.fields[tool]?.[method] ?? choices?.fields[tool]?.[""] ?? [], [choices, tool, method]);
  const toolChoice = choices?.tools.find((t) => t.name === tool);
  const methodChoice = toolChoice?.methods.find((m) => m.id === method);
  const isDefault = card?.isDefault === true;

  const setOption = (key: string, value: string | number | undefined) =>
    setOptions((o) => {
      const next = { ...o };

      if (value === undefined || value === "") delete next[key];
      else next[key] = value;

      return next;
    });

  const save = async () => {
    setBusy(true);
    setErrors([]);
    setNotice("");
    const body = { name, description, tool, method, options, refRules: rules, enabled };

    try {
      const res = await fetch("/api/admin/factory/cards", {
        method: card ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(card ? { appSlug, card: card.id, patch: body, note: "스튜디오 구성에서 수정" } : { appSlug, card: body }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; errors?: string[] };

      if (!res.ok) {
        setNotice(data.message || "저장하지 못했어요.");
        setErrors(data.errors ?? []);
      } else onSaved(data.message || "저장했어요.");
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={card ? "카드 고치기" : "카드 만들기"} className="fx-panel min-w-0 space-y-2 p-3" data-card-editor>
      <h2 className="fx-label">{card ? `카드 고치기 — ${card.name}` : "카드 만들기"}</h2>
      {loadFailed ? <p className="text-sm fx-warn">▲ 도구 목록을 불러오지 못했어요. 새로고침 해 주세요.</p> : null}
      {!choices && !loadFailed ? <p className="text-sm fx-muted">불러오는 중…</p> : null}
      {choices ? (
        <>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <label className="block min-w-0 text-sm">
              <span className="fx-label">카드 이름</span>
              <input className={FIELD} data-card-field="name" disabled={busy || isDefault} maxLength={40} placeholder="예: 싹이 단독 짤" type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="fx-label">설명</span>
              <input className={FIELD} data-card-field="description" disabled={busy} maxLength={300} type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label className="block min-w-0 text-sm">
              <span className="fx-label">도구</span>
              <select
                className={FIELD}
                data-card-field="tool"
                disabled={busy}
                value={tool}
                onChange={(e) => {
                  setTool(e.target.value);
                  setMethod("");
                  setOptions({});
                }}
              >
                {!choices.tools.some((t) => t.name === tool) ? <option value={tool}>{tool}</option> : null}
                {choices.tools.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.label || t.name} ({t.name})
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0 text-sm">
              <span className="fx-label">방법</span>
              <select
                className={FIELD}
                data-card-field="method"
                disabled={busy}
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                  setOptions({});
                }}
              >
                <option value="">(설정의 기본 방식)</option>
                {(toolChoice?.methods ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.id})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-sm fx-muted" data-card-secrets>
            필요한 키(설명서 기준): {methodChoice?.secrets.length ? methodChoice.secrets.map((s) => `${s.name}(${s.ready ? "등록됨" : "없음"})`).join(", ") : method ? "없음" : "방법을 고르면 나와요"}
          </p>

          <fieldset className="min-w-0 space-y-2 rounded border border-default-300 p-2">
            <legend className="fx-label px-1">옵션 (도구 설명서의 입력 항목)</legend>
            {!fields.length ? <p className="text-sm fx-muted">이 도구·방법에는 카드에 둘 옵션이 없어요.</p> : null}
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              {fields.map((f) => (
                <label key={f.name} className="block min-w-0 text-sm" title={f.description}>
                  <span className="fx-label">{f.label}</span>
                  {f.choices ? (
                    <select className={FIELD} data-card-option={f.name} disabled={busy} value={String(options[f.name] ?? "")} onChange={(e) => setOption(f.name, f.type === "int" && e.target.value ? Number(e.target.value) : e.target.value)}>
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
                      value={String(options[f.name] ?? "")}
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
              <input checked={rules.pinDefault} data-card-rule="pinDefault" disabled={busy} type="checkbox" onChange={(e) => setRules({ ...rules, pinDefault: e.target.checked })} />
              기본 그림을 1순위로 고정
            </label>
            {rules.pinDefault ? (
              <label className="block min-w-0 text-sm">
                <span className="fx-label">기본 그림 (그림 저장소의 승인 그림 중에서)</span>
                <select className={FIELD} data-card-rule="defaultArtId" disabled={busy} value={rules.defaultArtId ?? ""} onChange={(e) => setRules({ ...rules, defaultArtId: e.target.value || null })}>
                  <option value="">(고르지 않음 — 고를 때까지 고정 안 됨)</option>
                  {approvedArts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.subject} · {a.kind} · {a.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
                {!approvedArts.length ? <span className="text-xs fx-muted">승인된 그림이 아직 없어요.</span> : null}
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input checked={rules.sameSubject} data-card-rule="sameSubject" disabled={busy} type="checkbox" onChange={(e) => setRules({ ...rules, sameSubject: e.target.checked })} />
              같은 대상의 승인 그림 참고
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input checked={rules.sameKind} data-card-rule="sameKind" disabled={busy} type="checkbox" onChange={(e) => setRules({ ...rules, sameKind: e.target.checked })} />
              같은 종류의 승인 그림 참고
            </label>
            <label className="block min-w-0 text-sm">
              <span className="fx-label">최대 장 수 (고정 그림 포함)</span>
              <select className={FIELD} data-card-rule="maxRefs" disabled={busy} value={rules.maxRefs === null ? "" : String(rules.maxRefs)} onChange={(e) => setRules({ ...rules, maxRefs: e.target.value === "" ? null : Number(e.target.value) })}>
                <option value="">(설정을 따름)</option>
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}장
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input checked={enabled} data-card-field="enabled" disabled={busy} type="checkbox" onChange={(e) => setEnabled(e.target.checked)} />이 카드를 사용해요 (끄면 일감이 이 카드를 못 불러요)
          </label>
          {errors.length ? (
            <ul className="space-y-1 text-sm fx-bad" data-card-errors role="alert">
              {errors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          ) : null}
          {notice ? (
            <p className="text-sm fx-muted" role="status">
              {notice}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button className="fx-btn fx-btn-sm font-semibold" data-card-save disabled={busy || !name.trim()} type="button" onClick={() => void save()}>
              [저장]
            </button>
            <button className="fx-btn fx-btn-sm" disabled={busy} type="button" onClick={onClose}>
              [닫기]
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
