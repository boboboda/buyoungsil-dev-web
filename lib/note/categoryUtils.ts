// lib/note/categoryUtils.ts
// 메인 카테고리(NoteCategory)에서 서버/클라이언트가 함께 쓰는 상수와 검증 함수.
// (Tailwind 가 lib/ 폴더도 스캔하므로 아래 gradient 클래스 이름이 그대로 빌드에 포함된다)

// ----- 카드 색상 프리셋 -----
export const CATEGORY_GRADIENTS = [
  { key: "blue-purple", label: "파랑-보라", classes: "from-blue-600 to-purple-600" },
  { key: "purple-pink", label: "보라-분홍", classes: "from-purple-500 to-pink-500" },
  { key: "blue-cyan", label: "파랑-하늘", classes: "from-blue-500 to-cyan-500" },
  { key: "sky-indigo", label: "하늘-남색", classes: "from-blue-400 to-indigo-500" },
  { key: "cyan-blue", label: "청록-파랑", classes: "from-cyan-500 to-blue-500" },
  { key: "indigo-purple", label: "남색-보라", classes: "from-indigo-500 to-purple-500" },
  { key: "gray-dark", label: "차콜", classes: "from-gray-800 to-gray-600" },
  { key: "green-emerald", label: "초록", classes: "from-green-500 to-emerald-500" },
  { key: "yellow-orange", label: "노랑-주황", classes: "from-yellow-500 to-orange-500" },
  { key: "orange-red", label: "주황-빨강", classes: "from-orange-500 to-red-500" },
  { key: "red-pink", label: "빨강-분홍", classes: "from-red-500 to-pink-500" },
  { key: "rose-fuchsia", label: "장미-자홍", classes: "from-rose-500 to-fuchsia-500" },
] as const;

export const DEFAULT_GRADIENT_KEY = "blue-purple";

export const GRADIENT_KEYS: string[] = CATEGORY_GRADIENTS.map((g) => g.key);

export function getGradientClasses(key?: string | null): string {
  const found = CATEGORY_GRADIENTS.find((g) => g.key === key);

  return (found ?? CATEGORY_GRADIENTS[0]).classes;
}

// ----- 플랫폼 -----
export const CATEGORY_PLATFORMS = [
  { value: "mobile", label: "모바일" },
  { value: "web", label: "웹" },
  { value: "backend", label: "백엔드" },
] as const;

export const PLATFORM_VALUES: string[] = CATEGORY_PLATFORMS.map((p) => p.value);

// ----- 슬러그 -----
// 주소(/note/슬러그)에 그대로 쓰이므로 영문 소문자/숫자/하이픈만 허용한다.
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// /note/ 아래에 이미 다른 용도로 쓰이는 이름은 슬러그로 쓸 수 없다.
export const RESERVED_SLUGS = ["detail", "new", "admin", "api"];

// ----- 입력 길이 제한 -----
export const CATEGORY_LIMITS = {
  slug: 40,
  name: 40,
  description: 200,
  icon: 8,
  tag: 20,
  tags: 8,
  metaTitle: 70,
  metaDescription: 160,
  metaKeyword: 30,
  metaKeywords: 10,
  imageUrl: 500,
} as const;

// "a, b, c" 같은 입력을 정리된 배열로 바꾼다 (공백 제거, 중복 제거, 개수/길이 제한)
export function parseList(
  value: string | string[] | null | undefined,
  maxItems: number,
  maxLength: number,
): string[] {
  const raw = Array.isArray(value) ? value : (value ?? "").split(/[,\n]/);
  const result: string[] = [];

  for (const item of raw) {
    const text = item.trim().replace(/\s+/g, " ").slice(0, maxLength);

    if (text && !result.includes(text)) result.push(text);
    if (result.length >= maxItems) break;
  }

  return result;
}