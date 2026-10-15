// lib/factory/autoApprove.ts
// 자동 승인 규칙 (5-3). 조건을 만족하는 일감은 승인 대기를 건너뛰고 바로 대기열에 들어간다. 규칙마다 켜고 끌 수 있고 기본값은 모두 꺼짐.
//   lab      실험 일감
//   tool     비용 한도(일·월) 안의 도구 일감
//   docs     문서만 바꾸는 수정(지시문이 "문서만"이라고 밝히고 코드 파일·마이그레이션·의존성을 말하지 않을 때만)
//   template 지정한 템플릿에서 온 일감(templateIds 에 든 템플릿)
// 출시 일감과 배포는 어떤 규칙으로도 자동 승인하지 않는다(여기서 맨 먼저 막는다). 새 앱도 자동 승인하지 않는다.
// 판단 함수만 둔다(DB 없음). 시험: tests/job-templates.test.mjs

export const AUTO_RULE_KEYS = ["lab", "tool", "docs", "template"] as const;
export type AutoRuleKey = (typeof AUTO_RULE_KEYS)[number];

export const AUTO_RULE_LABELS: Record<AutoRuleKey, string> = {
  lab: "실험 일감",
  tool: "비용 한도 안의 도구 일감",
  docs: "문서만 바꾸는 수정",
  template: "지정한 템플릿에서 온 일감",
};

export const AUTO_RULE_HINTS: Record<AutoRuleKey, string> = {
  lab: "작업 PC 의 실험 폴더에서만 도는 일감(앱 코드를 바꾸지 않음)을 승인 없이 대기열에 넣어요.",
  tool: "카드로 그림을 만드는 도구 일감이 일·월 비용 한도 안이면 승인 없이 시작해요. 한도를 넘으면 평소처럼 확인을 기다려요.",
  docs: "지시문에 '문서만'이라고 적혀 있고 코드 파일·마이그레이션·의존성 이야기가 없는 수정 일감만 해당돼요. 애매하면 평소대로 승인을 기다려요.",
  template: "아래에서 고른 템플릿으로 보낸 일감만 해당돼요. 출시 일감은 템플릿으로 만들 수 없어요.",
};

export interface AutoApproveRules {
  lab: boolean;
  tool: boolean;
  docs: boolean;
  template: boolean;
  templateIds: string[]; // template 규칙이 켜졌을 때 자동 승인할 템플릿 id
}

export const DEFAULT_AUTO_RULES: AutoApproveRules = { lab: false, tool: false, docs: false, template: false, templateIds: [] };
export const MAX_AUTO_TEMPLATES = 30;

const ID_RE = /^[A-Za-z0-9_-]{1,60}$/;

/** 저장된 값(또는 화면에서 온 값) → 모양이 맞는 규칙. 모르는 값은 꺼짐 */
export function cleanAutoRules(raw: unknown): AutoApproveRules {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const ids = Array.isArray(r.templateIds) ? r.templateIds.filter((x): x is string => typeof x === "string" && ID_RE.test(x)) : [];

  return { lab: r.lab === true, tool: r.tool === true, docs: r.docs === true, template: r.template === true, templateIds: [...new Set(ids)].slice(0, MAX_AUTO_TEMPLATES) };
}

export const anyRuleOn = (rules: AutoApproveRules) => rules.lab || rules.tool || rules.docs || (rules.template && rules.templateIds.length > 0);

// ───────── 문서만 바꾸는 수정인가 ─────────

const DOCS_ONLY_RE = /문서\s*(파일\s*)?만|docs?[\s-]*only|only\s+(the\s+)?docs?/i;
const CODE_FILE_RE = /\.(tsx?|jsx?|mjs|cjs|dart|kt|kts|swift|java|py|rb|go|rs|prisma|sql|css|scss|html|gradle|ya?ml|json|xml|sh|ps1|toml|lock)\b/i;
const RISKY_RE = /마이그레이션|migration|의존성|dependenc|package\.json|배포|deploy|\.env|비밀번호|토큰|키\s*값/i;

/** 수정 일감 지시문이 '문서만' 바꾸는 일이라고 분명히 밝혔나. 확신이 없으면 false(자동 승인하지 않는다) */
export function looksDocsOnly(text: string): boolean {
  // 템플릿 머리말·작성 규칙 블록은 판단에서 뺀다(규칙 문장에 '코드' 같은 말이 들어 있다)
  const body = text.replace(/\n+## 일감 작성 규칙[\s\S]*$/, "");

  return DOCS_ONLY_RE.test(body) && !CODE_FILE_RE.test(body) && !RISKY_RE.test(body);
}

// ───────── 판단 ─────────

export interface AutoJobFacts {
  kind: string;
  releaseKind?: string | null;
  templateId?: string | null;
  planMarkdown: string;
  toolWithinLimit?: boolean; // 도구 일감: 예상 비용이 일·월 한도 안인가(호출한 쪽이 계산)
}

export interface AutoDecision {
  rule: AutoRuleKey;
  label: string;
}

/** 이 일감을 자동 승인해도 되는가. 해당하는 규칙이 없으면 null. 출시·새 앱은 항상 null */
export function decideAutoApprove(job: AutoJobFacts, rules: AutoApproveRules): AutoDecision | null {
  if (job.kind === "release" || job.releaseKind || job.kind === "new") return null;
  const pick = (rule: AutoRuleKey): AutoDecision => ({ rule, label: AUTO_RULE_LABELS[rule] });

  if (rules.template && job.templateId && rules.templateIds.includes(job.templateId) && (job.kind === "revision" || job.kind === "lab" || job.kind === "tool")) return pick("template");
  if (rules.lab && job.kind === "lab") return pick("lab");
  if (rules.tool && job.kind === "tool" && job.toolWithinLimit === true) return pick("tool");
  if (rules.docs && job.kind === "revision" && looksDocsOnly(job.planMarkdown)) return pick("docs");

  return null;
}

export const autoRuleLabel = (rule: string | null | undefined): string | null => (rule && (AUTO_RULE_KEYS as readonly string[]).includes(rule) ? AUTO_RULE_LABELS[rule as AutoRuleKey] : null);

/** 텔레그램 한 줄 */
export const autoApproveNotice = (title: string, appSlug: string, label: string) => `⚡ 자동 승인: ${title}${appSlug ? ` (${appSlug})` : ""} — 규칙: ${label}`;
