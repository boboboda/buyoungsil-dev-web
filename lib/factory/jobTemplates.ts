// lib/factory/jobTemplates.ts
// 일감 템플릿 (5-3). 자주 쓰는 지시를 이름·종류·지시문 틀·기본 우선순위·필요한 키·승인 방식으로 저장해 두고, 빈칸만 채워 등록한다.
//   종류: revision(앱 수정) | lab(실험) | tool(도구: 카드로 바로 생성). 출시·새 앱은 템플릿으로 보내지 않는다(출시는 전용 도구로만).
//   지시문 틀의 빈칸: {{이름}} (꼭 채워야 함) 또는 {{이름=기본값}} (비우면 기본값). 채운 값 안의 {{…}} 는 다시 풀지 않는다(한 번만 바꾼다).
//   승인 방식: default(설정 기본값) | now(바로 시작) | plan(계획 먼저, 5-1).
// 이 파일은 DB 를 쓰지 않는 판단 함수만 둔다(시험: tests/job-templates.test.mjs). 저장·등록은 jobTemplatesDb.ts.

export const TEMPLATE_KINDS = ["revision", "lab", "tool"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = { revision: "앱 수정", lab: "실험", tool: "도구(카드로 생성)" };
export const APPROVAL_MODES = ["default", "now", "plan"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];
export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = { default: "설정 기본값", now: "바로 시작", plan: "계획 먼저" };

export const MAX_TEMPLATE_BODY = 5000;
export const MAX_TEMPLATE_NAME = 40;
export const MAX_VALUE_LEN = 2000;
export const MAX_VARS = 12;
export const BUILTIN_PREFIX = "builtin-";

export interface TemplateDef {
  id: string;
  name: string;
  kind: TemplateKind;
  body: string;
  description: string;
  priority: number;
  requiredSecrets: string[];
  approvalMode: ApprovalMode;
  cardName: string | null;
  toolCount: number | null;
  builtin: boolean;
}

/** 일감 작성 규칙: 기본 템플릿 끝에 붙고, 채팅(커넥터) 안내에도 같은 문장이 들어간다 */
export const JOB_WRITING_RULES = [
  "측정·조사·시뮬레이션처럼 코드를 바꾸지 않는 일은 수정 일감이 아니라 실험 일감으로 보낸다.",
  "e2e(처음부터 끝까지) 시험은 일감 맨 마지막에 한 번만 돌린다. 중간 단계마다 돌리지 않는다.",
  "요청하지 않은 부분은 바꾸지 않는다. 고칠 파일·화면·기대 결과를 구체적으로 적는다.",
].map((l) => `- ${l}`).join("\n");

const RULES_BLOCK = `\n\n## 일감 작성 규칙\n${JOB_WRITING_RULES}`;

const builtin = (slug: string, name: string, kind: TemplateKind, description: string, body: string, extra: Partial<TemplateDef> = {}): TemplateDef => ({
  id: `${BUILTIN_PREFIX}${slug}`,
  name,
  kind,
  body: body + RULES_BLOCK,
  description,
  priority: 0,
  requiredSecrets: [],
  approvalMode: "default",
  cardName: null,
  toolCount: null,
  builtin: true,
  ...extra,
});

export const BUILTIN_TEMPLATES: readonly TemplateDef[] = [
  builtin(
    "web-deploy",
    "웹 배포",
    "revision",
    "웹 앱을 서버에 올릴 준비(빌드·환경 설정 점검)를 하는 수정 일감. 실제 서버 배포는 사람이 한다.",
    "웹 배포를 준비하세요. 배포 대상: {{배포 대상=기존 설정 그대로}}.\n- 프로덕션 빌드가 오류 없이 끝나는지 확인하고, 실패하면 원인만 고치세요.\n- 배포에 필요한 환경 변수·설정 파일이 빠졌으면 목록으로 적으세요(값은 적지 마세요).\n- 서버 접속·배포·push 는 하지 마세요(사람이 합니다).\n- 마지막에 바뀐 점과 사람이 할 일을 짧게 보고하세요.",
  ),
  builtin(
    "store-text",
    "스토어 문구 수정",
    "revision",
    "스토어 제목·소개 같은 문구만 고치는 수정 일감.",
    "스토어 문구를 수정하세요.\n- 바꿀 항목: {{항목}}\n- 새 문구: {{새 문구}}\n- 글자 수 제한을 넘지 않는지 확인하고, 다른 문구는 건드리지 마세요.",
  ),
  builtin(
    "deps-update",
    "의존성 업데이트",
    "revision",
    "패키지 버전을 올리고 빌드·시험이 깨지지 않는지 확인하는 수정 일감.",
    "의존성을 업데이트하세요. 범위: {{범위=보안 패치와 마이너 업데이트}}.\n- 메이저 버전은 올리지 마세요(필요하면 이유만 보고).\n- 올린 뒤 빌드와 기존 시험이 통과하는지 확인하고, 깨지면 원인만 고치세요.\n- 올린 패키지와 이전·이후 버전을 보고에 표로 적으세요.",
  ),
  builtin(
    "bug-fix",
    "버그 재현 후 수정",
    "revision",
    "먼저 재현하는 시험을 만들고, 그 시험이 통과하게 고치는 수정 일감.",
    "버그를 재현한 뒤 고치세요.\n- 증상: {{증상}}\n- 재현 방법: {{재현 방법=아직 모름: 코드를 보고 찾으세요}}\n- 먼저 실패하는 재현 시험을 만들고, 원인을 고쳐서 통과시키세요. 재현이 안 되면 억지로 고치지 말고 알려 주세요.\n- 관련 없는 정리는 하지 마세요.",
  ),
  builtin(
    "measure-only",
    "측정만 (실험 일감)",
    "lab",
    "코드를 바꾸지 않고 숫자·결과만 재는 실험 일감. 결과는 report.md 와 outputs 에 남긴다.",
    "측정만 하세요. 코드는 바꾸지 않습니다.\n- 측정 대상: {{측정 대상}}\n- 방법: {{방법=같은 조건에서 3번 재서 평균을 냅니다}}\n- 결과 표는 report.md 에, 그림·영상은 outputs 폴더에 저장하세요.\n- 결과가 좋으면 어떤 수정 일감으로 이어가면 좋은지 한두 줄로 제안하세요.",
  ),
];

// ───────── 빈칸 ─────────

const VAR_RE = /\{\{\s*([^{}=\n]{1,30}?)\s*(?:=([^{}\n]{0,200}))?\}\}/g;

export interface TemplateVar {
  name: string;
  fallback: string | null;
}

/** 지시문 틀의 빈칸 목록(처음 나온 순서, 같은 이름은 하나. 기본값은 처음 적힌 것) */
export function templateVars(body: string): TemplateVar[] {
  const seen = new Map<string, TemplateVar>();

  for (const m of body.matchAll(VAR_RE)) {
    const name = m[1].trim();

    if (!name || seen.has(name)) continue;
    seen.set(name, { name, fallback: m[2] === undefined ? null : m[2].trim() });
  }

  return [...seen.values()];
}

const cleanValue = (v: unknown): string => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n/g, "\n").trim().slice(0, MAX_VALUE_LEN) : "");

export type FillResult = { ok: true; text: string } | { ok: false; missing: string[] };

/** 빈칸을 값으로 채운다. 값이 비면 기본값, 기본값도 없으면 missing 에 모아 실패 */
export function fillTemplate(body: string, values: unknown): FillResult {
  const given = values && typeof values === "object" && !Array.isArray(values) ? (values as Record<string, unknown>) : {};
  const vars = templateVars(body);
  const resolved = new Map<string, string>();
  const missing: string[] = [];

  for (const v of vars) {
    const typed = cleanValue(given[v.name]);
    const value = typed || (v.fallback ?? "");

    if (!value) missing.push(v.name);
    else resolved.set(v.name, value);
  }
  if (missing.length) return { ok: false, missing };

  return { ok: true, text: body.replace(VAR_RE, (_all, name: string) => resolved.get(name.trim()) ?? "") };
}

// ───────── 저장할 템플릿 검사 ─────────

const oneLine = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const SECRET_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export type TemplateInput = Omit<TemplateDef, "id" | "builtin">;
export type TemplateCheck = { ok: true; value: TemplateInput } | { ok: false; message: string };

export function cleanTemplateInput(raw: unknown): TemplateCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "템플릿 형식이 올바르지 않아요." };
  const r = raw as Record<string, unknown>;
  const name = oneLine(r.name, MAX_TEMPLATE_NAME);
  const kind = r.kind;

  if (!name) return { ok: false, message: "템플릿 이름을 적어 주세요." };
  if (BUILTIN_TEMPLATES.some((b) => b.name === name)) return { ok: false, message: "기본 템플릿과 같은 이름은 쓸 수 없어요." };
  if (typeof kind !== "string" || !(TEMPLATE_KINDS as readonly string[]).includes(kind)) return { ok: false, message: "종류는 수정·실험·도구 중에서 골라 주세요(출시 일감은 템플릿으로 보내지 않아요)." };
  const body = typeof r.body === "string" ? r.body.replace(/\r\n/g, "\n").trim() : "";

  if (body.length < 5) return { ok: false, message: "지시문 틀을 5자 이상 적어 주세요." };
  if (body.length > MAX_TEMPLATE_BODY) return { ok: false, message: `지시문 틀은 ${MAX_TEMPLATE_BODY}자 이하로 적어 주세요.` };
  if (templateVars(body).length > MAX_VARS) return { ok: false, message: `빈칸은 ${MAX_VARS}개까지예요.` };
  const priority = r.priority === undefined || r.priority === null || r.priority === "" ? 0 : Number(r.priority);

  if (!Number.isInteger(priority) || priority < -100 || priority > 100) return { ok: false, message: "우선순위는 -100~100 사이 정수예요." };
  const approvalMode = r.approvalMode === undefined ? "default" : r.approvalMode;

  if (typeof approvalMode !== "string" || !(APPROVAL_MODES as readonly string[]).includes(approvalMode)) return { ok: false, message: "승인 방식은 설정 기본값·바로 시작·계획 먼저 중에서 골라 주세요." };
  const secretsRaw = r.requiredSecrets === undefined ? [] : r.requiredSecrets;

  if (!Array.isArray(secretsRaw) || secretsRaw.some((s) => typeof s !== "string")) return { ok: false, message: "필요한 키는 키 이름 목록이에요." };
  const requiredSecrets = [...new Set((secretsRaw as string[]).map((s) => s.trim()).filter(Boolean))];

  if (requiredSecrets.length > 10) return { ok: false, message: "필요한 키는 최대 10개예요." };
  if (requiredSecrets.some((s) => !SECRET_RE.test(s))) return { ok: false, message: "키 이름은 영문 대문자·숫자·밑줄이에요." };
  let cardName: string | null = null;
  let toolCount: number | null = null;

  if (kind === "tool") {
    cardName = oneLine(r.cardName, 60) || null;
    if (!cardName) return { ok: false, message: "도구 템플릿은 쓸 카드 이름이 필요해요." };
    const n = r.toolCount === undefined || r.toolCount === null || r.toolCount === "" ? 1 : Number(r.toolCount);

    if (!Number.isInteger(n) || n < 1 || n > 20) return { ok: false, message: "장 수는 1~20 정수예요." };
    toolCount = n;
  }

  return {
    ok: true,
    value: { name, kind: kind as TemplateKind, body, description: oneLine(r.description, 200), priority, requiredSecrets, approvalMode: approvalMode as ApprovalMode, cardName, toolCount },
  };
}

/** 수정·실험 일감 지시문: 채운 본문 앞에 머리말을 붙여 기획서 최소 길이를 채운다(통제실 수정 지시와 같은 머리말) */
export function instructionFromTemplate(t: Pick<TemplateDef, "name" | "kind">, filled: string): string {
  const head = t.kind === "lab" ? `# 실험 지시 (템플릿: ${t.name})\n\n코드를 고치는 일이 아니라 확인·측정하는 일입니다. 아래 내용만 하세요.\n\n` : `# 수정 지시 (템플릿: ${t.name})\n\n아래 내용만 고치세요. 요청하지 않은 부분은 바꾸지 마세요.\n\n`;

  return head + filled;
}

export const isBuiltinTemplateId = (id: string) => id.startsWith(BUILTIN_PREFIX);
