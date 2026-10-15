// lib/studio/artPicker.ts
// 그림 선택기(components/studio/ArtPicker.tsx)의 순수 계산: 대상 필터·표시 날짜·선택 규칙. 화면 없이 시험한다.

export interface PickerArt {
  id: string;
  subject: string;
  kind: string;
  url: string;
  decidedAt?: string | null; // 승인 시각(ISO)
}

export const ALL_SUBJECTS = "";

/** 그림에 나온 대상 이름(중복 없이, 처음 나온 순서) */
export function pickerSubjects(arts: readonly PickerArt[]): string[] {
  return [...new Set(arts.map((a) => a.subject))];
}

/** 대상 필터. subject 가 빈 문자열이면 전체. 고른 그림은 필터에 걸리지 않아도 목록에 남겨 풀 수 있게 한다 */
export function filterPickerArts(arts: readonly PickerArt[], subject: string, keepIds: readonly string[] = []): PickerArt[] {
  if (!subject) return [...arts];

  return arts.filter((a) => a.subject === subject || keepIds.includes(a.id));
}

/** 처음 보여 줄 대상 필터: 카드 대상(기본 그림의 대상 등)이 승인 그림에 있으면 그것, 없으면 전체 */
export function initialSubject(arts: readonly PickerArt[], preferred: string | null | undefined): string {
  return preferred && arts.some((a) => a.subject === preferred) ? preferred : ALL_SUBJECTS;
}

/** 승인 날짜 표시(한국 시간 YYYY-MM-DD). 없거나 잘못된 값이면 빈 문자열 */
export function artDateLabel(decidedAt: string | null | undefined): string {
  if (!decidedAt) return "";
  const t = Date.parse(decidedAt);

  if (!Number.isFinite(t)) return "";

  return new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 칸을 눌렀을 때의 새 선택. 한 장 고르기는 같은 칸을 다시 눌러도 유지(해제는 '고르지 않음' 칸), 여러 장은 켜고 끄며 max 를 넘기지 않는다 */
export function nextSelection(current: readonly string[], id: string, multiple: boolean, max = Infinity): string[] {
  if (!multiple) return [id];
  if (current.includes(id)) return current.filter((x) => x !== id);

  return current.length >= max ? [...current] : [...current, id];
}
