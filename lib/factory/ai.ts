// Stored engine values are independent of model names. Missing values preserve legacy behavior.
export const AI_ENGINES = ["claude", "codex"] as const;
export type AiEngine = (typeof AI_ENGINES)[number];
export type TaskAiEngine = AiEngine | "default";
export const AI_LABELS: Record<AiEngine, string> = { claude: "Claude Code", codex: "Codex" };

export function isAiEngine(value: unknown): value is AiEngine {
  return value === "claude" || value === "codex";
}

export function workerEngines(raw: string | null): AiEngine[] {
  // Old workers never receive a Codex job. Unknown capabilities grant nothing.
  if (raw === null) return ["claude"];
  return AI_ENGINES.filter((engine) => raw.split(",").includes(engine));
}
