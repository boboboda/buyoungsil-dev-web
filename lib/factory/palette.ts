// lib/factory/palette.ts
// 명령 팔레트 (5-3, ⌘K / Ctrl+K). 통제실과 스튜디오에서 열리고, 앱·일감·정비·카드·템플릿·설정 항목을 찾아 가거나 명령을 바로 실행한다.
//   검색: 공백으로 나눈 낱말이 모두 이름·키워드·설명·분류 어딘가에 있어야 한다(이름 앞부분 > 이름 안 > 키워드 > 설명 순으로 점수).
//   바로 실행: "한 컷 싹이 단독 짤 2장"(앱 → 대상 → 카드 → 장 수) → 도구 일감 생성, "감독 상태", "지금 업데이트", "<앱> 스튜디오 열기"
//   위험한 동작(배포·되돌리기·재시작)은 confirm 글이 있어서 화면이 확인 창을 한 번 더 띄운다.
// DB 를 쓰지 않는 판단 함수만 둔다(시험: tests/palette.test.mjs). 자료는 /api/admin/factory/palette 가 모아 준다.

export type PaletteGroup = "명령" | "이동" | "앱" | "일감" | "정비" | "카드" | "템플릿" | "설정";

export type PaletteAction =
  | { type: "navigate"; href: string }
  | { type: "supervisor"; op: "status" | "update_now" | "restart" | "pause" | "resume" }
  | { type: "generate"; appSlug: string; card: string; subject: string; count: number };

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  hint?: string;
  keywords?: string;
  action: PaletteAction;
  confirm?: string; // 있으면 실행 전에 이 글로 확인 창을 한 번 더 띄운다
}

export const PALETTE_GROUP_ORDER: PaletteGroup[] = ["명령", "이동", "앱", "일감", "정비", "카드", "템플릿", "설정"];

export const norm = (s: string): string => s.toLowerCase().replace(/[\s·・_\-./,;:()[\]{}'"`~!?]+/g, "");

// ───────── 고정 항목 ─────────

export const STATIC_COMMANDS: PaletteItem[] = [
  { id: "cmd:sup-status", group: "명령", label: "감독 상태", hint: "연결·버전·일시 정지·대기 수를 바로 보여 줘요", keywords: "감독 프로그램 상태 연결 버전", action: { type: "supervisor", op: "status" } },
  { id: "cmd:sup-update", group: "명령", label: "지금 업데이트", hint: "GitHub main 의 새 감독 프로그램 코드를 지금 받게 해요", keywords: "감독 업데이트 갱신", action: { type: "supervisor", op: "update_now" } },
  { id: "cmd:sup-restart", group: "명령", label: "감독 재시작", hint: "진행 중 작업이 끝난 뒤 껐다 켜요", keywords: "재시작 다시 시작 restart", action: { type: "supervisor", op: "restart" }, confirm: "감독 프로그램을 재시작할까요? 진행 중인 작업이 끝난 뒤 껐다 켜지고, 잠깐 일감을 받지 않아요." },
  { id: "cmd:sup-pause", group: "명령", label: "감독 일시 정지", hint: "새 일감 받기를 멈춰요", keywords: "정지 멈춤 pause", action: { type: "supervisor", op: "pause" } },
  { id: "cmd:sup-resume", group: "명령", label: "감독 재개", hint: "새 일감 받기를 다시 시작해요", keywords: "재개 계속 resume", action: { type: "supervisor", op: "resume" } },
  { id: "cmd:deploy", group: "명령", label: "서버 배포", hint: "[현황] 할 일의 [배포] 버튼으로 가요", keywords: "배포 deploy 서버 올리기", action: { type: "navigate", href: "/admin/factory?tab=status#factory-todo" }, confirm: "서버 배포 화면으로 이동할까요? 배포는 그 화면의 [배포] 버튼을 눌러야 시작돼요." },
  { id: "cmd:revert", group: "명령", label: "배포 되돌리기", hint: "[현황] 배포 기록의 [이전 버전으로]로 가요", keywords: "되돌리기 롤백 revert 이전 버전", action: { type: "navigate", href: "/admin/factory?tab=status&history=deploys" }, confirm: "배포 기록으로 이동할까요? 되돌리기는 기록의 [이전 버전으로] 버튼을 눌러야 시작돼요." },
];

export const TAB_ITEMS: PaletteItem[] = [
  ["status", "현황", "진행 중·할 일·이력"],
  ["jobs", "일감", "앱 일감·수정 지시·템플릿"],
  ["maint", "정비", "공장 정비 대화·대기열"],
  ["supervisor", "감독", "감독 프로그램·로그"],
  ["map", "지도", "기계·에이전트·도구 지도"],
  ["studio", "스튜디오", "프로젝트·도구 연결"],
  ["novels", "작품", "소설 공장"],
  ["release", "출시", "출시 패키지"],
  ["settings", "설정", "도구함·AI·알림·키"],
  ["usage", "사용량", "장비 상태·토큰·블록별"],
].map(([key, label, hint]) => ({ id: `tab:${key}`, group: "이동" as const, label: `${label} 탭`, hint, keywords: `${label} 열기 이동`, action: { type: "navigate" as const, href: `/admin/factory?tab=${key}` } }));

export const SETTINGS_ITEMS: PaletteItem[] = [
  ["settings-run", "승인 방식", "승인 계획 먼저 바로 시작 기본 AI 동시 앱 수 루프"],
  ["settings-run", "자동 승인 규칙", "자동 승인 실험 도구 문서 템플릿"],
  ["settings-run", "기본 AI", "Claude Codex 주사용 모델"],
  ["settings-update", "감독 업데이트", "묶음 업데이트 새 커밋"],
  ["settings-parallel", "병렬화·지휘자", "같이 돌리기 병행 지휘자 승인 대기"],
  ["settings-checks", "앱 검사 명령", "합치기 최종 점검"],
  ["settings-tools", "도구 목록·요청 중계", "도구함 툴킷 중계 설명서"],
  ["settings-notify", "텔레그램·PC 토큰", "알림 작업자 토큰"],
  ["settings-keys", "키·배포 계정", "비밀 키 Studio 접근 키 배포 계정"],
  ["settings-project", "프로젝트 연결·작업 규칙", "원격 도메인 컨테이너 에이전트 정의"],
].map(([anchor, label, kw]) => ({ id: `set:${label}`, group: "설정" as const, label, hint: "설정 항목", keywords: kw, action: { type: "navigate" as const, href: `/admin/factory?tab=settings#${anchor}` } }));

// ───────── 자료 → 항목 ─────────

export interface PaletteData {
  apps: { appSlug: string; title: string }[];
  jobs: { id: string; appSlug: string; title: string; status: string; kind: string }[];
  threads: { id: string; title: string; status: string }[];
  cards: { id: string; appSlug: string; name: string }[];
  templates: { id: string; name: string; kind: string; description: string }[];
}

const KIND_KO: Record<string, string> = { new: "새 앱", revision: "수정", release: "출시", lab: "실험", tool: "도구" };
const STATUS_KO: Record<string, string> = { pending: "승인 대기", approved: "대기열", running: "진행 중", review: "검토 대기", done: "완료", failed: "실패", cancelled: "취소", linkwait: "링크 대기", needs_confirmation: "확인 대기" };

export function buildItems(data: PaletteData): PaletteItem[] {
  const items: PaletteItem[] = [...STATIC_COMMANDS, ...TAB_ITEMS, ...SETTINGS_ITEMS];

  for (const a of data.apps) items.push({ id: `app:${a.appSlug}`, group: "앱", label: a.title, hint: `${a.appSlug} · 스튜디오 열기`, keywords: `${a.appSlug} 스튜디오`, action: { type: "navigate", href: `/studio/${a.appSlug}` } });
  for (const j of data.jobs) items.push({ id: `job:${j.id}`, group: "일감", label: j.title, hint: `${j.appSlug} · ${KIND_KO[j.kind] ?? j.kind} · ${STATUS_KO[j.status] ?? j.status}`, keywords: `${j.appSlug} ${j.status}`, action: { type: "navigate", href: `/admin/factory?tab=jobs&job=${j.id}` } });
  for (const t of data.threads) items.push({ id: `thr:${t.id}`, group: "정비", label: t.title, hint: t.status === "closed" ? "닫힘" : "정비 대화", keywords: "정비 대화", action: { type: "navigate", href: `/admin/factory?tab=maint&thread=${t.id}` } });
  for (const c of data.cards) items.push({ id: `card:${c.id}`, group: "카드", label: c.name, hint: `${c.appSlug} · 카드`, keywords: `${c.appSlug} 결과물 카드`, action: { type: "navigate", href: `/studio/${c.appSlug}?tab=make` } });
  for (const t of data.templates) items.push({ id: `tpl:${t.id}`, group: "템플릿", label: t.name, hint: `${KIND_KO[t.kind] ?? t.kind} 템플릿${t.description ? ` · ${t.description}` : ""}`, keywords: "템플릿 일감 보내기", action: { type: "navigate", href: `/admin/factory?tab=jobs&template=${encodeURIComponent(t.id)}#job-templates` } });

  return items;
}

// ───────── 검색 ─────────

/** 낱말이 모두 들어 있는 항목을 점수순으로. 낱말이 없으면 명령·이동을 앞에 보여 준다 */
export function searchPalette(items: PaletteItem[], query: string, limit = 30): PaletteItem[] {
  const terms = query.split(/\s+/).map(norm).filter(Boolean);

  if (!terms.length) return items.filter((i) => i.group === "명령" || i.group === "이동").slice(0, limit);
  const scored: { item: PaletteItem; score: number; order: number }[] = [];

  items.forEach((item, order) => {
    const label = norm(item.label);
    const kw = norm(item.keywords ?? "");
    const hint = norm(item.hint ?? "");
    const group = norm(item.group);
    let total = 0;

    for (const t of terms) {
      const s = label.startsWith(t) ? 100 : label.includes(t) ? 80 : kw.includes(t) ? 60 : hint.includes(t) ? 40 : group.includes(t) ? 30 : 0;

      if (s === 0) return;
      total += s;
    }
    if (norm(query) === label) total += 200; // 이름과 똑같이 쳤다
    scored.push({ item, score: total, order });
  });

  return scored.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, limit).map((s) => s.item);
}

// ───────── 바로 실행하는 말 ─────────

const COUNT_RE = /(\d{1,3})\s*(장|개|컷|번)?\s*$/;
const OPEN_WORDS = /(열기|열어|열어줘|보기|가기|이동)\s*$/;

/** 앱 이름(표시 이름·appSlug)이 말 앞부분과 맞으면 가장 긴 것 하나와 남은 말 */
function takeApp(rest: string, apps: PaletteData["apps"]): { app: PaletteData["apps"][number]; rest: string } | null {
  const compact = norm(rest);
  let best: { app: PaletteData["apps"][number]; len: number } | null = null;

  for (const app of apps) {
    for (const name of [norm(app.title), norm(app.appSlug)]) {
      if (name.length >= 1 && compact.startsWith(name) && (!best || name.length > best.len)) best = { app, len: name.length };
    }
  }

  return best ? { app: best.app, rest: compact.slice(best.len) } : null;
}

/**
 * 타자로 친 말을 명령으로 풀어 본다. 못 풀면 빈 배열.
 *  - "<앱> <대상> <카드> <N>장"  → 도구 일감 만들기 (카드는 그 앱의 카드 이름이 말 끝에 와야 하고, 가운데 남는 말이 대상)
 *  - "<앱> 스튜디오 (열기)"      → 그 앱의 스튜디오 열기
 * 공백은 무시하고 맞춘다("한 컷 싹이 단독 짤 2장" = "한컷싹이단독짤2장").
 */
export function parseCommand(query: string, data: Pick<PaletteData, "apps" | "cards">): PaletteItem[] {
  const q = query.trim();

  if (q.length < 3) return [];
  const withoutOpen = q.replace(OPEN_WORDS, "").trim();
  const first = takeApp(withoutOpen, data.apps);

  if (!first) return [];
  const out: PaletteItem[] = [];

  // 스튜디오 열기: 앱 이름 뒤에 '스튜디오'만 남을 때
  if (norm(first.rest) === "스튜디오") out.push({ id: `cmd:studio:${first.app.appSlug}`, group: "명령", label: `${first.app.title} 스튜디오 열기`, hint: first.app.appSlug, action: { type: "navigate", href: `/studio/${first.app.appSlug}` } });

  // 카드로 생성
  const countMatch = COUNT_RE.exec(first.rest);
  const hasUnit = !!countMatch?.[2];
  const count = countMatch && (hasUnit || countMatch.index > 0) ? Number(countMatch[1]) : 1;
  const body = countMatch && (hasUnit || countMatch.index > 0) ? first.rest.slice(0, countMatch.index) : first.rest;
  let bestCard: { name: string; slug: string; len: number } | null = null;

  for (const c of data.cards) {
    if (c.appSlug !== first.app.appSlug) continue;
    const name = norm(c.name);

    if (name && body.endsWith(name) && body.length > name.length && (!bestCard || name.length > bestCard.len)) bestCard = { name: c.name, slug: c.appSlug, len: name.length };
  }
  if (bestCard && count >= 1 && count <= 20) {
    const subject = body.slice(0, body.length - bestCard.len);

    if (subject) out.push({ id: `cmd:gen:${first.app.appSlug}:${bestCard.name}:${subject}:${count}`, group: "명령", label: `${first.app.title} · ${subject} · ${bestCard.name} ${count}장 만들기`, hint: "도구 일감으로 등록해요(승인은 평소 규칙대로)", action: { type: "generate", appSlug: first.app.appSlug, card: bestCard.name, subject, count } });
  }

  return out;
}

/** 팔레트에 보일 목록: 바로 실행 항목이 맨 위, 그 아래 검색 결과 */
export function paletteResults(items: PaletteItem[], query: string, data: Pick<PaletteData, "apps" | "cards">, limit = 30): PaletteItem[] {
  const direct = parseCommand(query, data);
  const seen = new Set(direct.map((d) => d.id));

  return [...direct, ...searchPalette(items, query, limit).filter((i) => !seen.has(i.id))].slice(0, limit);
}

// ───────── 감독 상태 한 줄 ─────────

export function supervisorSummary(s: Record<string, unknown>): string {
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  const parts = [
    s.online === true ? "연결됨" : "연결 안 됨",
    typeof s.commit === "string" && s.commit ? `버전 ${s.commit.slice(0, 7)}` : "버전 모름",
    s.enabled === false ? "일시 정지" : "동작 중",
    s.autoUpdate === true ? "자동 업데이트 켜짐" : "자동 업데이트 꺼짐",
    `진행 ${n(s.running)} · 대기열 ${n(s.approved)} · 승인 대기 ${n(s.pending)}`,
  ];

  if (typeof s.drainNote === "string" && s.drainNote) parts.push(s.drainNote);
  if (typeof s.deployNote === "string" && s.deployNote) parts.push(s.deployNote);

  return parts.join(" · ");
}
