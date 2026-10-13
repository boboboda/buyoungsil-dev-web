"use client";

// 툴킷 도구 하나의 '용도' 고르기(게임용 / 움짤·컷용 / 공용 / 미분류). 고르면 바로 저장하고, '자동 추정'으로 되돌릴 수도 있다.
import { useState } from "react";
import { PURPOSE_LABELS, PURPOSES, isPurpose, type Purpose } from "@/lib/factory/toolkit";

export default function ToolkitPurposeSelect({ id, purpose, source, guess }: { id: string; purpose: Purpose; source: "saved" | "guess"; guess: Purpose }) {
  const [cur, setCur] = useState<{ purpose: Purpose; source: "saved" | "guess" }>({ purpose, source });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const save = async (value: string) => {
    const next = value === "auto" ? null : isPurpose(value) ? value : undefined;

    if (next === undefined) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/factory/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toolPurpose: { id, purpose: next } }) });
      const data = await res.json().catch(() => ({}));

      setNotice(data.message || "저장하지 못했어요.");
      if (res.ok) setCur(next ? { purpose: next, source: "saved" } : { purpose: guess, source: "guess" });
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-purpose={cur.purpose} data-purpose-source={cur.source}>
      <label className="flex items-center gap-1">
        <span className="fx-muted">용도</span>
        <select aria-label={`${id} 용도`} className="rounded border border-default-300 bg-transparent px-1 py-0.5" disabled={busy} value={cur.source === "saved" ? cur.purpose : "auto"} onChange={(e) => void save(e.target.value)}>
          <option value="auto">자동 추정 · {PURPOSE_LABELS[guess]}</option>
          {PURPOSES.map((p) => (
            <option key={p} value={p}>
              {PURPOSE_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <b>{PURPOSE_LABELS[cur.purpose]}</b>
      <span className="fx-muted">{cur.source === "saved" ? "(관리자가 정함)" : "(추정)"}</span>
      {notice ? (
        <span className="fx-muted" role="status">
          {notice}
        </span>
      ) : null}
    </span>
  );
}
