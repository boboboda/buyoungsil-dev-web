// lib/note/noteUtils.ts
// 개발노트 주소 / 관련 글 / 본문 요약에 쓰는 공용 함수 (서버·클라이언트 모두 사용 가능)

/** 글 하나의 고유 주소. 예: /note/flutter/12 */
export function noteHref(mainCategory: string, noteId: number | string): string {
  return `/note/${mainCategory}/${noteId}`;
}

/** 관련 글로 지정할 수 있는 최대 개수 */
export const MAX_RELATED_NOTES = 6;

/**
 * 요청에서 받은 관련 글 번호 목록을 안전하게 정리한다.
 * - 정수만, 중복 제거, 자기 자신 제외, 최대 개수 제한
 */
export function sanitizeRelatedIds(value: unknown, selfId?: number): number[] {
  if (!Array.isArray(value)) return [];

  const result: number[] = [];

  for (const item of value) {
    const id = Number(item);

    if (!Number.isInteger(id) || id <= 0) continue;
    if (selfId !== undefined && id === selfId) continue;
    if (result.includes(id)) continue;

    result.push(id);

    if (result.length >= MAX_RELATED_NOTES) break;
  }

  return result;
}

/** Lexical JSON(문자열 또는 객체)에서 본문 글자만 뽑는다. 메타 설명 자동 생성용. */
export function extractPlainText(content: unknown, maxLength = 150): string {
  let root: any = content;

  try {
    if (typeof root === "string") root = JSON.parse(root);
  } catch {
    return "";
  }

  const start = root?.root ?? null;

  if (!start) return "";

  const parts: string[] = [];

  const walk = (node: any) => {
    if (!node || parts.join(" ").length > maxLength * 2) return;

    // 코드 블록은 설명문에 어울리지 않으므로 건너뛴다
    if (node.type === "code") return;

    if (node.type === "text" && typeof node.text === "string") {
      parts.push(node.text);
    }

    if (Array.isArray(node.children)) node.children.forEach(walk);
  };

  walk(start);

  const text = parts.join(" ").replace(/\s+/g, " ").trim();

  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
}