// components/admin/factory/ClaudeModelSelect.tsx
// 승인할 때 고르는 Claude Code 모델(--model). '기본 설정 사용'(설정 탭의 기본 모델, 없으면 Claude Code 자체 기본) + 허용 목록(lib/factory/ai.ts CLAUDE_MODELS).
// Codex 일감(또는 주사용 AI 가 Codex 인 '주사용 AI' 선택)에서는 숨기고 '기본 설정 사용'으로 되돌린다.
// ModelTag: 이력·목록의 '모델: ○○' 표시(Codex 는 표시 안 함).
"use client";

import { useEffect, useState } from "react";

import {
  CLAUDE_MODEL_LABELS,
  CLAUDE_MODELS,
  isAiEngine,
  isClaudeModel,
  modelText,
  type AiEngine,
  type ClaudeModel,
  type TaskModel,
} from "@/lib/factory/ai";

export interface ModelDefaults {
  model: ClaudeModel | null; // 설정 탭의 기본 모델(null = Claude Code 자체 기본)
  engine: AiEngine | null; // 주사용 AI('주사용 AI' 선택을 풀 때)
}

/** 이력의 '모델: ○○'. Codex 일감은 아무것도 보이지 않는다 */
export function ModelTag({ engine, model }: { engine?: string | null; model?: string | null }) {
  const text = modelText(engine, model);

  return text ? <span data-model={isClaudeModel(model) ? model : "default"}>{text}</span> : null;
}

/** 모델 선택을 숨길지: Codex 일감, 또는 '주사용 AI'를 골랐는데 주사용 AI 가 Codex 일 때 */
export function modelSelectHidden(engine: string | null | undefined, primary: AiEngine | null) {
  return engine === "codex" || (engine === "default" && primary === "codex");
}

export function defaultOptionText(model: ClaudeModel | null) {
  return `기본 설정 사용 (${model ?? "Claude Code 기본"})`;
}

export function ClaudeModelSelectView({
  value,
  onChange,
  disabled = false,
  label = "모델",
  defaultModel,
}: {
  value: TaskModel;
  onChange: (model: TaskModel) => void;
  disabled?: boolean;
  label?: string;
  defaultModel: ClaudeModel | null;
}) {
  return (
    <label className="flex w-full min-w-0 flex-wrap items-center gap-2 text-sm sm:w-auto" data-model-select="">
      <span>{label}</span>
      <select
        aria-label={`${label} (Claude Code)`}
        className="min-h-11 w-full min-w-0 max-w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:min-h-0 sm:w-auto sm:text-sm"
        disabled={disabled}
        value={value}
        onChange={(e) => {
          if (e.target.value === "default" || isClaudeModel(e.target.value)) onChange(e.target.value as TaskModel);
        }}
      >
        <option value="default">{defaultOptionText(defaultModel)}</option>
        {CLAUDE_MODELS.map((m) => (
          <option key={m} value={m}>
            {CLAUDE_MODEL_LABELS[m]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** defaults 를 주면 그 값을 쓰고, 안 주면 /api/admin/factory/control 에서 한 번 읽는다(설정을 바꾸면 다시 읽음) */
export default function ClaudeModelSelect({
  engine,
  value,
  onChange,
  disabled,
  label,
  defaults,
}: {
  engine: string | null | undefined;
  value: TaskModel;
  onChange: (model: TaskModel) => void;
  disabled?: boolean;
  label?: string;
  defaults?: ModelDefaults;
}) {
  const [loaded, setLoaded] = useState<ModelDefaults>({ model: null, engine: null });
  const d = defaults ?? loaded;
  const hidden = modelSelectHidden(engine, d.engine);

  useEffect(() => {
    if (defaults) return;
    let alive = true;
    const load = () =>
      fetch("/api/admin/factory/control", { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) return;
          const data = await res.json();

          if (alive)
            setLoaded({
              model: isClaudeModel(data.defaultClaudeModel) ? data.defaultClaudeModel : null,
              engine: isAiEngine(data.defaultAiEngine) ? data.defaultAiEngine : null,
            });
        })
        .catch(() => {});

    void load();
    window.addEventListener("factory-default-ai-changed", load);

    return () => {
      alive = false;
      window.removeEventListener("factory-default-ai-changed", load);
    };
  }, [defaults]);

  // 숨겨지면(Codex) 고른 모델을 풀어 서버로 보내지 않게 한다
  useEffect(() => {
    if (hidden && value !== "default") onChange("default");
  }, [hidden, value, onChange]);

  if (hidden) return null;

  return <ClaudeModelSelectView defaultModel={d.model} disabled={disabled} label={label} value={value} onChange={onChange} />;
}
