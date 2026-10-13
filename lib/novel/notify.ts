// lib/novel/notify.ts
// 소설 공장 텔레그램 알림 문구. 보내기는 기존 notifyText(실패해도 보고 응답에는 영향 없음)
import { type NotifyKind } from "@/lib/novel/rules";
import { notifyText } from "@/lib/factory/telegram";

export const NOVEL_ADMIN_PATH = "/admin/factory?tab=novels";

export function novelNotifyText(
  kind: Exclude<NotifyKind, null>,
  workTitle: string,
  number?: number,
): string {
  const ep = number ? ` ${number}화` : "";

  if (kind === "held")
    return `📕 소설 보류: 「${workTitle}」${ep} — 검수 2회 실패. 통제실에서 판단해 주세요.`;
  if (kind === "batch")
    return `📚 소설 승인 대기 5화: 「${workTitle}」 — [대기 화 일괄 승인]으로 한 번에 승인할 수 있어요.`;

  return `📖 소설 승인 대기: 「${workTitle}」${ep} — 읽고 승인하거나 수정 요청해 주세요.`;
}

export function notifyNovel(
  kind: NotifyKind,
  workTitle: string,
  number?: number,
): void {
  if (!kind) return;
  void notifyText(novelNotifyText(kind, workTitle, number), NOVEL_ADMIN_PATH);
}
