"use client";

import { AI_ENGINES, AI_LABELS, isAiEngine, type AiEngine } from "@/lib/factory/ai";

export default function AiEngineSelect({ value, onChange, disabled = false }: {
  value: AiEngine;
  onChange: (engine: AiEngine) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span>작업 AI</span>
      <select
        aria-label="작업 AI"
        className="rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm"
        disabled={disabled}
        value={value}
        onChange={(e) => { if (isAiEngine(e.target.value)) onChange(e.target.value); }}
      >
        {AI_ENGINES.map((engine) => <option key={engine} value={engine}>{AI_LABELS[engine]}</option>)}
      </select>
    </label>
  );
}
