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

// Claude Code `--model` 허용 목록: 설치된 claude CLI(2.1.x)가 받는 별칭만. 감독 프로그램(ai-runner.mjs CLAUDE_MODELS)과 같은 목록이다.
// 목록에 없는 값은 서버도 감독 프로그램도 거부한다. Codex 일감에는 쓰지 않는다.
export const CLAUDE_MODELS = ["fable", "opus", "sonnet", "haiku", "best", "opusplan", "fable[1m]", "opus[1m]", "sonnet[1m]"] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];
/** 승인 화면의 선택값. "default" = 기본 설정 사용(설정 탭의 기본 모델, 없으면 Claude Code 자체 기본) */
export type TaskModel = ClaudeModel | "default";
export const CLAUDE_MODEL_LABELS: Record<ClaudeModel, string> = {
  fable: "fable — 최신 Fable",
  opus: "opus — 최신 Opus",
  sonnet: "sonnet — 최신 Sonnet",
  haiku: "haiku — 빠르고 가벼움",
  best: "best — 쓸 수 있는 가장 좋은 모델",
  opusplan: "opusplan — 계획은 Opus, 실행은 Sonnet",
  "fable[1m]": "fable[1m] — Fable · 긴 문맥(100만 토큰)",
  "opus[1m]": "opus[1m] — Opus · 긴 문맥(100만 토큰)",
  "sonnet[1m]": "sonnet[1m] — Sonnet · 긴 문맥(100만 토큰)",
};

export function isClaudeModel(value: unknown): value is ClaudeModel {
  return typeof value === "string" && (CLAUDE_MODELS as readonly string[]).includes(value);
}

/** 요청 본문의 모델 값: 없음·null·"default" → null(기본 설정), 허용 목록 → 그 값, 그 밖 → 거부 */
export function readModelChoice(value: unknown): { ok: boolean; model: ClaudeModel | null; message: string } {
  if (value === undefined || value === null || value === "default") return { ok: true, model: null, message: "" };
  if (isClaudeModel(value)) return { ok: true, model: value, message: "" };

  return { ok: false, model: null, message: `모델은 기본 설정 또는 ${CLAUDE_MODELS.join(", ")} 중에서 골라 주세요.` };
}

/** 이력 표시용 '모델: ○○'. Codex 일감은 null(표시 안 함). 값이 없으면 기본 설정 */
export function modelText(engine: string | null | undefined, model: string | null | undefined): string | null {
  if (engine === "codex") return null;

  return `모델: ${isClaudeModel(model) ? model : "기본 설정"}`;
}
