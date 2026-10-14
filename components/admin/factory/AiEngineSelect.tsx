"use client";

import { useEffect } from "react";
import { reloadControl, useFactoryControl } from "./useFactoryControl";
import { AI_ENGINES, AI_LABELS, isAiEngine, type AiEngine, type TaskAiEngine } from "@/lib/factory/ai";

export default function AiEngineSelect<T extends TaskAiEngine>({ value, onChange, disabled = false, allowDefault = false, label = "작업 AI" }: {
  value: T;
  onChange: (engine: NoInfer<T>) => void;
  disabled?: boolean;
  allowDefault?: boolean;
  label?: string;
}) {
  // 주사용 AI 는 통제실 공용 설정 읽기(한 번만 요청)에서 가져온다. 설정 카드에서 바꾸면 이벤트로 다시 읽는다
  const { data } = useFactoryControl<{ defaultAiEngine?: unknown }>();
  const primary: AiEngine | null = allowDefault && isAiEngine(data?.defaultAiEngine) ? data.defaultAiEngine : null;
  useEffect(() => {
    if (!allowDefault) return;
    const load = () => void reloadControl();
    window.addEventListener("factory-default-ai-changed", load);
    return () => window.removeEventListener("factory-default-ai-changed", load);
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
