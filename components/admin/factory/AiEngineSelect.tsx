"use client";

import { useEffect, useState } from "react";
import { AI_ENGINES, AI_LABELS, isAiEngine, type AiEngine, type TaskAiEngine } from "@/lib/factory/ai";

export default function AiEngineSelect<T extends TaskAiEngine>({ value, onChange, disabled = false, allowDefault = false, label = "작업 AI" }: {
  value: T;
  onChange: (engine: NoInfer<T>) => void;
  disabled?: boolean;
  allowDefault?: boolean;
  label?: string;
}) {
  const [primary, setPrimary] = useState<AiEngine | null>(null);
  useEffect(() => {
    if (!allowDefault) return;
    let alive = true;
    const load = () => fetch("/api/admin/factory/control", { cache: "no-store" }).then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      if (alive && isAiEngine(data.defaultAiEngine)) setPrimary(data.defaultAiEngine);
    }).catch(() => {});
    void load();
    window.addEventListener("factory-default-ai-changed", load);
    return () => { alive = false; window.removeEventListener("factory-default-ai-changed", load); };
  }, [allowDefault]);
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span>{label}</span>
      <select
        aria-label={label}
        className="rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm"
        disabled={disabled}
        value={value}
        onChange={(e) => { if (isAiEngine(e.target.value) || (allowDefault && e.target.value === "default")) onChange(e.target.value as T); }}
      >
        {allowDefault && <option value="default">주사용 AI{primary ? ` (${AI_LABELS[primary]})` : ""}</option>}
        {AI_ENGINES.map((engine) => <option key={engine} value={engine}>{AI_LABELS[engine]}</option>)}
      </select>
    </label>
  );
}
