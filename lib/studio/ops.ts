// lib/studio/ops.ts
// 공용 스튜디오 [운영] 탭(3-3)의 순수 계산: 검수함 필터·일괄 처리 묶기, 보관함 묶기, 내보내기 목록·앱 수정 일감 지시문, 사용 이력, 생성 일정(언제 만들지·검사·겹침 경고).
// DB·화면 없음(읽기·쓰기는 lib/studio/opsData.ts, 그리기는 components/studio/OpsTab.tsx). 키 값은 다루지 않는다.
import { canonicalSubject, groupBySubject, isHttpUrl, type ArtView } from "@/lib/factory/arts";
import { RESULT_KIND_LABELS } from "@/lib/factory/projectToolSettings";
import { parseSubjects } from "@/lib/studio/make";

// ───────── 검수함 ─────────

export const OPS_BULK_LIMIT = 50; // 한 번에 처리할 수 있는 그림 수
export const REVIEW_ACTIONS = ["approve", "reject", "reset", "redo", "default"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];
export const REVIEW_ACTION_LABELS: Record<ReviewAction, string> = { approve: "승인", reject: "반려", reset: "후보로 되돌림", redo: "다시 요청", default: "기본 그림으로 지정" };
export const isReviewAction = (v: unknown): v is ReviewAction => typeof v === "string" && (REVIEW_ACTIONS as readonly string[]).includes(v);

export interface ReviewFilter {
  status?: string; // candidate | approved | rejected | "" (모두)
  cardId?: string; // "" = 모두, "none" = 카드 없이 만든 그림
  subject?: string; // 대표 이름(별칭 묶음)
  kind?: string;
}

export const NO_CARD = "none";

/** 카드별·대상별(별칭은 대표 이름으로 묶음)·종류별·상태별로 거른다. 새 것이 먼저 */
export function filterArts(arts: readonly ArtView[], f: ReviewFilter, aliases: unknown): ArtView[] {
  return arts
    .filter((a) => !f.status || a.status === f.status)
    .filter((a) => !f.cardId || (f.cardId === NO_CARD ? !a.cardId : a.cardId === f.cardId))
    .filter((a) => !f.subject || canonicalSubject(a.subject, aliases) === f.subject)
    .filter((a) => !f.kind || a.kind === f.kind)
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

export interface FilterChoices {
  cards: { id: string; name: string; count: number }[];
  subjects: { name: string; count: number }[];
  kinds: { id: string; label: string; count: number }[];
}

/** 필터 선택지(그림이 실제로 있는 값만, 개수와 함께) */
export function filterChoices(arts: readonly ArtView[], cardNames: ReadonlyMap<string, string>, aliases: unknown): FilterChoices {
  const cards = new Map<string, number>();
  const subjects = new Map<string, number>();
  const kinds = new Map<string, number>();

  for (const a of arts) {
    const c = a.cardId ?? NO_CARD;
    const s = canonicalSubject(a.subject, aliases);

    cards.set(c, (cards.get(c) ?? 0) + 1);
    subjects.set(s, (subjects.get(s) ?? 0) + 1);
    kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1);
  }

  return {
    cards: [...cards.entries()].map(([id, count]) => ({ id, name: id === NO_CARD ? "카드 없이 만든 그림" : (cardNames.get(id) ?? "(지운 카드)"), count })).sort((a, b) => a.name.localeCompare(b.name)),
    subjects: [...subjects.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    kinds: [...kinds.entries()].map(([id, count]) => ({ id, label: RESULT_KIND_LABELS[id as keyof typeof RESULT_KIND_LABELS] ?? id, count })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** 고른 그림 id 정리: 문자열만, 중복 제거, 상한. 비었거나 상한을 넘으면 오류 글자 */
export function pickIds(raw: unknown, limit = OPS_BULK_LIMIT): { ok: true; ids: string[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: "그림을 하나 이상 골라 주세요." };
  const ids = [...new Set(raw.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x)))];

  if (!ids.length) return { ok: false, message: "그림을 하나 이상 골라 주세요." };
  if (ids.length > limit) return { ok: false, message: `한 번에 ${limit}장까지 처리할 수 있어요.` };

  return { ok: true, ids };
}

/** 다시 요청: 같은 카드·같은 대상으로 묶는다(그림 n장 = 그 대상 n장). 카드 없이 만든 그림은 건너뛴다 */
export function redoGroups(arts: readonly Pick<ArtView, "id" | "cardId" | "subject">[]): { groups: { cardId: string; subject: string; count: number; artIds: string[] }[]; skipped: string[] } {
  const map = new Map<string, { cardId: string; subject: string; count: number; artIds: string[] }>();
  const skipped: string[] = [];

  for (const a of arts) {
    if (!a.cardId) {
      skipped.push(a.id);
      continue;
    }
    const key = `${a.cardId}\n${a.subject}`;
    const g = map.get(key) ?? { cardId: a.cardId, subject: a.subject, count: 0, artIds: [] };

    g.count++;
    g.artIds.push(a.id);
    map.set(key, g);
  }
  // 한 일감의 장 수 상한(8)을 넘으면 나눈다
  const groups: { cardId: string; subject: string; count: number; artIds: string[] }[] = [];

  for (const g of map.values()) {
    for (let i = 0; i < g.artIds.length; i += 8) groups.push({ ...g, count: Math.min(8, g.artIds.length - i), artIds: g.artIds.slice(i, i + 8) });
  }

  return { groups, skipped };
}

// ───────── 보관함 ─────────

export interface ArchiveGroup {
  subject: string;
  arts: ArtView[];
}

/** 승인된 그림만 대상(별칭 포함)별로. 대상 안에서는 새 승인이 먼저 */
export function archiveGroups(arts: readonly ArtView[], aliases: unknown): ArchiveGroup[] {
  return groupBySubject(arts.filter((a) => a.status === "approved"), aliases).map((g) => ({ subject: g.subject, arts: [...g.arts].sort((x, y) => (y.decidedAt ?? y.createdAt).localeCompare(x.decidedAt ?? x.createdAt)) }));
}

// ───────── 사용 이력 ─────────

export interface ExportRecord {
  id: string;
  artId: string;
  kind: string; // folder | upload
  status: string; // requested | done | failed | unsupported
  jobId: string | null;
  dest: string;
  note: string;
  who: string;
  createdAt: string;
}

export const EXPORT_STATUS_LABELS: Record<string, string> = { requested: "일감 등록됨", done: "보냄", failed: "실패", unsupported: "서비스 업로드 미지원" };

export interface UsageEvent {
  at: string;
  text: string;
}

/** 그림 하나의 사용 이력: 어떤 카드(판)로 만들었는지 → 승인·반려 → 어디로 내보냈는지 → 참고로 쓴 일감. 오래된 것이 위 */
export function usageHistory(args: { art: ArtView; cardName: string; exports: readonly ExportRecord[]; usedAsRefIn?: readonly { jobId: string; title: string; at: string }[] }): UsageEvent[] {
  const { art } = args;
  const ev: UsageEvent[] = [];

  ev.push({
    at: art.createdAt,
    text: art.cardId ? `카드 '${args.cardName || "(지운 카드)"}'${art.cardVersion ? ` 판 ${art.cardVersion}` : ""}로 만듦${art.jobId ? ` (일감 ${art.jobId})` : ""}` : art.jobId ? `카드 없이 일감 ${art.jobId}로 만듦` : "손으로 올린 처음 값",
  });
  if (art.decidedAt) ev.push({ at: art.decidedAt, text: `${art.status === "approved" ? "승인" : art.status === "rejected" ? "반려" : "결정"}${art.decidedBy ? ` (${art.decidedBy})` : ""}` });
  for (const x of args.exports) {
    ev.push({ at: x.createdAt, text: `${x.kind === "folder" ? "앱 폴더" : "서비스 업로드"}로 내보냄 — ${EXPORT_STATUS_LABELS[x.status] ?? x.status}${x.dest ? ` · ${x.dest}` : ""}${x.jobId ? ` · 일감 ${x.jobId}` : ""}${x.note ? ` · ${x.note}` : ""}` });
  }
  for (const u of args.usedAsRefIn ?? []) ev.push({ at: u.at, text: `참고 그림으로 골라 쓴 일감: ${u.title}` });

  return ev.sort((a, b) => a.at.localeCompare(b.at));
}

// ───────── 내보내기 ─────────

export const EXPORT_LIMIT = 30; // 일감 하나에 담는 그림 수

const EXT_RE = /\.(png|gif|webp|jpg|jpeg|mp4|webm)(?:$|[?#])/i;

/** 그림 주소에서 확장자(없으면 png) */
export const artExtension = (url: string): string => (EXT_RE.exec(url)?.[1] ?? "png").toLowerCase().replace("jpeg", "jpg");

/** 받을 파일 이름: <대상>-<그림 id 끝 6자>.<확장자>. 대상 이름의 공백·특수문자는 '-' 로 */
export function exportFileName(art: Pick<ArtView, "id" | "subject" | "url">): string {
  const base = art.subject.normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "art";

  return `${base}-${art.id.slice(-6)}.${artExtension(art.url)}`;
}

export interface ExportItem {
  artId: string;
  url: string;
  subject: string;
  fileName: string;
  path: string; // 앱 폴더 안 상대 경로(폴더 + 파일 이름)
}

/** 앱 폴더 경로 + 승인 그림 → 넣을 목록. 승인 그림이 아니거나 주소가 이상한 것은 skipped */
export function buildExportItems(arts: readonly ArtView[], exportPath: string): { items: ExportItem[]; skipped: { artId: string; reason: string }[] } {
  const dir = exportPath.replace(/\\/g, "/").replace(/\/+$/g, "");
  const items: ExportItem[] = [];
  const skipped: { artId: string; reason: string }[] = [];
  const used = new Set<string>();

  for (const a of arts) {
    if (a.status !== "approved") {
      skipped.push({ artId: a.id, reason: "승인된 그림만 내보낼 수 있어요" });
      continue;
    }
    if (!isHttpUrl(a.url)) {
      skipped.push({ artId: a.id, reason: "그림 주소가 올바르지 않아요" });
      continue;
    }
    const fileName = exportFileName(a);

    if (used.has(fileName)) {
      skipped.push({ artId: a.id, reason: "같은 파일 이름이 겹쳐요" });
      continue;
    }
    used.add(fileName);
    items.push({ artId: a.id, url: a.url, subject: a.subject, fileName, path: dir ? `${dir}/${fileName}` : fileName });
  }

  return { items, skipped };
}

/**
 * 앱 폴더에 넣는 '앱 수정 일감' 지시문: "이 그림 n장을 이 경로에 이 이름으로" 목록.
 * 검사는 빌드만, e2e 스크린샷은 하지 않는다. 그림 파일만 넣고 코드는 건드리지 않는다.
 */
export function buildExportPlan(appSlug: string, items: readonly ExportItem[]): string {
  const rows = items.map((it, i) => `${i + 1}. 받을 주소: ${it.url}\n   넣을 곳: ${it.path}   (대상: ${it.subject})`);

  return [
    `# 승인 그림 ${items.length}장을 앱 폴더에 넣기 (${appSlug})`,
    "",
    "스튜디오에서 승인한 그림 파일을 앱 폴더 안 지정한 경로에 지정한 이름으로 넣어 주세요. 아래 목록이 전부이고, 목록에 없는 일은 하지 않습니다.",
    "",
    "## 넣을 그림",
    ...rows,
    "",
    "## 규칙",
    "- 각 주소의 파일을 내려받아 그대로 저장합니다. 크기·색·형식을 바꾸거나 다시 그리지 않습니다.",
    "- 폴더가 없으면 만듭니다. 같은 이름의 파일이 이미 있으면 덮어쓰지 말고 건너뛰고 결과에 적습니다.",
    "- 그림 파일만 추가합니다. 소스 코드·설정·에셋 목록(pubspec 등)은 바꾸지 않습니다. 에셋 등록이 꼭 필요해 보이면 바꾸지 말고 결과에 필요한 내용만 적습니다.",
    "- e2e 스크린샷은 찍지 않습니다. 검사는 빌드만 합니다.",
    "- 끝나면 넣은 파일 목록과 건너뛴 파일을 결과에 적습니다.",
  ].join("\n");
}

export const exportJobTitle = (count: number) => `승인 그림 ${count}장 앱 폴더에 넣기`;

// ───────── 생성 일정 ─────────

export const SCHEDULE_LIMITS = { hour: 23, count: 8, subjects: 8, total: 16, extra: 500 } as const;
const KST_MS = 9 * 3600 * 1000;

/** 한국 날짜 키(YYYY-MM-DD)와 시(0~23) */
export function kstNow(now: Date | number): { key: string; hour: number } {
  const t = new Date((typeof now === "number" ? now : now.getTime()) + KST_MS);

  return { key: t.toISOString().slice(0, 10), hour: t.getUTCHours() };
}

export interface ScheduleInput {
  enabled: boolean;
  hour: number;
  count: number;
  subjects: string;
  extra: string;
}

export interface ScheduleLike extends ScheduleInput {
  lastRunKey: string;
}

/** 입력 검사. 문제가 없으면 null */
export function scheduleError(s: ScheduleInput): string | null {
  const subjects = parseSubjects(s.subjects);

  if (!Number.isInteger(s.hour) || s.hour < 0 || s.hour > SCHEDULE_LIMITS.hour) return "시각은 0~23 시(한국 시간)예요.";
  if (!Number.isInteger(s.count) || s.count < 1 || s.count > SCHEDULE_LIMITS.count) return `장 수는 1~${SCHEDULE_LIMITS.count} 정수예요.`;
  if (!subjects.length) return "대상 이름을 적어 주세요.";
  if (subjects.length > SCHEDULE_LIMITS.subjects) return `대상은 ${SCHEDULE_LIMITS.subjects}개까지예요.`;
  if (s.count * subjects.length > SCHEDULE_LIMITS.total) return `하루 전체 ${SCHEDULE_LIMITS.total}장까지예요(대상 ${subjects.length}개 × ${s.count}장).`;
  if (s.extra.length > SCHEDULE_LIMITS.extra) return `추가 지시는 ${SCHEDULE_LIMITS.extra}자까지예요.`;

  return null;
}

/** 지금 만들 차례인가: 켜져 있고, 오늘 정한 시각이 지났고, 오늘 아직 안 만들었을 때(서버가 늦게 깨어나도 같은 날 안에 한 번 만든다) */
export function isDue(s: ScheduleLike, now: Date | number): boolean {
  const k = kstNow(now);

  return s.enabled && k.hour >= s.hour && s.lastRunKey !== k.key;
}

/** 다음에 만들 시각 안내(예: "오늘 09시", "내일 09시") */
export function nextRunLabel(s: ScheduleLike, now: Date | number): string {
  if (!s.enabled) return "꺼짐";
  const k = kstNow(now);
  const hh = String(s.hour).padStart(2, "0");

  if (s.lastRunKey === k.key) return `내일 ${hh}시`;

  return k.hour >= s.hour ? "곧(다음 확인 때)" : `오늘 ${hh}시`;
}

/** 서비스가 자체 일정으로 만든다고 알려진 프로젝트에서 스튜디오 일정을 켜면 보여 줄 경고. 겹치지 않으면 null */
export function overlapWarning(profile: { ownSchedule: string | null } | null, studioServiceOn: boolean): string | null {
  if (!profile?.ownSchedule || !studioServiceOn) return null;

  return `서비스 서버에 자체 생성 일정이 있어요(${profile.ownSchedule}). 서비스 쪽 자동 생성이 켜져 있으면 둘 다 비용을 써요. 서버 상태는 읽을 API가 없어서 켜져 있는지는 몰라요 — 한 컷 관리자 화면에서 확인해 주세요.`;
}
